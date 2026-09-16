// 叮咚鸡 V2.1 Webview — 左侧栏布局 + 全量 i18n（中/英）+ 亮暗主题
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  window.ddjHost = vscode;
  if (!document.body.classList.contains('fusion')) {
    const gate = document.createElement('section'); gate.id = 'ddj-mode-gate'; gate.hidden = true;
    gate.setAttribute('aria-label', '独立页面操作引导');
    gate.innerHTML = '<span>DDJ / WORKSPACE</span><h2>请在独立页面中操作</h2><p>生物医学整合研究平台已在独立页面打开。侧栏暂时作为预览，避免重复操作。</p><button id="ddj-focus-fusion">前往独立页面 ↗</button><button id="ddj-use-external">切换为外挂模式</button><small role="status"></small>';
    document.body.appendChild(gate);
    gate.querySelector('#ddj-focus-fusion').onclick = () => vscode.postMessage({ command: 'openFusion' });
    gate.querySelector('#ddj-use-external').onclick = () => vscode.postMessage({ command: 'fusionMode', external: true });
    window.addEventListener('message', ({ data: m }) => {
      if (m.type !== 'fusionMode') return;
      const locked = !!m.panelOpen && !m.external;
      gate.hidden = !locked; document.body.classList.toggle('ddj-detached-mode', locked);
      const app = document.getElementById('app');
      if (app) { app.inert = locked; if (locked) app.setAttribute('aria-hidden', 'true'); else app.removeAttribute('aria-hidden'); }
      const entry = document.getElementById('ddj-enter-fusion'); if (entry) entry.hidden = locked;
      gate.querySelector('#ddj-use-external').disabled = !!m.switching;
      gate.querySelector('small').textContent = m.switching ? '正在打开外挂窗口…' : m.message || '项目与内置会话保留；切换不会自动迁移对话历史。';
    });
  }
  vscode.postMessage({ command: 'fusionModeStatus' });
  document.getElementById('ddj-enter-fusion')?.addEventListener('click', () => vscode.postMessage({ command: 'openFusion' }));

  const state = {
    tab: 'dashboard',
    collapsed: !!(vscode.getState && (vscode.getState() || {}).collapsed),
    status: null,
    backendState: null,
    activities: [],
    pipeline: null,
    projectName: '',
    scenarioList: [],
    kbEntries: [],
    kbType: '',
    kbScope: '',
    kbQuery: '',
    showAddForm: false,
    showAuditForm: false,
    showReviewForm: false,
    digest: '',
    handoff: null,
    projectLib: null,
    theme: '',
    lang: '',
    agent: '',
    extTools: [],
    codexFusion: null,
    literature: [],
    runs: [],
    ideas: [],
    questionClusters: [],
    researchPlans: [],
    conclusions: [],
    conclusionError: '',
    conclusionTraces: {},
    selectedLiterature: null,
    apiInventory: null,
    anchor: null,
    citations: null,
    citationBusy: false,
    workspaceInput: '',
    updatedAt: '',
    plot: {
      busy: { checking: false, rendering: false, generating: false, listing: false, auditing: false, stats: false },
      check: null,
      audit: null,
      stats: null,
      samples: [],
      files: [],
      last: null,
      lightbox: null,
      form: {
        csv: '', type: 'scatter', x: '', y: '', group: '', title: '',
        name: 'figure', format: 'png', style: 'nature', palette: 'viridis',
        width: '3.5', height: '2.6', dpi: '300',
      },
    },
  };

  const app = document.getElementById('app');

  let activeToast;
  function showToast(msg, level) {
    activeToast?.remove();
    const el = document.createElement('div');
    activeToast = el;
    el.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:var(--' + (level === 'warn' ? 'yl' : level === 'error' ? 'rd' : 'ac') + ');color:#fff;padding:8px 14px;border-radius:6px;font-size:11px;z-index:999;box-shadow:0 2px 8px rgba(0,0,0,.4);max-width:90%';
    el.textContent = msg;
    el.style.color = 'var(--bg)';
    el.setAttribute('role', level === 'warn' || level === 'error' ? 'alert' : 'status');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function send(cmd, extra) {
    vscode.postMessage(Object.assign({ command: cmd }, extra || {}));
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 占位符替换：fmt(t('key'), {a:1}) → {a} → 1
  function fmt(s, vars) {
    if (!s) return s;
    return s.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? vars[k] : m));
  }

  // ── 全量 i18n 字典（中/英）──
  const I18N = {
    zh: {
      appTitle: '叮咚鸡', subTitle: '生物医学研究整合助手',
      openClaude: '启动 Claude Code', openCodex: '打开 Codex', openCodexHint: '进入 Codex for VS Code（openai.chatgpt）',
      noProject: '未连接项目',
      collapse: '收起侧栏', expand: '展开侧栏',
      tabDashboard: '仪表盘', tabTools: '工具', tabKb: '全局知识库',
      tabIdeas: 'Idea 树', tabConclusions: '研究结论',
      tabQuestions: '科学问题',
      tabPlans: '计划与执行',
      tabProject: '项目资料库', tabPlot: '绘图', tabSettings: '设置',
      plotModule: '科研绘图', plotStack: '绘图栈体检',
      plotCheck: '🔍 体检绘图栈', plotCheckHint: '体检 Python 8 包 + R 16 包版本（ddj-plot-check）',
      plotStatus: '状态',
      plotSamples: '样例图库', plotSamplesRun: '🖼 渲染并预览样例图',
      plotSamplesNone: '尚未渲染样例 — 点击上方按钮生成（约 1-2 分钟）',
      plotGenerate: '数据出图', plotType: '图类型',
      plotType_scatter: '散点+趋势', plotType_line: '折线图', plotType_hist: '直方图',
      plotType_box: '箱线图+显著性', plotType_bar: '均值±SD 柱状图', plotType_volcano: '火山图',
      plotX: 'X 列', plotY: 'Y 列', plotGroup: '分组列', plotGroupPh: '可选，box 必填',
      plotTitle: '标题', plotOut: '文件名', plotFormat: '格式', plotStyle: '期刊样式',
      plotPalette: '配色', plotSize: '尺寸', plotTwoCol: '双栏 3.5in', plotOneCol: '单栏 7in',
      plotDpi: 'DPI', plotRun: '⚡ 生成图片（存至 结果文件/figures/）',
      plotResult: '生成结果', plotOpen: '打开',
      plotHistory: '历史图库（结果文件/figures/）', plotRefresh: '🔄 刷新',
      plotHistoryNone: '暂无历史图 — 生成的图片会自动存入 结果文件/figures/',
      plotUnavailable: '预览不可用',
      figureAudit: '图片审计',
      figureAuditRun: '🔍 本地审计',
      figureAuditAi: '🤖 AI 语义审计',
      figureAuditNone: '尚未审计图片',
      statsReport: '统计报告',
      statsReportRun: '📊 生成统计报告',
      citationTitle: '引用跨库核验',
      citationDesc: '后端逐条解析项目内引用，并在 PubMed 与 Crossref 两个独立库交叉核对；任一冲突、未找到、撤稿信号或来源不可用都不会判定为通过。',
      citationRun: '🔁 重新核验',
      citationEmpty: '尚未发现可核验引用（支持 手稿文书/、结果文件/manuscript/ 下的 md/txt/tex 与 .ris/.bib）。',
      citationPending: '后端正在核验…',
      citationPass: '✅ 全部引用通过双库核验',
      citationFail: '⚠️ 核验未全部通过',
      citationStale: '结果已过期，将自动重跑',
      citationRefs: '引用',
      citationVerified: '通过',
      citationConflict: '冲突',
      citationNotFound: '未找到',
      citationReview: '待审',
      citationUnavailable: '不可用',
      citationPendingCount: '待完成',
      citationCoverage: '解析覆盖问题',
      citationReport: '报告',
      citationNoSources: '无来源',
      citationStatusVerified: '通过',
      citationStatusConflict: '冲突',
      citationStatusNotFound: '未找到',
      citationStatusReview: '待审',
      citationStatusUnavailable: '不可用',
      citationStatusPending: '待完成',
      plotHint_scatter: '散点 + 线性趋势线；需要 x、y 列。',
      plotHint_line: '折线图；x、y 必填，分组列可选。',
      plotHint_hist: '直方图；仅需 y 列（或 x 列）。',
      plotHint_box: '箱线图 + Mann-Whitney 显著性标注；需要 y 与分组列。',
      plotHint_bar: '均值±SD 柱状图；需要 x、y 列，分组列可选。',
      plotHint_volcano: '火山图；x=log2FC、y=pvalue，阈值 |FC|>1、p<0.05。',
      projRis: '文献 RIS 库', projRisNone: '暂无 RIS 文献 — 文献步骤完成后会生成 literature_library.ris',
      literatureWindow: '文献库（RIS + 知识库）',
      literatureSearch: '🔍 搜索标题 / 作者 / 期刊 / DOI…',
      literatureNone: '暂无结构化文献',
      projSearchLog: '检索记录', projSearchLogNone: '暂无检索记录',
      projNotes: '经验教训 / 笔记', projNotesNone: '暂无笔记 — 点击「＋ 新增笔记」记录项目经验',
      projAudit: '审计记录', projAuditAdd: '＋ 追加审计记录',
      projAuditTitlePh: '审计事件标题（如：产物指纹核验 / PRISMA 流程）', projAuditBodyPh: '审计详情：时间、范围、结论、告警……',
      projReview: '审稿意见', projReviewAdd: '＋ 追加审稿意见',
      projReviewTitlePh: '意见标题（如：Reviewer 1 返修意见）', projReviewBodyPh: '意见内容 + 处理状态……',
      pipelineLabel: '管线进度', constraint: '约束模式',
      softMode: '软约束', hardMode: '硬约束', handoff: '交接班', env: '环境',
      exists: '存在', none: '无', noPipeline: '未创建管线',
      stepsUnit: '步', currentColon: '当前:', heroFoot: '生物医学研究助手',
      recentAct: '最近活动', noActivity: '暂无活动',
      pipelineProgress: '管线进度管理', progress: '进度',
      selectScenario: '选择研究场景以激活管线约束',
      projectName: '项目名称（默认=工作区名）', scanKb: '🔍 扫描并丰富知识库',
      customPlan: '📝 自定义计划（模板仅作参考）', now: '当前', stale: '待重跑',
      moveUp: '上移', moveDown: '下移', remove: '删除', artifacts: '产出:',
      addStep: '＋ 添加自定义步骤', upcoming: '⏭️ 后续计划',
      stepHistory: '🕐 智能体步骤切换实时', waiting: '等待智能体推进步骤…',
      softSub: '软约束（提醒）', hardSub: '硬约束（拦截）',
      rollbackBtn: '⬅ 回退上一步', advanceBtn: '进入下一步 ➡',
      refresh: '🔄 刷新状态', scan: '🔍 扫描知识库', resetPipeline: '↺ 重置管线',
      pause: '⏸ 暂停项目（生成交接班）', resume: '▶️ 接手（标记已处理）',
      handoffBanner: '🔄 存在交接班文件（{time}）',
      handoffBannerSub: '下一位智能体接手前先读「工程文件/交接班.md」',
      modA: '文献检索', modB: '公共数据', modC: '生信', modD: '统计引擎', modE: '写作输出',
      modADesc: 'ai4scholar / Scopus / WoS / CNKI',
      modBDesc: 'NHANES / CHARLS / CHNS / IPUMS',
      modCDesc: 'GEO / scanpy / pydeseq2',
      modDDesc: 'metafor / netmeta / statsmodels',
      modEDesc: '手稿 / RIS / docx',
      notDetected: '未检测',
      extTools: '🔌 扩展工具', extToolsTitle: '智能体自主扩展工具',
      codexFusion: '🤖 Codex 融合', codexFusionSub: 'Codex 自动感知管线-交接班-审计制度',
      fusionAgentsMd: '工作区 AGENTS.md 上下文', fusionDdjCli: 'ddj CLI 入口',
      fusionCtxTime: '管线上下文更新时间', fusionReady: '已就绪', fusionMissing: '缺失',
      codexWorkbench: 'Codex 工作台', codexWorkbenchSub: '官方扩展 · 项目上下文与技能就绪度',
      codexOpen: '打开 Codex', codexContext: '交给 Codex 项目上下文',
      codexInstalled: 'Codex 扩展', codexConfig: 'Codex 配置', codexSkills: '生物医学技能', codexContextFiles: '项目上下文',
      codexEyebrow: 'CODEX × DINGDONGJI', codexDashboardTitle: 'Codex 研究工作台',
      codexDashboardSub: '把项目上下文、技能和审计状态汇入一个可执行的工作面。',
      codexExecution: '本次执行', codexExtensionStatus: '扩展状态', codexContextStatus: '项目上下文',
      codexSkillsStatus: '技能就绪', codexAuditStatus: '审计链', codexPipelineStatus: '当前管线',
      codexOpenHint: '在 VS Code 中继续解释、编辑、审查或委派任务',
      codexContextHint: '同步管线、交接班与审计文件后附加到 Codex 对话',
      fusionNever: '未生成',
      registered: '{n} 个已注册', noExt: '暂无扩展工具 — 智能体获取新 MCP / Skill / CLI 后会自动注册到这里',
      aboutTools: '关于工具',
      aboutToolsDesc: 'A-E 为研究流程工具（文献检索 / 公共数据 / 生信 / 统计 / 写作），F 为叮咚鸡智能体自主扩展的工具（如 wps-cli 等）。',
      extToolsFoot: '新工具由叮咚鸡智能体自动注册（curl /api/ext-tools/register），并在全局知识库更新条目',
      allTypes: '全部', paper: '文献', data: '数据', sop: 'SOP', journal: '期刊', learning: '经验',
      globalKb: '🌐 全局知识库', projectKb: '📁 项目知识库',
      searchGlobal: '🔍 搜索全局知识库…', searchProject: '🔍 搜索项目资料…',
      addNote: '＋ 新增笔记', kbDigest: '知识库摘要（注入上下文）',
      noMatch: '无匹配条目', kbEmpty: '📭 知识库为空',
      kbEmptySub: '点击上方「扫描知识库」，或在管线完成文献步骤后自动摄取文献',
      titlePh: '标题', bodyPh: '内容（markdown）', save: '保存',
      globalScope: '全局', projectScope: '项目',
      projectLib: '📁 项目资料库', currentProject: '📍 当前项目',
      notConnected: '未连接', scenarioColon: '场景:',
      themeLabel: '🌗 主题', dark: '暗色', light: '亮色', autoTheme: '跟随系统',
      healthCard: '系统健康',
      apiCard: '本地 API 管理',
      anchorCard: '审计锚点',
      bindWorkspace: '绑定工作区',
      bindWorkspacePh: '输入项目路径后按 Enter',
      langLabel: '🌐 语言', zh: '简体中文', en: 'English',
      agentLabel: '🤖 默认智能体', agentClaude: 'Claude Code', agentCodex: 'Codex',
      settingsSave: '设置将保存到 VSCode 配置。',
      auditWarn: '🔍 审计告警：', auditOk: '✅ ',
      stepSwitchToast: '🔄 智能体已切换步骤：{from} → {to}（{at}）',
      artifactWarn: '⚠️ 已完成「{step}」，但产出物缺失：{missing}。请确认已完成。',
      kbDenied: '已取消写入全局知识库',
      lessonOnly: '全局知识库只保存跨项目教训；普通笔记请到项目资料库新增。',
    },
    en: {
      appTitle: 'DingDongJi', subTitle: 'Biomedical Research Assistant',
      openClaude: 'Launch Claude Code', openCodex: 'Open Codex', openCodexHint: 'Open Codex for VS Code (openai.chatgpt)',
      noProject: 'No project connected',
      collapse: 'Collapse sidebar', expand: 'Expand sidebar',
      tabDashboard: 'Dashboard', tabTools: 'Tools', tabKb: 'Global KB',
      tabIdeas: 'Idea Tree', tabConclusions: 'Conclusions',
      tabQuestions: 'Questions',
      tabPlans: 'Plans & Runs',
      tabProject: 'Project', tabPlot: 'Plot', tabSettings: 'Settings',
      plotModule: 'Scientific Plotting', plotStack: 'Plot stack check',
      plotCheck: '🔍 Check plot stack', plotCheckHint: 'Check Python 8 pkgs + R 16 pkgs (ddj-plot-check)',
      plotStatus: 'Status',
      plotSamples: 'Sample gallery', plotSamplesRun: '🖼 Render & preview samples',
      plotSamplesNone: 'No samples yet — click the button above (~1-2 min)',
      plotGenerate: 'Generate from data', plotType: 'Type',
      plotType_scatter: 'Scatter+trend', plotType_line: 'Line', plotType_hist: 'Histogram',
      plotType_box: 'Box+significance', plotType_bar: 'Mean±SD bar', plotType_volcano: 'Volcano',
      plotX: 'X col', plotY: 'Y col', plotGroup: 'Group col', plotGroupPh: 'optional; required for box',
      plotTitle: 'Title', plotOut: 'File name', plotFormat: 'Format', plotStyle: 'Journal style',
      plotPalette: 'Palette', plotSize: 'Size', plotTwoCol: '2-col 3.5in', plotOneCol: '1-col 7in',
      plotDpi: 'DPI', plotRun: '⚡ Generate figure (→ 结果文件/figures/)',
      plotResult: 'Result', plotOpen: 'Open',
      plotHistory: 'History (结果文件/figures/)', plotRefresh: '🔄 Refresh',
      plotHistoryNone: 'No figures yet — generated images go to 结果文件/figures/',
      plotUnavailable: 'Preview unavailable',
      figureAudit: 'Figure Audit',
      figureAuditRun: '🔍 Local audit',
      figureAuditAi: '🤖 AI semantic audit',
      figureAuditNone: 'No figure audit yet',
      statsReport: 'Stats Report',
      statsReportRun: '📊 Generate stats report',
      citationTitle: 'Citation Cross-Database Verification',
      citationDesc: 'The backend parses every project reference and checks it against two independent databases (PubMed + Crossref). Conflicts, missing records, retraction signals, or unavailable sources never count as verified.',
      citationRun: '🔁 Re-verify',
      citationEmpty: 'No verifiable references found yet (supports md/txt/tex under 手稿文书/, 结果文件/manuscript/ and .ris/.bib).',
      citationPending: 'Backend verification in progress…',
      citationPass: '✅ All references verified across two databases',
      citationFail: '⚠️ Verification not fully passed',
      citationStale: 'Results are stale; a re-run will be queued',
      citationRefs: 'Refs',
      citationVerified: 'Verified',
      citationConflict: 'Conflict',
      citationNotFound: 'Not found',
      citationReview: 'Review',
      citationUnavailable: 'Unavailable',
      citationPendingCount: 'Pending',
      citationCoverage: 'Parsing coverage issues',
      citationReport: 'Report',
      citationNoSources: 'No source',
      citationStatusVerified: 'Verified',
      citationStatusConflict: 'Conflict',
      citationStatusNotFound: 'Not found',
      citationStatusReview: 'Needs review',
      citationStatusUnavailable: 'Unavailable',
      citationStatusPending: 'Pending',
      plotHint_scatter: 'Scatter + linear trend; requires x, y.',
      plotHint_line: 'Line chart; x, y required; group optional.',
      plotHint_hist: 'Histogram; y (or x) column only.',
      plotHint_box: 'Boxplot + Mann-Whitney stars; requires y and group.',
      plotHint_bar: 'Mean±SD bar; requires x, y; group optional.',
      plotHint_volcano: 'Volcano; x=log2FC, y=pvalue; |FC|>1, p<0.05.',
      projRis: 'RIS Library', projRisNone: 'No RIS files — literature_library.ris is generated after the literature step',
      literatureWindow: 'Literature Library (RIS + KB)',
      literatureSearch: '🔍 Search title / author / journal / DOI…',
      literatureNone: 'No structured literature',
      projSearchLog: 'Search Logs', projSearchLogNone: 'No search logs',
      projNotes: 'Learnings & Notes', projNotesNone: 'No notes yet — click "+ New note" to record project learnings',
      projAudit: 'Audit Records', projAuditAdd: '＋ Append audit record',
      projAuditTitlePh: 'Audit event title (e.g. artifact fingerprint check / PRISMA)', projAuditBodyPh: 'Details: time, scope, conclusion, alerts…',
      projReview: 'Review Comments', projReviewAdd: '＋ Append review comment',
      projReviewTitlePh: 'Comment title (e.g. Reviewer 1 revisions)', projReviewBodyPh: 'Comments + handling status…',
      pipelineLabel: 'Pipeline Progress', constraint: 'Enforcement',
      softMode: 'Soft', hardMode: 'Hard', handoff: 'Handoff', env: 'Env',
      exists: 'Yes', none: 'No', noPipeline: 'No pipeline',
      stepsUnit: 'steps', currentColon: 'Now:', heroFoot: 'Biomedical Research Assistant',
      recentAct: 'Recent Activity', noActivity: 'No activity',
      pipelineProgress: 'Pipeline Progress', progress: 'Progress',
      selectScenario: 'Select research scenario to activate pipeline',
      projectName: 'Project name (default=workspace)', scanKb: '🔍 Scan & enrich KB',
      customPlan: '📝 Custom plan (template is reference only)', now: 'Now', stale: 'Stale',
      moveUp: 'Move up', moveDown: 'Move down', remove: 'Remove', artifacts: 'Artifacts:',
      addStep: '＋ Add custom step', upcoming: '⏭️ Upcoming',
      stepHistory: '🕐 Live step switches', waiting: 'Waiting for agent…',
      softSub: 'Soft (advisory)', hardSub: 'Hard (blocking)',
      rollbackBtn: '⬅ Rollback', advanceBtn: 'Advance ➡',
      refresh: '🔄 Refresh', scan: '🔍 Scan KB', resetPipeline: '↺ Reset pipeline',
      pause: '⏸ Pause (handoff)', resume: '▶️ Resume (marked done)',
      handoffBanner: '🔄 Handoff exists ({time})',
      handoffBannerSub: 'Read 工程文件/交接班.md before taking over',
      modA: 'Literature Search', modB: 'Public Data', modC: 'Bioinformatics', modD: 'Statistics', modE: 'Writing',
      modADesc: 'ai4scholar / Scopus / WoS / CNKI',
      modBDesc: 'NHANES / CHARLS / CHNS / IPUMS',
      modCDesc: 'GEO / scanpy / pydeseq2',
      modDDesc: 'metafor / netmeta / statsmodels',
      modEDesc: 'Manuscript / RIS / docx',
      notDetected: 'Not detected',
      extTools: '🔌 Ext. Tools', extToolsTitle: 'Agent-managed tools',
      codexFusion: '🤖 Codex Fusion', codexFusionSub: 'Codex auto-loads pipeline/handoff/audit context',
      fusionAgentsMd: 'Workspace AGENTS.md context', fusionDdjCli: 'ddj CLI entry',
      fusionCtxTime: 'Pipeline context updated', fusionReady: 'Ready', fusionMissing: 'Missing',
      codexWorkbench: 'Codex Workbench', codexWorkbenchSub: 'Official extension · project context and skill readiness',
      codexOpen: 'Open Codex', codexContext: 'Send project context',
      codexInstalled: 'Codex extension', codexConfig: 'Codex config', codexSkills: 'Biomedical skills', codexContextFiles: 'Project context',
      codexEyebrow: 'CODEX × DINGDONGJI', codexDashboardTitle: 'Codex Research Workbench',
      codexDashboardSub: 'Bring project context, skills, and audit state into one actionable workspace.',
      codexExecution: 'Current run', codexExtensionStatus: 'Extension', codexContextStatus: 'Project context',
      codexSkillsStatus: 'Skills ready', codexAuditStatus: 'Audit chain', codexPipelineStatus: 'Current pipeline',
      codexOpenHint: 'Continue explaining, editing, reviewing, or delegating in VS Code',
      codexContextHint: 'Sync pipeline, handoff, and audit files into the Codex chat',
      fusionNever: 'Not generated',
      registered: '{n} registered', noExt: 'No ext tools — agent auto-registers new MCP / Skill / CLI here',
      aboutTools: 'About Tools',
      aboutToolsDesc: 'A-E: research pipeline tools (search / data / bioinfo / stats / writing). F: agent-extended tools (e.g. wps-cli).',
      extToolsFoot: 'New tools are auto-registered by the agent (curl /api/ext-tools/register) and indexed in the global KB',
      allTypes: 'All', paper: 'Papers', data: 'Data', sop: 'SOP', journal: 'Journals', learning: 'Learnings',
      globalKb: '🌐 Global KB', projectKb: '📁 Project KB',
      searchGlobal: '🔍 Search global KB…', searchProject: '🔍 Search project…',
      addNote: '＋ New note', kbDigest: 'KB digest (injected context)',
      noMatch: 'No matching entries', kbEmpty: '📭 KB is empty',
      kbEmptySub: 'Click "Scan KB" above, or papers are auto-ingested after the literature step',
      titlePh: 'Title', bodyPh: 'Content (markdown)', save: 'Save',
      globalScope: 'Global', projectScope: 'Project',
      projectLib: '📁 Project Library', currentProject: '📍 Current Project',
      notConnected: 'Not connected', scenarioColon: 'Scenario:',
      themeLabel: '🌗 Theme', dark: 'Dark', light: 'Light', autoTheme: 'Auto',
      healthCard: 'System Health',
      apiCard: 'Local API Management',
      anchorCard: 'Audit Anchor',
      bindWorkspace: 'Bind Workspace',
      bindWorkspacePh: 'Enter project path, then press Enter',
      langLabel: '🌐 Language', zh: '简体中文', en: 'English',
      agentLabel: '🤖 Default Agent', agentClaude: 'Claude Code', agentCodex: 'Codex',
      settingsSave: 'Settings saved to VSCode config.',
      auditWarn: '🔍 Audit warning: ', auditOk: '✅ ',
      stepSwitchToast: '🔄 Agent switched step: {from} → {to} ({at})',
      artifactWarn: '⚠️ "{step}" completed, but artifacts missing: {missing}. Please confirm.',
      kbDenied: 'Write to global KB cancelled',
      lessonOnly: 'Global KB only stores cross-project lessons; add ordinary notes in Project.',
    },
  };
  const t = (key) => { const d = I18N[state.lang === 'en' ? 'en' : 'zh']; return d[key] !== undefined ? d[key] : key; };

  // 日夜切换：设置 body 主题 class（配合 CSS 变量），事事即时切换
  function applyTheme(theme) {
    document.body.classList.remove('ddj-dark', 'ddj-light');
    if (theme === 'dark') document.body.classList.add('ddj-dark');
    else if (theme === 'light') document.body.classList.add('ddj-light');
    else if (document.body.classList.contains('vscode-dark')) document.body.classList.add('ddj-dark');
    else if (document.body.classList.contains('vscode-light')) document.body.classList.add('ddj-light');
    else {
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.body.classList.add(prefersDark ? 'ddj-dark' : 'ddj-light');
    }
  }

  // ── 导航栏（Claude Code 式左侧栏）──
  const NAV = [
    { id: 'dashboard', icon: '📊', key: 'tabDashboard' },
    { id: 'tools', icon: '🔧', key: 'tabTools' },
    { id: 'kb', icon: '🌐', key: 'tabKb' },
    { id: 'project', icon: '📁', key: 'tabProject' },
    { id: 'plot', icon: '🎨', key: 'tabPlot' },
    { id: 'submissions', icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 3h11l5 5v13H4ZM14 3v6h6M7 13h10M7 17h7"/></svg>', key: '投稿管理' },
    { id: 'settings', icon: '⚙️', key: 'tabSettings' },
  ];

  function renderTop() {
    if (['ideas', 'questions', 'plans', 'execution', 'conclusions'].includes(state.tab)) {
      researchStage = ({ ideas: 'questions', execution: 'plans', conclusions: 'results' })[state.tab] || state.tab;
      state.tab = 'dashboard';
    }
    const focused = document.activeElement;
    const focusId = focused?.id;
    const selection = draftFields.has(focusId) ? [focused.selectionStart, focused.selectionEnd] : null;
    const sameProject = app.dataset.projectKey === draftKey();
    const activeStep = state.pipeline?.steps?.find((s) => s.id === state.pipeline?.current_step);
    const workspaceName = state.projectName || t('noProject');
    const workspaceMeta = activeStep
      ? `${state.pipeline.scenario || 'pipeline'} · ${activeStep.label}`
      : t('noPipeline');
    app.innerHTML = `
      <div class="app-shell ${state.collapsed ? 'collapsed' : ''}">
        <div class="rail">
          <button class="rail-brand" data-tab="dashboard" title="${t('appTitle')}">
            <span class="rail-brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5 9 2l3 2 3-2-1 3M5 12a7 7 0 1 1 14 0v3a7 6 0 0 1-14 0ZM5 13l-3 2 3 2m14-4 3 2-3 2M9 21v1m6-1v1"/><circle cx="9" cy="10" r=".7" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r=".7" fill="currentColor" stroke="none"/><path d="m10 13 2 2 2-2Z"/></svg></span>
            <span class="rail-brand-copy"><b>叮咚鸡</b><small>让灵感破壳，让研究有据。</small></span>
          </button>
          <div class="rail-divider"></div>
          <div class="rail-nav">
            ${NAV.map((n) => `
              <button class="rail-btn ${state.tab === n.id ? 'active' : ''}" data-tab="${n.id}" title="${t(n.key)}">
                <span class="rail-ic">${n.icon}</span><span class="rail-lb">${t(n.key)}</span>
              </button>`).join('')}
          </div>
          <div class="rail-spacer"></div>
          <button class="rail-btn rail-codex" id="railCodex" title="${t('openCodexHint')}">
            <span class="rail-ic">🤖</span><span class="rail-lb">${t('openCodex')}</span>
          </button>
          <button class="rail-btn rail-toggle" id="railToggle" title="${state.collapsed ? t('expand') : t('collapse')}">
            <span class="rail-ic">${state.collapsed ? '»' : '«'}</span><span class="rail-lb">${state.collapsed ? '' : (state.collapsed ? '' : '')}</span>
          </button>
        </div>
        <div class="content">
          <div class="workspace-bar">
            <div class="workspace-identity">
              <span class="workspace-dot ${state.projectName ? 'online' : ''}"></span>
              <div>
                <div class="workspace-name" id="projSub">${esc(workspaceName)}</div>
                <div class="workspace-meta">${esc(workspaceMeta)}</div>
              </div>
            </div>
            <div class="workspace-actions">
              <span class="workspace-sync">${state.updatedAt ? '↻ ' + state.updatedAt : '…'}</span>
              <button class="surface-btn" id="workspaceRefresh" title="${t('refresh')}">↻</button>
              <button class="surface-btn codex" id="workspaceCodex" title="${t('openCodexHint')}">Codex</button>
            </div>
          </div>
          <div id="panel"></div>
        </div>
      </div>`;
    app.querySelectorAll('.rail-btn[data-tab]').forEach((b) => {
      b.onclick = () => { state.tab = b.dataset.tab; renderTop(); };
    });
    const brand = app.querySelector('.rail-brand');
    if (brand) brand.onclick = () => { state.tab = 'dashboard'; renderTop(); };
    const codexBtn = app.querySelector('#railCodex');
    if (codexBtn) codexBtn.onclick = () => send('openCodex');
    const toggle = app.querySelector('#railToggle');
    if (toggle) {
      toggle.onclick = () => {
        state.collapsed = !state.collapsed;
        if (vscode.setState) vscode.setState({ ...(vscode.getState?.() || {}), collapsed: state.collapsed });
        renderTop();
      };
    }
    const refresh = app.querySelector('#workspaceRefresh');
    if (refresh) refresh.onclick = () => send('getAll');
    const codex = app.querySelector('#workspaceCodex');
    if (codex) codex.onclick = () => send('openCodex');
    window.__ddj = {
      openClaude: () => send('openClaude'),
      openCodex: () => send('openCodex'),
      plotOpen: (p) => send('plotOpen', { path: p }),
      plotPreview: (p, uri, name) => {
        state.plot.lightbox = { path: p, uri, name: name || p.split('/').pop() };
        renderTop();
      },
      plotCloseLightbox: () => { state.plot.lightbox = null; renderTop(); },
      imgFail: (el) => {
        const wrap = el.parentElement;
        if (wrap) wrap.innerHTML = `<div class="plot-thumb-empty">${t('plotUnavailable')}</div>`;
      },
    };
    renderPanel();
    restoreResearchDrafts();
    app.dataset.projectKey = draftKey();
    const replacement = sameProject && selection && document.getElementById(focusId);
    if (replacement) {
      replacement.focus({ preventScroll: true });
      if (selection[0] != null && replacement.setSelectionRange) replacement.setSelectionRange(...selection);
    }
  }

  // ── 面板分发（5 栏）──
  let previousPanelRoute;
  function renderPanel() {
    const panel = app.querySelector('#panel');
    if (!panel) return;
    const route = String(state.workspacePath || '') + ':' + state.tab;
    if (route !== previousPanelRoute && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      panel.animate([{ opacity: .4, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220, easing: 'ease-out' });
    }
    previousPanelRoute = route;
    if (state.tab === 'submissions') {
      if (window.ddjRenderSubmissions) window.ddjRenderSubmissions(panel);
      else { panel.innerHTML = '<h2>投稿管理</h2><p>在独立工作台中管理全局作者与手稿。</p><button id="openSubmissionsWorkbench">打开独立工作台</button>'; panel.querySelector('button').onclick = () => send('openFusion'); }
      return;
    }
    if (state.tab === 'dashboard') return renderDashboard(panel);
    if (state.tab === 'ideas') return renderIdeas(panel);
    if (state.tab === 'questions') return renderQuestions(panel);
    if (state.tab === 'plans') return renderPlans(panel);
    if (state.tab === 'conclusions') return renderConclusions(panel);
    if (state.tab === 'tools') return renderTools(panel);
    if (state.tab === 'kb') return renderKb(panel);
    if (state.tab === 'project') return renderProject(panel);
    if (state.tab === 'plot') return renderPlot(panel);
    if (state.tab === 'settings') return renderSettings(panel);
  }

  function citationStatusLabel(status) {
    return ({
      verified: t('citationStatusVerified'), conflict: t('citationStatusConflict'),
      not_found: t('citationStatusNotFound'), needs_review: t('citationStatusReview'),
      unavailable: t('citationStatusUnavailable'), pending: t('citationStatusPending'),
    })[status] || status || '—';
  }

  function citationStatusClass(status) {
    if (status === 'verified') return 'ok';
    if (status === 'pending') return '';
    return 'warn';
  }

  function citationIssueText(issue) {
    if (!issue || typeof issue !== 'object') return String(issue || '');
    return (issue.path ? issue.path + '：' : '') + (issue.issue || '');
  }

  // 引用跨库核验（后端权威）：仅展示，不改变后端判定
  function citationSection() {
    const c = state.citations;
    let html = '<div class="sec-title">🔎 ' + t('citationTitle') + '</div>';
    html += '<div class="dash-card">';
    html += '<div class="dash-card-sub">' + esc(t('citationDesc')) + '</div>';
    if (!c) {
      html += '<div class="empty">' + t('citationEmpty') + '</div></div>';
      return html;
    }
    if (c.status === 'error') {
      html += `<div class="plot-chip no">${esc(c.error || 'backend unavailable')}</div>`;
      html += `<div class="ctrl-row"><button class="ctrl-btn" id="citationRunBtn">${t('citationRun')}</button></div></div>`;
      return html;
    }
    const counts = c.counts || {};
    if (!c.reference_count) {
      html += '<div class="empty">' + t('citationEmpty') + '</div>';
    } else {
      const chip = (label, n, ok) => `<span class="plot-chip ${ok === true ? 'ok' : ok === false ? 'no' : ''}">${label} ${n || 0}</span>`;
      html += '<div class="plot-chips">' +
        chip(t('citationRefs'), c.reference_count) +
        chip(t('citationVerified'), counts.verified, counts.verified === c.reference_count) +
        chip(t('citationConflict'), counts.conflict, (counts.conflict || 0) === 0) +
        chip(t('citationNotFound'), counts.not_found, (counts.not_found || 0) === 0) +
        chip(t('citationReview'), counts.needs_review, (counts.needs_review || 0) === 0) +
        chip(t('citationUnavailable'), counts.unavailable, (counts.unavailable || 0) === 0) +
        chip(t('citationPendingCount'), counts.pending, (counts.pending || 0) === 0) +
        '</div>';
      const verdict = c.passed ? t('citationPass') : t('citationFail');
      const extra = [c.stale ? t('citationStale') : '', c.status === 'pending' ? t('citationPending') : ''].filter(Boolean).join(' · ');
      html += `<div class="plot-msg ${c.passed ? '' : 'path'}">${verdict}${extra ? ' · ' + extra : ''}</div>`;
      if (c.checked_at) html += `<div class="dash-card-sub">${esc(new Date(c.checked_at * 1000).toLocaleString(state.lang === 'en' ? 'en-US' : 'zh-CN'))}</div>`;
    }
    html += `<div class="ctrl-row"><button class="ctrl-btn" id="citationRunBtn" ${state.citationBusy ? 'disabled' : ''}>${state.citationBusy ? '<span class="spin"></span> ' : ''}${t('citationRun')}</button></div>`;
    const issues = (c.coverage_issues || []).map(citationIssueText).filter(Boolean);
    if (issues.length) {
      html += '<div class="dash-card-sub">' + esc(t('citationCoverage')) + '</div><div class="audit-list">' +
        issues.slice(0, 12).map((x) => `<div class="audit-row warn"><span>⚠</span><div><div class="audit-detail">${esc(x)}</div></div></div>`).join('') + '</div>';
    }
    const items = c.results || [];
    if (items.length) {
      html += '<div class="audit-list">' + items.slice(0, 60).map((r) => {
        const label = r.title || r.raw || r.doi || r.id;
        const prov = (r.sources || []).map((s) => `${s.provider}:${s.state === 'matched' ? '✓' : s.state}`).join(' · ') || t('citationNoSources');
        const loc = (r.file || '') + (r.ordinal ? '#' + r.ordinal : '');
        const meta = [loc, r.doi, citationStatusLabel(r.status), prov].filter(Boolean).join(' · ');
        return `<div class="audit-row ${citationStatusClass(r.status)}"><span>${r.status === 'verified' ? '✓' : '⚠'}</span><div><div class="audit-name">${esc(label)}</div><div class="audit-detail">${esc(meta)}</div></div></div>`;
      }).join('') + '</div>';
      if (items.length > 60) html += `<div class="dash-card-sub">+${items.length - 60}</div>`;
    }
    if (c.report_path) html += `<div class="plot-msg path">${esc(t('citationReport'))}: ${esc(c.report_path)}</div>`;
    html += '</div>';
    return html;
  }

  function renderDashboard(panel) {
    if (!state.status) {
      panel.innerHTML = '<div class="empty"><span class="spin"></span> 加载仪表盘…</div>';
      send('getAll');
      return;
    }
    const pl = state.pipeline;
    const doneN = pl ? pl.steps.filter((s) => s.status === 'done').length : 0;
    const pct = pl && pl.steps.length ? Math.round(doneN / pl.steps.length * 100) : 0;
    const cur = pl ? pl.steps.find((s) => s.id === pl.current_step) : null;
    const cf = state.codexFusion || {};
    const chain = state.backendState?.chain || {};
    const ctxTime = cf.contextMtime ? new Date(cf.contextMtime).toLocaleString(state.lang === 'en' ? 'en-US' : 'zh-CN') : t('fusionNever');
    const extensionValue = cf.installed ? (cf.version || t('fusionReady')) : t('fusionMissing');
    const contextReady = cf.agentsMd && cf.ddjCli;
    const skillsReady = Number(cf.skillsReady || 0);
    const skillsTotal = Number(cf.skillsTotal || 0);
    const auditKnown = typeof chain.ok === 'boolean';
    const auditOk = auditKnown && chain.ok === true;
    const auditValue = auditKnown ? (chain.message || '—') : '未检查或后端不可用';

    let html = `
      <section class="codex-command ${cf.installed ? '' : 'needs-extension'}">
        <div class="codex-command-copy">
          <div class="codex-eyebrow">✦ ${t('codexEyebrow')}</div>
          <h1>${t('codexDashboardTitle')}</h1>
          <p>${t('codexDashboardSub')}</p>
          <div class="codex-command-actions">
            <button class="codex-action primary" id="dashboardCodexOpen">${t('codexOpen')}</button>
            <button class="codex-action secondary" id="dashboardCodexContext" ${cf.installed ? '' : 'disabled'}>${t('codexContext')}</button>
          </div>
          <div class="codex-action-hints"><span>${t('codexOpenHint')}</span><span>${t('codexContextHint')}</span></div>
        </div>
        <div class="codex-run-card">
          <div class="codex-run-head"><span>${t('codexExecution')}</span><span class="fusion-st ${cf.installed ? 'ok' : 'no'}">${esc(extensionValue)}</span></div>
          <div class="codex-run-title">${esc(cur?.label || t('noPipeline'))}</div>
          <div class="codex-run-sub">${esc(pl ? `${pl.scenario || 'pipeline'} · ${doneN}/${pl.steps.length} ${t('stepsUnit')}` : t('noPipeline'))}</div>
          <div class="codex-run-progress"><div style="width:${pct}%"></div></div>
          <div class="codex-run-foot"><span>${t('pipelineLabel')}</span><b>${pct}%</b></div>
        </div>
      </section>
      <section class="codex-health-grid">
        <article class="codex-health-card"><span class="codex-health-icon">⌘</span><div><small>${t('codexExtensionStatus')}</small><strong>${esc(extensionValue)}</strong><em>${cf.installed ? t('fusionReady') : t('fusionMissing')}</em></div></article>
        <article class="codex-health-card"><span class="codex-health-icon">◎</span><div><small>${t('codexContextStatus')}</small><strong>${contextReady ? t('fusionReady') : t('fusionMissing')}</strong><em>${esc(ctxTime)}</em></div></article>
        <article class="codex-health-card"><span class="codex-health-icon">✣</span><div><small>${t('codexSkillsStatus')}</small><strong>${skillsReady}/${skillsTotal || '—'}</strong><em>${t('codexSkills')}</em></div></article>
        <article class="codex-health-card ${auditOk ? '' : 'warning'}"><span class="codex-health-icon">◈</span><div><small>${t('codexAuditStatus')}</small><strong>${auditOk ? 'OK' : (auditKnown ? 'CHECK' : 'UNKNOWN')}</strong><em>${esc(auditValue)}</em></div></article>
      </section>`;

    panel.innerHTML = html;
    const codexOpen = panel.querySelector('#dashboardCodexOpen');
    if (codexOpen) codexOpen.onclick = () => send('openCodex');
    const codexContext = panel.querySelector('#dashboardCodexContext');
    if (codexContext) codexContext.onclick = () => send('openCodexContext');
    renderResearchWorkspace(panel);
    panel.prepend(panel.querySelector('.research-workspace'));
    const citeSec = document.createElement('div');
    citeSec.className = 'citation-section';
    citeSec.innerHTML = citationSection();
    panel.appendChild(citeSec);
    const citeBtn = panel.querySelector('#citationRunBtn');
    if (citeBtn) citeBtn.onclick = () => { state.citationBusy = true; renderTop(); send('citationAudit', { force: true }); };
    const actsSec = document.createElement('div');
    actsSec.className = 'activities-section';
    actsSec.innerHTML = '<div class="sec-title">' + t('recentAct') + '</div>' + ((state.activities || []).slice(0, 8).map((a) => `
      <div class="act"><span class="t">${a.time || ''}</span>${a.module ? `<span class="m">[${a.module}]</span>` : ''}<span class="a">${a.action || ''}</span></div>
    `).join('') || '<div class="empty">' + t('noActivity') + '</div>');
    panel.appendChild(actsSec);
  }

  function renderPipelineSection(panel) {
    const sec = document.createElement('div');
    sec.className = 'pipeline-section';
    sec.innerHTML = '<div class="sec-title">' + t('pipelineProgress') + '</div><div id="pipelineArea"></div>';
    panel.appendChild(sec);
    renderPipeline(sec.querySelector('#pipelineArea'));
  }

  let researchStage = 'questions';
  const researchDrafts = new Map();
  const researchDisclosures = new Map();
  const draftFields = new Set(['ideaText', 'clusterTitle', 'primaryQuestion', 'mechanismQuestion', 'planCluster', 'planTitle', 'planTasks', 'conclusionText', 'conclusionEvidence', 'conclusionStatus', 'continuationSource', 'continuationKind', 'continuationTitle', 'continuationNotes']);
  const draftKey = () => String(state.workspacePath || state.backendState?.pipeline?.project_id || state.projectName || 'unbound');
  app.addEventListener('input', (event) => {
    if (!draftFields.has(event.target.id)) return;
    const key = draftKey();
    if (!researchDrafts.has(key)) researchDrafts.set(key, {});
    researchDrafts.get(key)[event.target.id] = event.target.value;
  });
  function restoreResearchDrafts() {
    const draft = researchDrafts.get(draftKey()) || {};
    Object.entries(draft).forEach(([id, value]) => {
      const field = document.getElementById(id);
      if (field) field.value = value;
    });
    draftFields.forEach((id) => {
      const field = document.getElementById(id);
      if (field && !field.getAttribute('aria-label')) field.setAttribute('aria-label', field.getAttribute('placeholder') || '研究表单选项');
    });
    const labels = { clusterTitle: '集群名称（至少 8 字符）', primaryQuestion: '主问题（必填，至少 8 字符）', mechanismQuestion: '机制 / 探索问题（选填，至少 8 字符）', planCluster: '关联科学问题集群', planTitle: '计划名称（至少 8 字符）', planTasks: '任务草稿（每行一项；箭头右侧填写前置任务名）' };
    Object.entries(labels).forEach(([id, text]) => {
      const field = document.getElementById(id);
      if (!field || document.querySelector(`label[for="${id}"]`)) return;
      const label = document.createElement('label');
      label.htmlFor = id;
      label.className = 'research-field-label';
      label.textContent = text;
      field.before(label);
    });
  }
  function renderResearchWorkspace(panel) {
    const clusters = state.questionClusters || [];
    const plans = state.researchPlans || [];
    const selected = (state.ideas || []).find((item) => item.status === 'selected' && item.kind === 'idea');
    const claims = state.conclusions || [];
    const pendingClusters = clusters.filter(c => !plans.some(p => p.payload?.cluster_id === c.id));
    const needsQuestion = !clusters.length || (selected && !clusters.some(c => c.payload?.idea_id === selected.id));
    const unresolved = claims.filter(c => c.status !== 'supported');
    const job = state.continuations?.schedule?.job;
    const running = (state.runs || []).some(run => ['queued', 'running', 'cancel_requested'].includes(run.status));
    const executionNeedsAttention = running || ['active', 'blocked', 'interrupted'].includes(job?.status);
    const nextStage = executionNeedsAttention ? 'plans' : needsQuestion ? 'questions' : pendingClusters.length || !claims.length ? 'plans' : unresolved.length ? 'results' : 'continuation';
    const next = executionNeedsAttention
      ? (['blocked', 'interrupted'].includes(job?.status) ? '调度已阻塞或中断。先核对运行记录和已有产物，再处理失败原因，避免重复执行。' : '项目任务正在排队或执行。请在计划与管线中查看运行进展，结果入库后再复核证据。')
      : needsQuestion ? '当前研究方向尚待确认科学问题。从 Idea 发散，选择方向，再确认可回答的问题。' : pendingClusters.length ? `${pendingClusters.length} 个问题集群尚无计划，可继续补齐任务与验收条件。` : !claims.length ? '已有研究计划。核对当前管线和真实运行，再把结果登记为候选结论。' : unresolved.length ? `${unresolved.length} 条结论尚未获得支持或需要复核；先检查证据，再决定补充研究或写作。` : '结论已有支持标记。写作前仍需复核证据时效，也可以由结论提出下一轮问题。';
    const stages = [
      { id: 'questions', short: '构想与问题', title: '构想与科学问题', detail: `${(state.ideas || []).filter(i => i.kind === 'idea').length} 个构想 / ${clusters.length} 个集群`, agent: '理解问题、发散假设与反例，并将经你确认的方向归档。', checklist: ['说明现象、疑问或手头数据', '确认最重要的研究方向', '确认可回答的主问题'] },
      { id: 'plans', short: '计划与执行', title: '计划与管线', detail: `${plans.length} 个计划 / ${state.pipeline?.steps?.filter(s => s.status === 'done').length || 0} 个已完成步骤`, agent: '将已确认问题转成可验收任务，核对依赖、输入、产出和管线约束。', checklist: ['确认问题集群与研究设计', '核对任务依赖和验收条件', '明确后再授权启动调度'] },
      { id: 'results', short: '结果与证据', title: '结果与证据', detail: `${claims.length} 条结论 / ${unresolved.length} 条待复核`, agent: '仅从真实产物、运行记录和已核验文献中整理候选结论与证据链。', checklist: ['检查结果文件是否真实存在', '核对证据支点与局限', '决定是否进入科学复核'] },
      { id: 'continuation', short: '后续与写作', title: '后续研究与论文', detail: '由结论开启下一轮', agent: '把经复核的结论转为下一轮问题或论文论证，并保存来源快照。', checklist: ['选择来源结论', '说明证据缺口或写作目的', '保存可追溯的后续任务'] },
    ];
    const nextStageIndex = stages.findIndex(stage => stage.id === nextStage);
    const section = document.createElement('section');
    section.className = 'research-workspace';
    section.innerHTML = `<div class="research-next"><div><span class="research-kicker">研究工作流</span><h1>研究闭环</h1><p>${esc(next)}</p><button class="idea-primary" id="researchContinue">${({ questions: '开始构想与问题', plans: '进入计划与执行', results: '复核结果与证据', continuation: '规划后续与写作' })[nextStage]}</button></div><div class="research-next-state" aria-live="polite"><small>当前建议</small><strong>${esc((stages.find(stage => stage.id === nextStage) || stages[0]).short)}</strong><span>第 ${nextStageIndex + 1} / ${stages.length} 阶段</span></div></div>
      <nav class="research-stage-nav" aria-label="研究工作区">${stages.map((stage, index) => `<button data-stage="${stage.id}" class="${index < nextStageIndex ? 'complete' : index === nextStageIndex ? 'recommended' : ''}" aria-label="${esc(stage.title)}，${esc(stage.detail)}"><span class="research-stage-index">${String(index + 1).padStart(2, '0')}</span><span class="research-stage-copy"><b>${esc(stage.title)}</b><small>${esc(stage.detail)}</small></span></button>`).join('')}</nav><div class="research-stage-body"></div>`;
    panel.appendChild(section);
    section.querySelectorAll('[data-go]').forEach((button) => { button.onclick = () => { state.tab = button.dataset.go; renderTop(); }; });
    const renderStage = () => {
      const activeMeta = stages.find(stage => stage.id === researchStage) || stages[0];
      section.querySelectorAll('[data-stage]').forEach((button) => {
        button.classList.toggle('active', button.dataset.stage === researchStage);
        button.setAttribute('aria-pressed', String(button.dataset.stage === researchStage));
      });
      const body = section.querySelector('.research-stage-body');
      body.innerHTML = `<section class="workflow-agent"><div class="workflow-agent-copy"><span class="research-kicker">智能体协作</span><h2>${({ questions: '在对话里说出你的 Idea', plans: '让智能体制定并推进研究', results: '让智能体整理结论与证据', continuation: '和智能体讨论后续研究与论文' })[researchStage]}</h2><p>${esc(activeMeta.agent)} 你只需表达研究意图并确认关键决定。</p><button class="idea-primary" id="researchAgentStart">${researchStage === 'questions' ? '打开对话，输入 Idea' : '带着项目继续讨论'}</button><p class="research-hint">会话会携带项目上下文；添加上下文不代表消息已发送或任务已执行。</p></div><aside class="workflow-checklist" aria-label="本阶段你需要确认的事项"><b>本阶段只需确认</b>${activeMeta.checklist.map(item => `<span>${esc(item)}</span>`).join('')}</aside></section>`;
      body.querySelector('#researchAgentStart').onclick = () => send('researchAgent', { stage: researchStage });
      const mount = (render) => { const target = document.createElement('div'); body.appendChild(target); render(target); return target; };
      if (researchStage === 'questions') {
        const ideas = mount(renderIdeas);
        ideas.className = 'workflow-incubation';
        const bridge = document.createElement('div');
        bridge.className = 'workflow-bridge';
        bridge.innerHTML = `<strong>${selected ? '已选方向 → 确定科学问题' : '发散 → 研究者选择 → 确定科学问题'}</strong><p>${esc(selected?.text || '可先探索构想，也可直接记录已有问题；没有来源的关联不会被补造。')}</p>`;
        body.appendChild(bridge);
        mount(renderQuestions);
      } else if (researchStage === 'plans') {
        mount(renderPlans);
        const schedule = state.continuations?.schedule;
        const scheduler = document.createElement('section'); scheduler.className = 'workflow-bridge';
        scheduler.innerHTML = `<strong>本地自动调度</strong><p>${schedule?.ok ? esc(schedule.job ? `${schedule.job.status}：${schedule.job.error || '运行结果不等于科学验收'}` : '尚未启动。支持 stats_report / figure_audit 执行器。') : '调度接口不可用，需更新后端；不能据此判断没有任务。'}</p>${(schedule?.job?.tasks || []).map(t => `<p>${esc(t.payload?.title)}：${esc(t.status)} ${esc(t.run_id || '')}</p>`).join('')}<button class="ctrl-btn" id="scheduleRefresh">刷新调度状态</button><button class="ctrl-btn" id="scheduleCancel" ${schedule?.job ? '' : 'disabled'}>停止后续调度</button>`;
        body.appendChild(scheduler);
        scheduler.querySelector('strong').textContent = '自动调度：本地任务与智能体';
        if (schedule?.ok && !schedule.job) scheduler.querySelector('p').textContent = '支持统计报告、图像审计、codex_agent 与 conclusion_extract。智能体输入文件与模型使用需先确认。';
        scheduler.querySelector('#scheduleRefresh').onclick = () => send('getAll');
        scheduler.querySelector('#scheduleCancel').onclick = () => send('scheduleControl', { action: 'cancel' });
        const bridge = document.createElement('div');
        bridge.className = 'workflow-bridge';
        bridge.innerHTML = '<strong>计划 → 管线执行 → 产物验收</strong><p>计划是任务草稿；下方管线是当前项目的控制面，暂不代表计划任务已逐项映射。交接时需确认两者对应关系，不会自动跳步。</p><button class="ctrl-btn" id="researchContext">交接计划与项目上下文</button>';
        body.appendChild(bridge);
        bridge.querySelector('#researchContext').onclick = () => send('openCodexContext', { researchBrief: '# 研究计划与管线交接\n\n请先核对问题、计划、当前管线及任务对应关系。未经验收不得推进；不要把草稿视作执行成功。\n\n```json\n' + JSON.stringify({ clusters, plans, pipeline: state.pipeline }, null, 2) + '\n```' });
        renderPipelineSection(body);
        const runs = document.createElement('div');
        runs.innerHTML = '<h3>最近运行</h3>' + ((state.runs || []).slice().reverse().slice(0, 8).map((run) => `<div class="act"><span class="a">${esc(run.task_type || '')}</span><span>${esc(run.status || 'unknown')}</span><span class="t">${esc(run.run_id || '')}</span></div>`).join('') || '<p class="research-hint">暂无实际运行记录。可将项目上下文交给智能体开展任务。</p>');
        body.appendChild(runs);
        const results = document.createElement('button'); results.className = 'ctrl-btn'; results.textContent = '整理已产出的结果与证据'; results.onclick = () => { researchStage = 'results'; renderStage(); }; body.appendChild(results);
      } else if (researchStage === 'results') mount(renderConclusions);
      else mount(renderContinuation);
      restoreResearchDrafts();
      body.querySelectorAll('.idea-compose,.conclusion-compose').forEach(form => {
        const key = `${draftKey()}:${form.querySelector('[id]')?.id}`;
        const details = document.createElement('details'); details.className = 'workflow-manual';
        details.open = researchDisclosures.get(key) || false;
        const summary = document.createElement('summary'); summary.textContent = '高级操作：手动补录或修正'; details.appendChild(summary);
        form.before(details); details.appendChild(form);
        details.ontoggle = () => researchDisclosures.set(key, details.open);
      });
    };
    section.querySelectorAll('[data-stage]').forEach((button) => { button.onclick = () => { researchStage = button.dataset.stage; renderStage(); }; });
    section.querySelector('#researchContinue').onclick = () => {
      researchStage = nextStage;
      renderStage();
      section.querySelector('#researchAgentStart')?.focus();
    };
    renderStage();
  }

  function renderIdeaConclusionSection(panel) {
    const sec = document.createElement('div');
    sec.className = 'pipeline-section';
    const roots = (state.ideas || []).filter((item) => item.kind === 'idea');
    const selected = roots.find((item) => item.status === 'selected');
    const conclusionRows = (state.conclusions || []).slice(0, 6).map((item) =>
      `<div class="act"><span class="m">${esc(item.status || 'candidate')}</span><span class="a">${esc(item.statement || '')}</span><span class="t">${(item.evidence || []).length} 证据</span></div>`).join('') || '<div class="empty">尚无结论；应先将候选结论与可追溯证据关联。</div>';
    sec.innerHTML = `<div class="sec-title">🌱 Idea 树（项目立项）</div>
      <div class="empty" style="text-align:left">输入一个研究构想后生成价值、机制、证据缺口、设计、资源和风险分支；选择后只生成项目立项产物，不会自动推进管线。</div>
      <textarea id="ideaText" placeholder="例如：探索睡眠干预是否降低抑郁复发风险"></textarea><button class="ctrl-btn" id="ideaCreate">发散构想</button>
      <div class="act"><span class="m">已选</span><span class="a">${esc(selected?.text || '尚未选择')}</span></div>
      ${roots.slice(-4).map((item) => `<div class="act"><span class="a">${esc(item.text)}</span><button class="tl-act idea-select" data-id="${esc(item.id)}">选择</button></div><div class="empty" style="text-align:left;padding:4px 8px">${(state.ideas || []).filter((child) => child.parent_id === item.id).map((child) => `• ${esc(child.label || child.kind)}：${esc(child.agent_prompt || child.text)}`).join('<br>')}</div>`).join('')}
      <div class="sec-title" style="margin-top:14px">🔗 研究结论管理</div>
      <div class="empty" style="text-align:left">每条结论必须关联分析产物、文献、受控运行或其他项目内证据；系统保存引用与文件指纹。</div>
      <textarea id="conclusionText" placeholder="输入一条候选或已支持的核心结论"></textarea><input id="conclusionEvidence" placeholder="项目内证据路径，如：结果文件/tables/result.csv"><button class="ctrl-btn" id="conclusionSave">保存候选结论</button>
      <div>${conclusionRows}</div>`;
    sec.querySelector('#ideaCreate').onclick = () => send('ideaCreate', { text: sec.querySelector('#ideaText').value });
    sec.querySelectorAll('.idea-select').forEach((button) => { button.onclick = () => {
      const rationale = window.prompt('选择理由（可选）', '') || '';
      send('ideaSelect', { ideaId: button.dataset.id, rationale });
    }; });
    sec.querySelector('#conclusionSave').onclick = () => {
      const statement = sec.querySelector('#conclusionText').value;
      const ref = sec.querySelector('#conclusionEvidence').value;
      send('conclusionUpsert', { statement, evidence: ref ? [{ type: 'analysis', ref, note: '由研究者在仪表盘关联' }] : [] });
    };
    panel.appendChild(sec);
  }

  function renderIdeas(panel) {
    const roots = (state.ideas || []).filter((item) => item.kind === 'idea');
    const selected = roots.find((item) => item.status === 'selected');
    panel.innerHTML = `<section class="idea-hero">
      <div><span class="idea-kicker">PROJECT INCUBATION · BEFORE PIPELINE</span><h1>🌱 Idea 树</h1><p>先让问题发散，再由你选择。每个分支都是给智能体继续深化的研究提示，而不是未经核验的结论。</p></div>
      <div class="idea-selected"><small>当前立项选择</small><strong>${esc(selected?.text || '尚未选择构想')}</strong><span>${selected?.selected_at ? esc(selected.selected_at) : '选择后将生成 A_project_concept.md'}</span></div>
    </section>
    <section class="idea-compose"><textarea id="ideaText" placeholder="用 1–2 句话输入研究构想，例如：探索睡眠干预是否降低抑郁复发风险"></textarea><button class="idea-primary" id="ideaCreate">发散为研究树 <span>→</span></button></section>
    <section class="idea-tree">${roots.length ? roots.slice().reverse().map((root) => {
      const children = (state.ideas || []).filter((child) => child.parent_id === root.id);
      return `<article class="idea-root ${root.status === 'selected' ? 'selected' : ''}"><header><div><span class="idea-status">${root.status === 'selected' ? '已选立项' : '探索中'}</span><h2>${esc(root.text)}</h2></div><button class="idea-select" data-id="${esc(root.id)}">${root.status === 'selected' ? '已选择' : '选择此构想'}</button></header><div class="idea-branches">${children.map((child, index) => `<div class="idea-branch"><span class="idea-index">0${index + 1}</span><div><b>${esc(child.label || child.kind)}</b><p>${esc(child.agent_prompt || child.text)}</p></div></div>`).join('')}</div></article>`;
    }).join('') : '<div class="idea-empty">从一个简短构想开始。系统会建立六个可编辑的研究分支：价值、机制、证据缺口、设计、资源与风险。</div>'}</section>`;
    panel.querySelector('#ideaCreate').onclick = () => send('ideaCreate', { text: panel.querySelector('#ideaText').value });
    panel.querySelector('#ideaCreate').textContent = '手动登记构想（不执行智能体分析）';
    const records = state.continuations?.agentRecords || [];
    const analysis = document.createElement('section'); analysis.className = 'workflow-records';
    analysis.innerHTML = '<h3>智能体分析与讨论记录</h3>' + (records.map(record => `<article class="workflow-record"><small>${esc(record.type)} / ${esc(record.status)}</small><h3>${esc(record.payload?.title || record.payload?.statement || '讨论记录')}</h3><pre>${esc(JSON.stringify(record.payload, null, 2))}</pre></article>`).join('') || '<p class="research-hint">尚无已入库分析。请在智能体对话中讨论，分析保存后刷新显示。模板分支不是研究发现。</p>');
    panel.appendChild(analysis);
    panel.querySelectorAll('.idea-select').forEach((button) => { button.onclick = () => {
      if (button.textContent.includes('已选择')) return;
      const rationale = window.prompt('选择理由（可选）', '') || '';
      send('ideaSelect', { ideaId: button.dataset.id, rationale });
    }; });
    panel.querySelectorAll('.idea-root').forEach((card, index) => {
      const root = roots.slice().reverse()[index];
      const linked = (state.questionClusters || []).filter(c => c.payload?.idea_id === root.id);
      const relation = document.createElement('p'); relation.className = 'research-hint';
      relation.textContent = linked.length ? `已形成问题集群：${linked.map(c => c.payload?.title || c.id).join('；')}` : '尚未形成问题集群';
      card.appendChild(relation);
      card.querySelectorAll('.idea-branch').forEach((branch, i) => {
        const child = (state.ideas || []).filter(c => c.parent_id === root.id)[i];
        const button = document.createElement('button'); button.className = 'ctrl-btn'; button.textContent = '作为问题草稿';
        button.disabled = root.status !== 'selected'; button.title = button.disabled ? '请先选择所属构想，确保来源准确' : '将此分支带入下方主问题，确认改写后再保存';
        button.onclick = () => {
          const draft = researchDrafts.get(draftKey()) || {};
          if (draft.primaryQuestion && !window.confirm('替换当前尚未保存的主问题草稿？')) return;
          draft.primaryQuestion = child.agent_prompt || child.text;
          researchDrafts.set(draftKey(), draft); restoreResearchDrafts();
          document.getElementById('primaryQuestion')?.closest('details')?.setAttribute('open', '');
          document.getElementById('primaryQuestion')?.focus();
        };
        branch.appendChild(button);
      });
    });
  }

  function renderContinuation(panel) {
    const claims = state.conclusions || [];
    const records = state.continuations?.objects || [];
    panel.innerHTML = `<header class="workflow-heading"><h2>由结论走向下一轮研究与论文</h2><p>保存来源结论快照与后续任务草稿。候选、争议或失效证据不能被当作已证实结论写入论文。</p></header>
      ${state.continuations?.ok === false ? '<p role="alert" class="research-hint">后续记录加载失败，请刷新重试；不能据此判断没有记录。</p>' : ''}
      <section class="conclusion-compose question-compose">
      <label for="continuationSource">来源结论</label><select id="continuationSource"><option value="">选择需要继续推进的结论</option>${claims.map(c => `<option value="${esc(c.id)}">[${esc(c.status)}] ${esc(c.statement)}</option>`).join('')}</select>
      <label for="continuationKind">后续方向</label><select id="continuationKind"><option value="research">补充验证 / 下一轮研究</option><option value="manuscript">论文论证 / 写作计划</option></select>
      <label for="continuationTitle">标题（至少 8 字符）</label><input id="continuationTitle" placeholder="说明下一轮需要回答什么，或论文准备论证什么">
      <label for="continuationNotes">问题、任务与验收要求</label><textarea id="continuationNotes" placeholder="补充验证：证据缺口、待验证机制、分析要求；论文：核心论点、图表支点、局限性与报告清单"></textarea>
      <button class="idea-primary" id="continuationSave" ${claims.length ? '' : 'disabled'}>保存后续任务草稿</button></section>
      <div class="workflow-records">${records.map(r => { const source = claims.find(c => c.id === r.payload?.source_conclusion_id); const changed = !source || JSON.stringify(source) !== JSON.stringify(r.payload?.source_snapshot); return `<article class="workflow-record"><small>${r.type === 'manuscript' ? '论文计划' : '下一轮研究'} / ${esc(r.status)}</small><h3>${esc(r.payload?.title)}</h3><p>${esc(r.payload?.notes || '尚未补充任务说明')}</p><p class="research-hint">来源：${esc(source?.statement || r.payload?.source_snapshot?.statement || r.payload?.source_conclusion_id)}${changed ? '；来源已变化或不可用，请复核快照' : '；已保存来源快照'}</p><button class="ctrl-btn" data-continuation="${esc(r.id)}">${r.type === 'manuscript' ? '交接写作上下文' : '带回 Idea 继续发散'}</button></article>`; }).join('') || '<p class="research-hint">先在结果区登记结论，再从具体证据缺口或论文论点开始。</p>'}</div>`;
    panel.querySelector('#continuationSave').onclick = () => {
      const title = panel.querySelector('#continuationTitle').value;
      const conclusionId = panel.querySelector('#continuationSource').value;
      if (!conclusionId || title.trim().length < 8) return showToast('请选择来源结论，并填写至少 8 个字符的标题。', 'warn');
      send('continuationCreate', { title, conclusionId, kind: panel.querySelector('#continuationKind').value, notes: panel.querySelector('#continuationNotes').value });
    };
    panel.querySelectorAll('[data-continuation]').forEach(button => { button.onclick = () => {
      const record = records.find(r => r.id === button.dataset.continuation);
      if (record.type === 'manuscript') return send('openCodexContext', { researchBrief: '# 论文写作任务草稿\n\n先复核来源结论及证据链时效，遵守当前管线 blocked_paths。候选或争议结论不能作为已证实结论；文献入稿前跨库核验。此交接不代表已授权投稿。\n\n```json\n' + JSON.stringify(record, null, 2) + '\n```' });
      const draft = researchDrafts.get(draftKey()) || {};
      if (draft.ideaText && !window.confirm('替换当前尚未保存的 Idea 草稿？')) return;
      draft.ideaText = `${record.payload.title}\n${record.payload.notes || ''}\n来源后续研究记录：${record.id}；来源结论：${record.payload.source_conclusion_id}`;
      researchDrafts.set(draftKey(), draft); researchStage = 'questions'; renderTop(); document.getElementById('ideaText')?.focus();
    }; });
  }

  function renderQuestions(panel) {
    const clusters = state.questionClusters || [];
    const selectedIdea = (state.ideas || []).find((item) => item.kind === 'idea' && item.status === 'selected');
    panel.innerHTML = `<section class="conclusion-hero question-hero"><span class="idea-kicker">QUESTION CLUSTERS · RESEARCH DECISIONS</span><h1>◌ 科学问题集群</h1><p>把立项构想拆成主问题、机制问题、方法问题和探索问题。每个问题会成为计划、运行、证据与结论的共同锚点。</p><div class="conclusion-metrics"><span><b>${clusters.length}</b> 个集群</span><span><b>${selectedIdea ? '1' : '0'}</b> 个已选 Idea</span></div></section>
      <section class="conclusion-compose question-compose"><input id="clusterTitle" placeholder="问题集群名称，例如：睡眠干预与抑郁复发"><textarea id="primaryQuestion" placeholder="主问题：用一个可回答的科学问题描述研究目标"></textarea><textarea id="mechanismQuestion" placeholder="机制或探索问题（可选）"></textarea><button class="idea-primary" id="clusterCreate">确立问题集群</button></section>
      <section class="conclusion-list">${clusters.length ? clusters.map((cluster) => { const payload = cluster.payload || {}; return `<article class="conclusion-card question-card"><div class="conclusion-number">Q</div><div class="conclusion-main"><span class="conclusion-status supported">${esc(cluster.status || 'confirmed')}</span><h2>${esc(payload.title || '未命名问题集群')}</h2><p>${esc(payload.rationale || '尚未填写研究者选择理由')}</p><div class="evidence-chain"><span class="evidence-pill"><b>问题数</b> ${Number(payload.question_count || 0)}</span>${payload.idea_id ? '<span class="evidence-pill"><b>来源</b> Idea 树</span>' : ''}<span class="evidence-pill"><b>版本</b> v${esc(String(cluster.version || 1))}</span></div></div></article>`; }).join('') : '<div class="idea-empty">先从一个已选 Idea 或当前研究方向中提出主问题。问题集群确认后才能制定与问题绑定的研究计划。</div>'}</section>`;
    panel.querySelector('#clusterCreate').onclick = () => {
      const title = panel.querySelector('#clusterTitle').value;
      const primary = panel.querySelector('#primaryQuestion').value;
      const mechanism = panel.querySelector('#mechanismQuestion').value;
      if (title.trim().length < 8 || primary.trim().length < 8 || (mechanism.trim() && mechanism.trim().length < 8)) {
        showToast('请具体描述集群名称和科学问题，每项至少 8 个字符。', 'warn');
        return;
      }
      const questions = [{ statement: primary, kind: 'primary' }];
      if (mechanism.trim()) questions.push({ statement: mechanism, kind: 'mechanism', exploratory: true });
      send('questionClusterCreate', { title, questions, ideaId: selectedIdea?.id, rationale: selectedIdea?.rationale || '' });
    };
  }

  function renderPlans(panel) {
    const clusters = state.questionClusters || [];
    const plans = state.researchPlans || [];
    panel.innerHTML = `<section class="conclusion-hero question-hero"><span class="idea-kicker">PLAN REVISION · TASK DEPENDENCIES</span><h1>◫ 计划与执行</h1><p>每个计划绑定一个科学问题集群。任务先声明输入、产出和验收，再进入受控运行与产物验收。</p><div class="conclusion-metrics"><span><b>${plans.length}</b> 个计划</span><span><b>${plans.reduce((n, plan) => n + Number(plan.payload?.task_count || 0), 0)}</b> 个任务</span></div></section>
      <section class="conclusion-compose question-compose"><select id="planCluster"><option value="">选择问题集群</option>${clusters.map((cluster) => `<option value="${esc(cluster.id)}">${esc(cluster.payload?.title || cluster.id)}</option>`).join('')}</select><input id="planTitle" placeholder="计划名称，例如：睡眠干预与抑郁复发主分析计划"><textarea id="planTasks" placeholder="每行一个任务；用 → 表示依赖，例如：登记数据版本&#10;主分析 → 登记数据版本&#10;敏感性分析 → 主分析"></textarea><button class="idea-primary" id="planCreate" ${clusters.length ? '' : 'disabled'}>建立计划</button></section>
      <section class="conclusion-list">${plans.length ? plans.map((plan) => `<article class="conclusion-card question-card"><div class="conclusion-number">P</div><div class="conclusion-main"><span class="conclusion-status">${esc(plan.status || 'draft')}</span><h2>${esc(plan.payload?.title || '未命名计划')}</h2><p>${esc(plan.payload?.rationale || '待补充计划理由')}</p><div class="evidence-chain"><span class="evidence-pill"><b>任务</b> ${Number(plan.payload?.task_count || 0)}</span><span class="evidence-pill"><b>版本</b> v${esc(String(plan.version || 1))}</span></div></div></article>`).join('') : '<div class="idea-empty">先确认问题集群，再将执行步骤写成有明确验收条件的任务。</div>'}</section>`;
    const create = panel.querySelector('#planCreate');
    panel.querySelectorAll('.question-card').forEach((card, index) => {
      const plan = plans[index]; const binding = plan.payload?.pipeline_binding;
      const matches = binding && state.pipeline && binding.workspace === state.workspacePath && binding.scenario === state.pipeline.scenario && binding.created === state.pipeline.created && JSON.stringify(binding.step_ids) === JSON.stringify(state.pipeline.steps.map(s => s.id));
      const block = document.createElement('div'); block.className = 'research-hint';
      block.textContent = binding ? matches ? '已关联当前管线；任务验收仍须逐项核对。' : '关联管线已变化或不可用，请重新核对。' : '尚未关联项目管线。';
      const button = document.createElement('button'); button.className = 'ctrl-btn'; button.textContent = matches ? '重新确认管线关联' : '关联当前项目管线'; button.disabled = !state.pipeline;
      button.onclick = () => { if (window.confirm('将此计划关联到当前项目管线？这只记录关联快照，不启动任务，也不推进步骤。')) send('planBindPipeline', { planId: plan.id, expectedVersion: plan.version }); };
      block.appendChild(button); card.querySelector('.conclusion-main').appendChild(block);
      const start = document.createElement('button'); start.className = 'ctrl-btn'; start.textContent = '检查并启动自动调度';
      start.disabled = !state.pipeline || !state.continuations?.schedule?.ok;
      start.onclick = () => send('scheduleControl', { action: 'start', planId: plan.id, version: plan.version });
      block.appendChild(start);
    });
    if (create) create.onclick = () => {
      const title = panel.querySelector('#planTitle').value;
      const clusterId = panel.querySelector('#planCluster').value;
      if (!clusterId || title.trim().length < 8) {
        showToast('请选择问题集群，并填写至少 8 个字符的计划名称。', 'warn');
        return;
      }
      const lines = panel.querySelector('#planTasks').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const taskIndex = new Map(lines.map((line, index) => [line.split('→')[0].trim(), index]));
      if (!lines.length || taskIndex.size !== lines.length) {
        showToast('请填写任务，并为每个任务使用不同名称。', 'warn');
        return;
      }
      const invalidDependency = lines.some((line, index) => {
        const parts = line.split('→').map((part) => part.trim());
        return !parts[0] || parts.slice(1).some((dep) => !taskIndex.has(dep) || taskIndex.get(dep) >= index);
      });
      if (invalidDependency) {
        showToast('依赖必须引用前面已定义的任务；请检查任务名和顺序。', 'warn');
        return;
      }
      const tasks = lines.map((line) => {
        const [taskTitle, ...deps] = line.split('→').map((part) => part.trim());
        return { title: taskTitle, depends_on: deps.map((dep) => taskIndex.get(dep)), acceptance: `完成并验收：${taskTitle}` };
      });
      send('researchPlanCreate', { title, clusterId, tasks });
    };
  }

  function renderConclusions(panel) {
    const items = state.conclusions || [];
    const statusClass = (status) => ({ supported: 'supported', contested: 'contested', superseded: 'superseded' }[status] || 'candidate');
    const traceMarkup = (item) => {
      const trace = state.conclusionTraces?.[item.id];
      if (!trace) return '';
      if (!trace.ok) return `<div class="conclusion-detail-panel"><p>证据链读取失败：${esc(trace.message || trace.error || '未知错误')}</p></div>`;
      const detail = trace.trace || {};
      return `<section class="conclusion-detail-panel" aria-label="完整证据链"><h3>完整证据链</h3><p>${esc(detail.summary || '')}</p><ol>${(detail.steps || []).map((step) => `<li><b>${esc(step.label)}</b>：<code>${esc(step.source)}</code><br><span>${esc(step.note)}</span><small>${esc(step.verification)}${step.sha256 ? ` · 指纹 ${esc(step.sha256.slice(0, 12))}…` : ''}</small></li>`).join('') || '<li>尚未登记证据支点。</li>'}</ol><p class="conclusion-status-note">${esc(detail.status_note || '')}</p></section>`;
    };
    panel.innerHTML = `<section class="conclusion-hero"><span class="idea-kicker">CLAIM · EVIDENCE · REPRODUCIBILITY</span><h1>🔗 研究结论</h1><p>结论不是笔记。每一条都应连到分析产物、文献、受控运行或项目内证据，并保留可核验的支点。</p><div class="conclusion-metrics"><span><b>${items.length}</b> 条结论</span><span><b>${items.filter((i) => i.status === 'supported').length}</b> 已支持</span><span><b>${items.reduce((n, i) => n + (i.evidence || []).length, 0)}</b> 个证据支点</span><button class="idea-select" id="conclusionReconcile" title="重建项目结论索引与归档快照">同步结论库</button></div>${state.conclusionError ? `<p class="research-hint">结论库读取失败：${esc(state.conclusionError)}</p>` : ''}</section>
    <section class="conclusion-compose"><textarea id="conclusionText" placeholder="输入一条需要管理的核心结论"></textarea><div><input id="conclusionEvidence" placeholder="项目内分析产物路径，如：结果文件/tables/result.csv"><select id="conclusionStatus"><option value="candidate">候选结论</option><option value="supported">已有支持</option><option value="contested">存在争议</option></select><button class="idea-primary" id="conclusionSave">保存结论</button></div></section>
    <section class="conclusion-list">${items.length ? items.slice().reverse().map((item, index) => `<article class="conclusion-card conclusion-card-clickable" data-id="${esc(item.id)}"><div class="conclusion-number">${String(items.length - index).padStart(2, '0')}</div><div class="conclusion-main"><span class="conclusion-status ${statusClass(item.status)}">${esc(item.status || 'candidate')}</span><h2>${esc(item.statement || '')}</h2><p>更新于 ${esc(item.updated_at || item.created_at || '—')}</p><div class="evidence-chain">${(item.evidence || []).length ? item.evidence.map((e) => `<span class="evidence-pill ${e.exists === false ? 'missing' : ''}"><b>${esc(e.type)}</b> ${esc(e.ref || '未命名引用')}${e.sha256 ? ' · SHA-256' : ''}${e.run_found === false ? ' · 未找到运行' : ''}</span>`).join('') : '<span class="evidence-pill missing">尚无证据支点</span>'}</div><button class="idea-select conclusion-trace-toggle" data-id="${esc(item.id)}">${state.conclusionTraces?.[item.id] ? '收起证据链' : '查看完整证据链'}</button>${traceMarkup(item)}</div></article>`).join('') : '<div class="idea-empty">尚无结论。先录入候选结论，再将分析结果、文献或运行编号附到它上面。</div>'}</section>`;
    panel.querySelector('#conclusionSave').onclick = () => {
      const statement = panel.querySelector('#conclusionText').value;
      const ref = panel.querySelector('#conclusionEvidence').value;
      const status = panel.querySelector('#conclusionStatus').value;
      send('conclusionUpsert', { statement, status, evidence: ref ? [{ type: 'analysis', ref, note: '由研究者在结论工作台关联' }] : [] });
    };
    panel.querySelector('#conclusionReconcile').onclick = () => send('conclusionReconcile');
    panel.querySelectorAll('.conclusion-trace-toggle').forEach((button) => {
      button.onclick = () => {
        const id = button.dataset.id;
        if (state.conclusionTraces?.[id]) { delete state.conclusionTraces[id]; renderTop(); }
        else send('conclusionTrace', { id });
      };
    });
    panel.querySelectorAll('.conclusion-card-clickable').forEach((card) => {
      card.onclick = (event) => {
        if (event.target.closest('button') || event.target.closest('.conclusion-detail-panel')) return;
        const id = card.dataset.id;
        if (state.conclusionTraces?.[id]) { delete state.conclusionTraces[id]; renderTop(); }
        else send('conclusionTrace', { id });
      };
    });
  }

  // ── 管线 tab ──
  function renderPipeline(panel) {
    if (!state.pipeline) {
      panel.innerHTML = `
        <div class="scenario-pick">
          <h3>${t('selectScenario')}</h3>
          <input class="project-input" id="projName" placeholder="${t('projectName')}">
          ${(state.scenarioList || []).map((s) => `
            <button class="scenario-btn" data-id="${s.id}">${s.label}</button>
          `).join('')}
          <button class="ctrl-btn" style="margin-top:4px" onclick="window.__ddj.scan()">${t('scanKb')}</button>
        </div>`;
      app.querySelectorAll('.scenario-btn').forEach((b) => {
        b.onclick = () => {
          const name = app.querySelector('#projName')?.value || '';
          send('startPipeline', { scenario: b.dataset.id, projectName: name });
        };
      });
      window.__ddj.scan = () => send('scan');
      return;
    }

    const pl = state.pipeline;
    const mode = pl.enforcement_mode || 'soft';
    const handoffExists = state.handoff && state.handoff.exists;
    const curIdx = pl.steps.findIndex((s) => s.id === pl.current_step);
    const doneN = pl.steps.filter((s) => s.status === 'done').length;
    const pct = pl.steps.length ? Math.round(doneN / pl.steps.length * 100) : 0;
    const upcoming = pl.steps.filter((_, i) => i > curIdx).slice(0, 5);
    let html = `
      ${handoffExists ? `
        <div class="handoff-banner">
          🔄 ${fmt(t('handoffBanner'), { time: state.handoff.createdAt ? state.handoff.createdAt.slice(0, 16).replace('T', ' ') : '' })}<br>
          <small>${t('handoffBannerSub')}</small>
        </div>` : ''}
      ${pl.is_custom ? `<div class="plan-custom-tag">${t('customPlan')}</div>` : ''}
      <div class="tl-progress">
        <div class="tl-progress-label">${t('progress')} ${doneN}/${pl.steps.length} · ${pct}%</div>
        <div class="tl-progress-bar"><div class="tl-progress-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="timeline">
        ${pl.steps.map((s, i) => {
          const isActive = s.status === 'active';
          const isDone = s.status === 'done';
          const isLast = i === pl.steps.length - 1;
          return `
            <div class="tl-node ${s.status} ${isActive ? 'active' : ''}">
              <div class="tl-node-line">
                <div class="tl-dot ${isActive ? 'pulse' : ''}">${isDone ? '✓' : (isActive ? '▶' : '')}</div>
                ${!isLast ? `<div class="tl-connector ${isDone ? 'done' : ''}"></div>` : ''}
              </div>
              <div class="tl-card ${isActive ? 'active' : ''}" data-step-label="${s.label}">
                <div class="tl-card-head">
                  <span class="tl-step-no">${i + 1}</span>
                  <span class="tl-label">${s.label}${isActive ? ' <span class="tl-now">' + t('now') + '</span>' : ''}${s.status === 'stale' ? ' <span class="tl-stale">' + t('stale') + '</span>' : ''}</span>
                  <span class="tl-actions">
                    <button class="tl-act" onclick="window.__ddj.moveStep('${s.id}','up')" title="${t('moveUp')}">↑</button>
                    <button class="tl-act" onclick="window.__ddj.moveStep('${s.id}','down')" title="${t('moveDown')}">↓</button>
                    ${!isActive ? `<button class="tl-act del" onclick="window.__ddj.removeStep('${s.id}')" title="${t('remove')}">✕</button>` : ''}
                  </span>
                </div>
                ${s.allowed && s.allowed.length ? `<div class="tl-allowed">${s.allowed.join('；')}</div>` : ''}
                ${s.required_artifacts && s.required_artifacts.length ? `<div class="tl-required">${t('artifacts')} ${s.required_artifacts.join('、')}</div>` : ''}
              </div>
            </div>`;
        }).join('')}
      </div>
      <button class="ctrl-btn add-step-btn" onclick="window.__ddj.addStep()">${t('addStep')}</button>
      ${upcoming.length ? `
        <div class="tl-upcoming">
          <div class="tl-upcoming-title">${t('upcoming')}</div>
          ${upcoming.map((s) => `<div class="tl-upcoming-item">${s.label}</div>`).join('')}
        </div>` : ''}
      <div class="step-history" id="stepHistoryBox">
        <div class="step-history-title">${t('stepHistory')}</div>
        <div id="stepHistoryFeed"></div>
      </div>
      <div class="mode-toggle">
        <button class="mode-btn ${mode === 'soft' ? 'active' : ''}" data-mode="soft">${t('softSub')}</button>
        <button class="mode-btn hard ${mode === 'hard' ? 'active' : ''}" data-mode="hard">${t('hardSub')}</button>
      </div>
      <div class="ctrl-row">
        <button class="ctrl-btn" id="rollbackBtn" ${pl.current_step === pl.steps[0].id ? 'disabled' : ''}>${t('rollbackBtn')}</button>
        <button class="ctrl-btn" id="advanceBtn" ${pl.current_step === pl.steps[pl.steps.length - 1].id ? 'disabled' : ''}>${t('advanceBtn')}</button>
      </div>
      <div class="ctrl-row">
        <button class="ctrl-btn" onclick="window.__ddj.refresh()">${t('refresh')}</button>
        <button class="ctrl-btn" onclick="window.__ddj.scan()">${t('scan')}</button>
      </div>
      <div class="ctrl-row">
        <button class="ctrl-btn" id="resetBtn" title="${t('resetPipeline')}">${t('resetPipeline')}</button>
      </div>
      <div class="ctrl-row">
        <button class="ctrl-btn handoff-btn" id="pauseBtn">${t('pause')}</button>
        ${handoffExists ? `<button class="ctrl-btn handoff-resume" id="resumeBtn">${t('resume')}</button>` : ''}
      </div>`;
    panel.innerHTML = html;
    app.querySelectorAll('.mode-btn').forEach((b) => {
      b.onclick = () => send('setMode', { mode: b.dataset.mode });
    });
    app.querySelector('#advanceBtn').onclick = () => send('advance');
    app.querySelector('#rollbackBtn').onclick = () => send('rollback');
    const resetBtn = app.querySelector('#resetBtn');
    if (resetBtn) resetBtn.onclick = () => send('requestReset');
    const pauseBtn = app.querySelector('#pauseBtn');
    if (pauseBtn) pauseBtn.onclick = () => send('pauseProject');
    const resumeBtn = app.querySelector('#resumeBtn');
    if (resumeBtn) resumeBtn.onclick = () => send('resumeProject');
    window.__ddj.refresh = () => send('refresh');
    window.__ddj.scan = () => send('scan');
    window.__ddj.addStep = () => send('addStep');
    window.__ddj.removeStep = (stepId) => send('removeStep', { stepId });
    window.__ddj.moveStep = (stepId, dir) => send('moveStep', { stepId, dir });
    renderStepHistory();
  }

  function renderStepHistory() {
    const feed = document.getElementById('stepHistoryFeed');
    if (!feed) return;
    const hist = state.stepHistory || [];
    if (!hist.length) {
      feed.innerHTML = '<div class="sh-empty">' + t('waiting') + '</div>';
      return;
    }
    feed.innerHTML = hist.map((h) => `
      <div class="sh-item">
        <span class="sh-time">${h.at || ''}</span>
        <span class="sh-arrow">${h.from} → ${h.to}</span>
        ${h.stepsChanged ? '<span class="sh-badge">📝</span>' : ''}
      </div>
    `).join('');
  }

  // ── 工具管理 tab ──
  function renderTools(panel) {
    const mods = [
      ['A', 'modA', '📚', 'modADesc'],
      ['B', 'modB', '🗄️', 'modBDesc'],
      ['C', 'modC', '🧬', 'modCDesc'],
      ['D', 'modD', '📊', 'modDDesc'],
      ['E', 'modE', '✍️', 'modEDesc'],
    ];
    let html = '<div class="tools-grid">';
    for (const [key, labelKey, icon, descKey] of mods) {
      const m = state.status['mod_' + key.toLowerCase()] || { pct: 0, items: [] };
      const items = (m.items || []).map((it) => it.name).filter(Boolean).slice(0, 5);
      html += `
        <div class="tool-card">
          <div class="tool-card-head"><span class="tool-icon">${icon}</span><span class="tool-label">${key} · ${t(labelKey)}</span><span class="tool-pct">${m.pct}%</span></div>
          <div class="bar"><div class="bar-fill" style="width:${m.pct}%"></div></div>
          <div class="tool-items">${items.length ? items.map((n) => `<span class="tool-item">${n}</span>`).join('') : '<span class="tool-item off">' + t('notDetected') + '</span>'}</div>
          <div class="tool-desc">${t(descKey)}</div>
        </div>`;
    }
    html += '</div>';
    html += `
      <div class="sec-title">${t('extTools')}</div>
      <div class="ext-tools-card">
        <div class="ext-tools-head">
          <span class="ext-tools-icon">⚡</span>
          <span class="ext-tools-title">${t('extToolsTitle')}</span>
          <span class="ext-tools-count">${fmt(t('registered'), { n: (state.extTools || []).length })}</span>
        </div>
        <div class="ext-tools-body">
          ${(state.extTools || []).length ? state.extTools.map((x) => `<div class="ext-tool-row"><span class="ext-tool-name">${x}</span></div>`).join('') : '<div class="ext-tools-empty">' + t('noExt') + '</div>'}
        </div>
        <div class="ext-tools-foot">${t('extToolsFoot')}</div>
      </div>`;
    html += '<div class="sec-title">' + t('aboutTools') + '</div>';
    html += '<div class="digest">' + t('aboutToolsDesc') + '</div>';
    panel.innerHTML = html;
  }

  // ── 项目资料库 tab ──
  function fileRow(f) {
    const icon = f.kind === 'ris' ? '📚' : f.kind === 'search-log' ? '🔎' : f.kind === 'audit' ? '🔍' : f.kind === 'review' ? '📝' : '📁';
    return `<div class="kb-entry" data-path="${f.path}">
      <div class="t"><span class="ui-icon">${icon}</span> ${f.name}</div>
      <div class="meta"><span>${f.kind}</span><span>${f.rel}</span></div>
    </div>`;
  }

  function renderLiteratureWindow() {
    const box = app.querySelector('#literatureBox');
    if (!box) return;
    const q = (state.litQuery || '').trim().toLowerCase();
    const rows = (state.literature || []).filter((r) => {
      if (!q) return true;
      return [r.title, r.authors, r.journal, r.year, r.doi, r.source].some((x) => String(x || '').toLowerCase().includes(q));
    });
    const selected = state.selectedLiterature || rows[0] || null;
    if (!state.selectedLiterature && selected) state.selectedLiterature = selected;
    box.innerHTML = `
      <input class="kb-search" id="litQuery" placeholder="${t('literatureSearch')}" value="${esc(state.litQuery || '')}">
      <div class="literature-split">
        <div class="literature-list">
          ${rows.slice(0, 80).map((r, i) => `
            <div class="kb-entry lit-entry ${selected === r ? 'active' : ''}" data-lit-idx="${i}">
              <div class="t">${esc(r.title || 'Untitled')}</div>
              <div class="meta">
                ${r.year ? `<span>${esc(r.year)}</span>` : ''}
                ${r.journal ? `<span>${esc(r.journal)}</span>` : ''}
                ${r.doi ? `<span>DOI ${esc(r.doi)}</span>` : ''}
              </div>
            </div>`).join('') || '<div class="empty">' + t('literatureNone') + '</div>'}
        </div>
        <div class="literature-detail">
          ${selected ? `
            <div class="lit-title">${esc(selected.title || 'Untitled')}</div>
            <div class="meta">
              ${selected.authors ? `<span>${esc(Array.isArray(selected.authors) ? selected.authors.join(', ') : selected.authors)}</span>` : ''}
              ${selected.year ? `<span>${esc(selected.year)}</span>` : ''}
              ${selected.journal ? `<span>${esc(selected.journal)}</span>` : ''}
              ${selected.doi ? `<span>DOI ${esc(selected.doi)}</span>` : ''}
              ${selected.source ? `<span>${esc(selected.source)}</span>` : ''}
            </div>
            ${(selected.abstract || selected.body) ? `<div class="digest lit-body">${esc(selected.abstract || selected.body)}</div>` : ''}
          ` : '<div class="empty">' + t('literatureNone') + '</div>'}
        </div>
      </div>`;
    const qEl = app.querySelector('#litQuery');
    if (qEl) qEl.oninput = (e) => { state.litQuery = e.target.value; state.selectedLiterature = null; renderLiteratureWindow(); };
    app.querySelectorAll('.lit-entry').forEach((el) => {
      el.onclick = () => {
        state.selectedLiterature = rows[Number(el.dataset.litIdx)];
        renderLiteratureWindow();
      };
    });
  }

  function renderProjectNotes() {
    const list = app.querySelector('#kbList');
    if (!list) return;
    const q = (state.kbQuery || '').trim().toLowerCase();
    const notes = (state.projectLib?.notes || []).filter((n) => {
      if (!q) return true;
      return (n.name + ' ' + n.rel).toLowerCase().includes(q);
    });
    list.innerHTML = notes.slice(0, 60).map(fileRow).join('')
      || '<div class="empty">' + t(q ? 'noMatch' : 'projNotesNone') + '</div>';
    app.querySelectorAll('#kbList .kb-entry').forEach((el) => el.onclick = () => send('openFile', { path: el.dataset.path }));
  }

  function renderProjectForms() {
    const kbWrap = app.querySelector('#kbFormWrap');
    if (kbWrap) {
      kbWrap.innerHTML = state.showAddForm ? `
        <div class="kb-add-form">
          <input id="kbTitle" placeholder="${t('titlePh')}">
          <select id="kbTypeSel">
            <option value="learning" selected>${t('learning')}</option>
            <option value="paper">${t('paper')}</option>
            <option value="sop">${t('sop')}</option>
            <option value="journal">${t('journal')}</option>
            <option value="data-dict">${t('data')}</option>
          </select>
          <textarea id="kbBody" placeholder="${t('bodyPh')}"></textarea>
          <button class="save" onclick="window.__ddj.kbAdd()">${t('save')}</button>
        </div>` : '';
    }
    const auditWrap = app.querySelector('#auditFormWrap');
    if (auditWrap) {
      auditWrap.innerHTML = state.showAuditForm ? `
        <div class="kb-add-form">
          <input id="arTitle" placeholder="${t('projAuditTitlePh')}">
          <textarea id="arBody" placeholder="${t('projAuditBodyPh')}"></textarea>
          <button class="save" onclick="window.__ddj.auditAdd()">${t('save')}</button>
        </div>` : '';
    }
    const reviewWrap = app.querySelector('#reviewFormWrap');
    if (reviewWrap) {
      reviewWrap.innerHTML = state.showReviewForm ? `
        <div class="kb-add-form">
          <input id="rrTitle" placeholder="${t('projReviewTitlePh')}">
          <textarea id="rrBody" placeholder="${t('projReviewBodyPh')}"></textarea>
          <button class="save" onclick="window.__ddj.reviewAdd()">${t('save')}</button>
        </div>` : '';
    }
  }

  function renderProject(panel) {
    const pl = state.pipeline;
    const lib = state.projectLib || { notes: [], risFiles: [], searchLogs: [], audit: null, review: null };
    let html = '<div class="sec-title">📁 ' + t('projectLib') + '</div>';
    html += `
      <div class="dash-card">
        <div class="dash-card-title">${t('currentProject')}</div>
        <div class="dash-card-value">${state.projectName || lib.project || t('notConnected')}</div>
        <div class="dash-card-sub">${pl ? t('scenarioColon') + ' ' + (pl.scenario || '') : t('noPipeline')}</div>
      </div>`;
    html += `<input class="kb-search" id="kbQuery" placeholder="${t('searchProject')}" value="${state.kbQuery}">`;

    html += '<div class="sec-title">📚 ' + t('literatureWindow') + '</div><div id="literatureBox"></div>';

    html += '<div class="sec-title">📚 ' + t('projRis') + '</div>';
    html += lib.risFiles.length
      ? lib.risFiles.map(fileRow).join('')
      : '<div class="empty">' + t('projRisNone') + '</div>';

    html += '<div class="sec-title">🔎 ' + t('projSearchLog') + '</div>';
    html += lib.searchLogs.length
      ? lib.searchLogs.map(fileRow).join('')
      : '<div class="empty">' + t('projSearchLogNone') + '</div>';

    html += '<div class="sec-title">💡 ' + t('projNotes') + '</div>';
    html += '<div id="kbList"></div>';
    html += `<button class="kb-add-btn" id="kbAddBtn">${t('addNote')}</button><div id="kbFormWrap"></div>`;

    html += '<div class="sec-title">🔍 ' + t('projAudit') + '</div>';
    if (lib.audit) html += fileRow(lib.audit);
    html += `<button class="kb-add-btn" id="auditAddBtn">${t('projAuditAdd')}</button><div id="auditFormWrap"></div>`;

    html += '<div class="sec-title">📝 ' + t('projReview') + '</div>';
    if (lib.review) html += fileRow(lib.review);
    html += `<button class="kb-add-btn" id="reviewAddBtn">${t('projReviewAdd')}</button><div id="reviewFormWrap"></div>`;

    panel.innerHTML = html;
    state.kbScope = 'project';
    app.querySelector('#kbQuery').oninput = (e) => { state.kbQuery = e.target.value; renderProjectNotes(); };
    app.querySelector('#kbAddBtn').onclick = () => { state.showAddForm = !state.showAddForm; renderProjectForms(); if (state.showAddForm) app.querySelector('#kbTitle')?.focus(); };
    app.querySelector('#auditAddBtn').onclick = () => { state.showAuditForm = !state.showAuditForm; renderProjectForms(); if (state.showAuditForm) app.querySelector('#arTitle')?.focus(); };
    app.querySelector('#reviewAddBtn').onclick = () => { state.showReviewForm = !state.showReviewForm; renderProjectForms(); if (state.showReviewForm) app.querySelector('#rrTitle')?.focus(); };
    app.querySelectorAll('.kb-entry').forEach((el) => el.onclick = () => send('openFile', { path: el.dataset.path }));
    window.__ddj.kbAdd = () => {
      const title = app.querySelector('#kbTitle')?.value || t('titlePh');
      const body = app.querySelector('#kbBody')?.value || '';
      const type = app.querySelector('#kbTypeSel')?.value || 'learning';
      const subdir = type === 'paper' ? 'papers' : (type === 'data-dict' ? 'data-dicts' : (type === 'sop' ? 'sop' : (type === 'journal' ? 'journals' : 'learnings')));
      send('kbAdd', { title, body, type, subdir, project: state.projectName || undefined, scope: 'project' });
    };
    window.__ddj.auditAdd = () => {
      send('kbAdd', { type: 'audit', title: app.querySelector('#arTitle')?.value || t('projAuditTitlePh'), body: app.querySelector('#arBody')?.value || '', scope: 'project' });
    };
    window.__ddj.reviewAdd = () => {
      send('kbAdd', { type: 'review', title: app.querySelector('#rrTitle')?.value || t('projReviewTitlePh'), body: app.querySelector('#rrBody')?.value || '', scope: 'project' });
    };
    renderLiteratureWindow();
    renderProjectNotes();
    renderProjectForms();
  }

  // ── 绘图 tab（V2.3：科研绘图模块入口）──
  function plotTypeHint(type) {
    return t('plotHint_' + (type || 'scatter'));
  }

  function renderPlot(panel) {
    const f = state.plot.form;
    const busy = state.plot.busy;
    const check = state.plot.check;
    const imgHtml = (s, cls) => {
      const src = s.thumb || s.uri;
      if (!src) return `<div class="plot-thumb-empty">${s.ext || '?'}</div>`;
      return `<img class="${cls}" src="${src}" loading="lazy" onerror="window.__ddj.imgFail(this)">`;
    };
    let html = '<div class="sec-title">🎨 ' + t('plotModule') + '</div>';

    // A. 绘图栈体检
    html += '<div class="dash-card"><div class="dash-card-title">' + t('plotStack') + '</div>';
    if (check && check.summary) {
      const s = check.summary;
      const pyOk = Object.values(s.python || {}).filter((v) => v !== 'MISSING').length;
      const pyTotal = Object.keys(s.python || {}).length;
      const rOk = Object.values(s.r || {}).filter((v) => v !== 'MISSING').length;
      const rTotal = Object.keys(s.r || {}).length;
      html += '<div class="plot-chips">' +
        `<span class="plot-chip ${s.status === 'OK' ? 'ok' : 'no'}">${t('plotStatus')}: ${s.status}</span>` +
        `<span class="plot-chip">Python ${pyOk}/${pyTotal}</span>` +
        `<span class="plot-chip">R ${rOk}/${rTotal}</span></div>`;
    } else if (check && check.error) {
      html += `<div class="plot-chip no">${check.error}</div>`;
    } else {
      html += '<div class="dash-card-sub">' + t('plotCheckHint') + '</div>';
    }
    html += `<button class="ctrl-btn" id="plotCheckBtn" ${busy.checking ? 'disabled' : ''}>${busy.checking ? '<span class="spin"></span> ' : ''}${t('plotCheck')}</button></div>`;

    // A2. 图片审计 + 统计报告（共享后端）
    const audit = state.plot.audit;
    const stats = state.plot.stats;
    html += '<div class="sec-title">' + t('figureAudit') + '</div>';
    html += `<div class="dash-card">
      <div class="ctrl-row">
        <button class="ctrl-btn" id="figureAuditBtn" ${busy.auditing ? 'disabled' : ''}>${busy.auditing ? '<span class="spin"></span> ' : ''}${t('figureAuditRun')}</button>
        <button class="ctrl-btn" id="figureAuditAiBtn" ${busy.auditing ? 'disabled' : ''}>${t('figureAuditAi')}</button>
      </div>`;
    if (audit?.summary) {
      const s = audit.summary;
      html += `<div class="plot-chips">
        <span class="plot-chip ${s.visual_issues ? 'no' : 'ok'}">视觉 ${s.visual_issues || 0}/${s.total || 0}</span>
        <span class="plot-chip ${s.data_issues ? 'no' : 'ok'}">数据 ${s.data_issues || 0}/${s.total || 0}</span>
        <span class="plot-chip ${s.ai_issues ? 'no' : 'ok'}">AI ${s.ai_issues || 0}/${s.ai_checked || 0}</span>
      </div>`;
      html += `<div class="audit-list">${(audit.figures || []).slice(0, 20).map((r) => {
        const issues = []
          .concat(r.visual?.issues || [])
          .concat(r.data?.status && r.data.status !== 'ok' ? [r.data.detail || r.data.status] : [])
          .concat(r.ai && !r.ai.ok ? (r.ai.issues || ['AI 发现疑点']) : []);
        return `<div class="audit-row ${issues.length ? 'warn' : 'ok'}">
          <span>${issues.length ? '⚠' : '✓'}</span>
          <div><div class="audit-name">${esc(r.name)}</div><div class="audit-detail">${esc(issues.join('；') || '通过')}</div></div>
        </div>`;
      }).join('')}</div>`;
    } else if (audit?.error) {
      html += `<div class="plot-chip no">${esc(audit.error)}</div>`;
    } else {
      html += '<div class="empty">' + t('figureAuditNone') + '</div>';
    }
    html += '</div>';

    html += '<div class="sec-title">' + t('statsReport') + '</div>';
    html += `<div class="dash-card">
      <button class="ctrl-btn" id="statsReportBtn" ${busy.stats ? 'disabled' : ''}>${busy.stats ? '<span class="spin"></span> ' : ''}${t('statsReportRun')}</button>
      ${stats ? `<div class="plot-msg ${stats.ok ? '' : 'path'}">${stats.ok ? '✅' : '❌'} ${esc(stats.msg || stats.error || '')}</div>${stats.path ? `<div class="plot-msg path">${esc(stats.path)}</div>` : ''}` : ''}
    </div>`;

    // B. 样例图库
    html += '<div class="sec-title">' + t('plotSamples') + '</div>';
    html += `<button class="ctrl-btn" id="plotSamplesBtn" ${busy.rendering ? 'disabled' : ''}>${busy.rendering ? '<span class="spin"></span> ' : ''}${t('plotSamplesRun')}</button>`;
    if (state.plot.samples.length) {
      html += '<div class="plot-grid">' + state.plot.samples.map((s) =>
        `<div class="plot-card" onclick="window.__ddj.plotPreview('${s.path.replace(/'/g, "\\'")}','${s.uri || ''}','${s.name.replace(/'/g, "\\'")}')" title="${s.name}">` +
        imgHtml(s, 'plot-thumb') +
        `<div class="plot-card-name">${s.name}</div></div>`).join('') + '</div>';
    } else {
      html += '<div class="empty">' + t('plotSamplesNone') + '</div>';
    }

    // C. 数据出图
    html += '<div class="sec-title">' + t('plotGenerate') + '</div>';
    html += `<div class="dash-card plot-form">
      <div class="plot-row"><span class="plot-label">CSV</span><input class="kb-search" id="pCsv" value="${f.csv}" placeholder="/Users/you/data.csv"></div>
      <div class="plot-row"><span class="plot-label">${t('plotType')}</span>
        <select id="pType">${['scatter', 'line', 'hist', 'box', 'bar', 'volcano'].map((v) => `<option value="${v}" ${f.type === v ? 'selected' : ''}>${t('plotType_' + v)}</option>`).join('')}</select></div>
      <div class="plot-row"><span class="plot-label">X</span><input id="pX" value="${f.x}" placeholder="${f.type === 'volcano' ? 'log2FC' : t('plotX')}"></div>
      <div class="plot-row"><span class="plot-label">Y</span><input id="pY" value="${f.y}" placeholder="${f.type === 'volcano' ? 'pvalue' : t('plotY')}"></div>
      <div class="plot-row"><span class="plot-label">${t('plotGroup')}</span><input id="pGroup" value="${f.group}" placeholder="${t('plotGroupPh')}"></div>
      <div class="plot-row"><span class="plot-label">${t('plotTitle')}</span><input id="pTitle" value="${f.title}"></div>
      <div class="plot-row"><span class="plot-label">${t('plotOut')}</span><input id="pName" value="${f.name}" placeholder="figure"></div>
      <div class="plot-row"><span class="plot-label">${t('plotFormat')}</span>
        <select id="pFormat">${['png', 'pdf', 'svg'].map((v) => `<option value="${v}" ${f.format === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="plot-row"><span class="plot-label">${t('plotStyle')}</span>
        <select id="pStyle">${['nature', 'science', 'ieee', 'grid', 'retina', 'default'].map((v) => `<option value="${v}" ${f.style === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="plot-row"><span class="plot-label">${t('plotPalette')}</span>
        <select id="pPalette">${['viridis', 'colorblind', 'default'].map((v) => `<option value="${v}" ${f.palette === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="plot-row"><span class="plot-label">${t('plotSize')}</span>
        <div class="plot-presets">
          <button class="mode-btn ${f.width === '3.5' ? 'active' : ''}" data-w="3.5" data-h="2.6">${t('plotTwoCol')}</button>
          <button class="mode-btn ${f.width === '7' ? 'active' : ''}" data-w="7" data-h="4.5">${t('plotOneCol')}</button>
          <span class="dash-card-sub">${t('plotDpi')}:</span><input id="pDpi" type="number" value="${f.dpi}" style="width:64px">
        </div></div>
      <div class="plot-hint">${plotTypeHint(f.type)}</div>
      <button class="ctrl-btn" id="pRun" ${busy.generating ? 'disabled' : ''}>${busy.generating ? '<span class="spin"></span> ' : ''}${t('plotRun')}</button>
    </div>`;

    if (state.plot.last) {
      const L = state.plot.last;
      html += `<div class="dash-card ${L.ok ? '' : 'plot-err'}"><div class="dash-card-title">${t('plotResult')}</div>`;
      if (L.ok) html += imgHtml(L, 'plot-preview');
      html += `<div class="plot-msg">${L.ok ? '✅ ' : '❌ '}${L.msg || ''}</div>`;
      if (L.ok && L.path) html += `<div class="plot-msg path">${L.path} ` +
        `<button class="mode-btn" onclick="window.__ddj.plotPreview('${L.path.replace(/'/g, "\\'")}','${L.uri || ''}','${(L.path.split('/').pop() || '').replace(/'/g, "\\'")}')">🔍 ${t('plotOpen')}</button></div>`;
      html += '</div>';
    }

    // D. 历史图库
    html += '<div class="sec-title">' + t('plotHistory') + '</div>';
    html += `<button class="ctrl-btn" id="pListBtn" ${busy.listing ? 'disabled' : ''}>${busy.listing ? '<span class="spin"></span> ' : ''}${t('plotRefresh')}</button>`;
    if (state.plot.files.length) {
      html += '<div class="plot-grid">' + state.plot.files.map((s) =>
        `<div class="plot-card" onclick="window.__ddj.plotPreview('${s.path.replace(/'/g, "\\'")}','${s.uri || ''}','${s.name.replace(/'/g, "\\'")}')" title="${s.name}">` +
        imgHtml(s, 'plot-thumb') +
        `<div class="plot-card-name">${s.name}</div></div>`).join('') + '</div>';
    } else {
      html += '<div class="empty">' + t('plotHistoryNone') + '</div>';
    }

    if (state.plot.lightbox) {
      const lb = state.plot.lightbox;
      html += `<div class="plot-lightbox" onclick="window.__ddj.plotCloseLightbox()">
        <div class="plot-lightbox-inner" onclick="event.stopPropagation()">
          <div class="plot-lightbox-head"><span title="${(lb.name || '').replace(/"/g, '&quot;')}">${lb.name || ''}</span>
          <button class="mode-btn" onclick="window.__ddj.plotCloseLightbox()">✕</button></div>
          ${lb.uri ? `<img class="plot-lightbox-img" src="${lb.uri}" onerror="window.__ddj.imgFail(this)">` : ''}
          <button class="ctrl-btn" onclick="window.__ddj.plotOpen('${lb.path.replace(/'/g, "\\'")}')">${t('plotOpen')}</button>
        </div>
      </div>`;
    }

    panel.innerHTML = html;

    const bindInput = (id, key) => {
      const el = app.querySelector(id);
      if (el) el.oninput = (e) => { state.plot.form[key] = e.target.value; };
    };
    bindInput('#pCsv', 'csv'); bindInput('#pX', 'x'); bindInput('#pY', 'y');
    bindInput('#pGroup', 'group'); bindInput('#pTitle', 'title'); bindInput('#pName', 'name');
    const bindSelect = (id, key) => {
      const el = app.querySelector(id);
      if (el) el.onchange = (e) => {
        state.plot.form[key] = e.target.value;
        if (id === '#pType') {
          const h = app.querySelector('.plot-hint');
          if (h) h.textContent = plotTypeHint(e.target.value);
        }
      };
    };
    bindSelect('#pType', 'type'); bindSelect('#pFormat', 'format');
    bindSelect('#pStyle', 'style'); bindSelect('#pPalette', 'palette');
    const dpi = app.querySelector('#pDpi');
    if (dpi) dpi.oninput = (e) => { state.plot.form.dpi = e.target.value; };
    app.querySelectorAll('.plot-presets .mode-btn').forEach((b) => {
      b.onclick = () => { state.plot.form.width = b.dataset.w; state.plot.form.height = b.dataset.h; renderPlot(panel); };
    });
    app.querySelector('#plotCheckBtn').onclick = () => { state.plot.busy.checking = true; renderPlot(panel); send('plotCheck'); };
    app.querySelector('#figureAuditBtn').onclick = () => { state.plot.busy.auditing = true; renderPlot(panel); send('figureAudit', { ai: false }); };
    app.querySelector('#figureAuditAiBtn').onclick = () => { state.plot.busy.auditing = true; renderPlot(panel); send('figureAudit', { ai: true }); };
    app.querySelector('#statsReportBtn').onclick = () => { state.plot.busy.stats = true; renderPlot(panel); send('statsReport'); };
    app.querySelector('#plotSamplesBtn').onclick = () => { state.plot.busy.rendering = true; renderPlot(panel); send('plotSamples'); };
    app.querySelector('#pListBtn').onclick = () => { state.plot.busy.listing = true; renderPlot(panel); send('plotList'); };
    app.querySelector('#pRun').onclick = () => {
      state.plot.busy.generating = true;
      renderPlot(panel);
      send('plotGenerate', {
        csv: state.plot.form.csv, type: state.plot.form.type,
        x: state.plot.form.x, y: state.plot.form.y, group: state.plot.form.group,
        title: state.plot.form.title, name: state.plot.form.name,
        format: state.plot.form.format, style: state.plot.form.style, palette: state.plot.form.palette,
        width: state.plot.form.width, height: state.plot.form.height, dpi: state.plot.form.dpi,
      });
    };
  }

  // ── 设置 tab ──
  function renderSettings(panel) {
    const api = state.apiInventory || {};
    const anchor = state.anchor || {};
    const backend = state.backendState || {};
    const pipelineText = state.pipeline ? `${state.pipeline.current_step || ''} · ${state.pipeline.enforcement_mode || 'soft'}` : t('noPipeline');
    const anchorOk = !anchor.broken;
    const recentRuns = (state.runs || []).slice().reverse().slice(0, 5);
    panel.innerHTML = `
      <div class="sec-title">${t('tabSettings')}</div>
      <div class="settings-block">
        <div class="settings-row">
          <span class="settings-label">${t('themeLabel')}</span>
          <div class="settings-controls">
            <button class="mode-btn ${state.theme === 'dark' ? 'active' : ''}" data-theme="dark">${t('dark')}</button>
            <button class="mode-btn ${state.theme === 'light' ? 'active' : ''}" data-theme="light">${t('light')}</button>
            <button class="mode-btn ${state.theme === 'auto' || !state.theme ? 'active' : ''}" data-theme="auto">${t('autoTheme')}</button>
          </div>
        </div>
        <div class="settings-row">
          <span class="settings-label">${t('langLabel')}</span>
          <div class="settings-controls">
            <button class="mode-btn ${state.lang === 'zh' || !state.lang ? 'active' : ''}" data-lang="zh">${t('zh')}</button>
            <button class="mode-btn ${state.lang === 'en' ? 'active' : ''}" data-lang="en">${t('en')}</button>
          </div>
        </div>
      </div>
      <div class="sec-title">${t('bindWorkspace')}</div>
      <div class="dash-card">
        <input class="kb-search" id="workspacePath" placeholder="${t('bindWorkspacePh')}" value="${esc(state.workspaceInput || '')}">
        <div class="dash-card-sub">${esc(state.projectName || t('notConnected'))}</div>
      </div>
      <div class="sec-title">${t('healthCard')}</div>
      <div class="ext-tools-card">
        <div class="fusion-row"><span>Backend 19999</span><span class="fusion-st ${state.status ? 'ok' : 'no'}">${state.status ? t('fusionReady') : t('fusionMissing')}</span></div>
        <div class="fusion-row"><span>Pipeline</span><span class="fusion-st">${esc(pipelineText)}</span></div>
        <div class="fusion-row"><span>Audit Chain</span><span class="fusion-st ${backend.chain?.ok === false ? 'no' : 'ok'}">${esc(backend.chain?.message || '—')}</span></div>
      </div>
      <div class="sec-title">${t('apiCard')}</div>
      <div class="ext-tools-card">
        <div class="ext-tools-foot">数据库和搜索 API 需由你在官方平台注册申请，再保存到本地后端 API 库（~/ddj/api_keys.json）。叮咚鸡与智能体可以说明申请入口、教程和配置步骤；请勿将密钥发到对话中。</div>
        ${(api.keys || []).length ? api.keys.map((k) => `<div class="fusion-row"><span>${esc(k.name)}</span><span class="fusion-st ${k.set ? 'ok' : 'no'}">${k.set ? 'set' : 'missing'}</span></div>`).join('') : '<div class="empty">No managed API keys</div>'}
        <div class="ext-tools-foot">${esc(api.backend_ts || '')}</div>
      </div>
      <div class="sec-title">${t('anchorCard')}</div>
      <div class="ext-tools-card ${anchorOk ? '' : 'anchor-broken'}">
        <div class="fusion-row"><span>Anchor</span><span class="fusion-st ${anchorOk ? 'ok' : 'no'}">${anchorOk ? 'OK' : 'BROKEN'}</span></div>
        <div class="fusion-row"><span>Step</span><span class="fusion-st">${esc(anchor.stepId || '—')}</span></div>
        <div class="fusion-row"><span>Chain</span><span class="fusion-st">${esc(anchor.chainHash || '—')}</span></div>
        <div class="ext-tools-foot">${esc(anchor.path || '')}</div>
      </div>
      <div class="sec-title">运行与检查点</div>
      <div class="ext-tools-card">
        ${recentRuns.length ? recentRuns.map((run) => `<div class="fusion-row"><span>${esc(run.task_type || 'run')} · ${esc((run.run_id || '').slice(0, 8))}</span><span class="fusion-st ${run.status === 'succeeded' ? 'ok' : (run.status === 'failed' ? 'no' : '')}">${esc(run.status || 'unknown')}</span></div>`).join('') : '<div class="empty">暂无受控运行记录</div>'}
      </div>
      <div class="digest">${t('settingsSave')}</div>
    `;
    const wsInput = app.querySelector('#workspacePath');
    if (wsInput) {
      wsInput.oninput = (e) => { state.workspaceInput = e.target.value; };
      wsInput.onkeydown = (e) => {
        if (e.key === 'Enter') send('setWorkspace', { path: state.workspaceInput });
      };
    }
    app.querySelectorAll('[data-theme]').forEach((b) => {
      b.onclick = () => { state.theme = b.dataset.theme; applyTheme(state.theme); send('setPreference', { key: 'theme', value: b.dataset.theme }); renderSettings(panel); };
    });
    app.querySelectorAll('[data-lang]').forEach((b) => {
      b.onclick = () => { state.lang = b.dataset.lang; send('setPreference', { key: 'lang', value: b.dataset.lang }); renderTop(); };
    });
  }

  // ── 知识库 tab ──
  function renderKb(panel) {
    const types = [
      ['', 'allTypes'], ['paper', 'paper'], ['data-dict', 'data'],
      ['sop', 'sop'], ['journal', 'journal'], ['learning', 'learning'], ['lesson', 'learning'],
    ];
    let html = `
      <div class="kb-scope">
        <button class="${state.kbScope === 'global' ? 'active' : ''}" data-scope="global">${t('globalKb')}</button>
      </div>
      <input class="kb-search" id="kbQuery" placeholder="${t('searchGlobal')}" value="${state.kbQuery}">
      <div class="kb-type">
        ${types.map(([v, lk]) => `<button class="${state.kbType === v ? 'active' : ''}" data-type="${v}">${t(lk)}</button>`).join('')}
      </div>
      <div id="kbList"></div>
      <button class="kb-add-btn" id="kbAddBtn">${t('addNote')}</button>
      <div id="kbFormWrap"></div>
      <div class="digest">${t('lessonOnly')}</div>
      ${state.digest ? `<div class="sec-title">${t('kbDigest')}</div><div class="digest">${state.digest}</div>` : ''}
    `;
    panel.innerHTML = html;
    if (!state.kbScope || state.kbScope !== 'global') state.kbScope = 'global';
    app.querySelectorAll('.kb-scope button').forEach((b) => {
      b.onclick = () => { state.kbScope = b.dataset.scope; renderKb(panel); };
    });
    app.querySelectorAll('.kb-type button').forEach((b) => {
      b.onclick = () => { state.kbType = b.dataset.type; renderKb(panel); };
    });
    app.querySelector('#kbQuery').oninput = (e) => {
      state.kbQuery = e.target.value;
      filterKb();
    };
    app.querySelector('#kbAddBtn').onclick = () => {
      state.showAddForm = !state.showAddForm;
      renderKb(panel);
      if (state.showAddForm) app.querySelector('#kbTitle')?.focus();
    };
    window.__ddj.kbAdd = () => {
      const title = app.querySelector('#kbTitle')?.value || t('titlePh');
      const body = app.querySelector('#kbBody')?.value || '';
      send('kbAdd', { title, body, type: 'lesson', subdir: 'lessons', project: state.projectName || undefined, scope: 'global' });
    };
    filterKb();
  }

  function filterKb() {
    const list = app.querySelector('#kbList');
    if (!list) return;
    const q = (state.kbQuery || '').toLowerCase();
    const entries = (state.kbEntries || [])
      .filter((e) => !state.kbScope || e.scope === state.kbScope)
      .filter((e) => !state.kbType || e.type === state.kbType)
      .filter((e) => {
        if (!q) return true;
        return (e.title || '').toLowerCase().includes(q) || (e.tags || []).some((tg) => tg.toLowerCase().includes(q));
      })
      .slice(0, 30);
    list.innerHTML = entries.map((e) => `
      <div class="kb-entry" data-path="${e.path}">
        <div class="t"><span class="ui-icon">${e.scope === 'global' ? '🌐 ' : '📁 '}</span>${e.title}</div>
        <div class="meta">
          <span>${e.type || ''}</span>
          <span>${e.scope === 'global' ? t('globalScope') : t('projectScope')}</span>
          ${e.source ? `<span>${e.source}</span>` : ''}
          ${e.project ? `<span>${e.project}</span>` : ''}
          ${(e.tags || []).slice(0, 4).map((tg) => `<span class="tag">${tg}</span>`).join('')}
        </div>
      </div>
    `).join('') || '<div class="empty">' + t('noMatch') + '</div>';
    if (!entries.length && !q) {
      list.innerHTML = '<div class="empty">' + t('kbEmpty') + '<br><span style="font-size:11px;color:var(--t2)">' + t('kbEmptySub') + '</span></div>';
    }
    app.querySelectorAll('.kb-entry').forEach((el) => {
      el.onclick = () => send('openFile', { path: el.dataset.path });
    });
    if (state.showAddForm) {
      const wrap = app.querySelector('#kbFormWrap');
      wrap.innerHTML = `
        <div class="kb-add-form">
          <input id="kbTitle" placeholder="${t('titlePh')}">
          <input value="lesson · ${t('globalScope')}" disabled>
          <textarea id="kbBody" placeholder="${t('bodyPh')}"></textarea>
          <button class="save" onclick="window.__ddj.kbAdd()">${t('save')}</button>
        </div>`;
    }
  }

  // ── 消息接收 ──
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'state':
        if (state.workspacePath && state.workspacePath !== (msg.workspacePath || '')) researchStage = 'questions';
        state.workspacePath = msg.workspacePath || '';
        state.status = msg.status;
        state.backendState = msg.backendState || null;
        state.activities = msg.activities || [];
        state.pipeline = msg.pipeline || null;
        state.projectName = msg.projectName || '';
        state.scenarioList = msg.scenarioList || [];
        state.kbEntries = msg.kbEntries || [];
        if (msg.projectLib) state.projectLib = msg.projectLib;
        state.literature = msg.literature || [];
        state.runs = msg.runs || [];
        state.ideas = msg.ideas || [];
        state.conclusions = msg.conclusions || [];
        state.conclusionError = msg.conclusionError || '';
        state.questionClusters = msg.questionClusters || [];
        state.researchPlans = msg.researchPlans || [];
        state.continuations = msg.continuations || null;
        state.apiInventory = msg.apiInventory || null;
        state.anchor = msg.anchor || null;
        if (msg.citations) { state.citations = msg.citations; state.citationBusy = msg.citations.status === 'pending'; }
        state.digest = msg.digest || '';
        state.handoff = msg.handoff || null;
        state.updatedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        if (msg.preferences) {
          state.theme = msg.preferences.theme || state.theme;
          state.lang = msg.preferences.lang || state.lang;
          state.agent = msg.preferences.agent || state.agent;
        }
        if (msg.extTools) state.extTools = msg.extTools || [];
        if (msg.codexFusion) state.codexFusion = msg.codexFusion;
        applyTheme(state.theme);
        renderTop();
        break;
      case 'pipelineUpdated':
        state.pipeline = msg.pipeline;
        send('getAll');
        break;
      case 'ideaResult':
        if (msg.result?.ok) {
          const draft = researchDrafts.get(draftKey());
          if (draft && msg.result.idea?.status !== 'selected') delete draft.ideaText;
          if (msg.result.idea?.status === 'selected') { state.tab = 'dashboard'; researchStage = 'questions'; }
        }
        showToast(msg.result?.ok ? 'Idea 树已更新；请选择构想后再启动研究管线。' : (msg.result?.message || msg.result?.error || 'Idea 树操作失败'), msg.result?.ok ? 'info' : 'warn');
        send('getAll');
        break;
      case 'conclusionResult':
        if (msg.result?.ok) {
          const draft = researchDrafts.get(draftKey());
          if (draft) ['conclusionText', 'conclusionEvidence', 'conclusionStatus'].forEach((id) => delete draft[id]);
        }
        showToast(msg.result?.ok ? '结论及其证据链已保存。' : (msg.result?.message || msg.result?.error || '结论保存失败'), msg.result?.ok ? 'info' : 'warn');
        send('getAll');
        break;
      case 'conclusionReconcileResult':
        showToast(msg.result?.ok ? `结论库已同步：${msg.result.count || 0} 条结论，${msg.result.repaired || 0} 条归档已修复。` : (msg.result?.message || msg.result?.error || '结论库同步失败'), msg.result?.ok ? 'info' : 'warn');
        send('getAll');
        break;
      case 'conclusionTraceResult':
        state.conclusionTraces[msg.id] = msg.result || { ok: false, error: 'empty_trace_result' };
        renderTop();
        break;
      case 'continuationResult':
        if (msg.result?.ok) {
          const draft = researchDrafts.get(draftKey());
          if (draft) ['continuationTitle', 'continuationNotes'].forEach(id => delete draft[id]);
        }
        showToast(msg.result?.ok ? '后续任务草稿和来源快照已保存；未启动执行或生成论文。' : (msg.result?.error || '保存失败，草稿已保留'), msg.result?.ok ? 'info' : 'warn');
        send('getAll');
        break;
      case 'planBindingResult':
        showToast(msg.result?.ok ? '计划与管线关联已保存；未启动执行。' : (msg.result?.error || '关联失败，请刷新重试。'), msg.result?.ok ? 'info' : 'warn');
        send('getAll');
        break;
      case 'researchAgentReady':
        showToast('研究协作上下文已准备。请在 Codex 对话中输入 Idea 或继续讨论；尚未自动发送。', 'info');
        break;
      case 'scheduleResult':
        showToast(msg.result?.ok ? '调度状态已更新。' : (msg.result?.error || '调度请求失败'), msg.result?.ok ? 'info' : 'warn');
        send('getAll');
        break;
      case 'researchAgentError':
        showToast(msg.message || '智能体入口打开失败，请重试。', 'warn');
        break;
      case 'questionClusterResult':
        if (msg.result?.ok) {
          const draft = researchDrafts.get(draftKey()) || {};
          ['clusterTitle', 'primaryQuestion', 'mechanismQuestion'].forEach((id) => delete draft[id]);
          draft.planCluster = msg.result.cluster?.id || '';
          researchDrafts.set(draftKey(), draft);
          state.tab = 'dashboard'; researchStage = 'plans';
        }
        showToast(msg.result?.ok ? '问题集群已确立，可将其作为研究计划的起点。' : (msg.result?.message || msg.result?.error || '问题集群保存失败'), msg.result?.ok ? 'info' : 'warn');
        send('getAll');
        break;
      case 'researchPlanResult':
        if (msg.result?.ok) {
          const draft = researchDrafts.get(draftKey()) || {};
          ['planTitle', 'planTasks'].forEach((id) => delete draft[id]);
          state.tab = 'dashboard'; researchStage = 'plans';
        }
        showToast(msg.result?.ok ? '计划草稿已保存，任务尚未执行。请确认输入、产出与验收条件，再交给智能体执行。' : (msg.result?.message || msg.result?.error || '研究计划保存失败'), msg.result?.ok ? 'info' : 'warn');
        send('getAll');
        break;
      case 'pipelineCleared':
        state.pipeline = null;
        renderTop();
        break;
      case 'auditWarning':
        showToast(t('auditWarn') + (msg.warnings || []).join('；'), 'warn');
        break;
      case 'auditInfo':
        showToast(t('auditOk') + (msg.message || ''), 'info');
        break;
      case 'stepSwitch':
        state.stepHistory = state.stepHistory || [];
        state.stepHistory.unshift(msg);
        if (state.stepHistory.length > 15) state.stepHistory.length = 15;
        showToast(fmt(t('stepSwitchToast'), { from: msg.from, to: msg.to, at: msg.at }), 'info');
        if (state.tab === 'dashboard') {
          const feed = document.getElementById('stepHistoryFeed');
          if (feed) renderStepHistory();
        }
        if (msg.to && document.querySelector('[data-step-label="' + msg.to + '"]')) {
          const el = document.querySelector('[data-step-label="' + msg.to + '"]').closest('.tl-card');
          if (el) { el.classList.remove('tl-flash'); void el.offsetWidth; el.classList.add('tl-flash'); }
        }
        break;
      case 'pipelineError':
        showToast(msg.message, 'warn');
        break;
      case 'artifactWarning':
        showToast(fmt(t('artifactWarn'), { step: msg.step || '', missing: (msg.missing || []).join('、') }), 'warn');
        break;
      case 'kbUpdated':
        send('getAll');
        break;
      case 'kbResults':
        state.kbEntries = msg.entries || [];
        renderTop();
        break;
      case 'kbSaved':
        state.showAddForm = false;
        send('getAll');
        break;
      case 'kbDenied':
        showToast(t('kbDenied'), 'warn');
        break;
      case 'workspaceSetResult':
        showToast(msg.message || '', msg.ok ? 'info' : 'warn');
        break;
      case 'switchTab':
        state.tab = msg.tab || 'dashboard';
        renderTop();
        break;
      case 'triggerPlotCheck':
        send('plotCheck');
        break;
      case 'triggerPlotSamples':
        send('plotSamples');
        break;
      case 'plotCheckResult':
        state.plot.busy.checking = false;
        state.plot.check = msg;
        renderTop();
        break;
      case 'plotSamplesResult':
        state.plot.busy.rendering = false;
        state.plot.samples = msg.files || [];
        state.plot.check = msg.error ? { error: msg.error } : (msg.summary ? { summary: msg.summary } : state.plot.check);
        renderTop();
        break;
      case 'plotGenerateResult':
        state.plot.busy.generating = false;
        state.plot.last = msg;
        renderTop();
        break;
      case 'plotListResult':
        state.plot.busy.listing = false;
        state.plot.files = msg.files || [];
        renderTop();
        break;
      case 'figureAuditResult':
        state.plot.busy.auditing = false;
        state.plot.audit = msg.result || null;
        renderTop();
        break;
      case 'statsReportResult':
        state.plot.busy.stats = false;
        state.plot.stats = msg.result || null;
        renderTop();
        break;
      case 'citationResult':
        state.citations = msg.status || msg.result || null;
        state.citationBusy = !!(state.citations && state.citations.status === 'pending');
        renderTop();
        break;
      default:
        break;
    }
  });

  // ── 初始 ──
  renderTop();
  send('getAll');
})();
