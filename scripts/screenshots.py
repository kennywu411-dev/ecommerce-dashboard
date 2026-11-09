"""给 README 截图并合成演示 GIF。需要先在 site/ 目录起本地服务：
python -m http.server 8791 --bind 127.0.0.1 -d site
然后：python scripts/screenshots.py
"""
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
IMG = ROOT / "docs/images"
URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8791/"
IMG.mkdir(parents=True, exist_ok=True)


def go(page, tab, **st):
    sets = "".join(f"__dash.state.{k}={v!r};" for k, v in st.items())
    page.evaluate(f"() => {{ __dash.state.tab={tab!r}; {sets} __dash.render(); window.scrollTo(0,0); }}")
    page.wait_for_timeout(1400)


with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")  # 用本机 Chrome，免下载浏览器
    page = b.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2, color_scheme="light")
    page.goto(URL)
    page.wait_for_function("window.__dash")
    page.wait_for_timeout(800)

    go(page, "overview", m0=12, m1=23, market="all")
    page.screenshot(path=IMG / "overview.png", full_page=True)
    go(page, "trend")
    page.screenshot(path=IMG / "trend.png", full_page=True)
    go(page, "drill")
    page.screenshot(path=IMG / "drill.png", full_page=True)
    go(page, "retention", m0=0)
    page.screenshot(path=IMG / "retention.png", full_page=True)
    go(page, "findings")
    for i, card in enumerate(page.query_selector_all("article.finding"), 1):
        card.screenshot(path=IMG / f"finding-{i}.png")

    # 演示 GIF：切页 + 筛选
    frames = ROOT / "data/gif_frames"
    frames.mkdir(parents=True, exist_ok=True)
    for f in frames.glob("*.png"):
        f.unlink()
    small = b.new_page(viewport={"width": 1280, "height": 800}, color_scheme="light")
    small.goto(URL)
    small.wait_for_function("window.__dash")
    small.wait_for_timeout(800)
    steps = [
        ("overview", dict(m0=12, m1=23, market="all")),
        ("overview", dict(m0=12, m1=23, market="ov")),
        ("trend", dict(market="all")),
        ("drill", dict()),
        ("drill", dict(market="c:1")),
        ("retention", dict(m0=0, market="all")),
        ("findings", dict()),
    ]
    for i, (tab, st) in enumerate(steps):
        go(small, tab, **st)
        small.screenshot(path=frames / f"{i:02d}.png")
    b.close()

subprocess.run([
    "ffmpeg", "-y", "-loglevel", "error", "-framerate", "0.6", "-i", str(frames / "%02d.png"),
    "-vf", "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
    "-loop", "0", str(IMG / "demo.gif"),
], check=True)
print("done:", sorted(x.name for x in IMG.iterdir()))
