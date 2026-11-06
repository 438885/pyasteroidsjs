import math
import random
from js import document, window, localStorage
from pyodide.ffi import create_proxy
canvas = document.getElementById("canvas")
ctx = canvas.getContext("2d")
WIDTH = int(window.innerWidth)
HEIGHT = int(window.innerHeight)
canvas.width = WIDTH
canvas.height = HEIGHT
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
    if audio_ctx and audio_ctx.state == "suspended":
        try:
            audio_ctx.resume()
        except:
            pass
    return audio_ctx
def play_sfx(kind):
    actx = get_audio()
    if not actx:
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
    saved = localStorage.getItem("cyber_void_hi")
    high_score = int(saved) if saved else 0
except:
    high_score = 0
class Player:
    def __init__(self):
        self.rot_speed = 4.2
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
        self.shield_regen_delay = 0.0
    def update(self, dt):
        rot = 0.0
        if keys.get("ArrowLeft", False) or keys.get("KeyA", False):
            rot -= 1.0
        if keys.get("ArrowRight", False) or keys.get("KeyD", False):
            rot += 1.0
        self.angle += rot * self.rot_speed * dt
        if self.invulnerable > 0:
            self.invulnerable -= dt
        if self.thrusting:
            accel = 350.0
            self.vx += math.cos(self.angle) * accel * dt
            self.vy += math.sin(self.angle) * accel * dt
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
        ctx.lineWidth = 1.5
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
            ctx.lineTo(-16 - random.uniform(2, 7), 0)
            ctx.lineTo(-8, 4)
            ctx.stroke()
        if self.invulnerable > 0:
            ctx.strokeStyle = "rgba(255, 255, 255, 0.4)"
            ctx.beginPath()
            ctx.arc(0, 0, 18, 0, math.pi * 2)
            ctx.stroke()
        ctx.restore()
class Asteroid:
    def __init__(self, x, y, tier=3):
        self.x = x
        self.y = y
        self.tier = tier
        if tier == 3:
            self.radius = random.uniform(34, 42)
            self.speed = random.uniform(40, 75)
            self.score_val = 50
        elif tier == 2:
            self.radius = random.uniform(18, 24)
            self.speed = random.uniform(70, 120)
            self.score_val = 100
        else:
            self.radius = random.uniform(9, 13)
            self.speed = random.uniform(110, 180)
            self.score_val = 200
        ang = random.uniform(0, math.pi * 2)
        self.vx = math.cos(ang) * self.speed
        self.vy = math.sin(ang) * self.speed
        self.rot = random.uniform(0, math.pi * 2)
        self.rot_speed = random.uniform(-1.5, 1.5)
        num_pts = random.randint(8, 11)
        self.points = []
        for i in range(num_pts):
            theta = (i / num_pts) * math.pi * 2
            r = self.radius * random.uniform(0.75, 1.25)
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
        ctx.lineWidth = 1.2
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
    def __init__(self, x, y, vx, vy):
        self.x = x
        self.y = y
        self.vx = vx
        self.vy = vy
        self.radius = 2.0
        self.life = 1.1
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
        ctx.fillStyle = "#ffffff"
        ctx.beginPath()
        ctx.arc(self.x, self.y, self.radius, 0, math.pi * 2)
        ctx.fill()
class Particle:
    def __init__(self, x, y, vx, vy, size, life):
        self.x = x
        self.y = y
        self.vx = vx
        self.vy = vy
        self.size = size
        self.life = life
        self.max_life = life
    def update(self, dt):
        self.x += self.vx * dt
        self.y += self.vy * dt
        self.vx *= 0.96
        self.vy *= 0.96
        self.life -= dt
        return self.life > 0
    def draw(self, ctx):
        alpha = max(0.0, self.life / self.max_life)
        ctx.fillStyle = f"rgba(255, 255, 255, {alpha})"
        ctx.beginPath()
        ctx.arc(self.x, self.y, self.size * alpha, 0, math.pi * 2)
        ctx.fill()
class FloatingText:
    def __init__(self, x, y, text):
        self.x = x
        self.y = y
        self.text = text
        self.life = 1.0
    def update(self, dt):
        self.y -= 25 * dt
        self.life -= dt
        return self.life > 0
    def draw(self, ctx):
        ctx.save()
        ctx.globalAlpha = max(0.0, self.life)
        ctx.fillStyle = "#ffffff"
        ctx.font = "12px monospace"
        ctx.textAlign = "center"
        ctx.fillText(self.text, self.x, self.y)
        ctx.restore()
class Star:
    def __init__(self):
        self.x = random.uniform(0, WIDTH)
        self.y = random.uniform(0, HEIGHT)
        self.size = random.uniform(0.5, 1.5)
        self.speed = self.size * 8
        self.brightness = random.uniform(0.2, 0.7)
player = Player()
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
def spawn_wave(w):
    asteroids.clear()
    count = 3 + w * 2
    for _ in range(count):
        while True:
            ax = random.uniform(0, WIDTH)
            ay = random.uniform(0, HEIGHT)
            if math.hypot(ax - player.x, ay - player.y) > 160:
                asteroids.append(Asteroid(ax, ay, tier=3))
                break
def start_game():
    global game_state, score, wave, combo_mult, combo_timer
    game_state = "PLAYING"
    score = 0
    wave = 1
    combo_mult = 1
    combo_timer = 0.0
    player.reset()
    bullets.clear()
    particles.clear()
    floating_texts.clear()
    spawn_wave(wave)
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
def on_resize(e=None):
    global WIDTH, HEIGHT
    WIDTH = int(window.innerWidth)
    HEIGHT = int(window.innerHeight)
    canvas.width = WIDTH
    canvas.height = HEIGHT
kd_proxy = create_proxy(on_keydown)
ku_proxy = create_proxy(on_keyup)
rs_proxy = create_proxy(on_resize)
window.addEventListener("keydown", kd_proxy)
window.addEventListener("keyup", ku_proxy)
window.addEventListener("resize", rs_proxy)
last_timestamp = 0
def update(dt, now):
    global game_state, score, high_score, wave, combo_mult, combo_timer, screen_shake, thrust_sfx_timer
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
    if game_state != "PLAYING":
        return
    if combo_mult > 1:
        combo_timer -= dt
        if combo_timer <= 0:
            combo_mult = 1
    player.thrusting = keys.get("KeyW", False) or keys.get("ArrowUp", False)
    if player.thrusting:
        thrust_sfx_timer -= dt
        if thrust_sfx_timer <= 0:
            play_sfx("thrust")
            thrust_sfx_timer = 0.08
        ang = player.angle + math.pi + random.uniform(-0.35, 0.35)
        spd = random.uniform(80, 160)
        particles.append(Particle(
            player.x - math.cos(player.angle) * 10,
            player.y - math.sin(player.angle) * 10,
            math.cos(ang) * spd + player.vx * 0.4,
            math.sin(ang) * spd + player.vy * 0.4,
            random.uniform(1.5, 3.0), random.uniform(0.18, 0.3)
        ))
    player.update(dt)
    if keys.get("Space", False) and player.shot_cooldown <= 0:
        b_speed = 640.0
        bx = player.x + math.cos(player.angle) * 15
        by = player.y + math.sin(player.angle) * 15
        bullets.append(Bullet(
            bx, by,
            math.cos(player.angle) * b_speed + player.vx * 0.25,
            math.sin(player.angle) * b_speed + player.vy * 0.25
        ))
        player.vx -= math.cos(player.angle) * 14
        player.vy -= math.sin(player.angle) * 14
        player.shot_cooldown = 0.16
        play_sfx("laser")
    bullets[:] = [b for b in bullets if b.update(dt)]
    for a in asteroids:
        a.update(dt)
    new_asteroids = []
    for b in list(bullets):
        for a in list(asteroids):
            if math.hypot(b.x - a.x, b.y - a.y) < a.radius + b.radius:
                if b in bullets: bullets.remove(b)
                if a in asteroids: asteroids.remove(a)
                play_sfx("boom")
                trigger_shake(4 if a.tier == 1 else (8 if a.tier == 2 else 12))
                earned = a.score_val * combo_mult
                score += earned
                combo_mult = min(8, combo_mult + 1)
                combo_timer = 3.0
                floating_texts.append(FloatingText(a.x, a.y, f"+{earned}"))
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
                    new_asteroids.append(Asteroid(a.x, a.y, tier=a.tier - 1))
                    new_asteroids.append(Asteroid(a.x, a.y, tier=a.tier - 1))
                break
    asteroids.extend(new_asteroids)
    if len(asteroids) == 0:
        wave += 1
        score += wave * 300
        player.shield = min(player.max_shield, player.shield + 30)
        floating_texts.append(FloatingText(WIDTH / 2, HEIGHT / 2, f"WAVE {wave}"))
        play_sfx("wave")
        spawn_wave(wave)
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
                            localStorage.setItem("cyber_void_hi", str(high_score))
                        except:
                            pass
                break
def draw(now):
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
    if game_state == "PLAYING":
        player.draw(ctx, now)
    ctx.restore()
    # Minimalist HUD
    ctx.save()
    ctx.font = "13px monospace"
    ctx.fillStyle = "#ffffff"
    ctx.textAlign = "left"
    ctx.fillText(f"SCORE {score}   WAVE {wave}", 20, 30)
    ctx.textAlign = "center"
    ctx.fillStyle = "#888888"
    ctx.fillText(f"RECORD {high_score}", WIDTH / 2, 30)
    if combo_mult > 1:
        ctx.fillStyle = "#ffffff"
        ctx.fillText(f"{combo_mult}X", WIDTH / 2, 48)
    ctx.textAlign = "right"
    ctx.fillStyle = "#888888"
    ctx.fillText("SHIELD", WIDTH - 130, 30)
    ctx.strokeStyle = "#ffffff"
    ctx.lineWidth = 1
    ctx.strokeRect(WIDTH - 120, 20, 100, 11)
    pct = max(0.0, player.shield / player.max_shield)
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(WIDTH - 119, 21, pct * 98, 9)
    if game_state == "MENU":
        ctx.fillStyle = "rgba(0, 0, 0, 0.85)"
        ctx.fillRect(0, 0, WIDTH, HEIGHT)
        ctx.fillStyle = "#ffffff"
        ctx.font = "36px monospace"
        ctx.textAlign = "center"
        ctx.fillText("CYBER VOID", WIDTH / 2, HEIGHT / 2 - 40)
        ctx.font = "13px monospace"
        ctx.fillStyle = "#888888"
        ctx.fillText("[W / UP] THRUST   [A / D / LEFT / RIGHT] ROTATE   [SPACE] FIRE", WIDTH / 2, HEIGHT / 2)
        pulse = (math.sin(now * 5.0) + 1.0) * 0.5
        ctx.fillStyle = f"rgba(255, 255, 255, {0.3 + 0.7 * pulse})"
        ctx.fillText("PRESS SPACE OR ENTER TO START", WIDTH / 2, HEIGHT / 2 + 40)
    elif game_state == "GAMEOVER":
        ctx.fillStyle = "rgba(0, 0, 0, 0.85)"
        ctx.fillRect(0, 0, WIDTH, HEIGHT)
        ctx.fillStyle = "#ffffff"
        ctx.font = "36px monospace"
        ctx.textAlign = "center"
        ctx.fillText("GAME OVER", WIDTH / 2, HEIGHT / 2 - 40)
        ctx.font = "14px monospace"
        ctx.fillText(f"SCORE {score}", WIDTH / 2, HEIGHT / 2)
        if score >= high_score and score > 0:
            ctx.fillStyle = "#888888"
            ctx.fillText("NEW RECORD", WIDTH / 2, HEIGHT / 2 + 25)
        pulse = (math.sin(now * 5.0) + 1.0) * 0.5
        ctx.fillStyle = f"rgba(255, 255, 255, {0.3 + 0.7 * pulse})"
        ctx.fillText("PRESS [R] OR SPACE TO RESTART", WIDTH / 2, HEIGHT / 2 + 55)
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