"""Convert PLATEAU (MLIT) LOD1 buildings + OpenStreetMap features around
Koiwa Station north exit into a compact JSON for the game.

Coordinates: local metres (decimetre ints) centred on the north exit;
x = east, z = north.  Run with the venv in /workspace/koiwa_data.
"""
import glob, json, math, sys
from lxml import etree
from pyproj import Transformer
from shapely.geometry import Polygon, LineString, Point, MultiPolygon, box
from shapely.ops import unary_union
from shapely import affinity
import mapbox_earcut as earcut
import numpy as np

DATA = '/workspace/koiwa_data'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/workspace/paper-wonderland/public/data/koiwa.json'
LAT0, LON0 = 35.7332733, 139.881407   # OSM node "北口" (railway=train_station_entrance)
R = 50.0                                # metres (walkable radius; prototype sample)
RC = 72.0                               # clip radius for scenery
tr = Transformer.from_crs('EPSG:6668', 'EPSG:6677', always_xy=True)  # JGD2011 -> plane rect. IX
OX, OY = tr.transform(LON0, LAT0)
def P(lat, lon):
    x, y = tr.transform(lon, lat)
    return (x - OX, y - OY)

NS = {'gml': 'http://www.opengis.net/gml', 'bldg': 'http://www.opengis.net/citygml/building/2.0'}
CLIP = Point(0, 0).buffer(RC, 64)

# ---------------------------------------------------------------- PLATEAU
blds = []
files = sorted(glob.glob(DATA + '/p4[67]/*_bldg_*.gml'))
total_seen = 0
for f in files:
    for ev, el in etree.iterparse(f, tag='{%s}Building' % NS['bldg'], huge_tree=True):
        total_seen += 1
        h = el.find('bldg:measuredHeight', NS)
        pl = el.find('bldg:lod0RoofEdge//gml:exterior//gml:posList', NS)
        if pl is None:
            pl = el.find('bldg:lod1Solid//gml:exterior//gml:posList', NS)
        sol = el.find('bldg:lod1Solid//gml:posList', NS)
        if pl is None or h is None:
            el.clear(); continue
        v = [float(t) for t in pl.text.split()]
        pts = [P(v[i], v[i + 1]) for i in range(0, len(v), 3)]
        try:
            height = float(h.text)
        except Exception:
            height = 6.0
        if height <= 0 or height > 300: height = 6.0
        el.clear()
        cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
        if math.hypot(cx, cy) > RC: continue
        poly = Polygon(pts)
        if not poly.is_valid: poly = poly.buffer(0)
        if poly.is_empty: continue
        if isinstance(poly, MultiPolygon): poly = max(poly.geoms, key=lambda g: g.area)
        poly = poly.simplify(0.35, preserve_topology=True)
        if poly.area < 8: continue
        poly = Polygon(poly.exterior.coords)  # drop holes
        if not poly.exterior.is_ccw: poly = Polygon(list(poly.exterior.coords)[::-1])
        blds.append((poly, height))
print('PLATEAU buildings seen', total_seen, 'kept', len(blds), file=sys.stderr)

def tri(poly):
    """earcut a polygon (with holes) -> (flat verts [x,z..], indices)"""
    rings = [list(poly.exterior.coords)[:-1]] + [list(r.coords)[:-1] for r in poly.interiors]
    verts = np.array([p for r in rings for p in r], dtype=np.float64).reshape(-1, 2)
    ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
    idx = earcut.triangulate_float64(verts, ends)
    return verts, idx

def dm(v): return int(round(v * 10))

out_b = []
for poly, height in blds:
    ring = list(poly.exterior.coords)[:-1]
    verts, idx = tri(Polygon(ring))
    if len(idx) == 0: continue
    flat = []
    for x, y in ring: flat += [dm(x), dm(y)]
    out_b.append([dm(height)] + [len(ring)] + flat + [len(idx)] + [int(i) for i in idx])

# ---------------------------------------------------------------- OSM
osm = json.load(open(DATA + '/osm.json'))
def line(e): return [P(p['lat'], p['lon']) for p in e['geometry']]
W = {'trunk': 16, 'primary': 14, 'secondary': 11, 'tertiary': 9, 'unclassified': 6.5, 'residential': 5,
     'living_street': 4.5, 'service': 4, 'pedestrian': 6, 'footway': 2.5, 'path': 2.5, 'cycleway': 2.5,
     'steps': 2.5, 'primary_link': 8, 'secondary_link': 7, 'tertiary_link': 6}
roads, major, rails_v, rails_g, platforms, areas, water, river = [], [], [], [], [], {}, [], []
names = []
station = None
for e in osm['elements']:
    t = e.get('tags', {})
    if e['type'] == 'way' and 'geometry' in e:
        g = line(e)
        if len(g) < 2: continue
        hw = t.get('highway')
        if hw in W and t.get('area') != 'yes' and t.get('tunnel') != 'yes':
            if t.get('footway') in ('sidewalk', 'crossing'): continue
            ls = LineString(g)
            roads.append(ls.buffer(W[hw] / 2, cap_style='round', join_style='round', resolution=4))
            if hw in ('trunk', 'primary', 'secondary', 'tertiary'): major.append((ls, W[hw]))
            if t.get('name') and hw not in ('footway', 'steps', 'service'): names.append((t['name'], ls))
        elif t.get('railway') in ('rail',) and t.get('service') is None:
            (rails_v if t.get('bridge') in ('viaduct', 'yes') or t.get('layer') in ('1', '2') else rails_g).append(LineString(g))
        elif t.get('building') == 'train_station' and math.hypot(*g[0]) < 300:
            station = Polygon(g).buffer(0)
        elif t.get('railway') == 'platform' and g[0] == g[-1] and len(g) > 3:
            platforms.append(Polygon(g))
        elif t.get('waterway') in ('river', 'canal', 'stream', 'ditch'):
            river.append(LineString(g).buffer({'river': 12, 'canal': 8}.get(t['waterway'], 3) / 2))
        elif g[0] == g[-1] and len(g) > 3 and 'building' not in t:
            kind = None
            if t.get('natural') == 'water': kind = 'water'
            elif t.get('leisure') in ('park', 'garden', 'playground') or t.get('landuse') in ('grass', 'recreation_ground'): kind = 'park'
            elif t.get('leisure') == 'pitch': kind = 'pitch'
            elif t.get('amenity') in ('school', 'kindergarten'): kind = 'school'
            elif t.get('amenity') == 'place_of_worship' or t.get('landuse') == 'cemetery': kind = 'temple'
            if kind:
                pg = Polygon(g).buffer(0)
                if not pg.is_empty: areas.setdefault(kind, []).append(pg)

def mesh(geoms, simplify=0.3, clip=CLIP):
    u = unary_union(geoms).intersection(clip).simplify(simplify, preserve_topology=True)
    polys = [u] if isinstance(u, Polygon) else [g for g in getattr(u, 'geoms', []) if isinstance(g, Polygon)]
    V, I = [], []
    for pg in polys:
        if pg.area < 1: continue
        verts, idx = tri(pg)
        base = len(V) // 2
        for x, y in verts: V += [dm(x), dm(y)]
        I += [int(i) + base for i in idx]
    return {'v': V, 'i': I}

clip_big = Point(0, 0).buffer(RC + 8, 64)
res = {
    'origin': {'lat': LAT0, 'lon': LON0, 'crs': 'EPSG:6677 local metres, decimetre ints, x=east z=north'},
    'radius': R,
    'buildings': out_b,
    'roads': mesh(roads, 0.4, clip_big),
    'areas': {k: mesh(v, 0.4) for k, v in areas.items()},
    'water': mesh(river + areas.get('water', []), 0.5) if river or areas.get('water') else {'v': [], 'i': []},
}
# railway viaducts: centre lines (for deck + pillars) clipped
def lines_out(ls_list, clip):
    out = []
    for ls in ls_list:
        c = ls.intersection(clip)
        parts = [c] if isinstance(c, LineString) else [g for g in getattr(c, 'geoms', []) if isinstance(g, LineString)]
        for p in parts:
            if p.length < 2: continue
            p = p.simplify(0.5)
            out.append([dm(v) for xy in p.coords for v in xy])
    return out
res['railViaduct'] = lines_out(rails_v, clip_big)
res['railGround'] = lines_out(rails_g, clip_big)
deck = unary_union([l.buffer(3.2, cap_style='flat') for l in rails_v]).intersection(clip_big)
res['viaductDeck'] = mesh([deck], 0.5, clip_big)
sp = station.simplify(0.3)
if not sp.exterior.is_ccw: sp = Polygon(list(sp.exterior.coords)[::-1])
res['station'] = [v for xy in list(sp.exterior.coords)[:-1] for v in (dm(xy[0]), dm(xy[1]))]
res['platforms'] = mesh(platforms, 0.2) if platforms else {'v': [], 'i': []}
# major road centre lines (for dashed paint)
res['centerlines'] = lines_out([l for l, w in major if w >= 9], CLIP)

# ---------------------------------------------------------------- spots
bunion = unary_union([b for b, _ in blds])
road_u = unary_union(roads)
station_poly = station
def free(x, y, r=2.5, need_road=True):
    """nearest point (on a road if need_road) that is clear of buildings and the station"""
    p = Point(x, y)
    ok = lambda q: (road_u.contains(q) or not need_road) and not bunion.intersects(q.buffer(r)) and not station_poly.intersects(q.buffer(r))
    if ok(p): return (x, y)
    best = None
    for rad in np.arange(1, 60, 1.0):
        for a in np.linspace(0, 2 * math.pi, 24, endpoint=False):
            q = Point(x + rad * math.cos(a), y + rad * math.sin(a))
            if ok(q):
                return (q.x, q.y)
    return (x, y)
spots = {
    'start':   (12, 10, 'こいわえき きたぐち'),
    'npc':     (22, 7, 'えきまえ ひろば'),
    'star1':   (-22, 32, 'きたぐちの みち'),
    'star2':   (30, 24, 'イトーヨーカドーの まえ'),
    'star3':   (-28, -6, 'こうかせんの そば'),
}
res['spots'] = {}
for k, (x, y, label) in spots.items():
    fx, fy = free(x, y, 2.0 if k in ('start', 'npc') else 1.6, False)
    res['spots'][k] = {'x': round(fx, 1), 'z': round(fy, 1), 'label': label}
    print(k, (x, y), '->', (round(fx, 1), round(fy, 1)), file=sys.stderr)

# street name labels for a few named roads near the station
lab = []
seen = set()
for n, ls in names:
    if n in seen: continue
    mid = ls.interpolate(0.5, normalized=True)
    if math.hypot(mid.x, mid.y) < 60 and ls.length > 20:
        seen.add(n); lab.append({'name': n, 'x': round(mid.x, 1), 'z': round(mid.y, 1)})
res['labels'] = lab
res['scale'] = 1.0
res['credits'] = ['「3D都市モデル（Project PLATEAU）東京都23区（2020年度）」（国土交通省）を加工して作成', '© OpenStreetMap contributors (ODbL)']
res['stats'] = {'buildings': len(out_b), 'plateauSeen': total_seen}
json.dump(res, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
import os
print('wrote', OUT, os.path.getsize(OUT), 'bytes; buildings', len(out_b), file=sys.stderr)
