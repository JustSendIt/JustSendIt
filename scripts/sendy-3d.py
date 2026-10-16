# Sendy's look on the site, rendered from the 3D model with the camera, lights and pose rig of the marketing videos
# (the 2026-10-14 referral-gate video: ~/Desktop/Sendy/referral-gate-30s/blender/render_sendy.py), so the rocket in the
# corner is the one in the videos, and his reactions are the faces he pulls in them.
# (It replaces scripts/sendy-sprite.mjs, which keyed the asset pack's flat navy-backed renders: a different, paler look.)
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b ~/Desktop/Sendy3D/model/Sendy.blend --python scripts/sendy-3d.py -- <workDir> [outDir]
#
# Writes to outDir (default: public/assets next to this script):
#   sendy-idle.png        the idle loop: 30 square 192px frames stacked (the model's own Idle clip, every other frame)
#   sendy.png             a 256px still of the first idle frame (the chat header)
#   sendy-act-<id>.webp   one strip per reaction: square cells side by side, each the idle box widened (by that reaction's
#                         own k) about the same centre, so a raised arm has room and the body sits exactly where the
#                         idle frame has it
#   sendy-acts.json       per reaction: its box (k), its cells in play order, frames a second, and the cell shown without motion
# Renders are cached in workDir by pose (a re-run renders only what changed). Everything is drawn at 1260px and
# brought down by an exact area average in linear light, so edges stay soft at 192px.
import bpy, sys, os, math, json, time, hashlib
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
WORK = argv[0] if argv else '/tmp/sendy-3d'
OUT = argv[1] if len(argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'assets')
RES, SAMPLES, ORTHO, CAMZ = 1260, 16, 8.0, -0.6         # the video's camera with a wider frame (157.5px a unit either way): a stretched flame stays in it
IDLE_PX, STILL_PX, WEBP_Q = 192, 256, 82
# renders are cached per stage: the camera, lights, materials, rig and poses (this script above part 3) and the model file —
# change any of them and nothing old is reused
_me = sys.argv[sys.argv.index('--python') + 1] if '--python' in sys.argv else __file__
_src = open(_me, 'rb').read(); _src = _src[:_src.index(b'\n# ---------- 3.')]   # the heading at a line start, not this line's own search text
_blend = bpy.data.filepath; _bs = os.stat(_blend) if _blend and os.path.exists(_blend) else None
STAGE = hashlib.sha1(_src + repr((RES, ORTHO, CAMZ, SAMPLES, _bs and _bs.st_size, _bs and int(_bs.st_mtime))).encode()).hexdigest()[:12]
WORK = os.path.join(WORK, 'stage-' + STAGE)
for d in ('idle', 'act'): os.makedirs(os.path.join(WORK, d), exist_ok=True)

# ---------- the video's stage: ortho camera, area lights, Standard view (AgX washes the lime out) ----------
sc = bpy.context.scene; O = bpy.data.objects
sc.render.engine = 'BLENDER_EEVEE_NEXT'
sc.render.resolution_x = sc.render.resolution_y = RES; sc.render.resolution_percentage = 100
sc.render.film_transparent = True
sc.eevee.taa_render_samples = SAMPLES
sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'; sc.view_settings.exposure = 0; sc.view_settings.gamma = 1
sc.display_settings.display_device = 'sRGB'
w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.03, 0.045, 0.02, 1); bg.inputs[1].default_value = 0.9
cd = bpy.data.cameras.new('Cam'); cd.type = 'ORTHO'; cd.ortho_scale = ORTHO
cam = bpy.data.objects.new('Cam', cd); sc.collection.objects.link(cam); sc.camera = cam
cam.location = (0, -12, CAMZ); cam.rotation_euler = (math.radians(90), 0, 0)
import mathutils
def light(name, kind, loc, energy, color, size=1.0):
    ld = bpy.data.lights.new(name, kind); ld.energy = energy; ld.color = color
    if kind == 'AREA': ld.size = size
    lo = bpy.data.objects.new(name, ld); sc.collection.objects.link(lo); lo.location = loc
    lo.rotation_euler = (mathutils.Vector((0, 0, 0)) - mathutils.Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
light('Key', 'AREA', (-4.5, -6, 5), 950, (1, 0.97, 0.9), 4)
light('Fill', 'AREA', (5, -5, 0.5), 280, (0.75, 0.85, 1.0), 5)
light('RimG', 'AREA', (3.5, 4.5, 3), 1000, (0.72, 1.0, 0.25), 3)
light('RimL', 'AREA', (-4, 4, -1), 450, (1.0, 0.75, 0.35), 3)
flameL = bpy.data.lights.new('FlameL', 'POINT'); flameL.color = (1.0, 0.55, 0.15); flameL.energy = 220
fo = bpy.data.objects.new('FlameL', flameL); sc.collection.objects.link(fo); fo.location = (0, -0.8, -2.3)
for mn, col, st in (('Sendy_Flame', (1.0, 0.144, 0.002, 1), 1.0), ('Sendy_FlameCore', (1.0, 0.515, 0.007, 1), 1.6)):
    b = bpy.data.materials[mn].node_tree.nodes['Principled BSDF']
    b.inputs['Emission Color'].default_value = col; b.inputs['Emission Strength'].default_value = st

def render(path):
    if os.path.exists(path): return False
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'; sc.render.image_settings.color_depth = '16'
    sc.render.image_settings.compression = 15
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return True

# ---------- 1. the idle loop: the model's own Idle clip (60 frames at 30 fps), every other frame ----------
t0 = time.time(); n = 0
IDLE = []
for i, f in enumerate(range(1, 61, 2)):
    sc.frame_set(f)
    p = os.path.join(WORK, 'idle', '%02d.png' % i); IDLE.append(p)
    n += render(p)
print('IDLE rendered', n, '%.1fs' % (time.time() - t0), flush=True)

# ---------- 2. the reactions: the video's pose rig, posed from the first idle frame so they start where he is ----------
sc.frame_set(1)
NAMES = ['Sendy', 'Sendy_Body', 'Sendy_Shoulder_L', 'Sendy_Shoulder_R', 'Sendy_Brow_L', 'Sendy_Brow_R', 'Sendy_Eye_L', 'Sendy_Eye_R',
         'Sendy_Pupil_L', 'Sendy_Pupil_R', 'Sendy_Mouth', 'Sendy_Flame']
base = {k: (tuple(O[k].location), tuple(O[k].rotation_euler), tuple(O[k].scale)) for k in NAMES}
for o in O:
    if o.animation_data: o.animation_data_clear()
for k in NAMES:
    O[k].location, O[k].rotation_euler, O[k].scale = base[k]
print('BASE shoulders (deg)', [round(math.degrees(v), 1) for v in base['Sendy_Shoulder_L'][1]], [round(math.degrees(v), 1) for v in base['Sendy_Shoulder_R'][1]], flush=True)
R = math.radians
REST = dict(yaw=0, pitch=0, roll=0, squash=0, armL=0, armR=0, armLf=0, armRf=0, brow=0, browUp=0, shut=0, wink=0,
            lookX=0, lookY=0, mouth=1, mouthW=1, flame=1, flameW=1)
def pose(p):
    g = lambda k: p.get(k, REST[k])
    b = base['Sendy']; O['Sendy'].rotation_euler = (b[1][0] + R(g('pitch')), b[1][1] + R(g('roll')), b[1][2] + R(g('yaw')))
    sq = g('squash'); b = base['Sendy_Body']                    # +: squashed flat, -: stretched tall
    O['Sendy_Body'].scale = (b[2][0] * (1 + 0.45 * sq), b[2][1] * (1 + 0.45 * sq), b[2][2] * (1 - sq))
    # arms, as the video rig: raise 44 = level, ~105 = a V, 135 = straight up; fwd swings the arm toward the camera
    b = base['Sendy_Shoulder_L']; O['Sendy_Shoulder_L'].rotation_euler = (b[1][0], b[1][1] + R(g('armL')), b[1][2] + R(g('armLf')))
    b = base['Sendy_Shoulder_R']; O['Sendy_Shoulder_R'].rotation_euler = (b[1][0], b[1][1] - R(g('armR')), b[1][2] - R(g('armRf')))
    bt, bu = g('brow'), g('browUp')                              # brow > 0: raised outer ends (happy)
    for side, sgn in (('L', 1), ('R', -1)):
        b = base['Sendy_Brow_' + side]
        O['Sendy_Brow_' + side].rotation_euler = (b[1][0], b[1][1] + sgn * R(-bt), b[1][2])
        O['Sendy_Brow_' + side].location = (b[0][0], b[0][1], b[0][2] + 0.14 * bu)
        e = base['Sendy_Eye_' + side]
        shut = max(g('shut'), g('wink') if side == 'L' else 0)  # a wink closes his left eye only
        O['Sendy_Eye_' + side].scale = (e[2][0], e[2][1], e[2][2] * (1 - 0.92 * shut))
        pp = base['Sendy_Pupil_' + side]
        O['Sendy_Pupil_' + side].location = (pp[0][0] + 0.13 * g('lookX'), pp[0][1], pp[0][2] + 0.13 * g('lookY'))
    m = base['Sendy_Mouth']
    O['Sendy_Mouth'].scale = (m[2][0] * g('mouthW'), m[2][1], m[2][2] * (0.22 + 0.78 * g('mouth')))
    f = base['Sendy_Flame']
    O['Sendy_Flame'].scale = (f[2][0] * g('flameW'), f[2][1] * g('flameW'), f[2][2] * g('flame'))
    flameL.energy = 60 + 160 * g('flame')

# Each reaction: keys [time s, {what changes}, ease] — a value arrives AT its key, from the key before that set it.
# Every one ends back at rest by DUR (held until HOLD, then eased home), so the idle loop takes over without a jump.
# Only happy faces (owner, 2026-10-15: "never negative"); the poses are the video's own moments, named beside each.
DUR, HOLD = 1.2, 0.92
ACTS = [
    # delight: the brows-up pop of the drop (beats 2 and 7)
    ('grin', 15, [(0.12, {'squash': 0.1}, 'io'), (0.3, {'squash': -0.12, 'brow': 20, 'browUp': 1, 'mouthW': 1.15, 'pitch': 8}, 'back'),
                  (0.48, {'squash': 0.05}, 'io'), (0.62, {'squash': 0}, 'io')], {}),
    # the wink at the end card (beat 65), with the raised fist
    ('wink', 15, [(0.22, {'armL': 117, 'roll': 5, 'brow': 12, 'browUp': 0.5, 'wink': 0}, 'back'), (0.38, {'wink': 1}, 'io'),
                  (0.75, {'wink': 1}, 'io'), (0.88, {'wink': 0}, 'io')], {}),
    # a wave (beat 6), turned toward whoever is there
    ('wave', 15, [(0.2, {'armR': 122, 'armRf': -38, 'yaw': 14, 'brow': 12, 'browUp': 0.6}, 'back'), (0.36, {'armR': 96}, 'io'),
                  (0.52, {'armR': 128}, 'io'), (0.68, {'armR': 98}, 'io'), (0.84, {'armR': 124}, 'io')], {}),
    # eyes squeezed shut in a happy squint, leaning in (beat 16)
    ('bliss', 15, [(0.26, {'shut': 0.85, 'mouth': 0.45, 'mouthW': 0.6, 'pitch': 12, 'brow': 14, 'browUp': 0.5, 'roll': -5}, 'io'),
                   (0.6, {'roll': 5}, 'io'), (0.86, {'roll': 0}, 'io')], {}),
    # a fist pumped twice (beat 32)
    ('cheer', 15, [(0.14, {'squash': 0.1, 'armR': 40}, 'io'), (0.32, {'armR': 150, 'armL': 22, 'squash': -0.1, 'brow': 15, 'browUp': 0.8, 'mouthW': 1.1}, 'back'),
                   (0.5, {'armR': 122}, 'io'), (0.66, {'armR': 150}, 'io'), (0.8, {'armR': 128}, 'io')], {}),
    # both arms up, flame roaring: JUST $SEND IT (beat 60.5)
    ('sendit', 15, [(0.14, {'squash': 0.14, 'armL': 28, 'armR': 28}, 'io'), (0.34, {'armL': 140, 'armR': 140, 'squash': -0.14, 'flame': 1.6, 'flameW': 1.2, 'brow': 18, 'browUp': 1, 'mouthW': 1.12}, 'back'),
                    (0.58, {'flame': 1.3}, 'io'), (0.78, {'flame': 1.6}, 'io')], {}),   # a longer flame runs off the frame
    # a curious look round, landing on you with brows up (beats 4-5)
    ('peek', 15, [(0.2, {'lookX': -0.85, 'yaw': -14, 'brow': 6, 'browUp': 0.3}, 'io'), (0.44, {'lookX': 0.8, 'yaw': 12}, 'io'),
                  (0.68, {'lookX': 0, 'yaw': 0, 'brow': 17, 'browUp': 0.9, 'squash': -0.06}, 'back')], {}),
    # pointing up, eyes following (beat 19)
    ('point', 15, [(0.26, {'armR': 142, 'armL': 30, 'brow': 18, 'browUp': 1, 'squash': -0.1, 'lookY': 0.7, 'lookX': 0.25}, 'back'),
                   (0.5, {'squash': 0.04}, 'io'), (0.64, {'squash': 0}, 'io')], {}),
    # arms in a V, brows up: the videos' arms-up wins (beats 42-45) with both arms
    ('vee', 15, [(0.14, {'squash': 0.12}, 'io'), (0.32, {'armL': 105, 'armR': 105, 'squash': -0.1, 'brow': 16, 'browUp': 0.9, 'mouthW': 1.1}, 'back'),
                 (0.5, {'squash': 0.05}, 'io'), (0.62, {'squash': 0}, 'io')], {}),
    # a full turn on the spot (the video's spins), arms out
    ('twirl', 20, [(0.12, {'squash': 0.08, 'armL': 40, 'armR': 40}, 'io'), (0.84, {'yaw': 360, 'squash': -0.05, 'armL': 70, 'armR': 70, 'brow': 14, 'browUp': 0.7}, 'io')], {'yaw': 360}),
    # a giggle: the videos' squint half shut, with the open grin, rocking side to side (put together from those two faces)
    ('giggle', 15, [(0.15, {'shut': 0.6, 'brow': 14, 'browUp': 0.6, 'mouthW': 1.1, 'roll': 7, 'squash': 0.05}, 'io'), (0.3, {'roll': -7, 'squash': -0.03}, 'io'),
                    (0.45, {'roll': 6, 'squash': 0.05}, 'io'), (0.6, {'roll': -5, 'squash': -0.02}, 'io'), (0.76, {'roll': 3, 'squash': 0}, 'io')], {}),
    # a hug: the arms swung toward the camera (beat 49) with the happy squint (beat 16), put together from those two
    ('hug', 15, [(0.3, {'armL': 55, 'armR': 55, 'armLf': 65, 'armRf': 65, 'shut': 0.8, 'mouth': 0.6, 'mouthW': 0.8, 'pitch': 10, 'brow': 14, 'browUp': 0.6}, 'io')], {}),
]
def ease(kind, u):
    if kind == 'hold': return 0.0 if u < 1 else 1.0
    if kind == 'out': return 1 - (1 - u) ** 3
    if kind == 'back': c = 1.70158; v = u - 1; return 1 + (c + 1) * v ** 3 + c * v ** 2
    return u * u * u * (u * (u * 6 - 15) + 10)            # io: smootherstep
def sample(keys, end, t):
    p = {}
    props = set(k for _, d, _ in keys for k in d)
    for k in props:
        track = [(0.0, REST[k], 'io')] + [(tk, d[k], e) for tk, d, e in keys if k in d]
        last = track[-1]
        if last[0] < HOLD: track.append((HOLD, last[1], 'io'))
        track.append((DUR, end.get(k, REST[k]), 'io'))
        v = track[0][1]
        for (ta, va, _), (tb, vb, eb) in zip(track, track[1:]):
            if t >= tb: v = vb; continue
            if t >= ta: v = va + (vb - va) * ease(eb, (t - ta) / (tb - ta)); break
        p[k] = round(v, 3) + 0.0                         # + 0.0: a -0.0 would hash apart from 0.0 and render the rest pose twice
    return p
ACT = {}
t0 = time.time(); n = 0
for aid, fps, keys, end in ACTS:
    frames = []
    for i in range(int(round(DUR * fps)) + 1):
        p = sample(keys, end, i / fps)
        if 'yaw' in p: p['yaw'] = round(p['yaw'] % 360, 3)       # a whole turn is no turn: the last frame is the rest pose
        h = hashlib.sha1(json.dumps(p, sort_keys=True).encode()).hexdigest()[:14]
        path = os.path.join(WORK, 'act', h + '.png')
        if not os.path.exists(path): pose(p); n += render(path)
        frames.append((h, p))
    ACT[aid] = (fps, frames)
print('ACTS rendered', n, '%.1fs' % (time.time() - t0), flush=True)

# ---------- 3. one box for all of it: the idle loop's union, square, about its centre ----------
def load(path):
    im = bpy.data.images.load(path, check_existing=False)
    w, h = im.size
    a = np.empty(w * h * 4, dtype=np.float32); im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(h, w, 4)[::-1]                       # top row first
def bbox(px):
    ys, xs = np.nonzero(px[..., 3] > 0.01)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
idle_px = [load(p) for p in IDLE]
bb = np.array([bbox(px) for px in idle_px])
x0, y0, x1, y1 = bb[:, 0].min(), bb[:, 1].min(), bb[:, 2].max(), bb[:, 3].max()
cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
S = max(x1 - x0, y1 - y0) * 1.03                          # a hair of room so the glow never meets the edge
ext = 0.0                                                 # how far any reaction reaches from that centre
act_px = {}; reach = {}
for aid, (fps, frames) in ACT.items():
    for h, _ in frames:
        if h not in act_px: act_px[h] = load(os.path.join(WORK, 'act', h + '.png'))
        ax0, ay0, ax1, ay1 = bbox(act_px[h])
        if min(ax0, ay0) <= 0 or ax1 >= RES or ay1 >= RES: raise SystemExit('reaction %s runs off the render frame' % aid)
        e = max(cx - ax0, ax1 - cx, cy - ay0, ay1 - cy); reach[aid] = max(reach.get(aid, 0), e); ext = max(ext, e)
print('REACH', {k: round(v / (S / 2), 3) for k, v in reach.items()}, flush=True)
# each reaction gets the box it needs: one long flame must not make every strip mostly empty
def act_px_for(aid): return int(math.ceil(IDLE_PX * max(1.0, reach[aid] * 1.02 / (S / 2)) / 8) * 8)
print('BOX centre (%.1f, %.1f) side %.1f; cells %s' % (cx, cy, S, {a: act_px_for(a) for a in reach}), flush=True)

# ---------- 4. an exact area average, in linear light, premultiplied ----------
def weights(start, side, n, size):
    Wm = np.zeros((n, size), dtype=np.float64); step = side / n
    for j in range(n):
        a, b = start + j * step, start + (j + 1) * step
        k0, k1 = int(math.floor(a)), int(math.ceil(b))
        for k in range(max(k0, 0), min(k1, size)):
            Wm[j, k] = max(0.0, min(b, k + 1) - max(a, k))
        Wm[j] /= step
    return Wm
def to_lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def to_srgb(c): c = np.clip(c, 0, 1); return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)
_wcache = {}
def cell(px, side, n):
    key = (side, n)
    if key not in _wcache:
        _wcache[key] = (weights(cy - side / 2, side, n, px.shape[0]), weights(cx - side / 2, side, n, px.shape[1]))
    Wy, Wx = _wcache[key]
    # Blender hands a 16-bit PNG over as a float buffer: scene-linear and already premultiplied (converting it again made
    # every sprite darker and redder than the videos, with a dark fringe)
    a = px[..., 3].astype(np.float64); rgb = px[..., :3].astype(np.float64)
    A = Wy @ a @ Wx.T
    C = np.stack([Wy @ rgb[..., c] @ Wx.T for c in range(3)], -1)
    C = np.where(A[..., None] > 1e-6, C / np.maximum(A[..., None], 1e-6), 0)
    return np.concatenate([to_srgb(C), np.clip(A, 0, 1)[..., None]], -1).astype(np.float32)

def save(arr, path, fmt):
    h, w = arr.shape[:2]
    im = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    im.colorspace_settings.name = 'sRGB'
    im.pixels.foreach_set(np.ascontiguousarray(arr[::-1]).ravel())
    s = sc.render.image_settings
    s.file_format = fmt; s.color_mode = 'RGBA'
    if fmt == 'PNG': s.color_depth = '8'; s.compression = 100
    else: s.quality = WEBP_Q
    im.save_render(path, scene=sc)
    bpy.data.images.remove(im)
    print('WROTE', path, os.path.getsize(path), flush=True)

os.makedirs(OUT, exist_ok=True)
save(np.concatenate([cell(px, S, IDLE_PX) for px in idle_px], 0), os.path.join(OUT, 'sendy-idle.png'), 'PNG')
save(cell(idle_px[0], S, STILL_PX), os.path.join(OUT, 'sendy.png'), 'PNG')
# the colour survives the trip: the solid body in the output reads as it does in the render (sRGB, a few /255 of resampling)
src = idle_px[0]; solid = src[..., 3] > 0.999
small = cell(src, S, STILL_PX); solid_s = small[..., 3] > 0.999
want = to_srgb(src[..., :3][solid]).mean(0) * 255; got = small[..., :3][solid_s].mean(0) * 255   # both averaged as sRGB values
print('COLOUR solid body, render vs sprite (sRGB): %s vs %s' % (np.round(want, 1).tolist(), np.round(got, 1).tolist()), flush=True)
if np.abs(want - got).max() > 4: raise SystemExit('the sprite colour drifted from the render')
# every reaction starts and ends on the first idle frame's pose: the swap in and out must not move him
first = ACT[ACTS[0][0]][1][0][0]
d = np.abs(cell(act_px[first], S, IDLE_PX) - cell(idle_px[0], S, IDLE_PX)) * 255
print('SEAM idle frame 0 vs a reaction\'s rest frame: mean %.3f, max %.2f of 255' % (d.mean(), d.max()), flush=True)
if d.mean() > 0.5 or d.max() > 16: raise SystemExit('the reactions do not start where the idle loop is')
manifest = {'idlePx': IDLE_PX, 'dur': DUR, 'acts': []}
for aid, (fps, frames) in ACT.items():
    order = []
    for h, _ in frames:
        if h not in order: order.append(h)
    seq = [order.index(h) for h, _ in frames]
    # without motion: the frame furthest from rest (the face at its fullest)
    def far(p): return sum(abs(v - REST[k]) / (360 if k == 'yaw' else 180 if k in ('armL', 'armR', 'armLf', 'armRf') else 20 if k in ('brow', 'pitch', 'roll') else 1) for k, v in p.items())
    def facing(p): y = p.get('yaw', 0) % 360; return min(y, 360 - y) <= 30   # turned away (mid-twirl) is no face to hold
    peak = order.index(max(frames, key=lambda f: far(f[1]) if facing(f[1]) else -1)[0])
    px = act_px_for(aid)
    save(np.concatenate([cell(act_px[h], S * px / IDLE_PX, px) for h in order], 1), os.path.join(OUT, 'sendy-act-%s.webp' % aid), 'WEBP')
    manifest['acts'].append({'id': aid, 'k': round(px / IDLE_PX, 4), 'px': px, 'fps': fps, 'cells': len(order), 'seq': seq, 'peak': peak})
with open(os.path.join(OUT, 'sendy-acts.json'), 'w') as f: json.dump(manifest, f, separators=(',', ':')); f.write('\n')
print('DONE', json.dumps({a['id']: (a['cells'], len(a['seq'])) for a in manifest['acts']}), flush=True)
