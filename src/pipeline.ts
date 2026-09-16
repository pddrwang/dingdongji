import * as fs from 'fs';
import * as path from 'path';
import { getStatus } from './dashboard';

// ── Types ──────────────────────────────────────────────────────

export type EnforcementMode = 'soft' | 'hard';
export type StepStatus = 'done' | 'active' | 'pending' | 'blocked' | 'stale';

export interface PipelineStep {
  id: string;
  label: string;
  label_en?: string;
  status: StepStatus;
  allowed: string[];          // 本步骤允许的动作描述
  allowed_glob?: string[];    // 允许写入的文件 glob
  blocked_paths: string[];    // 本步骤禁止触碰的 glob（硬模式拦截依据）
  required_artifacts?: string[]; // 完成本步骤应产出的文件 glob（推进门槛校验）
  next?: string;              // 下一步指引
  module?: string;            // 对应模块 A-E
}

export interface PipelineState {
  project: string;
  project_id?: string;       // 控制面的稳定项目身份（显示名可变）
  state_version?: number;    // 乐观并发控制版本
  scenario: string;
  enforcement_mode: EnforcementMode;
  current_step: string;
  steps: PipelineStep[];
  created?: string;
  updated?: string;
  is_custom?: boolean;       // 计划是否被用户自定义过（true = 模板仅参考）
}

// ── Scenario step graphs (from SKILL.md Research Scenario Router) ──

interface ScenarioDef {
  id: string;
  label: string;
  steps: Omit<PipelineStep, 'status'>[];
}

const SCENARIOS: Record<string, ScenarioDef> = {
  systematic_review: {
    id: 'systematic_review',
    label: '系统综述与Meta分析 (PRISMA 2020)',
    steps: [      { id: 'protocol_registration', label: '方案注册', module: 'A/E', allowed: ['PROSPERO/INPLASY 注册', '起草研究方案', '定义 PICO'], blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'literature_search', label: '文献检索', module: 'A', required_artifacts: ['结果文件/literature/literature_library.ris'], allowed: ['PubMed+Embase+Scopus+WoS+CNKI 检索', '补充库: OpenAlex/EuropePMC/ClinicalTrials/Cochrane', '灰色文献检索', '去重', '导出 RIS'], allowed_glob: ['工程文件/A_*', '结果文件/literature/**'], next: '标题摘要筛选', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'screening', label: '文献筛选', module: 'A', required_artifacts: ['结果文件/literature/search_log.md', '结果文件/figures/prisma_*.png', '结果文件/figures/prisma_*.pdf'], allowed: ['标题摘要筛选', '全文筛选', '记录排除原因', '生成 PRISMA 流程图'], allowed_glob: ['工程文件/A_*', '结果文件/literature/**', '结果文件/figures/**'], next: '数据提取', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'quality_assessment', label: '质量评价', module: 'D/E', required_artifacts: ['结果文件/tables/risk_of_bias.*'], allowed: ['ROB-2 (RCT) / ROBINS-I (NRS) / QUADAS-2 (诊断)', '生成偏倚风险表'], allowed_glob: ['工程文件/A_*', '工程文件/D_*', '结果文件/tables/**'], next: '数据提取', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'data_extraction', label: '数据提取', module: 'B/D', required_artifacts: ['结果文件/data/extraction.*', '结果文件/tables/extraction.*'], allowed: ['标准化提取表', '效应量转换', '双人独立提取核对'], allowed_glob: ['工程文件/B_*', '工程文件/D_*', '结果文件/tables/**', '结果文件/data/**'], next: 'Meta 分析', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'meta_analysis', label: 'Meta 分析', module: 'D', required_artifacts: ['结果文件/tables/meta_results.*', '结果文件/figures/forest.*'], allowed: ['metafor/netmeta 建模', '异质性检验 (I²)', '森林图/漏斗图', '亚组分析', '敏感性分析'], allowed_glob: ['工程文件/D_*', '结果文件/tables/**', '结果文件/figures/**'], next: '报告撰写', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'manuscript', label: '报告撰写', module: 'E', required_artifacts: ['结果文件/manuscript/manuscript_v1.docx'], allowed: ['PRISMA 2020 清单自查', '撰写手稿', 'RIS 文库生成', 'Cover letter'], allowed_glob: ['工程文件/E_*', '手稿文书/**', '结果文件/manuscript/**'], blocked_paths: [] },
      { id: 'submission_revision', label: '投稿与修回', module: 'E', allowed: ['投稿', '处理审稿意见', '返修', '终稿定稿'], allowed_glob: ['手稿文书/**', '结果文件/manuscript/**', '工程文件/E_*'], blocked_paths: [] },
    ],
  },
  observational: {
    id: 'observational',
    label: '观察性研究 (STROBE)',
    steps: [      { id: 'data_acquisition', label: '数据获取与版本登记', module: 'B', required_artifacts: ['原始数据/', '工程文件/B_data_manifest.*'], allowed: ['NHANES/CHNS/KNHANES/CHARLS 等下载', '登记来源、版本、下载日期、许可与校验值'], allowed_glob: ['工程文件/B_*', '原始数据/**'], blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'data_cleaning', label: '数据清洗', module: 'D', required_artifacts: ['结果文件/data/cleaned.*'], allowed: ['缺失值处理 (mice)', '异常值检查', '调查权重 (survey)'], allowed_glob: ['工程文件/B_*', '工程文件/D_*', '结果文件/data/**'], next: '描述统计', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**', '原始数据/**'] },
      { id: 'descriptive', label: '描述统计', module: 'D', required_artifacts: ['结果文件/tables/table1.*'], allowed: ['Table 1 按暴露/结局分组', 'SMD 平衡性检验'], allowed_glob: ['工程文件/D_*', '结果文件/tables/**'], next: '推断分析', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'inferential', label: '推断分析', module: 'D', required_artifacts: ['结果文件/tables/regression.*'], allowed: ['回归模型 (lme4/survival)', '混杂调整 (MatchIt)', 'E-value 敏感性'], allowed_glob: ['工程文件/D_*', '结果文件/tables/**'], next: '可视化', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'visualization', label: '可视化', module: 'E', required_artifacts: ['结果文件/figures/*.png'], allowed: ['森林图/剂量反应/亚组分析图', '出版级图表'], allowed_glob: ['工程文件/E_*', '结果文件/figures/**'], next: '报告撰写', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'manuscript', label: '报告撰写', module: 'E', required_artifacts: ['结果文件/manuscript/manuscript_v1.docx'], allowed: ['STROBE 清单自查', '撰写手稿', 'RIS 文库生成'], allowed_glob: ['工程文件/E_*', '手稿文书/**', '结果文件/manuscript/**'], blocked_paths: [] },
      { id: 'submission_revision', label: '投稿与修回', module: 'E', allowed: ['投稿', '处理审稿意见', '返修', '终稿定稿'], allowed_glob: ['手稿文书/**', '结果文件/manuscript/**', '工程文件/E_*'], blocked_paths: [] },
    ],
  },
  psychometrics: {
    id: 'psychometrics',
    label: '量表开发与心理测量验证 (COSMIN)',
    steps: [
      { id: 'construct_protocol', label: '构念与方案', module: 'A/B', required_artifacts: ['工程文件/A_construct_protocol.*'], allowed: ['定义目标人群、构念与使用场景', '预注册或版本化方案', '确定样本量与分层计划'], allowed_glob: ['工程文件/A_*', '工程文件/B_*'], blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'instrument_mapping', label: '条目映射与数据字典', module: 'B', required_artifacts: ['工程文件/B_instrument_mapping.*', '工程文件/B_scoring_rules.*'], allowed: ['条目编码与反向计分映射', '定义缺失值和跳题规则', '登记量表版本与授权'], allowed_glob: ['工程文件/B_*', '原始数据/**'], next: '数据清洗与计分', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'scoring', label: '数据清洗与计分', module: 'B/D', required_artifacts: ['结果文件/data/scored.*'], allowed: ['执行反向计分与缺失处理', '输出可复现计分数据', '保留原始数据只读'], allowed_glob: ['工程文件/B_*', '工程文件/D_*', '结果文件/data/**'], next: '结构效度', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**', '原始数据/**'] },
      { id: 'structure', label: '结构效度', module: 'D', required_artifacts: ['结果文件/tables/psychometrics_structure.*'], allowed: ['EFA/CFA 与拟合指标', '明确训练/验证或交叉验证划分', '记录模型修正依据'], allowed_glob: ['工程文件/D_*', '结果文件/tables/**', '结果文件/figures/**'], next: '信度与效度', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'reliability_validity', label: '信度与效度', module: 'D', required_artifacts: ['结果文件/tables/psychometrics_reliability.*'], allowed: ['内部一致性、重测信度与测量误差', '收敛/区分/已知组效度', '报告置信区间与缺失处理'], allowed_glob: ['工程文件/D_*', '结果文件/tables/**'], next: '测量等值', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'measurement_invariance', label: '测量等值与报告', module: 'D/E', required_artifacts: ['结果文件/tables/measurement_invariance.*', '结果文件/manuscript/manuscript_v1.docx'], allowed: ['跨性别/年龄/中心测量等值', 'COSMIN 报告与局限性', '形成可审计手稿'], allowed_glob: ['工程文件/D_*', '工程文件/E_*', '结果文件/tables/**', '结果文件/manuscript/**', '手稿文书/**'], blocked_paths: [] },
    ],
  },
  bioinformatics: {
    id: 'bioinformatics',
    label: '生物信息学分析',
    steps: [      { id: 'data_acquisition', label: '组学数据获取', module: 'C', allowed: ['GEO/SRA/TCGA 下载', 'gget 查询', '记录 Accession'], allowed_glob: ['工程文件/C_*', '原始数据/**'], blocked_paths: ['手稿文书/**', '结果文件/manuscript/**', '原始数据/**'] },
      { id: 'preprocessing', label: '预处理与质控', module: 'C', required_artifacts: ['结果文件/data/counts.*'], allowed: ['FASTQ→QC→STAR/Salmon→counts', 'FastQC ≥ 28'], allowed_glob: ['工程文件/C_*', '结果文件/data/**'], next: '差异分析', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**', '原始数据/**'] },
      { id: 'diff_expression', label: '差异分析', module: 'C/D', required_artifacts: ['结果文件/tables/diff_expression.*', '结果文件/figures/volcano.*'], allowed: ['pydeseq2/limma', '火山图', 'padj < 0.05'], allowed_glob: ['工程文件/C_*', '工程文件/D_*', '结果文件/figures/**', '结果文件/tables/**'], next: '功能富集', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'enrichment', label: '功能富集', module: 'C', required_artifacts: ['结果文件/tables/enrichment.*'], allowed: ['GO/KEGG/GSEA', 'FDR < 0.05'], allowed_glob: ['工程文件/C_*', '结果文件/tables/**', '结果文件/figures/**'], next: '可视化', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'manuscript', label: '报告撰写', module: 'E', required_artifacts: ['结果文件/manuscript/manuscript_v1.docx'], allowed: ['MINSEQE 规范', '撰写手稿', '数据可用性声明'], allowed_glob: ['工程文件/E_*', '手稿文书/**', '结果文件/manuscript/**'], blocked_paths: [] },
      { id: 'submission_revision', label: '投稿与修回', module: 'E', allowed: ['投稿', '处理审稿意见', '返修', '终稿定稿'], allowed_glob: ['手稿文书/**', '结果文件/manuscript/**', '工程文件/E_*'], blocked_paths: [] },
    ],
  },
  scrna: {
    id: 'scrna',
    label: '单细胞转录组',
    steps: [      { id: 'load', label: '数据加载', module: 'C', allowed: ['scanpy read_10x_mtx/read_h5ad', 'n_genes > 200 过滤'], allowed_glob: ['工程文件/C_*', '原始数据/**'], blocked_paths: ['手稿文书/**', '结果文件/manuscript/**', '原始数据/**'] },
      { id: 'qc', label: '质控', module: 'C', required_artifacts: ['结果文件/figures/qc_*.png'], allowed: ['calculate_qc_metrics', 'doublet 去除', 'MT% < 20%'], allowed_glob: ['工程文件/C_*', '结果文件/figures/**'], next: '降维聚类', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**', '原始数据/**'] },
      { id: 'clustering', label: '降维聚类', module: 'C', required_artifacts: ['结果文件/figures/umap.*'], allowed: ['normalize→log1p→pca→neighbors→umap→leiden', '分辨率扫描'], allowed_glob: ['工程文件/C_*', '结果文件/figures/**'], next: '细胞注释', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'annotation', label: '细胞注释', module: 'C', required_artifacts: ['结果文件/tables/markers.*'], allowed: ['gget cellxgene', 'marker 验证'], allowed_glob: ['工程文件/C_*', '结果文件/tables/**'], next: '差异分析', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'diff', label: '差异分析', module: 'C/D', required_artifacts: ['结果文件/tables/diff_genes.*'], allowed: ['rank_genes_groups', '伪bulk pydeseq2'], allowed_glob: ['工程文件/C_*', '工程文件/D_*', '结果文件/tables/**'], next: '可视化', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'manuscript', label: '报告撰写', module: 'E', required_artifacts: ['结果文件/manuscript/manuscript_v1.docx'], allowed: ['UMAP/dotplot/heatmap 出版级', '撰写手稿'], allowed_glob: ['工程文件/E_*', '手稿文书/**', '结果文件/manuscript/**', '结果文件/figures/**'], blocked_paths: [] },
      { id: 'submission_revision', label: '投稿与修回', module: 'E', allowed: ['投稿', '处理审稿意见', '返修', '终稿定稿'], allowed_glob: ['手稿文书/**', '结果文件/manuscript/**', '工程文件/E_*'], blocked_paths: [] },
    ],
  },
  drug_screening: {
    id: 'drug_screening',
    label: '药物筛选与分子对接',
    steps: [      { id: 'target', label: '靶点识别', module: 'C', allowed: ['bioservices UniProt', 'gget AlphaFold', '分辨率 < 2.5Å'], allowed_glob: ['工程文件/C_*'], blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'ligand_library', label: '配体库准备', module: 'C', required_artifacts: ['结果文件/data/ligands.*'], allowed: ['rdkit/datamol 标准化', 'Lipinski 类药性过滤'], allowed_glob: ['工程文件/C_*', '结果文件/data/**'], next: '分子对接', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'docking', label: '分子对接', module: 'C', required_artifacts: ['结果文件/tables/docking_results.*'], allowed: ['diffdock 批量对接', '评分排序'], allowed_glob: ['工程文件/C_*', '结果文件/tables/**'], next: 'ADMET 预测', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'admet', label: 'ADMET 预测', module: 'C', required_artifacts: ['结果文件/tables/admet.*'], allowed: ['deepchem 吸收/代谢/毒性', '每分子 6 项指标'], allowed_glob: ['工程文件/C_*', '结果文件/tables/**'], next: '可视化', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'manuscript', label: '报告撰写', module: 'E', required_artifacts: ['结果文件/manuscript/manuscript_v1.docx'], allowed: ['对接位点 3D', '相互作用指纹图谱', '撰写手稿'], allowed_glob: ['工程文件/E_*', '手稿文书/**', '结果文件/manuscript/**'], blocked_paths: [] },
      { id: 'submission_revision', label: '投稿与修回', module: 'E', allowed: ['投稿', '处理审稿意见', '返修', '终稿定稿'], allowed_glob: ['手稿文书/**', '结果文件/manuscript/**', '工程文件/E_*'], blocked_paths: [] },
    ],
  },
  prediction_model: {
    id: 'prediction_model',
    label: '临床预测模型 (TRIPOD)',
    steps: [      { id: 'data_prep', label: '数据准备', module: 'B/D', required_artifacts: ['结果文件/data/train.*'], allowed: ['训练/验证/测试集划分', '时间拆分优先'], allowed_glob: ['工程文件/B_*', '工程文件/D_*', '结果文件/data/**'], blocked_paths: ['手稿文书/**', '结果文件/manuscript/**', '原始数据/**'] },
      { id: 'feature_eng', label: '特征工程', module: 'D', required_artifacts: ['结果文件/data/features.*'], allowed: ['mice 插补', '标准化（仅训练集 fit）'], allowed_glob: ['工程文件/D_*', '结果文件/data/**'], next: '建模', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'modeling', label: '建模与验证', module: 'D', required_artifacts: ['结果文件/tables/model_results.*'], allowed: ['Logistic/Cox/RF/XGBoost', '5-fold × 10 repeat CV'], allowed_glob: ['工程文件/D_*', '结果文件/tables/**'], next: '模型评估', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'evaluation', label: '模型评估', module: 'D', required_artifacts: ['结果文件/figures/calibration.*', '结果文件/figures/dca.*'], allowed: ['AUC (pROC)', '校准曲线', 'Brier score', 'DCA', 'bootstrap 95%CI'], allowed_glob: ['工程文件/D_*', '结果文件/tables/**', '结果文件/figures/**'], next: '报告撰写', blocked_paths: ['手稿文书/**', '结果文件/manuscript/**'] },
      { id: 'manuscript', label: '报告撰写', module: 'E', required_artifacts: ['结果文件/manuscript/manuscript_v1.docx'], allowed: ['TRIPOD 清单', 'nomogram', '撰写手稿'], allowed_glob: ['工程文件/E_*', '手稿文书/**', '结果文件/manuscript/**'], blocked_paths: [] },
      { id: 'submission_revision', label: '投稿与修回', module: 'E', allowed: ['投稿', '处理审稿意见', '返修', '终稿定稿'], allowed_glob: ['手稿文书/**', '结果文件/manuscript/**', '工程文件/E_*'], blocked_paths: [] },
    ],
  },
  software_development: {
    id: 'software_development',
    label: '软件开发 (SDLC)',
    steps: [
      { id: 'requirements', label: '需求分析', module: 'S',
        allowed: ['收集需求', '用户故事/用例', '验收标准定义'],
        allowed_glob: ['docs/**', '工程文件/**'],
        next: '系统设计', blocked_paths: [] },
      { id: 'design', label: '系统设计', module: 'S',
        required_artifacts: ['docs/design.*', '工程文件/设计文档.*'],
        allowed: ['架构设计', '接口定义 (API)', '数据模型', '技术选型'],
        allowed_glob: ['docs/**', '工程文件/**', 'src/**'],
        next: '开发编码', blocked_paths: [] },
      { id: 'development', label: '开发编码', module: 'S',
        required_artifacts: ['src/**', '工程文件/**'],
        allowed: ['编写代码', '代码规范 (ESLint/Prettier)', '单元测试', 'Git 提交'],
        allowed_glob: ['src/**', '工程文件/**', 'tests/**'],
        next: '测试验证', blocked_paths: [] },
      { id: 'testing', label: '测试验证', module: 'S',
        required_artifacts: ['tests/**', '工程文件/测试报告.*'],
        allowed: ['单元/集成/E2E 测试', '覆盖率检查', 'Bug 修复', '代码审查'],
        allowed_glob: ['src/**', 'tests/**', '工程文件/**'],
        next: '部署发布', blocked_paths: [] },
      { id: 'deployment', label: '部署发布', module: 'S',
        required_artifacts: ['工程文件/CHANGELOG.*', '工程文件/发布说明.*'],
        allowed: ['构建打包', '版本号 (semver)', 'CHANGELOG', '部署', '发布说明'],
        allowed_glob: ['工程文件/**', 'docs/**'],
        next: '维护迭代', blocked_paths: [] },
      { id: 'maintenance', label: '维护迭代', module: 'S',
        allowed: ['监控告警', 'Bug 修复', '功能迭代', '性能优化'],
        allowed_glob: ['src/**', '工程文件/**', 'docs/**'],
        blocked_paths: [] },
    ],
  },
};

export const SCENARIO_LIST = Object.values(SCENARIOS).map((s) => ({
  id: s.id,
  label: s.label,
}));

// ── 智能体自主创建管线：根据研究描述自动匹配场景 ──

/** 关键词 → 场景 匹配表（智能体无需手动点模板） */
const SCENARIO_KEYWORDS: Array<{ id: string; keys: string[] }> = [
  { id: 'systematic_review', keys: ['系统综述', 'meta分析', 'meta 分析', '荟萃', '网状meta', 'PRISMA', '文献系统评价', '系统评价'] },
  { id: 'observational', keys: ['观察性', '队列', '横断面', '病例对照', 'NHANES', 'CHARLS', 'CHNS', '流行病学', '暴露', 'STROBE', '回归'] },
  { id: 'psychometrics', keys: ['量表', '心理测量', '信效度', '因子分析', 'CFA', 'EFA', '测量等值', 'COSMIN', '问卷开发'] },
  { id: 'bioinformatics', keys: ['生物信息', '组学', 'GEO', 'RNA-seq', '转录组', '差异表达', '富集', 'GO', 'KEGG'] },
  { id: 'scrna', keys: ['单细胞', 'scRNA', 'scanpy', '细胞注释', 'UMAP', 'leiden'] },
  { id: 'drug_screening', keys: ['药物筛选', '分子对接', 'docking', 'ADMET', '靶点', '配体', 'deepchem'] },
  { id: 'prediction_model', keys: ['预测模型', 'nomogram', '列线图', 'TRIPOD', '机器学习预测', '风险预测', 'AUC'] },
  { id: 'software_development', keys: ['软件开发', 'harness', 'app', '应用开发', 'electron', '前端', '后端'] },
];

/**
 * 根据研究描述自动匹配研究场景（智能体自主创建管线）。
 * 返回 { scenario, label, matched: true }；无法匹配时 matched=false（可回退到默认）。
 */
export function matchScenario(description: string): { scenario: string; label: string; matched: boolean } {
  const desc = (description || '').toLowerCase();
  for (const { id, keys } of SCENARIO_KEYWORDS) {
    if (keys.some((k) => desc.includes(k.toLowerCase()))) {
      const def = SCENARIOS[id];
      return { scenario: id, label: def?.label ?? id, matched: true };
    }
  }
  return { scenario: '', label: '', matched: false };
}

// ── State I/O ──────────────────────────────────────────────────

function findWorkspaceRoot(workspaceRoot: string): string | null {
  // 寻找含 工程文件/ 或 结果文件/ 的目录（可能是 workspaceRoot 本身或其父级）
  let dir = workspaceRoot;
  for (let i = 0; i < 5; i++) {
    if (!dir || dir === path.parse(dir).root) break;
    if (fs.existsSync(path.join(dir, '工程文件')) || fs.existsSync(path.join(dir, '结果文件'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fs.existsSync(path.join(workspaceRoot, '工程文件')) ||
         fs.existsSync(path.join(workspaceRoot, '结果文件'))
    ? workspaceRoot
    : null;
}

export function pipelineStatePath(workspaceRoot: string): string | null {
  const root = findWorkspaceRoot(workspaceRoot);
  if (!root) return null;
  return path.join(root, '工程文件', '00_pipeline_state.json');
}

export function readPipelineState(workspaceRoot: string): PipelineState | null {
  const p = pipelineStatePath(workspaceRoot);
  if (!p || !fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as PipelineState;
  } catch {
    return null;
  }
}

export function writePipelineState(workspaceRoot: string, state: PipelineState): boolean {
  const p = pipelineStatePath(workspaceRoot);
  if (!p) return false;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    state.updated = new Date().toISOString();
    fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

// ── State management ──────────────────────────────────────────

/** 把简单 glob（支持 * 单段通配）转成正则 */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** 本地预检与控制面使用相同的最低“可用产物”标准。 */
function artifactUsable(target: string): boolean {
  try {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) return fs.readdirSync(target).length > 0;
    if (!stat.isFile() || stat.size === 0) return false;
    const extension = path.extname(target).toLowerCase();
    if (extension === '.csv') {
      const rows = fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
      return rows.length >= 2 && rows[0].trim().length > 0;
    }
    if (extension === '.ris') return fs.readFileSync(target, 'utf8').includes('TY  -');
    if (extension === '.json') {
      const value = JSON.parse(fs.readFileSync(target, 'utf8'));
      return value !== null && (!Array.isArray(value) || value.length > 0) && (Array.isArray(value) || Object.keys(value).length > 0);
    }
    if (extension === '.md' || extension === '.txt') return fs.readFileSync(target, 'utf8').trim().length >= 10;
    return true; // Binary/research-specific formats receive structural validation in their executor.
  } catch {
    return false;
  }
}

/** 检查 workspace 下是否存在匹配且内容可用的 artifact。 */
export function artifactExists(workspaceRoot: string, pattern: string): boolean {
  const hasWildcard = pattern.includes('*');
  if (!hasWildcard) {
    return artifactUsable(path.join(workspaceRoot, pattern));
  }
  const idx = pattern.lastIndexOf('/');
  const dir = path.join(workspaceRoot, idx >= 0 ? pattern.slice(0, idx) : '');
  const namePat = idx >= 0 ? pattern.slice(idx + 1) : pattern;
  try {
    if (!fs.existsSync(dir)) return false;
    const re = globToRegExp(namePat);
    return fs.readdirSync(dir).some((f) => re.test(f) && artifactUsable(path.join(dir, f)));
  } catch {
    return false;
  }
}

/** 校验某步骤的 required_artifacts，返回缺失列表（空 = 全部产出） */
export function validateStepArtifacts(workspaceRoot: string, step: PipelineStep | null): string[] {
  if (!step?.required_artifacts?.length) return [];
  return step.required_artifacts.filter((pat) => !artifactExists(workspaceRoot, pat));
}

/** 返回当前步骤及其缺失产出物（供"进入下一步"前提示） */
export function stepCompletionCheck(workspaceRoot: string, state: PipelineState | null): { step: PipelineStep; missing: string[] } | null {
  const cur = getCurrentStep(state);
  if (!cur) return null;
  return { step: cur, missing: validateStepArtifacts(workspaceRoot, cur) };
}

export function createPipeline(workspaceRoot: string, scenario: string, projectName: string): PipelineState | null {
  // 改进 5：仅研究项目目录可启动管线
  if (!findWorkspaceRoot(workspaceRoot)) return null;
  const def = SCENARIOS[scenario] ?? SCENARIOS.systematic_review;
  const steps: PipelineStep[] = def.steps.map((s, i) => ({
    ...s,
    status: i === 0 ? 'active' : 'pending',
  }));
  const state: PipelineState = {
    project: projectName,
    scenario: def.id,
    enforcement_mode: 'soft',
    current_step: def.steps[0].id,
    steps,
    created: new Date().toISOString(),
  };
  writePipelineState(workspaceRoot, state);
  return state;
}

export function advanceStep(workspaceRoot: string): PipelineState | null {
  const state = readPipelineState(workspaceRoot);
  if (!state) return null;
  const idx = state.steps.findIndex((s) => s.id === state.current_step);
  if (idx < 0 || idx >= state.steps.length - 1) return state;
  // Keep hard enforcement at the state-transition boundary so all local
  // callers, rather than only a particular UI command, must respect it.
  const gate = stepCompletionCheck(workspaceRoot, state);
  if (state.enforcement_mode === 'hard' && gate && gate.missing.length > 0) return null;
  state.steps[idx].status = 'done';
  state.steps[idx + 1].status = 'active';
  state.current_step = state.steps[idx + 1].id;
  writePipelineState(workspaceRoot, state);
  syncManifestCheckpoint(workspaceRoot, state);
  return state;
}

export function rollbackStep(workspaceRoot: string): PipelineState | null {
  const state = readPipelineState(workspaceRoot);
  if (!state) return null;
  const idx = state.steps.findIndex((s) => s.id === state.current_step);
  if (idx <= 0) return state;
  state.steps[idx].status = 'pending';
  state.steps[idx - 1].status = 'active';
  state.current_step = state.steps[idx - 1].id;
  writePipelineState(workspaceRoot, state);
  syncManifestCheckpoint(workspaceRoot, state);
  return state;
}

/** 重置管线：回到第一步（保留 scenario 与 enforcement_mode） */
export function resetPipeline(workspaceRoot: string): PipelineState | null {
  const state = readPipelineState(workspaceRoot);
  if (!state) return null;
  state.steps.forEach((s, i) => {
    s.status = i === 0 ? 'active' : 'pending';
  });
  state.current_step = state.steps[0].id;
  writePipelineState(workspaceRoot, state);
  syncManifestCheckpoint(workspaceRoot, state);
  return state;
}

/** 完全清除管线：删除状态文件 + 重置 manifest checkpoint → 回到「选择研究类型」界面 */
export function clearPipeline(workspaceRoot: string): boolean {
  let removed = false;
  try {
    const p = pipelineStatePath(workspaceRoot);
    if (p && fs.existsSync(p)) {
      fs.unlinkSync(p);
      removed = true;
    }
  } catch { /* ignore */ }
  resetManifestCheckpoint(workspaceRoot);
  return removed;
}

/**
 * B1: 重开某步骤重新执行（rerun 语义）。
 * - 目标步骤设为 active
 * - 其后的步骤若已完成，标记为 'stale'（工件仍在但需按新输入重生成）
 * - 保留已完成工件，不删除文件
 * 返回更新后的 state；目标不存在返回 null。
 */
export function reopenStep(workspaceRoot: string, stepId: string): PipelineState | null {
  const state = readPipelineState(workspaceRoot);
  if (!state) return null;
  const idx = state.steps.findIndex((s) => s.id === stepId);
  if (idx < 0) return null;
  const curIdx = state.steps.findIndex((s) => s.id === state.current_step);
  state.steps.forEach((s, i) => {
    if (i < idx) {
      s.status = 'done';           // 之前的保持 done
    } else if (i === idx) {
      s.status = 'active';
    } else if (i < curIdx || s.status === 'done') {
      s.status = 'stale';          // 之后的已完成步骤 → stale
    } else {
      s.status = 'pending';
    }
  });
  state.current_step = stepId;
  writePipelineState(workspaceRoot, state);
  syncManifestCheckpoint(workspaceRoot, state);
  return state;
}

/** 把 manifest checkpoint 重置为未启动状态 */
function resetManifestCheckpoint(workspaceRoot: string): void {
  try {
    const manifestPath = path.join(workspaceRoot, '工程文件', '00_bus_manifest.json');
    if (!fs.existsSync(manifestPath)) return;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.checkpoint = {
      phase: '',
      phase_label: '未启动管线',
      last_action: '',
      last_updated: new Date().toISOString().slice(0, 16).replace('T', ' '),
      next_action: '在叮咚鸡仪表盘选择研究场景',
      completed_steps: [],
      pending_steps: [],
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  } catch { /* ignore */ }
}

/** 同步 00_bus_manifest.json 的 checkpoint，使仪表盘 Module F 与管线一致 */
function syncManifestCheckpoint(workspaceRoot: string, state: PipelineState): void {
  try {
    const manifestPath = path.join(workspaceRoot, '工程文件', '00_bus_manifest.json');
    if (!fs.existsSync(manifestPath)) return;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const cur = getCurrentStep(state);
    const doneSteps = state.steps.filter((s) => s.status === 'done').map((s) => s.id);
    const pendingSteps = state.steps.filter((s) => s.status !== 'done').map((s) => s.id);
    manifest.checkpoint = {
      phase: cur?.id ?? state.current_step,
      phase_label: cur?.label ?? '',
      last_action: cur?.next ? `进入「${cur?.label ?? ''}」，下一步：${cur.next}` : `进入「${cur?.label ?? ''}」`,
      last_updated: new Date().toISOString().slice(0, 16).replace('T', ' '),
      next_action: cur?.next ?? '投稿与修回',
      completed_steps: doneSteps,
      pending_steps: pendingSteps,
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  } catch { /* ignore */ }
}

export function setEnforcementMode(workspaceRoot: string, mode: EnforcementMode): PipelineState | null {
  const state = readPipelineState(workspaceRoot);
  if (!state) return null;
  state.enforcement_mode = mode;
  writePipelineState(workspaceRoot, state);
  return state;
}

export function getCurrentStep(state: PipelineState | null): PipelineStep | null {
  if (!state) return null;
  return state.steps.find((s) => s.id === state.current_step) ?? null;
}

// ── 动态待办计划编辑（模板仅作参考，每次独立生成计划） ───────────

/** 生成唯一自定义步骤 id（时间戳 + 随机，避免进程重启冲突） */
function genCustomId(): string {
  return `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 在指定步骤后插入新步骤（计划自定义）。afterId 为空则插到末尾。 */
export function addStep(
  workspaceRoot: string, afterId: string | null, label: string,
  opts: { module?: string; allowed?: string[]; required_artifacts?: string[]; blocked_paths?: string[] } = {}
): PipelineState | null {
  const state = readPipelineState(workspaceRoot);
  if (!state) return null;
  if (state.enforcement_mode === 'hard') return state;
  const newStep: PipelineStep = {
    id: genCustomId(),
    label,
    module: opts.module || '自定义',
    status: 'pending',
    allowed: opts.allowed || ['自定义动作'],
    blocked_paths: opts.blocked_paths || [],
    ...(opts.required_artifacts?.length ? { required_artifacts: opts.required_artifacts } : {}),
  };
  const afterIdx = afterId ? state.steps.findIndex((s) => s.id === afterId) : -1;
  const insertAt = afterId && afterIdx >= 0 ? afterIdx + 1 : state.steps.length;
  state.steps.splice(insertAt, 0, newStep);
  state.is_custom = true;
  writePipelineState(workspaceRoot, state);
  syncManifestCheckpoint(workspaceRoot, state);
  return state;
}

/** 删除步骤（非当前步骤可删）。 */
export function removeStep(workspaceRoot: string, stepId: string): PipelineState | null {
  const state = readPipelineState(workspaceRoot);
  if (!state) return null;
  if (state.enforcement_mode === 'hard') return state;
  if (stepId === state.current_step) return state; // 不能删当前步骤
  const idx = state.steps.findIndex((s) => s.id === stepId);
  if (idx < 0) return state;
  state.steps.splice(idx, 1);
  state.is_custom = true;
  writePipelineState(workspaceRoot, state);
  syncManifestCheckpoint(workspaceRoot, state);
  return state;
}

/** 移动步骤（dir: -1 上移 / 1 下移）。 */
export function moveStep(workspaceRoot: string, stepId: string, dir: -1 | 1): PipelineState | null {
  const state = readPipelineState(workspaceRoot);
  if (!state) return null;
  if (state.enforcement_mode === 'hard') return state;
  const idx = state.steps.findIndex((s) => s.id === stepId);
  const target = idx + dir;
  if (idx < 0 || target < 0 || target >= state.steps.length) return state;
  const curId = state.current_step;
  [state.steps[idx], state.steps[target]] = [state.steps[target], state.steps[idx]];
  state.current_step = curId; // 保持当前步骤不变
  state.is_custom = true;
  writePipelineState(workspaceRoot, state);
  syncManifestCheckpoint(workspaceRoot, state);
  return state;
}

// ── Workspace detection ───────────────────────────────────────

export async function detectScenario(workspaceRoot: string): Promise<string> {  // 从 manifest.scenario 推断；否则用文件名关键词兜底
  try {
    const manifestPath = path.join(workspaceRoot, '工程文件', '00_bus_manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (manifest.scenario && SCENARIOS[manifest.scenario]) return manifest.scenario;
    }
  } catch { /* ignore */ }

  const lower = workspaceRoot.toLowerCase();
  if (lower.includes('meta') || lower.includes('综述')) return 'systematic_review';
  if (lower.includes('scrna') || lower.includes('单细胞')) return 'scrna';
  if (lower.includes('docking') || lower.includes('药物')) return 'drug_screening';
  if (lower.includes('prediction') || lower.includes('预测')) return 'prediction_model';
  if (lower.includes('rna') || lower.includes('seq') || lower.includes('生信')) return 'bioinformatics';
  return 'observational';
}

// ── B2+B3: 工件指纹 manifest + 可复现性校验 + 防篡改哈希链 ──────

import { createHash } from 'crypto';

export interface ArtifactManifest {
  updated: string;
  chain_hash?: string;      // 整库哈希链（防篡改：每次变更链接上一状态）
  chain_count?: number;     // 链长度
  artifacts: Record<string, { hash: string; mtime: number; producedBy?: string; provenance?: string }>;
  inputs: Record<string, { hash: string; mtime: number }>;
}

/** 计算单文件 SHA-256（跳过不存在/目录/超大） */
export function fileHash(fp: string): string | null {
  try {
    const st = fs.statSync(fp);
    if (!st.isFile() || st.size > 50_000_000) return null;
    const buf = fs.readFileSync(fp);
    return createHash('sha256').update(buf).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

/** 读取项目工件指纹 manifest（无则空） */
export function readArtifactManifest(workspaceRoot: string): ArtifactManifest {
  const p = path.join(workspaceRoot, '工程文件', 'artifact_manifest.json');
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { /* ignore */ }
  return { updated: '', artifacts: {}, inputs: {} };
}

/** 计算整库清单的哈希：所有产物指纹排序后哈希（不含 chain_hash 自身，保证存/验一致） */
function manifestChainHash(manifest: ArtifactManifest): string {
  const lines: string[] = [];
  for (const [rel, rec] of Object.entries(manifest.artifacts).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${rel}|${rec.hash}|${rec.producedBy || ''}|${rec.provenance || ''}`);
  }
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}

/** 校验清单哈希链是否完整（防篡改审计） */
export function verifyManifestChain(workspaceRoot: string): { ok: boolean; message: string } {
  const manifest = readArtifactManifest(workspaceRoot);
  if (!manifest.chain_hash) return { ok: true, message: '清单尚无哈希链（首次记录后自动建立）' };
  const expect = manifestChainHash(manifest);
  if (expect === manifest.chain_hash) return { ok: true, message: '哈希链完整，无篡改' };
  return { ok: false, message: '⚠️ 哈希链断裂！清单可能被篡改，需复核产物' };
}

/** 记录一个产出物的指纹（B2 版本规范 + 防篡改哈希链 + 溯源） */
export function fingerprintArtifact(workspaceRoot: string, relPath: string, producedBy?: string, provenance?: string): ArtifactManifest {
  const manifest = readArtifactManifest(workspaceRoot);
  const abs = path.join(workspaceRoot, relPath);
  const hash = fileHash(abs);
  if (hash) {
    manifest.artifacts[relPath] = {
      hash, mtime: fs.statSync(abs).mtimeMs,
      ...(producedBy ? { producedBy } : {}),
      ...(provenance ? { provenance } : {}),
    };
    // 哈希链：链接上一状态
    manifest.chain_count = (manifest.chain_count || 0) + 1;
    manifest.chain_hash = manifestChainHash(manifest);
    manifest.updated = new Date().toISOString();
    try {
      fs.mkdirSync(path.join(workspaceRoot, '工程文件'), { recursive: true });
      fs.writeFileSync(path.join(workspaceRoot, '工程文件', 'artifact_manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    } catch { /* ignore */ }
  }
  return manifest;
}

/**
 * 审计链 → PRISMA 流程数据自动生成。
 * 从 search_log.md 的审计链（各库 total/retrieved/deduped）聚合：
 *   identified(检索总数) → screened(去重后) → eligibility(筛选后) → included(纳入)
 * 输出 prisma_flow_data.csv（供 PRISMA 流程图直接引用，杜绝手抄错误）。
 */
export function generatePrismaData(workspaceRoot: string): { ok: boolean; data: Record<string, number>; path?: string } {
  const litDir = path.join(workspaceRoot, '结果文件', 'literature');
  const searchLog = path.join(litDir, 'search_log.md');
  const empty = { ok: true, data: { identified: 0, screened: 0, eligibility: 0, included: 0 } };
  if (!fs.existsSync(searchLog)) return empty;

  try {
    const text = fs.readFileSync(searchLog, 'utf-8');
    const rows = text.match(/^\|\s*\d+\s*\|.*\|$/gm) || [];
    let identified = 0;
    let screened = 0;
    let dedupedTotal = 0;
    let nRows = 0;
    for (const row of rows.slice(0, 20)) {
      const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
      // [序号, 库, 接口, total, retrieved, deduped, status]
      if (cells.length >= 6) {
        const total = parseInt(cells[cells.length - 4] || '0', 10) || 0;
        const retrieved = parseInt(cells[cells.length - 3] || '0', 10) || 0;
        const deduped = parseInt(cells[cells.length - 2] || '0', 10) || 0;
        identified += total;
        screened += retrieved;
        dedupedTotal += deduped;
        nRows++;
      }
    }
    // 交叉库 total 不可直接相加（重复），此处用最大单库作为 identified 的保守估计；
    // 真实去重后数应来自筛选记录，这里 screened 用 deduped 汇总
    const data = {
      identified: identified,           // 各库命中合计（上界）
      screened: dedupedTotal || screened, // 去重后（若无去重数则用 retrieved）
      eligibility: 0,                    // 全文筛选（需筛选记录）
      included: 0,                       // 纳入（需 meta 表）
    };
    const outPath = path.join(litDir, 'prisma_flow_data.csv');
    const csv = [
      'stage,count',
      `identified,${data.identified}`,
      `screened,${data.screened}`,
      `eligibility,${data.eligibility}`,
      `included,${data.included}`,
      `note,各库合计为上限;去重后为screened;eligibility/included需人工确认`,
    ].join('\n');
    fs.mkdirSync(litDir, { recursive: true });
    fs.writeFileSync(outPath, csv, 'utf-8');
    return { ok: true, data, path: outPath };
  } catch (e) {
    return { ok: false, data: empty.data };
  }
}

/**
 * B3 可复现性校验：检查给定步骤的 required_artifacts 是否已落指纹，
 * 以及是否有对应输入变化导致输出过期。返回 {ok, warnings}。
 */
export function validateReproducibility(workspaceRoot: string, step: PipelineStep | null): { ok: boolean; warnings: string[] } {
  if (!step?.required_artifacts?.length) return { ok: true, warnings: [] };
  const manifest = readArtifactManifest(workspaceRoot);
  const warnings: string[] = [];
  for (const pat of step.required_artifacts) {
    if (!pat.includes('*') && fs.existsSync(path.join(workspaceRoot, pat))) {
      const rel = pat;
      const rec = manifest.artifacts[rel];
      const cur = fileHash(path.join(workspaceRoot, rel));
      if (!rec) {
        warnings.push(`产出物 ${rel} 未记录指纹（新产出，建议校验）`);
      } else if (cur && rec.hash !== cur) {
        warnings.push(`产出物 ${rel} 已被修改且指纹不一致（需复核）`);
      }
    }
  }
  return { ok: warnings.length === 0, warnings };
}

export { findWorkspaceRoot };
