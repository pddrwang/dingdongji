# V2.4 发布门禁

当前状态：**已发布** `DingdongChilk.dingdongji v2.4.0`（2026-09-16）。用户明确批准后执行 `vsce publish`，Marketplace API 与 gallery CDN 均已确认资源在线。

## 本轮已执行的检查

在扩展源码目录：

```sh
npm run verify                                   # tsc + webview 语法
./node_modules/.bin/vsce ls --no-dependencies    # 候选清单（40 项）
./node_modules/.bin/vsce package --no-dependencies --out dist/dingdongji-2.4.0.vsix
```

隔离安装验证（不影响本机正式 VS Code 配置）：

```sh
CODE="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
"$CODE" --install-extension dist/dingdongji-2.4.0.vsix \
  --extensions-dir /tmp/ddj_clean_ext --user-data-dir /tmp/ddj_clean_data --force
"$CODE" --list-extensions --show-versions \
  --extensions-dir /tmp/ddj_clean_ext --user-data-dir /tmp/ddj_clean_data
```

结果：VSIX 42 个条目、约 707 KB；隔离安装成功，列表显示 `dingdongchilk.dingdongji@2.4.0`；包内无 `docs/`、`Publishing.md`、`*.ts`、`tsconfig`、`.map`、`__pycache__`、`node_modules`。这验证的是“可安装/清单正确”，不是完整运行时 UI 验证。

## Marketplace 状态

- 发布前（2026-09-16）：`DingdongChilk.dingdongji` 未发布，2.4.0 可用。
- 发布后（2026-09-16）：`vsce publish --no-dependencies` 返回 `DONE Published DingdongChilk.dingdongji v2.4.0`；Marketplace `extensionquery` API 返回该扩展，gallery CDN 的 README Details 与 VSIXPackage 资源均 HTTP 200（VSIX ≈ 723,982 字节）。
- 公开 item 页面 `https://marketplace.visualstudio.com/items?itemName=DingdongChilk.dingdongji` 在发布后短时间内仍返回 404（页面传播/审核可能滞后），以 API 与 CDN 为准；稍后复查页面。

## 公开仓库（已解决）

- 仓库：`https://github.com/pddrwang/dingdongji`（**public**，默认分支 `main`）。
- `package.json` 的 repository / bugs / qna 与 README 反馈链接已指向该仓库。
- 已核验公网可达（HTTP 200）：仓库页、`README.md`、`CHANGELOG.md`、`LICENSE`、`media/details/workbench.png`、`media/details/citation-verification.png`。Marketplace 用该仓库解析 README 相对图片与链接。
- 认证经 `gh auth login` 设备码完成，令牌仅存本机 `gh` 配置；未在对话或仓库中写入任何密钥。

## 发布动作（已执行）

1. 公开仓库已解决并核验 README 图片/链接可访问。
2. 用户明确批准后执行：`VSCE_PAT=<本机提供> npx vsce publish --no-dependencies` → 发布成功。
3. 令牌未写入任何文件、未打印；发布后仍建议在 Azure DevOps 撤销并按需重建。

**安全提醒**：本次发布用的 PAT 由用户在对话中提供，视为已泄露，应立即在 Azure DevOps 撤销并重建；新建令牌只配置在本机（`vsce login` 或仅本进程环境变量），不要粘贴到对话。

## 维护依据

详情页以 README.md 为入口，使用静态 Markdown 与 PNG。展示图由真实前端组件渲染，明确标注合成数据；不引入动态脚本。

规则参考：[VS Code 发布文档](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)、
[扩展清单文档](https://code.visualstudio.com/api/references/extension-manifest)。
