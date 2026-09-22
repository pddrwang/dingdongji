import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { createInterface } from 'readline';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { AgentMessage, AgentSession, TurnOutcome } from './agentSession';

// A new adapter must not resume a durable thread while the old process still owns its lease.
const closingProcesses = new Map<string, Promise<void>>();

/** DSH ACP transport; never reads browser sessions or exports credential/config files. */
export class DeepSeekSession implements AgentSession {
  threadId?: string;
  busy = false;
  lastTurn?: TurnOutcome;
  private operation = 0;
  messages: AgentMessage[] = [];
  settings: AgentSession['settings'] = { permission: 'workspace' };
  models: any[] = [];
  private options: any[] = [];
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private generation = 0;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private connection = { status: '尚未连接', userAgent: 'DeepSeek Harness · ACP' };
  private quotaNote = 'Harness ACP 不提供账户余额；可刷新模型与连接状态';
  constructor(readonly workspace: string, private emit: () => void, private approve: (method: string, params: any) => Promise<any>, private executable: () => string) {}
  snapshot() { return { workspace: this.workspace, threadId: this.threadId, busy: this.busy, messages: this.messages, settings: this.settings, connection: this.connection, quota: null, quotaNote: this.quotaNote }; }
  private write(value: any) { if (!this.child || this.child.stdin.destroyed) throw new Error('Harness 连接不可用'); this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n'); }
  private request(method: string, params: any, timeout = 45000): Promise<any> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} 请求超时；不会重放任务`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  private fail(message: string) { this.dispose(); this.connection.status = '连接中断'; this.messages.push({ role: 'system', text: message }); this.emit(); }
  private async start() {
    if (this.ready) return this.ready;
    const generation = ++this.generation;
    this.connection.status = '正在握手'; this.emit();
    this.ready = (async () => {
      await closingProcesses.get(this.workspace);
      if (generation !== this.generation) throw new Error('Harness 连接已取消');
      this.child = spawn(this.executable(), ['--profile', 'acp'], { cwd: this.workspace, stdio: 'pipe' });
      const fail = (_code?: number, signal?: string) => { if (generation === this.generation) this.fail(`Harness ACP 流连接已断开${signal ? `（${signal}）` : ''}；请核对安装、ACP 配置与执行产物。`); };
      this.child.on('error', fail); this.child.on('exit', fail); this.child.stdin.on('error', fail);
      this.child.stderr.on('data', () => {}); // Drain only; diagnostics may contain secrets.
      createInterface({ input: this.child.stdout }).on('line', line => { if (generation !== this.generation) return; try { this.receive(JSON.parse(line)); } catch {} });
      const init = await this.request('initialize', { protocolVersion: 1, clientInfo: { name: 'dingdongji', version: require('../package.json').version }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
      if (init.protocolVersion !== 1) throw new Error('Harness ACP 协议版本不兼容');
      if (this.threadId && !init.agentCapabilities?.sessionCapabilities?.resume) throw new Error('Harness 不支持恢复原线程；历史保留，请升级或新建会话');
      const result = await this.request(this.threadId ? 'session/resume' : 'session/new', { ...(this.threadId ? { sessionId: this.threadId } : {}), cwd: this.workspace, mcpServers: [] });
      if (!this.threadId && typeof result.sessionId !== 'string') throw new Error('Harness 未返回会话标识');
      this.threadId = this.threadId || result.sessionId;
      this.applyOptions(result.configOptions);
      this.connection.status = '已连接 · Harness 原生权限策略'; this.emit();
    })();
    try { await this.ready; } catch (e) { if (generation === this.generation) this.fail('Harness 初始化失败；原会话保留。'); throw e; }
  }
  private applyOptions(options: any) {
    this.options = Array.isArray(options) ? options : [];
    const model = this.options.find(o => o.category === 'model');
    const effort = this.options.find(o => o.category === 'thought_level');
    const flat = (list: any[]): any[] => (list || []).flatMap(o => Array.isArray(o.options) ? flat(o.options) : [o]);
    this.settings.model = model?.currentValue;
    this.settings.effort = effort?.currentValue;
    this.models = flat(model?.options).filter(o => typeof o.value === 'string').map(o => ({ model: o.value, displayName: o.name || o.value, supportedReasoningEfforts: o.value === model.currentValue ? flat(effort?.options).map(e => ({ reasoningEffort: e.value, description: e.name })) : [] }));
  }
  private receive(m: any) {
    if (!m || typeof m !== 'object') return;
    if (m.id !== undefined && m.method) {
      const generation = this.generation;
      const reply = (result: any) => { if (generation === this.generation) this.write({ id: m.id, result }); };
      if (m.method === 'session/request_permission' && m.params?.sessionId === this.threadId && this.busy) {
        this.approve(m.method, m.params).then(reply, () => reply({ outcome: { outcome: 'cancelled' } })).catch(() => {});
      } else this.write({ id: m.id, error: { code: -32601, message: 'Unsupported or out-of-scope client request' } });
      return;
    }
    if (m.id !== undefined) {
      const p = this.pending.get(m.id); if (!p) return; clearTimeout(p.timer); this.pending.delete(m.id);
      m.error ? p.reject(new Error(`Harness RPC 失败 (${m.error.code ?? 'unknown'})；请检查本机 Harness 状态`)) : p.resolve(m.result); return;
    }
    if (m.method !== 'session/update' || m.params?.sessionId !== this.threadId) return;
    const u = m.params.update;
    if (!u) return;
    if (u.sessionUpdate === 'config_option_update') this.applyOptions(u.configOptions);
    if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') {
      const id = String(u.messageId || `reply-${this.seq}`);
      let item = this.messages.find(m => m.id === id);
      if (!item) { item = { role: 'assistant', id, text: '' }; this.messages.push(item); }
      item.text += u.content.text || '';
    }
    if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') this.messages.push({ role: 'activity', text: `${u.title || '工具调用'} · ${u.status || '执行中'} · ${u.toolCallId || ''}` });
    if (u.sessionUpdate === 'usage_update' && Number.isFinite(u.used) && Number.isFinite(u.size)) this.quotaNote = `上下文 ${u.used} / ${u.size} tokens（非账户余额）`;
    this.emit();
  }
  async inspect() { await this.start(); this.emit(); }
  async configure(action: string, value: string) {
    await this.start();
    const option = this.options.find(o => o.category === (action === 'model' ? 'model' : 'thought_level'));
    if (!option) throw new Error('Harness 未提供该选项');
    const result = await this.request('session/set_config_option', { sessionId: this.threadId, configId: option.id, value });
    this.applyOptions(result.configOptions); this.emit();
  }
  async send(text: string, brief: string, attachments: { path: string; image: boolean }[] = []) {
    if (this.busy) throw new Error('Harness 正在执行');
    const imageLinks = attachments.filter(a => a.image).map(a => {
      const absolute = path.resolve(a.path);
      const root = path.resolve(this.workspace) + path.sep;
      if (!absolute.startsWith(root)) throw new Error('Harness 图像附件必须位于当前项目工作区内。');
      return { type: 'resource_link', name: path.basename(absolute), uri: pathToFileURL(absolute).toString() };
    });
    const operation = ++this.operation;
    this.busy = true;
    const generation = this.generation;
    try {
      await this.start();
      if (!this.busy) return false;
      this.messages.push({ role: 'user', text: text + attachments.map(a => `\n附件：${a.path}`).join('') }); this.emit();
      const result = await this.request('session/prompt', { sessionId: this.threadId, prompt: [{ type: 'text', text: `${brief}\n\n用户本次请求：\n${text}${attachments.map(a => `\n用户选择的附件路径（读取前核对）：${a.path}`).join('')}` }, ...imageLinks] }, 30 * 60 * 1000);
      this.busy = false;
      this.lastTurn = { id: String(operation), status: result.stopReason === 'cancelled' ? 'interrupted' : result.stopReason === 'end_turn' ? 'completed' : 'unknown' };
      if (result.stopReason !== 'end_turn') this.messages.push({ role: 'system', text: `Harness 本轮结束：${result.stopReason || '未知状态'}；请检查结果。` });
      this.emit(); return true;
    } catch {
      this.lastTurn = { id: String(operation), status: this.lastTurn?.id === String(operation) && this.lastTurn.status === 'interrupted' ? 'interrupted' : 'failed' };
      if (this.busy || generation === this.generation) this.fail('Harness 请求未完成；请核对产物，不会自动重放。');
      this.emit(); return false;
    }
  }
  async stop() { if (this.busy) this.lastTurn = { id: String(this.operation), status: 'interrupted' }; if (this.busy && this.threadId) this.write({ method: 'session/cancel', params: { sessionId: this.threadId } }); this.dispose(); this.emit(); }
  dispose() {
    ++this.generation; const child = this.child; this.child = undefined;
    if (child && child.exitCode == null) {
      const closed = new Promise<void>(resolve => {
        let finished = false;
        const done = () => { if (finished) return; finished = true; clearTimeout(force); clearTimeout(limit); resolve(); };
        const force = setTimeout(() => child.kill(), 1500);
        const limit = setTimeout(() => { child.kill('SIGKILL'); done(); }, 5000);
        child.once('exit', done); child.once('error', done);
        child.stdin.end(); // EOF lets Harness flush durable events and release the session lease.
      });
      closingProcesses.set(this.workspace, closed);
      void closed.then(() => { if (closingProcesses.get(this.workspace) === closed) closingProcesses.delete(this.workspace); });
    }
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Harness 连接已关闭')); }
    this.pending.clear(); this.ready = undefined; this.busy = false; this.connection.status = '已断开';
  }
}
