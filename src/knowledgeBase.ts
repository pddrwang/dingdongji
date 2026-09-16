import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const KB_ROOT = path.join(os.homedir(), 'ddj', 'kb');
export const KB_SUBDIRS = ['papers', 'data-dicts', 'sop', 'journals', 'learnings', 'memory', 'lessons'];
export type KbScope = 'global' | 'project';

// ── 跨窗口记忆体类型（A） ──
export type MemoryKind =
  | 'project_memory'   // 项目记忆：步骤结论/方法/进展（project scope）
  | 'lesson'           // 全局教训：踩坑/经验/审计告警（global scope）
  | 'handoff_trace'    // 交接班工作痕迹（project scope，自动沉淀）

export interface KbEntry {
  type: string;           // paper | data-dict | sop | journal | learning | project
  title: string;
  source?: string;        // 来源（RIS/SearchLog/手动/项目）
  tags: string[];
  path: string;           // 条目文件绝对路径
  mtime: number;
  project?: string;
  scope?: KbScope;        // global | project（改进1：两级知识库）
}

export interface KbIndex {
  updated: string;
  entries: KbEntry[];
}

// ── 两级存储：全局 ~/ddj/dingdongji/kb/，项目 工程文件/kb/ ──

export function globalKbRoot(): string {
  return KB_ROOT;
}

export function projectKbRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, '工程文件', 'kb');
}

// 条目写入目标：project scope → 项目 kb 子目录；global scope → 全局 kb 子目录
function scopeDir(workspaceRoot: string | undefined, scope: KbScope, subdir: string): string {
  if (scope === 'project' && workspaceRoot) {
    return path.join(projectKbRoot(workspaceRoot), subdir);
  }
  return path.join(KB_ROOT, subdir);
}

// ── 知识库写入策略（2026-08-10 修复）──────────────────────────
// 全局库 ~/ddj/kb/ 仅允许三类内容：① 叮咚鸡本体调整；② 全局可复用的经验教训（lesson）；③ 新工具注册。
// 其余一切项目相关（维护记录/工作记忆/交接班痕迹/文献/数据字典/检索日志）一律写项目库 工程文件/kb/。
export function isGlobalWritable(meta: {
  type?: string;
  title?: string;
  source?: string;
  tags?: string[];
}): boolean {
  const hay = [meta.type, meta.title, meta.source, ...(meta.tags || [])].filter(Boolean).join(' ');
  if (meta.type === 'lesson') return true;                       // 全局可复用经验教训
  if (/扩展工具|ext-tool|智能体扩展|工具注册/i.test(hay)) return true; // 新工具注册
  return false;                                                  // 其余一律项目库
}

// ── Store scaffolding ─────────────────────────────────────────

export function ensureKb(): void {
  for (const d of KB_SUBDIRS) {
    fs.mkdirSync(path.join(KB_ROOT, d), { recursive: true });
  }
  const indexPath = path.join(KB_ROOT, 'index.json');
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, JSON.stringify({ updated: new Date().toISOString(), entries: [] }, null, 2), 'utf-8');
  }
}

export function readIndex(): KbIndex {
  ensureKb();
  try {
    const raw = fs.readFileSync(path.join(KB_ROOT, 'index.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    return { updated: parsed.updated || '', entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch {
    return { updated: '', entries: [] };
  }
}

function writeIndex(index: KbIndex): void {
  fs.writeFileSync(path.join(KB_ROOT, 'index.json'), JSON.stringify(index, null, 2), 'utf-8');
}

// ── Entry management ──────────────────────────────────────────

export function addEntry(entry: Omit<KbEntry, 'mtime'>): KbEntry {
  const full: KbEntry = { ...entry, scope: entry.scope ?? 'global', mtime: Date.now() };
  const index = readIndex();
  index.entries = index.entries.filter((e) => e.path !== full.path);
  index.entries.unshift(full);
  index.updated = new Date().toISOString();
  writeIndex(index);
  return full;
}

/**
 * 写入条目。scope=project 时写入项目 kb 目录（工程文件/kb/<subdir>/），scope=global 写全局。
 * workspaceRoot 在 project scope 时必须提供。
 */
export function upsertEntryBody(
  subdir: string, fileName: string, body: string,
  meta: Omit<KbEntry, 'path' | 'mtime'>, workspaceRoot?: string
): string {
  ensureKb();
  const scope = meta.scope ?? 'global';
  const dir = scopeDir(workspaceRoot, scope, subdir);
  const file = path.join(dir, fileName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, body, 'utf-8');
  addEntry({ ...meta, scope, path: file });
  return file;
}

// ── 跨窗口记忆沉淀（A/C/D） ───────────────────────────────────

/**
 * A: 记录一条项目记忆（步骤结论/方法/进展）。
 * 写入项目 KB 的 memory/ 目录（project scope），供下窗口读取。
 */
export function recordStepMemory(workspaceRoot: string, opts: {
  title: string;
  body: string;
  stepId?: string;
  tags?: string[];
  type?: MemoryKind;   // 可选覆盖类型（如 handoff_trace）
}): string {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(/[-:]/g, '');
  const safeTitle = opts.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  // 从工作区推导项目名（修复：自动沉淀的记忆缺失 project 字段导致串项目）
  const projectName = projectNameFor(workspaceRoot);
  return upsertEntryBody('memory', `${stamp}_${safeTitle}.md`, [
    `# 🧠 ${opts.title}`,
    '',
    opts.body.trim(),
    '',
    opts.stepId ? `> 沉淀自步骤: ${opts.stepId}` : '',
    `> 时间: ${new Date().toLocaleString('zh-CN')}`,
  ].join('\n'), {
    type: opts.type || ('project_memory' as MemoryKind),
    title: opts.title,
    source: '自动沉淀',
    tags: ['memory', opts.stepId || '', ...(opts.tags || [])],
    scope: 'project',
    project: projectName,
  }, workspaceRoot);
}

/**
 * D: 记录一条全局教训（踩坑/经验/审计告警），跨项目复用。
 * 写入全局 KB 的 lessons/ 目录（global scope）。
 */
export function recordLesson(opts: {
  title: string;
  body: string;
  project?: string;
  tags?: string[];
}): string {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(/[-:]/g, '');
  const safeTitle = opts.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  return upsertEntryBody('lessons', `${stamp}_${safeTitle}.md`, [
    `# 💡 ${opts.title}`,
    '',
    opts.body.trim(),
    '',
    opts.project ? `> 来源项目: ${opts.project}` : '',
    `> 时间: ${new Date().toLocaleString('zh-CN')}`,
  ].join('\n'), {
    type: 'lesson' as MemoryKind,
    title: opts.title,
    source: '审计/经验沉淀',
    tags: ['lesson', ...(opts.tags || [])],
    scope: 'global',
    project: opts.project,
  });
}

/**
 * 维护记录：记录一次项目维护/修复工作（本窗口做了什么）。
 * 写入【项目】KB 的 learnings/ 目录（project scope）——维护记录属于项目，
 * 全局库只放 叮咚鸡本体调整/全局可复用经验/新工具（见 isGlobalWritable）。
 */
export function recordMaintenance(workspaceRoot: string, opts: {
  title: string;
  body: string;
  tags?: string[];
}): string {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(/[-:]/g, '');
  const safeTitle = opts.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  const projectName = projectNameFor(workspaceRoot);
  return upsertEntryBody('learnings', `${stamp}_${safeTitle}.md`, [
    `# 🔧 维护记录: ${opts.title}`,
    '',
    opts.body.trim(),
    '',
    `> 所属项目: ${projectName}`,
    `> 时间: ${new Date().toLocaleString('zh-CN')}`,
  ].join('\n'), {
    type: 'learning',
    title: `维护记录: ${opts.title}`,
    source: '维护智能体',
    tags: ['maintenance', ...(opts.tags || [])],
    scope: 'project',
    project: projectName,
  }, workspaceRoot);
}

/**
 * C: 交接班工作痕迹自动沉淀为项目记忆。
 * 在 writeHandoff 时调用，把自动总结的工作存为 project_memory。
 */
export function recordHandoffTrace(workspaceRoot: string, trace: string[]): string {
  if (!trace.length) return '';
  return recordStepMemory(workspaceRoot, {
    title: '交接班工作痕迹',
    body: trace.join('\n'),
    tags: ['handoff'],
    type: 'handoff_trace',
  });
}

/** 取项目名（manifest.project 或工作区 basename），用于 KB 项目隔离 */
function projectNameFor(workspaceRoot?: string): string {
  if (!workspaceRoot) return '';
  try {
    const mp = path.join(workspaceRoot, '工程文件', '00_bus_manifest.json');
    if (fs.existsSync(mp)) {
      const m = JSON.parse(fs.readFileSync(mp, 'utf-8'));
      if (m.project) return m.project;
    }
  } catch { /* ignore */ }
  return path.basename(workspaceRoot);
}

/** 读取项目记忆（按时间倒序，仅当前项目——修复切换工作区串项目） */
export function listProjectMemories(workspaceRoot: string, limit = 8): KbEntry[] {
  const idx = readIndex();
  const projectName = projectNameFor(workspaceRoot);
  const projRoot = projectKbRoot(workspaceRoot);
  return idx.entries
    .filter((e) => e.scope === 'project' && (e.type === 'project_memory' || e.type === 'handoff_trace'))
    .filter((e) => {
      // 当前项目：有 project 字段且匹配；或旧数据无 project 但文件在当前工作区 kb 下
      if (projectName) {
        if (e.project) return e.project === projectName;
        return e.path && e.path.startsWith(projRoot);
      }
      return !e.project || e.path.startsWith(projRoot);
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
}

/** 读取全局教训（按时间倒序） */
export function listLessons(limit = 5): KbEntry[] {
  const idx = readIndex();
  return idx.entries
    .filter((e) => e.scope === 'global' && e.type === 'lesson')
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
}

export function searchEntries(query: string, type?: string, scope?: KbScope, workspaceRoot?: string): KbEntry[] {
  const index = readIndex();
  const q = query.toLowerCase().trim();
  const projectName = scope === 'project' ? projectNameFor(workspaceRoot) : '';
  const projRoot = workspaceRoot ? projectKbRoot(workspaceRoot) : '';
  return index.entries
    .filter((e) => !type || e.type === type)
    .filter((e) => !scope || e.scope === scope)
    // 项目级检索：仅当前项目（修复切换工作区串项目；兼容旧数据无 project 字段）
    .filter((e) => e.scope !== 'project' || !projectName || (e.project ? e.project === projectName : (projRoot && e.path.startsWith(projRoot))))
    .filter((e) => {
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q)) ||
        (e.source || '').toLowerCase().includes(q)
      );
    })
    .sort((a, b) => b.mtime - a.mtime);
}

// ── RIS ingestion：默认进项目知识库 ───────────────────────────

interface RisRecord {
  TY?: string;
  T1?: string;
  AU?: string[];
  PY?: string;
  JF?: string;
  DO?: string;
  AN?: string;
  AB?: string;
}

function parseRis(text: string): RisRecord[] {
  const records: RisRecord[] = [];
  let cur: RisRecord | null = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9]{2})\s{2}-\s?(.*)$/);
    if (!m) continue;
    const [tag, val] = [m[1], m[2]];
    if (tag === 'ER') {
      if (cur) records.push(cur);
      cur = null;
      continue;
    }
    if (tag === 'TY') {
      cur = { TY: val };
      continue;
    }
    if (!cur) continue;
    switch (tag) {
      case 'T1': case 'TI': cur.T1 = (cur.T1 ? cur.T1 + ' ' : '') + val; break;
      case 'AU': case 'A1': cur.AU = (cur.AU || []).concat(val); break;
      case 'PY': cur.PY = val; break;
      case 'JF': case 'JO': case 'T2': cur.JF = val; break;
      case 'DO': cur.DO = val; break;
      case 'AN': cur.AN = val; break;
      case 'AB': case 'N2': cur.AB = (cur.AB ? cur.AB + ' ' : '') + val; break;
      default: break;
    }
  }
  if (cur) records.push(cur);
  return records;
}

/** 摄取 RIS 到【项目】知识库（改进1：RIS 文献默认项目级，不占用全局库） */
export function ingestRisFile(risPath: string, project: string | undefined, workspaceRoot: string): number {
  if (!fs.existsSync(risPath)) return 0;
  const text = fs.readFileSync(risPath, 'utf-8');
  const records = parseRis(text);
  let added = 0;
  for (const rec of records) {
    const title = rec.T1 || `Untitled ${rec.AN || ''}`.trim();
    if (!title || title === 'Untitled') continue;
    const fileName = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100) + '.md';
    const body = [
      `# ${title}`,
      '',
      `- **类型**: ${rec.TY || '文献'}`,
      rec.AU?.length ? `- **作者**: ${rec.AU.join(', ')}` : '',
      rec.PY ? `- **年份**: ${rec.PY}` : '',
      rec.JF ? `- **期刊**: ${rec.JF}` : '',
      rec.DO ? `- **DOI**: ${rec.DO}` : '',
      rec.AN ? `- **ID**: ${rec.AN}` : '',
      '',
      rec.AB ? `## 摘要\n\n${rec.AB}` : '',
      '',
      project ? `> 来源项目: ${project}` : '',
    ].filter(Boolean).join('\n');
    upsertEntryBody('papers', fileName, body, {
      type: 'paper', title, source: 'RIS',
      tags: ['literature', ...(rec.PY ? [rec.PY] : [])],
      project, scope: 'project',
    }, workspaceRoot);
    added++;
  }
  return added;
}

// ── Enrichment (启动/打开项目时执行) ───────────────────────────

export interface EnrichResult {
  project?: string;
  papersIngested: number;
  entriesTotal: number;
  digestChars: number;
}

export function enrichWorkspace(workspaceRoot: string): EnrichResult {
  ensureKb();
  const result: EnrichResult = { papersIngested: 0, entriesTotal: 0, digestChars: 0 };

  // 项目级 KB 目录
  const projEng = path.join(workspaceRoot, '工程文件');
  const projOut = path.join(workspaceRoot, '结果文件');
  const projKb = path.join(projEng, 'kb');
  fs.mkdirSync(projKb, { recursive: true });

  // 读取 manifest 获得项目名与研究问题
  let projectName = path.basename(workspaceRoot);
  let researchQuestion = '';
  try {
    const mp = path.join(projEng, '00_bus_manifest.json');
    if (fs.existsSync(mp)) {
      const m = JSON.parse(fs.readFileSync(mp, 'utf-8'));
      if (m.project) projectName = m.project;
      if (m.research_question) researchQuestion = m.research_question;
    }
  } catch { /* ignore */ }
  result.project = projectName;

  // 1. 摄取 RIS 文献库
  const risPath = path.join(projOut, 'literature', 'literature_library.ris');
  if (fs.existsSync(risPath)) {
    result.papersIngested = ingestRisFile(risPath, projectName, workspaceRoot);
  }

  // 2. 摄取 search_log 摘要（作为项目文献笔记的补充）
  const searchLog = path.join(projOut, 'literature', 'search_log.md');
  if (fs.existsSync(searchLog)) {
    const head = fs.readFileSync(searchLog, 'utf-8').slice(0, 2000);
    upsertEntryBody('papers', `${projectName}_search_log.md`, head, {
      type: 'paper', title: `${projectName} 检索日志`, source: 'SearchLog', tags: ['search-log', projectName], project: projectName, scope: 'project',
    }, workspaceRoot);
  }

  // 3. 索引数据字典（原始数据目录下的说明文件，若有）
  const rawDir = path.join(workspaceRoot, '原始数据');
  if (fs.existsSync(rawDir)) {
    for (const sub of fs.readdirSync(rawDir)) {
      const full = path.join(rawDir, sub);
      if (fs.statSync(full).isDirectory()) {
        const note = path.join(full, 'README.md');
        if (fs.existsSync(note)) {
          const body = fs.readFileSync(note, 'utf-8').slice(0, 2000);
          upsertEntryBody('data-dicts', `${projectName}_${sub}_dict.md`, body, {
            type: 'data-dict', title: `${projectName} — ${sub} 数据说明`, source: '项目扫描', tags: [sub, projectName], project: projectName, scope: 'project',
          }, workspaceRoot);
        }
      }
    }
  }

  // 4. 记录项目级 KB 索引（指向项目专用知识）
  const projKbFiles = fs.existsSync(projKb) ? fs.readdirSync(projKb).filter((f) => f.endsWith('.md')) : [];
  for (const f of projKbFiles) {
    const fp = path.join(projKb, f);
    addEntry({ type: 'learning', title: `${projectName} — ${f.replace(/\.md$/, '')}`, source: '项目知识库', tags: [projectName, 'project'], path: fp, project: projectName, scope: 'project' });
  }

  result.entriesTotal = readIndex().entries.length;
  regenerateDigest(workspaceRoot);
  result.digestChars = fs.readFileSync(path.join(KB_ROOT, '_digest.md'), 'utf-8').length;
  return result;
}

// ── Digest 生成（注入上下文用，≤2KB）────────────────────────────

export function regenerateDigest(workspaceRoot?: string): void {
  ensureKb();
  const index = readIndex();
  // 当前项目名（用于区分项目级条目）
  let projectName = '';
  if (workspaceRoot) {
    try {
      const mp = path.join(workspaceRoot, '工程文件', '00_bus_manifest.json');
      if (fs.existsSync(mp)) {
        const m = JSON.parse(fs.readFileSync(mp, 'utf-8'));
        if (m.project) projectName = m.project;
      }
    } catch { projectName = path.basename(workspaceRoot); }
    if (!projectName) projectName = path.basename(workspaceRoot);
  }
  const entries = index.entries;
  const globalEntries = entries.filter((e) => e.scope !== 'project');
  const projRoot = workspaceRoot ? projectKbRoot(workspaceRoot) : '';
  const projEntries = entries.filter((e) => e.scope === 'project' && (!projectName || (e.project ? e.project === projectName : (projRoot && e.path && e.path.startsWith(projRoot)))));

  const lines: string[] = [];
  lines.push('# 🧠 叮咚鸡跨窗口记忆');
  lines.push('');
  lines.push(`> 更新: ${new Date().toLocaleString('zh-CN')} | 全局: ${globalEntries.length} | 项目: ${projEntries.length}`);
  lines.push('> 阅读顺序：先全局库 → 再交接班 → 最后项目库');
  lines.push('');

  // ── 1. 先全局：全局教训（D，跨窗口/项目复用） ──
  const lessons = entries.filter((e) => e.scope === 'global' && e.type === 'lesson').slice(0, 5);
  if (lessons.length) {
    lines.push('## 💡 【全局教训】（跨项目复用）');
    for (const l of lessons) lines.push(`- 💡 ${l.title}`);
    lines.push('');
  }

  // ── 2. 再交接班：最近交接痕迹（C） ──
  const traces = projEntries.filter((e) => e.type === 'handoff_trace')
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 3);
  if (traces.length) {
    lines.push('## 🔄 最近交接痕迹');
    for (const t of traces) lines.push(`- 🔄 ${t.title}`);
    lines.push('');
  }

  // ── 3. 最后项目库：近期工作记忆（A）+ 维护记录 ──
  const mems = projEntries.filter((e) => e.type === 'project_memory')
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 5);
  if (mems.length) {
    lines.push(`## 🧠 【${projectName || '项目'}】近期工作记忆`);
    for (const m of mems) {
      // 读记忆文件前 120 字做摘要
      let preview = '';
      try {
        const body = fs.readFileSync(m.path, 'utf-8');
        preview = body.split('\n').filter((l) => l && !l.startsWith('#') && !l.startsWith('>')).join(' ').slice(0, 100);
      } catch { /* ignore */ }
      lines.push(`- ${m.title}${preview ? `：${preview}…` : ''}`);
    }
    lines.push('');
  }
  const projLearn = projEntries.filter((e) => e.type === 'learning')
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 5);
  if (projLearn.length) {
    lines.push(`## 📁 【${projectName || '项目'}】维护记录与笔记`);
    for (const l of projLearn) lines.push(`- 🔧 ${l.title}`);
    lines.push('');
  }

  // ── 4. 全局经验/SOP/工具（B 层） ──
  const gSops = globalEntries.filter((e) => e.type === 'sop').slice(0, 4);
  const gLearn = globalEntries.filter((e) => e.type === 'learning').slice(0, 4);
  const gDict = globalEntries.filter((e) => e.type === 'data-dict').slice(0, 3);
  const gJour = globalEntries.filter((e) => e.type === 'journal').slice(0, 3);
  if (gLearn.length || gSops.length || gDict.length || gJour.length) {
    lines.push('## 【全局】经验/SOP/算法');
    for (const l of gLearn) lines.push(`- 💡 ${l.title}`);
    for (const s of gSops) lines.push(`- 📋 ${s.title}`);
    for (const d of gDict) lines.push(`- 📊 ${d.title}`);
    for (const j of gJour) lines.push(`- 📰 ${j.title}`);
    lines.push('');
  }

  // ── 5. 文献（降到最底层，作为参考） ──
  const gPapers = globalEntries.filter((e) => e.type === 'paper').slice(0, 4);
  if (gPapers.length) {
    lines.push('## 【全局】文献');
    for (const p of gPapers) lines.push(`- ${p.title}`);
    lines.push('');
  }
  const projPapers = projEntries.filter((e) => e.type === 'paper' || e.type === 'data-dict').slice(0, 8);
  if (projPapers.length) {
    lines.push(`## 📖 【${projectName || '项目'}】文献与数据`);
    for (const p of projPapers) lines.push(`- ${p.title}`);
    lines.push('');
  }

  // 控制体积
  let digest = lines.join('\n');
  if (digest.length > 2048) {
    digest = digest.slice(0, 2048) + '\n…(已截断)';
  }
  fs.writeFileSync(path.join(KB_ROOT, '_digest.md'), digest, 'utf-8');
}

// ── KB 面板用：列出分类（支持 scope 过滤） ─────────────────────

export function listByType(type: string, scope?: KbScope): KbEntry[] {
  return readIndex().entries
    .filter((e) => e.type === type)
    .filter((e) => !scope || e.scope === scope)
    .sort((a, b) => b.mtime - a.mtime);
}

// ── 项目资料库（仅读取当前工作区，不混入其他项目）──────────────

export const PROJECT_AUDIT_FILE = 'audit_records.md';
export const PROJECT_REVIEW_FILE = 'review_comments.md';

export interface ProjectLibItem {
  name: string;
  path: string;
  rel: string;        // 相对工作区的展示路径
  mtime: number;
  kind: string;       // note | ris | search-log | audit | review
}

export interface ProjectLibrary {
  workspace: string;
  project?: string;
  notes: ProjectLibItem[];
  risFiles: ProjectLibItem[];
  searchLogs: ProjectLibItem[];
  audit: ProjectLibItem | null;
  review: ProjectLibItem | null;
}

function projectLibItem(workspaceRoot: string, p: string, kind: string): ProjectLibItem {
  return {
    name: path.basename(p),
    path: p,
    rel: path.relative(workspaceRoot, p),
    mtime: fs.existsSync(p) ? Math.floor(fs.statSync(p).mtimeMs) : 0,
    kind,
  };
}

/** 遍历项目 kb 目录下的 .md/.txt（仅当前工作区） */
function walkProjectKb(workspaceRoot: string): string[] {
  const root = projectKbRoot(workspaceRoot);
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir)) {
      if (e === '.DS_Store') continue;
      const p = path.join(dir, e);
      try {
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (/\.(md|txt)$/i.test(e)) out.push(p);
      } catch { /* ignore */ }
    }
  };
  walk(root);
  return out;
}

/** 扫描工作区内的 RIS 文献库文件（结果文件/工程文件，深度 ≤5） */
function findRisFiles(workspaceRoot: string): string[] {
  const found: string[] = [];
  for (const d of ['结果文件', '工程文件']) {
    const base = path.join(workspaceRoot, d);
    if (!fs.existsSync(base)) continue;
    const walk = (dir: string, depth: number) => {
      if (depth > 5) return;
      for (const e of fs.readdirSync(dir)) {
        if (e === '.DS_Store') continue;
        const p = path.join(dir, e);
        try {
          if (fs.statSync(p).isDirectory()) walk(p, depth + 1);
          else if (/\.ris$/i.test(e)) found.push(p);
        } catch { /* ignore */ }
      }
    };
    walk(base, 0);
  }
  return found;
}

/** 确保项目资料库文件存在（audit_records.md / review_comments.md） */
export function ensureProjectLibrary(workspaceRoot: string): void {
  const root = projectKbRoot(workspaceRoot);
  fs.mkdirSync(root, { recursive: true });
  const templates: Record<string, string> = {
    [PROJECT_AUDIT_FILE]: [
      '# 🔍 项目审计记录',
      '',
      '> 审计事件（产物指纹 / 可复现性 / PRISMA 流程 / 告警）按时间追加，每条一条记录。',
      '> 格式：## 时间 · 标题 + 正文。',
      '',
    ].join('\n'),
    [PROJECT_REVIEW_FILE]: [
      '# 📝 审稿意见',
      '',
      '> 期刊/评审返修意见、内部互审意见按时间追加；每条含来源、日期、处理状态。',
      '> 格式：## 时间 · 标题 + 正文。',
      '',
    ].join('\n'),
  };
  for (const [f, head] of Object.entries(templates)) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) fs.writeFileSync(p, head, 'utf-8');
  }
}

/** 追加一条审计记录或审稿意见到对应文件，并登记全局索引（project scope） */
export function appendAuditReview(
  workspaceRoot: string, kind: 'audit' | 'review', title: string, body: string
): string {
  ensureProjectLibrary(workspaceRoot);
  const file = path.join(projectKbRoot(workspaceRoot),
    kind === 'audit' ? PROJECT_AUDIT_FILE : PROJECT_REVIEW_FILE);
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const safe = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  const block = `\n## ${stamp} · ${safe}\n\n${body.trim()}\n`;
  fs.appendFileSync(file, block, 'utf-8');
  const projectName = projectNameFor(workspaceRoot);
  addEntry({
    type: kind,
    title: `${kind === 'audit' ? '审计记录' : '审稿意见'}：${title}`,
    source: '手动',
    tags: [kind],
    path: file,
    project: projectName,
    scope: 'project',
  });
  return file;
}

/** 汇总当前工作区项目资料库（仅本工作区：笔记/经验、RIS 文献、检索记录、审计、审稿） */
export function listProjectLibrary(workspaceRoot: string): ProjectLibrary {
  ensureProjectLibrary(workspaceRoot);
  const projKb = projectKbRoot(workspaceRoot);
  const notes: ProjectLibItem[] = [];
  const searchLogs: ProjectLibItem[] = [];
  for (const p of walkProjectKb(workspaceRoot)) {
    if (path.basename(p) === PROJECT_AUDIT_FILE || path.basename(p) === PROJECT_REVIEW_FILE) continue;
    const rel = path.relative(projKb, p);
    if (/search[-_ ]?log|检索日志|检索记录/i.test(path.basename(p)) || /检索/i.test(rel)) {
      searchLogs.push(projectLibItem(workspaceRoot, p, 'search-log'));
    } else {
      notes.push(projectLibItem(workspaceRoot, p, 'note'));
    }
  }
  notes.sort((a, b) => b.mtime - a.mtime);
  searchLogs.sort((a, b) => b.mtime - a.mtime);
  let projectName: string | undefined;
  try {
    const mp = path.join(workspaceRoot, '工程文件', '00_bus_manifest.json');
    if (fs.existsSync(mp)) {
      const m = JSON.parse(fs.readFileSync(mp, 'utf-8'));
      if (m.project) projectName = m.project;
    }
  } catch { /* ignore */ }
  return {
    workspace: workspaceRoot,
    project: projectName || path.basename(workspaceRoot),
    notes,
    risFiles: findRisFiles(workspaceRoot).map((p) => projectLibItem(workspaceRoot, p, 'ris')),
    searchLogs,
    audit: projectLibItem(workspaceRoot, path.join(projKb, PROJECT_AUDIT_FILE), 'audit'),
    review: projectLibItem(workspaceRoot, path.join(projKb, PROJECT_REVIEW_FILE), 'review'),
  };
}
