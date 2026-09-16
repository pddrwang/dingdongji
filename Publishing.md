# V2.4 发布门禁

当前状态：源码、详情页与打包已完成上架前准备；本地 VSIX 已生成并在隔离环境安装成功。**尚未发布、未替换已装扩展。**

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

## Marketplace 状态（2026-09-16 核对）

- `DingdongChilk.dingdongji` 在 Marketplace **未发布**，因此 2.4.0 版本号可用，无覆盖冲突。
- 发布前仍需再次核对（以发布当时为准）。

## 上架前阻塞项（必须先解决）

- `package.json` 的 repository / bugs / qna 指向 `https://github.com/wangdizun/dingdongji`，公网 404。VS Code Marketplace 用公开仓库解析 README 的相对图片与相对链接（如 `media/details/workbench.png`、`CHANGELOG.md`、`LICENSE`）。请先创建并公开该仓库、推送源码与 `media/`，或把详情页图片改为可公网访问的绝对地址，否则详情页图片和链接不可用。
- 仓库需要由你在 GitHub 上创建；本地未擅自 `git init` 或推送。推送前建议确认仓库地址与你的 GitHub 账号一致。

## 发布动作（需明确批准后执行）

1. 解决上面的公开仓库阻塞项，并在真实仓库中确认 README 图片/链接可访问。
2. 在 VS Code 宿主中人工检查详情页、主题、缩放与卡片交互。
3. 用两个独立项目检查会话切换/隔离；用无敏感数据的真实项目跑一轮研究闭环。
4. 获得明确批准后：`npx vsce publish --no-dependencies`（发布）或先分发本地 VSIX。

本轮**没有发布**，也没有删除远端版本。

## 维护依据

详情页以 README.md 为入口，使用静态 Markdown 与 PNG。展示图由真实前端组件渲染，明确标注合成数据；不引入动态脚本。

规则参考：[VS Code 发布文档](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)、
[扩展清单文档](https://code.visualstudio.com/api/references/extension-manifest)。
