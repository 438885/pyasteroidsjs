(async () => {
  // 1. Load Comlink, idb-keyval & Trystero in the Parent Host
  const loadTrystero = async () => {
    for (const url of [
      "https://cdn.jsdelivr.net/npm/trystero@0.22.0/nostr/+esm",
      "https://cdn.jsdelivr.net/npm/trystero/+esm"
    ]) {
      try {
        return await import(url);
      } catch (_) {}
    }
    return null;
  };

  const [Comlink, idb, trysteroMod] = await Promise.all([
    import("https://cdn.jsdelivr.net/npm/comlink@4.4.2/+esm"),
    import("https://cdn.jsdelivr.net/npm/idb-keyval@6.2.1/+esm"),
    loadTrystero()
  ]);

  // Share the pre-loaded Trystero module with the same-origin runner iframe
  window.__trysteroMod = trysteroMod;

  const fsStore = idb.createStore("pyodide-fs-db", "files");
  const pkgStore = idb.createStore("pyodide-pkg-db", "wheels");

  // Ensure mobile viewport meta tag & web-app capability tags exist on the parent host document
  const ensureMeta = (name, content) => {
    let m = document.querySelector(`meta[name="${name}"]`);
    if (!m) {
      m = document.createElement("meta");
      m.name = name;
      document.head.appendChild(m);
    }
    m.content = content;
  };
  ensureMeta("viewport", "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover");
  ensureMeta("apple-mobile-web-app-capable", "yes");
  ensureMeta("mobile-web-app-capable", "yes");

  document.body.innerHTML = `
    <style>
      *{margin:0;box-sizing:border-box;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none}
      html,body,iframe{position:fixed;inset:0;width:100%;height:100%;border:0;background:#000;overflow:hidden;overscroll-behavior:none;touch-action:none;display:block}
    </style>
    <iframe id="runner" allow="autoplay; fullscreen; gamepad; wake-lock" sandbox="allow-scripts allow-modals allow-pointer-lock allow-popups allow-same-origin"></iframe>`;
  const iframe = document.getElementById("runner");

  // Prevent iOS Safari elastic overscroll on the parent host
  window.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

  // Read or persist room ID in the parent URL hash (#room=sector-1)
  const getInitialRoom = () => {
    const hashMatch = (window.location.hash || "").match(/room=([a-zA-Z0-9_-]+)/);
    const queryMatch = (window.location.search || "").match(/room=([a-zA-Z0-9_-]+)/);
    return (hashMatch?.[1] || queryMatch?.[1] || "sector-1").toLowerCase();
  };

  // 2. Host Storage & Room RPC Service exposed to the Iframe via Comlink.proxy
  const hostStorage = Comlink.proxy({
    async getRoomId() {
      return getInitialRoom();
    },
    async setRoomId(roomId) {
      try {
        history.replaceState(null, "", `#room=${encodeURIComponent(roomId)}`);
      } catch (_) {
        window.location.hash = `room=${encodeURIComponent(roomId)}`;
      }
    },
    async loadAllFiles() {
      return await idb.entries(fsStore);
    },
    async saveChanges(upserts, removals) {
      await Promise.all([
        ...upserts.map(([path, rec]) => idb.set(path, rec, fsStore)),
        ...removals.map((path) => idb.del(path, fsStore))
      ]);
    },
    async saveKV(key, val) {
      await idb.set("kv:" + key, val, fsStore);
    },
    async getPkg(url) {
      const hit = await idb.get(url, pkgStore);
      if (!hit) return null;
      const copy = new Uint8Array(hit.buf);
      return Comlink.transfer({ buf: copy, type: hit.type, status: hit.status }, [copy.buffer]);
    },
    async setPkg(url, buf, type, status) {
      await idb.set(url, { buf: new Uint8Array(buf), type, status }, pkgStore);
    },
    async clearAll() {
      await Promise.all([idb.clear(fsStore), idb.clear(pkgStore)]);
    }
  });

  // 3. Self-Contained Iframe Runtime (Comlink + Trystero + NippleJS + Pyodide + Analog Mobile Controls & Sync)
  const iframeHtml = `<!DOCTYPE html><html><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <style>
  :root{
    --sat:env(safe-area-inset-top,0px);
    --sab:env(safe-area-inset-bottom,0px);
    --sal:env(safe-area-inset-left,0px);
    --sar:env(safe-area-inset-right,0px);
  }
  *{margin:0;box-sizing:border-box;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
  html,body{position:fixed;inset:0;width:100%;height:100%;background:#000;color:#fff;overflow:hidden;overscroll-behavior:none;touch-action:none}
  #safe-probe{position:fixed;top:var(--sat);right:var(--sar);bottom:var(--sab);left:var(--sal);pointer-events:none;visibility:hidden}
  #canvas{position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none}
  #o{position:fixed;inset:0;padding:calc(14px + var(--sat)) calc(14px + var(--sar)) calc(14px + var(--sab)) calc(14px + var(--sal));font:14px monospace;overflow:auto;white-space:pre-wrap;pointer-events:none;text-shadow:0 1px 2px #000;-webkit-overflow-scrolling:touch;z-index:5}
  .matplotlib-figure{position:relative;z-index:2;background:#fff;color:#000;margin:12px auto;max-width:95vw;border-radius:4px;display:block;pointer-events:auto;touch-action:auto}
  iframe.matplotlib-figure{width:95vw;height:75vh;border:0}
  #hud{position:fixed;bottom:calc(12px + var(--sab));left:50%;transform:translateX(-50%);z-index:20;display:flex;gap:5px;background:rgba(0,0,0,.65);padding:4px 8px;border-radius:20px;border:1px solid rgba(255,255,255,.22);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);white-space:nowrap}
  .hbtn{background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:14px;padding:6px 10px;font:12px monospace;cursor:pointer;transition:all .15s;touch-action:manipulation}
  .hbtn:active{background:rgba(255,255,255,.35);transform:scale(.95)}
  .hbtn.saving,.hbtn.online{background:rgba(0,229,255,.32);border-color:#00e5ff;color:#e0ffff}
  #jui{position:fixed;inset:0;z-index:10;pointer-events:none;display:none}
  #jui.on{display:block}
  .jz{position:absolute;bottom:calc(16px + var(--sab));width:clamp(112px,27vmin,148px);height:clamp(112px,27vmin,148px);pointer-events:auto;touch-action:none;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.06) 0%,rgba(255,255,255,0) 70%)}
  #jl{left:calc(14px + var(--sal))}
  #jr{right:calc(14px + var(--sar))}
  #jpad{position:absolute;right:calc(18px + var(--sar));bottom:calc(148px + var(--sab));width:clamp(108px,24vmin,132px);height:clamp(108px,24vmin,132px);pointer-events:auto;touch-action:none}
  .jb{position:absolute;width:35%;height:35%;border-radius:50%;background:rgba(255,255,255,.16);border:1.5px solid rgba(255,255,255,.45);color:#fff;font:700 11px monospace;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.05;cursor:pointer;touch-action:none;transition:transform .08s,background .08s}
  .jb small{font-size:7px;opacity:.8;font-weight:400;pointer-events:none}
  .jb.act{background:rgba(255,255,255,.78);color:#000;border-color:#fff;transform:scale(.92)}
  #jba{bottom:0;left:32.5%}#jbb{top:32.5%;right:0}#jbx{top:32.5%;left:0}#jby{top:0;left:32.5%}
  @media (max-width: 640px) {
    #hud{bottom:auto;top:calc(6px + var(--sat));padding:3px 7px}
    .hbtn{padding:5px 8px;font-size:11px}
    #jpad{bottom:calc(138px + var(--sab));right:calc(14px + var(--sar))}
    .jz{bottom:calc(12px + var(--sab))}
  }
  @media (max-height: 450px) {
    #jpad{bottom:calc(124px + var(--sab));right:calc(14px + var(--sar));width:102px;height:102px}
    .jz{bottom:calc(8px + var(--sab));width:110px;height:110px}
  }
  </style></head><body>
  <div id="safe-probe"></div>
  <canvas id="canvas" tabindex="-1"></canvas>
  <pre id="o">Loading runtime...</pre>
  <div id="hud">
    <button id="sbtn" class="hbtn" title="Sync Saves (Long-Press or Shift+Click to Reset)">💾</button>
    <button id="pbtn" class="hbtn" title="Trystero P2P Room (Click to change room)">📡 0</button>
    <button id="rbtn" class="hbtn" title="Start / Restart Game (KeyR / Space)">⟳ START</button>
    <button id="jbtn" class="hbtn" title="Toggle Virtual Controller">🎮</button>
    <button id="fbtn" class="hbtn" title="Toggle Fullscreen">⛶</button>
  </div>
  <div id="jui" class="on">
    <div id="jl" class="jz" title="Left Stick: Analog Fly & Steer"></div>
    <div id="jr" class="jz" title="Right Stick: Aim & Auto-Fire / 3D Look"></div>
    <div id="jpad">
      <div id="jby" class="jb" data-id="btnY">Y<small>START</small></div>
      <div id="jbx" class="jb" data-id="btnX">X<small>RESET</small></div>
      <div id="jbb" class="jb" data-id="btnB">B<small>THRUST</small></div>
      <div id="jba" class="jb" data-id="btnA">A<small>FIRE</small></div>
    </div>
  </div>
  <script type="module">
  import * as Comlink from "https://cdn.jsdelivr.net/npm/comlink@4.4.2/+esm";

  const c = document.getElementById("canvas"), o = document.getElementById("o"),
        jui = document.getElementById("jui"), jbtn = document.getElementById("jbtn"),
        sbtn = document.getElementById("sbtn"), pbtn = document.getElementById("pbtn"),
        rbtn = document.getElementById("rbtn"), fbtn = document.getElementById("fbtn"),
        hud = document.getElementById("hud"), safeProbe = document.getElementById("safe-probe");
  let init = 1, py = null, host = null, syncLock = false, lastSync = 0, is3DContext = false;
  const knownFiles = new Map();

  // Shared analog state object read directly by Python (pyCode)
  const isTouchEnv = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0) || window.matchMedia?.("(pointer: coarse)")?.matches;
  window.__joy = {
    lx: 0, ly: 0, lForce: 0,
    rx: 0, ry: 0, rForce: 0,
    btnA: false, btnB: false, btnX: false, btnY: false,
    isTouch: Boolean(isTouchEnv)
  };
  window.__safeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

  // Prevent iOS Safari pinch/double-tap zoom, rubber-band scrolling & context menus
  ["gesturestart", "gesturechange", "gestureend", "contextmenu"].forEach((ev) => {
    window.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  });
  window.addEventListener("touchmove", (e) => {
    if (!e.target.closest?.("#o, .matplotlib-figure")) e.preventDefault();
  }, { passive: false });

  // Request Screen WakeLock on mobile so thumbstick play doesn't dim the display
  let wakeLock = null;
  const requestWakeLock = async () => {
    if (wakeLock || !navigator.wakeLock?.request) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } catch (_) {}
  };

  // Use visualViewport when available so mobile browser bars don't clip the canvas
  const realInnerW = Object.getOwnPropertyDescriptor(window, "innerWidth")?.get?.bind(window) || (() => document.documentElement.clientWidth);
  const realInnerH = Object.getOwnPropertyDescriptor(window, "innerHeight")?.get?.bind(window) || (() => document.documentElement.clientHeight);
  const getLogicalSize = () => {
    const rw = Math.round(window.visualViewport?.width || realInnerW() || 360);
    const rh = Math.round(window.visualViewport?.height || realInnerH() || 640);
    const minSide = Math.min(rw, rh);
    const scale = minSide < 540 ? 540 / Math.max(1, minSide) : 1;
    return { w: Math.round(rw * scale), h: Math.round(rh * scale), rw, rh, scale };
  };
  try {
    Object.defineProperty(window, "innerWidth", { get: () => getLogicalSize().w, configurable: true });
    Object.defineProperty(window, "innerHeight", { get: () => getLogicalSize().h, configurable: true });
  } catch (_) {}

  const updateSafeInsets = () => {
    const { rw, rh, scale } = getLogicalSize();
    const rect = safeProbe.getBoundingClientRect();
    let top = Math.max(0, rect.top);
    const left = Math.max(0, rect.left);
    const right = Math.max(0, rw - rect.right);
    const bottom = Math.max(0, rh - rect.bottom);
    const hudRect = hud.getBoundingClientRect();
    if (hudRect.top < 100) {
      top = Math.max(top, hudRect.bottom + 4);
    }
    window.__safeInsets = {
      top: Math.round(top * scale),
      right: Math.round(right * scale),
      bottom: Math.round(bottom * scale),
      left: Math.round(left * scale)
    };
  };
  updateSafeInsets();

  // Auto-fit centered Canvas 2D text so wide desktop menu prompts never overflow portrait phones
  const origFillText = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
    if (maxWidth === undefined && this.textAlign === "center" && this.canvas) {
      maxWidth = Math.max(120, (window.innerWidth || this.canvas.width) - 28);
    }
    return origFillText.call(this, text, x, y, maxWidth);
  };

  // Track 2D vs 3D Canvas context & auto-unlock WebAudio on any touch/pointer gesture
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, ...args) {
    if (/webgl|webgpu|3d/i.test(type)) is3DContext = true;
    return origGetContext.call(this, type, ...args);
  };

  const audioContexts = new Set();
  ["AudioContext", "webkitAudioContext"].forEach((name) => {
    const OrigAudio = window[name];
    if (!OrigAudio) return;
    window[name] = new Proxy(OrigAudio, {
      construct(target, args) {
        const inst = new target(...args);
        audioContexts.add(inst);
        return inst;
      }
    });
  });

  let audioPrimed = false;
  const unlockAudio = () => {
    requestWakeLock();
    if (!audioPrimed && (window.AudioContext || window.webkitAudioContext)) {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const warm = new Ctx();
        audioContexts.add(warm);
        audioPrimed = true;
      } catch (_) {}
    }
    for (const actx of audioContexts) {
      try {
        if (actx.state !== "running") actx.resume().catch(() => {});
        if (!actx._iosUnlocked && actx.state === "running") {
          const buf = actx.createBuffer(1, 1, 22050);
          const src = actx.createBufferSource();
          src.buffer = buf;
          src.connect(actx.destination);
          src.start(0);
          actx._iosUnlocked = true;
        }
      } catch (_) {}
    }
  };
  ["pointerdown", "touchstart", "touchend", "click"].forEach((ev) => {
    window.addEventListener(ev, unlockAudio, { passive: true });
  });

  const vibrate = (ms = 10) => {
    try { navigator.vibrate?.(ms); } catch (_) {}
  };

  const pulseSave = () => {
    sbtn.classList.add("saving");
    clearTimeout(sbtn._t);
    sbtn._t = setTimeout(() => sbtn.classList.remove("saving"), 350);
  };

  const log = (t) => {
    if (init) { o.textContent = ""; init = 0; }
    const s = String(t?.message || t);
    o.append(s.endsWith("\\n") ? s : s + "\\n");
    o.scrollTop = o.scrollHeight;
  };
  window.onwheel = (e) => { if (!e.target.closest?.(".matplotlib-figure")) o.scrollTop += e.deltaY; };

  // --- 0. TRYSTERO SERVERLESS WEBRTC P2P ENGINE ---
  const PEER_PALETTE = ["#00e5ff", "#ff4081", "#76ff03", "#ffd740", "#e040fb", "#ff6e40"];
  const colorForPeer = (id = "") => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return PEER_PALETTE[h % PEER_PALETTE.length];
  };

  const netState = {
    roomName: "sector-1",
    selfId: "local-" + Math.random().toString(36).slice(2, 8),
    room: null,
    bc: null,
    peers: new Map(), // peerId -> { state, lastSeen }
    eventQueue: [],
    sendShipAct: null,
    sendEvtAct: null,
    sendFsAct: null
  };

  const updatePeerHud = () => {
    const now = performance.now();
    for (const [pid, rec] of netState.peers.entries()) {
      if (now - rec.lastSeen > 12000) netState.peers.delete(pid);
    }
    const count = netState.peers.size;
    pbtn.textContent = \`📡 \${count}\`;
    pbtn.classList.toggle("online", count > 0);
    pbtn.title = \`Trystero Room: \${netState.roomName} (\${count} peer\${count === 1 ? "" : "s"}) — Click to change room\`;
  };
  setInterval(updatePeerHud, 2000);

  // Universal helper supporting both Trystero <=0.25 tuple API and >=0.26 object API
  const bindTrysteroAction = (room, name, onRecv) => {
    const act = room.makeAction(name);
    if (Array.isArray(act)) {
      const [send, get] = act;
      if (onRecv) get((data, peerId, meta) => onRecv(data, peerId, meta));
      return (data, targetPeer) => send(data, targetPeer);
    } else if (act && typeof act === "object") {
      if (onRecv) {
        act.onMessage = (data, info) => {
          const peerId = typeof info === "string" ? info : info?.peerId;
          onRecv(data, peerId, info?.meta);
        };
      }
      return (data, targetPeer) => act.send(data, targetPeer ? { target: targetPeer } : undefined);
    }
    return () => {};
  };

  const handleIncomingShip = (data, peerId) => {
    if (!peerId || peerId === netState.selfId || !data) return;
    netState.peers.set(peerId, {
      lastSeen: performance.now(),
      state: {
        ...data,
        callsign: "P-" + String(peerId).slice(0, 4).toUpperCase(),
        color: colorForPeer(peerId)
      }
    });
    updatePeerHud();
  };

  const handleIncomingEvt = (data, peerId) => {
    if (!peerId || peerId === netState.selfId || !data) return;
    netState.peers.set(peerId, {
      ...(netState.peers.get(peerId) || { state: { callsign: "P-" + String(peerId).slice(0, 4).toUpperCase(), color: colorForPeer(peerId) } }),
      lastSeen: performance.now()
    });
    netState.eventQueue.push({ ...data, peerId, color: colorForPeer(peerId) });
    if (netState.eventQueue.length > 64) netState.eventQueue.shift();
    updatePeerHud();
  };

  const handleIncomingFs = async (payload, peerId) => {
    if (!peerId || peerId === netState.selfId || !payload) return;
    try {
      if (payload.kv && typeof payload.kv === "object") {
        for (const [k, v] of Object.entries(payload.kv)) {
          window.localStorage.setItem(k, String(v));
        }
      }
      if (Array.isArray(payload.files) && py) {
        const upserts = [];
        for (const [path, arr] of payload.files) {
          const dir = path.substring(0, path.lastIndexOf("/")) || "/";
          try { py.FS.mkdirTree(dir); } catch (_) {}
          const bytes = arr instanceof Uint8Array ? arr : new Uint8Array(arr);
          py.FS.writeFile(path, bytes);
          const st = py.FS.stat(path);
          knownFiles.set(path, st.size + ":" + Number(st.mtime));
          upserts.push([path, { data: bytes, mtime: Number(st.mtime) }]);
        }
        if (upserts.length && host) await host.saveChanges(upserts, []);
      }
      pulseSave();
    } catch (e) { console.warn("P2P FS sync error:", e); }
  };

  const connectTrysteroRoom = async (roomName) => {
    const cleanRoom = String(roomName || "sector-1").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") || "sector-1";
    netState.roomName = cleanRoom;
    netState.peers.clear();
    updatePeerHud();
    if (host) host.setRoomId(cleanRoom).catch(() => {});

    // Close previous room & BroadcastChannel if switching rooms
    try { await netState.room?.leave?.(); } catch (_) {}
    try { netState.bc?.close?.(); } catch (_) {}

    // 1. Same-browser-tab BroadcastChannel fast-path alongside WebRTC
    try {
      const bc = new BroadcastChannel("trystero-pyasteroids-" + cleanRoom);
      bc.onmessage = (ev) => {
        const msg = ev.data;
        if (!msg || msg.peerId === netState.selfId) return;
        if (msg.ch === "ship") handleIncomingShip(msg.data, msg.peerId);
        else if (msg.ch === "evt") handleIncomingEvt(msg.data, msg.peerId);
        else if (msg.ch === "fs") handleIncomingFs(msg.data, msg.peerId);
        else if (msg.ch === "bye") { netState.peers.delete(msg.peerId); updatePeerHud(); }
      };
      netState.bc = bc;
    } catch (_) {}

    // 2. Trystero Serverless WebRTC Room (via Nostr relays)
    try {
      let mod = window.parent?.__trysteroMod;
      if (!mod) {
        mod = await import("https://cdn.jsdelivr.net/npm/trystero@0.22.0/nostr/+esm");
      }
      if (mod?.selfId) netState.selfId = String(mod.selfId);
      const joinRoom = mod.joinRoom || mod.default?.joinRoom;
      if (joinRoom) {
        const room = joinRoom({ appId: "pyasteroids-trystero-v1" }, cleanRoom);
        netState.room = room;

        const onJoin = (peerId) => {
          netState.peers.set(peerId, {
            lastSeen: performance.now(),
            state: {
              nx: 0.5, ny: 0.5, vx: 0, vy: 0, angle: -1.57,
              shield: 100, max_shield: 100, alive: true,
              callsign: "P-" + String(peerId).slice(0, 4).toUpperCase(),
              color: colorForPeer(peerId)
            }
          });
          updatePeerHud();
          // Share current high score with newly joined peer
          const hs = Number(window.localStorage.getItem("storage_yi") || 0);
          if (hs > 0 && netState.sendEvtAct) {
            try { netState.sendEvtAct({ type: "highscore", high_score: hs }, peerId); } catch (_) {}
          }
        };
        const onLeave = (peerId) => {
          netState.peers.delete(peerId);
          updatePeerHud();
        };

        if (typeof room.onPeerJoin === "function") {
          room.onPeerJoin(onJoin);
          room.onPeerLeave(onLeave);
        } else {
          room.onPeerJoin = onJoin;
          room.onPeerLeave = onLeave;
        }

        netState.sendShipAct = bindTrysteroAction(room, "ship", handleIncomingShip);
        netState.sendEvtAct  = bindTrysteroAction(room, "evt", handleIncomingEvt);
        netState.sendFsAct   = bindTrysteroAction(room, "fs", handleIncomingFs);
      }
    } catch (e) {
      console.warn("Trystero room init warning:", e);
    }
  };

  window.addEventListener("pagehide", () => {
    try { netState.bc?.postMessage({ ch: "bye", peerId: netState.selfId }); } catch (_) {}
    try { netState.room?.leave?.(); } catch (_) {}
  });

  // Expose zero-latency synchronous JSON bridge for Pyodide (pyCode)
  window.__net = {
    sendShipJSON(jsonStr) {
      try {
        const data = JSON.parse(jsonStr);
        netState.bc?.postMessage({ ch: "ship", peerId: netState.selfId, data });
        if (netState.peers.size > 0 && netState.sendShipAct) netState.sendShipAct(data);
      } catch (_) {}
    },
    sendEventJSON(jsonStr) {
      try {
        const data = JSON.parse(jsonStr);
        netState.bc?.postMessage({ ch: "evt", peerId: netState.selfId, data });
        if (netState.sendEvtAct) netState.sendEvtAct(data);
      } catch (_) {}
    },
    pollJSON() {
      const peersObj = {};
      for (const [pid, rec] of netState.peers.entries()) {
        if (rec?.state) peersObj[pid] = rec.state;
      }
      const events = netState.eventQueue.splice(0, netState.eventQueue.length);
      return JSON.stringify({
        room: netState.roomName,
        peerCount: netState.peers.size,
        peers: peersObj,
        events
      });
    }
  };

  pbtn.onclick = async () => {
    unlockAudio();
    const next = prompt(
      \`Trystero Serverless WebRTC Room\\nConnected Peers: \${netState.peers.size}\\nEnter Room Code to join/switch:\`,
      netState.roomName
    );
    if (next && next.trim()) {
      await connectTrysteroRoom(next.trim());
    }
    c.focus();
  };

  // --- 1. MIRROR LOCALSTORAGE INTO IDB-KEYVAL & TRYSTERO PEERS ---
  try {
    const origSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(k, v) {
      origSetItem.call(this, k, v);
      if (this === window.localStorage) {
        if (host) host.saveKV(String(k), String(v)).then(pulseSave).catch(() => {});
        const kvPayload = { kv: { [String(k)]: String(v) } };
        try { netState.bc?.postMessage({ ch: "fs", peerId: netState.selfId, data: kvPayload }); } catch (_) {}
        try { if (netState.peers.size > 0) netState.sendFsAct?.(kvPayload); } catch (_) {}
      }
    };
  } catch (_) {}

  // --- 2. INTERCEPT FETCH TO CACHE PYTHON WHEELS (.whl / .wasm) IN IDB-KEYVAL ---
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, initOpts) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const isGet = !initOpts?.method || initOpts.method.toUpperCase() === "GET";
    const isCacheablePkg = isGet && /\\.(whl|wasm|zip|tar|tgz)(\\?|$)|pyodide-lock\\.json|repodata\\.json/i.test(url);

    if (isCacheablePkg && host) {
      try {
        const cached = await host.getPkg(url);
        if (cached?.buf) {
          pulseSave();
          return new Response(cached.buf, {
            status: cached.status || 200,
            headers: { "Content-Type": cached.type || "application/octet-stream" }
          });
        }
      } catch (_) {}
    }

    const res = await origFetch(input, initOpts);
    if (isCacheablePkg && host && res.ok) {
      try {
        const clone = res.clone();
        const buf = new Uint8Array(await clone.arrayBuffer());
        const type = clone.headers.get("Content-Type") || "application/octet-stream";
        host.setPkg(url, Comlink.transfer(buf, [buf.buffer]), type, clone.status).then(pulseSave).catch(() => {});
      } catch (_) {}
    }
    return res;
  };

  // --- 3. VIRTUAL FILESYSTEM & LOCALSTORAGE <-> IDB-KEYVAL + TRYSTERO SYNC ---
  const IGNORE_NAMES = new Set([".", "..", "main.py", "__pycache__", ".cache"]);
  function walkFS(dir, out = []) {
    let list = [];
    try { list = py.FS.readdir(dir); } catch (_) { return out; }
    for (const name of list) {
      if (IGNORE_NAMES.has(name) || name.endsWith(".pyc")) continue;
      const full = dir === "/" ? "/" + name : dir + "/" + name;
      try {
        const st = py.FS.stat(full);
        if (py.FS.isDir(st.mode)) walkFS(full, out);
        else if (py.FS.isFile(st.mode)) out.push([full, st]);
      } catch (_) {}
    }
    return out;
  }

  async function restoreFS() {
    if (!py || !host) return;
    try {
      const entries = await host.loadAllFiles();
      for (const [path, rec] of entries) {
        if (typeof path === "string" && path.startsWith("kv:")) {
          try { window.localStorage.setItem(path.slice(3), String(rec)); } catch (_) {}
          continue;
        }
        if (!rec?.data) continue;
        const dir = path.substring(0, path.lastIndexOf("/")) || "/";
        try { py.FS.mkdirTree(dir); } catch (_) {}
        const bytes = rec.data instanceof Uint8Array ? rec.data : new Uint8Array(rec.data);
        py.FS.writeFile(path, bytes);
        const st = py.FS.stat(path);
        knownFiles.set(path, st.size + ":" + Number(st.mtime));
      }
      if (entries.length) pulseSave();
    } catch (e) { console.warn("FS restore warning:", e); }
  }

  async function syncFS() {
    if (!py || !host || syncLock) return;
    syncLock = true;
    try {
      const current = walkFS("/home/pyodide");
      const seen = new Set();
      const upserts = [];
      const p2pFiles = [];
      for (const [path, st] of current) {
        seen.add(path);
        const sig = st.size + ":" + Number(st.mtime);
        if (knownFiles.get(path) !== sig) {
          const data = new Uint8Array(py.FS.readFile(path));
          upserts.push([path, { data, mtime: Number(st.mtime) }]);
          if (data.byteLength <= 262144) p2pFiles.push([path, Array.from(data)]);
          knownFiles.set(path, sig);
        }
      }
      const removals = [];
      for (const oldPath of knownFiles.keys()) {
        if (!seen.has(oldPath)) {
          removals.push(oldPath);
          knownFiles.delete(oldPath);
        }
      }
      if (upserts.length || removals.length) {
        await host.saveChanges(upserts, removals);
        if (p2pFiles.length) {
          const payload = { files: p2pFiles };
          try { netState.bc?.postMessage({ ch: "fs", peerId: netState.selfId, data: payload }); } catch (_) {}
          try { if (netState.peers.size > 0) netState.sendFsAct?.(payload); } catch (_) {}
        }
        pulseSave();
      }
      lastSync = performance.now();
    } catch (e) { console.warn("FS sync warning:", e); }
    finally { syncLock = false; }
  }

  window.__syncFS = syncFS;
  window.__maybeSyncFS = () => {
    if (performance.now() - lastSync > 1500) syncFS();
  };
  setInterval(() => window.__maybeSyncFS(), 2500);
  window.addEventListener("pagehide", () => syncFS());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") syncFS();
    else { unlockAudio(); requestWakeLock(); }
  });

  const resetAllStorage = async () => {
    if (!host) return;
    if (confirm("Clear all saved files, high scores, and cached Python packages from IndexedDB?")) {
      await host.clearAll();
      try { window.localStorage.clear(); } catch (_) {}
      knownFiles.clear();
      log("[Storage] Cleared IndexedDB save files and package cache.");
    }
  };

  // Support both Shift+Click (desktop) and 800ms Long-Press (mobile) on 💾 to reset IndexedDB
  let saveHoldTimer = null;
  sbtn.addEventListener("pointerdown", () => {
    saveHoldTimer = setTimeout(() => { saveHoldTimer = "triggered"; vibrate(30); resetAllStorage(); }, 800);
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => {
    sbtn.addEventListener(ev, () => {
      if (saveHoldTimer && saveHoldTimer !== "triggered") clearTimeout(saveHoldTimer);
    });
  });
  sbtn.onclick = async (e) => {
    if (saveHoldTimer === "triggered") { saveHoldTimer = null; return; }
    if (e.shiftKey) await resetAllStorage();
    else await syncFS();
    c.focus();
  };

  // Fullscreen button (checks both parent document and iframe document)
  fbtn.onclick = async () => {
    unlockAudio();
    const doc = window.parent?.document || document;
    const rootEl = doc.documentElement;
    try {
      if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
        await (rootEl.requestFullscreen?.() || rootEl.webkitRequestFullscreen?.());
      } else {
        await (doc.exitFullscreen?.() || doc.webkitExitFullscreen?.());
      }
    } catch (_) {}
    c.focus();
  };

  // --- 4. NIPPLEJS VIRTUAL CONTROLLER (Analog Vectors + Chorded Multi-Touch Pad) ---
  try {
    const nippleMod = await import("https://cdn.jsdelivr.net/npm/nipplejs@0.10.2/+esm");
    const nipplejs = nippleMod.default || nippleMod;

    const KEYS = {
      ArrowUp: ["ArrowUp", 38], KeyW: ["w", 87],
      ArrowDown: ["ArrowDown", 40], KeyS: ["s", 83],
      ArrowLeft: ["ArrowLeft", 37], KeyA: ["a", 65],
      ArrowRight: ["ArrowRight", 39], KeyD: ["d", 68],
      Space: [" ", 32], Enter: ["Enter", 13], KeyR: ["r", 82], KeyE: ["e", 69], ShiftLeft: ["Shift", 16]
    };

    const fireKey = (type, code) => {
      unlockAudio();
      const [key, keyCode] = KEYS[code] || [code, 0];
      c.dispatchEvent(new KeyboardEvent(type, { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true }));
    };

    const activeSources = new Map();
    let activeUnion = new Set();
    const setKeySource = (sourceId, codes) => {
      activeSources.set(sourceId, new Set(codes));
      const nextUnion = new Set();
      for (const set of activeSources.values()) {
        for (const code of set) nextUnion.add(code);
      }
      for (const code of activeUnion) {
        if (!nextUnion.has(code)) fireKey("keyup", code);
      }
      for (const code of nextUnion) {
        if (!activeUnion.has(code)) fireKey("keydown", code);
      }
      activeUnion = nextUnion;
    };

    const releaseAllKeys = () => {
      window.__joy.lx = window.__joy.ly = window.__joy.lForce = 0;
      window.__joy.rx = window.__joy.ry = window.__joy.rForce = 0;
      window.__joy.btnA = window.__joy.btnB = window.__joy.btnX = window.__joy.btnY = false;
      document.querySelectorAll(".jb.act").forEach((el) => el.classList.remove("act"));
      for (const k of activeSources.keys()) activeSources.set(k, new Set());
      for (const code of activeUnion) fireKey("keyup", code);
      activeUnion.clear();
    };
    window.addEventListener("blur", releaseAllKeys);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") releaseAllKeys();
    });

    const pulseStartOrFire = (codes = ["KeyR", "Space"]) => {
      unlockAudio();
      vibrate(12);
      codes.forEach((k) => fireKey("keydown", k));
      setTimeout(() => codes.forEach((k) => fireKey("keyup", k)), 65);
      c.focus();
    };

    rbtn.onclick = () => pulseStartOrFire(["KeyR", "Space"]);

    const gpState = { axes: [0, 0, 0, 0], btns: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })), active: false };
    const origGetGamepads = navigator.getGamepads?.bind(navigator);
    navigator.getGamepads = () => {
      const real = origGetGamepads ? Array.from(origGetGamepads()) : [null, null, null, null];
      if (gpState.active && !real[0]) {
        real[0] = {
          id: "NippleJS Virtual Gamepad (Standard)", index: 0, connected: true, timestamp: performance.now(),
          mapping: "standard", axes: [...gpState.axes], buttons: gpState.btns
        };
      }
      return real;
    };
    const activateGp = () => {
      unlockAudio();
      window.__joy.isTouch = true;
      if (!gpState.active) {
        gpState.active = true;
        window.dispatchEvent(Object.assign(new Event("gamepadconnected"), { gamepad: navigator.getGamepads()[0] }));
      }
    };
    const setBtn = (idx, down) => { activateGp(); gpState.btns[idx] = { pressed: down, touched: down, value: down ? 1 : 0 }; };

    let lMgr = null, rMgr = null;
    const mountSticks = () => {
      lMgr?.destroy(); rMgr?.destroy();
      setKeySource("stickL", []);
      setKeySource("stickR", []);
      window.__joy.lx = window.__joy.ly = window.__joy.lForce = 0;
      window.__joy.rx = window.__joy.ry = window.__joy.rForce = 0;

      const { rw, rh } = getLogicalSize();
      const stickSize = Math.min(110, Math.max(80, Math.round(Math.min(rw, rh) * 0.23)));

      lMgr = nipplejs.create({
        zone: document.getElementById("jl"), mode: "static",
        position: { left: "50%", top: "50%" }, color: "#ffffff",
        size: stickSize, restOpacity: 0.65, multitouch: true, maxNumberOfNipples: 1
      });
      rMgr = nipplejs.create({
        zone: document.getElementById("jr"), mode: "static",
        position: { left: "50%", top: "50%" }, color: "#00e5ff",
        size: stickSize, restOpacity: 0.65, multitouch: true, maxNumberOfNipples: 1
      });

      lMgr.on("move", (_, d) => {
        activateGp();
        const vx = d.vector?.x || 0, vy = -(d.vector?.y || 0);
        const force = Math.min(1, d.force || 0);
        window.__joy.lx = vx * force;
        window.__joy.ly = vy * force;
        window.__joy.lForce = force;
        gpState.axes[0] = vx; gpState.axes[1] = vy;

        const next = [];
        if (vy < -0.35) setBtn(12, true); else setBtn(12, false);
        if (vy > 0.38)  setBtn(13, true); else setBtn(13, false);
        if (vx < -0.25) setBtn(14, true); else setBtn(14, false);
        if (vx > 0.25)  setBtn(15, true); else setBtn(15, false);

        if (!window.__analogHandled) {
          if (vy < -0.35) next.push("ArrowUp", "KeyW");
          if (vy > 0.38)  next.push("ArrowDown", "KeyS");
          if (vx < -0.25) next.push("ArrowLeft", "KeyA");
          if (vx > 0.25)  next.push("ArrowRight", "KeyD");
        }
        setKeySource("stickL", next);
      });
      lMgr.on("end", () => {
        window.__joy.lx = window.__joy.ly = window.__joy.lForce = 0;
        gpState.axes[0] = gpState.axes[1] = 0;
        [12, 13, 14, 15].forEach((i) => setBtn(i, false));
        setKeySource("stickL", []);
      });

      rMgr.on("move", (_, d) => {
        activateGp();
        const vx = d.vector?.x || 0, vy = -(d.vector?.y || 0);
        const force = Math.min(1, d.force || 0);
        window.__joy.rx = vx * force;
        window.__joy.ry = vy * force;
        window.__joy.rForce = force;
        gpState.axes[2] = vx; gpState.axes[3] = vy;

        if (!is3DContext && force > 0.2) {
          setKeySource("stickR", window.__analogHandled ? [] : ["Space"]);
        }
      });
      rMgr.on("end", () => {
        window.__joy.rx = window.__joy.ry = window.__joy.rForce = 0;
        gpState.axes[2] = gpState.axes[3] = 0;
        setKeySource("stickR", []);
      });
    };

    let mx = innerWidth / 2, my = innerHeight / 2, mBtns = 0;
    const lookLoop = () => {
      const rx = gpState.axes[2], ry = gpState.axes[3];
      if (is3DContext && Math.hypot(rx, ry) > 0.08) {
        const dx = Math.round(rx * 14), dy = Math.round(ry * 14);
        mx = Math.max(0, Math.min(innerWidth, mx + dx));
        my = Math.max(0, Math.min(innerHeight, my + dy));
        c.dispatchEvent(new MouseEvent("mousemove", {
          clientX: mx, clientY: my, screenX: mx, screenY: my,
          movementX: dx, movementY: dy, buttons: mBtns, bubbles: true, cancelable: true
        }));
      }
      requestAnimationFrame(lookLoop);
    };
    requestAnimationFrame(lookLoop);

    const BTN_CFG = {
      btnA: { gp: 0, keys: ["Space"], mouse: false },
      btnB: { gp: 1, keys: ["ArrowUp", "KeyW"], mouse: true },
      btnX: { gp: 2, keys: ["KeyR", "KeyE"], mouse: false },
      btnY: { gp: 3, keys: ["Enter", "Space"], mouse: false }
    };
    const jpad = document.getElementById("jpad");
    const btnEls = Array.from(document.querySelectorAll(".jb"));
    const activePadBtns = new Set();

    const applyPadState = (nextSet) => {
      for (const el of btnEls) {
        const id = el.dataset.id, cfg = BTN_CFG[id];
        const down = nextSet.has(id);
        const wasDown = activePadBtns.has(id);
        if (down !== wasDown) {
          if (down) vibrate(8);
          el.classList.toggle("act", down);
          window.__joy[id] = down;
          setBtn(cfg.gp, down);
          if (cfg.mouse) {
            mBtns = down ? 1 : 0;
            c.dispatchEvent(new MouseEvent(down ? "mousedown" : "mouseup", {
              clientX: mx, clientY: my, button: 0, buttons: mBtns, bubbles: true, cancelable: true
            }));
          }
          setKeySource(id, down ? cfg.keys : []);
        }
      }
      activePadBtns.clear();
      for (const id of nextSet) activePadBtns.add(id);
    };

    const syncPadTouches = (e) => {
      e.preventDefault();
      unlockAudio();
      const next = new Set();
      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        const hit = document.elementFromPoint(t.clientX, t.clientY)?.closest?.(".jb");
        if (hit?.dataset?.id) next.add(hit.dataset.id);
      }
      applyPadState(next);
      c.focus();
    };
    jpad.addEventListener("touchstart", syncPadTouches, { passive: false });
    jpad.addEventListener("touchmove", syncPadTouches, { passive: false });
    jpad.addEventListener("touchend", syncPadTouches, { passive: false });
    jpad.addEventListener("touchcancel", syncPadTouches, { passive: false });

    btnEls.forEach((el) => {
      const id = el.dataset.id;
      el.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "touch") return;
        e.preventDefault();
        unlockAudio();
        applyPadState(new Set([id]));
        c.focus();
      });
      ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => {
        el.addEventListener(ev, (e) => {
          if (e.pointerType === "touch") return;
          if (activePadBtns.has(id)) applyPadState(new Set());
        });
      });
    });

    const toggleHud = (force) => {
      const on = jui.classList.toggle("on", force);
      if (on) mountSticks();
      else releaseAllKeys();
      c.focus();
    };
    jbtn.onclick = () => toggleHud();
    mountSticks();

    let resizeTimer = null, lastW = getLogicalSize().rw, lastH = getLogicalSize().rh;
    const handleViewportChange = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        updateSafeInsets();
        const { rw, rh } = getLogicalSize();
        if (Math.abs(rw - lastW) > 36 || Math.abs(rh - lastH) > 70) {
          lastW = rw; lastH = rh;
          if (jui.classList.contains("on")) mountSticks();
        }
        window.dispatchEvent(new Event("resize"));
      }, 120);
    };
    window.addEventListener("orientationchange", handleViewportChange);
    window.visualViewport?.addEventListener("resize", handleViewportChange);
    window.addEventListener("resize", updateSafeInsets);
  } catch (e) { console.warn("nipplejs init skipped:", e); }

  // --- 5. EXPOSE RUNNER API TO PARENT VIA COMLINK.WINDOWENDPOINT ---
  Comlink.expose({
    async run(pyCode, hostStorageProxy) {
      host = hostStorageProxy;
      try {
        const initialRoom = (await host.getRoomId?.()) || "sector-1";
        connectTrysteroRoom(initialRoom);

        if (!py) {
          let loadPyodide;
          try {
            ({ loadPyodide } = await import("https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs"));
          } catch (_) {
            ({ loadPyodide } = await import("https://cdn.jsdelivr.net/pyodide/v0.27.3/full/pyodide.mjs"));
          }
          py = await loadPyodide({
            stdout: log,
            stderr: log,
            stdin: () => {
              const s = prompt("");
              return s === null ? null : (log(s), s + "\\n");
            }
          });
          py._module.canvas = c;
          py.canvas?.setCanvas2D?.(c);
          py.canvas?.setCanvas3D?.(c);
          if (py._api) py._api._skip_unwind_fatal_error = true;
          document.pyodideMplTarget = o;
          await py.loadPackage(["micropip"]);
        }

        await restoreFS();
        updateSafeInsets();
        c.focus();
        o.textContent = "Loading dependencies...";
        init = 1;
        py.globals.set("__code__", pyCode);
        await py.runPythonAsync(\`
async def _boot():
    import ast, asyncio, base64, builtins, concurrent.futures as cf, getpass, importlib.util, io, js, micropip, multiprocessing as mp, os, pyodide, pyodide_js, re, sys, threading, time, webbrowser
    _t0 = time.time()
    code, extra = __code__, []
    try: ast.parse(code)
    except SyntaxError:
        code = re.sub(r"(?m)^\\\\s*[!%].*$", lambda m: (extra.extend(x for x in m.group(0).split("install", 1)[1].split() if not x.startswith("-")) if "pip install" in m.group(0) else None) or "# " + m.group(0), code)
    with open("/main.py", "w") as f: f.write(code)
    with open("/home/pyodide/main.py", "w") as f: f.write(code)
    globals()["__file__"], sys.argv[:] = "/home/pyodide/main.py", ["/home/pyodide/main.py"]
    os.environ.update({"TERM": "xterm", "PYGAME_HIDE_SUPPORT_PROMPT": "1"})
    try: await pyodide_js.loadPackagesFromImports(code)
    except Exception: pass
    PKG = {"PIL":"pillow","cv2":"opencv-python","sklearn":"scikit-learn","bs4":"beautifulsoup4","yaml":"pyyaml","dateutil":"python-dateutil","dotenv":"python-dotenv","pygame":"pygame-ce","skimage":"scikit-image","Crypto":"pycryptodome","fitz":"pymupdf","turtle":"basthon-turtle","serial":"pyserial","websocket":"websocket-client","jwt":"pyjwt","docx":"python-docx","pptx":"python-pptx"}
    imports = {p.split(".")[0] for p in pyodide.code.find_imports(code)} | set(extra)
    for p in imports:
        if p == "turtle" or not importlib.util.find_spec(p):
            try: await micropip.install(PKG.get(p, p))
            except Exception: pass
    importlib.invalidate_caches()
    if (imports & {"requests", "urllib", "urllib3", "http", "httpx"}) or importlib.util.find_spec("requests") or importlib.util.find_spec("urllib3"):
        try:
            await micropip.install("pyodide-http")
            import pyodide_http; pyodide_http.patch_all()
        except Exception: pass
    _sleep, _tasks = time.sleep, []
    def _ysleep(s=0):
        try: js.window.__maybeSyncFS()
        except Exception: pass
        try:
            if pyodide.ffi.can_run_sync(): return pyodide.ffi.run_sync(asyncio.sleep(max(0, float(s))))
        except Exception: pass
        _sleep(max(0, float(s)))
    time.sleep = _ysleep
    def _arun(coro, *a, **k):
        try:
            if pyodide.ffi.can_run_sync(): return pyodide.ffi.run_sync(coro)
        except Exception: pass
        t = asyncio.ensure_future(coro); _tasks.append(t); return t
    asyncio.run = _arun
    def _in(p=""):
        _ysleep(0); s = js.prompt(str(p))
        if s is None: raise EOFError
        print(f"{p}{s}", flush=True); return s
    builtins.input = getpass.getpass = _in
    os.get_terminal_size = lambda *a: os.terminal_size((80, 24))
    os.system = lambda cmd: (setattr(o_el, "textContent", "") if str(cmd).strip() in ("clear", "cls") else None) or 0
    webbrowser.open = lambda u, *a, **k: bool(js.window.open(str(u), "_blank"))
    threading.Thread.start = mp.Process.start = lambda s: s.run()
    threading.Thread.join = mp.Process.join = lambda s, *a: None
    class _Pool(cf.Executor):
        def __init__(s, *a, **k): pass
        def submit(s, fn, *a, **k):
            f = cf.Future()
            try: f.set_result(fn(*a, **k))
            except Exception as e: f.set_exception(e)
            return f
        def map(s, fn, *it, **k): return list(map(fn, *it))
        def starmap(s, fn, it, *a, **k): return [fn(*x) for x in it]
        def __enter__(s): return s
        def __exit__(s, *a): pass
        def close(s): pass
        def join(s): pass
    cf.ThreadPoolExecutor = cf.ProcessPoolExecutor = mp.Pool = _Pool
    o_el = js.document.getElementById("o")
    def _dom(tag, **k):
        el = js.document.createElement(tag); el.className = "matplotlib-figure"
        for a, v in k.items(): setattr(el, a, v)
        o_el.appendChild(el)
    _img = lambda b, m="png": _dom("img", src=f"data:image/{m};base64," + base64.b64encode(b).decode())
    if "matplotlib" in imports and importlib.util.find_spec("matplotlib"):
        import matplotlib; _use = matplotlib.use
        matplotlib.use = lambda b, *a, **k: _use("webagg" if str(b).lower().endswith(("tkagg","qt5agg","qtagg","macosx","gtk3agg","wxagg")) else b, *a, **k)
    if ("PIL" in imports or importlib.util.find_spec("PIL")):
        try:
            import PIL.Image
            PIL.Image.Image.show = lambda s, *a, **k: (b := io.BytesIO(), s.save(b, "PNG"), _img(b.getvalue()))
        except Exception: pass
    if "plotly" in imports and importlib.util.find_spec("plotly"):
        import plotly.basedatatypes as pbd
        pbd.BaseFigure.show = lambda s, *a, **k: _dom("iframe", srcdoc=s.to_html(include_plotlyjs="cdn"))
    if "pygame" in imports and importlib.util.find_spec("pygame"):
        import pygame
        _flip, _upd, _get, _poll = pygame.display.flip, pygame.display.update, pygame.event.get, pygame.event.poll
        pygame.display.flip = lambda: (_flip(), _ysleep(0))[0]
        pygame.display.update = lambda *a: (_upd(*a), _ysleep(0))[0]
        pygame.event.get = lambda *a, **k: (_ysleep(0), _get(*a, **k))[1]
        pygame.event.poll = lambda: (_ysleep(0), _poll())[1]
        pygame.time.wait = pygame.time.delay = lambda ms: (_ysleep(ms / 1000), int(ms))[1]
        pygame.time.Clock.tick = pygame.time.Clock.tick_busy_loop = lambda s, fps=0: (_ysleep(1 / fps if fps > 0 else 0), int(1000 / fps if fps > 0 else 16))[1]
    o_el.textContent = ""
    globals().pop("_boot", None); globals().pop("__code__", None)
    try:
        res = await pyodide.code.eval_code_async(code, globals(), filename="/home/pyodide/main.py")
        if _tasks: await asyncio.gather(*_tasks)
        if "turtle" in sys.modules and hasattr(sys.modules["turtle"], "svg"): _dom("div", innerHTML=sys.modules["turtle"].svg())
        if "matplotlib.pyplot" in sys.modules:
            plt = sys.modules["matplotlib.pyplot"]
            if plt.get_fignums() and not js.document.querySelector(".matplotlib-figure"):
                try: plt.show()
                except Exception: pass
                if not js.document.querySelector(".matplotlib-figure"):
                    for n in plt.get_fignums(): b = io.BytesIO(); plt.figure(n).savefig(b, format="png", bbox_inches="tight"); _img(b.getvalue())
        if res is not None:
            if hasattr(res, "_repr_png_") and (b := res._repr_png_()): _img(b)
            elif hasattr(res, "_repr_svg_") and (s := res._repr_svg_()): _dom("div", innerHTML=s)
            elif hasattr(res, "_repr_html_") and (s := res._repr_html_()): _dom("iframe", srcdoc=s)
            elif not o_el.textContent and not js.document.querySelector(".matplotlib-figure"): print(repr(res))
        if not js.document.querySelector(".matplotlib-figure"):
            for f in sorted(os.listdir(".")):
                if f.lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg")) and os.path.getmtime(f) >= _t0 - 1:
                    _img(open(f, "rb").read(), "svg+xml" if f.lower().endswith(".svg") else f.rsplit(".", 1)[-1].lower())
    finally:
        await js.window.__syncFS()
await _boot()\`);
      } catch (err) {
        if (err && err !== "unwind" && !/SystemExit:\\s*(None|0)/.test(err)) log(err);
        await syncFS();
      }
    },
    syncFS,
    joinP2PRoom: connectTrysteroRoom,
    async resetStorage() {
      if (host) await host.clearAll();
      try { window.localStorage.clear(); } catch (_) {}
      knownFiles.clear();
    }
  }, Comlink.windowEndpoint(window.parent));
  <\/script></body></html>`;

  // 4. Boot the Isolated Iframe & Execute pyasteroidsjs.py via Comlink
  await new Promise((resolve) => {
    iframe.onload = resolve;
    iframe.srcdoc = iframeHtml;
  });

  const runner = Comlink.wrap(Comlink.windowEndpoint(iframe.contentWindow));
  const pyCode = await fetch("https://raw.githubusercontent.com/438885/pyasteroidsjs/refs/heads/main/pyasteroidsjs.py").then((r) => r.text());
  await runner.run(pyCode, hostStorage);
})();