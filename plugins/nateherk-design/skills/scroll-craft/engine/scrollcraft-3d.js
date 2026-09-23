/* ============================================================================
   scrollcraft-3d: the optional three.js route for a scroll act
   ----------------------------------------------------------------------------
   An ES module that sits BESIDE the engine, never inside it. scrollcraft.js
   stays dependency-free; this file is small and imports nothing until an act
   that needs a renderer comes within reach. Recipe, decision table and the
   poster workflow: references/three-d.md.

     <section data-sc-act="pin" data-sc-span="3">
       <div data-sc-stage>
         <picture>
           <source media="(max-width: 860px)" srcset="assets/poster-m.webp">
           <img class="sc-stage__poster" src="assets/poster.webp" alt="...">
         </picture>
         <canvas data-sc-3d="assets/model.glb" data-sc-3d-spin="0 300"
                 data-sc-3d-light="20 160" aria-hidden="true"></canvas>
         <div class="sc-copy" data-sc-cue="0.1 0.8"> ... </div>
       </div>
     </section>
     <script src="scrollcraft.js"></script>
     <script>ScrollCraft.mount(document.body);</script>
     <script type="module">
       import ScrollCraft3D from './scrollcraft-3d.js';
       ScrollCraft3D.mount(document.body);
     </script>

   ---------------------------------------------------------------------------
   ATTRIBUTES (on the canvas)
   ---------------------------------------------------------------------------
     data-sc-3d          path to the .glb / .gltf. Required.
     data-sc-3d-spin     "a b" yaw in degrees across p 0..1. Default "0 180".
     data-sc-3d-tilt     "a b" pitch in degrees across p. Default "0 0".
     data-sc-3d-light    "a b" key-light azimuth across p. Default "0 0".
                         0 is the classic three-quarter key (40 degrees to the
                         camera's right); the value is added to that. Material
                         response comes from the light moving, not the object.
     data-sc-3d-pointer  0..1, pointer influence on yaw and pitch as a fraction
                         of the spin range. Default 0. Fine pointer only.
     data-sc-3d-dpr      pixel-ratio cap, clamped 1..2. Default 1.5.
     data-sc-3d-env      path to an .hdr environment. Default: a small built-in
                         softbox, so metals have something to reflect.
     data-sc-3d-poster-p the progress the poster was captured at (poster-3d.mjs
                         reads it). Default 0.
     data-sc-media       lite | full on the canvas overrides the page's media
                         mode for this scene only, as it does for a clip.

   ---------------------------------------------------------------------------
   THE CONTRACT
   ---------------------------------------------------------------------------
   Progress comes from the engine's own act record: the stage's visible-life
   progress (the one a scrub clip uses) when the engine publishes it, else p.
   Nothing here measures scroll on its own except the warm fallback below.

   Lazy. three.js is imported the first time the act is WARM: the engine's
   sc:warm event and act.warm when the engine has them, otherwise the same
   window computed from the act's rect (3 viewports ahead, 1.5 behind). Until
   the first frame renders the .sc-stage__poster stays up; then the module
   adds sc-has-clip to the act and the canvas and the stylesheet's existing
   poster crossfade runs, exactly as for a clip.

   Held. No WebGL, prefers-reduced-motion, or the engine's lite media mode:
   three.js is never imported and the poster holds for the life of the page.
   The poster is a capture of the real scene, so the held state is exact.
   A lite hold is re-checked on later reads (the V3 rule: a connection that
   recovers lets assets not yet requested load); the others are permanent.

   Render on change. No animation loop. A frame renders only while the act is
   live, and only when progress moved past a 0.001 deadband, the pointer
   moved, or the canvas resized. With several 3D acts, only the most visible
   live one renders; the others hold their last frame. Contexts are kept when
   an act leaves live: recreating one on every re-entry costs more than
   holding it. preserveDrawingBuffer is always false on the live canvas.

   Engine connection, feature-detected: api.subscribe(fn) when the engine has
   it, else a passive scroll/resize listener that reads the act records in a
   rAF (after the engine's own read) and settles for a few frames.

   handle = ScrollCraft3D.mount(root?, opts?)
     opts.api     the ScrollCraft api (default: the instance that owns the act)
     opts.vendor  base URL of vendored three.js (default ./vendor/three/ next
                  to this file). scripts/vendor-three.mjs writes it.
     opts.scene   ({ THREE, scene, camera, renderer, model, pivot, key, act,
                  canvas }) => void, once, after the default scene is built.
     opts.frame   (ctx, p, pointer|null) => void, before every render, after
                  the attribute choreography. The page's signature move lives
                  here, in page code, with the engine untouched.
   handle.capture(act|canvas|selector, { p, width, height, dpr, type, quality })
                  -> Promise<Blob>. A throwaway renderer with
                  preserveDrawingBuffer: true renders one frame of the same
                  scene. poster-3d.mjs drives it.
   handle.destroy() disposes geometry, materials, textures and the renderer,
                  forces context loss, removes every listener, and puts the
                  poster back. Idempotent.
   handle.stats.renders, handle.scenes: read by the verification tests.
   ========================================================================== */

const MODULE_VERSION = '0.1.0';
const DEADBAND = 0.001;           // progress change that earns a new frame
const POINTER_LERP = 0.09;        // same weight as the engine's tilt device
const WARM_AHEAD = 3, WARM_BEHIND = 1.5;   // viewports; matches the engine
const KEY_BASE_DEG = 40;          // azimuth 0 = a three-quarter key light
const FOV = 32;

const DEFAULT_VENDOR = new URL('./vendor/three/', import.meta.url).href;
const handles = [];
const libCache = new Map();       // vendor base -> Promise<{ THREE, GLTFLoader, DRACOLoader }>
const lostExt = new WeakMap();    // canvas -> WEBGL_lose_context, for a remount
let webglOK = null;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const rad = (d) => (d * Math.PI) / 180;

function pair(el, name, dflt) {
  const v = (el.getAttribute(name) || '').trim().split(/\s+/).map(parseFloat);
  const a = isNaN(v[0]) ? dflt[0] : v[0];
  const b = v.length > 1 && !isNaN(v[1]) ? v[1] : isNaN(v[0]) ? dflt[1] : a;
  return [a, b];
}
function numAttr(el, name, dflt) {
  const v = parseFloat(el.getAttribute(name));
  return isNaN(v) ? dflt : v;
}

// Probe on a throwaway canvas. Probing the real canvas would bind it to a
// context with default attributes, and three's later getContext call would
// silently get that one back with its own attributes ignored.
function hasWebGL() {
  if (webglOK !== null) return webglOK;
  let gl = null;
  try {
    const c = document.createElement('canvas');
    gl = c.getContext('webgl2') || c.getContext('webgl');
  } catch (e) { gl = null; }
  webglOK = !!gl;
  if (gl) {
    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  }
  return webglOK;
}

function reducedMotion() {
  const SC = globalThis.ScrollCraft;
  return !!(SC && SC.reduce) || matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function loadLib(base) {
  if (!libCache.has(base)) {
    const p = Promise.all([
      import(base + 'three.module.js'),
      import(base + 'addons/loaders/GLTFLoader.js'),
      import(base + 'addons/loaders/DRACOLoader.js'),
    ]).then(([THREE, g, d]) => ({ THREE, GLTFLoader: g.GLTFLoader, DRACOLoader: d.DRACOLoader }));
    p.catch(() => libCache.delete(base));
    libCache.set(base, p);
  }
  return libCache.get(base);
}

// A small built-in environment: a dim room with three softboxes. Without an
// environment a PBR metal reflects nothing and renders nearly black, which
// reads as a broken model rather than a dark one.
function softboxScene(THREE) {
  const s = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0x1a1a1c, side: THREE.BackSide }));
  s.add(room);
  const panel = (w, h, x, y, z, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k) }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m);
  };
  panel(4, 3, 3.5, 2.5, 3.5, 6);     // key side
  panel(3, 2, -4, 1, 2, 1.6);        // fill
  panel(6, 1.2, 0, 4.5, -2, 3);      // top rim
  return s;
}
function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    mats.forEach((m) => {
      Object.keys(m).forEach((k) => { const v = m[k]; if (v && v.isTexture) v.dispose(); });
      m.dispose();
    });
  });
}

function configureRenderer(THREE, r) {
  r.setClearColor(0x000000, 0);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1;
}

// One environment per renderer: a PMREM result is a render target, and a
// render target belongs to the context that made it.
function makeEnv(S, THREE, renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  let rt;
  if (S.hdr) {
    rt = pm.fromEquirectangular(S.hdr);
  } else {
    const box = softboxScene(THREE);
    rt = pm.fromScene(box, 0.04);
    disposeObject(box);
  }
  pm.dispose();
  return rt;
}

// Fit the unit-radius model into whichever field of view is narrower, so a
// phone's portrait canvas keeps the whole object in frame.
function fitCamera(THREE, cam, aspect) {
  cam.aspect = aspect || 1;
  const v = rad(cam.fov);
  const h = 2 * Math.atan(Math.tan(v / 2) * cam.aspect);
  const d = 1.12 / Math.sin(Math.min(v, h) / 2);
  cam.position.set(0, 0, d);
  cam.near = Math.max(d - 3, 0.01);
  cam.far = d + 3;
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
}

// ============================================================================
function mount(root, opts) {
  if (root && !(root.nodeType || typeof root === 'string')) { opts = root; root = null; }
  root = typeof root === 'string' ? document.querySelector(root) : (root || document);
  opts = opts || {};
  const vendor = opts.vendor ? new URL(opts.vendor, document.baseURI).href.replace(/\/?$/, '/') : DEFAULT_VENDOR;

  let alive = true;
  const subs = [];           // unsubscribe / removeEventListener closures
  const apis = new Set();
  let fallbackOn = false, raf = 0, still = 0, pRaf = 0;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  let draco = null;

  const H = {
    scenes: [], stats: { renders: 0 }, destroyed: false, vendor,
    capture, destroy, version: MODULE_VERSION,
  };

  const listen = (t, type, fn, o) => { t.addEventListener(type, fn, o); subs.push(() => t.removeEventListener(type, fn, o)); };

  // ---- collect ---------------------------------------------------------------
  root.querySelectorAll('canvas[data-sc-3d]').forEach((canvas) => {
    const act = canvas.closest('[data-sc-act]');
    const url = canvas.getAttribute('data-sc-3d');
    if (!act || !url) {
      console.warn('[scrollcraft-3d] canvas needs a data-sc-3d model path and a [data-sc-act] ancestor; skipped.', canvas);
      return;
    }
    const stage = canvas.closest('[data-sc-stage], .sc-stage') || act;
    const S = {
      act, canvas, stage, url,
      poster: stage.querySelector('.sc-stage__poster'),
      spot: canvas.closest('[data-sc-spotlight]'),
      cfg: {
        spin: pair(canvas, 'data-sc-3d-spin', [0, 180]),
        tilt: pair(canvas, 'data-sc-3d-tilt', [0, 0]),
        light: pair(canvas, 'data-sc-3d-light', [0, 0]),
        pointer: clamp(numAttr(canvas, 'data-sc-3d-pointer', 0), 0, 1),
        dpr: clamp(numAttr(canvas, 'data-sc-3d-dpr', 1.5), 1, 2),
        env: canvas.getAttribute('data-sc-3d-env'),
        media: canvas.getAttribute('data-sc-media'),
      },
      origW: canvas.getAttribute('width'), origH: canvas.getAttribute('height'),
      api: null, rec: null, state: 'idle', hold: null,
      lastP: NaN, renders: 0, painted: false, sizeDirty: true,
      px: 0, py: 0, tx: 0, ty: 0, pointerOn: false,
    };
    // Diagnostic: render the live canvas at an exact progress now. The tests
    // use it to compare the live frame with capture(); pages never need it.
    S.render = (p) => render(S, p);
    H.scenes.push(S);
    listen(act, 'sc:warm', () => update());
  });

  // ---- engine connection -------------------------------------------------------
  function resolve(S) {
    // Only while the record is still the engine's: rescan() rebuilds the acts
    // array with new records, and a stale one never moves again, so the scene
    // would freeze on its last frame.
    if (S.rec && S.api && !S.api.destroyed && S.api.acts && S.api.acts.indexOf(S.rec) > -1) return;
    S.api = null; S.rec = null;
    const list = opts.api ? [opts.api] : ((globalThis.ScrollCraft && globalThis.ScrollCraft.instances) || []).slice().reverse();
    for (const api of list) {
      const rec = api && !api.destroyed && api.acts && api.acts.find((a) => a.el === S.act);
      if (rec) { S.api = api; S.rec = rec; break; }
    }
    if (S.api && !apis.has(S.api) && typeof S.api.subscribe === 'function') {
      apis.add(S.api);
      const off = S.api.subscribe(() => update());
      if (typeof off === 'function') subs.push(off);
    }
  }
  function needsFallback() {
    return H.scenes.some((S) => !S.api || typeof S.api.subscribe !== 'function');
  }
  function syncFallback() {
    const want = needsFallback();
    if (want && !fallbackOn) {
      fallbackOn = true;
      listen(window, 'scroll', schedule, { passive: true });
      listen(window, 'resize', schedule, { passive: true });
    }
  }
  function schedule() { if (!raf && alive) raf = requestAnimationFrame(settle); }
  // Runs after the engine's read() for the same scroll event (its listener was
  // attached first), and keeps checking for a few quiet frames so a layout the
  // engine does outside a scroll event is still picked up.
  function settle() {
    raf = 0;
    if (update()) { still = 0; schedule(); } else if (++still < 3) schedule();
  }

  function progress(S) {
    const r = S.rec;
    if (!r) return 0;
    return typeof r.vp === 'number' ? r.vp : r.p;
  }
  function isWarm(S) {
    if (S.rec && typeof S.rec.warm === 'boolean') return S.rec.warm;
    const b = S.act.getBoundingClientRect(), vh = innerHeight;
    return b.top < vh * WARM_AHEAD && b.bottom > -vh * WARM_BEHIND;
  }
  function visible(S) {
    const b = S.canvas.getBoundingClientRect();
    const h = Math.max(0, Math.min(b.bottom, innerHeight) - Math.max(b.top, 0));
    return b.height > 0 ? h / b.height : 0;
  }
  function holdReason(S) {
    if (!hasWebGL()) return 'no-webgl';
    if (reducedMotion()) return 'reduce';
    if (S.cfg.media === 'full') return null;
    if (S.cfg.media === 'lite') return 'lite';
    if ((S.api && S.api.media === 'lite') || S.act.closest('.sc-lite')) return 'lite';
    return null;
  }

  // Returns true when any scene's progress moved, so the fallback keeps
  // settling while the reader is still scrolling.
  function update() {
    if (!alive) return false;
    let moved = false, best = null, bestVis = 0;
    for (const S of H.scenes) {
      resolve(S);
      if (S.state === 'held' && S.hold === 'lite' && !holdReason(S)) { S.state = 'idle'; S.hold = null; }
      if (S.state === 'idle' && isWarm(S)) start(S);
      const p = progress(S);
      if (S.seenP !== undefined && p !== S.seenP) moved = true;
      S.seenP = p;
      if (S.state !== 'ready' || !S.rec || !S.rec.live) continue;
      const v = visible(S);
      if (v > bestVis) { best = S; bestVis = v; }
    }
    H.live = best;
    if (best) {
      const p = progress(best);
      if (best.sizeDirty || !(Math.abs(p - best.lastP) <= DEADBAND)) render(best, p);
    }
    syncFallback();
    return moved;
  }

  // ---- load and build ----------------------------------------------------------------
  // force: capture() needs the scene even when the page holds its poster
  // (reduced motion, lite). A forced build under a hold stays 'held': it
  // never renders to the live canvas and never hides the poster.
  async function start(S, force) {
    let hold = holdReason(S);
    if (hold === 'no-webgl' || (hold && !force)) { S.state = 'held'; S.hold = hold; return; }
    if (!S.built) {
      S.state = 'loading';
      if (!S.loading) S.loading = load(S).finally(() => { S.loading = null; });
      await S.loading;
      if (!S.built || !alive) return;
    }
    hold = holdReason(S);
    if (hold) { S.state = 'held'; S.hold = hold; return; }
    if (S.state === 'ready') return;
    S.state = 'ready'; S.hold = null; S.sizeDirty = true;
    render(S, progress(S));     // one frame now, live or not: the canvas must hold a real frame before the poster goes
    update();
  }
  async function load(S) {
    try {
      const { THREE, GLTFLoader, DRACOLoader } = await loadLib(vendor);
      if (!alive) return;
      if (!draco) {
        draco = new DRACOLoader();
        draco.setDecoderPath(vendor + 'addons/libs/draco/gltf/');
      }
      const loader = new GLTFLoader();
      loader.setDRACOLoader(draco);
      const gltf = await loader.loadAsync(new URL(S.url, document.baseURI).href);
      if (!alive) { disposeObject(gltf.scene); return; }
      if (S.cfg.env) {
        const { HDRLoader } = await import(vendor + 'addons/loaders/HDRLoader.js');
        S.hdr = await new HDRLoader().loadAsync(new URL(S.cfg.env, document.baseURI).href);
        S.hdr.mapping = THREE.EquirectangularReflectionMapping;
        if (!alive) { S.hdr.dispose(); disposeObject(gltf.scene); return; }
      }
      await restoreIfLost(S.canvas);
      if (!alive) { disposeObject(gltf.scene); return; }
      build(S, THREE, gltf.scene);
      S.built = true;
    } catch (e) {
      S.state = 'failed';
      console.warn('[scrollcraft-3d] scene for "' + (S.act.id || S.url) + '" failed; the poster holds.', e);
    }
  }

  // After destroy() forced a context loss, the canvas keeps that lost context
  // forever, and a remount on the same element (React StrictMode does exactly
  // this) would get it back dead. Restore it first.
  function restoreIfLost(canvas) {
    const ext = lostExt.get(canvas);
    if (!ext) return Promise.resolve();
    lostExt.delete(canvas);
    return new Promise((res, rej) => {
      let t = 0;
      const done = (ok) => {
        clearTimeout(t);
        canvas.removeEventListener('webglcontextrestored', onRestored);
        if (ok) res(); else rej(new Error('the canvas WebGL context could not be restored after destroy()'));
      };
      const onRestored = () => done(true);
      canvas.addEventListener('webglcontextrestored', onRestored);
      t = setTimeout(() => done(false), 2000);
      try { ext.restoreContext(); } catch (e) { done(false); }
    });
  }

  function build(S, THREE, model) {
    const renderer = new THREE.WebGLRenderer({ canvas: S.canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
    configureRenderer(THREE, renderer);
    const scene = new THREE.Scene();
    const pivot = new THREE.Group();
    const fit = new THREE.Group();
    const box = new THREE.Box3().setFromObject(model);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    model.position.sub(sphere.center);
    fit.scale.setScalar(1 / Math.max(sphere.radius, 1e-6));
    fit.add(model); pivot.add(fit); scene.add(pivot);

    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x202024, 0.35));
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 100);

    Object.assign(S, { THREE, renderer, scene, pivot, fit, model, key, camera });
    S.envRT = makeEnv(S, THREE, renderer);
    scene.environment = S.envRT.texture;
    S.ctx = { THREE, scene, camera, renderer, model, pivot, key, act: S.act, canvas: S.canvas };
    if (typeof opts.scene === 'function') opts.scene(S.ctx);
    wirePointer(S);
    // A real context loss (GPU reset, driver update, too many contexts) is
    // survivable: three rebuilds its own state on restore and re-uploads
    // anything with source data. The environment has none, it is a PMREM
    // render target, so it comes back black unless it is made again here.
    // three's own restore handler was attached first (in the renderer's
    // constructor), so this runs after it.
    listen(S.canvas, 'webglcontextrestored', () => {
      if (!alive || !S.renderer) return;
      // The old target's GL objects died with the old context; disposing it
      // now would only make WebGL warn about foreign objects. Drop it.
      S.envRT = makeEnv(S, S.THREE, S.renderer);
      S.scene.environment = S.envRT.texture;
      S.envRestores = (S.envRestores || 0) + 1;
      S.sizeDirty = true;
      render(S, isNaN(S.lastP) ? progress(S) : S.lastP);
    });
  }

  function choreograph(S, p, pointer, cam) {
    const c = S.cfg;
    const range = Math.abs(c.spin[1] - c.spin[0]);
    const k = pointer ? c.pointer * range : 0;
    S.pivot.rotation.set(
      rad(lerp(c.tilt[0], c.tilt[1], p) + (pointer ? pointer.y * k : 0)),
      rad(lerp(c.spin[0], c.spin[1], p) + (pointer ? pointer.x * k : 0)),
      0);
    const az = rad(KEY_BASE_DEG + lerp(c.light[0], c.light[1], p));
    S.key.position.set(Math.sin(az) * 5, 3.2, Math.cos(az) * 5);
    if (typeof opts.frame === 'function') opts.frame(Object.assign({}, S.ctx, { camera: cam || S.camera }), p, pointer);
  }

  function resize(S) {
    const cw = S.canvas.clientWidth, ch = S.canvas.clientHeight;
    const pr = Math.min(devicePixelRatio || 1, S.cfg.dpr);
    if (!cw || !ch) return false;
    if (cw !== S.w || ch !== S.h || pr !== S.pr || S.sizeDirty) {
      S.renderer.setPixelRatio(pr);
      S.renderer.setSize(cw, ch, false);
      fitCamera(S.THREE, S.camera, cw / ch);
      S.w = cw; S.h = ch; S.pr = pr;
    }
    S.sizeDirty = false;
    return true;
  }

  function render(S, p) {
    if (S.state !== 'ready' || !alive) return;
    if (!resize(S)) return;
    choreograph(S, p, S.pointerOn ? { x: S.px, y: S.py } : null);
    S.renderer.render(S.scene, S.camera);
    S.lastP = p; S.renders++; H.stats.renders++;
    if (!S.painted) {
      S.painted = true;
      S.addedAct = !S.act.classList.contains('sc-has-clip');
      S.act.classList.add('sc-has-clip');
      S.canvas.classList.add('sc-has-clip');
    } else if (!S.act.classList.contains('sc-has-clip') || !S.canvas.classList.contains('sc-has-clip')) {
      // Something else restored the act's classes (a framework re-render, an
      // engine rescan). The canvas is painted, so the poster must stay down.
      S.act.classList.add('sc-has-clip');
      S.canvas.classList.add('sc-has-clip');
    }
  }

  // ---- pointer -------------------------------------------------------------------
  // Gated like every pointer device in the engine: a fine hovering pointer and
  // no reduced motion. One pointer source per page when a spotlight exists
  // (its --sc-mx/--sc-my), otherwise the act's own pointermove. Never pointer
  // lock or capture.
  function wirePointer(S) {
    if (!S.cfg.pointer || !fine || reducedMotion()) return;
    S.pointerOn = true;
    if (S.spot) {
      listen(window, 'pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        requestAnimationFrame(() => {
          const mx = parseFloat(S.spot.style.getPropertyValue('--sc-mx'));
          const my = parseFloat(S.spot.style.getPropertyValue('--sc-my'));
          if (!isNaN(mx) && !isNaN(my)) aim(S, mx * 2 - 1, my * 2 - 1);
        });
      }, { passive: true });
    } else {
      listen(S.act, 'pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        const b = S.canvas.getBoundingClientRect();
        aim(S, clamp((e.clientX - b.left) / b.width * 2 - 1, -1, 1), clamp((e.clientY - b.top) / b.height * 2 - 1, -1, 1));
      }, { passive: true });
      listen(S.act, 'pointerleave', () => aim(S, 0, 0), { passive: true });
    }
  }
  function aim(S, x, y) {
    S.tx = x; S.ty = y;
    if (!pRaf) pRaf = requestAnimationFrame(pointerTick);
  }
  // Runs only while some pointer is still travelling toward its target, and
  // only renders the live scene. At rest it stops; nothing loops forever.
  // POINTER_LERP is the weight per 60 Hz frame, applied by elapsed time, so the
  // settle takes the same wall time at 30 fps on a slow phone as at 60 fps
  // (per-frame weighting doubled it there, which reads as sluggish).
  let pLast = 0;
  function pointerTick(now) {
    pRaf = 0;
    if (!alive) return;
    const dt = pLast ? Math.min(now - pLast, 100) : 1000 / 60;
    pLast = now;
    const k = 1 - Math.pow(1 - POINTER_LERP, dt / (1000 / 60));
    let busy = false;
    for (const S of H.scenes) {
      if (!S.pointerOn) continue;
      const dx = S.tx - S.px, dy = S.ty - S.py;
      if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) continue;
      S.px += dx * k; S.py += dy * k;
      if (S === H.live) { render(S, progress(S)); busy = true; }
    }
    if (busy) pRaf = requestAnimationFrame(pointerTick);
    else pLast = 0;
  }

  // A resize clears the drawing buffer, so every ready scene re-renders once,
  // live or not; otherwise a held scene would show an empty canvas with its
  // poster already faded out.
  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => {
    for (const S of H.scenes) if (S.state === 'ready') { S.sizeDirty = true; render(S, isNaN(S.lastP) ? progress(S) : S.lastP); }
  }) : null;
  if (ro) { H.scenes.forEach((S) => ro.observe(S.canvas)); subs.push(() => ro.disconnect()); }

  // ---- capture -------------------------------------------------------------------
  async function capture(target, o) {
    o = o || {};
    if (!alive) throw new Error('capture: handle destroyed');
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    const S = H.scenes.find((s) => s.act === el || s.canvas === el || (el && el.contains && el.contains(s.canvas)));
    if (!S) throw new Error('capture: no data-sc-3d scene in that element');
    if (!hasWebGL()) throw new Error('capture: WebGL is not available');
    if (!S.built) {
      await start(S, true);
      if (!alive) throw new Error('capture: handle destroyed');
      if (!S.built) throw new Error('capture: the scene did not load');
    }
    const { THREE } = S;
    const w = Math.round(o.width || S.canvas.clientWidth || 1440);
    const h = Math.round(o.height || S.canvas.clientHeight || 900);
    const c = document.createElement('canvas');
    const r = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
    const liveEnv = S.scene.environment;
    let env = null;
    try {
      configureRenderer(THREE, r);
      r.setPixelRatio(o.dpr || 1);
      r.setSize(w, h, false);
      const cam = S.camera.clone();
      fitCamera(THREE, cam, w / h);
      env = makeEnv(S, THREE, r);
      S.scene.environment = env.texture;
      choreograph(S, typeof o.p === 'number' ? clamp(o.p, 0, 1) : numAttr(S.canvas, 'data-sc-3d-poster-p', 0), null, cam);
      r.render(S.scene, cam);
      return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('capture: toBlob returned null'))),
        o.type || 'image/png', o.quality));
    } finally {
      S.scene.environment = liveEnv;
      if (env) env.dispose();
      r.dispose();
      r.forceContextLoss();
      S.lastP = NaN;            // the pivot moved; the next live read re-renders
    }
  }

  // ---- destroy -------------------------------------------------------------------
  function destroy() {
    if (!alive) return;
    alive = false;
    H.destroyed = true;
    if (raf) cancelAnimationFrame(raf);
    if (pRaf) cancelAnimationFrame(pRaf);
    subs.splice(0).forEach((off) => { try { off(); } catch (e) {} });
    for (const S of H.scenes) {
      if (S.renderer) {
        disposeObject(S.scene);
        if (S.envRT) S.envRT.dispose();
        if (S.hdr) S.hdr.dispose();
        const gl = S.renderer.getContext();
        const ext = gl && gl.getExtension('WEBGL_lose_context');
        S.renderer.dispose();
        // A lost context can only ever be restored if its webglcontextlost
        // event had preventDefault() called. dispose() has just removed
        // three's own handler, so keep the canvas restorable here; otherwise
        // a remount on this element would find it dead for good.
        S.canvas.addEventListener('webglcontextlost', (e) => e.preventDefault(), { once: true });
        S.renderer.forceContextLoss();
        if (ext) lostExt.set(S.canvas, ext);
      }
      if (S.painted) {
        if (S.addedAct) S.act.classList.remove('sc-has-clip');
        S.canvas.classList.remove('sc-has-clip');
      }
      if (S.origW === null) S.canvas.removeAttribute('width'); else S.canvas.setAttribute('width', S.origW);
      if (S.origH === null) S.canvas.removeAttribute('height'); else S.canvas.setAttribute('height', S.origH);
      S.state = 'destroyed';
      S.renderer = S.scene = S.model = S.ctx = null;
    }
    if (draco) { draco.dispose(); draco = null; }
    const i = handles.indexOf(H);
    if (i > -1) handles.splice(i, 1);
  }

  handles.push(H);
  if (!H.scenes.length) return H;
  H.scenes.forEach(resolve);
  syncFallback();
  update();
  if (fallbackOn) schedule();
  return H;
}

// The handle list is not an API for the page. It is how poster-3d.mjs and the
// verification tests find the live handle without the page exporting it.
const ScrollCraft3D = { mount, handles, version: MODULE_VERSION };
if (typeof globalThis !== 'undefined' && !globalThis.ScrollCraft3D) globalThis.ScrollCraft3D = ScrollCraft3D;
export { mount };
export default ScrollCraft3D;
