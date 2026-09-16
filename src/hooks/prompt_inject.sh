#!/bin/bash
# UserPromptSubmit hook — 叮咚鸡管线上下文增量注入

TOKEN_FILE="/tmp/ddj_session.json"

DDJ_PY="$(command -v python3.12 || command -v python3 || command -v python || true)"
if [ -z "$DDJ_PY" ]; then
  echo '{}'
  exit 0
fi

cat > /dev/null

if [ ! -f "$TOKEN_FILE" ]; then
  echo '{}'
  exit 0
fi

WORKSPACE=$("$DDJ_PY" -c "import json;print(json.load(open('$TOKEN_FILE')).get('workspace',''))" 2>/dev/null)
if [ -z "$WORKSPACE" ]; then
  echo '{}'
  exit 0
fi

STATE="$WORKSPACE/工程文件/00_pipeline_state.json"
if [ ! -f "$STATE" ]; then
  cat << 'NO_PIPE'
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"[叮咚鸡管线] 当前工作区尚未创建研究管线。可按研究描述创建：curl -s -X POST http://127.0.0.1:19999/api/pipeline/create -H 'Content-Type: application/json' -d '{\"description\":\"<研究描述>\"}'。可用场景：systematic_review / observational / bioinformatics / scrna / drug_screening / prediction_model / software_development。"}}
NO_PIPE
  exit 0
fi

"$DDJ_PY" - "$STATE" "$WORKSPACE" << 'PYEOF'
import hashlib
import json
import os
import sys
import urllib.parse
import urllib.request

state_path, workspace = sys.argv[1], sys.argv[2]

WORKFLOW_HINTS = {
    "literature_search": "扇出 3-4 个子任务并行检索（PubMed/Embase/Scopus/CNKI），再汇总去重",
    "screening": "按批次分组筛选标题/全文，并行记录排除原因",
    "data_extraction": "按研究分组提取，双人核对交叉",
    "meta_analysis": "并行做敏感性分析、亚组分析、发表偏倚评估",
    "manuscript": "并行起草方法、结果、讨论，再统一整合",
    "diff_expression": "并行做差异分析、质控、批次校正",
    "enrichment": "并行做 GO、KEGG、GSEA 富集",
    "inferential": "并行做主回归、敏感性分析、E-value",
}

def fetch_json(url, timeout=2):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None

def current_step(pipe):
    steps = pipe.get("steps") or []
    return next((s for s in steps if s.get("id") == pipe.get("current_step")), steps[0] if steps else {})

def signature(data):
    pipe = data.get("pipeline") or {}
    cur = current_step(pipe)
    keep = {
        "project": data.get("projectName") or pipe.get("project") or os.path.basename(workspace),
        "scenario": pipe.get("scenario"),
        "mode": pipe.get("enforcement_mode"),
        "step": pipe.get("current_step"),
        "n": len(pipe.get("steps") or []),
        "allowed": cur.get("allowed"),
        "blocked": cur.get("blocked_paths"),
        "next": cur.get("next"),
        "req": cur.get("required_artifacts"),
        "miss": pipe.get("current_missing"),
        "handoff": bool((data.get("handoff") or {}).get("exists")),
        "chainOk": (data.get("chain") or {}).get("ok"),
        "chainMsg": (data.get("chain") or {}).get("message"),
    }
    return hashlib.sha256(json.dumps(keep, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]

def step_lines(cur, pipe):
    out = []
    if cur.get("allowed"):
        out.append("- 本步骤允许：" + "；".join(cur.get("allowed") or []))
    if cur.get("blocked_paths"):
        out.append("- 禁止触碰：" + "、".join(cur.get("blocked_paths") or []))
    if cur.get("next"):
        out.append("- 下一步：" + str(cur.get("next")))
    req = cur.get("required_artifacts") or []
    miss = pipe.get("current_missing") or []
    if req:
        out.append("- ⚠️ 本步产物缺口：" + "、".join(miss) if miss else "- ✅ 本步产物已齐备")
    hint = WORKFLOW_HINTS.get(str(cur.get("id") or ""))
    if hint:
        out.append("- ⚙️ 本步骤可 workflow 并行编排：" + hint)
    return out

def kb_hits(step_label):
    if not step_label:
        return []
    q = urllib.parse.quote(step_label)
    d = fetch_json(f"http://127.0.0.1:19999/api/kb/search?q={q}", timeout=3) or {}
    return (d.get("entries") or [])[:5]

def render_kb(hits):
    if not hits:
        return []
    lines = ["- 📚 当前步骤相关知识库："]
    for h in hits:
        tags = " ".join("#" + str(t) for t in (h.get("tags") or [])[:3])
        lines.append(f"  - {h.get('title','?')}（{h.get('type','')}）{(' ' + tags) if tags else ''}")
    return lines

try:
    local_state = json.load(open(state_path, encoding="utf-8"))
except Exception:
    print("{}")
    raise SystemExit

backend = fetch_json("http://127.0.0.1:19999/api/state", timeout=2) or {}
data = backend if (backend.get("pipeline") or {}).get("steps") else {"pipeline": local_state}
pipe = data.get("pipeline") or {}
cur = current_step(pipe)
steps = pipe.get("steps") or []
idx = next((i for i, s in enumerate(steps) if s.get("id") == pipe.get("current_step")), -1)
project = data.get("projectName") or pipe.get("project") or os.path.basename(workspace)
sig = signature(data)
cache_key = hashlib.sha256(workspace.encode()).hexdigest()[:16]
cache_file = f"/tmp/ddj_prompt_inject_{cache_key}.json"
prev = {}
try:
    prev = json.load(open(cache_file, encoding="utf-8"))
except Exception:
    pass

mode = "硬约束" if pipe.get("enforcement_mode") == "hard" else "软约束"
lines = []

if not prev.get("sig"):
    lines.append("## 🐔 叮咚鸡管线上下文（实时）")
    lines.append(f"- 项目：{project}")
    lines.append(f"- 场景：{pipe.get('scenario','?')} ｜ 模式：{mode} ｜ 进度：{idx + 1 if idx >= 0 else '?'}/{len(steps) or '?'}")
    if cur:
        lines.append(f"- 当前步骤：{cur.get('label') or cur.get('id') or '?'}")
        lines.extend(step_lines(cur, pipe))
    if (data.get("handoff") or {}).get("exists") or os.path.exists(os.path.join(workspace, "工程文件", "交接班.md")):
        lines.append("- 🔄 存在交接班文件：接手前必须阅读 工程文件/交接班.md")
    chain = data.get("chain") or {}
    if chain.get("ok") is False:
        lines.append("- ⚠️ 审计：" + str(chain.get("message") or "哈希链异常"))
    lines.extend(render_kb(kb_hits(cur.get("label"))))
    digest_path = os.path.expanduser("~/ddj/kb/_digest.md")
    if os.path.exists(digest_path):
        digest = open(digest_path, encoding="utf-8", errors="replace").read()[:5000]
        if digest.strip():
            lines.append("")
            lines.append("## 📚 叮咚鸡知识库摘要")
            lines.append(digest)
elif prev.get("sig") != sig:
    lines.append("## 🐔 叮咚鸡管线更新（增量）")
    if prev.get("project") and prev.get("project") != project:
        lines.append(f"- 📁 项目切换：{prev.get('project')} → {project}")
    if prev.get("step") and prev.get("step") != pipe.get("current_step"):
        lines.append(f"- 🔄 步骤切换：{prev.get('step')} → {pipe.get('current_step')}（{idx + 1}/{len(steps)}）")
    if prev.get("mode") and prev.get("mode") != pipe.get("enforcement_mode"):
        lines.append(f"- 🛡️ 模式变化：{prev.get('mode')} → {pipe.get('enforcement_mode')}")
    lines.append(f"- 当前步骤：{cur.get('label') or cur.get('id') or '?'}")
    lines.extend(step_lines(cur, pipe))
    chain = data.get("chain") or {}
    if chain.get("ok") is False:
        lines.append("- ⚠️ 审计：" + str(chain.get("message") or "哈希链异常"))
    lines.extend(render_kb(kb_hits(cur.get("label"))))
else:
    miss = pipe.get("current_missing") or []
    lines.append(f"- 🐔 管线：{pipe.get('scenario','?')} ｜ {idx + 1 if idx >= 0 else '?'}/{len(steps) or '?'} ｜ 当前步：{cur.get('label') or cur.get('id') or '?'}" + (f" ｜ ⚠️ 缺产物：{'、'.join(miss)}" if miss else ""))

lines.append("- 溯源强制：手稿和科研断言必须附 PMID/DOI/accession；无法溯源请标注 [未核实]。")
lines.append("- 知识库阅读顺序：~/ddj/kb/_digest.md → 工程文件/交接班.md → 工程文件/kb/")

try:
    json.dump({
        "sig": sig,
        "project": project,
        "step": pipe.get("current_step"),
        "mode": pipe.get("enforcement_mode"),
    }, open(cache_file, "w", encoding="utf-8"), ensure_ascii=False)
except Exception:
    pass

print(json.dumps({"hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "\n".join(lines),
}}, ensure_ascii=False))
PYEOF
