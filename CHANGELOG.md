# 更新日志 (Changelog)

## [Unreleased] 投稿管理 docx 免费面板内预览 + 手稿列表稳定 - 2026-09-22

以下为当前源码的阶段汇总，不表示已发布。

- **修复：刷新手稿后很快消失**：`ddjRenderSubmissions` 此前每次状态刷新都无条件重置列表；现在 webview 侧缓存文件清单，状态刷新后按缓存重绘，卡片不再被清空。
- **docx 改为免费本地渲染**：点击 `.docx` 用本机 `mammoth`（`~/ddj/venvs/docx-render`，docx→语义 HTML、图片内联 base64）在**原面板小窗口**内预览；没有 mammoth 时回退 macOS `textutil` 的 HTML（文字/排版，不含图片），再回退纯文本。不切换页面、不依赖收费查看器。
- **安全渲染**：docx HTML 经标签/属性白名单清洗后再注入（丢弃 `<script>`、事件属性、`javascript:` 链接；仅允许 `data:image/*` 图片与 http(s)/mailto 链接）。
- **外部查看器改为可选**：原「原生 docx 窗口」入口保留但改名为「外部查看器打开」，明确为可选且可能收费；默认不再走它。
- **验证**：`npm run verify` 通过；`工程文件/test_docx_preview.py`（Chromium 真实组件回归）覆盖列表刷新后仍在、docx HTML 清洗渲染、非 docx 不套用 docx 样式，全部通过。

## [Unreleased] Codex 掉线加固与 DSH 能力对齐 - 2026-09-22

以下为当前源码的阶段汇总，不表示已发布。

- **Codex 掉线加固**：新增 30 分钟静默看门狗（只断开、不自动重放，避免重复执行）；进程退出信息带信号；识别 `error`/`turn/failed` 上游错误并给出可读原因；连接状态显示错误摘要。
- **失败汇报更清晰**：轮次失败/中断时使用状态化兜底文案（提示可能有上游错误、可重试；中断不会自动重放），不再统一显示"未收到最终汇报"。
- **DSH 图像附件**：从此前直接拒绝改为 ACP `resource_link` 转发，并强制校验附件位于当前项目工作区内；与 Codex 的本地图像附件能力对齐（实际是否被模型读取取决于 DSH 路由的图像能力）。
- **DSH 官方能力登记**：核查 `dsh --profile acp --dump-config` 的 85 个官方包，将会话恢复、模型/推理强度、权限审批、上下文压缩、技能/网页检索/子代理/工作流、图像附件登记为可发现能力；未安装任何第三方插件、未改动 dsh 默认 profile。
- **已知缺口（如实记录）**：DSH over ACP 不支持 elicitation，`dsh-tool-ask-user` 不在 acp profile，因此 DSH 无法像 Codex `requestUserInput` 那样弹出提问卡片。
- **验证**：`npm run verify` 通过；项目 node 回归 10/10 通过（`test_deepseek_compatibility.cjs` 已按 resource_link 新行为更新）。

## [Unreleased] 内置对话窗口的交互卡片（提问 + 审批）- 2026-09-16

以下为当前源码的阶段汇总，不表示已发布。

- **会话内提问（Codex）**：`item/tool/requestUserInput` 不再逐题弹出原生输入框，而是渲染为对话窗口内的提问卡片；问题、选项、选项说明与进度一并展示，可点选、可自定义输入、可显式跳过，提交后把答案回传给 app-server。
- **会话内审批（DeepSeek Harness）**：`session/request_permission` 不再只弹原生模态框，而是渲染为审批卡片，展示工具标题、命令/路径等参数与 Harness 提供的全部选项（`allow_once`/`allow_always`/`reject_once`/`reject_always`）；“始终允许”以警示色区分，批准只回传所选 `optionId`，取消等同拒绝。
- **交互细节**：多问题一次性展示；支持单选与多选（`multiSelect`）；每题的“跳过此题”会明确记录为空回答；提交按钮在全部问题都有回答或跳过前禁用；支持键盘 Enter 提交、取消整次交互，并带 `aria-pressed`/`aria-live` 与焦点样式。
- **稳健性**：没有内置窗口时分别回退到原有逐题输入框 / 原生模态审批；面板关闭、切换工作区或停止任务时自动结算未回答的交互，避免智能体挂起；回答与 `optionId` 都在扩展侧做类型/长度/白名单清洗，不直接信任 webview 输入。
- **修复（卡片点不动）**：卡片改为 flex 列布局，问题/详情区可滚动、操作按钮固定在卡片底部始终可见；卡片出现时自动收起管理台并让对话区可滚动，避免按钮被 `#fusion-chat` 的 `overflow:hidden` 裁掉而无法点击。补充 `[hidden]` 显式隐藏、`pointer-events`/`z-index` 保护；对已超时或窗口重载后失效的响应回传明确错误，不再静默无反应。
- **修复（只剩文字、无法交互）**：卡片渲染后回执 `fusionInteractionAck`；扩展在约 2.5s 内未收到回执时，`fusionInteractionClose` 收起卡片并回退到**可点击的原生快速选择**（选项列表 + “自定义回答”），不再只给一个只能输入的文字占位。Codex 与 DSH 两条路径都适用；原生回退同样支持多选。
- **验证**：`test_ask_user_component.py`/`test_dsh_approval_card.py` 在 700px 短窗口下增加“可见且可命中”的 `elementFromPoint` 断言、渲染回执断言与 `fusionInteractionClose` 收起断言并通过；其余回归与 `npm run verify` 通过。
- **验证**：新增 `工程文件/test_ask_user_component.py` 与 `工程文件/test_dsh_approval_card.py`（Chromium 真实组件回归）通过；既有 fusion/侧栏/仪表盘/引用卡片回归与 `render_v24_details.py` 通过；`npm run verify`（tsc + webview 语法）通过。未打包、未发布。

## [Unreleased] 引用跨库核验自动接入 - 2026-09-16

以下为当前源码的阶段汇总，不表示已发布。

- **后端权威逐条核验**：`citation_verification.py` 解析项目内每条引用（编号手稿 md/txt/docx、RIS/BibTeX），在 PubMed 与 Crossref 两个独立库交叉核对；仅当两库元数据一致且无撤稿/更新信号时为 `verified`，冲突、未找到、来源不可用、待审均不通过（fail-closed）。
- **新 API**：`GET /api/audit/citations?auto=1` 返回逐条紧凑状态（不含上游原始记录），需要时自动排队核验；`POST /api/audit/citations {force}` 显式重跑。
- **自动触发**：打开/扫描项目、扩展刷新（`getAll`）、保存手稿 / `.ris` / `.bib` 后，后端自动排队跨库核验；24h 内同指纹结果复用，同一项目同时只跑一个核验任务。
- **扩展可见**：状态栏常驻徽标（通过 / 未通过 / 离线）+ 仪表盘「引用跨库核验」卡片，逐条显示两库来源与状态，可一键重新核验；核验期间轮询直至完成。
- **不越权**：扩展只请求/触发/展示，不参与判定，也不因本地展示放宽后端结论；上游只发送公开引用元数据到固定端点，不发送手稿正文或凭据。
- **验证**：后端 73 项测试通过（新增引用解析/核验 11 项 + 接口 5 项）；`npm run verify`（tsc + webview 语法）通过。未打包、未发布。

## [Unreleased] V2.4 审计候选版 - 2026-09-16

以下为当前源码的阶段汇总，不表示已发布。保留后续历史条目原貌。

- 科研闭环：Idea 与问题集群、计划执行、结论证据及后续研究入口。
- 融合工作台：仪表盘与对话分区、拖动调整、会话管理、模式切换与统一小鸡品牌。
- 项目智能体协作：Codex App Server 与 DeepSeek Harness ACP 接入，确认后串行交接会话。
- 每轮汇报：工作细节折叠、完整历史保留、Codex 成功轮次后的原生压缩请求。
- 投稿管理：全局作者库与当前工作区手稿扫描、文本预览和作者导入。
- 详情页：统一 V2.4 名称、版本元数据及发布前审计说明；明确权限、数据和测试边界。

本轮仅整理详情页与发布资料，不打包、不发布；发布前检查清单保存在内部维护资料中，不随扩展分发。

## [2.4.0] - 2026-08-11

### 项目资料库模块重构（仅读取当前工作区）
- **修复跨项目混杂**：项目资料库不再读全局 index 的项目条目，改为 `listProjectLibrary()` 只扫描
  当前工作区 `工程文件/kb/` 与 `结果文件/`，杜绝切换工作区串项目。
- **分类展示**：文献 RIS 库（`*.ris`）、检索记录（search_log / 检索日志）、经验教训/笔记、
  审计记录、审稿意见五类分区展示，支持搜索笔记、点击打开文件。
- **审计记录 / 审稿意见独立文件**：`工程文件/kb/audit_records.md` + `工程文件/kb/review_comments.md`
  （自动创建模板），面板可一键追加（`appendAuditReview`，时间戳分段，登记全局索引）。

### 验证
- `tsc` 零错误；`main.js` 语法通过；`listProjectLibrary` / `appendAuditReview` 实测通过（含临时目录追加测试）。

## [2.3.1] - 2026-08-11

### 修复：绘图模块预览黑屏 + 多智能体整合
- **预览黑屏根治**：样例图/历史图/生成结果改为服务端 Pillow 生成 base64 缩略图
  （`src/plot/make_thumbs.py`），不再依赖 webview 资源 URI 加载；图片加载失败时显示
  「预览不可用」占位而非黑块。
- **预览体验完善**：点击缩略图弹出灯箱大图预览（放大查看 + 打开原图按钮），历史图库 PDF/SVG 显示格式徽章。
- **Life Science Research 插件多智能体落地**：插件副本迁移至 `~/ddj/plugins/life-science-research`，
  Codex（personal 市场重装）+ Claude Code（`~/.claude/skills` 50 个链接）+ ddj 技能库三端兼容；
  `~/.codex/models.json` 两处 `max` → `xhigh` 修复 codex CLI 0.133 兼容。

### 验证
- `tsc` 零错误；`main.js` / `package.json` / `make_thumbs.py` 校验通过；缩略图脚本实测输出 base64。

## [2.3.0] - 2026-08-10

### 科研绘图模块（V2.3）
- **主菜单新增「绘图」入口**：左侧导航栏新增 🎨 绘图页 + 命令面板命令 `ddj.openPlot`（打开绘图模块）/ `ddj.plotCheck`（体检绘图栈）/ `ddj.plotSamples`（渲染并预览样例）。
- **绘图栈体检卡**：一键运行 `ddj-plot-check --json`，展示 Python 8 包 + R 16 包状态（OK/DOWN 徽章 + 计数）。
- **样例图库（图片预览）**：一键渲染全套样例图（PY 4 类 + R 8 类，含 PRISMA/火山/森林/热图/生存曲线等），网格缩略图预览，点击在编辑器打开。
- **数据出图生成器**：`src/plot/plot_from_csv.py` 从 CSV 一键生成 6 类出版级图（散点+趋势 / 折线 / 直方图 / 箱线图+Mann-Whitney 显著性标注 / 均值±SD 柱状图 / 火山图），支持期刊样式（nature/science/ieee）、色盲友好配色（viridis/colorblind）、双栏 3.5in / 单栏 7in 尺寸预设、300+ DPI、PNG/PDF/SVG 输出，成品自动存入 `结果文件/figures/` 并即时预览。
- **历史图库**：浏览 `结果文件/figures/` 已有图（PNG/JPG/PDF/SVG），缩略图预览 + 点击打开。
- **质量规范内置**：出图前提示目标期刊图宽/配色/字体纪律；强制关闭 LaTeX 渲染（mathtext），避免缺 TeX 包导致出图失败；中文字体自动配置。

### 修复
- `scienceplots` 样式在缺 cm-super 的 TinyTeX 环境下触发 LaTeX 渲染失败 → 生成器统一 `text.usetex=False`。
- seaborn boxplot `palette` 弃用警告 → 改用 `hue + legend=False`。
- R 样例渲染缺 R4 热图：macOS 上 `png()`（quartz 设备）在加载 ComplexHeatmap 命名空间后不落盘 → `r_plot_check.R` 热图段改用 `ragg::agg_png`，全套 8 张 R 样例 + 4 张 PY 样例全部生成。

### 验证
- `tsc` 零错误；`main.js` / `package.json` / `plot_from_csv.py` 语法与 JSON 校验通过。
- 生成器 6 类图型全部实测 `PLOT_OK`（含显著性标注的箱线图）。

## [2.2.0] - 2026-08-10

### 上架与多智能体（部署发布）
- **商店打包就绪**：新增 `Publishing.md` 发布指南（vsce/Open VSX/Marketplace 上架步骤 + 新环境稳健性验证矩阵）；README 补环境要求与多智能体支持矩阵；package.json 补 `bugs` 字段，版本 2.1.1 → 2.2.0。
- **新环境稳健性**：移除硬编码默认工作区路径（`DEFAULT_WORKSPACE`）；后端启动增加 `serverScriptExists()` + `resolvePython()`（`python3.12 → python3 → python` 回退）与 `DDJ_BUS_DIR` 覆盖；无 `~/ddj` 资产时静默降级为离线面板。
- **Agent 自包含**：`src/agents/*.md` 的检索辅助器路径改为 `{{DDJ_SCRIPTS}}` 占位符，`installAgents()` 安装时按实际扩展目录替换；hooks 的 `python3.12` 改为运行时探测。
- **多智能体通用**：`ensureClaudeContext` 新增 `.cursor/rules/dingdongji.mdc`（Cursor 规则 @import 管线上下文）；`handoff.ts` 模板遗留路径 `~/ddj/dingdongji/kb/` → `~/ddj/kb/`。

## [2.1.3] - 2026-08-10

### Codex 深度融合
- 工作区 `AGENTS.md` 自动维护：`ensureClaudeContext` 现在同时写 CLAUDE.md 与 AGENTS.md（均 @import `叮咚鸡_pipeline_context.md`）
- 工具页新增「🤖 Codex 融合」状态卡（AGENTS.md 上下文 / ddj CLI / 上下文更新时间，i18n 中英）
- `getAll` 推送 codexFusion 状态；配套 `.fusion-card/.fusion-row/.fusion-st` 样式（亮暗主题）


## [2.1.2] - 2026-08-10

### Codex 正式接入
- 侧栏新增 🤖 Codex 入口 + 顶栏「启动 Codex」按钮（打开 Codex for VS Code 官方扩展 openai.chatgpt，未安装时给出指引）
- 设置页 Codex 由「开发中」改为正式可用；i18n 文案同步更新
- extension.ts 新增 `openCodex` 消息处理（含 fallback）

## [2.1.2] - 2026-08-10

### Webview UI（维护智能体）
- **总栏铺满左侧竖条**：左侧导航栏由「悬浮圆角模块」改为通栏竖条（满高、贴左、右侧接缝分隔线），内容区独立留白；收起/展开功能保留，状态记忆不变
- **新增 Codex for VS Code 入口**：左栏底部新增 🤖 Codex 按钮，顶栏新增「Codex」按钮，一键打开 OpenAI Codex 侧边栏（`chatgpt.openSidebar`，官方扩展 `openai.chatgpt`），未安装时提示安装


## [2.1.1] - 2026-08-10

### Webview UI（维护智能体）
- **左侧栏布局**：顶部 5 tab 改为 Claude Code 式左侧栏（图标+标签，可收起/展开，状态记忆）
- **i18n 全量覆盖**：中/英字典补齐全部 UI 文案（原先约 40% → 100%，含仪表盘/管线/工具/知识库/设置）
- **主题完善**：补齐亮色模式缺失覆盖（hero hard、tl-now、tl-stale、rail 等）
- 迁移收尾：`src/agents/literature-search.md`、`scripts/retrieval_helper.py` 中 `~/.claude` 旧路径全部改为 `~/ddj`

### 后端（dashboard_server.py）
- `KEY_STORE`/`BUS_DIR` 指向 `~/ddj`（原 `~/.claude` 已迁移），密钥加载恢复（keys_loaded 0 → 7）
- 启动改为先绑定端口、自检/余额后台线程执行（冷启动 ~90s → ~3s 可用）

### 工具
- 新增 `ddj-mcp-check`（`~/ddj/tools/ddj_mcp_check.py`）：一键健康检查 8 个检索 MCP（MCP 握手 + tools/list），已注册 ext_tools
- 修复 CNKI MCP：Playwright Chromium 浏览器损坏 → 重装 macOS 版，检索恢复


## [2.1.0] - 2026-08-05

### 里程碑：三支柱成型
叮咚鸡升级为「实用工具整合 + 交接班-管线-审计复合工作流套件 + 跨窗口定制化记忆体」。

### 新增
- **软件开发管线 (SDLC)**：需求分析 → 系统设计 → 开发编码 → 测试验证 → 部署发布 → 维护迭代
- **默认工作区**：未打开文件夹时回退到用户配置的默认目录，不预设固定路径
- **两级知识库**：全局库（经验/算法/SOP，写入需授权）+ 项目库（RIS 文献/检索日志）
- **交接班机制**：暂停项目生成 `交接班.md`，多 Claude 窗口协同
- **管线实时可视化**：3s 轮询，Claude 自主推进实时反映到仪表盘
- **动态待办计划**：模板仅参考，可增删改步骤（addStep/removeStep/moveStep）
- **标准化交接班模板**：`交接班模板.md` 六节结构，持续档案永不重建
- **交接班自动工作总结**：扫描 search_log/文献/表格/脚本 → 两级摘要（检索了几条/产出在哪）
- **审计体系**：指纹哈希链防篡改、可复现性校验、审计链→PRISMA 自动生成、审计状态随交接班
- **跨窗口记忆体**：project_memory（步骤结论自动沉淀）+ lesson（全局教训跨项目复用）+ handoff_trace（交接痕迹）
- **Embase 渠道 + 免费补充库**：OpenAlex / Europe PMC / ClinicalTrials.gov / Cochrane

### 安全
- API 密钥统一入库 `~/.claude/api_keys.json`（权限 600）
- 移除 `settings.local.json` 明文密钥
- 消除硬编码 home 路径（改用 `os.homedir()`）
- 扩展自包含（商店安装后从安装目录读取资源）

### 安全
- API 密钥统一入库 `~/.claude/api_keys.json`（权限 600）
- 移除 `settings.local.json` 明文密钥
- 消除硬编码 home 路径（改用 `os.homedir()`）

### 检索
- Embase 渠道（真实 API + 无订阅优雅降级）
- OpenAlex / Europe PMC / ClinicalTrials.gov / Cochrane 补充库
- 检索辅助器防静默失败校验 + 统一审计链

## [2.0.0] - 2026-08-02

### 新增
- VSCode 扩展（取代原生 App）：仪表盘 / 管线 / 知识库三 tab
- 管线强制：UserPromptSubmit 注入 + PreToolUse 硬拦截
- 5 个分模块 agents（文献检索/数据获取/统计分析/手稿写作/质量审计）
- 研究知识库 + digest 注入
- 6 种研究场景管线
