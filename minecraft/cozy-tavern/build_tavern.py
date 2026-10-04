"""JpCore 'Building a Cozy Minecraft Tavern' 재현 스키매틱 생성기.

영상(https://www.youtube.com/watch?v=TZKiMj980wM)의 완성본 외관과 후반부 인테리어
투어(1층 벽난로 라운지·바·식당, 2층 방들, 다락)를 프레임 단위로 보고 블록 단위로 옮긴 것.
표준 라이브러리만 사용한다.

    python3 build_tavern.py          # cozy_tavern.litematic / cozy_tavern.schem 생성

좌표계: x = 서→동, y = 위, z = 북→남 (정면 = 남쪽). y=0 은 지면 높이.
"""

import gzip
import io
import struct
import time
from pathlib import Path

DATA_VERSION = 3465  # 1.20.1 — 신버전 Litematica/WorldEdit 은 DataFixer 로 자동 변환
OUT = Path(__file__).resolve().parent

B = {}  # (x, y, z) -> (name, {props})


def S(x, y, z, name, **p):
    if ':' not in name:
        name = 'minecraft:' + name
    B[(x, y, z)] = (name, {k: str(v).lower() if isinstance(v, bool) else str(v) for k, v in p.items()})


def A(x, y, z):
    B.pop((x, y, z), None)


def fill(x1, y1, z1, x2, y2, z2, name, **p):
    for x in range(min(x1, x2), max(x1, x2) + 1):
        for y in range(min(y1, y2), max(y1, y2) + 1):
            for z in range(min(z1, z2), max(z1, z2) + 1):
                if name is None:
                    A(x, y, z)
                elif callable(name):
                    name(x, y, z)
                else:
                    S(x, y, z, name, **p)


def h01(x, y, z, salt=0):
    n = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791) ^ (salt * 2654435761)
    n = (n ^ (n >> 13)) * 1274126177
    return ((n ^ (n >> 16)) & 0xFFFFFF) / 0x1000000


def pick(x, y, z, mix, salt=0):
    r = h01(x, y, z, salt) * sum(w for _, w in mix)
    for name, w in mix:
        r -= w
        if r < 0:
            return name
    return mix[-1][0]


STONE = [('stone_bricks', 46), ('cracked_stone_bricks', 10), ('andesite', 10),
         ('polished_andesite', 18), ('stone', 9), ('mossy_stone_bricks', 7)]
INFILL = [('calcite', 55), ('white_concrete', 15), ('polished_diorite', 18), ('diorite', 12)]
ROOF = [('stone_brick', 44), ('cobblestone', 18), ('andesite', 14),
        ('deepslate_brick', 12), ('cobbled_deepslate', 12)]
FLOOR0 = [('polished_andesite', 45), ('stone_bricks', 30), ('andesite', 15), ('tuff', 10)]
BRICK = [('bricks', 85), ('mud_bricks', 8), ('granite', 7)]

ROOF_FULL = {'stone_brick': 'stone_bricks', 'cobblestone': 'cobblestone', 'andesite': 'andesite',
             'deepslate_brick': 'deepslate_bricks', 'cobbled_deepslate': 'cobbled_deepslate'}

DIRS = {'north': (0, -1), 'south': (0, 1), 'east': (1, 0), 'west': (-1, 0)}
OPP = {'north': 'south', 'south': 'north', 'east': 'west', 'west': 'east'}


def stone(x, y, z):
    S(x, y, z, pick(x, y, z, STONE))


def infill(x, y, z):
    S(x, y, z, pick(x, y, z, INFILL, 3))


def brick(x, y, z):
    S(x, y, z, pick(x, y, z, BRICK, 7))


def stair(x, y, z, name, facing, half='bottom'):
    S(x, y, z, name, facing=facing, half=half, shape='straight', waterlogged=False)


def trapdoor(x, y, z, name, facing, half='bottom', open_=True):
    S(x, y, z, name, facing=facing, half=half, open=open_, powered=False, waterlogged=False)


def pane(x, y, z, outward):
    """창문: 열린 정글 다락문(영상의 노란 격자창). outward = 벽 바깥 방향."""
    trapdoor(x, y, z, 'jungle_trapdoor', outward)


def log(x, y, z, name='stripped_oak_log', axis='y'):
    S(x, y, z, name, axis=axis)


def door(x, y, z, facing, hinge, name='dark_oak_door'):
    S(x, y, z, name, facing=facing, half='lower', hinge=hinge, open=False, powered=False)
    S(x, y + 1, z, name, facing=facing, half='upper', hinge=hinge, open=False, powered=False)


def bed(x, y, z, facing, color):
    dx, dz = DIRS[facing]
    S(x, y, z, f'{color}_bed', facing=facing, part='foot', occupied=False)
    S(x + dx, y, z + dz, f'{color}_bed', facing=facing, part='head', occupied=False)


def lantern(x, y, z, hanging=False):
    S(x, y, z, 'lantern', hanging=hanging, waterlogged=False)


def leaves(x, y, z, flowering=True):
    S(x, y, z, 'flowering_azalea_leaves' if flowering else 'azalea_leaves',
      persistent=True, distance=1, waterlogged=False)


def candle(x, y, z, n=1, color=''):
    S(x, y, z, f'{color}_candle' if color else 'candle', candles=n, lit=True, waterlogged=False)


def amethyst(x, y, z):
    S(x, y, z, 'amethyst_cluster', facing='up', waterlogged=False)


def chest(x, y, z, facing):
    S(x, y, z, 'chest', facing=facing, type='single', waterlogged=False)


def barrel(x, y, z, facing='up'):
    S(x, y, z, 'barrel', facing=facing, open=False)


def planter(x, y, z, h=2):
    """영상의 빨간 화분 + 꽃 핀 진달래 나무."""
    S(x, y, z, 'red_terracotta')
    for i in range(1, h + 1):
        leaves(x, y + i, z, flowering=(i % 2 == 1))


def lamp(x, y, z, post='dark_oak_fence'):
    """바닥 스탠드 조명: 울타리 기둥 + 랜턴."""
    S(x, y, z, post)
    S(x, y + 1, z, post)
    lantern(x, y + 2, z)


def table(x, y, z, name='spruce_trapdoor'):
    """영상의 낮은 테이블: 위쪽에 붙인 다락문. 소품은 y+1 에 올린다."""
    trapdoor(x, y, z, name, 'north', 'top', open_=False)


# ---------------------------------------------------------------------------
# 치수
# ---------------------------------------------------------------------------
GX0, GX1, GZ0, GZ1 = 0, 14, 0, 10     # 1층(석재) 외벽
UX0, UX1, UZ0, UZ1 = -1, 15, 0, 11    # 2층(목조, 정면·양옆으로 1칸 돌출)
F0, F1, F2 = 1, 6, 11                 # 1층 바닥 / 2층 바닥 / 다락 바닥
WX0, WX1, WZ = 8, 13, 13              # 정면 오른쪽 큰 박공(입구 위)
DX0, DX1, DZ = 1, 5, 12               # 정면 왼쪽 작은 박공(돌출창)
CH_X, CH_Z = (15, 16), (4, 7)         # 굴뚝(동쪽 박공)


def build_foundation():
    for x in range(GX0, GX1 + 1):
        for z in range(GZ0, GZ1 + 1):
            S(x, 0, z, 'cobblestone' if h01(x, 0, z) < .5 else 'stone_bricks')
    for x in range(GX0, GX1 + 1):
        for z in range(GZ0, GZ1 + 1):
            if x in (GX0, GX1) or z in (GZ0, GZ1):
                for y in range(F0, F1):
                    stone(x, y, z)
            else:
                S(x, F0, z, pick(x, F0, z, FLOOR0, 5))
    # 모서리 버트레스
    for cx, cz, fx, fz in ((GX0, GZ1, 'east', 'north'), (GX1, GZ1, 'west', 'north'),
                           (GX0, GZ0, 'east', 'south'), (GX1, GZ0, 'west', 'south')):
        ox = cx - 1 if cx == GX0 else cx + 1
        oz = cz + 1 if cz == GZ1 else cz - 1
        S(ox, F0, cz, 'stone_bricks')
        stair(ox, F0 + 1, cz, 'stone_brick_stairs', fx)
        S(cx, F0, oz, 'stone_bricks')
        stair(cx, F0 + 1, oz, 'stone_brick_stairs', fz)
    # 정면 중간 석재 기둥(영상의 반원 기둥)
    for y in range(F0, F0 + 3):
        S(6, y, GZ1 + 1, 'stone_brick_wall' if y > F0 else 'stone_bricks')
        S(7, y, GZ1 + 1, 'stone_brick_wall' if y > F0 else 'stone_bricks')


def build_ground_openings():
    # 정문 (오크 문틀 + 짙은 참나무 양문)
    door(10, F0 + 1, GZ1, 'south', 'right')
    door(11, F0 + 1, GZ1, 'south', 'left')
    for x in (9, 12):
        for y in range(F0 + 1, F0 + 4):
            log(x, y, GZ1)
    for x in range(9, 13):
        log(x, F0 + 3, GZ1, axis='x')
    # 현관 계단
    for x in range(9, 13):
        S(x, F0, GZ1 + 1, 'polished_andesite')
        stair(x, F0, GZ1 + 2, 'stone_brick_stairs', 'north')
    for x in (10, 11):
        S(x, F0, GZ1 + 3, 'stone_brick_slab', type='bottom', waterlogged=False)
    lantern(10, F1 - 1, GZ1 + 1, hanging=True)
    lantern(11, F1 - 1, GZ1 + 2, hanging=True)
    # 뒷문
    door(10, F0 + 1, GZ0, 'north', 'left')
    door(11, F0 + 1, GZ0, 'north', 'right')
    for x in range(10, 12):
        stair(x, F0, GZ0 - 1, 'stone_brick_stairs', 'south')

    def window(xs, zs, y0, y1, outward):
        fx, fz = DIRS[outward]
        cells = [(x, z) for x in xs for z in zs]
        for x, z in cells:
            for y in range(y0, y1 + 1):
                pane(x, y, z, outward)
            S(x + fx, y0 - 1, z + fz, 'spruce_slab', type='top', waterlogged=False)
            stair(x + fx, y1 + 1, z + fz, 'oak_stairs', OPP[outward], 'top')
        # 양옆 덧창
        if fx == 0:
            ends = [(min(xs) - 1, zs[0]), (max(xs) + 1, zs[0])]
        else:
            ends = [(xs[0], min(zs) - 1), (xs[0], max(zs) + 1)]
        for x, z in ends:
            for y in range(y0, y1 + 1):
                trapdoor(x + fx, y, z + fz, 'spruce_trapdoor', outward)
            stair(x + fx, y1 + 1, z + fz, 'oak_stairs', OPP[outward], 'top')
        # 창틀 안쪽 원목
        for x, z in ends:
            for y in range(y0 - 1, y1 + 2):
                log(x, y, z)
        for x, z in cells:
            log(x, y0 - 1, z, axis='x' if fx == 0 else 'z')
            log(x, y1 + 1, z, axis='x' if fx == 0 else 'z')

    window(range(2, 5), [GZ1], F0 + 2, F0 + 3, 'south')    # 정면 왼쪽(식당) 창
    window([GX0], range(6, 9), F0 + 2, F0 + 3, 'west')     # 서쪽 창


def build_jetty_corbels():
    y = F1 - 1
    for x in range(GX0, GX1 + 1):
        if (x, y, GZ1 + 1) not in B and not 9 <= x <= 12:
            stair(x, y, GZ1 + 1, 'oak_stairs', 'north', 'top')
    for z in range(GZ0, GZ1 + 2):
        if (GX0 - 1, y, z) not in B:
            stair(GX0 - 1, y, z, 'oak_stairs', 'east', 'top')
        if (GX1 + 1, y, z) not in B and not CH_Z[0] <= z <= CH_Z[1]:
            stair(GX1 + 1, y, z, 'oak_stairs', 'west', 'top')


def build_upper_floor():
    holes = {(x, z) for x in (6, 7) for z in range(5, 9)}
    for x in range(UX0, UX1 + 1):
        for z in range(UZ0, UZ1 + 1):
            if (x, z) in holes:
                A(x, F1, z)
                continue
            if x in (UX0, UX1):
                log(x, F1, z, axis='z')
            elif z in (UZ0, UZ1):
                log(x, F1, z, axis='x')
            elif x in (3, 11):
                log(x, F1, z, 'stripped_dark_oak_log', axis='z')
            else:
                S(x, F1, z, 'oak_planks')
    # 큰 박공 바닥 + 돌출창 바닥
    for x in range(WX0, WX1 + 1):
        for z in (12, WZ):
            log(x, F1, z, axis='x') if z == WZ or x in (WX0, WX1) else S(x, F1, z, 'oak_planks')
    for x in range(DX0, DX1 + 1):
        log(x, F1, DZ, axis='x')
        if x in (DX0, 3, DX1):
            stair(x, F1 - 1, DZ, 'oak_stairs', 'north', 'top')


def timber_wall(x, y, z, along, posts, u, band=True):
    """회벽 + 오크 기둥. band=True 면 영상 정면처럼 짙은 가로 띠를 넣는다."""
    if u in posts:
        log(x, y, z)
    elif band and y == F1 + 2:
        log(x, y, z, 'stripped_dark_oak_log', axis=along)
    else:
        infill(x, y, z)


def build_upper_walls():
    ys = range(F1 + 1, F2)
    front_posts, back_posts = {-1, 1, 5, 8, 13, 15}, {-1, 3, 7, 11, 15}
    side_posts = {0, 3, 8, 11}
    for y in ys:
        for x in range(UX0, UX1 + 1):
            timber_wall(x, y, UZ0, 'x', back_posts, x, band=False)
            if not (9 <= x <= 12 or 2 <= x <= 4):
                timber_wall(x, y, UZ1, 'x', front_posts, x)
        for z in range(UZ0, UZ1 + 1):
            timber_wall(UX0, y, z, 'z', side_posts, z, band=False)
            timber_wall(UX1, y, z, 'z', side_posts, z, band=False)
        # 큰 박공 벽(정면 z=13, 옆 x=8/13)
        for x in range(WX0, WX1 + 1):
            timber_wall(x, y, WZ, 'x', {WX0, WX1}, x)
        timber_wall(WX0, y, 12, 'z', set(), 12)
        timber_wall(WX1, y, 12, 'z', set(), 12)
        # 돌출창
        for x in range(DX0, DX1 + 1):
            timber_wall(x, y, DZ, 'x', {DX0, DX1}, x)
    # 창문
    for x in (2, 3, 4):
        for y in (F1 + 2, F1 + 3):
            pane(x, y, DZ, 'south')
    for x in (10, 11):
        for y in range(F1 + 2, F2):
            pane(x, y, WZ, 'south')
    for x in (8, 9):
        for y in (F1 + 2, F1 + 3):
            pane(x, y, UZ0, 'north')
    for z in (1, 2, 6, 7):
        for y in (F1 + 2, F1 + 3):
            pane(UX0, y, z, 'west')
    for z in (1, 9, 10):
        for y in (F1 + 2, F1 + 3):
            pane(UX1, y, z, 'east')
    # 창 아래 화단(영상의 정글 다락문 발코니 + 진달래)
    for x in (10, 11):
        S(x, F1, WZ + 1, 'spruce_slab', type='top', waterlogged=False)
        trapdoor(x, F1 + 1, WZ + 1, 'jungle_trapdoor', 'north')
    leaves(9, F1 + 1, WZ + 1)
    leaves(12, F1 + 1, WZ + 1, flowering=False)
    for x in (2, 3, 4):
        S(x, F1 + 1, DZ + 1, 'spruce_slab', type='top', waterlogged=False)
    leaves(2, F1 + 2, DZ + 1)
    leaves(4, F1 + 2, DZ + 1, flowering=False)
    trapdoor(3, F1 + 2, DZ + 1, 'spruce_trapdoor', 'north')
    # 2층 서쪽 모서리를 타고 내려오는 덩굴
    for y in range(F1 - 1, F1 + 3):
        leaves(UX0 - 1, y, 10, flowering=(y % 2 == 0))
    leaves(UX0 - 1, F1 - 2, 10, flowering=False)
    # 큰 박공 기둥 (현관)
    for px in (WX0, WX1):
        for y in range(F0, F1):
            log(px, y, WZ)
        for y in (F0, F0 + 3):
            for d, (dx, dz) in DIRS.items():
                trapdoor(px + dx, y, WZ + dz, 'oak_trapdoor', d)
        stair(px + 1, F1 - 1, WZ, 'oak_stairs', 'west', 'top')
        stair(px - 1, F1 - 1, WZ, 'oak_stairs', 'east', 'top')
        S(px, F0 - 1, WZ, 'stone_bricks')


def build_attic_floor():
    hole = {(x, z) for x in range(9, 13) for z in (5, 6)}
    for x in range(UX0, UX1 + 1):
        for z in range(UZ0, UZ1 + 1):
            if (x, z) in hole:
                continue
            edge_z = z in (UZ0, UZ1) and not (9 <= x <= 12 or 2 <= x <= 4)
            if x in (UX0, UX1):
                log(x, F2, z, axis='z')
            elif edge_z:
                log(x, F2, z, axis='x')
            else:
                S(x, F2, z, 'oak_planks')
    for x in range(WX0, WX1 + 1):
        log(x, F2, WZ, axis='x')
        log(x, F2, 12, axis='x') if x in (WX0, WX1) else S(x, F2, 12, 'oak_planks')
    for x in range(DX0, DX1 + 1):
        log(x, F2, DZ, axis='x')


# ---------------------------------------------------------------------------
# 지붕: 높이맵 방식 (본채 맞배 + 정면 박공 2개)
# ---------------------------------------------------------------------------
def roof_height():
    H = {}
    for x in range(UX0 - 1, UX1 + 2):
        for z in range(UZ0 - 1, UZ1 + 2):
            H[(x, z)] = (F2 + min(z, UZ1 - z), 'main')
    wing = {7: 10, 8: 12, 9: 14, 10: 16, 11: 16, 12: 14, 13: 12, 14: 10}
    for x, h in wing.items():
        for z in range(6, WZ + 2):
            if h > H.get((x, z), (-99,))[0] or (x, z) not in H:
                H[(x, z)] = (h, 'wing')
    dorm = {0: 10, 1: 12, 2: 13, 3: 14, 4: 13, 5: 12, 6: 10}
    for x, h in dorm.items():
        for z in range(8, DZ + 2):
            if h > H.get((x, z), (-99,))[0] or (x, z) not in H:
                H[(x, z)] = (h, 'dorm')
    return H


def build_roof():
    H = roof_height()
    low = {}
    for (x, z), (h, part) in H.items():
        nb = {d: H.get((x + dx, z + dz), (None,))[0] for d, (dx, dz) in DIRS.items()}
        ups = [d for d, v in nb.items() if v is not None and v > h]
        mat = pick(x, h, z, ROOF, 11)
        if len(ups) == 1:
            stair(x, h, z, f'{mat}_stairs', ups[0])
        else:
            S(x, h, z, ROOF_FULL[mat])
        known = [v for v in nb.values() if v is not None]
        bottom = h
        if known and min(known) + 1 < h:
            for y in range(min(known) + 1, h):
                S(x, y, z, ROOF_FULL[pick(x, y, z, ROOF, 11)])
            bottom = min(known) + 1
        low[(x, z)] = (bottom, ups[0] if len(ups) == 1 else None, part)
    return H, low


def inside_attic(x, z):
    if 0 <= x <= 14 and 1 <= z <= 10:
        return True
    if 9 <= x <= 12 and 11 <= z <= 12:
        return True
    return 2 <= x <= 4 and z == 11


def build_gables_and_ceiling(H, low):
    # 본채 박공벽(서·동)
    for gx in (UX0, UX1):
        for z in range(UZ0, UZ1 + 1):
            top = low[(gx, z)][0]
            for y in range(F2, top):
                if y == F2:
                    log(gx, y, z, axis='z')
                elif z in (0, 3, 8, 11) or (y == F2 + 3):
                    log(gx, y, z, 'stripped_oak_log' if z in (0, 3, 8, 11) else 'stripped_dark_oak_log',
                        axis='y' if z in (0, 3, 8, 11) else 'z')
                else:
                    infill(gx, y, z)
    for z in (5, 6):
        for y in (F2 + 1, F2 + 2):
            pane(UX0, y, z, 'west')
    # 큰 박공 정면벽 + 옆벽
    for x in range(WX0, WX1 + 1):
        top = low[(x, WZ)][0]
        for y in range(F2 + 1, top):
            if x in (WX0, WX1) or (x in (9, 12) and y == F2 + 2):
                log(x, y, WZ)
            else:
                infill(x, y, WZ)
    for xx in (WX0, WX1):
        for y in range(F2 + 1, low[(xx, 12)][0]):
            infill(xx, y, 12)
    for x in (10, 11):
        for y in (F2 + 1, F2 + 2):
            pane(x, y, WZ, 'south')
        log(x, F2 + 3, WZ, axis='x')
    # 돌출창 박공
    for x in range(DX0, DX1 + 1):
        for y in range(F2 + 1, low[(x, DZ)][0]):
            log(x, y, DZ) if x == 3 else infill(x, y, DZ)
    # 다락 천장(경사 반자) — 짙은 참나무 판자
    for (x, z), (bottom, _, _) in low.items():
        y = bottom - 1
        if inside_attic(x, z) and y > F2 and (x, y, z) not in B:
            S(x, y, z, 'dark_oak_planks')
    # 박공 가장자리 장식(오크 계단 바지보드) + 용마루
    for (x, z), (bottom, facing, part) in low.items():
        verge = (part == 'main' and x in (UX0 - 1, UX1 + 1)) or \
                (part == 'wing' and z == WZ + 1 and WX0 <= x <= WX1) or \
                (part == 'dorm' and z == DZ + 1 and DX0 <= x <= DX1)
        if verge and facing and (x, bottom - 1, z) not in B:
            stair(x, bottom - 1, z, 'oak_stairs', facing, 'top')
    ridge = F2 + 6
    for x in range(UX0 - 1, UX1 + 2):
        for z in (5, 6):
            log(x, ridge, z, axis='x')
            if (x + 2) % 3 == 0:
                log(x, ridge + 1, z)
    for x in (10, 11):
        for z in range(7, WZ + 2):
            log(x, ridge, z, axis='z')
        log(x, ridge + 1, WZ + 1)
    for z in range(9, DZ + 2):
        log(3, F2 + 4, z, axis='z')
    log(3, F2 + 5, DZ + 1)


def build_chimney():
    x0, x1 = CH_X
    z0, z1 = CH_Z
    for y in range(F0, F2 + 2):
        for x in range(x0, x1 + 1):
            for z in range(z0, z1 + 1):
                brick(x, y, z)
    for x in range(x0, x1 + 1):
        stair(x, F2 + 2, 4, 'brick_stairs', 'south')
        stair(x, F2 + 2, 7, 'brick_stairs', 'north')
        for y in range(F2 + 2, F2 + 10):
            for z in (5, 6):
                brick(x, y, z)
    for x in range(x0, x1 + 1):
        for z in (5, 6):
            S(x, F2 + 9, z, 'stone_bricks')
            S(x, F2 + 10, z, 'stone_brick_wall')
            S(x, F2 + 11, z, 'stone_brick_slab', type='bottom', waterlogged=False)
    for z in range(z0, z1 + 1):
        stair(x1 + 1, F0, z, 'stone_brick_stairs', 'west')
    # 1층 벽난로 (동쪽 벽 x=14, 화구 z=4..6)
    for z in range(3, 8):
        for y in range(F0 + 1, F1):
            brick(GX1 - 1, y, z)
    for z in (4, 5, 6):
        for y in (F0 + 1, F0 + 2):
            A(GX1 - 1, y, z)
            A(GX1, y, z)
        S(GX1, F0 + 1, z, 'campfire', lit=True, facing='west', signal_fire=False, waterlogged=False)
        brick(GX1, F0 + 3, z)
    for z in range(3, 8):
        stair(GX1 - 2, F0 + 3, z, 'spruce_stairs', 'east', 'top')
    S(GX1 - 2, F0 + 4, 3, 'potted_white_tulip')
    S(GX1 - 2, F0 + 4, 5, 'purple_wall_banner', facing='west')
    amethyst(GX1 - 2, F0 + 4, 6)
    candle(GX1 - 2, F0 + 4, 7, 3)


# ---------------------------------------------------------------------------
# 1층 인테리어: 바(북서) · 식당(남서) · 벽난로 라운지(동) · 계단실(중앙)
# ---------------------------------------------------------------------------
def build_ground_interior():
    y = F0 + 1
    # 계단실: x=6..7, z=8→5 로 북쪽으로 오름, 양옆 벽
    for i, z in enumerate((8, 7, 6, 5)):
        for x in (6, 7):
            stair(x, y + i, z, 'spruce_stairs', 'north')
            for yy in range(y, y + i):
                S(x, yy, z, 'spruce_planks')
    for z in range(5, 9):
        for yy in range(y, F1):
            # 서쪽: 서랍장 벽(영상의 격자 수납장) / 동쪽: 짙은 참나무 벽
            if z in (5, 8) or yy == F1 - 1:
                log(5, yy, z, 'stripped_dark_oak_log')
            else:
                S(5, yy, z, 'chiseled_bookshelf', facing='east',
                  **{f'slot_{i}_occupied': (h01(5, yy, z, i) < .6) for i in range(6)})
            S(8, yy, z, 'stripped_dark_oak_log' if z in (5, 8) else 'dark_oak_planks',
              **({'axis': 'y'} if z in (5, 8) else {}))
    lantern(6, F1 - 1, 9, hanging=True)

    # 바 카운터 (북쪽 벽)
    for x in range(1, 8):
        if x % 3 == 1:
            barrel(x, y, 1, 'south')
        else:
            chest(x, y, 1, 'south')
        stair(x, y + 2, 1, 'dark_oak_stairs', 'north', 'top')
    S(2, y + 1, 1, 'decorated_pot', facing='south', waterlogged=False)
    candle(3, y + 1, 1, 2)
    S(4, y + 1, 1, 'brewing_stand', has_bottle_0=True, has_bottle_1=False, has_bottle_2=True)
    candle(5, y + 1, 1, 3)
    S(6, y + 1, 1, 'potted_fern')
    S(7, y + 1, 1, 'decorated_pot', facing='south', waterlogged=False)
    S(1, y + 3, 1, 'potted_red_mushroom')
    candle(3, y + 3, 1, 1)
    S(5, y + 3, 1, 'decorated_pot', facing='south', waterlogged=False)
    candle(7, y + 3, 1, 2)
    for x in range(1, 7):
        S(x, y, 3, 'dark_oak_planks' if x % 2 else 'stripped_dark_oak_wood', **({} if x % 2 else {'axis': 'y'}))
    candle(2, y + 1, 3, 1)
    S(4, y + 1, 3, 'potted_red_tulip')
    candle(6, y + 1, 3, 2)
    for x in (2, 4, 6):
        trapdoor(x, y, 4, 'dark_oak_trapdoor', 'south', 'top', open_=False)
    lantern(3, F1 - 1, 3, hanging=True)
    lantern(6, F1 - 1, 2, hanging=True)

    # 식당: 서쪽 창 아래 벤치 + 테이블 2개 + 의자
    for z in (6, 7, 8):
        stair(1, y, z, 'dark_oak_stairs', 'west')
    for z in (6, 8):
        table(2, y, z)
        stair(3, y, z, 'spruce_stairs', 'east')
    candle(2, y + 1, 6, 1)
    S(2, y + 1, 8, 'potted_azure_bluet')
    planter(1, y, 9)
    leaves(1, y, 5)
    S(4, y, 9, 'barrel', facing='up', open=False)
    lantern(2, F1 - 1, 7, hanging=True)

    # 라운지: 벽난로 앞 소파 + 커피테이블, 양옆 화분·스탠드·책장
    for z in (4, 5, 6):
        stair(10, y, z, 'mangrove_stairs', 'west')
    trapdoor(10, y, 3, 'mangrove_trapdoor', 'north')  # 소파 팔걸이
    trapdoor(10, y, 7, 'mangrove_trapdoor', 'south')
    for z in (4, 5, 6):
        trapdoor(11, y, z, 'spruce_trapdoor', 'east', 'top', open_=False)
    amethyst(11, y + 1, 4)
    S(11, y + 1, 5, 'potted_cactus')
    amethyst(11, y + 1, 6)
    planter(13, y, 2)
    planter(13, y, 8)
    lamp(12, y, 2)
    lamp(12, y, 8)
    for yy in range(y, y + 3):
        S(13, yy, 1, 'bookshelf')
        S(13, yy, 9, 'bookshelf')
    S(9, y, 1, 'barrel', facing='up', open=False)
    S(9, y + 1, 1, 'potted_dandelion')
    lantern(11, F1 - 1, 5, hanging=True)
    lantern(10, F1 - 1, 8, hanging=True)
    S(12, y, 5, 'red_carpet')


# ---------------------------------------------------------------------------
# 2층
# ---------------------------------------------------------------------------
def build_upper_interior():
    y = F1 + 1
    # 2층→다락 계단: x=9..12, z=5..6, 동쪽으로 오름. 양옆 책장 벽
    for i, x in enumerate((9, 10, 11, 12)):
        for z in (5, 6):
            stair(x, y + i, z, 'spruce_stairs', 'east')
            for yy in range(y, y + i):
                S(x, yy, z, 'bookshelf')
    for x in range(9, 13):
        for yy in range(y, F2):
            for z in (4, 7):
                S(x, yy, z, 'bookshelf' if x not in (9, 12) else 'stripped_dark_oak_log',
                  **({'axis': 'y'} if x in (9, 12) else {}))
    # 계단실 벽(1층 계단 위)
    for z in range(5, 11):
        for yy in range(y, F2):
            S(5, yy, z, 'stripped_dark_oak_log' if z in (5, 10) else 'calcite',
              **({'axis': 'y'} if z in (5, 10) else {}))
    for z in range(7, 11):
        for yy in range(y, F2):
            S(8, yy, z, 'stripped_dark_oak_log' if z in (7, 10) else 'calcite',
              **({'axis': 'y'} if z in (7, 10) else {}))
    for x in (6, 7):
        for yy in range(y, F2):
            S(x, yy, 9, 'dark_oak_planks')
        chest(x, y, 10, 'north')
        chest(x, y + 1, 10, 'north')
    # 서쪽 방 칸막이 (x=5, z=1..4 문, z=5 가로벽)
    for z in range(1, 5):
        for yy in range(y, F2):
            S(5, yy, z, 'stripped_dark_oak_log' if z == 1 else 'calcite', **({'axis': 'y'} if z == 1 else {}))
    door(5, y, 3, 'east', 'left', 'spruce_door')
    for x in range(0, 5):
        for yy in range(y, F2):
            S(x, yy, 5, 'stripped_dark_oak_log' if x == 0 else 'calcite', **({'axis': 'y'} if x == 0 else {}))
    door(2, y, 5, 'south', 'left', 'spruce_door')

    # A1 (서북): 상자 선반 + 화덕 + 빨간 침대 + 매달린 초록 등
    for x in (1, 2, 3):
        chest(x, y, 1, 'south')
        chest(x, y + 1, 1, 'south')
        stair(x, y + 2, 1, 'dark_oak_stairs', 'north', 'top')
    S(4, y, 1, 'furnace', facing='south', lit=True)
    S(4, y, 2, 'smoker', facing='west', lit=True)
    for yy in (y + 1, y + 2, y + 3):
        brick(4, yy, 1)
    bed(1, y, 3, 'west', 'red')
    S(0, y, 4, 'barrel', facing='up', open=False)
    candle(0, y + 1, 4, 2)
    S(3, y, 4, 'blue_carpet')
    S(4, y, 4, 'blue_carpet')
    for x in (1, 3):
        S(x, F2 - 1, 2, 'iron_bars')
        S(x, F2 - 2, 2, 'lime_stained_glass')
    lantern(2, F2 - 1, 3, hanging=True)

    # A2 (서남, 정면 돌출창): 침실
    bed(1, y, 9, 'north', 'red')
    S(0, y, 9, 'barrel', facing='up', open=False)
    candle(0, y + 1, 9, 3)
    S(1, y, 6, 'bookshelf')
    S(1, y + 1, 6, 'bookshelf')
    S(0, y, 6, 'crafting_table')
    table(3, y, 7)
    S(3, y + 1, 7, 'cake', bites=0)
    stair(4, y, 7, 'dark_oak_stairs', 'east')
    S(2, y, 8, 'purple_carpet')
    S(3, y, 8, 'purple_carpet')
    amethyst(2, y, 11)
    amethyst(4, y, 11)
    S(3, y, 11, 'potted_flowering_azalea_bush')
    leaves(4, y, 10)
    lantern(2, F2 - 1, 8, hanging=True)

    # 복도(x=6..8, z=1..4)
    lantern(7, F2 - 1, 2, hanging=True)
    S(6, y, 1, 'potted_fern')
    planter(8, y, 1, h=1)
    S(7, y, 2, 'red_carpet')
    S(7, y, 3, 'red_carpet')

    # B (동북): 화덕·스모커 + 벽돌 후드, 상자 선반
    S(14, y, 2, 'smoker', facing='west', lit=True)
    S(14, y, 3, 'furnace', facing='west', lit=False)
    S(14, y, 1, 'barrel', facing='west', open=False)
    for yy in (y + 1, y + 2, y + 3):
        for z in (2, 3):
            brick(14, yy, z)
    for x in (10, 11, 12):
        chest(x, y, 1, 'south')
        chest(x, y + 1, 1, 'south')
        S(x, y + 2, 1, 'dark_oak_slab', type='bottom', waterlogged=False)
    candle(10, y + 3, 1, 3)
    S(12, y + 3, 1, 'potted_red_tulip')
    S(9, y, 1, 'crafting_table')
    S(13, y, 1, 'cauldron')
    lantern(12, F2 - 1, 2, hanging=True)
    for x in (10, 11):
        S(x, F2 - 1, 3, 'iron_bars')
        S(x, F2 - 2, 3, 'lime_stained_glass')

    # C (동남 + 큰 박공): 큰 창 아래 자수정, 침대, 케이크 테이블
    amethyst(10, y, 12)
    S(11, y, 12, 'purple_candle', candles=3, lit=True, waterlogged=False)
    S(9, y, 12, 'purple_carpet')
    S(12, y, 12, 'red_carpet')
    bed(10, y, 9, 'west', 'red')
    table(13, y, 8)
    S(13, y + 1, 8, 'cake', bites=1)
    stair(12, y, 8, 'dark_oak_stairs', 'west')
    chest(14, y, 10, 'west')
    chest(13, y, 10, 'north')
    leaves(9, y, 8)
    S(9, y + 1, 8, 'azalea_leaves', persistent=True, distance=1, waterlogged=False)
    lantern(11, F2 - 1, 10, hanging=True)
    lantern(13, F2 - 1, 5, hanging=True)


# ---------------------------------------------------------------------------
# 다락: 동쪽 = 굴뚝 침실, 서쪽 = 서재(책장 피라미드 + 마법부여대)
# ---------------------------------------------------------------------------
def ceiling_y(x, z):
    """다락 (x, z) 위 천장 판자의 높이."""
    for y in range(F2 + 1, F2 + 12):
        if (x, y, z) in B:
            return y
    return None


def build_attic_interior():
    y = F2 + 1
    for x in range(9, 13):  # 계단 구멍 난간 (북쪽 z=4 는 통로로 비워 둠)
        S(x, y, 7, 'spruce_fence')
    S(8, y, 5, 'spruce_fence')
    S(8, y, 6, 'spruce_fence')
    # 칸막이 x=7 (천장까지만)
    for z in range(1, 11):
        yy = y
        while (7, yy, z) not in B and yy < F2 + 6:
            S(7, yy, z, 'dark_oak_planks' if z not in (3, 8) else 'stripped_dark_oak_log',
              **({'axis': 'y'} if z in (3, 8) else {}))
            yy += 1
    door(7, y, 4, 'west', 'left', 'spruce_door')

    # 경사 천장에 꽃 핀 진달래 잎 (영상의 천장 덩굴)
    for x, z in ((1, 3), (3, 2), (5, 4), (2, 8), (4, 9), (6, 7), (9, 3), (12, 8), (14, 5),
                 (14, 6), (10, 11), (11, 12), (13, 9)):
        cy = ceiling_y(x, z)
        if cy and B[(x, cy, z)][0] == 'minecraft:dark_oak_planks':
            leaves(x, cy, z, flowering=(x + z) % 2 == 0)

    # 동쪽 다락: 굴뚝 양옆 화덕, 줄무늬 카펫, 흰 침대, 작업대 랜턴
    S(14, y, 4, 'furnace', facing='west', lit=True)
    S(14, y, 7, 'smoker', facing='west', lit=True)
    S(14, y, 5, 'crafting_table')
    lantern(14, y + 1, 5)
    for x, c in zip((9, 10, 11, 12), ('black', 'gray', 'light_gray', 'white')):
        S(x, y, 8, f'{c}_carpet')
        S(x, y, 3, f'{c}_carpet')
    S(13, y, 6, 'gray_carpet')
    bed(10, y, 10, 'east', 'white')
    S(11, y, 11, 'barrel', facing='up', open=False)
    candle(11, y + 1, 11, 2)
    chest(10, y, 12, 'north')
    S(13, y, 8, 'potted_fern')
    lantern(10, y + 1, 9, hanging=True)

    # 서쪽 다락: 서쪽 박공벽 따라 책장 피라미드, 마법부여대, 자수정 서랍, 검은 침대
    for z in range(1, 11):
        top = ceiling_y(0, z)
        for yy in range(y, (top or y)):
            if z in (5, 6) and yy in (y + 1, y + 2):
                continue  # 박공 창
            S(0, yy, z, 'bookshelf')
    for z in (5, 6):
        S(0, y, z, 'chiseled_bookshelf', facing='east',
          **{f'slot_{i}_occupied': True for i in range(6)})
    S(2, y, 5, 'enchanting_table')
    S(2, y, 6, 'red_carpet')
    for z in (4, 7):
        S(1, y, z, 'chiseled_bookshelf', facing='east',
          **{f'slot_{i}_occupied': (i % 2 == 0) for i in range(6)})
        amethyst(1, y + 1, z)
    bed(4, y, 3, 'west', 'black')
    bed(4, y, 8, 'west', 'black')
    S(5, y, 3, 'barrel', facing='up', open=False)
    S(6, y, 8, 'brewing_stand', has_bottle_0=True, has_bottle_1=True, has_bottle_2=False)
    S(5, y, 8, 'potted_allium')
    lantern(3, y + 2, 5, hanging=True)
    lantern(5, y + 2, 6, hanging=True)


# ---------------------------------------------------------------------------
# 외부: 간판, 노점, 길
# ---------------------------------------------------------------------------
def build_exterior():
    z = UZ1
    for x in (-2, -3, -4):
        log(x, F2 - 1, z, 'stripped_oak_log', axis='x')
    stair(-2, F2 - 2, z, 'oak_stairs', 'east', 'top')
    S(-3, F2 - 2, z, 'iron_bars')
    sign = {(-4, 8): 'red_concrete', (-3, 8): 'red_concrete', (-2, 8): 'red_concrete',
            (-4, 7): 'red_terracotta', (-3, 7): 'orange_terracotta', (-2, 7): 'red_terracotta',
            (-4, 6): 'red_concrete', (-3, 6): 'red_concrete', (-2, 6): 'red_concrete',
            (-3, 5): 'red_terracotta', (-2, 5): 'red_concrete'}
    for (x, y), m in sign.items():
        S(x, y, z, m)

    # 노점(정면 왼쪽): 통 2개 사이 가문비 판자 + 소품, 앞에 벤치
    for x in range(1, 6):
        S(x, 0, 15, 'coarse_dirt')
        S(x, 0, 16, 'coarse_dirt')
    barrel(1, F0, 15, 'south')
    barrel(5, F0, 15, 'south')
    for x in (2, 3, 4):
        S(x, F0, 15, 'spruce_slab', type='top', waterlogged=False)
    lantern(1, F0 + 1, 15)
    S(2, F0 + 1, 15, 'red_carpet')
    S(3, F0 + 1, 15, 'decorated_pot', facing='south', waterlogged=False)
    S(4, F0 + 1, 15, 'orange_carpet')
    S(5, F0 + 1, 15, 'potted_red_tulip')
    for x in (2, 3, 4):
        stair(x, F0, 16, 'spruce_stairs', 'south')

    # 흙길: 현관에서 남쪽으로
    for z in range(GZ1 + 3, GZ1 + 8):
        for x in range(8, 14):
            if (x, 0, z) in B:
                continue
            if 9 <= x <= 12 or h01(x, 0, z, 21) < .45:
                S(x, 0, z, 'dirt_path' if h01(x, 0, z, 9) < .55 else
                  ('coarse_dirt' if h01(x, 0, z, 10) < .6 else 'packed_mud'))
    for z in range(GZ1 + 2, GZ1 + 4):
        for x in range(9, 13):
            if (x, 0, z) not in B:
                S(x, 0, z, 'packed_mud')


# ---------------------------------------------------------------------------
# 마무리: 울타리·벽·철창 연결 상태 계산
# ---------------------------------------------------------------------------
NON_FULL = ('chest', 'stairs', 'slab', 'fence', 'trapdoor', 'door', 'pane', 'lantern', 'carpet', 'candle',
            'bed', 'campfire', 'banner', 'potted', 'flower_pot', 'amethyst', 'wall', 'iron_bars',
            'cake', 'brewing_stand', 'decorated_pot', 'pressure_plate', 'enchanting_table',
            'cauldron', 'leaves', 'lectern')


def solid(p):
    b = B.get(p)
    return b is not None and not any(t in b[0] for t in NON_FULL)


def connect():
    for (x, y, z), (name, props) in list(B.items()):
        short = name.split(':')[1]
        if short.endswith('_fence'):
            for d, (dx, dz) in DIRS.items():
                nb = B.get((x + dx, y, z + dz))
                props[d] = str(bool(nb and (nb[0].endswith('_fence') or solid((x + dx, y, z + dz))))).lower()
            props['waterlogged'] = 'false'
        elif short.endswith('_wall') and 'banner' not in short:
            for d, (dx, dz) in DIRS.items():
                nb = B.get((x + dx, y, z + dz))
                ok = nb and (nb[0].endswith('_wall') or solid((x + dx, y, z + dz)))
                props[d] = 'low' if ok else 'none'
            props['up'] = 'true'
            props['waterlogged'] = 'false'
        elif short == 'iron_bars':
            for d, (dx, dz) in DIRS.items():
                nb = B.get((x + dx, y, z + dz))
                props[d] = str(bool(nb and (nb[0].endswith('iron_bars') or solid((x + dx, y, z + dz))))).lower()
            props['waterlogged'] = 'false'


def build():
    build_foundation()
    build_ground_openings()
    build_jetty_corbels()
    build_upper_floor()
    build_upper_walls()
    build_attic_floor()
    H, low = build_roof()
    build_gables_and_ceiling(H, low)
    build_chimney()
    build_ground_interior()
    build_upper_interior()
    build_attic_interior()
    build_exterior()
    connect()


# ---------------------------------------------------------------------------
# NBT / 파일 출력
# ---------------------------------------------------------------------------
class Tag:
    def __init__(self, tid, value):
        self.tid, self.value = tid, value


def Byte(v): return Tag(1, v)
def Short(v): return Tag(2, v)
def Int(v): return Tag(3, v)
def Long(v): return Tag(4, v)
def String(v): return Tag(8, v)
def ByteArray(v): return Tag(7, v)
def IntArray(v): return Tag(11, v)
def LongArray(v): return Tag(12, v)
def Compound(d): return Tag(10, d)
def List(tid, items): return Tag(9, (tid, items))


def _payload(out, t):
    tid, v = t.tid, t.value
    if tid == 1:
        out.write(struct.pack('>b', v))
    elif tid == 2:
        out.write(struct.pack('>h', v))
    elif tid == 3:
        out.write(struct.pack('>i', v))
    elif tid == 4:
        out.write(struct.pack('>q', v))
    elif tid == 7:
        out.write(struct.pack('>i', len(v)))
        out.write(bytes(v))
    elif tid == 8:
        b = v.encode('utf-8')
        out.write(struct.pack('>H', len(b)))
        out.write(b)
    elif tid == 9:
        etid, items = v
        out.write(struct.pack('>bi', etid if items else (etid or 0), len(items)))
        for it in items:
            _payload(out, it)
    elif tid == 10:
        for k, sub in v.items():
            out.write(struct.pack('>b', sub.tid))
            _payload(out, String(k))
            _payload(out, sub)
        out.write(b'\x00')
    elif tid == 11:
        out.write(struct.pack('>i', len(v)))
        out.write(struct.pack(f'>{len(v)}i', *v))
    elif tid == 12:
        out.write(struct.pack('>i', len(v)))
        out.write(struct.pack(f'>{len(v)}q', *v))


def write_nbt(path, root, name=''):
    buf = io.BytesIO()
    buf.write(b'\x0a')
    _payload(buf, String(name))
    _payload(buf, root)
    with gzip.open(path, 'wb') as f:
        f.write(buf.getvalue())


BE_IDS = {'chest': 'chest', 'barrel': 'barrel', 'furnace': 'furnace', 'smoker': 'smoker',
          'campfire': 'campfire', 'decorated_pot': 'decorated_pot', 'enchanting_table': 'enchanting_table',
          'brewing_stand': 'brewing_stand', 'chiseled_bookshelf': 'chiseled_bookshelf',
          'purple_wall_banner': 'banner'}


def block_entity_id(name):
    short = name.split(':')[1]
    if short.endswith('_bed'):
        return 'minecraft:bed'
    if short in BE_IDS:
        return 'minecraft:' + BE_IDS[short]
    return None


def normalized():
    xs = [p[0] for p in B]
    ys = [p[1] for p in B]
    zs = [p[2] for p in B]
    ox, oy, oz = min(xs), min(ys), min(zs)
    size = (max(xs) - ox + 1, max(ys) - oy + 1, max(zs) - oz + 1)
    blocks = {(x - ox, y - oy, z - oz): v for (x, y, z), v in B.items()}
    return size, blocks


def state_key(name, props):
    return (name, tuple(sorted(props.items())))


def write_litematic(path, size, blocks):
    sx, sy, sz = size
    palette = [('minecraft:air', ())]
    index = {palette[0]: 0}
    vol = sx * sy * sz
    data = [0] * vol
    for (x, y, z), (name, props) in blocks.items():
        k = state_key(name, props)
        if k not in index:
            index[k] = len(palette)
            palette.append(k)
        data[(y * sz + z) * sx + x] = index[k]
    bits = max(2, (len(palette) - 1).bit_length())
    acc = 0
    for i, v in enumerate(data):
        acc |= v << (i * bits)
    nlongs = (vol * bits + 63) // 64
    longs = []
    for i in range(nlongs):
        u = (acc >> (64 * i)) & 0xFFFFFFFFFFFFFFFF
        longs.append(u - (1 << 64) if u >= 1 << 63 else u)
    pal_nbt = []
    for name, props in palette:
        c = {'Name': String(name)}
        if props:
            c['Properties'] = Compound({k: String(v) for k, v in props})
        pal_nbt.append(Compound(c))
    tes = []
    for (x, y, z), (name, _) in sorted(blocks.items()):
        be = block_entity_id(name)
        if be:
            tes.append(Compound({'x': Int(x), 'y': Int(y), 'z': Int(z), 'id': String(be)}))
    now = int(time.time() * 1000)
    total = sum(1 for _ in blocks)
    root = Compound({
        'Version': Int(6),
        'SubVersion': Int(1),
        'MinecraftDataVersion': Int(DATA_VERSION),
        'Metadata': Compound({
            'Name': String('Cozy Tavern (JpCore)'),
            'Author': String('skinjigi'),
            'Description': String('JpCore "Building a Cozy Minecraft Tavern" 외관 + 인테리어 재현'),
            'RegionCount': Int(1),
            'TotalBlocks': Int(total),
            'TotalVolume': Int(vol),
            'TimeCreated': Long(now),
            'TimeModified': Long(now),
            'EnclosingSize': Compound({'x': Int(sx), 'y': Int(sy), 'z': Int(sz)}),
        }),
        'Regions': Compound({
            'Tavern': Compound({
                'Position': Compound({'x': Int(0), 'y': Int(0), 'z': Int(0)}),
                'Size': Compound({'x': Int(sx), 'y': Int(sy), 'z': Int(sz)}),
                'BlockStatePalette': List(10, pal_nbt),
                'BlockStates': LongArray(longs),
                'TileEntities': List(10, tes),
                'Entities': List(10, []),
                'PendingBlockTicks': List(10, []),
                'PendingFluidTicks': List(10, []),
            })
        }),
    })
    write_nbt(path, root)
    return len(palette), total


def write_sponge(path, size, blocks):
    sx, sy, sz = size
    palette = {'minecraft:air': 0}
    data = [0] * (sx * sy * sz)
    for (x, y, z), (name, props) in blocks.items():
        s = name + ('[' + ','.join(f'{k}={v}' for k, v in sorted(props.items())) + ']' if props else '')
        if s not in palette:
            palette[s] = len(palette)
        data[x + z * sx + y * sx * sz] = palette[s]
    out = bytearray()
    for v in data:
        while True:
            b = v & 0x7F
            v >>= 7
            if v:
                out.append(b | 0x80)
            else:
                out.append(b)
                break
    bes = []
    for (x, y, z), (name, _) in sorted(blocks.items()):
        be = block_entity_id(name)
        if be:
            bes.append(Compound({'Pos': IntArray([x, y, z]), 'Id': String(be)}))
    root = Compound({
        'Version': Int(2),
        'DataVersion': Int(DATA_VERSION),
        'Width': Short(sx), 'Height': Short(sy), 'Length': Short(sz),
        'PaletteMax': Int(len(palette)),
        'Palette': Compound({k: Int(v) for k, v in palette.items()}),
        'BlockData': ByteArray(out),
        'BlockEntities': List(10, bes),
        'Offset': IntArray([0, 0, 0]),
        'Metadata': Compound({'WEOffsetX': Int(0), 'WEOffsetY': Int(0), 'WEOffsetZ': Int(0)}),
    })
    write_nbt(path, root, 'Schematic')


if __name__ == '__main__':
    build()
    size, blocks = normalized()
    npal, total = write_litematic(OUT / 'cozy_tavern.litematic', size, blocks)
    write_sponge(OUT / 'cozy_tavern.schem', size, blocks)
    print(f'size {size[0]}x{size[1]}x{size[2]}, blocks {total}, palette {npal}')
