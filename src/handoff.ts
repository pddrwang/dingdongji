import * as fs from 'fs';
import * as path from 'path';
import * as pipeline from './pipeline';
import * as kb from './knowledgeBase';

/**
 * 交接班（handoff）机制 —— 叮咚鸡=项目经理，多 Claude 窗口=外包程序员。
 *
 * 单文件持续追踪模型：
 *  1. 首次暂停时创建 标准化交接班模板（工程文件/交接班模板.md）
 *  2. 每次暂停 → 在 交接班.md 【原文件上追加】一条交接历史条目 + 【刷新】当前计划快照
 *  3. 接手 → 在交接班文件上【记录已处理】，不删除文件（保留完整历史）
 *  4. 管线推进时若存在交接班 → 自动刷新其计划快照（保持同步）
 *  交接班.md 是项目唯一的交接档案，永不重建、永不清空。
 */

export const HANDOFF_FILENAME = '交接班.md';
export const HANDOFF_TEMPLATE_FILENAME = '交接班模板.md';

export interface HandoffInfo {
  exists: boolean;
  path?: string;
  createdAt?: string;
  scenario?: string;
  currentStep?: string;
  nextStep?: string;
  missingArtifacts?: string[];
  kbDigest?: string;
  plan?: { label: string; status: string }[];
  upcoming?: string[];
  processed?: boolean;      // 最近一次交接是否已处理
  processedAt?: string;
  handoffCount?: number;    // 累计交接次数
  lastHandoffAt?: string;
  lastHandoffContent?: string; // 最近一次交接内容（用于展示）
}

export function handoffPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '工程文件', HANDOFF_FILENAME);
}

export function handoffTemplatePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '工程文件', HANDOFF_TEMPLATE_FILENAME);
}

export function readHandoff(workspaceRoot: string): HandoffInfo {
  const p = handoffPath(workspaceRoot);
  if (!fs.existsSync(p)) return { exists: false };
  try {
    const text = fs.readFileSync(p, 'utf-8');
    const metaMatch = text.match(/^<!-- handoff:(\{.*?\}) -->/m);
    const meta = metaMatch ? JSON.parse(metaMatch[1]) : {};
    return {
      exists: true,
      path: p,
      createdAt: meta.createdAt || '',
      scenario: meta.scenario || '',
      currentStep: meta.currentStep || '',
      nextStep: meta.nextStep || '',
      missingArtifacts: meta.missingArtifacts || [],
      plan: meta.plan || [],
      upcoming: meta.upcoming || [],
      processed: !!meta.processed,
      processedAt: meta.processedAt || '',
      handoffCount: meta.handoffCount || 0,
      lastHandoffAt: meta.lastHandoffAt || '',
      lastHandoffContent: meta.lastHandoffContent || '',
    };
  } catch {
    return { exists: true, path: p };
  }
}

/**
 * 创建/更新 标准化交接班模板（空模板，供每次交接班复用）。
 * 结构固定：交接内容 / 管线状态 / 待办计划 / 后续计划 / 遗留问题。
 */
export function ensureHandoffTemplate(workspaceRoot: string): string {
  const tp = handoffTemplatePath(workspaceRoot);
  fs.mkdirSync(path.dirname(tp), { recursive: true });
  if (fs.existsSync(tp)) return tp; // 已存在则保留

  const template = [
    '# 🔄 叮咚鸡交接班模板',
    '',
    '> 这是标准化交接班模板。暂停项目时叮咚鸡会按此结构生成交接班文件。',
    '> 每次交接班填写以下各节，确保下一位 Claude 能无缝接手。',
    '',
    '## 📋 一、交接内容（上一工作窗口填写）',
    '',
    '### 已完成进展',
    '- ',
    '',
    '### 当前待办',
    '- ',
    '',
    '### 遗留问题 / 风险',
    '- ',
    '',
    '## 📍 二、管线状态（自动生成）',
    '',
    '- 场景: （自动）',
    '- 当前步骤: （自动）',
    '- 约束模式: （自动）',
    '',
    '## ✅ 三、待办计划（自动生成）',
    '',
    '（此处列出全部步骤及其状态：✅已完成 / ▶️当前 / ⏳待办）',
    '',
    '## ⏭️ 四、后续计划（自动生成）',
    '',
    '（当前步骤之后的大步骤预览）',
    '',
    '## 💡 五、下一步行动（填写作家填写）',
    '',
    '1. ',
    '',
    '## 📎 六、知识库指针（自动生成）',
    '',
    '- 全局库: ~/ddj/kb/',
    '- 项目库: 工程文件/kb/',
    '',
  ].join('\n');

  fs.writeFileSync(tp, template + '\n', 'utf-8');
  return tp;
}

/**
 * 工作痕迹自动总结器：扫描项目真实产出，生成分级工作摘要。
 * 格式：大步骤(一级) → 具体动作(二级) → 产出位置(三级)
 * 信号源：search_log 审计链 / literature RIS / tables / figures / data / 脚本 / manifest。
 */
export function summarizeWork(workspaceRoot: string, state: pipeline.PipelineState | null): string[] {
  const eng = path.join(workspaceRoot, '工程文件');
  const out = path.join(workspaceRoot, '结果文件');
  const lines: string[] = [];
  const cur = pipeline.getCurrentStep(state);
  const stepLabel = cur?.label || '当前步骤';

  // ── 一级：当前步骤（大待办） ──
  lines.push(`### 当前大步骤：${stepLabel}`);
  lines.push('');

  // ── 二级：检索动作（读 search_log 审计链） ──
  const litDir = path.join(out, 'literature');
  const searchLog = path.join(litDir, 'search_log.md');
  if (fs.existsSync(searchLog)) {
    const text = fs.readFileSync(searchLog, 'utf-8');
    const lines3: string[] = [];
    // 提取各库检索行：如 "| 1 | PubMed — ai4scholar | ... | 73 | 73 | OK |"
    const dbRows = text.match(/^\|\s*\d+\s*\|.*\|\s*\d+\s*\|\s*\d+\s*\|\s*(OK|DOWN|FAIL|—|\*\*未检索\*\*)/gm);
    if (dbRows && dbRows.length) {
      lines3.push('**检索动作**（来自 search_log 审计链）：');
      for (const row of dbRows.slice(0, 6)) {
        const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
        // cells: [序号, 库名, 检索式/接口, 命中数, 去重数, 状态]
        if (cells.length >= 4) {
          const dbName = cells[1] || '';
          const hit = cells[cells.length - 3] || '?';
          const status = cells[cells.length - 1] || '';
          lines3.push(`  - ${dbName}：命中 ${hit} 条（${status}）`);
        }
      }
    } else {
      // 无表格，回退提取"接口"行
      const iface = text.match(/接口[：:]\s*([^\n]+)/);
      if (iface) lines3.push(`  - 检索接口：${iface[1].trim()}`);
    }
    if (lines3.length) lines.push(...lines3, '');
  }

  // ── 二级/三级：文献库 ──
  const risFiles = listFiles(litDir, ['.ris']);
  const risCounts = risFiles.map((f) => {
    try {
      const n = (fs.readFileSync(f, 'utf-8').match(/TY  -/g) || []).length;
      return `  - 文献库 ${path.basename(f)}：${n} 条`;
    } catch { return `  - 文献库 ${path.basename(f)}`; }
  });
  if (risCounts.length) {
    lines.push('**文献库存放**：', ...risCounts, '');
  }

  // ── 二级：分析产出（tables/figures/data） ──
  const tables = listFiles(path.join(out, 'tables'), ['.csv', '.xlsx']);
  const figures = listFiles(path.join(out, 'figures'), ['.png', '.pdf', '.jpg']);
  const dataFiles = listFiles(path.join(out, 'data'), ['.csv', '.dta', '.sas7bdat', '.xpt', '.RData', '.rds']);
  const recentTables = recentFiles(tables, 5);
  const recentFigs = recentFiles(figures, 5);
  if (recentTables.length || recentFigs.length) {
    lines.push('**分析产出**：');
    if (recentTables.length) lines.push(`  - 表格（最近 ${recentTables.length}）：${recentTables.map((f) => path.basename(f)).join('、')}`);
    if (recentFigs.length) lines.push(`  - 图表（最近 ${recentFigs.length}）：${recentFigs.map((f) => path.basename(f)).join('、')}`);
    if (dataFiles.length) lines.push(`  - 数据文件：${dataFiles.length} 个（${path.relative(workspaceRoot, path.join(out, 'data'))}/）`);
    lines.push('');
  }

  // ── 二级：脚本（工程文件） ──
  const scripts = recentFiles(listFiles(eng, ['.py', '.R', '.r']), 6);
  if (scripts.length) {
    lines.push('**本窗口相关脚本**：');
    for (const s of scripts) {
      const rel = path.relative(workspaceRoot, s);
      const mt = new Date(fs.statSync(s).mtimeMs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      lines.push(`  - ${rel}（改于 ${mt}）`);
    }
    lines.push('');
  }

  // ── 手稿/投稿状态（若在当前或已完成） ──
  const msDir = path.join(out, 'manuscript');
  const msFiles = listFiles(msDir, ['.docx', '.pdf']);
  if (msFiles.length) {
    const recentMs = recentFiles(msFiles, 3);
    lines.push('**手稿/产出**：');
    for (const m of recentMs) lines.push(`  - ${path.basename(m)}`);
    lines.push('');
  }

  return lines;
}

/**
 * 审计状态文本（审计×交接班深度融合）。
 * 汇总：指纹哈希链状态、可复现性校验、PRISMA 数据是否已生成。
 */
function auditStatusText(workspaceRoot: string, state: pipeline.PipelineState | null): string[] {
  const lines: string[] = [];
  const eng = path.join(workspaceRoot, '工程文件');
  const manifestPath = path.join(eng, 'artifact_manifest.json');
  const litDir = path.join(workspaceRoot, '结果文件', 'literature');

  // 指纹哈希链状态
  const manifestExists = fs.existsSync(manifestPath);
  if (manifestExists) {
    const chain = pipeline.verifyManifestChain(workspaceRoot);
    lines.push(`- 工件指纹哈希链：${chain.message}`);
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      lines.push(`- 已指纹产物：${Object.keys(m.artifacts || {}).length} 个（链长 ${m.chain_count || 0}）`);
    } catch { /* ignore */ }
  } else {
    lines.push('- 工件指纹哈希链：尚未建立（完成首个步骤后自动记录）');
  }

  // 可复现性校验（当前步骤）
  const cur = pipeline.getCurrentStep(state);
  if (cur?.required_artifacts?.length) {
    const repro = pipeline.validateReproducibility(workspaceRoot, cur);
    if (repro.ok) {
      lines.push('- 可复现性：✅ 当前步骤产出物指纹一致');
    } else {
      lines.push(`- 可复现性：⚠️ ${repro.warnings.join('；')}`);
    }
  }

  // PRISMA 流程数据
  const prismaCsv = path.join(litDir, 'prisma_flow_data.csv');
  if (fs.existsSync(prismaCsv)) {
    try {
      const content = fs.readFileSync(prismaCsv, 'utf-8');
      const rows = content.split('\n').filter((l) => l.includes(','));
      const stages = rows.map((r) => r.split(',')[0] + '=' + r.split(',')[1]);
      lines.push(`- PRISMA 流程数据：已生成（${stages.join('，')}）`);
    } catch { lines.push('- PRISMA 流程数据：已生成'); }
  } else {
    lines.push('- PRISMA 流程数据：待文献步骤完成后自动生成');
  }

  return lines;
}

/** 列出目录下匹配扩展名的文件（绝对路径） */
function listFiles(dir: string, exts: string[]): string[] {  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => !f.startsWith('.') && exts.some((e) => f.endsWith(e)))
      .map((f) => path.join(dir, f));
  } catch { return []; }
}

/** 按 mtime 排序取最近 N 个 */
function recentFiles(files: string[], n: number): string[] {
  return files
    .map((f) => ({ f, m: fs.statSync(f).mtimeMs }))
    .sort((a, b) => b.m - a.m)
    .slice(0, n)
    .map((x) => x.f);
}

/**
 * 写入交接班（追加式，原文件持续追踪）。
 * - 首次：创建文件（含文件头 meta + 第一条交接）
 * - 再次：在原文件上【追加】新的交接 #N 条目，并【刷新】文件头 meta 的当前计划快照
 * - 每条交接自动附加 summarizeWork 工作痕迹总结
 * 保留完整交接历史，永不重建。
 */
export function writeHandoff(workspaceRoot: string, content: string): string {
  ensureHandoffTemplate(workspaceRoot);
  const state = pipeline.readPipelineState(workspaceRoot);
  const cur = pipeline.getCurrentStep(state);
  const gate = state ? pipeline.stepCompletionCheck(workspaceRoot, state) : null;

  // 完整待办计划
  const plan = state
    ? state.steps.map((s) => ({ label: s.label, status: s.status }))
    : [];
  // 后续计划：当前步骤之后的大步骤
  const upcoming = state
    ? state.steps
        .filter((s) => s.status === 'pending' || s.status === 'stale')
        .slice(0, 6)
        .map((s) => s.label)
    : [];

  // C: 工作痕迹自动沉淀为项目记忆（跨窗口记忆体）
  try {
    const workTrace = summarizeWork(workspaceRoot, state);
    if (workTrace.length) {
      kb.recordHandoffTrace(workspaceRoot, workTrace);
      kb.regenerateDigest(workspaceRoot);
    }
  } catch { /* ignore */ }

  const now = new Date().toISOString();
  const p = handoffPath(workspaceRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const exists = fs.existsSync(p);

  // 读取历史交接次数
  let count = 0;
  let createdAt = now;
  if (exists) {
    const oldText = fs.readFileSync(p, 'utf-8');
    const oldMetaMatch = oldText.match(/^<!-- handoff:(\{.*?\}) -->/m);
    if (oldMetaMatch) {
      try {
        const oldMeta = JSON.parse(oldMetaMatch[1]);
        count = oldMeta.handoffCount || 0;
        createdAt = oldMeta.createdAt || now;
      } catch { /* ignore */ }
    }
  }
  count += 1;

  // 文件头 meta（每次刷新：当前计划快照 + 交接计数）
  const meta = {
    createdAt,
    scenario: state?.scenario || '',
    currentStep: cur?.id || '',
    nextStep: cur?.next || '',
    missingArtifacts: gate?.missing || [],
    plan,
    upcoming,
    processed: false,
    handoffCount: count,
    lastHandoffAt: now,
    lastHandoffContent: content.trim().slice(0, 200),
  };

  const entry: string[] = [];
  entry.push('');
  entry.push(`### 📋 交接 #${count} · ${new Date().toLocaleString('zh-CN')}`);
  entry.push('');
  // 一、自动工作痕迹总结（核心）
  const work = summarizeWork(workspaceRoot, state);
  if (work.length) {
    entry.push('**🔍 本窗口自动总结的工作**：');
    entry.push('');
    entry.push(...work);
    entry.push('---');
    entry.push('');
  }
  // 一·b、审计状态（审计×交接班深度融合）
  const auditLines = auditStatusText(workspaceRoot, state);
  if (auditLines.length) {
    entry.push('**🛡️ 审计状态**：');
    entry.push('');
    entry.push(...auditLines);
    entry.push('');
  }
  // 二、用户补充说明
  entry.push('**✍️ 交接说明**（上一窗口填写）：');
  entry.push('');
  entry.push(content.trim() || '（未填写补充说明，以自动总结为准）');
  entry.push('');
  entry.push('**管线快照**：' + (cur?.label || '—') + (cur?.next ? ` · 下一步: ${cur.next}` : ''));
  entry.push('');

  if (!exists) {
    // 首次：创建文件（文件头 + 说明 + 第一条交接）
    const header: string[] = [];
    header.push(`<!-- handoff:${JSON.stringify(meta)} -->`);
    header.push('# 🔄 交接班 — 叮咚鸡项目协同档案');
    header.push('');
    header.push('> 本文件是项目的持续交接档案。每次交接【追加】新条目并刷新计划快照，不重建、不清空。');
    header.push('');
    header.push('---');
    header.push('');
    header.push('## 📌 交接记录');
    header.push('');
    const body = header.concat(entry);
    fs.writeFileSync(p, body.join('\n') + '\n', 'utf-8');
  } else {
    // 已有文件：刷新文件头 meta + 追加新交接条目
    const oldText = fs.readFileSync(p, 'utf-8');
    const rest = oldText.replace(/^<!-- handoff:(\{.*?\}) -->\n?/, '');
    const newContent = `<!-- handoff:${JSON.stringify(meta)} -->\n` + rest + entry.join('\n');
    fs.writeFileSync(p, newContent, 'utf-8');
  }
  return p;
}

/** 刷新交接班文件头 meta 中的当前计划快照（管线推进时调用，保持同步）。 */
export function refreshHandoffSnapshot(workspaceRoot: string): void {
  const p = handoffPath(workspaceRoot);
  if (!fs.existsSync(p)) return;
  const state = pipeline.readPipelineState(workspaceRoot);
  if (!state) return;
  const cur = pipeline.getCurrentStep(state);
  const gate = pipeline.stepCompletionCheck(workspaceRoot, state);
  const plan = state.steps.map((s) => ({ label: s.label, status: s.status }));
  const upcoming = state.steps
    .filter((s) => s.status === 'pending' || s.status === 'stale')
    .slice(0, 6)
    .map((s) => s.label);

  const text = fs.readFileSync(p, 'utf-8');
  const metaMatch = text.match(/^<!-- handoff:(\{.*?\}) -->/m);
  if (!metaMatch) return;
  try {
    const meta = JSON.parse(metaMatch[1]);
    meta.scenario = state.scenario;
    meta.currentStep = cur?.id || '';
    meta.nextStep = cur?.next || '';
    meta.missingArtifacts = gate?.missing || [];
    meta.plan = plan;
    meta.upcoming = upcoming;
    const newText = text.replace(/^<!-- handoff:(\{.*?\}) -->/, `<!-- handoff:${JSON.stringify(meta)} -->`);
    fs.writeFileSync(p, newText, 'utf-8');
  } catch { /* ignore */ }
}

/**
 * 标记交接已处理（在原文件上记录，不删除文件）。
 * 在最近一条交接后追加「已处理」状态。
 */
export function markHandoffProcessed(workspaceRoot: string): boolean {
  const p = handoffPath(workspaceRoot);
  if (!fs.existsSync(p)) return false;
  try {
    const text = fs.readFileSync(p, 'utf-8');
    const metaMatch = text.match(/^<!-- handoff:(\{.*?\}) -->/m);
    if (!metaMatch) return false;
    const meta = JSON.parse(metaMatch[1]);
    meta.processed = true;
    meta.processedAt = new Date().toISOString();
    const newText = text
      .replace(/^<!-- handoff:(\{.*?\}) -->/, `<!-- handoff:${JSON.stringify(meta)} -->`);
    fs.writeFileSync(p, newText, 'utf-8');
    return true;
  } catch { return false; }
}

/** 兼容旧调用：clearHandoff 现为标记已处理（不删除文件）。 */
export function clearHandoff(workspaceRoot: string): boolean {
  return markHandoffProcessed(workspaceRoot);
}

function kbDigestText(): string {
  try {
    const d = path.join(kb.KB_ROOT, '_digest.md');
    return fs.existsSync(d) ? fs.readFileSync(d, 'utf-8').slice(0, 1000) : '';
  } catch { return ''; }
}
