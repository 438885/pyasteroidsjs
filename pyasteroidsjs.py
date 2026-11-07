import json
import math
import random
from js import document, window, localStorage, navigator
from pyodide.ffi import create_proxy

# Signal to the host virtual controller that this game natively reads analog stick vectors
window.__analogHandled = True

canvas = document.getElementById("canvas")
ctx = canvas.getContext("2d")

WIDTH = int(window.innerWidth)
HEIGHT = int(window.innerHeight)
DPR = 1.0

def sync_canvas_size():
    global WIDTH, HEIGHT, DPR
    WIDTH = max(320, int(window.innerWidth))
    HEIGHT = max(320, int(window.innerHeight))
    raw_dpr = float(getattr(window, "devicePixelRatio", 1.0) or 1.0)
    DPR = min(max(raw_dpr, 1.0), 2.5)
    canvas.width = int(WIDTH * DPR)
    canvas.height = int(HEIGHT * DPR)

sync_canvas_size()

def is_touch_device():
    try:
        if getattr(window, "__joy", None) and getattr(window.__joy, "isTouch", False):
            return True
        return int(getattr(navigator, "maxTouchPoints", 0) or 0) > 0
    except:
        return False

def vibrate(ms):
    try:
        if hasattr(navigator, "vibrate"):
            navigator.vibrate(ms)
    except:
        pass

audio_ctx = None
def get_audio():
    global audio_ctx
    if audio_ctx is None:
        try:
            if hasattr(window, "AudioContext"):
                audio_ctx = window.AudioContext.new()
            elif hasattr(window, "webkitAudioContext"):
                audio_ctx = window.webkitAudioContext.new()
        except:
            audio_ctx = None
    # Handle both "suspended" and iOS Safari's "interrupted" audio states
    if audio_ctx and str(audio_ctx.state) != "running":
        try:
            audio_ctx.resume()
        except:
            pass
    return audio_ctx

def play_sfx(kind):
    actx = get_audio()
    if not actx or str(actx.state) != "running":
        return
    try:
        now = actx.currentTime
        osc = actx.createOscillator()
        gain = actx.createGain()
        osc.connect(gain)
        gain.connect(actx.destination)
        if kind == "laser":
            osc.type = "sawtooth"
            osc.frequency.setValueAtTime(800, now)
            osc.frequency.exponentialRampToValueAtTime(100, now + 0.1)
            gain.gain.setValueAtTime(0.06, now)
            gain.gain.linearRampToValueAtTime(0.001, now + 0.1)
            osc.start(now)
            osc.stop(now + 0.1)
        elif kind == "peer_laser":
            osc.type = "sawtooth"
            osc.frequency.setValueAtTime(620, now)
            osc.frequency.exponentialRampToValueAtTime(140, now + 0.09)
            gain.gain.setValueAtTime(0.035, now)
            gain.gain.linearRampToValueAtTime(0.001, now + 0.09)
            osc.start(now)
            osc.stop(now + 0.09)
        elif kind == "thrust":
            osc.type = "triangle"
            osc.frequency.setValueAtTime(85, now)
            osc.frequency.linearRampToValueAtTime(30, now + 0.07)
            gain.gain.setValueAtTime(0.03, now)
            gain.gain.linearRampToValueAtTime(0.001, now + 0.07)
            osc.start(now)
            osc.stop(now + 0.07)
        elif kind == "boom":
            osc.type = "square"
            osc.frequency.setValueAtTime(140, now)
            osc.frequency.exponentialRampToValueAtTime(20, now + 0.3)
            gain.gain.setValueAtTime(0.15, now)
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3)
            osc.start(now)
            osc.stop(now + 0.3)
        elif kind == "hit":
            osc.type = "sine"
            osc.frequency.setValueAtTime(220, now)
            osc.frequency.exponentialRampToValueAtTime(40, now + 0.1)
            gain.gain.setValueAtTime(0.15, now)
            gain.gain.linearRampToValueAtTime(0.001, now + 0.1)
            osc.start(now)
            osc.stop(now + 0.1)
        elif kind == "wave":
            osc.type = "sine"
            osc.frequency.setValueAtTime(440, now)
            osc.frequency.linearRampToValueAtTime(880, now + 0.25)
            gain.gain.setValueAtTime(0.1, now)
            gain.gain.linearRampToValueAtTime(0.001, now + 0.25)
            osc.start(now)
            osc.stop(now + 0.25)
    except:
        pass

try:
    saved = localStorage.getItem("storage_yi")
    high_score = int(saved) if saved else 0
except:
    high_score = 0

def get_joy():
    try:
        j = getattr(window, "__joy", None)
        if j:
            return (
                float(getattr(j, "lx", 0.0) or 0.0),
                float(getattr(j, "ly", 0.0) or 0.0),
                float(getattr(j, "rx", 0.0) or 0.0),
                float(getattr(j, "ry", 0.0) or 0.0),
                bool(getattr(j, "btnA", False)),
                bool(getattr(j, "btnB", False)),
            )
    except:
        pass
    return (0.0, 0.0, 0.0, 0.0, False, False)

# --- TRYSTERO P2P BRIDGE HELPERS ---
def net_send_ship(player_obj, current_score, is_alive):
    try:
        net = getattr(window, "__net", None)
        if not net:
            return
        payload = json.dumps({
            "nx": round(player_obj.x / max(1, WIDTH), 4),
            "ny": round(player_obj.y / max(1, HEIGHT), 4),
            "vx": round(player_obj.vx, 1),
            "vy": round(player_obj.vy, 1),
            "angle": round(player_obj.angle, 3),
            "thrusting": bool(player_obj.thrusting),
            "thrust_power": round(player_obj.thrust_power, 2),
            "shield": round(player_obj.shield, 1),
            "max_shield": round(player_obj.max_shield, 1),
            "invuln": round(player_obj.invulnerable, 2),
            "score": int(current_score),
            "alive": bool(is_alive)
        })
        net.sendShipJSON(payload)
    except:
        pass

def net_send_event(kind, data):
    try:
        net = getattr(window, "__net", None)
        if not net:
            return
        packet = dict(data)
        packet["type"] = kind
        net.sendEventJSON(json.dumps(packet))
    except:
        pass

def net_poll():
    try:
        net = getattr(window, "__net", None)
        if not net:
            return ("sector-1", 0, {}, [])
        raw = net.pollJSON()
        if not raw:
            return ("sector-1", 0, {}, [])
        parsed = json.loads(str(raw))
        return (
            str(parsed.get("room", "sector-1")),
            int(parsed.get("peerCount", 0)),
            parsed.get("peers", {}),
            parsed.get("events", [])
        )
    except:
        return ("sector-1", 0, {}, [])

class RemotePeerShip:
    def __init__(self, peer_id):
        self.peer_id = peer_id
        self.callsign = peer_id[:4].upper()
        self.color = "#00e5ff"
        self.x = WIDTH / 2
        self.y = HEIGHT / 2
        self.vx = 0.0
        self.vy = 0.0
        self.angle = -math.pi / 2
        self.thrusting = False
        self.thrust_power = 1.0
        self.shield = 100.0
        self.max_shield = 100.0
        self.invuln = 0.0
        self.score = 0
        self.alive = True

    def sync_from_net(self, d):
        tx = float(d.get("nx", 0.5)) * WIDTH
        ty = float(d.get("ny", 0.5)) * HEIGHT
        # Snap if wrapping around screen edges; otherwise blend smoothly
        if abs(tx - self.x) > WIDTH * 0.45:
            self.x = tx
        else:
            self.x += (tx - self.x) * 0.45
        if abs(ty - self.y) > HEIGHT * 0.45:
            self.y = ty
        else:
            self.y += (ty - self.y) * 0.45
        self.vx = float(d.get("vx", 0.0))
        self.vy = float(d.get("vy", 0.0))
        self.angle = float(d.get("angle", self.angle))
        self.thrusting = bool(d.get("thrusting", False))
        self.thrust_power = float(d.get("thrust_power", 1.0))
        self.shield = float(d.get("shield", 100.0))
        self.max_shield = float(d.get("max_shield", 100.0))
        self.invuln = float(d.get("invuln", 0.0))
        self.score = int(d.get("score", 0))
        self.alive = bool(d.get("alive", True))
        self.callsign = str(d.get("callsign", self.callsign))
        self.color = str(d.get("color", self.color))

    def update(self, dt):
        if not self.alive:
            return
        self.x = (self.x + self.vx * dt) % WIDTH
        self.y = (self.y + self.vy * dt) % HEIGHT
        if self.invuln > 0:
            self.invuln = max(0.0, self.invuln - dt)

    def draw(self, ctx, now):
        if not self.alive:
            return
        if self.invuln > 0 and int(now * 12) % 2 == 0:
            return
        ctx.save()
        ctx.translate(self.x, self.y)
        ctx.rotate(self.angle)
        ctx.strokeStyle = self.color
        ctx.lineWidth = 1.6
        ctx.fillStyle = "#000000"
        ctx.beginPath()
        ctx.moveTo(15, 0)
        ctx.lineTo(-11, -9)
        ctx.lineTo(-6, 0)
        ctx.lineTo(-11, 9)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        if self.thrusting:
            ctx.strokeStyle = self.color
            ctx.beginPath()
            ctx.moveTo(-8, -4)
            ctx.lineTo(-16 - random.uniform(2, 7) * self.thrust_power, 0)
            ctx.lineTo(-8, 4)
            ctx.stroke()
        ctx.restore()

        # Draw peer callsign & mini shield bar
        ctx.save()
        ctx.font = "10px monospace"
        ctx.fillStyle = self.color
        ctx.textAlign = "center"
        ctx.fillText(f"{self.callsign}", self.x, self.y - 20)
        pct = max(0.0, min(1.0, self.shield / max(1.0, self.max_shield)))
        ctx.fillStyle = "rgba(255,255,255,0.22)"
        ctx.fillRect(self.x - 14, self.y - 16, 28, 2.5)
        ctx.fillStyle = self.color
        ctx.fillRect(self.x - 14, self.y - 16, 28 * pct, 2.5)
        ctx.restore()

class Player:
    def __init__(self):
        self.rot_speed = 4.4
        self.reset()

    def reset(self):
        self.x = WIDTH / 2
        self.y = HEIGHT / 2
        self.vx = 0.0
        self.vy = 0.0
        self.angle = -math.pi / 2
        self.radius = 12
        self.shield = 100.0
        self.max_shield = 100.0
        self.invulnerable = 2.0
        self.shot_cooldown = 0.0
        self.thrusting = False
        self.thrust_power = 1.0
        self.thrust_angle = self.angle
        self.shield_regen_delay = 0.0

    def update(self, dt):
        lx, ly, rx, ry, btn_a, btn_b = get_joy()
        l_mag = min(1.0, math.hypot(lx, ly))
        r_mag = min(1.0, math.hypot(rx, ry))

        # 1. Steering: Twin-Stick Right Aim > Left Stick Analog > Keyboard Digital
        if r_mag > 0.18:
            target_ang = math.atan2(ry, rx)
            diff = (target_ang - self.angle + math.pi) % (math.pi * 2) - math.pi
            max_step = self.rot_speed * 2.5 * dt
            if abs(diff) <= max_step:
                self.angle = target_ang
            else:
                self.angle += math.copysign(max_step, diff)
        elif l_mag > 0.16:
            target_ang = math.atan2(ly, lx)
            diff = (target_ang - self.angle + math.pi) % (math.pi * 2) - math.pi
            max_step = self.rot_speed * 2.0 * dt
            if abs(diff) <= max_step:
                self.angle = target_ang
            else:
                self.angle += math.copysign(max_step, diff)
        else:
            rot = 0.0
            if keys.get("ArrowLeft", False) or keys.get("KeyA", False):
                rot -= 1.0
            if keys.get("ArrowRight", False) or keys.get("KeyD", False):
                rot += 1.0
            self.angle += rot * self.rot_speed * dt

        # 2. Thrusting: Keyboard, B-button, or Left Stick deflection
        kb_thrust = keys.get("KeyW", False) or keys.get("ArrowUp", False) or btn_b
        stick_thrust = l_mag > 0.30
        self.thrusting = kb_thrust or stick_thrust

        if self.invulnerable > 0:
            self.invulnerable -= dt

        if self.thrusting:
            self.thrust_power = 1.0 if kb_thrust else max(0.35, l_mag)
            if r_mag > 0.18 and l_mag > 0.25:
                self.thrust_angle = math.atan2(ly, lx)
            else:
                self.thrust_angle = self.angle
            accel = 350.0 * self.thrust_power
            self.vx += math.cos(self.thrust_angle) * accel * dt
            self.vy += math.sin(self.thrust_angle) * accel * dt

        friction = 0.985 ** (dt * 60)
        self.vx *= friction
        self.vy *= friction
        spd = math.hypot(self.vx, self.vy)
        if spd > 380:
            self.vx = (self.vx / spd) * 380
            self.vy = (self.vy / spd) * 380

        self.x += self.vx * dt
        self.y += self.vy * dt
        if self.x < 0: self.x += WIDTH
        elif self.x > WIDTH: self.x -= WIDTH
        if self.y < 0: self.y += HEIGHT
        elif self.y > HEIGHT: self.y -= HEIGHT

        if self.shield < self.max_shield:
            if self.shield_regen_delay > 0:
                self.shield_regen_delay -= dt
            else:
                self.shield = min(self.max_shield, self.shield + 10.0 * dt)

        if self.shot_cooldown > 0:
            self.shot_cooldown -= dt

    def draw(self, ctx, now):
        if self.invulnerable > 0 and int(now * 12) % 2 == 0:
            return
        ctx.save()
        ctx.translate(self.x, self.y)
        ctx.rotate(self.angle)
        ctx.strokeStyle = "#ffffff"
        ctx.lineWidth = 1.6
        ctx.fillStyle = "#000000"
        ctx.beginPath()
        ctx.moveTo(15, 0)
        ctx.lineTo(-11, -9)
        ctx.lineTo(-6, 0)
        ctx.lineTo(-11, 9)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        if self.thrusting:
            ctx.strokeStyle = "#ffffff"
            ctx.beginPath()
            ctx.moveTo(-8, -4)
            ctx.lineTo(-16 - random.uniform(2, 7) * self.thrust_power, 0)
            ctx.lineTo(-8, 4)
            ctx.stroke()
        if self.invulnerable > 0:
            ctx.strokeStyle = "rgba(255, 255, 255, 0.4)"
            ctx.beginPath()
            ctx.arc(0, 0, 18, 0, math.pi * 2)
            ctx.stroke()
        ctx.restore()

class Asteroid:
    def __init__(self, x, y, tier=3, aid=None, rng_seed=None):
        self.x = x
        self.y = y
        self.tier = tier
        self.aid = aid or f"{random.randint(10000, 99999)}"
        rng = random.Random(rng_seed if rng_seed is not None else self.aid)
        if tier == 3:
            self.radius = rng.uniform(34, 42)
            self.speed = rng.uniform(40, 75)
            self.score_val = 50
        elif tier == 2:
            self.radius = rng.uniform(18, 24)
            self.speed = rng.uniform(70, 120)
            self.score_val = 100
        else:
            self.radius = rng.uniform(9, 13)
            self.speed = rng.uniform(110, 180)
            self.score_val = 200
        ang = rng.uniform(0, math.pi * 2)
        self.vx = math.cos(ang) * self.speed
        self.vy = math.sin(ang) * self.speed
        self.rot = rng.uniform(0, math.pi * 2)
        self.rot_speed = rng.uniform(-1.5, 1.5)
        num_pts = rng.randint(8, 11)
        self.points = []
        for i in range(num_pts):
            theta = (i / num_pts) * math.pi * 2
            r = self.radius * rng.uniform(0.75, 1.25)
            self.points.append((math.cos(theta) * r, math.sin(theta) * r))

    def update(self, dt):
        self.x += self.vx * dt
        self.y += self.vy * dt
        self.rot += self.rot_speed * dt
        pad = self.radius * 2
        if self.x < -pad: self.x += WIDTH + pad * 2
        elif self.x > WIDTH + pad: self.x -= WIDTH + pad * 2
        if self.y < -pad: self.y += HEIGHT + pad * 2
        elif self.y > HEIGHT + pad: self.y -= HEIGHT + pad * 2

    def draw(self, ctx):
        ctx.save()
        ctx.translate(self.x, self.y)
        ctx.rotate(self.rot)
        ctx.strokeStyle = "#ffffff"
        ctx.lineWidth = 1.3
        ctx.fillStyle = "#000000"
        ctx.beginPath()
        ctx.moveTo(self.points[0][0], self.points[0][1])
        for pt in self.points[1:]:
            ctx.lineTo(pt[0], pt[1])
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.restore()

class Bullet:
    def __init__(self, x, y, vx, vy, color="#ffffff", is_local=True):
        self.x = x
        self.y = y
        self.vx = vx
        self.vy = vy
        self.radius = 2.2
        self.life = 1.1
        self.color = color
        self.is_local = is_local

    def update(self, dt):
        self.x += self.vx * dt
        self.y += self.vy * dt
        self.life -= dt
        if self.x < 0: self.x += WIDTH
        elif self.x > WIDTH: self.x -= WIDTH
        if self.y < 0: self.y += HEIGHT
        elif self.y > HEIGHT: self.y -= HEIGHT
        return self.life > 0

    def draw(self, ctx):
        ctx.fillStyle = self.color
        ctx.beginPath()
        ctx.arc(self.x, self.y, self.radius, 0, math.pi * 2)
        ctx.fill()

class Particle:
    def __init__(self, x, y, vx, vy, size, life, rgb="255, 255, 255"):
        self.x = x
        self.y = y
        self.vx = vx
        self.vy = vy
        self.size = size
        self.life = life
        self.max_life = life
        self.rgb = rgb

    def update(self, dt):
        self.x += self.vx * dt
        self.y += self.vy * dt
        self.vx *= 0.96
        self.vy *= 0.96
        self.life -= dt
        return self.life > 0

    def draw(self, ctx):
        alpha = max(0.0, self.life / self.max_life)
        ctx.fillStyle = f"rgba({self.rgb}, {alpha})"
        ctx.beginPath()
        ctx.arc(self.x, self.y, self.size * alpha, 0, math.pi * 2)
        ctx.fill()

class FloatingText:
    def __init__(self, x, y, text, color="#ffffff"):
        self.x = x
        self.y = y
        self.text = text
        self.life = 1.0
        self.color = color

    def update(self, dt):
        self.y -= 25 * dt
        self.life -= dt
        return self.life > 0

    def draw(self, ctx):
        ctx.save()
        ctx.globalAlpha = max(0.0, self.life)
        ctx.fillStyle = self.color
        ctx.font = "12px monospace"
        ctx.textAlign = "center"
        ctx.fillText(self.text, self.x, self.y)
        ctx.restore()

class Star:
    def __init__(self):
        self.x = random.uniform(0, WIDTH)
        self.y = random.uniform(0, HEIGHT)
        self.size = random.uniform(0.6, 1.6)
        self.speed = self.size * 8
        self.brightness = random.uniform(0.2, 0.7)

player = Player()
remote_peers = {}
p2p_room = "sector-1"
p2p_peer_count = 0
net_sync_timer = 0.0

asteroids = []
bullets = []
particles = []
floating_texts = []
stars = [Star() for _ in range(80)]
game_state = "MENU"
score = 0
wave = 1
combo_mult = 1
combo_timer = 0.0
screen_shake = 0.0
thrust_sfx_timer = 0.0
keys = {}

def spawn_wave(w, wave_seed=None, broadcast=True):
    asteroids.clear()
    seed_str = str(wave_seed or f"{p2p_room}-w{w}")
    rng = random.Random(seed_str)
    count = 3 + w * 2
    safe_dist = min(160.0, min(WIDTH, HEIGHT) * 0.32)
    for i in range(count):
        aid = f"w{w}_{i}"
        for _attempt in range(50):
            nx = rng.uniform(0.0, 1.0)
            ny = rng.uniform(0.0, 1.0)
            ax, ay = nx * WIDTH, ny * HEIGHT
            if math.hypot(ax - player.x, ay - player.y) > safe_dist:
                asteroids.append(Asteroid(ax, ay, tier=3, aid=aid, rng_seed=f"{seed_str}_{aid}"))
                break
        else:
            asteroids.append(Asteroid(0, 0, tier=3, aid=aid, rng_seed=f"{seed_str}_{aid}"))
    if broadcast and p2p_peer_count > 0:
        net_send_event("wave", {"wave": w, "seed": seed_str})

def destroy_asteroid(a, earned, by_local=True):
    if a not in asteroids:
        return
    asteroids.remove(a)
    play_sfx("boom")
    if by_local:
        vibrate(12 if a.tier < 3 else 22)
        trigger_shake(4 if a.tier == 1 else (8 if a.tier == 2 else 12))
    floating_texts.append(FloatingText(a.x, a.y, f"+{earned}", "#ffffff" if by_local else "#00e5ff"))
    p_count = 8 if a.tier == 1 else (14 if a.tier == 2 else 20)
    for _ in range(p_count):
        p_ang = random.uniform(0, math.pi * 2)
        p_spd = random.uniform(40, 190)
        particles.append(Particle(
            a.x, a.y,
            math.cos(p_ang) * p_spd, math.sin(p_ang) * p_spd,
            random.uniform(1.5, 3.0), random.uniform(0.3, 0.6)
        ))
    if a.tier > 1:
        asteroids.append(Asteroid(a.x, a.y, tier=a.tier - 1, aid=f"{a.aid}a", rng_seed=f"{a.aid}a"))
        asteroids.append(Asteroid(a.x, a.y, tier=a.tier - 1, aid=f"{a.aid}b", rng_seed=f"{a.aid}b"))

def start_game(broadcast=True):
    global game_state, score, wave, combo_mult, combo_timer
    get_audio()
    game_state = "PLAYING"
    score = 0
    wave = 1
    combo_mult = 1
    combo_timer = 0.0
    player.reset()
    bullets.clear()
    particles.clear()
    floating_texts.clear()
    wave_seed = f"{p2p_room}-w1-{random.randint(1000, 9999)}"
    spawn_wave(wave, wave_seed=wave_seed, broadcast=False)
    if broadcast and p2p_peer_count > 0:
        net_send_event("start", {"wave": wave, "seed": wave_seed})

def trigger_shake(amount):
    global screen_shake
    screen_shake = max(screen_shake, amount)

def on_keydown(e):
    get_audio()
    keys[e.code] = True
    if e.code in ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"]:
        e.preventDefault()
    if e.code == "KeyR":
        start_game()
    elif game_state in ["MENU", "GAMEOVER"] and e.code in ["Space", "Enter"]:
        start_game()

def on_keyup(e):
    keys[e.code] = False

def on_canvas_pointerdown(e):
    get_audio()
    if game_state in ["MENU", "GAMEOVER"]:
        e.preventDefault()
        start_game()

def on_resize(e=None):
    old_w, old_h = max(1, WIDTH), max(1, HEIGHT)
    sync_canvas_size()
    sx, sy = WIDTH / old_w, HEIGHT / old_h
    player.x = max(0.0, min(WIDTH, player.x * sx))
    player.y = max(0.0, min(HEIGHT, player.y * sy))
    for a in asteroids:
        a.x = (a.x * sx) % WIDTH
        a.y = (a.y * sy) % HEIGHT
    for s in stars:
        s.x = (s.x * sx) % WIDTH
        s.y = (s.y * sy) % HEIGHT

kd_proxy = create_proxy(on_keydown)
ku_proxy = create_proxy(on_keyup)
rs_proxy = create_proxy(on_resize)
pd_proxy = create_proxy(on_canvas_pointerdown)

window.addEventListener("keydown", kd_proxy)
window.addEventListener("keyup", ku_proxy)
window.addEventListener("resize", rs_proxy)
canvas.addEventListener("pointerdown", pd_proxy)

last_timestamp = 0
def update(dt, now):
    global game_state, score, high_score, wave, combo_mult, combo_timer, screen_shake, thrust_sfx_timer
    global p2p_room, p2p_peer_count, net_sync_timer

    if screen_shake > 0:
        screen_shake *= 0.88 ** (dt * 60)
        if screen_shake < 0.2:
            screen_shake = 0.0

    for s in stars:
        s.y += s.speed * dt
        if s.y > HEIGHT:
            s.y = 0
            s.x = random.uniform(0, WIDTH)

    particles[:] = [p for p in particles if p.update(dt)]
    floating_texts[:] = [t for t in floating_texts if t.update(dt)]

    # --- POLL TRYSTERO P2P STATE & EVENTS ---
    p2p_room, p2p_peer_count, peers_dict, net_events = net_poll()
    active_ids = set(peers_dict.keys())
    for pid in list(remote_peers.keys()):
        if pid not in active_ids:
            remote_peers.pop(pid, None)
    for pid, pdata in peers_dict.items():
        if pid not in remote_peers:
            remote_peers[pid] = RemotePeerShip(pid)
        remote_peers[pid].sync_from_net(pdata)

    for rship in remote_peers.values():
        rship.update(dt)
        if rship.alive and rship.thrusting and random.random() < 0.45:
            ang = rship.angle + math.pi + random.uniform(-0.3, 0.3)
            spd = random.uniform(60, 130)
            particles.append(Particle(
                rship.x - math.cos(rship.angle) * 10,
                rship.y - math.sin(rship.angle) * 10,
                math.cos(ang) * spd + rship.vx * 0.3,
                math.sin(ang) * spd + rship.vy * 0.3,
                random.uniform(1.2, 2.4), random.uniform(0.14, 0.25),
                rgb="0, 229, 255"
            ))

    for ev in net_events:
        etype = ev.get("type")
        if etype == "fire":
            bx = float(ev.get("nx", 0.5)) * WIDTH
            by = float(ev.get("ny", 0.5)) * HEIGHT
            bvx = float(ev.get("vx", 0.0))
            bvy = float(ev.get("vy", 0.0))
            bcol = str(ev.get("color", "#00e5ff"))
            bullets.append(Bullet(bx, by, bvx, bvy, color=bcol, is_local=False))
            play_sfx("peer_laser")
        elif etype == "hit":
            target_aid = str(ev.get("aid", ""))
            earned = int(ev.get("earned", 50))
            hit_ast = next((a for a in asteroids if a.aid == target_aid), None)
            if hit_ast:
                hit_ast.x = float(ev.get("nx", hit_ast.x / max(1, WIDTH))) * WIDTH
                hit_ast.y = float(ev.get("ny", hit_ast.y / max(1, HEIGHT))) * HEIGHT
                score += earned
                destroy_asteroid(hit_ast, earned, by_local=False)
        elif etype == "wave":
            w_num = int(ev.get("wave", wave))
            w_seed = str(ev.get("seed", f"{p2p_room}-w{w_num}"))
            if w_num != wave or len(asteroids) == 0:
                wave = w_num
                floating_texts.append(FloatingText(WIDTH / 2, HEIGHT / 2, f"CO-OP WAVE {wave}", "#00e5ff"))
                play_sfx("wave")
                spawn_wave(wave, wave_seed=w_seed, broadcast=False)
        elif etype == "start":
            w_seed = str(ev.get("seed", f"{p2p_room}-w1"))
            if game_state != "PLAYING":
                game_state = "PLAYING"
                score = 0
                wave = int(ev.get("wave", 1))
                player.reset()
                bullets.clear()
                spawn_wave(wave, wave_seed=w_seed, broadcast=False)
                floating_texts.append(FloatingText(WIDTH / 2, HEIGHT / 2, "PEER STARTED MATCH", "#00e5ff"))
        elif etype == "highscore":
            peer_hs = int(ev.get("high_score", 0))
            if peer_hs > high_score:
                high_score = peer_hs
                try:
                    localStorage.setItem("storage_yi", str(high_score))
                except:
                    pass

    # Broadcast local ship state at ~20Hz
    net_sync_timer -= dt
    if net_sync_timer <= 0:
        net_sync_timer = 0.05
        net_send_ship(player, score, game_state == "PLAYING")

    if game_state != "PLAYING":
        return

    if combo_mult > 1:
        combo_timer -= dt
        if combo_timer <= 0:
            combo_mult = 1

    player.update(dt)

    if player.thrusting:
        thrust_sfx_timer -= dt
        if thrust_sfx_timer <= 0:
            play_sfx("thrust")
            thrust_sfx_timer = 0.08
        ang = player.thrust_angle + math.pi + random.uniform(-0.35, 0.35)
        spd = random.uniform(80, 160) * player.thrust_power
        particles.append(Particle(
            player.x - math.cos(player.angle) * 10,
            player.y - math.sin(player.angle) * 10,
            math.cos(ang) * spd + player.vx * 0.4,
            math.sin(ang) * spd + player.vy * 0.4,
            random.uniform(1.5, 3.0), random.uniform(0.18, 0.3)
        ))

    _, _, rx, ry, btn_a, _ = get_joy()
    joy_fire = (math.hypot(rx, ry) > 0.25) or btn_a

    if (keys.get("Space", False) or joy_fire) and player.shot_cooldown <= 0:
        b_speed = 640.0
        bx = player.x + math.cos(player.angle) * 15
        by = player.y + math.sin(player.angle) * 15
        bvx = math.cos(player.angle) * b_speed + player.vx * 0.25
        bvy = math.sin(player.angle) * b_speed + player.vy * 0.25
        bullets.append(Bullet(bx, by, bvx, bvy, color="#ffffff", is_local=True))
        player.vx -= math.cos(player.angle) * 14
        player.vy -= math.sin(player.angle) * 14
        player.shot_cooldown = 0.16
        play_sfx("laser")
        if p2p_peer_count > 0:
            net_send_event("fire", {
                "nx": round(bx / max(1, WIDTH), 4),
                "ny": round(by / max(1, HEIGHT), 4),
                "vx": round(bvx, 1),
                "vy": round(bvy, 1)
            })

    bullets[:] = [b for b in bullets if b.update(dt)]
    for a in asteroids:
        a.update(dt)

    for b in list(bullets):
        for a in list(asteroids):
            if math.hypot(b.x - a.x, b.y - a.y) < a.radius + b.radius:
                if b in bullets:
                    bullets.remove(b)
                if b.is_local:
                    earned = a.score_val * combo_mult
                    score += earned
                    combo_mult = min(8, combo_mult + 1)
                    combo_timer = 3.0
                    if p2p_peer_count > 0:
                        net_send_event("hit", {
                            "aid": a.aid,
                            "nx": round(a.x / max(1, WIDTH), 4),
                            "ny": round(a.y / max(1, HEIGHT), 4),
                            "earned": earned
                        })
                    destroy_asteroid(a, earned, by_local=True)
                else:
                    destroy_asteroid(a, a.score_val, by_local=False)
                break

    if len(asteroids) == 0:
        wave += 1
        score += wave * 300
        player.shield = min(player.max_shield, player.shield + 30)
        floating_texts.append(FloatingText(WIDTH / 2, HEIGHT / 2, f"WAVE {wave}"))
        play_sfx("wave")
        next_seed = f"{p2p_room}-w{wave}-{random.randint(1000, 9999)}"
        spawn_wave(wave, wave_seed=next_seed, broadcast=True)

    if player.invulnerable <= 0:
        for a in asteroids:
            if math.hypot(player.x - a.x, player.y - a.y) < player.radius + a.radius:
                dmg = 30 if a.tier == 1 else (45 if a.tier == 2 else 65)
                player.shield -= dmg
                player.shield_regen_delay = 3.0
                player.invulnerable = 1.0
                combo_mult = 1
                trigger_shake(16)
                play_sfx("hit")
                vibrate(35)
                push = math.atan2(player.y - a.y, player.x - a.x)
                player.vx += math.cos(push) * 200
                player.vy += math.sin(push) * 200
                for _ in range(12):
                    p_ang = random.uniform(0, math.pi * 2)
                    p_spd = random.uniform(50, 150)
                    particles.append(Particle(player.x, player.y, math.cos(p_ang) * p_spd, math.sin(p_ang) * p_spd, 2.5, 0.35))
                if player.shield <= 0:
                    player.shield = 0
                    game_state = "GAMEOVER"
                    play_sfx("boom")
                    vibrate([50, 40, 90])
                    trigger_shake(24)
                    for _ in range(35):
                        p_ang = random.uniform(0, math.pi * 2)
                        p_spd = random.uniform(40, 240)
                        particles.append(Particle(
                            player.x, player.y,
                            math.cos(p_ang) * p_spd, math.sin(p_ang) * p_spd,
                            random.uniform(2, 4), random.uniform(0.5, 1.0)
                        ))
                    if score > high_score:
                        high_score = score
                        try:
                            localStorage.setItem("storage_yi", str(high_score))
                        except:
                            pass
                        if p2p_peer_count > 0:
                            net_send_event("highscore", {"high_score": high_score})
                break

def get_safe_insets():
    try:
        s = getattr(window, "__safeInsets", None)
        if s:
            return (
                float(getattr(s, "top", 0.0) or 0.0),
                float(getattr(s, "right", 0.0) or 0.0),
                float(getattr(s, "bottom", 0.0) or 0.0),
                float(getattr(s, "left", 0.0) or 0.0),
            )
    except:
        pass
    return (0.0, 0.0, 0.0, 0.0)

def draw(now):
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
    ctx.save()
    if screen_shake > 0:
        ctx.translate(random.uniform(-screen_shake, screen_shake), random.uniform(-screen_shake, screen_shake))
    ctx.fillStyle = "#000000"
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    for s in stars:
        ctx.fillStyle = f"rgba(255, 255, 255, {s.brightness})"
        ctx.fillRect(s.x, s.y, s.size, s.size)
    for b in bullets: b.draw(ctx)
    for a in asteroids: a.draw(ctx)
    for p in particles: p.draw(ctx)
    for t in floating_texts: t.draw(ctx)
    for rship in remote_peers.values():
        rship.draw(ctx, now)
    if game_state == "PLAYING":
        player.draw(ctx, now)
    ctx.restore()

    # Safe-area & Portrait-aware Minimalist HUD
    safe_t, safe_r, safe_b, safe_l = get_safe_insets()
    pad_l = 18 + safe_l
    pad_r = 18 + safe_r
    hud_y = 26 + safe_t
    is_narrow = WIDTH < 640
    touch_mode = is_touch_device()

    ctx.save()
    ctx.font = "13px monospace"
    ctx.fillStyle = "#ffffff"
    ctx.textAlign = "left"
    ctx.fillText(f"SCORE {score}   WAVE {wave}", pad_l, hud_y)

    p2p_badge = f"P2P:{p2p_room.upper()} ({p2p_peer_count + 1}P)" if p2p_peer_count > 0 else f"P2P:{p2p_room.upper()}"
    if is_narrow:
        ctx.fillStyle = "#888888"
        ctx.fillText(f"RECORD {high_score}", pad_l, hud_y + 18)
        ctx.fillStyle = "#00e5ff" if p2p_peer_count > 0 else "#666666"
        ctx.fillText(p2p_badge, pad_l + 135, hud_y + 18)
    else:
        ctx.textAlign = "center"
        ctx.fillStyle = "#888888"
        ctx.fillText(f"RECORD {high_score}   •   {p2p_badge}", WIDTH / 2, hud_y)
        if combo_mult > 1:
            ctx.fillStyle = "#ffffff"
            ctx.fillText(f"{combo_mult}X COMBO", WIDTH / 2, hud_y + 18)

    ctx.textAlign = "right"
    ctx.fillStyle = "#888888"
    ctx.fillText("SHIELD", WIDTH - pad_r - 108, hud_y)
    ctx.strokeStyle = "#ffffff"
    ctx.lineWidth = 1
    ctx.strokeRect(WIDTH - pad_r - 100, hud_y - 10, 100, 11)
    pct = max(0.0, player.shield / player.max_shield)
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(WIDTH - pad_r - 99, hud_y - 9, pct * 98, 9)

    if game_state == "MENU":
        ctx.fillStyle = "rgba(0, 0, 0, 0.85)"
        ctx.fillRect(0, 0, WIDTH, HEIGHT)
        ctx.fillStyle = "#ffffff"
        ctx.font = "34px monospace"
        ctx.textAlign = "center"
        ctx.fillText("PYASTEROIDS.JS", WIDTH / 2, HEIGHT / 2 - 48)
        ctx.font = "13px monospace"
        ctx.fillStyle = "#888888"
        if touch_mode:
            ctx.fillText("LEFT STICK: FLY & STEER   RIGHT STICK / [A]: FIRE", WIDTH / 2, HEIGHT / 2 - 8)
        else:
            ctx.fillText("[W / UP] THRUST   [A / D / LEFT / RIGHT] ROTATE   [SPACE] FIRE", WIDTH / 2, HEIGHT / 2 - 8)
        ctx.fillStyle = "#00e5ff" if p2p_peer_count > 0 else "#777777"
        ctx.fillText(f"TRYSTERO P2P ROOM: {p2p_room.upper()} ({p2p_peer_count} PEER{'S' if p2p_peer_count != 1 else ''} CONNECTED)", WIDTH / 2, HEIGHT / 2 + 18)
        pulse = (math.sin(now * 5.0) + 1.0) * 0.5
        ctx.fillStyle = f"rgba(255, 255, 255, {0.3 + 0.7 * pulse})"
        prompt_txt = "TAP SCREEN OR PRESS SPACE TO START" if touch_mode else "PRESS SPACE OR ENTER TO START"
        ctx.fillText(prompt_txt, WIDTH / 2, HEIGHT / 2 + 52)
    elif game_state == "GAMEOVER":
        ctx.fillStyle = "rgba(0, 0, 0, 0.85)"
        ctx.fillRect(0, 0, WIDTH, HEIGHT)
        ctx.fillStyle = "#ffffff"
        ctx.font = "34px monospace"
        ctx.textAlign = "center"
        ctx.fillText("GAME OVER", WIDTH / 2, HEIGHT / 2 - 42)
        ctx.font = "14px monospace"
        ctx.fillText(f"SCORE {score}", WIDTH / 2, HEIGHT / 2)
        if score >= high_score and score > 0:
            ctx.fillStyle = "#888888"
            ctx.fillText("NEW RECORD", WIDTH / 2, HEIGHT / 2 + 25)
        pulse = (math.sin(now * 5.0) + 1.0) * 0.5
        ctx.fillStyle = f"rgba(255, 255, 255, {0.3 + 0.7 * pulse})"
        restart_txt = "TAP SCREEN OR [R] TO RESTART" if touch_mode else "PRESS [R] OR SPACE TO RESTART"
        ctx.fillText(restart_txt, WIDTH / 2, HEIGHT / 2 + 55)
    ctx.restore()

def loop(timestamp):
    global last_timestamp
    t_sec = timestamp / 1000.0
    if last_timestamp == 0:
        last_timestamp = t_sec
    dt = min(t_sec - last_timestamp, 0.05)
    last_timestamp = t_sec
    update(dt, t_sec)
    draw(t_sec)
    window.requestAnimationFrame(loop_proxy)

loop_proxy = create_proxy(loop)
window.requestAnimationFrame(loop_proxy)