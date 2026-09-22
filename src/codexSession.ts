import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { createInterface } from 'readline';
import * as path from 'path';
import * as os from 'os';
import { AgentMessage, TurnOutcome } from './agentSession';

/** One stdio server per project; no shared global workspace or browser socket. */
export class CodexSession {
  private process?: ChildProcessWithoutNullStreams;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private sequence = 0;
  private ready?: Promise<void>;
  private generation = 0;
  private operation = 0;
  private connection = { status: '尚未连接', userAgent: '' };
  threadId?: string;
  turnId?: string;
  busy = false;
  lastTurn?: TurnOutcome;
  private compacting = false;
  private compactTimer?: NodeJS.Timeout;
  private turnTimer?: NodeJS.Timeout;
  private compaction = '每轮结束后自动压缩 Codex 上下文';
  private completedTurns = new Set<string>();
  settings: { model?: string; effort?: string; permission: 'read' | 'workspace' | 'full' } = { permission: 'workspace' };
  models: any[] = [];
  quota: any = null;
  quotaNote = '尚未读取；不代表余额为零';
  async inspect() {
    await this.start();
    await Promise.all([
      (async () => {
        const models: any[] = []; let cursor: string | undefined; const seen = new Set<string>();
        do { const result = await this.request('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
          if (!Array.isArray(result.data)) throw new Error('模型目录不可用');
          models.push(...result.data); cursor = result.nextCursor || undefined;
          if (cursor && seen.has(cursor)) throw new Error('模型目录分页异常');
          if (cursor) seen.add(cursor);
        } while (cursor && seen.size < 20);
        this.models = models;
      })(),
      this.request('account/rateLimits/read', {}).then(result => { this.quota = result.rateLimits || null; this.quotaNote = this.quota ? 'ChatGPT 限额窗口 · 非 API 余额' : '账户未返回限额数据'; }, () => { this.quota = null; this.quotaNote = '无法读取：账户可能不支持 ChatGPT 限额接口'; }),
    ]);
    this.emit();
  }
  messages: AgentMessage[] = [];
  constructor(readonly workspace: string, private emit: () => void,
    private approve: (method: string, params: any) => Promise<any>,
    private executable: string | (() => string) = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex')) {}

  snapshot() { return { workspace: this.workspace, busy: this.busy, threadId: this.threadId, messages: this.messages, connection: this.connection, settings: this.settings, quota: this.quota, quotaNote: this.quotaNote, compaction: this.compaction }; }
  private async compact() {
    this.compacting = true; this.busy = true; this.compaction = '正在压缩模型上下文 · 完整会话记录保留'; this.emit();
    const generation = this.generation;
    this.compactTimer = setTimeout(() => { if (this.compacting && generation === this.generation) { this.compaction = '压缩超时，状态未确认；完整记录保留'; this.fail(new Error(this.compaction)); } }, 120000);
    try { await this.request('thread/compact/start', { threadId: this.threadId }); }
    catch (error) { if (generation === this.generation) {
      clearTimeout(this.compactTimer); this.compaction = '原生压缩未完成或不受支持；完整记录保留';
      if (![-32601, -32602].includes((error as any)?.code)) { this.fail(new Error('压缩状态未确认，已断开连接以避免重叠执行；完整记录保留。')); return; }
      this.compacting = false; this.busy = false; this.emit();
    } }
  }
  private write(value: any) {
    if (!this.process || this.process.stdin.destroyed) throw new Error('Codex 连接不可用');
    this.process.stdin.write(JSON.stringify(value) + '\n');
  }
  private request(method: string, params: any): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} 请求超时，请检查 Codex 登录与连接`)); }, 45000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  private fail(error: Error) {
    if (this.busy && !this.compacting) this.lastTurn = { id: String(this.operation), status: 'failed' };
    clearTimeout(this.compactTimer); clearTimeout(this.turnTimer); this.compacting = false;
    const child = this.process; this.process = undefined; ++this.generation; child?.kill();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.busy = false; this.turnId = undefined;
    this.ready = undefined;
    this.connection.status = `连接中断 · ${error.message.slice(0, 120)}`;
    this.messages.push({ role: 'system', text: error.message }); this.emit();
  }
  private async start() {
    if (this.ready) return this.ready;
    const generation = ++this.generation;
    this.connection = { status: '正在握手', userAgent: '' }; this.emit();
    this.ready = (async () => {
      const executable = typeof this.executable === 'function' ? this.executable() : this.executable;
      this.process = spawn(executable, ['app-server', '--listen', 'stdio://'], { cwd: this.workspace, stdio: 'pipe' });
      const fail = (error: Error) => { if (generation === this.generation) this.fail(error); };
      this.process.on('error', fail);
      this.process.on('exit', (_code, signal) => {
        const detail = signal ? `信号 ${signal}` : '进程结束';
        fail(new Error(`Codex 流连接已断开（${detail}）。已保留工作记录；请核对产物后重新发送，不会自动重放指令。`));
      });
      this.process.stdin.on('error', fail);
      this.process.stderr.on('data', () => { /* Drain diagnostics; never forward credentials or raw stderr. */ });
      createInterface({ input: this.process.stdout }).on('line', line => {
        if (generation !== this.generation) return;
        try { this.receive(JSON.parse(line)); } catch { /* Ignore malformed/non-protocol diagnostics. */ }
      });
      const initialized = await this.request('initialize', { clientInfo: { name: 'dingdongji', title: '叮咚鸡科研工作台', version: require('../package.json').version }, capabilities: { experimentalApi: false } });
      this.connection.userAgent = typeof initialized?.userAgent === 'string' ? initialized.userAgent : '';
      this.write({ method: 'initialized' });
      const result = await this.request(this.threadId ? 'thread/resume' : 'thread/start', { ...(this.threadId ? { threadId: this.threadId } : {}), cwd: this.workspace, sandbox: 'workspace-write', approvalPolicy: 'on-request' });
      if (typeof result?.thread?.id !== 'string') throw new Error('Codex thread 响应不兼容，请更新适配器；原会话保留。');
      if (typeof result.thread.cwd === 'string' && path.resolve(result.thread.cwd) !== path.resolve(this.workspace)) throw new Error('Codex 返回的线程工作区与当前项目不一致，已阻止继续发送。');
      this.threadId = result.thread.id;
      this.connection.status = '已连接'; this.emit();
    })();
    try { await this.ready; }
    catch (error) { if (generation === this.generation) this.fail(error instanceof Error ? error : new Error(String(error))); throw error; }
  }
  private receive(m: any) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return;
    if (m.method && m.id !== undefined) {
      const generation = this.generation;
      const reply = (value: any) => { if (generation === this.generation && this.process) this.write(value); };
      this.approve(m.method, m.params || {}).then(result => reply({ id: m.id, result }), () => reply({ id: m.id, error: { code: -32601, message: '客户端不支持或未完成此交互；未自动批准' } })).catch(() => {});
      return;
    }
    if (m.id !== undefined) {
      const p = this.pending.get(m.id); if (!p) return;
      clearTimeout(p.timer); this.pending.delete(m.id);
      m.error ? p.reject(Object.assign(new Error(m.error.message), { code: m.error.code })) : p.resolve(m.result); return;
    }
    const p = m.params || {};
    if (m.method === 'account/updated') { this.quota = null; this.quotaNote = '账号状态已变化，请刷新余量'; this.emit(); return; }
    if (m.method === 'account/rateLimits/updated') { this.quota = p.rateLimits || null; this.quotaNote = 'ChatGPT 限额窗口 · 非 API 余额'; this.emit(); return; }
    if (p.threadId && this.threadId && p.threadId !== this.threadId) return;
    if (!['turn/started', 'turn/completed', 'item/agentMessage/delta', 'item/started', 'item/completed'].includes(m.method)) return;
    if (m.method === 'turn/started' && typeof p.turn?.id === 'string') this.turnId = p.turn.id;
    if (m.method === 'item/agentMessage/delta') {
      let item = this.messages.find(x => x.id === p.itemId);
      if (!item) { item = { role: 'assistant', text: '', id: p.itemId }; this.messages.push(item); }
      item.text += typeof p.delta === 'string' ? p.delta : '';
    }
    if (m.method === 'item/completed' && p.item?.type === 'agentMessage') {
      const item = this.messages.find(x => x.id === p.item.id);
      if (item) { item.text = p.item.text; item.phase = p.item.phase; }
      else this.messages.push({ role: 'assistant', text: p.item.text, id: p.item.id, phase: p.item.phase });
    }
    if (m.method === 'item/started' && p.item && p.item.type !== 'agentMessage' && p.item.type !== 'userMessage') {
      this.messages.push({ role: 'activity', text: `${p.item.type} · ${p.item.command || '执行中'}` });
    }
    if (m.method === 'item/completed' && ['commandExecution', 'fileChange', 'mcpToolCall'].includes(p.item?.type)) {
      this.messages.push({ role: 'activity', text: `${p.item.type} · ${p.item.status || '完成'}${p.item.exitCode != null ? ` · exit ${p.item.exitCode}` : ''}` });
    }
    if (m.method === 'turn/completed') {
      if (p.turn?.id && this.completedTurns.has(p.turn.id)) return;
      if (p.turn?.id) this.completedTurns.add(p.turn.id);
      this.busy = false; this.turnId = undefined;
      clearTimeout(this.turnTimer);
      if (this.compacting) {
        clearTimeout(this.compactTimer); this.compacting = false;
        this.compaction = p.turn?.status === 'completed' && !p.turn?.error ? '模型上下文已压缩 · 完整记录保留' : '压缩未完成 · 完整记录保留';
        this.emit(); return;
      }
      const status = p.turn?.error ? 'failed' : ['completed', 'failed', 'interrupted'].includes(p.turn?.status) ? p.turn.status : 'unknown';
      this.lastTurn = { id: String(this.operation), status };
      if (p.turn?.error) this.messages.push({ role: 'system', text: p.turn.error.message || '执行失败' });
      this.emit();
      if (status === 'completed') void this.compact();
      return;
    }
    if (m.method === 'error' || m.method === 'turn/failed') {
      const message = typeof p.error?.message === 'string' ? p.error.message : typeof p.message === 'string' ? p.message : 'Codex 流处理失败';
      if (this.busy) this.fail(new Error(`Codex 上游错误：${message}`));
      return;
    }
    this.emit();
  }
  async send(text: string, brief: string, attachments: { path: string; image: boolean }[] = []) {
    if (this.busy) throw new Error('当前任务仍在执行，请等待完成或停止。');
    const operation = ++this.operation;
    this.busy = true; this.messages.push({ role: 'user', text: text + attachments.map(a => `\n附件：${a.path}`).join('') }); this.emit();
    try {
      await this.start();
      if (operation !== this.operation) return;
      const sandboxPolicy = this.settings.permission === 'full' ? { type: 'dangerFullAccess' } : this.settings.permission === 'read' ? { type: 'readOnly', networkAccess: false } : { type: 'workspaceWrite', writableRoots: [this.workspace], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true };
      const result = await this.request('turn/start', { threadId: this.threadId, ...(this.settings.model ? { model: this.settings.model } : {}), ...(this.settings.effort ? { effort: this.settings.effort } : {}), sandboxPolicy, approvalPolicy: this.settings.permission === 'read' ? 'never' : 'on-request', input: [{ type: 'text', text: `${brief}\n\n用户本次请求：\n${text}`, text_elements: [] }, ...attachments.map(a => a.image ? { type: 'localImage', path: a.path } : { type: 'mention', name: path.basename(a.path), path: a.path })] });
      if (typeof result?.turn?.id !== 'string') throw new Error('Codex turn 响应不兼容；请检查连接与产物，勿重复提交。');
      if (this.busy && !this.compacting) {
        this.turnId = result.turn.id;
        // A silent transport must not leave the UI busy forever. This is a
        // watchdog only; it never retries or replays an accepted turn.
        clearTimeout(this.turnTimer);
        this.turnTimer = setTimeout(() => {
          if (this.busy && this.turnId === result.turn.id) this.fail(new Error('Codex 流超过 30 分钟没有完成事件；已断开以避免重复执行。请核对产物后重试。'));
        }, 30 * 60 * 1000);
      }
      return true;
    } catch (error) {
      if (operation !== this.operation) return;
      // An uncertain turn/start outcome must not be replayed against a live transport.
      if (this.process) this.fail(error instanceof Error ? error : new Error(String(error)));
      this.busy = false; this.emit();
      return false;
    }
  }
  async stop() {
    if (this.turnId && this.threadId) await this.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId });
    else if (this.busy) this.dispose();
  }
  dispose() {
    if (this.busy && !this.compacting) this.lastTurn = { id: String(this.operation), status: 'interrupted' };
    clearTimeout(this.compactTimer); clearTimeout(this.turnTimer); this.compacting = false;
    ++this.operation;
    ++this.generation;
    const child = this.process; this.process = undefined; child?.kill();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('连接已关闭')); }
    this.pending.clear(); this.ready = undefined; this.busy = false; this.turnId = undefined;
    this.connection.status = '已断开';
  }
}
