"""Turn the decoded stable APK (apktool, no sources) into the separate alpha app.

Usage: alpha-identity.py <decoded-dir> <build-number>
New applicationId, own permission/provider names, own label, own port, alpha icon badge.
"""
import re, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(sys.argv[1]); build = sys.argv[2]
OLD, NEW = "com.opencode.plusplus", "com.opencode.plusplus.alpha"

m = root / "AndroidManifest.xml"; s = m.read_text()
s = s.replace(f'package="{OLD}"', f'package="{NEW}"')
# Names owned by the package id (not Java classes): permission, provider authorities.
s = s.replace(f"{OLD}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION", f"{NEW}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION")
s = s.replace(f'android:authorities="{OLD}.', f'android:authorities="{NEW}.')
assert f'package="{NEW}"' in s
assert not re.search(rf'authorities="{re.escape(OLD)}\.(?!alpha\.)', s)
if "REQUEST_INSTALL_PACKAGES" not in s:
    s = s.replace('<uses-permission android:name="android.permission.INTERNET"/>',
                  '<uses-permission android:name="android.permission.INTERNET"/>\n    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/>', 1)
m.write_text(s)

y = root / "apktool.yml"; t = y.read_text()
t = re.sub(r"versionCode: \d+", f"versionCode: {build}", t)
t = re.sub(r"versionName: .*", f"versionName: alpha-{build}", t)
y.write_text(t)

st = root / "res/values/strings.xml"; x = st.read_text()
x = x.replace('<string name="app_name">OpenCode++</string>', '<string name="app_name">OpenCode++ alpha</string>')
x = re.sub(r'(<string name="title_activity_main">)[^<]*', r'\1OpenCode++ alpha', x)
st.write_text(x)

cfg = root / "assets/capacitor.config.json"
c = cfg.read_text().replace(OLD, NEW).replace('"OpenCode++"', '"OpenCode++ alpha"'); cfg.write_text(c)

font = None
for f in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"):
    if Path(f).exists(): font = f; break
for p in sorted(root.glob("res/mipmap-*/ic_launcher*.png")):
    im = Image.open(p).convert("RGBA"); w, h = im.size
    fg = "foreground" in p.name
    y0, y1 = (int(h * .60), int(h * .76)) if fg else (int(h * .70), int(h * .90))
    d = ImageDraw.Draw(im)
    d.rectangle([int(w * .18), y0, int(w * .82), y1], fill=(255, 120, 0, 255))
    size = max(8, int((y1 - y0) * .72))
    f = ImageFont.truetype(font, size) if font else ImageFont.load_default()
    d.text((w // 2, (y0 + y1) // 2), "ALPHA", fill=(255, 255, 255, 255), font=f, anchor="mm")
    im.save(p)
print("alpha identity applied, build", build)
