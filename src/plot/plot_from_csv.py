#!/usr/bin/env python3
"""
plot_from_csv.py — 叮咚鸡 V2.3 绘图模块：从 CSV 数据一键生成出版级科研图。

用法示例:
  ~/ddj/venvs/ds-stats/bin/python plot_from_csv.py \\
      --csv data.csv --type scatter --x x --y y --title Demo --out fig.png

支持类型:
  scatter  散点 + 线性趋势线
  line     折线（可按分组）
  hist     直方图
  box      箱线图 + Mann-Whitney 显著性标注（需 --group）
  bar      均值±SD 柱状图（可按分组并排）
  volcano  火山图（--x=log2FC --y=pvalue）

输出: 成功打印 PLOT_OK: <绝对路径>；失败打印 PLOT_FAIL: <原因>（exit 1）。
"""
import argparse
import os
import sys

import matplotlib
matplotlib.use("Agg")


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--type", choices=["scatter", "line", "hist", "box", "bar", "volcano"],
                    default="scatter")
    ap.add_argument("--x", default="")
    ap.add_argument("--y", default="")
    ap.add_argument("--group", default="")
    ap.add_argument("--title", default="")
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=float, default=3.5)
    ap.add_argument("--height", type=float, default=2.6)
    ap.add_argument("--dpi", type=int, default=300)
    ap.add_argument("--style", default="nature",
                    choices=["nature", "science", "ieee", "grid", "retina", "default"])
    ap.add_argument("--palette", default="viridis", choices=["viridis", "colorblind", "default"])
    return ap.parse_args()


def setup_style(style):
    """scienceplots 必须先 import 再 use；失败时回退默认样式。"""
    try:
        import scienceplots  # noqa: F401
        import matplotlib.pyplot as plt
        if style != "default":
            plt.style.use(style)
    except Exception:
        pass
    import matplotlib.pyplot as plt
    # 强制关闭 LaTeX 渲染（避免缺 cm-super 等 TeX 依赖时报错），用 mathtext
    plt.rcParams["text.usetex"] = False
    plt.rcParams["mathtext.fontset"] = "dejavusans"
    # 中文字体（macOS）+ 负号显示
    plt.rcParams["font.sans-serif"] = ["Arial Unicode MS", "PingFang SC",
                                       "Helvetica", "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False
    return plt


def read_csv(path):
    import pandas as pd
    if not os.path.isfile(path):
        raise RuntimeError(f"CSV 文件不存在: {path}")
    try:
        df = pd.read_csv(path)
    except Exception:
        df = pd.read_csv(path, sep="\t")
    if df.shape[1] < 2:
        raise RuntimeError("CSV 至少需要 2 列")
    return df


def col(df, name, label):
    if not name:
        raise RuntimeError(f"缺少必填列: {label}")
    if name not in df.columns:
        raise RuntimeError(f"列不存在: {name}（可用列: {', '.join(map(str, df.columns))}）")
    return name


def cat_palette(plt, n, palette):
    if palette == "viridis":
        import numpy as np
        cmap = plt.get_cmap("viridis")
        return [cmap(i / max(n - 1, 1)) for i in range(n)]
    if palette == "colorblind":
        import seaborn as sns
        return sns.color_palette("colorblind", n)
    return plt.rcParams["axes.prop_cycle"].by_key()["color"]


def main():
    args = parse_args()
    plt = setup_style(args.style)
    import numpy as np
    try:
        df = read_csv(args.csv)
        fig, ax = plt.subplots(figsize=(args.width, args.height))

        if args.type == "scatter":
            x = col(df, args.x, "X 列")
            y = col(df, args.y, "Y 列")
            ax.scatter(df[x], df[y], s=16, alpha=0.7,
                       color=cat_palette(plt, 1, args.palette)[0])
            mask = np.isfinite(df[x].to_numpy(float)) & np.isfinite(df[y].to_numpy(float))
            if mask.sum() > 2:
                xs = df[x].to_numpy(float)[mask]
                ys = df[y].to_numpy(float)[mask]
                b, a = np.polyfit(xs, ys, 1)
                xs2 = np.linspace(xs.min(), xs.max(), 100)
                ax.plot(xs2, a + b * xs2, color="#d62728", lw=1.2,
                        label=f"趋势 (slope={b:.3f})")
                ax.legend(frameon=False, fontsize=8)
            ax.set_xlabel(df[x].name)
            ax.set_ylabel(df[y].name)

        elif args.type == "line":
            x = col(df, args.x, "X 列")
            y = col(df, args.y, "Y 列")
            if args.group and args.group in df.columns:
                for i, (g, sub) in enumerate(df.groupby(args.group, sort=False)):
                    sub = sub.sort_values(x)
                    ax.plot(sub[x], sub[y], marker="o", ms=3, lw=1.2,
                            color=cat_palette(plt, df[args.group].nunique(), args.palette)[i],
                            label=str(g))
                ax.legend(frameon=False, fontsize=8)
            else:
                d = df.sort_values(x)
                ax.plot(d[x], d[y], marker="o", ms=3, lw=1.2)
            ax.set_xlabel(df[x].name)
            ax.set_ylabel(df[y].name)

        elif args.type == "hist":
            y = col(df, args.y, "Y 列")
            ax.hist(df[y].dropna(), bins=min(30, max(8, int(np.sqrt(len(df))))),
                    color=cat_palette(plt, 1, args.palette)[0], alpha=0.85, edgecolor="white")
            ax.set_xlabel(df[y].name)
            ax.set_ylabel("Count")

        elif args.type == "box":
            y = col(df, args.y, "Y 列")
            g = col(df, args.group, "分组列")
            import seaborn as sns
            sns.boxplot(data=df, x=g, y=y, hue=g, legend=False, ax=ax,
                        palette=cat_palette(plt, df[g].nunique(), args.palette))
            sns.stripplot(data=df, x=g, y=y, ax=ax, color="0.25", size=2.5, alpha=0.6)
            levels = list(dict.fromkeys(df[g].astype(str)))
            if 2 <= len(levels) <= 6:
                from statannotations.Annotator import Annotator
                pairs = [(a, b) for i, a in enumerate(levels) for b in levels[i + 1:]]
                Annotator(ax, pairs, data=df, x=g, y=y).configure(
                    test="Mann-Whitney", text_format="star").apply_test().annotate()
            ax.set_xlabel(df[g].name)
            ax.set_ylabel(df[y].name)

        elif args.type == "bar":
            y = col(df, args.y, "Y 列")
            x = col(df, args.x, "X 列")
            grp = args.group if (args.group and args.group in df.columns) else None
            agg = df.groupby([x] + ([grp] if grp else []))[y].agg(["mean", "std", "count"])
            agg = agg.reset_index()
            xs = agg[x].astype(str)
            if grp:
                cats = list(dict.fromkeys(agg[grp].astype(str)))
                colors = cat_palette(plt, len(cats), args.palette)
                width = 0.8 / len(cats)
                for i, c in enumerate(cats):
                    sub = agg[agg[grp].astype(str) == c]
                    pos = np.arange(len(sub)) + (i - (len(cats) - 1) / 2) * width
                    ax.bar(pos, sub["mean"], width, yerr=sub["std"], capsize=2,
                           color=colors[i], label=str(c))
                ax.set_xticks(np.arange(len(dict.fromkeys(xs))))
                ax.set_xticklabels(list(dict.fromkeys(xs)), rotation=30, ha="right")
                ax.legend(frameon=False, fontsize=8)
            else:
                xs = list(dict.fromkeys(xs))
                means = [agg.loc[agg[x].astype(str) == s, "mean"].iloc[0] for s in xs]
                sds = [agg.loc[agg[x].astype(str) == s, "std"].iloc[0] for s in xs]
                ax.bar(np.arange(len(xs)), means, yerr=sds, capsize=3,
                       color=cat_palette(plt, 1, args.palette)[0])
                ax.set_xticks(np.arange(len(xs)))
                ax.set_xticklabels(xs, rotation=30, ha="right")
            ax.set_ylabel(f"Mean {df[y].name} ± SD")

        elif args.type == "volcano":
            x = col(df, args.x, "log2FC 列")
            y = col(df, args.y, "pvalue 列")
            import pandas as pd
            d = pd.DataFrame({"fc": df[x].astype(float), "p": df[y].astype(float)}).dropna()
            d["nlog"] = -np.log10(d["p"].clip(lower=1e-300))
            up = (d["fc"] > 1) & (d["p"] < 0.05)
            dn = (d["fc"] < -1) & (d["p"] < 0.05)
            for m, c, lb in [(~up & ~dn, "#8b949e", None), (up, "#d62728", "Up"),
                             (dn, "#1f77b4", "Down")]:
                ax.scatter(d.loc[m, "fc"], d.loc[m, "nlog"], s=8, alpha=0.7, color=c, label=lb)
            ax.axvline(-1, ls="--", lw=0.8, color="#666"); ax.axvline(1, ls="--", lw=0.8, color="#666")
            ax.axhline(-np.log10(0.05), ls="--", lw=0.8, color="#666")
            ax.set_xlabel(df[x].name); ax.set_ylabel("-log10(pvalue)")
            ax.legend(frameon=False, fontsize=8, markerscale=2)

        if args.title:
            ax.set_title(args.title, fontsize=10, pad=8)
        fig.tight_layout()
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        fig.savefig(args.out, dpi=args.dpi, bbox_inches="tight")
        plt.close(fig)
        print(f"PLOT_OK: {os.path.abspath(args.out)}")
        return 0
    except Exception as e:
        print(f"PLOT_FAIL: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
