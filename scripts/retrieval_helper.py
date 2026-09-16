#!/usr/bin/env python3.12
"""
叮咚鸡检索辅助器 — 从经验文档(experience.md)沉淀的硬性要点转为默认行为。

解决三个核心痛点：
  A2. 防静默失败：Scopus count>25、WoS count>50 会静默返回 totalResults=0 → 强制校验。
  A3. 统一检索元数据 schema：每库输出 query/interface/total/retrieved/deduped/date/status。
  D1. 经验要点默认校验：count 上限、握手顺序、多 JSON 拼接解析、去重键优先级。

用法：
  python3.12 retrieval_helper.py --lib scopus --query "TITLE-ABS-KEY(...)" --count 100
  python3.12 retrieval_helper.py --lib wos   --query 'TS=(...)' --count 60
  python3.12 retrieval_helper.py --lib pubmed --query "natural language" --max-results 60

输出：
  1. stdout 打印统一元数据 JSON（含 total/retrieved/deduped/status）
  2. 追加到 结果文件/literature/search_log.md（若项目存在）
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

# ── 经验要点（D1）：库参数上限 ──────────────────────────────────
LIB_LIMITS = {
    "scopus": {"count_max": 25, "interface": "search_scopus", "bool_query": True},
    "wos": {"count_max": 50, "interface": "search_wos", "bool_query": True},
    "pubmed": {"count_max": None, "interface": "search_pubmed", "bool_query": False},  # 相关性 top-N，无布尔式
    "embase": {"count_max": 100, "interface": "search_embase", "bool_query": True},
    "openalex": {"count_max": 200, "interface": "search_openalex", "bool_query": False},
    "epmc": {"count_max": 100, "interface": "search_epmc", "bool_query": True},
}


def _mcp_call(server_spec: str, tool: str, arguments: dict, env: dict | None = None):
    """stdio 直连 MCP server，返回 tools/call 的 result（经验 3：主线程 stdio 直连）。
    server_spec: 模块名（-m）或以 .py 结尾的文件路径。
    关键：通过 bash -c 'source load_keys.sh && exec ...' 注入 API keys（否则子进程无 key）。"""
    if server_spec.endswith(".py"):
        inner = f"exec /opt/homebrew/bin/python3.12 {server_spec}"
    else:
        inner = f"exec /opt/homebrew/bin/python3.12 -m {server_spec}"
    cmd = ["/bin/bash", "-c", f"source ~/ddj/load_keys.sh && {inner}"]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True, env=env or os.environ)
    req_id = 0
    def send(method, params, mid):
        p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": mid, "method": method, "params": params}) + "\n")
        p.stdin.flush()
    # 握手顺序（经验 3）：initialize → notifications/initialized → tools/call
    send("initialize", {"protocolVersion": "2024-11-05", "capabilities": {},
                        "clientInfo": {"name": "ddj-retrieval", "version": "2.0"}}, 1)
    line = p.stdout.readline()
    d1 = json.loads(line) if line.strip() else {}
    send("notifications/initialized", {}, None)
    req_id = 2
    send("tools/call", {"name": tool, "arguments": arguments}, req_id)
    # 读响应直到匹配 id（经验 3：按 id 匹配）
    while True:
        line = p.stdout.readline()
        if not line:
            break
        d = json.loads(line) if line.strip() else {}
        if d.get("id") == req_id:
            p.terminate()
            return d
    p.terminate()
    return {"error": "no_response"}


def _parse_pubmed_multi_json(text: str):
    """ai4scholar 返回多个 JSON 拼接（无分隔符），用 raw_decode 循环解析（经验 4/经验 5）。"""
    import json as _json
    dec = _json.JSONDecoder()
    s = text.strip()
    records = []
    while s:
        try:
            obj, idx = dec.raw_decode(s)
            if isinstance(obj, dict) and (obj.get("paper_id") or obj.get("title")):
                records.append(obj)
            s = s[idx:].lstrip()
        except Exception:
            break
    return records


def _dedupe(records: list[dict]):
    """跨库合并去重键优先级：PMID > DOI > EID/UT > 规范化标题（经验 6）。"""
    seen = set()
    uniq = []
    for r in records:
        key = r.get("pmid") or r.get("pubmed_id") or r.get("PMID") or \
              r.get("doi") or r.get("DOI") or \
              r.get("eid") or r.get("ut") or \
              _norm_title(r.get("title", ""))
        if not key or key in seen:
            continue
        seen.add(key)
        uniq.append(r)
    return uniq


def _norm_title(t):
    return "".join(c.lower() for c in t if c.isalnum())


# ── 统一元数据 schema（A3） ────────────────────────────────────

def _metadata(lib, query, total, retrieved, deduped, status, note=""):
    return {
        "query": query,
        "interface": LIB_LIMITS[lib]["interface"],
        "total_results": total,
        "retrieved": retrieved,
        "deduped": deduped,
        "date": time.strftime("%Y-%m-%d %H:%M"),
        "status": status,
        "note": note,
    }


def run(lib, query, count=None, max_results=None, search_log=None):
    if lib not in LIB_LIMITS:
        print(json.dumps({"error": f"unknown lib: {lib}. use {list(LIB_LIMITS)}"}, ensure_ascii=False))
        sys.exit(2)

    cfg = LIB_LIMITS[lib]
    env = dict(os.environ)
    # 加载 API keys
    subprocess.run("source ~/ddj/load_keys.sh", shell=True, executable="/bin/bash")

    # ── 参数上限校验（A2/D1） ──
    if cfg["count_max"] and count and count > cfg["count_max"]:
        print(json.dumps({
            "error": f"count={count} 超过 {lib} 上限 {cfg['count_max']}（静默返回0的坑）。"
                     f"请用分页拉全，或设置 count={cfg['count_max']}。"
        }, ensure_ascii=False))
        sys.exit(2)

    server_module = {
        "scopus": "elsevier_scopus_mcp.server", "wos": "wos_clarivate_mcp.server",
        "pubmed": "ai4scholar_mcp.server", "embase": "elsevier_scopus_mcp.server",
    }.get(lib, os.path.expanduser("~/ddj/mcp-servers/biomed-supplementary/server.py"))

    try:
        if lib == "scopus":
            start = 0
            all_records = []
            total = None
            # 分页（经验：start=0,25,50,... 直到 start+count >= totalResults）
            while True:
                args = {"query": query, "count": min(count or 25, 25), "start": start}
                if "date_range" in sys.argv:  # 可选
                    pass
                res = _mcp_call(server_module, "search_scopus", args, env)
                txt = (res.get("result", {}).get("content") or [{}])[0].get("text", "")
                try:
                    parsed = json.loads(txt)
                except Exception:
                    parsed = {"totalResults": 0, "records": []}
                total = parsed.get("totalResults", 0)
                records = parsed.get("records", parsed.get("entry", [])) or []
                if not records:
                    break  # 防静默：无记录即停
                all_records.extend(records)
                start += 25
                if start >= total:
                    break
                if len(all_records) > 5000:
                    break
            uniq = _dedupe(all_records)
            meta = _metadata(lib, query, total, len(all_records), len(uniq), "ok")
            print(json.dumps(meta, ensure_ascii=False))
            print("RECORDS_JSON_BELOW")
            print(json.dumps(all_records, ensure_ascii=False, default=str))
            _emit_artifacts(search_log, lib, query, meta, all_records, uniq)

        elif lib == "wos":
            page = 1
            all_records = []
            total = None
            while True:
                args = {"query": query, "count": min(count or 50, 50), "page": page}
                res = _mcp_call(server_module, "search_wos", args, env)
                txt = (res.get("result", {}).get("content") or [{}])[0].get("text", "")
                try:
                    parsed = json.loads(txt)
                except Exception:
                    parsed = {"totalResults": 0, "records": []}
                total = parsed.get("totalResults", 0)
                records = parsed.get("records", []) or []
                if not records:
                    break
                all_records.extend(records)
                page += 1
                if (page - 1) * 50 >= total:
                    break
                if len(all_records) > 5000:
                    break
            uniq = _dedupe(all_records)
            meta = _metadata(lib, query, total, len(all_records), len(uniq), "ok")
            print(json.dumps(meta, ensure_ascii=False))
            print("RECORDS_JSON_BELOW")
            print(json.dumps(all_records, ensure_ascii=False, default=str))
            _emit_artifacts(search_log, lib, query, meta, all_records, uniq)

        elif lib in ("embase", "openalex", "epmc"):
            # 补充库：embase(Scopus server 降级可用) / openalex+epmc(biomed-supplementary)
            if lib == "embase":
                srv_file = os.path.expanduser("~/ddj/mcp-servers/elsevier-scopus/server.py")
                server_module = srv_file
                tool_name = "search_embase"
                call_args = {"query": query, "count": min(count or 25, 100)}
            else:
                srv_file = os.path.expanduser("~/ddj/mcp-servers/biomed-supplementary/server.py")
                server_module = srv_file
                tool_name = "search_openalex" if lib == "openalex" else "search_epmc"
                call_args = {"query": query, "per_page" if lib == "openalex" else "page_size": min(count or 20, 100)}
            res = _mcp_call(server_module, tool_name, call_args, env)
            txt = (res.get("result", {}).get("content") or [{}])[0].get("text", "")
            try:
                parsed = json.loads(txt)
            except Exception:
                parsed = {"totalResults": 0, "results": []}
            total = parsed.get("totalResults") or parsed.get("totalCount") or 0
            degraded = parsed.get("degraded", False)
            records = parsed.get("results", []) or []
            uniq = _dedupe(records)
            status = "ok" if not degraded else "degraded"
            note = (parsed.get("note") or "")[:80] if degraded else ""
            meta = _metadata(lib, query, total, len(records), len(uniq), status, note=note)
            print(json.dumps(meta, ensure_ascii=False))
            print("RECORDS_JSON_BELOW")
            print(json.dumps(records, ensure_ascii=False, default=str))
            _emit_artifacts(search_log, lib, query, meta, records, uniq)

        elif lib == "pubmed":
            # 相关性 top-N，无总数（经验 2.1）
            args = {"query": query, "max_results": max_results or count or 60}
            res = _mcp_call(server_module, "search_pubmed", args, env)
            txt = (res.get("result", {}).get("content") or [{}])[0].get("text", "")
            records = _parse_pubmed_multi_json(txt)
            uniq = _dedupe(records)
            meta = _metadata(lib, query, None, len(records), len(uniq), "ok",
                             note="PubMed 相关性 top-N，无精确命中总数")
            print(json.dumps(meta, ensure_ascii=False))
            print("RECORDS_JSON_BELOW")
            print(json.dumps(records, ensure_ascii=False, default=str))
            _emit_artifacts(search_log, lib, query, meta, records, uniq)
    except Exception as e:
        print(json.dumps({"error": f"{lib} 调用失败: {e}"}, ensure_ascii=False))
        sys.exit(1)


def _emit_artifacts(search_log, lib, query, meta, all_records, uniq):
    """B4+C2: 落盘 search_log（审计链）+ 去重后 RIS（供知识库摄取）。"""
    if not search_log:
        return
    sl = Path(search_log)
    sl.parent.mkdir(parents=True, exist_ok=True)
    # ── 审计链（C2）：每个环节数字 ──
    audit_entry = {
        "db": lib, "query": query, "interface": meta["interface"],
        "total_results": meta["total_results"], "retrieved": meta["retrieved"],
        "deduped": meta["deduped"], "date": meta["date"], "status": meta["status"],
    }
    audit_line = json.dumps(audit_entry, ensure_ascii=False)
    with open(sl, "a", encoding="utf-8") as f:
        f.write(f"\n## [{meta['date']}] {lib}\n")
        f.write(f"- 检索式: {query}\n")
        f.write(f"- 接口: {meta['interface']} | total={meta['total_results']} retrieved={meta['retrieved']} deduped={meta['deduped']}\n")
        f.write(f"- 审计链: {audit_line}\n")

    # ── 去重后 RIS（B4）：追加到 literature_library.ris 供 KB 摄取 ──
    ris_path = sl.parent / "literature_library.ris"
    with open(ris_path, "a", encoding="utf-8") as f:
        for r in uniq[:200]:
            title = r.get("title") or r.get("T1") or ""
            if not title:
                continue
            f.write("TY  - JOUR\n")
            f.write(f"T1  - {title}\n")
            for au in (r.get("authors") or r.get("creator") or [])[:10]:
                if isinstance(au, str):
                    f.write(f"AU  - {au}\n")
                elif isinstance(au, dict):
                    nm = au.get("name") or au.get("fullname") or au.get("authname") or ""
                    if nm:
                        f.write(f"AU  - {nm}\n")
            if r.get("pubyear") or r.get("coverDate") or r.get("year"):
                f.write(f"PY  - {(r.get('pubyear') or r.get('year') or r.get('coverDate','')[:4])}\n")
            jf = r.get("publicationName") or r.get("journal") or r.get("container-title") or ""
            if jf:
                f.write(f"JF  - {jf}\n")
            if r.get("doi"):
                f.write(f"DO  - {r['doi']}\n")
            pmid = r.get("pubmed_id") or r.get("pmid") or r.get("PMID") or ""
            if pmid:
                f.write(f"AN  - {pmid}\n")
            f.write("ER  - \n\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--lib", required=True, choices=list(LIB_LIMITS))
    ap.add_argument("--query", required=True)
    ap.add_argument("--count", type=int, default=None)
    ap.add_argument("--max-results", type=int, default=None)
    ap.add_argument("--search-log", default=None, help="search_log.md 路径（默认探测项目目录）")
    args = ap.parse_args()
    run(args.lib, args.query, args.count, args.max_results, args.search_log)
