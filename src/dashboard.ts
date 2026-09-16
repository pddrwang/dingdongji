import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

export const SERVER_HOST = '127.0.0.1';
export const SERVER_PORT = 19999;
export const SERVER_BASE = `http://${SERVER_HOST}:${SERVER_PORT}`;
export const SESSION_TOKEN_PATH = '/tmp/ddj_session.json';

/** 后端脚本目录：可用环境变量 DDJ_BUS_DIR 覆盖（默认 ~/ddj/biomed_bus） */
export const BUS_DIR = process.env.DDJ_BUS_DIR || path.join(process.env.HOME || '', 'ddj', 'biomed_bus');
export const SERVER_SCRIPT = path.join(BUS_DIR, 'dashboard_server.py');

// Node's http client does not retain cookies.  Keep the dashboard's local-only
// context cookie so a VS Code window stays bound to the workspace it selected.
let dashboardContextCookie = '';

function dashboardHeaders(): Record<string, string> {
  return dashboardContextCookie ? { Cookie: dashboardContextCookie } : {};
}

function captureDashboardCookie(res: http.IncomingMessage): void {
  const raw = res.headers['set-cookie'];
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const context = values.find((value) => value.startsWith('ddj_context='));
  if (context) dashboardContextCookie = context.split(';', 1)[0];
}

/**
 * 解析可用的 Python 解释器（新环境稳健性：python3.12 → python3 → python 逐级回退）。
 */
export function resolvePython(): string | null {
  for (const cand of ['python3.12', 'python3', 'python']) {
    const r = spawnSync('/bin/bash', ['-lc', `command -v ${cand}`], { encoding: 'utf-8' });
    const bin = (r.stdout || '').trim().split('\n')[0];
    if (bin && fs.existsSync(bin)) return bin;
  }
  return null;
}

export function serverScriptExists(): boolean {
  return fs.existsSync(SERVER_SCRIPT);
}

export interface ModuleHealth {
  name: string;
  pct: number;
  cls: string;
  items: any[];
  rows: string;
}

export interface StatusResponse {
  timestamp: string;
  hostname: string;
  mod_a: ModuleHealth;
  mod_b: ModuleHealth;
  mod_c: ModuleHealth;
  mod_d: ModuleHealth;
  mod_e: ModuleHealth;
  mod_f: ModuleHealth;
  keys_loaded: number;
  mcp_total: number;
  mcp_tools: number;
  r_pkg_ok: number;
  r_pkg_total: number;
  db_ready: number;
  db_total: number;
  deepseek_balance?: any;
  [key: string]: any;
}

/** Minimal typed JSON GET helper. */
export function getJson<T = any>(url: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: dashboardHeaders() }, (res) => {
      captureDashboardCookie(res);
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Invalid JSON from ${url}: ${body.slice(0, 120)}`));
        }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms: ${url}`));
    });
    req.on('error', reject);
  });
}

export async function isServerRunning(): Promise<boolean> {
  try {
    const res = await getJson<{ timestamp: string }>(`${SERVER_BASE}/api/status`, 1500);
    return !!res && typeof res.timestamp === 'string';
  } catch {
    return false;
  }
}

export async function getStatus(): Promise<StatusResponse | null> {
  try {
    return await getJson<StatusResponse>(`${SERVER_BASE}/api/status`);
  } catch {
    return null;
  }
}

export async function getActivityLog(limit = 20): Promise<any[]> {
  try {
    const d = await getJson<{ activities: any[] }>(`${SERVER_BASE}/api/activity-log?limit=${limit}`);
    return d.activities || [];
  } catch {
    return [];
  }
}

export async function getBackendState(): Promise<any | null> {
  try {
    return await getJson<any>(`${SERVER_BASE}/api/state`);
  } catch {
    return null;
  }
}

export async function getApiInventory(): Promise<any | null> {
  try {
    return await getJson<any>(`${SERVER_BASE}/api/apis`);
  } catch {
    return null;
  }
}

export async function getLiteratureList(): Promise<any[]> {
  try {
    const d = await getJson<{ entries: any[] }>(`${SERVER_BASE}/api/literature/list`);
    return d.entries || [];
  } catch {
    return [];
  }
}

export async function getRuns(limit = 20): Promise<any[]> {
  try {
    const d = await getJson<{ runs: any[] }>(`${SERVER_BASE}/api/runs?limit=${limit}`);
    return d.runs || [];
  } catch {
    return [];
  }
}

export async function getIdeas(): Promise<any[]> {
  try { return (await getJson<{ ideas: any[] }>(`${SERVER_BASE}/api/ideas`)).ideas || []; } catch { return []; }
}

export async function getConclusions(): Promise<any[]> {
  try { return (await getJson<{ conclusions: any[] }>(`${SERVER_BASE}/api/conclusions`)).conclusions || []; } catch { return []; }
}

export async function getConclusionsState(): Promise<{ conclusions: any[]; error?: string }> {
  try {
    const result = await getJson<{ ok?: boolean; conclusions?: any[]; error?: string }>(`${SERVER_BASE}/api/conclusions`);
    return { conclusions: result.conclusions || [], error: result.ok === false ? (result.error || '后端未返回项目结论') : undefined };
  } catch (error) {
    return { conclusions: [], error: String(error) };
  }
}

export async function createIdea(text: string, parentId?: string): Promise<any> {
  return postJson<any>(`${SERVER_BASE}/api/ideas/create`, { text, parent_id: parentId });
}

export async function selectIdea(ideaId: string, rationale?: string): Promise<any> {
  return postJson<any>(`${SERVER_BASE}/api/ideas/select`, { idea_id: ideaId, rationale });
}

export async function upsertConclusion(statement: string, evidence: any[], status = 'candidate', id?: string): Promise<any> {
  return postJson<any>(`${SERVER_BASE}/api/conclusions/upsert`, { statement, evidence, status, id });
}

export async function reconcileConclusions(): Promise<any> {
  return postJson<any>(`${SERVER_BASE}/api/conclusions/reconcile`, {});
}

export async function getConclusionTrace(id: string): Promise<any> {
  return getJson<any>(`${SERVER_BASE}/api/conclusions/trace?id=${encodeURIComponent(id)}`);
}

export async function getQuestionClusters(): Promise<any[]> {
  try { return (await getJson<{ objects: any[] }>(`${SERVER_BASE}/api/v1/research/question-clusters`)).objects || []; } catch { return []; }
}

export async function createQuestionCluster(title: string, questions: any[], ideaId?: string, rationale?: string): Promise<any> {
  return postJson<any>(`${SERVER_BASE}/api/v1/research/question-clusters/create`, {
    title, questions, idea_id: ideaId, rationale,
    idempotency_key: `vscode-question-cluster-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  });
}

export async function getResearchPlans(): Promise<any[]> {
  try { return (await getJson<{ objects: any[] }>(`${SERVER_BASE}/api/v1/research/plans`)).objects || []; } catch { return []; }
}

export async function getSchedule(): Promise<any> {
  try { return await getJson<any>(`${SERVER_BASE}/api/v1/research/schedule`); }
  catch (error) { return { ok: false, error: String(error) }; }
}

export async function previewSchedule(planId: string): Promise<any> {
  return getJson<any>(`${SERVER_BASE}/api/v1/research/schedule/preview?plan_id=${encodeURIComponent(planId)}`);
}

export async function controlSchedule(action: string, planId?: string, version?: number, cloudAuthorized = false, taskDigest?: string): Promise<any> {
  if (!['start', 'cancel'].includes(action)) throw new Error('Invalid schedule action');
  return postJson<any>(`${SERVER_BASE}/api/v1/research/schedule/${action}`, { plan_id: planId, expected_version: version, cloud_authorized: cloudAuthorized, task_digest: taskDigest });
}

export async function getResearchContinuations(): Promise<any> {
  try {
    const result = await getJson<any>(`${SERVER_BASE}/api/v1/research/objects`);
    return { ...result, agentRecords: (result.objects || []).filter((item: any) => ['idea', 'decision'].includes(item.type)), objects: (result.objects || []).filter((item: any) => item.payload?.workflow_kind === 'continuation') };
  } catch (error) { return { ok: false, objects: [], error: String(error) }; }
}

export async function bindPlanPipeline(planId: string, expectedVersion: number): Promise<any> {
  const plan = (await getResearchPlans()).find((item: any) => item.id === planId);
  const current = await getJson<any>(`${SERVER_BASE}/api/pipeline/status`);
  if (!plan || !current.ok || !current.pipeline) return { ok: false, error: '计划或当前管线不可用，请刷新。' };
  return postJson<any>(`${SERVER_BASE}/api/v1/research/objects/upsert`, {
    type: 'plan', id: plan.id, expected_version: expectedVersion, status: plan.status,
    payload: { ...plan.payload, pipeline_binding: { workspace: current.workspace, scenario: current.pipeline.scenario, created: current.pipeline.created, step_ids: (current.pipeline.steps || []).map((s: any) => s.id), bound_at: new Date().toISOString() } },
  });
}

export async function createResearchContinuation(kind: string, title: string, notes: string, conclusionId: string): Promise<any> {
  if (!['research', 'manuscript'].includes(kind) || title.trim().length < 8) return { ok: false, error: '请填写至少 8 个字符的标题。' };
  const source = (await getConclusions()).find((item: any) => item.id === conclusionId);
  if (!source) return { ok: false, error: '来源结论已不可用，请刷新后重新选择。' };
  return postJson<any>(`${SERVER_BASE}/api/v1/research/objects/upsert`, {
    type: kind === 'manuscript' ? 'manuscript' : 'research_cycle', status: 'draft',
    payload: { workflow_kind: 'continuation', kind, title: title.trim(), notes: notes.slice(0, 12000), source_conclusion_id: source.id, source_snapshot: source },
    idempotency_key: `vscode-continuation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  });
}

export async function createResearchPlan(title: string, clusterId: string, tasks: any[], rationale?: string): Promise<any> {
  return postJson<any>(`${SERVER_BASE}/api/v1/research/plans/create`, {
    title, cluster_id: clusterId, tasks, rationale,
    idempotency_key: `vscode-research-plan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  });
}

export async function auditFigures(ai = false): Promise<any | null> {
  try {
    return await getJson<any>(`${SERVER_BASE}/api/audit/figures?ai=${ai ? '1' : '0'}`, 180000);
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

// ── Citation cross-database verification ──────────────────────
// The backend owns the audit: it parses every reference in the project and
// checks it against two independent databases (PubMed + Crossref).  The
// extension only requests/triggers it and renders the per-reference verdict.

export interface CitationSource {
  provider: string;
  state: string;              // matched | not_found | ambiguous | conflict | unavailable
  reason?: string;
  doi?: string;
  url?: string;
  flagged?: boolean;
}

export interface CitationItem {
  id: string;
  title: string;
  raw: string;
  doi: string;
  pmid: string;
  year: string;
  authors: string[];
  file: string;
  ordinal?: number;
  parse_issue?: string;
  status: string;             // verified | conflict | unavailable | not_found | needs_review | pending
  reason?: string;
  checked_at?: number;
  sources: CitationSource[];
}

export interface CitationStatus {
  ok: boolean;
  passed: boolean;
  status: string;             // complete | pending | needs_references
  reference_count: number;
  coverage_issues: any[];
  counts: Record<string, number>;
  report_path: string;
  fingerprint: string;
  checked_at?: number | null;
  stale?: boolean;
  results: CitationItem[];
  run_id?: string;
  queued?: string;
  existing?: boolean;
  error?: string;
}

/** Ask the backend for the current per-reference verification state.
 *  ``auto`` lets the backend queue a missing/stale audit (deduplicated). */
export async function getCitationStatus(auto = false): Promise<CitationStatus | null> {
  try {
    return await getJson<CitationStatus>(`${SERVER_BASE}/api/audit/citations?auto=${auto ? '1' : '0'}`, 20000);
  } catch (e) {
    return {
      ok: false, passed: false, status: 'error', reference_count: 0, coverage_issues: [],
      counts: {}, report_path: '', fingerprint: '', results: [], error: String((e as Error)?.message || e),
    };
  }
}

/** Explicitly (re-)run cross-database verification. ``force`` bypasses the
 *  24h result cache; an already queued/running audit is reused. */
export async function runCitationAudit(force = false): Promise<CitationStatus | null> {
  try {
    return await postJson<CitationStatus>(`${SERVER_BASE}/api/audit/citations`, { force });
  } catch (e) {
    return { ok: false, passed: false, status: 'error', reference_count: 0, coverage_issues: [], counts: {}, report_path: '', fingerprint: '', results: [], error: String((e as Error)?.message || e) };
  }
}

export function postJson<T = any>(url: string, body: any, timeoutMs = 120000): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body ?? {});
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        ...dashboardHeaders(),
      },
    }, (res) => {
      captureDashboardCookie(res);
      let text = '';
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error(`Invalid JSON from ${url}: ${text.slice(0, 120)}`));
        }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms: ${url}`));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

export async function statsReport(): Promise<any | null> {
  try {
    return await postJson<any>(`${SERVER_BASE}/api/stats/report`, {}, 180000);
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

export async function advancePipeline(expectedVersion?: number, idempotencyKey?: string): Promise<any | null> {
  try {
    const body: Record<string, unknown> = {};
    if (typeof expectedVersion === 'number') body.expected_version = expectedVersion;
    if (idempotencyKey) body.idempotency_key = idempotencyKey;
    return await postJson<any>(`${SERVER_BASE}/api/pipeline/advance`, body);
  } catch (e) {
    return { ok: false, error: 'control_plane_unavailable', message: String((e as Error)?.message || e) };
  }
}

export async function setContext(path: string): Promise<boolean> {
  try {
    const d = await postJson<{ status?: string }>(`${SERVER_BASE}/api/set-context`, { path });
    return d.status === 'ok';
  } catch {
    return false;
  }
}

export async function scanWorkspace(path?: string): Promise<any | null> {
  try {
    const d = await postJson<{ status: string; project?: any }>(`${SERVER_BASE}/api/scan-workspace`, path ? { path } : {});
    return d.status === 'ok' ? (d.project ?? null) : null;
  } catch {
    return null;
  }
}

export async function sessionCheck(): Promise<{ session_valid: boolean }> {
  try {
    return await getJson<{ session_valid: boolean }>(`${SERVER_BASE}/api/session-check`);
  } catch {
    return { session_valid: false };
  }
}
