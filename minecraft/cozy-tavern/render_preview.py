"""스키매틱 미리보기 PNG 생성 (Pillow 필요): 외관 2방향 + 층별 단면."""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

import build_tavern as t

COLORS = [
    ('campfire', (255, 150, 40)), ('lantern', (255, 210, 110)), ('candle', (250, 230, 170)),
    ('flowering_azalea', (120, 150, 60)), ('azalea_leaves', (95, 130, 50)), ('amethyst', (190, 150, 230)),
    ('jungle_trapdoor', (225, 190, 80)), ('spruce_trapdoor', (110, 80, 50)), ('oak_trapdoor', (170, 130, 80)),
    ('dark_oak_trapdoor', (70, 48, 30)), ('mangrove', (130, 45, 45)),
    ('stripped_dark_oak', (95, 70, 50)), ('dark_oak', (70, 48, 30)), ('stripped_oak', (185, 145, 85)),
    ('oak', (170, 135, 80)), ('spruce', (115, 85, 55)), ('chiseled_bookshelf', (120, 90, 60)),
    ('bookshelf', (130, 100, 70)), ('deepslate', (75, 75, 80)), ('cobbled_deepslate', (80, 80, 85)),
    ('cracked_stone', (120, 120, 120)), ('mossy', (110, 125, 95)), ('stone_brick', (125, 125, 125)),
    ('cobblestone', (115, 115, 115)), ('polished_andesite', (140, 142, 142)), ('andesite', (130, 130, 130)),
    ('tuff', (110, 110, 100)), ('stone', (128, 128, 128)), ('calcite', (225, 225, 222)),
    ('white_concrete', (235, 238, 240)), ('diorite', (205, 205, 205)), ('mud_bricks', (150, 110, 80)),
    ('granite', (160, 105, 85)), ('brick', (160, 75, 60)), ('red_terracotta', (145, 60, 45)),
    ('orange_terracotta', (175, 95, 40)), ('red_concrete', (150, 35, 35)), ('red_bed', (160, 40, 40)),
    ('white_bed', (230, 230, 230)), ('black_bed', (40, 40, 45)), ('red_carpet', (160, 40, 40)),
    ('orange_carpet', (230, 120, 30)), ('purple', (120, 50, 160)), ('blue_carpet', (50, 60, 160)),
    ('black_carpet', (30, 30, 30)), ('light_gray_carpet', (160, 160, 160)), ('gray_carpet', (80, 80, 85)),
    ('white_carpet', (235, 235, 235)), ('chest', (160, 115, 50)), ('barrel', (125, 90, 50)),
    ('furnace', (100, 100, 100)), ('smoker', (95, 85, 75)), ('crafting', (150, 110, 70)),
    ('door', (75, 52, 32)), ('potted', (150, 80, 50)), ('decorated_pot', (150, 90, 70)),
    ('enchanting', (120, 30, 40)), ('brewing', (110, 100, 90)), ('cake', (240, 230, 220)),
    ('lime_stained', (130, 200, 40)), ('iron_bars', (90, 90, 90)), ('cauldron', (60, 60, 60)),
    ('dirt_path', (145, 120, 70)), ('coarse_dirt', (120, 85, 60)), ('packed_mud', (140, 105, 80)),
]


def color(name):
    n = name.split(':')[1]
    for k, c in COLORS:
        if k in n:
            return c
    return (200, 0, 200)


def shade(c, f):
    return tuple(max(0, min(255, int(v * f))) for v in c)


def iso(blocks, out, flip=False, scale=14, title=''):
    """flip=False: 남동쪽(정면 오른쪽)에서 본 모습, True: 남서쪽."""
    pts = {}
    for (x, y, z), (name, _) in blocks.items():
        # flip: 90도 회전해서 남서쪽에서 본 모습 (정면이 오른쪽 면)
        pts[(z, y, -x) if flip else (x, y, z)] = name
    cos, sin = 0.866 * scale, 0.5 * scale
    xs = [(X - z) * cos for X, _, z in pts]
    ys = [(X + z) * sin - y * scale for X, y, z in pts]
    W = int(max(xs) - min(xs) + 6 * scale)
    Hh = int(max(ys) - min(ys) + 6 * scale)
    ox, oy = -min(xs) + 3 * scale, -min(ys) + 4 * scale
    img = Image.new('RGB', (W, Hh + 30), (235, 240, 245))
    d = ImageDraw.Draw(img)
    for (X, y, z) in sorted(pts, key=lambda p: (p[0] + p[2] + p[1], p[1])):
        name = pts[(X, y, z)]
        c = color(name)
        sx = (X - z) * cos + ox
        sy = (X + z) * sin - y * scale + oy
        top = [(sx, sy - scale), (sx + cos, sy - scale + sin), (sx, sy - scale + 2 * sin), (sx - cos, sy - scale + sin)]
        left = [(sx - cos, sy - scale + sin), (sx, sy - scale + 2 * sin), (sx, sy + 2 * sin), (sx - cos, sy + sin)]
        right = [(sx, sy - scale + 2 * sin), (sx + cos, sy - scale + sin), (sx + cos, sy + sin), (sx, sy + 2 * sin)]
        d.polygon(top, fill=shade(c, 1.0), outline=shade(c, .8))
        d.polygon(left, fill=shade(c, .78), outline=shade(c, .6))
        d.polygon(right, fill=shade(c, .62), outline=shade(c, .5))
    if title:
        d.text((10, Hh + 8), title, fill=(30, 30, 30))
    img.save(out)


def plan(blocks, y, out, scale=22, title=''):
    xs = [p[0] for p in blocks]
    zs = [p[2] for p in blocks]
    x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
    img = Image.new('RGB', ((x1 - x0 + 1) * scale, (z1 - z0 + 1) * scale + 24), (250, 250, 250))
    d = ImageDraw.Draw(img)
    for x in range(x0, x1 + 1):
        for z in range(z0, z1 + 1):
            px, pz = (x - x0) * scale, (z - z0) * scale
            b = blocks.get((x, y, z))
            if b:
                c = color(b[0])
                d.rectangle([px, pz, px + scale - 1, pz + scale - 1], fill=c, outline=shade(c, .7))
                n = b[0].split(':')[1]
                if 'stairs' in n or 'trapdoor' in n or 'bed' in n or 'door' in n:
                    f = b[1].get('facing')
                    if f:
                        dx, dz = t.DIRS[f]
                        cx, cz = px + scale / 2, pz + scale / 2
                        d.line([cx, cz, cx + dx * scale * .4, cz + dz * scale * .4], fill=(0, 0, 0), width=2)
            else:
                fb = blocks.get((x, y - 1, z))
                if fb:
                    d.rectangle([px, pz, px + scale - 1, pz + scale - 1], fill=shade(color(fb[0]), .45))
    d.text((6, (z1 - z0 + 1) * scale + 6), title, fill=(20, 20, 20))
    img.save(out)


if __name__ == '__main__':
    out = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
    out.mkdir(parents=True, exist_ok=True)
    t.build()
    full = dict(t.B)
    iso(full, out / 'preview_front_right.png', title='Front-right (south-east)')
    iso(full, out / 'preview_front_left.png', flip=True, title='Front-left (south-west)')
    for label, y in (('1F', t.F0 + 1), ('2F', t.F1 + 1), ('attic', t.F2 + 1)):
        cut = {p: v for p, v in full.items() if p[1] <= y + 2 and p[2] < 15}
        iso(cut, out / f'cutaway_{label}.png', flip=True, scale=20, title=f'{label} cutaway')
        plan(full, y, out / f'plan_{label}.png', title=f'{label} plan (y={y}, top = north, bottom = front)')


def elevation(blocks, out, side='south', scale=20, title=''):
    """정면/측면 입면도: 시선 방향으로 가장 앞의 블록, 깊이에 따라 어둡게."""
    if side == 'south':
        key = lambda p: (p[0], p[1]); depth = lambda p: p[2]
    elif side == 'east':
        key = lambda p: (-p[2], p[1]); depth = lambda p: p[0]
    else:  # west
        key = lambda p: (p[2], p[1]); depth = lambda p: -p[0]
    front = {}
    for p, v in blocks.items():
        if p[2] >= 15:  # 앞마당 노점·길 제외
            continue
        k = key(p)
        if k not in front or depth(p) > depth(front[k][0]):
            front[k] = (p, v)
    us = [k[0] for k in front]
    vs = [k[1] for k in front]
    dmax = max(depth(p) for p, _ in front.values())
    img = Image.new('RGB', ((max(us) - min(us) + 3) * scale, (max(vs) - min(vs) + 3) * scale + 24), (205, 225, 240))
    d = ImageDraw.Draw(img)
    for (u, v), (p, (name, props)) in front.items():
        f = 1.0 - min(.45, (dmax - depth(p)) * .035)
        c = shade(color(name), f)
        px = (u - min(us) + 1) * scale
        py = (max(vs) - v + 1) * scale
        n = name.split(':')[1]
        if n.endswith('_stairs') or n.endswith('_slab'):
            half = props.get('half') or props.get('type')
            if n.endswith('_slab') and half == 'bottom':
                d.rectangle([px, py + scale // 2, px + scale - 1, py + scale - 1], fill=c)
                continue
            if n.endswith('_slab') and half == 'top':
                d.rectangle([px, py, px + scale - 1, py + scale // 2], fill=c)
                continue
        d.rectangle([px, py, px + scale - 1, py + scale - 1], fill=c, outline=shade(c, .82))
    d.text((6, img.size[1] - 18), title, fill=(20, 20, 20))
    img.save(out)


if __name__ == '__main__':
    elevation(full, out / 'elevation_front.png', 'south', title='Front elevation (south)')
    elevation(full, out / 'elevation_east.png', 'east', title='East elevation (chimney side)')
    elevation(full, out / 'elevation_west.png', 'west', title='West elevation (sign side)')
