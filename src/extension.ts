import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';
import { researchAgentBrief } from './researchAgent';
import { CodexSession } from './codexSession';
import { ProjectAgentSession } from './agentSession';
import { DeepSeekSession } from './deepseekSession';
import { SessionCache } from './sessionCache';
import { researchRoles, researchRole, roleBrief, roleSkillPath } from './researchRoles';
import { projectPath, manuscriptList, readAuthors, authorBlock } from './manuscripts';
import {
  isServerRunning,
  setContext,
  getStatus,
  getBackendState,
  getActivityLog,
  getApiInventory,
  getLiteratureList,
  getRuns,
  getIdeas,
  getConclusions,
  getConclusionsState,
  createIdea,
  selectIdea,
  upsertConclusion,
  reconcileConclusions,
  getConclusionTrace,
  getQuestionClusters,
  createQuestionCluster,
  getResearchPlans,
  createResearchPlan,
  getSchedule,
  controlSchedule,
  previewSchedule,
  getResearchContinuations,
  createResearchContinuation,
  bindPlanPipeline,
  auditFigures,
  statsReport,
  getCitationStatus,
  runCitationAudit,
  CitationStatus,
  advancePipeline,
  SESSION_TOKEN_PATH,
  SERVER_SCRIPT,
  BUS_DIR,
  resolvePython,
  serverScriptExists,
} from './dashboard';
import * as pipeline from './pipeline';
import * as kb from './knowledgeBase';
import * as enforcement from './enforcement';
import * as handoff from './handoff';

// 全部场景 id（智能体自主创建管线时校验）
const SCENARIOS_IDS = pipeline.SCENARIO_LIST.map((s) => s.id);

let viewProvider: DingdongjiViewProvider | null = null;
let bootstrapDone = false;
let livePollTimer: NodeJS.Timeout | null = null;
let citationStatusItem: vscode.StatusBarItem | null = null;
let citationDebounce: NodeJS.Timeout | null = null;
let citationPollTimer: NodeJS.Timeout | null = null;
let citationAuditInFlight = false;
let activeWorkspaceOverride: string | null = null;
let fusionPanel: vscode.WebviewPanel | undefined;
let fusionExternal = false;
let fusionSwitchEpoch = 0;
let fusionSwitchPending = false;
let fusionAutoOpened = false;
let fusionCache: SessionCache;
const fusionManagementLocks = new Set<string>();
const fusionDraftCache = new Map<string, string>();

// 内置对话窗口的交互卡片：扩展开关把 Codex requestUserInput 与 DSH
// session/request_permission 渲染到 fusion webview，等待用户操作后回传。
interface PendingInteraction {
  resolve: (value: any) => void;
  workspace: string;
  sessionId: string;
  kind: 'ask' | 'approval';
  questions: any[];
  options: any[];
  empty: any;
  timer: NodeJS.Timeout;
  acked: boolean;
  ackResolve?: (value: boolean) => void;
}
const pendingInteractions = new Map<string, PendingInteraction>();
let interactionSequence = 0;

/** Accept both `["A","B"]` and `[{label,description}]` option shapes. */
function normalizeAskOptions(raw: any): { label: string; description?: string }[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: { label: string; description?: string }[] = [];
  for (const item of list) {
    if (typeof item === 'string' && item.trim()) { out.push({ label: item.trim() }); continue; }
    if (!item || typeof item !== 'object') continue;
    const label = item.label ?? item.value ?? item.name ?? item.title ?? item.text;
    if (typeof label === 'string' && label.trim()) {
      out.push({ label: label.trim(), description: typeof item.description === 'string' ? item.description : undefined });
    }
  }
  return out.slice(0, 20);
}

function normalizeAskQuestions(params: any): any[] {
  const raw = Array.isArray(params?.questions) ? params.questions
    : Array.isArray(params?.request?.questions) ? params.request.questions : [];
  return raw
    .filter((q: any) => q && (typeof q.id === 'string' || typeof q.id === 'number'))
    .map((q: any) => ({
      id: String(q.id),
      header: typeof q.header === 'string' ? q.header : undefined,
      question: String(q.question ?? q.prompt ?? q.text ?? q.header ?? ''),
      multiSelect: q.multiSelect === true || q.multiple === true,
      options: normalizeAskOptions(q.options),
    }))
    .filter((q: any) => q.question)
    .slice(0, 20);
}

/** Clickable native fallback (quick pick), used when the in-chat card is unavailable. */
async function askNativeFallback(ws: string, questions: any[]): Promise<Record<string, { answers: string[] }>> {
  const answers: Record<string, { answers: string[] }> = {};
  for (const q of questions || []) {
    if (getWorkspace() !== ws) throw new Error('项目已切换，未提交回答');
    if (Array.isArray(q.options) && q.options.length) {
      const items = q.options as (vscode.QuickPickItem & { custom?: boolean })[];
      if (q.multiSelect) {
        const picks = await vscode.window.showQuickPick(items, { title: q.question, canPickMany: true, ignoreFocusOut: true });
        answers[q.id] = { answers: (picks || []).map((p) => p.label) };
      } else {
        const pick = await vscode.window.showQuickPick(
          [...items, { label: '$(edit) 自定义回答…', custom: true }],
          { title: q.question, ignoreFocusOut: true }
        );
        if (!pick) answers[q.id] = { answers: [] };
        else if (pick.custom) {
          const text = await vscode.window.showInputBox({ prompt: q.question, ignoreFocusOut: true });
          answers[q.id] = { answers: text ? [text] : [] };
        } else answers[q.id] = { answers: [pick.label] };
      }
    } else {
      const text = await vscode.window.showInputBox({ prompt: q.question, ignoreFocusOut: true });
      answers[q.id] = { answers: text ? [text] : [] };
    }
    if (getWorkspace() !== ws) throw new Error('项目已切换，未提交回答');
  }
  return answers;
}

function askEmptyAnswers(questions: any[]): Record<string, { answers: string[] }> {
  const answers: Record<string, { answers: string[] }> = {};
  for (const q of questions || []) if (q && typeof q.id === 'string') answers[q.id] = { answers: [] };
  return answers;
}

/** Only our own webview answers reach here, but never trust them unvalidated. */
function sanitizeAskAnswers(value: any, questions: any[]): Record<string, { answers: string[] }> {
  const answers = askEmptyAnswers(questions);
  if (!value || typeof value !== 'object') return answers;
  for (const q of questions || []) {
    const entry = (value as any)[q.id];
    if (!entry || !Array.isArray(entry.answers)) continue;
    answers[q.id] = { answers: entry.answers
      .filter((a: any) => typeof a === 'string' && a.trim().length > 0)
      .slice(0, 10)
      .map((a: string) => a.trim().slice(0, 2000)) };
  }
  return answers;
}

/** Approval answers must reference one of the options DSH actually offered. */
function sanitizeApprovalOutcome(value: any, options: any[]): any {
  const allowed = new Set((options || []).map((o: any) => o?.optionId).filter((id: any) => typeof id === 'string'));
  const optionId = value && typeof value.optionId === 'string' ? value.optionId : '';
  if (optionId && allowed.has(optionId)) return { outcome: { outcome: 'selected', optionId } };
  return { outcome: { outcome: 'cancelled' } };
}

function settleInteraction(requestId: string, value: any): void {
  const pending = pendingInteractions.get(requestId);
  if (!pending) return;
  pendingInteractions.delete(requestId);
  clearTimeout(pending.timer);
  pending.resolve(value);
}

/** Resolve unanswered requests so a closed panel or stopped turn cannot hang the agent. */
function cancelPendingInteractions(workspace?: string): void {
  for (const [requestId, pending] of [...pendingInteractions]) {
    if (workspace && pending.workspace !== workspace) continue;
    settleInteraction(requestId, pending.empty);
  }
}

/** Post a request to the built-in chat window; null means "no panel, use native UI".
 *  ``acked`` resolves true once the webview confirms the card rendered, so callers
 *  can fall back to a native prompt when the card cannot be delivered. */
function requestInChatInteraction(
  ws: string,
  payload: { kind: 'ask' | 'approval'; questions?: any[]; options?: any[]; toolCall?: any; empty: any; demo?: boolean }
): { result: Promise<any>; acked: Promise<boolean>; cancel: () => void } | null {
  const panel = fusionPanel;
  if (!panel) return null;
  const requestId = `ix-${Date.now()}-${++interactionSequence}`;
  const sessionId = fusionId(ws);
  let ackResolve: (value: boolean) => void = () => {};
  const acked = new Promise<boolean>((resolve) => { ackResolve = resolve; });
  const result = new Promise<any>((resolve) => {
    const timer = setTimeout(() => { ackResolve(false); settleInteraction(requestId, payload.empty); }, 10 * 60 * 1000);
    pendingInteractions.set(requestId, {
      resolve: (value) => { ackResolve(true); resolve(value); },
      workspace: ws, sessionId, kind: payload.kind,
      questions: payload.questions || [], options: payload.options || [],
      empty: payload.empty, timer, acked: false, ackResolve,
    });
    try {
      panel.webview.postMessage(payload.kind === 'ask'
        ? { type: 'fusionAskUser', requestId, workspace: ws, sessionId, questions: payload.questions || [], demo: payload.demo === true }
        : { type: 'fusionApproval', requestId, workspace: ws, sessionId, toolCall: payload.toolCall || {}, options: payload.options || [], demo: payload.demo === true });
    } catch {
      ackResolve(false);
      settleInteraction(requestId, payload.empty);
    }
  });
  return {
    result,
    acked,
    cancel: () => {
      const existed = pendingInteractions.has(requestId);
      settleInteraction(requestId, payload.empty);
      // 回退原生时同步收起可能已经渲染的卡片，避免出现“失效卡片 + 原生弹窗”。
      if (existed) { try { fusionPanel?.webview.postMessage({ type: 'fusionInteractionClose', requestId }); } catch { /* ignore */ } }
    },
  };
}

/** Wait briefly for the card to render; false means "fall back to native". */
async function cardRendered(interaction: { acked: Promise<boolean> }): Promise<boolean> {
  return Promise.race([
    interaction.acked,
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2500)),
  ]);
}

// ── 交互卡片预览（命令面板触发，合成数据，不影响任何真实会话）──
const DEMO_ASK_QUESTIONS = [
  { id: 'demo-type', header: '研究类型', question: '这项研究属于哪一类？（预览合成数据）', options: [
    { label: '观察性研究', description: '队列 / 病例对照' },
    { label: '干预性研究', description: '随机 / 非随机试验' },
  ] },
  { id: 'demo-source', header: '数据来源', question: '可用的数据来源有哪些？（可多选）', multiSelect: true, options: [
    { label: '电子病历' }, { label: '随访队列' }, { label: '公开数据库' },
  ] },
];
const DEMO_APPROVAL_OPTIONS = [
  { optionId: 'demo-once', name: '批准本次', kind: 'allow_once' },
  { optionId: 'demo-always', name: '始终允许', kind: 'allow_always' },
  { optionId: 'demo-reject', name: '拒绝本次', kind: 'reject_once' },
  { optionId: 'demo-never', name: '始终拒绝', kind: 'reject_always' },
];
const DEMO_APPROVAL_TOOL = { kind: 'execute', title: '预览：运行示例脚本', command: 'Rscript demo.R', path: '/demo/project/工程文件/demo.R' };

async function previewInteractionCard(kind: 'ask' | 'approval'): Promise<void> {
  const ws = getWorkspace();
  if (!ws) { void vscode.window.showWarningMessage('叮咚鸡：请先打开一个项目工作区，再预览交互卡片。'); return; }
  openFusion();
  await delay(800);
  const payload = kind === 'ask'
    ? { kind: 'ask' as const, questions: DEMO_ASK_QUESTIONS, empty: { answers: askEmptyAnswers(DEMO_ASK_QUESTIONS) }, demo: true }
    : { kind: 'approval' as const, options: DEMO_APPROVAL_OPTIONS, toolCall: DEMO_APPROVAL_TOOL, empty: { outcome: { outcome: 'cancelled' } }, demo: true };
  let inChat: ReturnType<typeof requestInChatInteraction> = null;
  for (let attempt = 0; attempt < 2 && !inChat; attempt++) {
    const candidate = requestInChatInteraction(ws, payload);
    if (candidate && await cardRendered(candidate)) inChat = candidate;
    else if (candidate) { candidate.cancel(); await delay(1200); }
  }
  if (!inChat) { void vscode.window.showWarningMessage('叮咚鸡：内置对话面板未就绪，未能显示预览卡片。请先执行「叮咚鸡：打开仪表盘」再重试。'); return; }
  const result = await inChat.result;
  const summary = kind === 'ask'
    ? `已收到回答：${JSON.stringify(sanitizeAskAnswers(result.answers, DEMO_ASK_QUESTIONS))}`
    : (result.outcome?.outcome === 'selected' ? `已选择：${result.outcome.optionId}` : '已取消（视为拒绝）');
  void vscode.window.showInformationMessage(`叮咚鸡：交互卡片可用 —— ${summary}（预览，未影响任何会话）`);
}
function fusionDraftKey(ws: string, id: string) { return `ddj.draft:${ws}:${id}`; }
function readFusionDraft(ws: string, id: string) {
  const key = fusionDraftKey(ws, id);
  return fusionDraftCache.get(key) ?? fusionContext.workspaceState.get<string>(key, '');
}
function broadcastFusionMode(message = ''): void {
  postToWebview({ type: 'fusionMode', external: fusionExternal, panelOpen: !!fusionPanel, switching: fusionSwitchPending, message });
}
let fusionContext: vscode.ExtensionContext;
const fusionSessions = new Map<string, ProjectAgentSession>();
const fusionIds = new Map<string, string>();
const fusionFiles = new Map<string, string[]>();
type FusionEntry = { id: string; title: string; role?: string; archived?: boolean; deletedAt?: number };
function fusionIndex(ws: string): FusionEntry[] { return fusionContext.workspaceState.get<FusionEntry[]>(`ddj.threads:${ws}`, []); }
function fusionId(ws: string): string {
  let id = fusionIds.get(ws);
  if (!id) { id = fusionContext.workspaceState.get<string>(`ddj.selected:${ws}`, 'initial'); fusionIds.set(ws, id); }
  return id;
}

function openFusion(): void {
  ++fusionSwitchEpoch; fusionSwitchPending = false; fusionExternal = false;
  fusionAutoOpened = true;
  if (fusionPanel) { fusionPanel.reveal(); broadcastFusionMode(); return; }
  fusionPanel = vscode.window.createWebviewPanel('ddj.fusion', '叮咚鸡 · 生物医学整合研究平台', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
  fusionPanel.webview.html = getWebviewHtml(fusionPanel.webview, true);
  fusionPanel.webview.onDidReceiveMessage(msg => handleMessage(fusionContext, msg));
  fusionPanel.onDidChangeViewState(e => { if (e.webviewPanel.visible) e.webviewPanel.webview.postMessage({ type: 'fusionEnter' }); });
  fusionPanel.onDidDispose(() => { cancelPendingInteractions(); fusionPanel = undefined; ++fusionSwitchEpoch; fusionSwitchPending = false; broadcastFusionMode(); });
  broadcastFusionMode();
}

function fusionSnapshot(): void {
  const ws = getWorkspace();
  for (const [key, session] of fusionSessions) {
    void fusionCache.save(`ddj.fusion:${key}:${fusionId(key)}`, { ...session.persist(), attachments: fusionFiles.get(key) || [] }).catch(() => {});
  }
  fusionPanel?.webview.postMessage({ type: 'fusionState', managementPending: !!ws && fusionManagementLocks.has(ws), draft: ws ? readFusionDraft(ws, fusionId(ws)) : '', sessions: ws ? fusionIndex(ws) : [], sessionId: ws ? fusionId(ws) : '', attachments: ws ? fusionFiles.get(ws) || [] : [], ...(ws && fusionSessions.get(ws)?.snapshot() || { workspace: ws || '', messages: [], busy: false }) });
}

function fusionSession(ws: string): ProjectAgentSession {
  if (!fusionIndex(ws).length) void fusionContext.workspaceState.update(`ddj.threads:${ws}`, [{ id: fusionId(ws), title: '初始会话' }]);
  let session = fusionSessions.get(ws);
  if (!session) {
    session = new ProjectAgentSession(ws, () => { fusionSnapshot(); }, (agent, emit) => {
    const approve = async (method: string, params: any) => {
      if (getWorkspace() !== ws) throw new Error('请先切回该项目再处理交互请求');
      if (method === 'session/request_permission') {
        const options: any[] = Array.isArray(params.options) ? params.options.filter((o: any) => o && typeof o.optionId === 'string') : [];
        // 内置窗口打开且卡片确实渲染时用会话内审批卡片；否则退回原生模态审批。
        const inChat = requestInChatInteraction(ws, { kind: 'approval', options, toolCall: params.toolCall || {}, empty: { outcome: { outcome: 'cancelled' } } });
        if (inChat && await cardRendered(inChat)) {
          const result = await inChat.result;
          if (getWorkspace() !== ws) throw new Error('项目已切换，未提交审批');
          return result;
        }
        if (inChat) inChat.cancel();
        const allow = options.find((o: any) => o.kind === 'allow_once');
        const choice = await vscode.window.showWarningMessage(`DeepSeek Harness 请求批准 · ${path.basename(ws)}`, { modal: true, detail: JSON.stringify(params.toolCall || {}, null, 2).slice(0, 12000) + '\nHarness 原生权限策略，不等同于 Codex 沙箱。仅批准本次。' }, '批准本次', '拒绝');
        return { outcome: getWorkspace() === ws && allow && choice === '批准本次' ? { outcome: 'selected', optionId: allow.optionId } : { outcome: 'cancelled' } };
      }
      if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
        const choice = await vscode.window.showWarningMessage(`Codex 请求批准 · ${path.basename(ws)}\n${params.command || params.reason || '修改项目文件'}`, { modal: true, detail: JSON.stringify(params, null, 2).slice(0, 12000) }, '批准本次', '拒绝');
        return { decision: getWorkspace() === ws && choice === '批准本次' ? 'accept' : 'decline' };
      }
      if (method === 'item/tool/requestUserInput') {
        const questions = normalizeAskQuestions(params);
        // 内置对话窗口打开且卡片确实渲染时，把提问渲染成会话内组件。
        if (questions.length) {
          const inChat = requestInChatInteraction(ws, { kind: 'ask', questions, empty: { answers: askEmptyAnswers(questions) } });
          if (inChat && await cardRendered(inChat)) {
            const result = await inChat.result;
            if (getWorkspace() !== ws) throw new Error('项目已切换，未提交回答');
            return result;
          }
          if (inChat) inChat.cancel();
        }
        // 卡片不可用时退回可点击的原生快速选择，而不是只能输入的占位文字。
        const fallback = questions.length ? questions : normalizeAskQuestions({ questions: params.questions });
        return { answers: await askNativeFallback(ws, fallback) };
      }
      throw new Error('此客户端尚不支持该交互请求');
    };
    if (agent === 'deepseek') return new DeepSeekSession(ws, emit, approve, () => {
      const executable = vscode.workspace.getConfiguration('dingdongji').get<string>('deepseekExecutable')?.trim() || path.join(os.homedir(), '.local', 'bin', 'dsh');
      if (!path.isAbsolute(executable) || !fs.existsSync(executable) || !fs.statSync(executable).isFile()) throw new Error('请安装 DeepSeek Harness，或设置 dingdongji.deepseekExecutable 为可执行文件绝对路径。');
      return executable;
    });
    return new CodexSession(ws, emit, approve, () => {
      // Resolve at every new connection, not once per extension activation/version.
      const override = vscode.workspace.getConfiguration('dingdongji').get<string>('codexExecutable')?.trim();
      if (override) {
        if (!path.isAbsolute(override) || !fs.existsSync(override) || !fs.statSync(override).isFile()) throw new Error('dingdongji.codexExecutable 必须是有效的绝对文件路径。');
        return override;
      }
      const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux';
      const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
      const name = process.platform === 'win32' ? 'codex.exe' : 'codex';
      const root = vscode.extensions.getExtension('openai.chatgpt')?.extensionPath;
      const bundled = root && path.join(root, 'bin', `${platform}-${arch}`, name);
      return bundled && fs.existsSync(bundled) ? bundled : path.join(os.homedir(), '.local', 'bin', name);
    });
    });
    const saved = fusionContext.workspaceState.get<{ threadId: string; messages: { role: string; text: string; id?: string }[] }>(`ddj.fusion:${ws}:${fusionId(ws)}`)
      || (fusionId(ws) === 'initial' ? fusionContext.workspaceState.get<any>(`ddj.fusion:${ws}`) : undefined);
    if (saved) {
      session.restore(saved);
      fusionFiles.set(ws, (saved as any).attachments || []);
    }
    fusionSessions.set(ws, session);
  }
  return session;
}

const CODEX_EXTENSION_ID = 'openai.chatgpt';
const CODEX_SKILL_NAMES = [
  'protein_analysis', 'sequence_analysis', 'clinical-trial-protocol-skill', 'single-cell-rna-qc',
  'scvi-tools', 'nextflow-development', 'scientific-problem-selection', 'instrument-data-to-allotrope',
];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  fusionContext = context;
  fusionCache = new SessionCache((key, value) => context.workspaceState.update(key, value), () => {
    void vscode.window.showWarningMessage('叮咚鸡会话缓存写入失败。请保留窗口并导出重要会话，避免重载后丢失内容。');
  });
  let lastWorkspace = getWorkspace();
  const syncWorkspace = async () => {
    const next = getWorkspace(); if (next === lastWorkspace) return;
    lastWorkspace = next;
    cancelPendingInteractions();
    if (next) await setContext(next);
    fusionSnapshot(); await handleMessage(context, { command: 'getAll' });
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => { void syncWorkspace(); }), vscode.workspace.onDidChangeWorkspaceFolders(() => { activeWorkspaceOverride = null; void syncWorkspace(); }));

  // 引用跨库核验：保存含引用的手稿 / RIS / BibTeX 后，由后端自动重跑核验。
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => {
    const ws = getWorkspace();
    if (!ws || doc.uri.scheme !== 'file') return;
    const rel = path.relative(ws, doc.uri.fsPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !isReferenceBearingFile(rel)) return;
    if (citationDebounce) clearTimeout(citationDebounce);
    citationDebounce = setTimeout(() => { void triggerCitationAudit(true); }, 1500);
  }));
  citationStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  citationStatusItem.command = 'ddj.openPanel';
  context.subscriptions.push(citationStatusItem);
  // 侧边栏 Webview 视图（活动栏「叮咚鸡」图标 → ddj.views.main）
  viewProvider = new DingdongjiViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('ddj.views.main', viewProvider)
  );

  // 上架自包含：资源根指向扩展安装目录（含 src/webview、src/hooks、src/agents）
  enforcement.setExtRoot(context.extensionUri.fsPath);

  // 命令
  context.subscriptions.push(
    vscode.commands.registerCommand('ddj.openPanel', () => openFusion()),
    vscode.commands.registerCommand('ddj.previewAskCard', () => previewInteractionCard('ask')),
    vscode.commands.registerCommand('ddj.previewApprovalCard', () => previewInteractionCard('approval')),
    vscode.commands.registerCommand('ddj.scanWorkspace', async () => {
      await bootstrap();
      const ws = getWorkspace();
      if (ws) {
        kb.enrichWorkspace(ws);
        syncClaudeContext(ws);
        vscode.window.showInformationMessage('叮咚鸡：工作区扫描完成');
        pushState();
      }
    }),
    vscode.commands.registerCommand('ddj.advanceStep', async () => {
      const ws = getWorkspace();
      if (!ws) return;
      await doAdvance(ws);
      pushState();
    }),
    vscode.commands.registerCommand('ddj.rollbackStep', async () => {
      const ws = getWorkspace();
      if (!ws) return;
      const st = pipeline.rollbackStep(ws);
      if (st) { syncClaudeContext(ws); vscode.window.showInformationMessage(`叮咚鸡：已回退到「${stepLabel(st)}」`); }
      pushState();
    }),
    vscode.commands.registerCommand('ddj.resetPipeline', async () => {
      const ws = getWorkspace();
      if (!ws) return;
      await confirmReset(ws);
      pushState();
    }),
    vscode.commands.registerCommand('ddj.toggleEnforcement', async () => {
      const ws = getWorkspace();
      if (!ws) return;
      const cur = pipeline.readPipelineState(ws);
      if (!cur) return;
      const next = cur.enforcement_mode === 'soft' ? 'hard' : 'soft';
      pipeline.setEnforcementMode(ws, next);
      syncClaudeContext(ws);
      vscode.window.showInformationMessage(`叮咚鸡：约束模式 → ${next === 'hard' ? '硬约束' : '软约束'}`);
      pushState();
    }),
    // ── 科研绘图模块（V2.3） ──
    vscode.commands.registerCommand('ddj.openPlot', () => {
      revealView();
      postToWebview({ type: 'switchTab', tab: 'plot' });
    }),
    vscode.commands.registerCommand('ddj.plotCheck', () => {
      postToWebview({ type: 'triggerPlotCheck' });
    }),
    vscode.commands.registerCommand('ddj.plotSamples', () => {
      postToWebview({ type: 'triggerPlotSamples' });
    }),
    vscode.commands.registerCommand('ddj.openCodex', async () => {
      await openCodexSidebar();
    }),
    vscode.commands.registerCommand('ddj.openCodexContext', async () => {
      const ws = getWorkspace();
      if (!ws) {
        vscode.window.showWarningMessage('叮咚鸡：请先打开项目工作区，再将项目上下文交给 Codex。');
        return;
      }
      await openCodexWithProjectContext(ws);
    }),
    // ── 交接班（项目经理→外包程序员） ──
    vscode.commands.registerCommand('ddj.pauseProject', async () => {
      const ws = getWorkspace();
      if (!ws) return;
      const content = await vscode.window.showInputBox({
        prompt: '暂停项目，填写交接内容（进展/待办/遗留问题），供下一位 Claude 接手',
        placeHolder: '例：已完成文献检索与筛选，纳入 12 篇；数据提取表已生成；下一步做 Meta 分析……',
        ignoreFocusOut: true,
      });
      if (content === undefined) return; // 取消
      const p = handoff.writeHandoff(ws, content || '（未填写具体交接内容，以管线状态快照为准）');
      syncClaudeContext(ws);  // 让 CLAUDE.md 提示交接班存在
      vscode.window.showInformationMessage(`叮咚鸡：已生成交接班文件 → ${p}`);
      pushState();
    }),
    vscode.commands.registerCommand('ddj.resumeProject', async () => {
      const ws = getWorkspace();
      if (!ws) return;
      const info = handoff.readHandoff(ws);
      if (!info.exists) {
        vscode.window.showInformationMessage('叮咚鸡：当前项目无交接班文件，可直接开始。');
        return;
      }
      // 打开交接班文件供当前 Claude 阅读
      if (info.path) vscode.window.showTextDocument(vscode.Uri.file(info.path));
      const choice = await vscode.window.showInformationMessage(
        '叮咚鸡：检测到交接班文件。接手后是否标记为已处理？',
        { modal: true }, '标记已处理', '保留'
      );
      if (choice === '标记已处理') {
        handoff.clearHandoff(ws);
        syncClaudeContext(ws);
        vscode.window.showInformationMessage('叮咚鸡：交接班已标记处理，继续工作。');
      }
      pushState();
    })
  );

  // 实时管线轮询（改进2：可视化 Claude 自主推进）
  startLivePoll();

  await bootstrap();
  // 启动即让后端核验引用（无引用则为空状态），README 状态栏常驻可见
  void refreshCitationStatus(true, false);
}

export async function deactivate(): Promise<void> {
  fusionSnapshot();
  fusionSessions.forEach(session => session.dispose());
  if (livePollTimer) clearInterval(livePollTimer);
  if (citationDebounce) clearTimeout(citationDebounce);
  if (citationPollTimer) clearInterval(citationPollTimer);
  await fusionCache?.flush();
}

// ── Webview View Provider（侧边栏主入口）─────────────────────

class DingdongjiViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _disposables: vscode.Disposable[] = [];

  constructor(readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    if (!fusionAutoOpened) openFusion();
    webviewView.webview.options = {
      enableScripts: true,
    };
    webviewView.webview.html = getWebviewHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      await handleMessage(this.context, msg, 'sidebar');
    });
    webviewView.onDidDispose(() => {
      this.dispose();
    });
    // 视图就绪后推一次状态
    pushState();
  }

  private dispose(): void {
    this._view = undefined;
    for (const d of this._disposables) d.dispose();
    this._disposables = [];
  }

  get webview(): vscode.Webview | undefined {
    return this._view?.webview;
  }

  /** 将本地文件路径转换为 webview 可展示的资源 URI（预览图片用） */
  uriFor(p: string): string | undefined {
    if (!this._view) return undefined;
    return this._view.webview.asWebviewUri(vscode.Uri.file(p)).toString();
  }
}

function revealView(): void {
  vscode.commands.executeCommand('ddj.views.main.focus').then(
    undefined,
    () => vscode.window.showInformationMessage('叮咚鸡：请从活动栏点击「叮咚鸡」图标打开仪表盘')
  );
}

function codexExtension(): vscode.Extension<any> | undefined {
  return vscode.extensions.getExtension(CODEX_EXTENSION_ID);
}

/** OpenAI Codex 扩展公开贡献的命令；保留回退以兼容旧版本。 */
async function openCodexSidebar(): Promise<boolean> {
  const codex = codexExtension();
  if (!codex) {
    vscode.window.showInformationMessage(
      '叮咚鸡：未检测到 Codex 扩展。请安装「Codex – OpenAI’s coding agent」（openai.chatgpt）。'
    );
    return false;
  }
  try {
    if (!codex.isActive) await codex.activate();
    await vscode.commands.executeCommand('chatgpt.openSidebar');
    return true;
  } catch {
    try {
      await vscode.commands.executeCommand('chatgpt.newCodexPanel');
      return true;
    } catch {
      vscode.window.showWarningMessage('叮咚鸡：Codex 已安装，但无法打开其侧栏。请尝试命令面板中的「Codex: Open Codex Sidebar」。');
      return false;
    }
  }
}

function codexProjectContextFiles(ws: string): string[] {
  const candidates = [
    path.join(ws, 'AGENTS.md'),
    path.join(ws, '叮咚鸡_pipeline_context.md'),
    path.join(ws, '工程文件', '00_pipeline_state.json'),
    path.join(ws, '工程文件', '交接班.md'),
    path.join(ws, '工程文件', 'artifact_manifest.json'),
    path.join(ws, '工程文件', 'A_project_concept.md'),
    path.join(ws, '工程文件', '叮咚鸡_科学研究闭环重构计划_2026-09-06.md'),
  ];
  return candidates.filter((p) => fs.existsSync(p));
}

/**
 * 将项目的持久上下文交给 Codex：先保证 AGENTS/管线上下文是最新的，
 * 再调用 Codex 公开的“Add File to Codex Thread”命令。若版本不接受 URI
 * 参数，文件仍会以打开的编辑器标签保留，用户可从 Codex composer 继续选择。
 */
async function openCodexWithProjectContext(ws: string, researchBrief?: string): Promise<boolean> {
  syncClaudeContext(ws); // 同时刷新 AGENTS.md；Codex 自动读取该项目指令文件
  const files = codexProjectContextFiles(ws);
  if (!(await openCodexSidebar())) return false;

  let attached = 0;
  if (researchBrief) {
    const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: researchBrief.slice(0, 100000) });
    await vscode.window.showTextDocument(document, { preview: false, preserveFocus: true });
    try { await vscode.commands.executeCommand('chatgpt.addFileToThread', document.uri); attached += 1; } catch { /* Brief remains visible for manual attachment. */ }
  }
  for (const file of files) {
    const uri = vscode.Uri.file(file);
    try {
      await vscode.commands.executeCommand('chatgpt.addFileToThread', uri);
      attached += 1;
    } catch {
      // Continue: extension versions may only accept the active-editor form.
    }
  }
  if (!attached && files.length) {
    await vscode.window.showTextDocument(vscode.Uri.file(files[0]), { preview: true, preserveFocus: true });
  }
  vscode.window.showInformationMessage(
    attached
      ? `叮咚鸡：已向 Codex 线程添加 ${attached} 份项目上下文（管线、交接、审计）。`
      : `叮咚鸡：已打开 Codex；项目 AGENTS.md 已同步。请在 Composer 用 Add File 添加已打开的上下文。`
  );
  return true;
}

function getCodexFusionState(ws: string | undefined): any {
  const codex = codexExtension();
  const configPath = path.join(os.homedir(), '.codex', 'config.toml');
  const skillsReady = CODEX_SKILL_NAMES.filter((name) => fs.existsSync(path.join(os.homedir(), '.codex', 'skills', name, 'SKILL.md')));
  const contextFiles = ws ? codexProjectContextFiles(ws) : [];
  return {
    installed: !!codex,
    version: codex?.packageJSON?.version || '',
    active: !!codex?.isActive,
    config: fs.existsSync(configPath),
    skillsReady: skillsReady.length,
    skillsTotal: CODEX_SKILL_NAMES.length,
    contextFiles: contextFiles.length,
  };
}

// ── 科研绘图模块工具（V2.3）──────────────────────────────────

function ddjHome(): string {
  return path.join(os.homedir(), 'ddj');
}

function plotPython(): string {
  return path.join(ddjHome(), 'venvs', 'ds-stats', 'bin', 'python');
}

function plotCheckScript(): string {
  return path.join(ddjHome(), 'tools', 'ddj_plot_check.py');
}

function plotGenScript(): string {
  return path.join(enforcement.getExtRoot(), 'src', 'plot', 'plot_from_csv.py');
}

function plotThumbScript(): string {
  return path.join(enforcement.getExtRoot(), 'src', 'plot', 'make_thumbs.py');
}

function auditAnchorPath(): string {
  return path.join(os.homedir(), '.ddj_audit_anchor.json');
}

function readAuditAnchor(): any | null {
  try {
    const p = auditAnchorPath();
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null;
  } catch {
    return null;
  }
}

function writeAuditAnchor(chainHash: string, stepId: string): void {
  if (!chainHash || !stepId) return;
  try {
    fs.writeFileSync(auditAnchorPath(), JSON.stringify({ chainHash, stepId, ts: Date.now() }, null, 2), 'utf-8');
  } catch { /* ignore */ }
}

function auditAnchorStatus(backendState: any, localPipeline: pipeline.PipelineState | null): any {
  const chainHash = String(backendState?.chain?.chainHash || '');
  const stepId = String(backendState?.pipeline?.current_step || localPipeline?.current_step || '');
  const anchor = readAuditAnchor();
  const broken = !!(anchor?.chainHash && chainHash && anchor.chainHash !== chainHash);
  return { path: auditAnchorPath(), chainHash, stepId, anchor, broken };
}

/** 用 Pillow 生成 base64 缩略图（规避 webview 资源 URI/CSP 加载失败导致的黑屏） */
async function plotThumbs(paths: string[]): Promise<Record<string, string>> {
  const py = plotPython();
  const script = plotThumbScript();
  const exist = paths.filter((p) => isFile(p));
  if (!exist.length || !isFile(py) || !isFile(script)) return {};
  try {
    const r = await runTool(py, script, exist, 30000);
    return JSON.parse(r.stdout || '{}');
  } catch {
    return {};
  }
}

function isFile(p: string): boolean {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function runTool(py: string, script: string, args: string[], timeoutMs = 120000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    cp.execFile(py, [script, ...args], { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err ? (err as any).code ?? 1 : 0;
        resolve({ code, stdout: stdout || '', stderr: stderr || '' });
      });
  });
}

function figuresDir(ws: string): string {
  return path.join(ws, '结果文件', 'figures');
}

function plotWebviewUri(p: string): string | undefined {
  return viewProvider ? viewProvider.uriFor(p) : undefined;
}

async function handlePlotCheck(): Promise<void> {
  const py = plotPython();
  const script = plotCheckScript();
  if (!isFile(py) || !isFile(script)) {
    postToWebview({ type: 'plotCheckResult', error: '绘图工具未安装（本机缺少 ~/ddj 资产）' });
    return;
  }
  const r = await runTool(py, script, ['--json'], 90000);
  let summary = null;
  try { summary = JSON.parse(r.stdout); } catch { /* 解析失败按原始输出返回 */ }
  postToWebview({ type: 'plotCheckResult', summary, raw: r.stdout || r.stderr, code: r.code });
}

async function handlePlotSamples(outDir: string): Promise<void> {
  const py = plotPython();
  const script = plotCheckScript();
  if (!isFile(py) || !isFile(script)) {
    postToWebview({ type: 'plotSamplesResult', error: '绘图工具未安装（本机缺少 ~/ddj 资产）' });
    return;
  }
  fs.mkdirSync(outDir, { recursive: true });
  const r = await runTool(py, script, ['--render', '--out', outDir, '--json'], 300000);
  let summary = null;
  try { summary = JSON.parse(r.stdout); } catch { /* ignore */ }
  let files: { name: string; path: string; uri?: string }[] = [];
  if (fs.existsSync(outDir)) {
    files = fs.readdirSync(outDir)
      .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .sort()
      .map((f) => {
        const p = path.join(outDir, f);
        return { name: f, path: p, uri: plotWebviewUri(p) };
      });
    const thumbs = await plotThumbs(files.map((f) => f.path));
    files = files.map((f) => (thumbs[f.path] ? { ...f, thumb: thumbs[f.path] } : f));
  }
  postToWebview({ type: 'plotSamplesResult', ok: r.code === 0, files, summary, raw: r.stdout || r.stderr });
}

async function handlePlotGenerate(msg: any): Promise<void> {
  const ws = getWorkspace();
  const py = plotPython();
  const script = plotGenScript();
  if (!isFile(py) || !isFile(script)) {
    postToWebview({ type: 'plotGenerateResult', ok: false, msg: '绘图引擎未安装（缺少 ~/ddj 或脚本）' });
    return;
  }
  const csv = msg.csv?.trim?.() ?? '';
  if (!csv) {
    postToWebview({ type: 'plotGenerateResult', ok: false, msg: '请填写 CSV 文件路径' });
    return;
  }
  if (!isFile(csv)) {
    postToWebview({ type: 'plotGenerateResult', ok: false, msg: `CSV 文件不存在: ${csv}` });
    return;
  }
  const outDir = msg.outDir?.trim() || (ws ? figuresDir(ws) : '');
  if (!outDir) {
    postToWebview({ type: 'plotGenerateResult', ok: false, msg: '未确定输出目录（请先打开工作区）' });
    return;
  }
  const safeName = (msg.name || 'figure').replace(/[^\w.-]/g, '_').replace(/\.+$/, '');
  const ext = msg.format === 'pdf' ? 'pdf' : msg.format === 'svg' ? 'svg' : 'png';
  const outPath = path.join(outDir, `${safeName}.${ext}`);
  const args = [
    '--csv', csv,
    '--type', msg.type || 'scatter',
    '--out', outPath,
    '--width', String(msg.width || 3.5),
    '--height', String(msg.height || 2.6),
    '--dpi', String(msg.dpi || 300),
    '--style', msg.style || 'nature',
    '--palette', msg.palette || 'viridis',
  ];
  if (msg.x) args.push('--x', String(msg.x));
  if (msg.y) args.push('--y', String(msg.y));
  if (msg.group) args.push('--group', String(msg.group));
  if (msg.title) args.push('--title', String(msg.title));
  const r = await runTool(py, script, args, 180000);
  const m = /PLOT_OK:\s*(.+)/.exec(r.stdout);
  if (m) {
    const p = m[1].trim();
    const thumbs = await plotThumbs([p]);
    postToWebview({
      type: 'plotGenerateResult', ok: true, path: p, uri: plotWebviewUri(p),
      thumb: thumbs[p], msg: '生成成功',
    });
  } else {
    const fm = /PLOT_FAIL:\s*(.+)/.exec(r.stdout + '\n' + r.stderr);
    postToWebview({ type: 'plotGenerateResult', ok: false, msg: fm ? fm[1].trim() : (r.stderr || r.stdout || '出图失败') });
  }
}

async function handlePlotList(): Promise<void> {
  const ws = getWorkspace();
  if (!ws) {
    postToWebview({ type: 'plotListResult', files: [], error: '未打开工作区' });
    return;
  }
  const dir = figuresDir(ws);
  let files: { name: string; path: string; uri?: string; ext: string }[] = [];
  if (fs.existsSync(dir)) {
    files = fs.readdirSync(dir)
      .filter((f) => /\.(png|jpg|jpeg|webp|pdf|svg)$/i.test(f))
      .sort()
      .map((f) => {
        const p = path.join(dir, f);
        const previewable = /\.(png|jpg|jpeg|webp)$/i.test(f);
        return { name: f, path: p, ext: path.extname(f).slice(1).toUpperCase(), uri: previewable ? plotWebviewUri(p) : undefined };
      });
    const thumbs = await plotThumbs(files.filter((f) => f.uri).map((f) => f.path));
    files = files.map((f) => (thumbs[f.path] ? { ...f, thumb: thumbs[f.path] } : f));
  }
  postToWebview({ type: 'plotListResult', files });
}

// ── 向当前活跃 Webview 推送消息（视图优先，无则忽略）────────────

function postToWebview(msg: any): void {
  fusionPanel?.webview.postMessage(msg);
  const wv = viewProvider?.webview;
  if (wv) {
    wv.postMessage(msg);
  }
}

// ── Bootstrap（幂等自愈序列）──────────────────────────────────

async function bootstrap(): Promise<void> {
  if (bootstrapDone) return;
  bootstrapDone = true;

  try {
    // 1. 确保 dashboard server 运行
    if (!(await isServerRunning())) {
      startServer();
      for (let i = 0; i < 30; i++) {
        await delay(1000);
        if (await isServerRunning()) break;
      }
    }

    // 2. 写 session token（标准路径握手）
    const ws = getWorkspace();
    writeSessionToken(ws ?? '');

    // 3. 通知后端当前工作区
    if (ws) await setContext(ws);

    // 4. 自愈安装强制层
    enforcement.installAll(ws);

    // 5. 丰富知识库 + 刷新 CLAUDE.md 上下文
    if (ws) {
      kb.enrichWorkspace(ws);
      syncClaudeContext(ws);
    }

    // 6. 若已开视图则推送状态
    pushState();
  } catch (err) {
    console.error('[叮咚鸡] bootstrap failed:', err);
  }
}

function startServer(): void {
  // 新环境稳健性：无后端脚本或无可用的 Python 解释器时静默降级（仪表盘显示后端离线）
  if (!serverScriptExists()) return;
  const py = resolvePython();
  if (!py) return;
  const { spawn } = require('child_process') as typeof import('child_process');
  const child = spawn('/bin/bash', ['-lc', `exec '${py}' '${SERVER_SCRIPT}' --no-browser`], {
    env: { ...process.env, HOME: os.homedir(), DDJ_BUS_DIR: BUS_DIR },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr?.on('data', () => { /* 日志在 /tmp/biomedbus_app.log */ });
}

function writeSessionToken(workspace: string): void {
  const token = {
    skill: 'dingdongji',
    version: '2.0',
    started: Math.floor(Date.now() / 1000),
    workspace,
  };
  try {
    fs.writeFileSync(SESSION_TOKEN_PATH, JSON.stringify(token), 'utf-8');
  } catch { /* ignore */ }
}

function syncClaudeContext(ws: string): void {
  try {
    enforcement.ensureClaudeContext(ws);
  } catch { /* ignore */ }
}

function getWorkspace(): string | undefined {
  const active = vscode.window.activeTextEditor;
  const selected = active && vscode.workspace.getWorkspaceFolder(active.document.uri);
  if (selected) { activeWorkspaceOverride = selected.uri.fsPath; return selected.uri.fsPath; }
  if (activeWorkspaceOverride && fs.existsSync(activeWorkspaceOverride)) return activeWorkspaceOverride;
  // 优先使用当前打开的文件夹
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (ws) return ws;
  // 未打开文件夹时，回退到本机默认维保工作区（设置项 dingdongji.defaultWorkspace）
  const cfg = vscode.workspace.getConfiguration('dingdongji').get<string>('defaultWorkspace', '');
  const expanded = cfg.startsWith('~') ? path.join(os.homedir(), cfg.slice(1)) : cfg;
  return expanded && fs.existsSync(expanded) ? expanded : undefined;
}

function stepLabel(state: pipeline.PipelineState): string {
  const cur = pipeline.getCurrentStep(state);
  return cur ? cur.label : '—';
}

/** 取项目名（工作区 basename 或 manifest.project） */
function projectNameFor(ws: string): string {
  try {
    const mp = path.join(ws, '工程文件', '00_bus_manifest.json');
    if (fs.existsSync(mp)) {
      const m = JSON.parse(fs.readFileSync(mp, 'utf-8'));
      if (m.project) return m.project;
    }
  } catch { /* ignore */ }
  return path.basename(ws);
}

/** 重置确认：三选一（回第一步 / 重新选择研究类型 / 取消） */
async function confirmReset(ws: string): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    '重置管线？',
    { modal: true },
    '↺ 回到第一步',
    '⟲ 重新选择研究类型',
    '取消'
  );
  if (choice === '↺ 回到第一步') {
    const st = pipeline.resetPipeline(ws);
    if (st) {
      syncClaudeContext(ws);
      postToWebview({ type: 'pipelineUpdated', pipeline: st });
      vscode.window.showInformationMessage(`叮咚鸡：已重置到第一步「${stepLabel(st)}」`);
    }
  } else if (choice === '⟲ 重新选择研究类型') {
    pipeline.clearPipeline(ws);
    syncClaudeContext(ws);
    postToWebview({ type: 'pipelineCleared' });
    vscode.window.showInformationMessage('叮咚鸡：管线已清除，请重新选择研究类型');
  }
}

/** 推进一步：校验产出物 → 推进 → 文献步骤后自动摄取 KB */
async function doAdvance(ws: string): Promise<void> {
  // 1. 校验当前步骤产出物（改进 1：推进门槛）
  const before = pipeline.readPipelineState(ws);
  const gate = pipeline.stepCompletionCheck(ws, before);
  const completedStep = gate?.step;
  const completedId = completedStep?.id;

  if (before?.enforcement_mode === 'hard' && gate && gate.missing.length > 0) {
    const preview = gate.missing.slice(0, 3).join('、');
    const suffix = gate.missing.length > 3 ? ` 等 ${gate.missing.length} 项` : '';
    vscode.window.showWarningMessage(`叮咚鸡：硬约束已阻止推进；请先补齐 ${preview}${suffix}`);
    postToWebview({ type: 'pipelineGateBlocked', step: completedStep, missing: gate.missing });
    return;
  }

  // The backend is the sole control plane for a state transition.  This keeps
  // CLI, dashboard and VS Code on the same gate/audit/version semantics.
  const idempotencyKey = `vscode-advance-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const remote = await advancePipeline(Number(before?.state_version || 0), idempotencyKey);
  if (!remote?.ok) {
    const message = remote?.message || remote?.error || '研究控制面不可用；未执行本地降级推进。';
    vscode.window.showWarningMessage(`叮咚鸡：${message}`);
    postToWebview({ type: 'pipelineError', message });
    return;
  }
  const committed = pipeline.readPipelineState(ws);
  if (!committed) {
    const message = '控制面已响应，但本地管线状态未同步；请刷新工作区。';
    vscode.window.showWarningMessage(`叮咚鸡：${message}`);
    postToWebview({ type: 'pipelineError', message });
    return;
  }
  syncClaudeContext(ws);
  try {
    const bs = await getBackendState();
    const chainHash = String(bs?.chain?.chainHash || '');
    if (chainHash) writeAuditAnchor(chainHash, committed.current_step);
  } catch { /* state was committed; anchor refresh can retry later */ }
  postToWebview({ type: 'pipelineUpdated', pipeline: committed });
  vscode.window.showInformationMessage(`叮咚鸡：已进入下一步「${stepLabel(committed)}」`);
}

// ── 消息处理 ──────────────────────────────────────────────────

async function handleMessage(context: vscode.ExtensionContext, msg: any, source: 'sidebar' | 'fusion' = 'fusion'): Promise<void> {
  if (source === 'sidebar' && fusionPanel && !fusionExternal && !['getAll', 'fusionModeStatus', 'fusionMode', 'openFusion'].includes(msg.command)) {
    broadcastFusionMode(); return;
  }
  const ws = getWorkspace();
  if (['fusionOptions', 'fusionDraft', 'fusionSend', 'fusionStop', 'fusionAttach', 'fusionRemoveAttachment', 'fusionManage'].includes(msg.command)
      && (!ws || msg.workspace !== ws || msg.sessionId !== fusionId(ws))) {
    fusionSnapshot(); return;
  }
  switch (msg.command) {
    case 'fusionManuscripts':
    case 'fusionAuthors': {
      const project = getWorkspace();
      const projectScoped = msg.command === 'fusionManuscripts' || msg.action === 'insert';
      if (projectScoped && (!project || msg.workspace !== project)) break;
      const ws = msg.command === 'fusionManuscripts' ? project : path.join(require('os').homedir(), 'ddj', 'submissions');
      if (!ws || !vscode.workspace.isTrusted || fusionManagementLocks.has(ws)) break;
      const panel = fusionPanel, same = () => !!panel && fusionPanel === panel && (!projectScoped || getWorkspace() === project);
      fusionManagementLocks.add(ws); fusionSnapshot();
      try {
        if (msg.command === 'fusionAuthors') fs.mkdirSync(ws, { recursive: true });
        if (msg.command === 'fusionAuthors') {
          const authors = readAuthors(ws);
          if (msg.action === 'add') {
            const name = await vscode.window.showInputBox({ title: '添加全局作者', prompt: '此作者信息可在各项目的投稿管理中使用' }); if (!name?.trim() || !same()) break;
            const affiliation = await vscode.window.showInputBox({ prompt: '单位全称' }); if (affiliation === undefined || !same()) break;
            const orcid = await vscode.window.showInputBox({ prompt: 'ORCID（可留空；不代表已核验）', validateInput: s => s && !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(s) ? '格式应为 0000-0000-0000-0000' : null }); if (orcid === undefined || !same()) break;
            const contribution = await vscode.window.showInputBox({ prompt: '贡献声明（待作者确认，可留空）' }); if (contribution === undefined || !same()) break;
            const corresponding = await vscode.window.showQuickPick(['普通作者', '通讯作者'], { title: '作者身份' }); if (!corresponding || !same()) break;
            authors.push({ name: name.trim(), affiliation, orcid, contribution, corresponding: corresponding === '通讯作者' });
            const file = projectPath(ws, '工程文件/authors.json'); fs.mkdirSync(path.dirname(file), { recursive: true });
            if (fs.existsSync(file)) fs.copyFileSync(file, file + '.' + Date.now() + '.bak', fs.constants.COPYFILE_EXCL);
            fs.writeFileSync(file, JSON.stringify(authors, null, 2));
          } else if (msg.action === 'edit') {
            const file = projectPath(ws, '工程文件/authors.json');
            if (!fs.existsSync(file)) { void vscode.window.showInformationMessage('请先添加作者。'); break; }
            await vscode.window.showTextDocument(vscode.Uri.file(file));
          } else if (msg.action === 'insert') {
            if (!project) break;
            if (!authors.length) { void vscode.window.showInformationMessage('作者库为空，请先添加作者。'); break; }
            const selected = await vscode.window.showQuickPick(authors.map((author, index) => ({ label: author.name, description: author.affiliation, index })), { canPickMany: true, title: '选择本稿作者（按作者库顺序写入，仍需确认署名）' });
            if (!selected?.length || !same()) break;
            const chosenAuthors = authors.filter((_, index) => selected.some(item => item.index === index));
            const chosen = await vscode.window.showQuickPick(manuscriptList(project).filter(f => /\.(md|txt)$/i.test(f)), { title: '选择当前工作区手稿（Markdown/文本）' });
            if (!chosen || !same()) break;
            if (await vscode.window.showWarningMessage('将作者信息导入此手稿？', { modal: true, detail: chosen + '\n保留备份；署名顺序与贡献仍需全体作者确认。' }, '导入') !== '导入' || !same()) break;
            const file = projectPath(project, chosen);
            if (fs.statSync(file).size > 2 * 1024 * 1024) throw new Error('手稿超过 2 MB，请使用编辑器处理');
            if (vscode.workspace.textDocuments.some(d => d.uri.fsPath === file && d.isDirty)) throw new Error('手稿有未保存修改，请先保存');
            const text = fs.readFileSync(file, 'utf8'), block = authorBlock(chosenAuthors);
            const next = /<!-- DDJ AUTHORS START -->[\s\S]*?<!-- DDJ AUTHORS END -->\n?/.test(text) ? text.replace(/<!-- DDJ AUTHORS START -->[\s\S]*?<!-- DDJ AUTHORS END -->\n?/, () => block) : text + '\n\n' + block;
            fs.copyFileSync(file, file + '.' + Date.now() + '.bak', fs.constants.COPYFILE_EXCL); fs.writeFileSync(file, next);
          }
          if (same()) fusionPanel?.webview.postMessage({ type: 'fusionAuthorList', scope: 'global', authors: readAuthors(ws) });
        } else {
          if (!['list', 'preview', 'open'].includes(msg.action)) break;
          const entries = manuscriptList(ws);
          if (same()) fusionPanel?.webview.postMessage({ type: 'fusionManuscriptList', workspace: ws, files: entries });
          if (msg.action === 'list') break;
          if (msg.path !== undefined && (typeof msg.path !== 'string' || !entries.includes(msg.path))) throw new Error('手稿不在当前工作区手稿目录中');
          if (msg.action === 'open') {
            if (msg.path && same()) await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(projectPath(ws, msg.path)));
            break;
          }
          if (!entries.length) { void vscode.window.showInformationMessage('当前工作区暂无手稿，请检查手稿文书或结果文件/manuscript 目录。'); break; }
          const chosen = msg.path || await vscode.window.showQuickPick(entries, { title: '当前工作区手稿 · 人工初审' });
          if (!chosen || !same()) break;
          const file = projectPath(ws, chosen);
          if (/\.(pdf|docx)$/i.test(file)) {
            if (fs.statSync(file).size > 20 * 1024 * 1024) throw new Error('文档超过 20 MB，请用原生编辑器查看');
            const converter = /\.docx$/i.test(file) && process.platform === 'darwin' ? '/usr/bin/textutil' : '/opt/homebrew/bin/pdftotext';
            if (!fs.existsSync(converter) || (/\.docx$/i.test(file) && process.platform !== 'darwin')) { await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file)); void vscode.window.showInformationMessage('本机缺少文本提取器，已请求文件查看器打开。'); break; }
            const args = /\.docx$/i.test(file) ? ['-convert', 'txt', '-stdout', file] : ['-layout', file, '-'];
            const content = await new Promise<string>((resolve, reject) => cp.execFile(converter, args, { timeout: 15000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => err ? reject(new Error('文本提取失败，请使用原生查看器')) : resolve(stdout)));
            if (same()) fusionPanel?.webview.postMessage({ type: 'fusionManuscript', workspace: ws, sourcePath: chosen, path: chosen + '（文本预览，不保留分页与图表）', text: content || '未提取到文本，可能为扫描文件。' });
            break;
          }
          if (fs.statSync(file).size > 2 * 1024 * 1024) throw new Error('手稿超过 2 MB，请在编辑器中打开');
          const draft = vscode.workspace.textDocuments.find(d => d.uri.fsPath === file && d.isDirty);
          if (same()) fusionPanel?.webview.postMessage({ type: 'fusionManuscript', workspace: ws, sourcePath: chosen, path: chosen + (draft ? '（含编辑器未保存修改）' : ''), text: draft ? draft.getText() : fs.readFileSync(file, 'utf8') });
        }
      } catch (error) { void vscode.window.showWarningMessage('手稿/作者操作未完成：' + String(error)); }
      finally { fusionManagementLocks.delete(ws); fusionSnapshot(); }
      break;
    }
    case 'fusionOptions': {
      if (!ws || !vscode.workspace.isTrusted || fusionManagementLocks.has(ws)) break;
      const session = fusionSession(ws), sid = fusionId(ws);
      if (session.busy) break;
      fusionManagementLocks.add(ws); fusionSnapshot();
      try {
        if (msg.action === 'agent') {
          const pick = await vscode.window.showQuickPick([{ label: 'Codex', id: 'codex' as const, description: 'App Server · 独立项目线程' }, { label: 'DeepSeek Harness', id: 'deepseek' as const, description: 'ACP · Harness 原生权限策略' }], { title: '切换当前项目会话的智能体', placeHolder: '保留本会话历史；下一次发送将交接新增内容，不会读取其他项目会话' });
          if (!pick || getWorkspace() !== ws || fusionId(ws) !== sid || session.busy || pick.id === session.agent) break;
          if (await vscode.window.showWarningMessage(`切换至 ${pick.label}？`, { modal: true, detail: '本会话已有消息与附件路径将随下次指令交给所选智能体及其配置的模型服务。不会自动执行任务。DeepSeek Harness 使用其自身权限与审批策略，不继承 Codex 沙箱权限。' }, '切换') !== '切换') break;
          if (getWorkspace() !== ws || fusionId(ws) !== sid || session.busy) break;
          session.switchAgent(pick.id);
          await fusionCache.save(`ddj.fusion:${ws}:${sid}`, { ...session.persist(), attachments: fusionFiles.get(ws) || [] });
          break;
        }
        if (msg.action !== 'permission') await session.inspect();
        if (getWorkspace() !== ws || fusionId(ws) !== sid) break;
        if (msg.action === 'model') {
          const pick = await vscode.window.showQuickPick(session.models.filter(m => typeof m.model === 'string').map(m => ({ label: m.displayName || m.model, description: m.model, model: m.model })), { title: '选择当前会话模型 · 下一条指令生效' });
          if (pick && getWorkspace() === ws && fusionId(ws) === sid) await session.configure('model', pick.model);
        } else if (msg.action === 'effort') {
          const model = session.models.find(m => m.model === session.settings.model);
          if (!model) { void vscode.window.showInformationMessage('请先选择模型，再选择其支持的推理强度。'); break; }
          const pick = await vscode.window.showQuickPick((model.supportedReasoningEfforts || []).map((e: any) => ({ label: e.reasoningEffort, description: e.description, effort: e.reasoningEffort })), { title: '选择模型支持的推理强度' });
          if (pick && getWorkspace() === ws && fusionId(ws) === sid) await session.configure('effort', (pick as any).effort);
        } else if (msg.action === 'permission') {
          if (session.agent === 'deepseek') { void vscode.window.showInformationMessage('DeepSeek Harness 使用本机 ACP 配置中的原生权限策略；本适配器仅转发单次审批，不支持设置 Codex 沙箱。'); break; }
          const pick = await vscode.window.showQuickPick([{ label: '只读', mode: 'read', description: '禁止沙箱写入与网络，不请求提权' }, { label: '项目写入', mode: 'workspace', description: '默认；项目内写入，越界按需批准' }, { label: '完全访问', mode: 'full', description: '危险：解除文件与网络沙箱限制' }], { title: '当前会话权限 · 重新打开会话恢复默认' });
          if (!pick) break;
          if (pick.mode === 'full' && await vscode.window.showWarningMessage('允许此会话完全访问文件系统和网络？', { modal: true, detail: '这将解除沙箱限制，不再保证项目目录隔离；仅用于你信任的任务。' }, '允许完全访问') !== '允许完全访问') break;
          if (getWorkspace() === ws && fusionId(ws) === sid) session.settings.permission = pick.mode as any;
        }
      } catch (error) { void vscode.window.showWarningMessage('智能体选项操作失败：' + String(error)); }
      finally { fusionManagementLocks.delete(ws); fusionSnapshot(); }
      break;
    }
    case 'fusionDraft': {
      if (!ws || typeof msg.text !== 'string' || msg.text.length > 32000) break;
      const key = fusionDraftKey(ws, msg.sessionId); fusionDraftCache.set(key, msg.text);
      await fusionCache.save(key, msg.text).catch(() => {}); break;
    }
    case 'fusionInteractionAck': {
      const pending = pendingInteractions.get(String(msg.requestId || ''));
      if (pending) { pending.acked = true; pending.ackResolve?.(true); }
      break;
    }
    case 'fusionAskUserResponse':
    case 'fusionApprovalResponse': {
      const requestId = String(msg.requestId || '');
      const pending = pendingInteractions.get(requestId);
      if (!pending) {
        // 卡片可能来自已重载的窗口或已超时的请求；明确告知而不是静默无响应。
        fusionPanel?.webview.postMessage({ type: 'fusionError', workspace: msg.workspace || '', sessionId: msg.sessionId || '', message: '交互请求已失效（可能已超时或窗口已重载）；请让智能体重新发起。' });
        break;
      }
      if (!ws || pending.workspace !== ws) break;
      if (msg.cancelled) settleInteraction(requestId, pending.empty);
      else if (pending.kind === 'ask') settleInteraction(requestId, { answers: sanitizeAskAnswers(msg.answers, pending.questions) });
      else settleInteraction(requestId, sanitizeApprovalOutcome(msg.outcome, pending.options));
      break;
    }
    case 'openFusion': openFusion(); break;
    case 'fusionModeStatus': broadcastFusionMode(); break;
    case 'fusionCheck': {
      const backend = await isServerRunning();
      fusionPanel?.webview.postMessage({ type: 'fusionCheckResult', requestId: msg.requestId, workspace: ws || '', backend, trusted: vscode.workspace.isTrusted, codexInstalled: !!vscode.extensions.getExtension('openai.chatgpt'), checkedAt: new Date().toLocaleTimeString() });
      break;
    }
    case 'fusionMode': {
      if (!msg.external) { openFusion(); break; }
      if (fusionSwitchPending) break;
      const epoch = ++fusionSwitchEpoch; fusionSwitchPending = true; broadcastFusionMode();
      const opened = await openCodexSidebar();
      if (epoch !== fusionSwitchEpoch) break;
      fusionSwitchPending = false;
      if (opened) fusionExternal = true;
      broadcastFusionMode(opened ? '外挂窗口已打开；内置会话保留，两边历史不会自动合并。' : '未能打开外挂 Codex，已保留当前模式。');
      break;
    }
    case 'fusionAttach': {
      const selectedSession = ws ? fusionId(ws) : '';
      if (!ws || msg.workspace !== ws || !vscode.workspace.isTrusted) break;
      const files = await vscode.window.showOpenDialog({ canSelectMany: true, defaultUri: vscode.Uri.file(ws), openLabel: '附加到当前对话' });
      if (getWorkspace() !== ws || fusionId(ws) !== selectedSession) break;
      const accepted = files?.filter(f => f.scheme === 'file' && fs.statSync(f.fsPath).isFile() && fs.statSync(f.fsPath).size <= 20 * 1024 * 1024).map(f => f.fsPath) || [];
      fusionFiles.set(ws, [...new Set([...(fusionFiles.get(ws) || []), ...accepted])].slice(0, 10)); fusionSnapshot(); break;
    }
    case 'fusionRemoveAttachment': {
      if (ws && msg.workspace === ws) { fusionFiles.set(ws, (fusionFiles.get(ws) || []).filter(f => f !== msg.path)); fusionSnapshot(); } break;
    }
    case 'fusionManage': {
      if (!ws || fusionManagementLocks.has(ws)) { fusionSnapshot(); break; }
      fusionManagementLocks.add(ws);
      fusionSnapshot();
      try {
      if (!ws || msg.workspace !== ws) break;
      const current = fusionSession(ws); const entries = fusionIndex(ws);
      const selectedSession = fusionId(ws);
      let selectedRole = 'research';
      if (msg.action === 'new') {
        if (current.busy) { void vscode.window.showInformationMessage('请等待当前执行完成或先停止，再新建会话。'); break; }
        const choice = await vscode.window.showQuickPick(researchRoles.map(role => ({ label: role.label, description: role.description, detail: role.skills.length ? role.skills.map(name => `${name} · ${fs.existsSync(roleSkillPath(name)) ? '已安装' : '未安装'}`).join(' / ') : '延续项目研究工作流', role: role.id })), { title: '新建项目会话 · 选择角色', placeHolder: '角色仅作用于新会话，不改动已有对话' });
        if (!choice || getWorkspace() !== ws || fusionId(ws) !== selectedSession || current.busy) break;
        selectedRole = choice.role;
      }
      if (!entries.some(e => e.id === fusionId(ws))) entries.push({ id: fusionId(ws), title: '初始会话' });
      if (msg.action === 'rename') {
        const title = await vscode.window.showInputBox({ prompt: '会话名称', value: entries.find(e => e.id === fusionId(ws))?.title });
        if (getWorkspace() !== ws || fusionId(ws) !== selectedSession) break;
        if (title?.trim()) { const entry = entries.find(e => e.id === fusionId(ws)); if (entry) entry.title = title.trim().slice(0, 100); }
      } else if (msg.action === 'export') {
        const exported = JSON.stringify({ ...current.snapshot(), ...current.persist(), sessionId: selectedSession, role: researchRole(entries.find(entry => entry.id === selectedSession)?.role).id, attachments: fusionFiles.get(ws) || [], draft: readFusionDraft(ws, selectedSession) }, null, 2);
        const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(ws, '叮咚鸡会话.json')), filters: { JSON: ['json'] } });
        if (uri && getWorkspace() === ws && fusionId(ws) === selectedSession) await vscode.workspace.fs.writeFile(uri, Buffer.from(exported));
      } else {
        if (current.busy) { fusionPanel?.webview.postMessage({ type: 'fusionError', workspace: ws, sessionId: selectedSession, message: '请先停止当前任务或等待完成，再切换会话。' }); break; }
        if (msg.action === 'delete') {
          const entry = entries.find(e => e.id === selectedSession);
          const confirm = await vscode.window.showWarningMessage(`移除会话「${entry?.title || '当前会话'}」？`, { modal: true, detail: '从叮咚鸡会话列表移入回收区，可通过恢复按钮找回。Codex 原始线程与项目文件保留。' }, '移入回收区');
          if (!confirm || getWorkspace() !== ws || fusionId(ws) !== selectedSession || current.busy) break;
          if (entry) entry.deletedAt = Date.now();
        }
        await fusionCache.save(`ddj.fusion:${ws}:${selectedSession}`, { ...current.persist(), attachments: fusionFiles.get(ws) || [] });
        if (getWorkspace() !== ws || fusionId(ws) !== selectedSession || current.busy) break;
        if (msg.action === 'archive') { const e = entries.find(e => e.id === fusionId(ws)); if (e) e.archived = !e.archived; }
        let id = String(msg.id || '');
        if (msg.action === 'archive') id = selectedSession;
        if (msg.action === 'restore') {
          const deleted = entries.filter(e => e.deletedAt).sort((a,b) => b.deletedAt! - a.deletedAt!);
          if (!deleted.length) { void vscode.window.showInformationMessage('当前项目的回收区为空。'); break; }
          const choice = await vscode.window.showQuickPick(deleted.map(entry => ({ label: entry.title, description: researchRole(entry.role).label, detail: new Date(entry.deletedAt!).toLocaleString(), id: entry.id })), { title: '恢复当前项目的会话' });
          if (!choice || getWorkspace() !== ws || fusionId(ws) !== selectedSession || current.busy) break;
          const entry = entries.find(e => e.id === choice.id)!; delete entry.deletedAt; id = entry.id;
        }
        if (msg.action === 'delete') id = entries.find(e => !e.deletedAt && !e.archived)?.id || '';
        if (msg.action === 'new' || (msg.action === 'delete' && !id)) { id = `${Date.now()}-${Math.random().toString(36).slice(2)}`; entries.push({ id, title: `${researchRole(selectedRole).label} · ${new Date().toLocaleTimeString()}`, role: selectedRole }); }
        if (!entries.some(e => e.id === id && !e.deletedAt)) break;
        await fusionContext.workspaceState.update(`ddj.threads:${ws}`, entries);
        await fusionContext.workspaceState.update(`ddj.selected:${ws}`, id);
        fusionSessions.delete(ws); current.dispose(); fusionFiles.delete(ws); fusionIds.set(ws, id);
        fusionSession(ws);
      }
      await fusionContext.workspaceState.update(`ddj.threads:${ws}`, entries); fusionSnapshot();
      } catch (error) { void vscode.window.showWarningMessage('会话操作未完成，原记录保留：' + String(error)); }
      finally { fusionManagementLocks.delete(ws); fusionSnapshot(); }
      break;
    }
    case 'fusionStatus': if (ws) fusionSession(ws); fusionSnapshot(); break;
    case 'fusionSend': {
      if (ws && fusionManagementLocks.has(ws)) { fusionSnapshot(); break; }
      if (fusionExternal || fusionSwitchPending) { broadcastFusionMode('请切回内置模式后发送。'); fusionSnapshot(); break; }
      if (ws && msg.sessionId !== fusionId(ws)) { fusionSnapshot(); break; }
      if (!ws || !vscode.workspace.isTrusted) { fusionPanel?.webview.postMessage({ type: 'fusionError', workspace: ws || '', sessionId: msg.sessionId, message: '请打开并信任科研项目工作区。' }); break; }
      if (msg.workspace !== ws) { fusionSnapshot(); break; }
      const text = String(msg.text || '').trim();
      if (!text || text.length > 32000) break;
      const brief = pipeline.readPipelineState(ws)?.scenario === 'software_development'
        ? `当前为软件维护项目 ${ws}。读取 AGENTS.md 和管线状态，按用户任务进行维护；科研立项请先明确科研项目。`
        : researchAgentBrief(ws, ['questions', 'plans', 'results', 'continuation'].includes(msg.stage) ? msg.stage : 'questions');
      const attachments = (fusionFiles.get(ws) || []).filter(f => fs.existsSync(f)).map(f => ({ path: f, image: /\.(png|jpe?g|webp|gif)$/i.test(f) }));
      const sendingId = fusionId(ws);
      try {
        const accepted = await fusionSession(ws).send(text, `${brief}\n\n${roleBrief(fusionIndex(ws).find(entry => entry.id === sendingId)?.role)}`, attachments);
        if (accepted) {
          if (readFusionDraft(ws, sendingId).trim() === text) {
            const key = fusionDraftKey(ws, sendingId); fusionDraftCache.set(key, '');
            await fusionCache.save(key, '');
          }
          if (fusionId(ws) === sendingId) fusionFiles.set(ws, (fusionFiles.get(ws) || []).filter(f => !attachments.some(a => a.path === f)));
          fusionPanel?.webview.postMessage({ type: 'fusionAccepted', workspace: ws, sessionId: sendingId, text });
        }
        fusionSnapshot();
      } catch (e) { fusionPanel?.webview.postMessage({ type: 'fusionError', workspace: ws, sessionId: sendingId, message: String(e) }); }
      await handleMessage(context, { command: 'getAll' });
      break;
    }
    case 'fusionStop': {
      if (ws && msg.workspace === ws) {
        cancelPendingInteractions(ws);
        try { await fusionSessions.get(ws)?.stop(); } catch (e) { fusionPanel?.webview.postMessage({ type: 'fusionError', workspace: ws, sessionId: msg.sessionId, message: String(e) }); }
      }
      break;
    }
    case 'getAll': {
      const status = await getStatus();
      const backendState = await getBackendState();
      const acts = await getActivityLog();
      let pl = null;
      let projectName = '';
      let handoffInfo = null;
      if (ws) {
        pl = pipeline.readPipelineState(ws);
        handoffInfo = handoff.readHandoff(ws);
        const prj = status?.mod_f?.items?.[0];
        if (prj && prj.name && prj.name !== '未扫描工作区') projectName = prj.name;
      }
      const scenarioList = pipeline.SCENARIO_LIST;
      const kbEntries = kb.readIndex().entries;
      const literature = await getLiteratureList();
      const runs = await getRuns();
      const ideas = await getIdeas();
      const conclusionState = await getConclusionsState();
      const conclusions = conclusionState.conclusions;
      const questionClusters = await getQuestionClusters();
      const researchPlans = await getResearchPlans();
      const continuations = await getResearchContinuations();
      continuations.schedule = await getSchedule();
      const apiInventory = await getApiInventory();
      // 每条引用的跨库核验状态（auto=1 让后端自动补齐缺失/过期核验）
      const citations = ws ? await getCitationStatus(true) : null;
      renderCitationStatusBar(citations);
      if (citations?.status === 'pending') scheduleCitationPoll();
      let projectLib = null;
      if (ws) {
        kb.ensureProjectLibrary(ws);
        projectLib = kb.listProjectLibrary(ws);
      }
      const digest = readDigest();
      const anchor = auditAnchorStatus(backendState, pl);
      const preferences = context.globalState.get<Record<string, string>>('ddj.preferences', {});
      if (getWorkspace() !== ws) return; // Discard a late response for the previous project.
      // Codex 融合状态（官方 Codex 扩展 + 工作区 AGENTS.md / 管线上下文 / skills）
      const codexFusion: any = getCodexFusionState(ws || undefined);
      try {
        if (ws) {
          const ctxPath = path.join(ws, '叮咚鸡_pipeline_context.md');
          codexFusion.contextMtime = fs.existsSync(ctxPath) ? Math.floor(fs.statSync(ctxPath).mtimeMs) : 0;
          codexFusion.agentsMd = fs.existsSync(path.join(ws, 'AGENTS.md'));
          codexFusion.claudeMd = fs.existsSync(path.join(ws, 'CLAUDE.md'));
        }
        codexFusion.ddjCli = fs.existsSync(path.join(os.homedir(), 'ddj', 'tools', 'ddj.py'));
      } catch { /* ignore */ }
      // 扩展工具（智能体自动注册的 MCP/Skill/CLI，存于 ~/ddj/dingdongji/ext_tools.json）
      let extTools: string[] = [];
      try {
        const etFile = path.join(os.homedir(), 'ddj', 'ext_tools.json');
        if (fs.existsSync(etFile)) {
          const et = JSON.parse(fs.readFileSync(etFile, 'utf-8'));
          extTools = (et.tools || []).map((t: any) => `${t.kind === 'skill' ? '🧠' : '🔌'} ${t.name}${t.desc ? ' · ' + t.desc : ''}`);
        }
      } catch { /* ignore */ }
      postToWebview({ type: 'state', workspacePath: ws || '', status, backendState, activities: acts, pipeline: pl, projectName, scenarioList, kbEntries, projectLib, literature, runs, ideas, conclusions, conclusionError: conclusionState.error, questionClusters, researchPlans, continuations, apiInventory, citations, digest, handoff: handoffInfo, anchor, preferences, extTools, codexFusion });
      break;
    }
    case 'setPreference': {
      // 保存设置（主题/语言/默认智能体）
      if (!context?.globalState) return;
      const prefs = context.globalState.get<Record<string, string>>('ddj.preferences', {});
      prefs[String(msg.key || '')] = String(msg.value || '');
      await context.globalState.update('ddj.preferences', prefs);
      break;
    }
    case 'ideaCreate': {
      try {
        const result = await createIdea(String(msg.text || ''), msg.parentId ? String(msg.parentId) : undefined);
        postToWebview({ type: 'ideaResult', result });
      } catch (e) { postToWebview({ type: 'ideaResult', result: { ok: false, message: String(e) } }); }
      break;
    }
    case 'ideaSelect': {
      try {
        const result = await selectIdea(String(msg.ideaId || ''), String(msg.rationale || ''));
        postToWebview({ type: 'ideaResult', result });
      } catch (e) { postToWebview({ type: 'ideaResult', result: { ok: false, message: String(e) } }); }
      break;
    }
    case 'conclusionUpsert': {
      try {
        const evidence = Array.isArray(msg.evidence) ? msg.evidence : [];
        const result = await upsertConclusion(String(msg.statement || ''), evidence, String(msg.status || 'candidate'), msg.id ? String(msg.id) : undefined);
        postToWebview({ type: 'conclusionResult', result });
      } catch (e) { postToWebview({ type: 'conclusionResult', result: { ok: false, message: String(e) } }); }
      break;
    }
    case 'conclusionReconcile': {
      try {
        const result = await reconcileConclusions();
        postToWebview({ type: 'conclusionReconcileResult', result });
      } catch (e) { postToWebview({ type: 'conclusionReconcileResult', result: { ok: false, message: String(e) } }); }
      break;
    }
    case 'conclusionTrace': {
      try {
        const result = await getConclusionTrace(String(msg.id || ''));
        postToWebview({ type: 'conclusionTraceResult', id: String(msg.id || ''), result });
      } catch (e) { postToWebview({ type: 'conclusionTraceResult', id: String(msg.id || ''), result: { ok: false, message: String(e) } }); }
      break;
    }
    case 'questionClusterCreate': {
      try {
        const questions = Array.isArray(msg.questions) ? msg.questions : [];
        const result = await createQuestionCluster(String(msg.title || ''), questions, msg.ideaId ? String(msg.ideaId) : undefined, String(msg.rationale || ''));
        postToWebview({ type: 'questionClusterResult', result });
      } catch (e) { postToWebview({ type: 'questionClusterResult', result: { ok: false, message: String(e) } }); }
      break;
    }
    case 'researchPlanCreate': {
      try {
        const tasks = Array.isArray(msg.tasks) ? msg.tasks : [];
        const result = await createResearchPlan(String(msg.title || ''), String(msg.clusterId || ''), tasks, String(msg.rationale || ''));
        postToWebview({ type: 'researchPlanResult', result });
      } catch (e) { postToWebview({ type: 'researchPlanResult', result: { ok: false, message: String(e) } }); }
      break;
    }
    case 'continuationCreate': {
      try {
        const result = await createResearchContinuation(String(msg.kind || ''), String(msg.title || ''), String(msg.notes || ''), String(msg.conclusionId || ''));
        postToWebview({ type: 'continuationResult', result });
      } catch (e) { postToWebview({ type: 'continuationResult', result: { ok: false, error: String(e) } }); }
      break;
    }
    case 'planBindPipeline': {
      try {
        const result = await bindPlanPipeline(String(msg.planId || ''), Number(msg.expectedVersion));
        postToWebview({ type: 'planBindingResult', result });
      } catch (e) { postToWebview({ type: 'planBindingResult', result: { ok: false, error: String(e) } }); }
      break;
    }
    case 'startPipeline': {
      if (!ws) return;
      const projectName = msg.projectName || path.basename(ws);
      const st = pipeline.createPipeline(ws, msg.scenario, projectName);
      if (!st) {
        // 改进 5：非研究项目目录
        postToWebview({ type: 'pipelineError', message: '当前工作区不是研究项目（缺少 工程文件/ 或 结果文件/）。请先在项目目录中打开 VSCode，或创建项目结构。' });
        return;
      }
      syncClaudeContext(ws);
      postToWebview({ type: 'pipelineUpdated', pipeline: st });
      break;
    }
    case 'agentStartPipeline': {
      // 智能体自主创建管线：传入研究描述（自然语言），自动匹配场景
      if (!ws) return;
      const desc = String(msg.description || msg.scenario || '');
      if (!desc) {
        postToWebview({ type: 'pipelineError', message: 'agentStartPipeline 需要 description（研究描述）' });
        return;
      }
      // 若显式传了 scenario id 则直接用；否则自动匹配
      let scenario = String(msg.scenario || '');
      let matched = false;
      if (!SCENARIOS_IDS.includes(scenario)) {
        const m = pipeline.matchScenario(desc);
        scenario = m.scenario;
        matched = m.matched;
      } else {
        matched = true;
      }
      if (!scenario || !matched) {
        postToWebview({
          type: 'pipelineError',
          message: `叮咚鸡智能体无法自动识别研究场景：「${desc}」。可用场景：${SCENARIOS_IDS.join(' / ')}。请让智能体明确研究类型，或指定场景 id。`,
        });
        return;
      }
      const projectName = msg.projectName || path.basename(ws);
      const st = pipeline.createPipeline(ws, scenario, projectName);
      if (!st) {
        postToWebview({ type: 'pipelineError', message: '当前工作区不是研究项目（缺少 工程文件/ 或 结果文件/）。' });
        return;
      }
      const scenarioLabel = pipeline.SCENARIO_LIST.find((s) => s.id === scenario)?.label ?? scenario;
      syncClaudeContext(ws);
      postToWebview({ type: 'pipelineUpdated', pipeline: st, agentAutoStarted: true, scenarioLabel });
      vscode.window.showInformationMessage(`叮咚鸡：智能体已自动创建管线「${scenarioLabel}」`);
      break;
    }
    case 'advance': {
      if (!ws) return;
      await doAdvance(ws);
      break;
    }
    case 'rollback': {
      if (!ws) return;
      const st = pipeline.rollbackStep(ws);
      if (st) { syncClaudeContext(ws); postToWebview({ type: 'pipelineUpdated', pipeline: st }); }
      break;
    }
    case 'reset': {
      if (!ws) return;
      const st = pipeline.resetPipeline(ws);
      if (st) { syncClaudeContext(ws); postToWebview({ type: 'pipelineUpdated', pipeline: st }); }
      break;
    }
    case 'requestReset': {
      if (!ws) return;
      await confirmReset(ws);
      break;
    }
    case 'setMode': {
      if (!ws) return;
      const st = pipeline.setEnforcementMode(ws, msg.mode);
      if (st) { syncClaudeContext(ws); postToWebview({ type: 'pipelineUpdated', pipeline: st }); }
      break;
    }
    // ── 动态待办计划编辑（模板仅参考） ──
    case 'addStep': {
      if (!ws) return;
      const label = await vscode.window.showInputBox({
        prompt: '添加自定义步骤：输入步骤名称',
        placeHolder: '例：补充数据提取 / 二次检索 / 敏感性分析',
        ignoreFocusOut: true,
      });
      if (!label) break;
      const st = pipeline.addStep(ws, msg.afterId ?? null, label, msg.opts || {});
      if (st) { syncClaudeContext(ws); postToWebview({ type: 'pipelineUpdated', pipeline: st }); }
      break;
    }
    case 'removeStep': {
      if (!ws) return;
      if (!msg.stepId) break;
      const st = pipeline.removeStep(ws, msg.stepId);
      if (st) { syncClaudeContext(ws); postToWebview({ type: 'pipelineUpdated', pipeline: st }); }
      break;
    }
    case 'moveStep': {
      if (!ws) return;
      if (!msg.stepId) break;
      const st = pipeline.moveStep(ws, msg.stepId, msg.dir === 'up' ? -1 : 1);
      if (st) { syncClaudeContext(ws); postToWebview({ type: 'pipelineUpdated', pipeline: st }); }
      break;
    }
    case 'refresh': {
      await handleMessage(context, { command: 'getAll' });
      break;
    }
    case 'setWorkspace': {
      const target = String(msg.path || '').trim();
      if (!target || !fs.existsSync(target)) {
        postToWebview({ type: 'workspaceSetResult', ok: false, message: '工作区路径不存在' });
        break;
      }
      activeWorkspaceOverride = target;
      writeSessionToken(target);
      await setContext(target);
      syncClaudeContext(target);
      postToWebview({ type: 'workspaceSetResult', ok: true, message: `已绑定工作区：${target}` });
      await handleMessage(context, { command: 'getAll' });
      break;
    }
    case 'pauseProject': {
      if (!ws) return;
      const content = await vscode.window.showInputBox({
        prompt: '暂停项目：填写交接内容（进展/待办/遗留问题），供下一位 Claude 接手',
        placeHolder: '例：已完成文献检索与筛选，纳入 12 篇；下一步做 Meta 分析……',
        ignoreFocusOut: true,
      });
      if (content === undefined) return;
      const p = handoff.writeHandoff(ws, content || '（未填写具体交接内容，以管线状态快照为准）');
      syncClaudeContext(ws);
      vscode.window.showInformationMessage(`叮咚鸡：已生成交接班 → ${p}`);
      await handleMessage(context, { command: 'getAll' });
      break;
    }
    case 'resumeProject': {
      if (!ws) return;
      const info = handoff.readHandoff(ws);
      if (!info.exists) {
        vscode.window.showInformationMessage('叮咚鸡：无交接班文件。');
        await handleMessage(context, { command: 'getAll' });
        break;
      }
      if (info.path) vscode.window.showTextDocument(vscode.Uri.file(info.path));
      const choice = await vscode.window.showInformationMessage(
        '叮咚鸡：检测到交接班文件。接手后是否标记为已处理？', { modal: true }, '标记已处理', '保留'
      );
      if (choice === '标记已处理') {
        handoff.clearHandoff(ws);
        syncClaudeContext(ws);
        vscode.window.showInformationMessage('叮咚鸡：交接班已标记处理，继续工作。');
      }
      await handleMessage(context, { command: 'getAll' });
      break;
    }
    case 'scan': {
      if (!ws) return;
      const r = kb.enrichWorkspace(ws);
      syncClaudeContext(ws);
      postToWebview({ type: 'kbUpdated', result: r });
      await handleMessage(context, { command: 'getAll' });
      break;
    }
    case 'kbSearch': {
      const entries = kb.searchEntries(msg.query || '', msg.type || undefined, msg.scope || undefined, ws);
      postToWebview({ type: 'kbResults', entries });
      break;
    }
    case 'kbAdd': {
      if (!ws) return;
      // 审计记录 / 审稿意见 → 追加到项目资料库独立文件（工程文件/kb/audit_records.md / review_comments.md）
      if (msg.type === 'audit' || msg.type === 'review') {
        const saved = kb.appendAuditReview(ws, msg.type, msg.title || '未命名记录', msg.body || '');
        kb.regenerateDigest(ws);
        postToWebview({ type: 'kbSaved', path: saved, scope: 'project' });
        break;
      }
      // 知识库写入策略（2026-08-10 修复）：默认写项目库；
      // 仅 叮咚鸡本体调整/全局可复用经验教训(lesson)/新工具注册 且显式指定 global 时写全局库（需用户授权）。
      const scope = (msg.scope === 'global' && kb.isGlobalWritable({ type: msg.type, title: msg.title, source: msg.source, tags: msg.tags }))
        ? 'global'
        : 'project';
      if (scope === 'global') {
        const authorize = await vscode.window.showInformationMessage(
          `将「${msg.title || '未命名笔记'}」写入【全局知识库】（跨项目可复用，所有 Claude 窗口可见）。是否授权？`,
          { modal: true }, '授权写入', '取消'
        );
        if (authorize !== '授权写入') {
          postToWebview({ type: 'kbDenied', title: msg.title });
          return;
        }
      }
      const saved = kb.upsertEntryBody(msg.subdir || 'learnings', msg.fileName || `${Date.now()}.md`, msg.body || '', {
        type: msg.type || 'learning',
        title: msg.title || '未命名笔记',
        source: '手动',
        tags: msg.tags || [],
        project: scope === 'project' ? (msg.project || projectNameFor(ws)) : undefined,
        scope,
      }, ws);
      kb.regenerateDigest(ws);
      postToWebview({ type: 'kbSaved', path: saved, scope });
      break;
    }
    case 'openFile': {
      if (msg.path && fs.existsSync(msg.path)) {
        vscode.window.showTextDocument(vscode.Uri.file(msg.path));
      }
      break;
    }
    case 'openClaude': {
      try {
        await vscode.commands.executeCommand('claude-vscode.primaryEditor.open');
      } catch {
        vscode.commands.executeCommand('workbench.action.terminal.new');
      }
      break;
    }
    case 'openCodex': {
      await openCodexSidebar();
      break;
    }
    case 'openCodexContext': {
      if (!ws) {
        vscode.window.showWarningMessage('叮咚鸡：请先绑定项目工作区。');
        break;
      }
      await openCodexWithProjectContext(ws, typeof msg.researchBrief === 'string' ? msg.researchBrief : undefined);
      break;
    }
    case 'researchAgent': {
      if (!ws) { vscode.window.showWarningMessage('请先绑定研究项目，再开始对话。'); break; }
      try {
        const opened = await openCodexWithProjectContext(ws, researchAgentBrief(ws, String(msg.stage || 'questions')));
        postToWebview(opened ? { type: 'researchAgentReady' } : { type: 'researchAgentError', message: '未能打开 Codex，请检查扩展是否已安装并可用。' });
      } catch (error) { postToWebview({ type: 'researchAgentError', message: String(error) }); }
      break;
    }
    case 'scheduleControl': {
      const action = String(msg.action || '');
      let cloudAuthorized = false;
      let taskDigest: string | undefined;
      if (action === 'start') {
        let preview;
        try { preview = await previewSchedule(String(msg.planId || '')); }
        catch { vscode.window.showErrorMessage('无法读取任务与输入范围，未启动。'); break; }
        if (!preview.ok) { vscode.window.showErrorMessage('计划任务不可用，未启动。'); break; }
        cloudAuthorized = preview.model_required === true;
        taskDigest = preview.task_digest;
        const files = preview.tasks.flatMap((task: any) => task.input_contract?.files || []);
        const message = cloudAuthorized ? `启动智能体任务？使用 Codex CLI 自身登录，忽略用户可选配置；可能消耗模型额度，并将任务及所列文件发送给模型服务。CLI 沙箱不是独立容器。输入：${files.join('、')}。结论仅自动保存为候选，不推进管线。` : '启动本地调度？统计任务可能更新统计报告文件，不调用云模型或推进管线。';
        const approved = await vscode.window.showWarningMessage(message, { modal: true }, '启动');
        if (approved !== '启动') break;
      }
      try { postToWebview({ type: 'scheduleResult', result: await controlSchedule(action, msg.planId, msg.version, cloudAuthorized, taskDigest) }); }
      catch (error) { postToWebview({ type: 'scheduleResult', result: { ok: false, error: String(error) } }); }
      break;
    }
    case 'plotCheck': {
      await handlePlotCheck();
      break;
    }
    case 'plotSamples': {
      await handlePlotSamples(msg.outDir || '/tmp/ddj_plot_samples');
      break;
    }
    case 'plotGenerate': {
      await handlePlotGenerate(msg);
      break;
    }
    case 'plotList': {
      await handlePlotList();
      break;
    }
    case 'figureAudit': {
      const useAi = !!msg.ai;
      if (useAi) {
        const ok = await vscode.window.showWarningMessage(
          '图片 AI 审计会把 结果文件/figures 中的图片缩略图发送给已配置的视觉服务。是否继续？',
          { modal: true },
          '开始审计',
          '仅本地规则'
        );
        if (ok !== '开始审计') {
          postToWebview({ type: 'figureAuditResult', result: await auditFigures(false), ai: false });
          break;
        }
      }
      postToWebview({ type: 'figureAuditResult', result: await auditFigures(useAi), ai: useAi });
      break;
    }
    case 'statsReport': {
      const result = await statsReport();
      postToWebview({ type: 'statsReportResult', result });
      if (result?.ok && result?.path) vscode.window.showInformationMessage(`叮咚鸡：统计报告已生成 → ${result.path}`);
      break;
    }
    case 'citationAudit': {
      await triggerCitationAudit(msg.force === true);
      break;
    }
    case 'citationRefresh': {
      await refreshCitationStatus(true, true);
      break;
    }
    case 'plotOpen': {
      if (msg.path && fs.existsSync(msg.path)) {
        vscode.window.showTextDocument(vscode.Uri.file(msg.path));
      }
      break;
    }
    default:
      break;
  }
}

function readDigest(): string {
  try {
    const p = path.join(kb.KB_ROOT, '_digest.md');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  } catch { return ''; }
}

// ── 引用跨库核验（后端权威，扩展只请求/触发/展示）──────────────
// 每条引用由后端在 PubMed + Crossref 两个独立库核对；扩展不参与判定，
// 也不因本地展示而放宽后端 fail-closed 结论。

function isReferenceBearingFile(rel: string): boolean {
  const f = rel.split(path.sep).join('/').toLowerCase();
  if (/\.(ris|bib)$/.test(f)) return true;
  const inManuscript = f.startsWith('手稿文书/') || f.startsWith('结果文件/manuscript/') || f.includes('/manuscript/');
  return inManuscript && /\.(md|txt|tex)$/.test(f);
}

function renderCitationStatusBar(status: CitationStatus | null): void {
  if (!citationStatusItem) return;
  if (!status || status.status === 'error') {
    if (status?.status === 'error') {
      citationStatusItem.text = '$(book) 引用核验 离线';
      citationStatusItem.tooltip = '后端引用核验不可用：' + (status.error || '未知错误');
      citationStatusItem.backgroundColor = undefined;
      citationStatusItem.show();
    } else {
      citationStatusItem.hide();
    }
    return;
  }
  if (!status.reference_count) {
    citationStatusItem.text = '$(book) 引用 0';
    citationStatusItem.tooltip = '当前项目尚未发现可核验引用';
    citationStatusItem.backgroundColor = undefined;
  } else if (status.passed) {
    citationStatusItem.text = `$(verified) 引用 ${status.reference_count}/${status.reference_count}`;
    citationStatusItem.tooltip = '全部引用已由两个独立数据库交叉核验通过';
    citationStatusItem.backgroundColor = undefined;
  } else {
    const c = status.counts || {};
    const bad = (c.conflict || 0) + (c.not_found || 0) + (c.needs_review || 0) + (c.unavailable || 0);
    citationStatusItem.text = `$(warning) 引用 ${Math.max(0, status.reference_count - bad)}/${status.reference_count}`;
    citationStatusItem.tooltip = `跨库核验未全部通过（${status.status}）：冲突 ${c.conflict || 0} · 未找到 ${c.not_found || 0} · 待审 ${c.needs_review || 0} · 不可用 ${c.unavailable || 0} · 待完成 ${c.pending || 0}`;
    citationStatusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  citationStatusItem.command = 'ddj.openPanel';
  citationStatusItem.show();
}

/** Poll while the backend works through a queued audit, then stop. */
function scheduleCitationPoll(): void {
  if (citationPollTimer) return;
  let attempts = 0;
  citationPollTimer = setInterval(async () => {
    attempts += 1;
    const status = await getCitationStatus(false);
    renderCitationStatusBar(status);
    if (status) postToWebview({ type: 'citationResult', status });
    const finished = !status || status.status !== 'pending' || attempts >= 40;
    if (finished) { clearInterval(citationPollTimer as NodeJS.Timeout); citationPollTimer = null; }
  }, 3000);
}

/** Explicit re-verification (manual button / manuscript save). */
async function triggerCitationAudit(force = false): Promise<void> {
  if (citationAuditInFlight) return;
  citationAuditInFlight = true;
  try {
    const status = await runCitationAudit(force);
    renderCitationStatusBar(status);
    postToWebview({ type: 'citationResult', status });
    if (status?.status === 'pending') scheduleCitationPoll();
  } finally {
    citationAuditInFlight = false;
  }
}

/** Read current verification state; ``auto`` lets the backend queue a stale audit. */
async function refreshCitationStatus(auto = true, push = true): Promise<CitationStatus | null> {
  const ws = getWorkspace();
  if (!ws) { renderCitationStatusBar(null); return null; }
  const status = await getCitationStatus(auto);
  renderCitationStatusBar(status);
  if (push && status) postToWebview({ type: 'citationResult', status });
  if (status?.status === 'pending') scheduleCitationPoll();
  return status;
}

function pushState(): void {
  if (viewProvider?.webview) {
    handleMessage(viewProvider.context, { command: 'getAll' });
  }
}

// ── 实时管线轮询（改进2：Claude 自主推进的实时可视化） ──────
// 每 3s 检查一次管线状态变化（Claude 可能通过 REST 端点推进），
// 变化时推送最新状态到 webview，让「管线」tab 实时更新。
function startLivePoll(): void {
  if (livePollTimer) clearInterval(livePollTimer);
  livePollTimer = setInterval(async () => {
    if (!viewProvider?.webview) return;
    const ws = getWorkspace();
    if (!ws) return;
    try {
      const st = pipeline.readPipelineState(ws);
      if (st) {
        // 步骤切换 → 记录历史 + 推送动画事件
        if (liveLastStep !== st.current_step) {
          const cur = st.steps.find((s) => s.id === st.current_step);
          const prev = liveLastStep ? st.steps.find((s) => s.id === liveLastStep) : null;
          const evt = {
            type: 'stepSwitch',
            from: prev?.label || '—',
            to: cur?.label || st.current_step,
            at: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            stepsChanged: st.steps.length !== liveStepCount,
          };
          liveStepHistory.unshift(evt);
          if (liveStepHistory.length > 20) liveStepHistory.length = 20;
          liveLastStep = st.current_step;
          liveStepCount = st.steps.length;
          postToWebview(evt);   // 推送步骤切换动画
          pushState();          // 刷新全量状态
        }
        // 步骤数量变化（增删）→ 刷新
        if (liveStepCount !== st.steps.length) {
          liveStepCount = st.steps.length;
          pushState();
        }
        // 约束模式变化
        if (liveLastMode !== st.enforcement_mode) {
          liveLastMode = st.enforcement_mode;
          pushState();
        }
      }
    } catch { /* ignore */ }
  }, 1500);
}
let liveLastStep: string | null = null;
let liveLastMode: string | null = null;
let liveStepCount = 0;
let liveStepHistory: any[] = [];

// ── Webview HTML ─────────────────────────────────────────────

function getWebviewHtml(wv: vscode.Webview, fusion = false): string {
  // 从扩展资源根读取 webview 资源（商店安装后=安装目录，自包含）
  const webviewRoot = path.join(enforcement.getExtRoot(), 'src', 'webview');
  let css = '';
  let js = '';
  try {
    css = fs.readFileSync(path.join(webviewRoot, 'styles.css'), 'utf-8');
    js = fs.readFileSync(path.join(webviewRoot, 'main.js'), 'utf-8');
    js = fs.readFileSync(path.join(webviewRoot, 'vector-icons.js'), 'utf-8') + '\n' + js;
    if (fusion) {
      css += fs.readFileSync(path.join(webviewRoot, 'fusion.css'), 'utf-8');
      js += fs.readFileSync(path.join(webviewRoot, 'fusion.js'), 'utf-8');
    }
  } catch (e) {
    console.error('[叮咚鸡] webview assets missing:', e);
  }
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${wv.cspSource} data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>叮咚鸡 V2.0</title>
<style>${css}</style>
</head>
<body class="${fusion ? 'fusion' : ''}">
${fusion ? '' : '<button id="ddj-enter-fusion" style="margin:12px;padding:8px 12px;cursor:pointer">切换到内置 Codex 工作台 ↗</button>'}
<div id="app"></div>
<script>${js}</script>
</body>
</html>`;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
