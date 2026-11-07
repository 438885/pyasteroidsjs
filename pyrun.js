(async () => {
  const Comlink = await import("https://cdn.jsdelivr.net/npm/comlink@4.4.2/+esm");

  document.body.innerHTML = `
    <style>*{margin:0;box-sizing:border-box}body,iframe{width:100vw;height:100vh;border:0;background:#000;overflow:hidden;display:block}</style>
    <iframe id="runner" sandbox="allow-scripts allow-modals allow-pointer-lock allow-popups allow-same-origin"></iframe>`;
  const iframe = document.getElementById("runner");

  const iframeHtml = `<!DOCTYPE html><html><head><style>
  *{margin:0;box-sizing:border-box}body{background:#000;color:#fff;overflow:hidden}
  #canvas{position:fixed;inset:0;width:100vw;height:100vh;object-fit:contain;display:block}
  #o{position:fixed;inset:0;padding:12px;font:16px monospace;overflow:auto;white-space:pre-wrap;pointer-events:none;text-shadow:0 1px 2px #000}
  .matplotlib-figure{position:relative;z-index:2;background:#fff;color:#000;margin:12px auto;max-width:95vw;border-radius:4px;display:block;pointer-events:auto}
  iframe.matplotlib-figure{width:95vw;height:75vh;border:0}
  </style></head><body>
  <canvas id="canvas" tabindex="-1"></canvas>
  <pre id="o">Loading runtime...</pre>
  <script type="module">
  import * as Comlink from "https://cdn.jsdelivr.net/npm/comlink@4.4.2/+esm";
  const c = document.getElementById("canvas"), o = document.getElementById("o");
  let init = 1, pyPromise = null, onLogProxy = null;

  const log = (t) => {
    if (init) { o.textContent = ""; init = 0; }
    const s = String(t?.message || t);
    o.append(s.endsWith("\\n") ? s : s + "\\n");
    o.scrollTop = o.scrollHeight;
    onLogProxy?.(s);
  };
  window.onwheel = (e) => { if (!e.target.closest?.(".matplotlib-figure")) o.scrollTop += e.deltaY; };

  async function ensurePyodide() {
    if (pyPromise) return pyPromise;
    pyPromise = (async () => {
      const { loadPyodide } = await import("https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs");
      const py = await loadPyodide({
        stdout: log, stderr: log,
        stdin: () => { const s = prompt(""); return s === null ? null : (log(s), s + "\\n"); }
      });
      py._module.canvas = c;
      py.canvas?.setCanvas2D?.(c);
      py.canvas?.setCanvas3D?.(c);
      if (py._api) py._api._skip_unwind_fatal_error = true;
      document.pyodideMplTarget = o;
      await py.loadPackage(["micropip"]);
      return py;
    })();
    return pyPromise;
  }

  Comlink.expose({
    async run(pyCode, hostLogger = null) {
      onLogProxy = hostLogger;
      try {
        const py = await ensurePyodide();
        c.focus();
        o.textContent = "Loading dependencies...";
        init = 1;
        py.globals.set("__code__", pyCode);
        await py.runPythonAsync(\`
async def _boot():
    import ast, asyncio, base64, builtins, concurrent.futures as cf, getpass, importlib.util, io, js, micropip, multiprocessing as mp, os, pyodide, pyodide_js, re, sys, threading, time, webbrowser
    code, extra = __code__, []
    try: ast.parse(code)
    except SyntaxError:
        code = re.sub(r"(?m)^\\\\s*[!%].*$", lambda m: (extra.extend(x for x in m.group(0).split("install", 1)[1].split() if not x.startswith("-")) if "pip install" in m.group(0) else None) or "# " + m.group(0), code)
    with open("/main.py", "w") as f: f.write(code)
    globals()["__file__"], sys.argv[:] = "/main.py", ["/main.py"]
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
    res = await pyodide.code.eval_code_async(code, globals(), filename="/main.py")
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
            if f.lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg")):
                _img(open(f, "rb").read(), "svg+xml" if f.lower().endswith(".svg") else f.rsplit(".", 1)[-1].lower())
await _boot()\`);
      } catch (err) {
        if (err && err !== "unwind" && !/SystemExit:\\s*(None|0)/.test(err)) log(err);
      }
    }
  }, Comlink.windowEndpoint(window.parent));
  <\/script></body></html>`;

  await new Promise((resolve) => {
    iframe.onload = resolve;
    iframe.srcdoc = iframeHtml;
  });

  const runner = Comlink.wrap(Comlink.windowEndpoint(iframe.contentWindow));
  const pyCode = await fetch("./pyasteroidsjs.py").then((r) => r.text());
  await runner.run(pyCode, Comlink.proxy((msg) => console.debug("[Pyodide]", msg)));
})();