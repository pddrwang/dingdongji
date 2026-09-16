import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Paths ─────────────────────────────────────────────────────

// 资源根：商店安装时为扩展安装目录（extension.extensionUri），开发时为 ~/ddj/dingdongji-vscode
let EXT_ROOT = path.join(os.homedir(), 'ddj', 'dingdongji-vscode');

/** 由 extension.ts 在 activate 时设置：商店安装后指向扩展安装目录，保证自包含 */
export function setExtRoot(root: string): void {
  EXT_ROOT = root;
}

export function getExtRoot(): string {
  return EXT_ROOT;
}

export const HOOKS_DIR = () => path.join(EXT_ROOT, 'src', 'hooks');
export const AGENTS_SRC = () => path.join(EXT_ROOT, 'src', 'agents');
export const AGENTS_DST = path.join(os.homedir(), '.claude', 'agents');
export const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
export const CODEX_SKILLS_DST = path.join(os.homedir(), '.codex', 'skills');

const DDJ_SKILLS_ROOT = path.join(os.homedir(), 'ddj', 'skills');
const CODEX_SKILL_LINKS: Record<string, string> = {
  'clinical-trial-protocol-skill': path.join(DDJ_SKILLS_ROOT, 'anthropic-life-sciences', 'clinical-trial-protocol-skill'),
  'instrument-data-to-allotrope': path.join(DDJ_SKILLS_ROOT, 'anthropic-life-sciences', 'instrument-data-to-allotrope'),
  'nextflow-development': path.join(DDJ_SKILLS_ROOT, 'anthropic-life-sciences', 'nextflow-development'),
  'protein_analysis': path.join(DDJ_SKILLS_ROOT, 'open-rosalind', 'protein_analysis'),
  'scientific-problem-selection': path.join(DDJ_SKILLS_ROOT, 'anthropic-life-sciences', 'scientific-problem-selection'),
  'scvi-tools': path.join(DDJ_SKILLS_ROOT, 'anthropic-life-sciences', 'scvi-tools'),
  'sequence_analysis': path.join(DDJ_SKILLS_ROOT, 'open-rosalind', 'sequence_analysis'),
  'single-cell-rna-qc': path.join(DDJ_SKILLS_ROOT, 'anthropic-life-sciences', 'single-cell-rna-qc'),
};

// ── Settings read/write (merge-preserving) ───────────────────

interface Settings {
  [key: string]: any;
}

function readSettings(): Settings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    }
  } catch { throw new Error('智能体 settings.json 无法读取或格式无效；为避免覆盖原配置，已停止自动接入。'); }
  return {};
}

function writeSettings(settings: Settings): void {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

// ── Hook installation ─────────────────────────────────────────

function ensureHook(
  settings: Settings,
  event: 'UserPromptSubmit' | 'PreToolUse',
  matcher: string,
  command: string,
  timeout = 15
): boolean {
  const hooks = settings.hooks ?? (settings.hooks = {});
  const list: any[] = hooks[event] ?? (hooks[event] = []);
  // 迁移：若同一命令已存在于其它 matcher 块下，更新该块 matcher（避免重复块）
  const existingByCmd = list.find((b) =>
    (b.hooks ?? []).some((h: any) => h.command === command && h.type === 'command')
  );
  if (existingByCmd && existingByCmd.matcher !== matcher) {
    existingByCmd.matcher = matcher;
    return true;
  }
  // 找到同 matcher 的块
  let block = list.find((b) => b.matcher === matcher);
  if (!block) {
    block = { matcher, hooks: [] };
    list.push(block);
  }
  const cmdArr: any[] = block.hooks ?? (block.hooks = []);
  if (cmdArr.some((h) => h.command === command && h.type === 'command')) return false;
  cmdArr.push({ type: 'command', command, timeout });
  return true;
}

export interface InstallReport {
  settingsChanged: boolean;
  hooks: string[];
  agents: string[];
  codexSkills: string[];
  claudeMd: 'created' | 'updated' | 'none';
  contextFile: string;
}

export function installAll(workspaceRoot?: string): InstallReport {
  const report: InstallReport = { settingsChanged: false, hooks: [], agents: [], codexSkills: [], claudeMd: 'none', contextFile: '' };

  // 1. 保留原有权限；安装 hook 不应自动扩大工具授权或目录访问。
  let settings = readSettings();
  let changed = false;

  // 2. 安装 hooks
  const promptCmd = `bash ${path.join(HOOKS_DIR(), 'prompt_inject.sh')}`;
  const gateCmd = `bash ${path.join(HOOKS_DIR(), 'gate_tools.sh')}`;
  if (ensureHook(settings, 'UserPromptSubmit', 'UserPromptSubmit', promptCmd, 10)) {
    report.hooks.push('UserPromptSubmit/prompt_inject');
    changed = true;
  }
  if (ensureHook(settings, 'PreToolUse', 'Edit|Write|Bash', gateCmd, 10)) {
    report.hooks.push('PreToolUse/gate_tools');
    changed = true;
  }

  if (changed) {
    writeSettings(settings);
    report.settingsChanged = true;
  }

  // 3. 安装 agents（幂等，内容比对）
  report.agents = installAgents();

  // 4. 安装 Codex skills（幂等符号链接；仅更新本扩展管理的同名入口）
  report.codexSkills = ensureCodexSkills();

  // 5. CLAUDE.md / AGENTS.md 常驻上下文
  if (workspaceRoot) {
    report.contextFile = ensureClaudeContext(workspaceRoot);
    report.claudeMd = report.contextFile ? 'updated' : 'none';
  }

  return report;
}

// ── Agents ────────────────────────────────────────────────────

const AGENT_FILES = [
  'literature-search.md',
  'data-acquisition.md',
  'statistical-analysis.md',
  'manuscript-writing.md',
  'quality-audit.md',
];

/** agent 模板占位符 → 安装时按实际 EXT_ROOT 替换（上架后路径自包含；须在 install 时计算，避免模块加载期固化） */
function renderAgentContent(raw: string): string {
  let out = raw;
  out = out.replace(/\{\{DDJ_SCRIPTS\}\}/g, path.join(EXT_ROOT, 'scripts'));
  return out;
}

function installAgents(): string[] {
  fs.mkdirSync(AGENTS_DST, { recursive: true });
  const installed: string[] = [];
  for (const name of AGENT_FILES) {
    const src = path.join(AGENTS_SRC(), name);
    const dst = path.join(AGENTS_DST, name);
    if (!fs.existsSync(src)) continue;
    const srcContent = renderAgentContent(fs.readFileSync(src, 'utf-8'));
    const dstExists = fs.existsSync(dst);
    const dstContent = dstExists ? fs.readFileSync(dst, 'utf-8') : '';
    if (!dstExists || dstContent !== srcContent) {
      fs.writeFileSync(dst, srcContent, 'utf-8');
      installed.push(name);
    }
  }
  return installed;
}

// ── Codex skills ──────────────────────────────────────────────

function ensureCodexSkills(): string[] {
  fs.mkdirSync(CODEX_SKILLS_DST, { recursive: true });
  const changed: string[] = [];

  for (const [name, target] of Object.entries(CODEX_SKILL_LINKS)) {
    const skillMd = path.join(target, 'SKILL.md');
    if (!fs.existsSync(skillMd)) {
      changed.push(`missing:${name}`);
      continue;
    }

    const dst = path.join(CODEX_SKILLS_DST, name);
    if (!fs.existsSync(dst)) {
      fs.symlinkSync(target, dst, 'dir');
      changed.push(`linked:${name}`);
      continue;
    }

    const stat = fs.lstatSync(dst);
    if (!stat.isSymbolicLink()) {
      changed.push(`skip-existing:${name}`);
      continue;
    }

    const current = path.resolve(path.dirname(dst), fs.readlinkSync(dst));
    const expected = path.resolve(target);
    if (current !== expected) {
      fs.unlinkSync(dst);
      fs.symlinkSync(target, dst, 'dir');
      changed.push(`relinked:${name}`);
    }
  }

  return changed;
}

// ── CLAUDE.md @import 上下文 ─────────────────────────────────

const CONTEXT_MARKER = '@叮咚鸡_pipeline_context.md';
const CONTEXT_FILENAME = '叮咚鸡_pipeline_context.md';

export function ensureClaudeContext(workspaceRoot: string): string {
  const contextFile = path.join(workspaceRoot, CONTEXT_FILENAME);
  const claudeMd = path.join(workspaceRoot, 'CLAUDE.md');
  const agentsMd = path.join(workspaceRoot, 'AGENTS.md');

  // 写/刷新上下文文件
  writePipelineContext(contextFile, workspaceRoot);

  // 确保导入文件引用了上下文（Claude: CLAUDE.md；Codex: AGENTS.md 自动读取）
  const ensureImport = (p: string): void => {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf-8');
      if (!content.split('\n').some((l) => l.trim().startsWith(CONTEXT_MARKER))) {
        const sep = content.endsWith('\n') ? '' : '\n';
        fs.writeFileSync(p, content + sep + CONTEXT_MARKER + '\n', 'utf-8');
      }
    } else {
      fs.writeFileSync(p, `# ${path.basename(workspaceRoot)}\n\n${CONTEXT_MARKER}\n`, 'utf-8');
    }
  };
  ensureImport(claudeMd);
  ensureImport(agentsMd);

  // Cursor 规则（多智能体通用：Cursor 自动读取 .cursor/rules/）
  try {
    const cursorDir = path.join(workspaceRoot, '.cursor', 'rules');
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.writeFileSync(
      path.join(cursorDir, 'dingdongji.mdc'),
      [
        '---',
        'description: 叮咚鸡研究管线上下文（自动生成，请勿手改）',
        'globs: **/*',
        '---',
        '',
        `@${CONTEXT_FILENAME}`,
        '',
      ].join('\n'),
      'utf-8'
    );
  } catch { /* ignore */ }

  return contextFile;
}

export function writePipelineContext(contextFile: string, workspaceRoot: string): void {
  const statePath = path.join(workspaceRoot, '工程文件', '00_pipeline_state.json');
  const lines: string[] = [];
  lines.push('# 叮咚鸡管线上下文（自动生成，请勿手改）');
  lines.push('');

  try {
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      const current = state.steps.find((s: any) => s.id === state.current_step) ?? state.steps[0];
      lines.push(`## 当前管线：${state.scenario}`);
      lines.push(`- 当前步骤：**${current?.label ?? '—'}**（${state.enforcement_mode === 'hard' ? '硬约束模式' : '软约束模式'}）`);
      lines.push('- 本步骤允许：' + (current?.allowed ?? []).join('；'));
      if (current?.blocked_paths?.length) {
        lines.push('- 全局禁止（触碰最终产出）：' + current.blocked_paths.join('、'));
      }
      if (current?.next) lines.push(`- 下一步：${current.next}`);
      lines.push('- 能力提示：文献检索、数据分析、统计建模为全局能力，任何步骤均可调用。');
      lines.push('- 自主推进：完成当前步骤产出物后，运行 `curl -s -X POST http://127.0.0.1:19999/api/pipeline/advance` 进入下一步；也可在仪表盘点击「进入下一步」。');
      lines.push('- 深度定制：你是研究计划的主导者，可自主增删改步骤——添加 `POST /api/pipeline/add-step`、删除 `remove-step`、重排 `move-step`、修改 `update-step`（预设场景仅参考）。');

      lines.push('');
      lines.push('## 🧬 生物医学技能装备（Codex skills）');
      lines.push('- 技能入口位于 `~/.codex/skills/`，由叮咚鸡扩展幂等同步到 `~/ddj/skills/` 下的源目录。');
      lines.push('- 触发下列任务时，必须先读取对应技能目录的 `SKILL.md` 再执行：');
      lines.push('  - `protein_analysis`：蛋白序列统计、突变评估、UniProt 注释。');
      lines.push('  - `sequence_analysis`：核酸/蛋白类型检测、双序列比对、kmer 统计。');
      lines.push('  - `clinical-trial-protocol-skill`：临床试验方案/FDA 模板/样本量计算。');
      lines.push('  - `single-cell-rna-qc`：单细胞 RNA 质控与过滤。');
      lines.push('  - `scvi-tools`：scVI/scANVI/totalVI/PeakVI/MultiVI 等深度学习单细胞分析。');
      lines.push('  - `nextflow-development`：nf-core/Nextflow 生信流程开发与运行。');
      lines.push('  - `scientific-problem-selection`：科学问题选题、项目策略、风险评估。');
      lines.push('  - `instrument-data-to-allotrope`：仪器数据转 Allotrope ASM JSON/扁平 CSV。');
      lines.push('- 技能纪律：本地计算 → 证据溯源（PMID/DOI/UniProt accession/工具输出路径）→ 无来源断言标注「[未核实]」。');

      // 知识库阅读顺序（2026-08-10 修复：全局库 → 交接班 → 项目库）
      lines.push('');
      lines.push('## 📚 知识库阅读顺序（每次开工）');
      lines.push('1. **先读全局知识库**：`~/ddj/kb/_digest.md`（摘要，每轮注入）+ `~/ddj/kb/index.json`（全局教训/经验/新工具）。');
      lines.push('2. **再读交接班**：「工程文件/交接班.md」（上一窗口进展/待办/遗留问题）。');
      lines.push('3. **最后读项目知识库**：「工程文件/kb/」（本项目维护记录/工作记忆/文献）。');

      // 交接班提示（改进3：多窗口协同时先读交接班）
      const handoffPath = path.join(workspaceRoot, '工程文件', '交接班.md');
      if (fs.existsSync(handoffPath)) {
        lines.push('');
        lines.push('## 🔄 存在交接班文件（多窗口协同）');
        lines.push(`- **必须先阅读** 「工程文件/交接班.md」，确认上一工作窗口的进展、待办、遗留问题。`);
        lines.push('- 在交接班记录范围内继续工作；完成后可在叮咚鸡仪表盘标记「已处理」。');
      }

      // 项目知识库（维护记录/工作记忆/文献索引）
      const projKbRoot = path.join(workspaceRoot, '工程文件', 'kb');
      const projKbFiles: string[] = [];
      for (const sub of ['memory', 'learnings', 'papers', 'data-dicts', 'sop', 'journals']) {
        const dir = path.join(projKbRoot, sub);
        if (fs.existsSync(dir)) {
          for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
            projKbFiles.push(`${sub}/${f}`);
          }
        }
      }
      if (projKbFiles.length) {
        lines.push('');
        lines.push('## 📁 项目知识库（工程文件/kb/）');
        lines.push('- 本项目维护记录/工作记忆/文献见下，开工按阅读顺序第 3 步阅读：');
        for (const f of projKbFiles.slice(-12)) lines.push(`  - \`工程文件/kb/${f}\``);
      }

      // 审计提示（审计×管线深度融合）
      const manifestPath = path.join(workspaceRoot, '工程文件', 'artifact_manifest.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          const chain = m.chain_hash ? '已建立' : '待建立';
          lines.push('');
          lines.push('## 🛡️ 审计状态');
      lines.push(`- 工件指纹哈希链：${chain}（${Object.keys(m.artifacts || {}).length} 个产物已指纹，可检查变化；不等于科学正确性或不可篡改认证）`);
          lines.push('- 完成步骤后自动记录指纹；产物被修改会触发审计告警。');
          lines.push('- 文献步骤完成后自动生成 PRISMA 流程数据（prisma_flow_data.csv）。');
        } catch { /* ignore */ }
      }
      lines.push('');
    } else {
      lines.push('未检测到管线状态。在叮咚鸡仪表盘选择研究场景以激活管线约束。');
      lines.push('');
    }
  } catch { /* ignore */ }

  lines.push('## 研究知识库（两级）');
  lines.push(`> 全局库摘要：${path.join(process.env.HOME || '', 'ddj', 'kb', '_digest.md')}（每轮由 hook 注入）；完整库：\`~/ddj/kb/\`；项目库：\`工程文件/kb/\`。`);
  lines.push('- **写入策略**：项目维护记录/进展/文献/数据 → `工程文件/kb/`；仅 叮咚鸡本体调整、全局可复用经验教训、新工具注册 → `~/ddj/kb/`。');
  lines.push('- **阅读顺序**：先全局库 → 再交接班 → 最后项目库。');
  lines.push('');
  lines.push('## 强制规则');
  lines.push('1. 严格遵循当前管线的步骤顺序，完成当前步骤并通过仪表盘「进入下一步」后才可推进。');
  lines.push('2. 未完成当前步骤前不得触碰禁止路径。后端验收在后端执行；PreToolUse 路径拦截仅适用于已安装并实际调用该 hook 的宿主，不代表所有智能体都具备同等强制拦截。');
  lines.push('3. 研究过程中的新发现/文献/经验请追加到知识库：项目相关内容写 `工程文件/kb/`；仅全局可复用教训/新工具写 `~/ddj/kb/`。');
  lines.push('4. 引用纪律（Rule 2）：手稿每条引用必须来自真实检索，不得编造 DOI；写入前跨库审计（见 manuscript-writing agent 五关卡）。');
  lines.push('');

  // ── Rule 1：文件管理纪律（从 SKILL.md 迁移）──
  lines.push('## 文件管理纪律（Rule 1）');
  lines.push('- 四目录结构：`工程文件/`（代码+中间数据）、`结果文件/{tables,figures,manuscript}/`、`手稿文书/`、`原始数据/`。');
  lines.push('- 项目启动先建目录：`mkdir -p 工程文件 结果文件/{tables,figures,manuscript} 手稿文书 原始数据`');
  lines.push('- 命名：`工程文件/<模块><序号>_<动作>.py/.R`（A文献/B数据/C生信/D统计/E写作），如 `D2_meta_analysis.R`；结果放 `结果文件/{tables,figures}/`。');
  lines.push('- manifest：`工程文件/00_bus_manifest.json` 记录 project/research_question/scenario/checkpoint。');
  lines.push('- 原始数据保持原样，不入 git（.gitignore 含 `原始数据/`、`*.XPT *.dta` 等）。');
  lines.push('');

  // ── 执行规则（从 SKILL.md 迁移）──
  lines.push('## 执行规则');
  lines.push('1. 写任何代码前先建四目录结构（Rule 1）。');
  lines.push('2. 引用必真：Checkpoint 1→5 对任何含引用的写作任务不可跳过。');
  lines.push('3. 写作检索前先问：是否需要包含中文文献（是则同步 CNKI + PubMed/Scopus/WoS）。');
  lines.push('4. 引用进手稿前必审计（跨 ≥2 库核对，CNKI 用 find_best_match）。');
  lines.push('5. 完成手稿必须生成 `结果文件/manuscript/literature_library.ris`。');
  lines.push('6. 外部服务不可用时执行降级策略并告知受影响部分。');
  lines.push('7. 密钥从 `~/ddj/api_keys.json` 加载（`source ~/ddj/load_keys.sh`）。');
  lines.push('8. 动作前先查 `curl http://127.0.0.1:19999/api/status` 确认模块健康。');
  lines.push('9. 不得通过修改管线状态、删除证据、关闭约束或重写指纹绕过验收。假设、模拟数据与真实观测必须分开；运行失败或结果未核验不得声称完成。');
  lines.push('10. 数据库、搜索 API 由用户在官方平台注册申请；协助提供教程与配置指引，不索要或输出密钥。凭据仅配置在本地后端密钥库。');

  fs.mkdirSync(path.dirname(contextFile), { recursive: true });
  fs.writeFileSync(contextFile, lines.join('\n') + '\n', 'utf-8');
}

// ── 卸载（移除扩展时清理）──────────────────────────────────────

export function uninstallAll(): void {
  // 从 settings.json 移除本扩展安装的 hooks
  const settings = readSettings();
  if (settings.hooks) {
    for (const event of ['UserPromptSubmit', 'PreToolUse'] as const) {
      const list: any[] = settings.hooks[event] ?? [];
      settings.hooks[event] = list.filter(
        (b) => !(b.hooks ?? []).some((h: any) => (h.command || '').includes(EXT_ROOT))
      );
      if (!settings.hooks[event].length) delete settings.hooks[event];
    }
    if (!Object.keys(settings.hooks).length) delete settings.hooks;
  }
  writeSettings(settings);

  // 移除 agents
  for (const name of AGENT_FILES) {
    const dst = path.join(AGENTS_DST, name);
    if (fs.existsSync(dst)) fs.unlinkSync(dst);
  }
}
