"""Render a readable contact sheet of the real validation outputs."""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

root = Path(sys.argv[1])
report = json.loads((root / 'validation.json').read_text(encoding='utf-8'))
labels = {'dragon': 'Dragon bleu', 'knight': 'Chevalier dore', 'potion': 'Potion violette'}
font_path = Path('C:/Windows/Fonts/arial.ttf')
font = ImageFont.truetype(str(font_path), 22) if font_path.exists() else ImageFont.load_default()
small = ImageFont.truetype(str(font_path), 15) if font_path.exists() else ImageFont.load_default()


def preview(name):
    canvas = Image.new('RGB', (320, 320), (239, 240, 245))
    draw = ImageDraw.Draw(canvas)
    for y in range(0, 320, 16):
        for x in range(0, 320, 16):
            if (x // 16 + y // 16) % 2:
                draw.rectangle((x, y, x + 15, y + 15), fill=(218, 220, 230))
    sprite = Image.open(root / f'{name}-128.png').convert('RGBA')
    sprite = sprite.resize((320, 320), Image.Resampling.NEAREST)
    canvas.paste(sprite, (0, 0), sprite)
    return canvas


sheet = Image.new('RGB', (1008, 408), (247, 248, 252))
draw = ImageDraw.Draw(sheet)
for i, case in enumerate(report['cases']):
    sheet.paste(preview(case['id']), (8 + i * 336, 48))
    draw.text((8 + i * 336, 12), labels[case['id']], font=font, fill=(31, 36, 56))
    draw.text((8 + i * 336, 382), f"128 px | 48 couleurs max | {case['seconds']} s", font=small, fill=(66, 75, 98))
sheet.save(root / 'examples.png')

if (root / 'dragon-sd15-128.png').exists():
    comparison = Image.new('RGB', (688, 406), (247, 248, 252))
    draw = ImageDraw.Draw(comparison)
    for i, (name, label) in enumerate([('dragon-sd15', 'Ancien : SD 1.5 + Redmond'), ('dragon', 'Nouveau : FLUX.2 Klein')]):
        comparison.paste(preview(name), (12 + i * 344, 54))
        draw.text((12 + i * 344, 16), label, font=font, fill=(31, 36, 56))
    draw.text((12, 384), 'Meme prompt en francais et meme graine (42).', font=small, fill=(66, 75, 98))
    comparison.save(root / 'comparison.png')
