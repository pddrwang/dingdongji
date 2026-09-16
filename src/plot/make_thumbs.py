#!/usr/bin/env python3
"""
make_thumbs.py — 为图片生成 base64 缩略图（webview 预览用，规避资源 URI/CSP 加载问题）。

用法:
  ~/ddj/venvs/ds-stats/bin/python make_thumbs.py <img1> [img2 ...]

输出: JSON {"<abs path>": "data:image/png;base64,..."}（无法处理的文件自动跳过）。
"""
import base64
import io
import json
import os
import sys

MAX_WIDTH = 260


def thumb(path):
    try:
        from PIL import Image
        img = Image.open(path)
        img = img.convert("RGB")
        if img.width > MAX_WIDTH:
            h = max(1, int(img.height * MAX_WIDTH / img.width))
            img = img.resize((MAX_WIDTH, h), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=82, optimize=True)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return None


def main():
    out = {}
    for p in sys.argv[1:]:
        if not os.path.isfile(p):
            continue
        t = thumb(p)
        if t:
            out[os.path.abspath(p)] = t
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
