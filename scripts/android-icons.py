# The Android app's launcher icons from the desktop's build/icon.png (python3 scripts/android-icons.py; needs Pillow).
# An adaptive icon's layer is 108 dp of which about 72 dp shows through the launcher's mask, and its middle 66 dp is
# safe: the desktop icon's disc (675 px of its 1024) is placed to fill half the layer, three quarters of what shows, the icon's own dark
# square round it to the edges (the band outside it, never shown, in the background colour).
from PIL import Image, ImageDraw
import os

root = os.path.join(os.path.dirname(__file__), '..')
res = os.path.join(root, 'android', 'app', 'src', 'main', 'res')
src = Image.open(os.path.join(root, 'build', 'icon.png')).convert('RGBA')
BG = (15, 13, 14, 255)  # values/ic_launcher_background.xml

side = 1350
layer = Image.new('RGBA', (side, side), BG)
layer.alpha_composite(src, ((side - 1024) // 2, (side - 1024) // 2))
shown = layer.crop(((side - 900) // 2,) * 2 + ((side + 900) // 2,) * 2)  # what a launcher's mask shows

for name, dp in (('mdpi', 1), ('hdpi', 1.5), ('xhdpi', 2), ('xxhdpi', 3), ('xxxhdpi', 4)):
    out = os.path.join(res, f'mipmap-{name}')
    layer.resize((round(108 * dp),) * 2, Image.LANCZOS).save(os.path.join(out, 'ic_launcher_foreground.png'))
    size = round(48 * dp)
    src.resize((size, size), Image.LANCZOS).save(os.path.join(out, 'ic_launcher.png'))
    round_icon = shown.resize((size, size), Image.LANCZOS)
    mask = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    round_icon.putalpha(mask.resize((size, size), Image.LANCZOS))
    round_icon.save(os.path.join(out, 'ic_launcher_round.png'))
print('icons written')
