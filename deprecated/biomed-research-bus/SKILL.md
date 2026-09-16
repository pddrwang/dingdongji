---
name: biomed-research-bus
description: 叮咚鸡V1.0 — 生物医学研究整合助手。整合文献检索、公共数据库、统计分析和科学写作模块。激活时启动原生macOS仪表盘App。当用户说"叮咚鸡"/"ddj"/"总线"/"bus"/"dashboard"/"研究仪表盘"/"启动研究环境"时激活。
allowed-tools: Read Write Edit Bash Skill WebSearch WebFetch
metadata: {"version": "3.1", "skill-author": "user"}
---

# 叮咚鸡 V1.0

生物医学研究整合助手。原生 macOS App（`/Applications/BiomedBus.app`）是其专属仪表盘。本 Skill 是叮咚鸡的研究引擎，仪表盘是健康监控面板，二者协同——Skill 驱动分析，App 展示状态。

## Activation

叮咚鸡 V2.0 已迁移为 **VSCode 扩展**（`dingdongji`，侧边栏「叮咚鸡」面板）。原生 App 已停用。标准路径：**VSCode 打开研究项目 → 叮咚鸡扩展自动激活 → 侧边栏仪表盘 + Claude Code 面板协作**。

1. **确认扩展已激活**：VSCode 侧边栏应有「🐔 叮咚鸡」图标。若无，命令面板执行 `叮咚鸡：打开仪表盘`。
2. **确认仪表盘后端**（扩展会自动启动，无需手动）：
   ```bash
   curl -s --max-time 2 http://127.0.0.1:19999/api/status > /dev/null 2>&1 \
     && echo "叮咚鸡后端运行中" \
     || echo "后端未运行 — 请检查扩展是否激活"
   ```
3. **会话令牌**（扩展 bootstrap 自动写入 `/tmp/ddj_session.json`，含工作区路径；管线强制 hook 依赖它）：
   ```bash
   cat /tmp/ddj_session.json 2>/dev/null || echo "令牌未写入"
   ```
4. **管线约束**：扩展已安装 UserPromptSubmit + PreToolUse hooks、5 个分模块 agents、CLAUDE.md 常驻上下文。在「管线」tab 选择研究场景即激活强制。
5. **知识库**：扩展启动时自动扫描工作区并丰富 `~/.claude/dingdongji/kb/`。
6. 若任一模块健康度 < 70%，先修复再推进。

---

## Research Scenario Router

根据用户意图自动匹配端到端管线。每个场景标注所需模块、关键检查点、和目标输出格式。

### 场景 1：系统综述与 Meta 分析 (PRISMA 2020)
| 阶段 | Module | 操作 | 检查点 |
|------|--------|------|--------|
| 1. 方案注册 | A+E | PROSPERO 注册 / INPLASY | 获取注册号 |
| 2. 检索 | A | PubMed + Scopus + WoS + CNKI + 灰色文献 | Rule 2 Checkpoint 1-3 |
| 3. 筛选 | A | Rayyan/Endnote 去重 → 标题摘要筛选 → 全文筛选 | PRISMA 流程图 |
| 4. 质量评价 | D+E | ROB-2 (RCT) / ROBINS-I (NRS) / QUADAS-2 (诊断) | 偏倚风险表 |
| 5. 数据提取 | B+D | 标准化提取表 → 效应量转换 | 双人独立提取 |
| 6. Meta 分析 | D | `metafor`/`netmeta` — 异质性 → 模型选择 → 森林图/漏斗图 | I² > 50% 用随机效应 |
| 7. 报告 | E | PRISMA 2020 checklist → manuscript | Checkpoint 4-5 |

### 场景 2：观察性研究 (STROBE)
| 阶段 | Module | 操作 | 检查点 |
|------|--------|------|--------|
| 1. 数据获取 | B | NHANES/CHNS/KNHANES/CHARLS → 下载原始数据 | 记录版本号和下载日期 |
| 2. 数据清洗 | D | 缺失值 (`mice`)、异常值、调查权重 (`survey`) | 缺失 > 20% 标记 |
| 3. 描述统计 | D | Table 1 → 按暴露/结局分组 | SMD < 0.1 |
| 4. 推断分析 | D | 回归模型 (`lme4`/`survival`) + 混杂调整 (`MatchIt`) | E-value 敏感性 |
| 5. 可视化 | E | 森林图 / 剂量反应 / 亚组分析 | publication-quality |
| 6. 报告 | E | STROBE checklist → manuscript | Checkpoint 4-5 |

### 场景 3：生物信息学分析
| 阶段 | Module | 操作 | 检查点 |
|------|--------|------|--------|
| 1. 数据获取 | C | GEO/SRA/TCGA → `gget` 查询 | SRA Run Selector |
| 2. 预处理 | C | `bulk-rnaseq`: FASTQ → QC → STAR/Salmon → counts | FastQC > 28 |
| 3. 差异分析 | C+D | `pydeseq2` / `limma` → volcano plot | padj < 0.05 |
| 4. 功能富集 | C | `pathway-enrichment` → GO/KEGG/GSEA | FDR < 0.05 |
| 5. 可视化 | E | 火山图/热图/网络图 → `scientific-visualization` | publication-quality |

### 场景 4：单细胞转录组
| 阶段 | Module | 操作 | 检查点 |
|------|--------|------|--------|
| 1. 数据加载 | C | `scanpy`: read_10x_mtx / read_h5ad | n_genes > 200 |
| 2. 质控 | C | filter → pp.calculate_qc_metrics → doublet removal | MT% < 20% |
| 3. 降维聚类 | C | pp.normalize → pp.log1p → tl.pca → pp.neighbors → tl.umap → tl.leiden | resolution 扫描 |
| 4. 注释 | C | `gget` cellxgene / marker-based | 已知 marker 验证 |
| 5. 差异分析 | C+D | tl.rank_genes_groups → 伪bulk `pydeseq2` | pseudobulk > 单细胞 DE |
| 6. 可视化 | E | UMAP/dotplot/heatmap → `scientific-visualization` | publication-quality |

### 场景 5：药物筛选与分子对接
| 阶段 | Module | 操作 | 检查点 |
|------|--------|------|--------|
| 1. 靶点识别 | C | `bioservices` UniProt + `gget` AlphaFold | 分辨率 < 2.5Å |
| 2. 配体库准备 | C | `rdkit`/`datamol` → 化合物标准化 + 类药性过滤 | Lipinski Rule of 5 |
| 3. 分子对接 | C | `diffdock` → 批量对接 + 评分排序 | 评分 cutoff |
| 4. ADMET 预测 | C | `deepchem` → 吸收/代谢/毒性 | 每个分子 6 项指标 |
| 5. 可视化 | E | 对接位点 3D / 相互作用指纹图谱 | publication-quality |

### 场景 6：临床预测模型 (TRIPOD)
| 阶段 | Module | 操作 | 检查点 |
|------|--------|------|--------|
| 1. 数据准备 | B+D | 拆分训练/验证/测试集 | 时间拆分优先于随机 |
| 2. 特征工程 | D | 缺失插补 (`mice`) + 标准化 | 仅在训练集上 fit |
| 3. 建模 | D | Logistic/Cox/随机森林/XGBoost → 交叉验证 | 5-fold × 10 repeat |
| 4. 评估 | D | AUC (`pROC`) + 校准曲线 + Brier score + DCA | 95% CI bootstrap |
| 5. 报告 | E | TRIPOD checklist → nomogram → manuscript | Checkpoint 4-5 |

---

## Rule 1 — File Management Discipline

**MANDATORY for every research project. Execute before any code is written.**

### 1.1 Auto-Create Directory Structure

At the start of every project, create these four subdirectories under the project root:

```
项目根目录/
├── 工程文件/           ← Code + intermediate data (commit to git)
├── 结果文件/           ← Results, figures, tables (do NOT commit raw data)
│   ├── tables/
│   ├── figures/
│   └── manuscript/
├── 手稿文书/           ← Manuscript drafts, cover letters, revisions  
└── 原始数据/           ← Raw downloaded data, untouched originals
```

Creation command:
```bash
mkdir -p 项目根目录/{工程文件,结果文件/{tables,figures,manuscript},手稿文书,原始数据}
```

### 1.2 Content Rules

| 目录 | 存放内容 | 禁止存放 |
|------|---------|----------|
| **工程文件/** | Python/R 脚本、00_bus_manifest.json、中间处理数据 | 原始下载数据、手稿 DOCX |
| **结果文件/tables/** | 输出表格 CSV | 代码 |
| **结果文件/figures/** | 输出图表 PNG/PDF | 代码 |
| **结果文件/manuscript/** | 最终生成的报告 DOCX/PDF | 草稿 |
| **手稿文书/** | 投稿手稿、Cover letter、修回版本 | 代码、原始数据 |
| **原始数据/** | NHANES .XPT、CHARLS .dta 等原始文件 | 修改过的数据 |

### 1.3 Naming Convention (Extended)

```
工程文件/A1_search_pubmed.py          ← Module A: Literature
工程文件/A2_search_scopus.py
工程文件/A3_prisma_flowchart.py       ← PRISMA flow diagram
工程文件/B1_extract_nhanes.R          ← Module B: Health data
工程文件/B2_extract_ipums.R
工程文件/C1_diff_expression.R         ← Module C: Bioinformatics  
工程文件/C2_enrichment.R
工程文件/C3_scrnaseq_analysis.py      ← Single-cell
工程文件/C4_molecular_docking.py      ← Drug screening
工程文件/D1_descriptive.R             ← Module D: Statistics
工程文件/D2_meta_analysis.R
工程文件/D3_prediction_model.R        ← Clinical prediction
工程文件/D4_survival_analysis.R
工程文件/E1_generate_manuscript.py    ← Module E: Writing
工程文件/E2_figures.R
工程文件/E3_table1.R
工程文件/E4_strobe_checklist.R        ← Reporting checklist
结果文件/tables/table1_baseline.csv
结果文件/tables/table2_regression.csv
结果文件/figures/fig1_forest.png
结果文件/figures/fig2_volcano.pdf
结果文件/figures/fig3_umap.png        ← Single-cell
结果文件/manuscript/manuscript_v1.docx
手稿文书/cover_letter_v1.docx
手稿文书/prisma_checklist.pdf
```

### 1.4 .gitignore Template

```gitignore
原始数据/
*.XPT *.xpt *.sas7bdat *.dta *.sav
结果文件/data/
.Rhistory .RData .Ruserdata
.DS_Store
*.Rproj .Rproj.user/
```

### 1.5 Bus Manifest (with Checkpoint)

Create `工程文件/00_bus_manifest.json` at project start:

```json
{
  "project": "项目名称",
  "created": "YYYY-MM-DD",
  "bus_version": "3.1",
  "research_question": "PICO-formatted question",
  "scenario": "systematic_review | observational | bioinformatics | scRNA | drug_screening | prediction_model",
  "modules_activated": ["A","B","D","E"],
  "directories": {"工程文件": true, "结果文件": true, "手稿文书": true, "原始数据": true},
  "checkpoint": {
    "phase": "literature_search",
    "phase_label": "文献检索",
    "last_action": "PubMed 检索完成，命中 342 篇",
    "last_updated": "YYYY-MM-DD HH:MM",
    "next_action": "去重并开始标题摘要筛选",
    "completed_steps": ["project_init", "pubmed_search"],
    "pending_steps": ["dedup", "screening", "data_extraction", "meta_analysis", "manuscript"]
  }
}
```

---

## Rule 2 — Manuscript Writing & Reference Discipline

**MANDATORY for any writing task that involves references. Five checkpoints, no exceptions.**

### Checkpoint 1 — Ask About Chinese Literature First

Before ANY literature search for manuscript writing, ask the user:

> "是否需要包含中文文献？（如果是，将同步检索 CNKI + PubMed/Scopus/WoS）"

Record the answer in the audit log. Only skip this step if the user has explicitly pre-authorized a language scope.

### Checkpoint 2 — Search Real Literature via MCP

For each reference needed:

1. **English references**: search PubMed (ai4scholar), Scopus, WoS, Semantic Scholar
2. **Chinese references** (if user confirmed): search CNKI MCP
3. **Grey literature / preprints**: arXiv, bioRxiv, medRxiv, Google Scholar if needed

Query each database with proper field-coded syntax. Never fabricate references. Never guess DOIs. If a reference cannot be found across two independent databases, flag it and ask the user.

### Checkpoint 3 — Audit Before Writing

**Before inserting any reference into the manuscript**, run the audit:

1. Cross-verify each paper across at least 2 databases
2. Confirm DOI resolves to the claimed paper
3. Confirm author names, journal name, year, volume/pages match across sources
4. For CNKI papers: use `find_best_match` to verify title authenticity
5. Produce audit report: ✅ confirmed / ⚠️ uncertain / ❌ rejected

Rejected papers must be removed. Uncertain papers may be included with a `[验证中]` tag but must be resolved before final submission.

### Checkpoint 4 — Cross-Reference in Manuscript

When writing:

1. Every factual claim needing a source must be cited
2. Use the `auto_cite` tool from ai4scholar for initial markup
3. Verify every auto-generated citation against the audit report
4. In-text citation format: follow target journal style (Vancouver for biomedical, APA for psychology, GB/T 7714 for Chinese journals)
5. If `format_citation` from CNKI MCP is available, format Chinese references via it

### Checkpoint 5 — RIS Library in Output

After manuscript completion, **create `结果文件/manuscript/literature_library.ris`** containing every cited reference with full metadata:

| RIS Field | Source |
|-----------|--------|
| TY | JOUR / CONF / THES |
| T1 | Full title |
| AU | Last, First (one per line) |
| PY | Publication year |
| JF | Journal full name |
| DO | DOI |
| AN | PMID or CNKI ID |
| N2 | Abstract |
| DB | Source database name |
| KW | Keywords (one per line) |

Records separated by `ER  - ` followed by a blank line. File encoding: UTF-8.

---

## Module Registry

### Module A — Literature Search & Synthesis

| Asset | Type | Tools |
|-------|------|-------|
| `ai4scholar` MCP | 28 tools | PubMed, Semantic Scholar, Google Scholar, arXiv, bioRxiv/medRxiv |
| `elsevier-scopus` MCP | 3 tools | Scopus + Embase search, abstract retrieval, PMID cross-check |
| `wos-clarivate` MCP | 4 tools | Web of Science search, record lookup, indexing check |
| `cnki` MCP | 6 tools | 中国知网: search, detail, citation, export, journals |
| `english-literature-db` MCP | 8 tools | Unified multi-DB search |
| `literature-search` skill | 5-phase pipeline | Self-check → search → audit → output → RIS |
| `citation-management` skill | — | Scholar + PubMed metadata, BibTeX |

**降级策略**: 若 Scopus 不可用 → 使用 Semantic Scholar 替代；若 WoS 不可用 → 使用 PubMed + 人工标注被引；若 CNKI 不可用 → 标记中文文献为[待检索]，先处理英文部分。

### Module B — Public Health Data

| Asset | Type | Status |
|-------|------|--------|
| NHANES `nhanesA` | R package | ✅ API |
| IPUMS NHIS `ipumsr` | R package | ⚠️ 状态可变 |
| Add Health | Public DL | ✅ Dataverse |
| CHNS | Public DL | ✅ CPC |
| HBSC | Public DL | ✅ Bergen |
| NSCH | Public DL | ✅ Census FTP |
| KNHANES | Registration | ✅ Login |
| GSHS / WHO GHO | HTTP | ✅ Direct |
| 8 aging DBs (HRS/CHARLS/…) | Registration | ⏳ |
| `global-health-dbs` skill | | DB registry |

**降级策略**: 若 IPUMS 不可用 → 用 NHIS 公开 CSV 文件替代；若某老龄化 DB 未注册 → 提示用户注册 URL 或搜索替代 DB（如用 HRS 替代 CHARLS 做敏感性分析）。

### Module C — Bioinformatics & Genomics

`biopython` · `bioservices` · `scanpy`/`scvi-tools` · `bulk-rnaseq` · `pathway-enrichment` · `deepchem`/`rdkit`/`datamol` · `gget` · `diffdock`

### Module D — Statistical Engine

R: `survey` · `metafor` · `meta` · `netmeta` · `lme4` · `survival` · `mice` · `MatchIt` · `pROC` · `EValue` · `forestplot` · `ggplot2` + tidyverse

Python: `pandas` · `numpy` · `scipy` · `statsmodels` · `scikit-learn` · `lifelines` · `pymc` · `plotly`

#### 统计方法速查表

| 分析目标 | 场景 | R 函数 | Python 函数 |
|---------|------|--------|------------|
| 两组均值比较 | 连续变量 | `t.test()` | `scipy.stats.ttest_ind()` |
| 多组均值比较 | ≥3 组 | `aov()` + `TukeyHSD()` | `statsmodels.stats.anova.anova_lm()` |
| 卡方检验 | 分类变量关联 | `chisq.test()` | `scipy.stats.chi2_contingency()` |
| 非参数检验 | 偏态数据 | `wilcox.test()` / `kruskal.test()` | `scipy.stats.mannwhitneyu()` |
| logistic 回归 | 二分类结局 | `glm(..., family=binomial)` | `statsmodels.formula.api.logit()` |
| Cox 回归 | 生存分析 | `coxph()` | `lifelines.CoxPHFitter()` |
| 线性混合模型 | 重复测量 | `lmer()` | `statsmodels.MixedLM()` |
| 倾向性评分 | 观察性研究 | `matchit()` + `glm()` | `sklearn.linear_model.LogisticRegression()` |
| 多重插补 | 缺失数据 | `mice()` | `sklearn.impute.IterativeImputer()` |
| Meta 分析 | 合并效应量 | `rma()` | `pymc` (Bayesian meta) |
| 网状 Meta | 多臂比较 | `netmeta()` | — |
| 复杂调查分析 | NHANES 等 | `svydesign()` + `svyglm()` | — |
| ROC 曲线 | 诊断/预测 | `roc()` | `sklearn.metrics.roc_auc_score()` |
| E-value | 敏感性分析 | `evalues.OR()` | — |

### Module E — Writing & Output

`scientific-writing` · `scientific-visualization` · `scientific-schematics` · `scientific-slides` · `docx` · `pdf` · `pptx` · `citation-management` · `peer-review`

### Module G — 研究报告规范与清单

| 研究类型 | 报告规范 | 检查清单 | 工具 |
|---------|---------|---------|------|
| 随机对照试验 | CONSORT 2010 | 25 项 | `E4_consort_checklist.R` |
| 观察性研究 | STROBE | 22 项 | `E4_strobe_checklist.R` |
| 系统综述与 Meta 分析 | PRISMA 2020 | 27 项 | `E4_prisma_checklist.R` |
| 诊断准确性研究 | STARD 2015 | 30 项 | `E4_stard_checklist.R` |
| 预测模型研究 | TRIPOD | 22 项 | `E4_tripod_checklist.R` |
| 肿瘤标志物预后研究 | REMARK | 20 项 | checklist manual |
| 定性研究 | COREQ / SRQR | 32/21 项 | checklist manual |
| 病例报告 | CARE | 13 项 | `E4_care_checklist.R` |

---

## Execution Rules

1. **场景路由优先**: 根据用户意图匹配 Research Scenario Router → 加载对应管线。
2. **断点续做检测**: 激活时检查当前目录及 Desktop 下有无含 `checkpoint` 的 manifest，提示继续未完成项目。
3. **File management first**: before any code is written, create the 4-directory structure (Rule 1).
4. **References are real**: Checkpoint 1→5 pipeline is non-negotiable for any writing task (Rule 2).
5. **Ask about Chinese lit**: checkpoint 1 fires before every literature search for manuscript writing.
6. **Audit before output**: no reference enters a manuscript without cross-verification (checkpoint 3).
7. **RIS library mandatory**: every completed manuscript must have `literature_library.ris` (checkpoint 5).
8. **降级不降质**: 任何外部服务不可用时，执行降级策略并明确告知用户哪些部分受到影响。
9. **App is dashboard**: `/Applications/BiomedBus.app` is authoritative for module health.
10. **Key store**: all credentials from `~/.claude/api_keys.json` via `source ~/.claude/load_keys.sh`.
11. **Check before action**: `curl /api/status` to verify module health before routing.
