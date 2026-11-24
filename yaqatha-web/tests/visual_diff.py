"""يقارن tests/visual/current بـ tests/visual/baseline بكسلًا ببكسل ويكتب صور الفرق في tests/visual/diff. يخرج بـ 1 عند أي فرق."""
import os, sys
from PIL import Image, ImageChops
B, C, D = 'tests/visual/baseline', 'tests/visual/current', 'tests/visual/diff'
os.makedirs(D, exist_ok=True)
bad = []
for name in sorted(os.listdir(B)):
    b, c = Image.open(f'{B}/{name}').convert('RGB'), (Image.open(f'{C}/{name}').convert('RGB') if os.path.exists(f'{C}/{name}') else None)
    if c is None: bad.append(f'{name}: مفقودة'); continue
    if b.size != c.size: bad.append(f'{name}: الحجم {b.size} → {c.size}'); continue
    box = ImageChops.difference(b, c).getbbox()
    if box:
        diff = c.copy(); mask = ImageChops.difference(b, c).convert('L').point(lambda x: 255 if x > 0 else 0)
        diff.paste((255, 0, 80), mask=mask); diff.save(f'{D}/{name}')
        bad.append(f'{name}: فرق في المنطقة {box}')
print('\n'.join(bad) if bad else f'لا فروق: {len(os.listdir(B))} صفحة متطابقة تمامًا')
sys.exit(1 if bad else 0)
