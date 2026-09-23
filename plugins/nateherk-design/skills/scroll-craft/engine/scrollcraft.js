/* ============================================================================
   scrollcraft: a scroll-driven interaction runtime
   ----------------------------------------------------------------------------
   Vanilla JS. Zero dependencies. Zero DOM generation.

   The engine does NOT build your page. You author real, semantic HTML and mark
   it up with data-sc-* attributes; the engine reads them and drives them from a
   single scroll value on a single rAF loop. That is deliberate: a runtime that
   generates its own DOM from a config object makes every site it touches look
   identical, which is the failure mode this replaces.

   ---------------------------------------------------------------------------
   ACTS: the unit of scroll time
   ---------------------------------------------------------------------------
     <section data-sc-act="pin" data-sc-span="2.5"> ... </section>

     data-sc-act   scrub | pin | pan | flow   (default: flow)
     data-sc-clip-map="travel" opts a pinned act OUT of full-life clip mapping.
                   By DEFAULT a scrub clip is mapped across the stage's entire
                   on-screen life, not across its pinned travel, because a pinned
                   stage is visible for a viewport BEFORE the pin begins (sliding
                   up into view) and a viewport AFTER it ends (sliding off the
                   top). Mapped to pinned travel, the clip sits on its first
                   frame through the whole entry and its last frame through the
                   whole exit: the reader watches a still photograph while the
                   page moves. Pair it with data-sc-dwell, which moves quickly at
                   the edges and settles in the middle, so the fast motion lands
                   on the two slides and the settle lands inside the pin where
                   the copy is. data-sc-runout is accepted and ignored; it named
                   the old opt-in for the exit half of this.
     data-sc-span  viewport-heights of scroll this act owns. Pinned devices only
                   (scrub/pin/pan). Default 1.5. The engine sets the outer
                   height and sticks the first .sc-stage / [data-sc-stage] child.

     Every act exposes a normalized progress p (0..1):
       pinned  p = (y - top) / (height - vh)
       flow    p = (y + vh - top) / (height + vh)
     and publishes it as --sc-p on the act element, so CSS can read it too.

   ---------------------------------------------------------------------------
   DEVICES: what p drives
   ---------------------------------------------------------------------------
     data-sc-scrub            on <video>. p scrubs currentTime. Blob-loaded, so
                              it seeks without needing HTTP range support.
     data-sc-sequence="a/{i}.webp:120:1"
                              on <canvas>. p scrubs an image sequence
                              (path template : frameCount : startIndex).
     data-sc-pan="0.6"        on a wide rail inside data-sc-act="pan". p drives
                              horizontal travel. Value = extra travel multiplier.
     data-sc-parallax="-0.2"  translateY by rate * act-progress * viewport.
                              Negative = moves up faster than scroll (recedes).
     data-sc-cue="0.1 0.5"    opacity/rise keyed to p. One value = enter+hold.
                              Two = enter..leave. Add a third for the hold point.
     data-sc-kinetic="lines"  lines | words | chars. Splits the element and
                              staggers its reveal across the cue window.
     data-sc-reveal="up"      up | down | left | right | iris. clip-path wipe.
     data-sc-count="0 4200"   number bloom across the cue window. Outside any
                              act it ticks up once on entry instead, over
                              data-sc-count-ms (default 1400).
     data-sc-in               flow-section reveal, fires once on entry via
                              IntersectionObserver (cheaper, and content that
                              re-hides on scroll-up is a defect, not an effect).
                              data-sc-stagger="60" on the parent staggers kids.
     data-sc-drift="#07090c"  page background interpolates toward this colour
                              while the act is on screen.

   ---------------------------------------------------------------------------
   WORLDFLIGHT: the page mode for one continuous flight
   ---------------------------------------------------------------------------
     <div data-sc-mode="worldflight" data-sc-seam="0.12">
       <div data-sc-world>
         <div data-sc-segment data-sc-w="1.4" data-sc-linger="0.3"
              data-sc-waypoint="Approach">
           <img class="sc-world__poster" src="p1.webp" alt="">
           <video data-sc-src="leg1.mp4" data-sc-src-mobile="leg1-m.mp4"></video>
         </div>
         ... more segments, in flight order ...
       </div>
       <div data-sc-world-copy>
         <div class="sc-world__scrim sc-scrim sc-scrim--band"></div>
         <div data-sc-copy data-sc-window="hero"> ... </div>
         <div data-sc-copy data-sc-window="0.34 0.56"> ... </div>
         <div data-sc-copy data-sc-window="finale"> ... </div>
       </div>
       <div data-sc-spacer aria-hidden="true"></div>
     </div>

   Acts cut the page into pinned blocks, which is the right shape for a page of
   chapters and the wrong shape for one continuous camera move: the reader hits
   the end of an act, the stage unsticks, a static page slides past, and the next
   act starts the whole thing again. Worldflight removes the seams by removing
   the blocks. There is ONE fixed stage for the entire page. The only element in
   document flow is a spacer, whose height the engine sets to the sum of the
   segment weights plus one viewport so the last flight can finish. Scroll drives
   the film timeline and the overlay opacity. Nothing else moves.

     data-sc-w        viewport-heights this segment owns. Default 1.3.
     data-sc-linger   dwell remap for this leg only (see lingerEase). Max 0.6.
     data-sc-seam     crossfade band, in viewport-heights of scroll. Default 0.12.
     data-sc-waypoint label published on --sc-seg / the sc:waypoint event, so a
                      page can draw its own route rail. The engine draws none.
     data-sc-window   on a copy block: "hero" | "finale" | "from to [in [out]]"
                      as fractions of the WHOLE track.

   Every clip stays mounted for the life of the page. Segments crossfade by
   opacity over the seam band; nothing ever swaps a src, because a src swap is a
   black frame and a black frame is the cut this mode exists to avoid.

   ---------------------------------------------------------------------------
   POINTER: interactivity that isn't scroll
   ---------------------------------------------------------------------------
     data-sc-tilt="8"         3D tilt toward the pointer, spring-damped, degrees.
     data-sc-magnet="0.35"    element drifts toward the pointer inside its bounds.
     data-sc-spotlight        publishes --sc-mx/--sc-my (0..1) for a light that
                              follows the pointer across the surface.
   All three are gated to (hover: hover) and (pointer: fine) and disabled under
   prefers-reduced-motion. Touch never fires them.

   ---------------------------------------------------------------------------
   REDUCED MOTION
   ---------------------------------------------------------------------------
   Fewer and gentler, not zero. Cues still fade (comprehension survives), but
   translation collapses, video clips are never fetched (the poster holds), and
   pointer devices are inert. A worldflight still tells its whole story: the
   posters cross-dissolve through the same seams and the same copy windows.

   ---------------------------------------------------------------------------
   THE PLAYHEAD
   ---------------------------------------------------------------------------
   Every scrub clip on the page, act or worldflight, is driven by one smoothed
   playhead. Scroll only ever writes a TARGET; a standalone rAF loop walks the
   current time toward it at a fixed fraction per frame (data-sc-lerp, default
   0.18; 1.0 under reduced motion, which is no smoothing at all). Writes are
   gated by a deadband and skipped while the decoder is still seeking. Without
   the smoothing a trackpad flick reads as a stutter, because wheel events do
   not arrive at a constant rate and a 1:1 write reproduces every gap in them.

   ---------------------------------------------------------------------------
   LIFECYCLE (fork addition, Gustav)
   ---------------------------------------------------------------------------
     var api = ScrollCraft.mount(root, { scope, media, lerp, onRead });
     api.destroy()        removes every listener, observer, timer, blob URL and
                          rAF loop the mount attached, releases the video
                          decoders, and puts the DOM back exactly as it was:
                          inline style attributes, classes, counter text, the
                          original child nodes of every kinetic split (the same
                          node objects, not clones, so a framework's reference
                          to a text node stays valid). Idempotent.
     api.refresh()        re-measure (layout) plus a fresh kinetic split and a
                          fresh media-mode read. Use after fonts or heights
                          change with no DOM churn.
     api.rescan()         restore the DOM, collect again on the same root, then
                          layout. Use after acts were added or removed. Window
                          listeners persist, so the api identity is stable.
     api.subscribe(fn)    fn(api) after every read(); returns an unsubscribe.
     api.root, api.scope, api.media, api.destroyed
     sc:warm              CustomEvent (bubbles) on an act element the first time
                          its warm window is entered. detail: { act }.
     a.warm               boolean on the act record, the same window.
   The file is UMD: it assigns module.exports under CommonJS and a global
   otherwise, and it touches no browser API until the first mount(), so it can
   be imported on a server. scrollcraft.esm.js re-exports it for bundlers.

   ---------------------------------------------------------------------------
   SECTION MODE (fork addition, Gustav)
   ---------------------------------------------------------------------------
     ScrollCraft.mount('#story')   on anything that is not document, <html> or
     <body> runs in section mode (opts.scope or data-sc-scope override it).
     The engine then never touches <html>: sc-ready, sc-lite, --sc-canvas
     (drift) and --sc-seg / --sc-segp land on the mount root; a
     [data-sc-progress] inside the root measures the root's own flow progress;
     a pinned act whose ancestor (up to the root's parent) computes a vertical
     overflow other than visible gets a console warning, because that is the
     host-site failure mode that silently breaks a sticky stage. Link
     scrollcraft-section.css (generated by scripts/scope-css.mjs) and put class
     sc-scope on the root. A worldflight inside a section becomes a sticky
     stage: the spacer is total * vh (the sticky stage occupies the extra
     viewport in flow) and the copy layer sits inside the stage.

   ---------------------------------------------------------------------------
   MEDIA MODE (fork addition, Gustav)
   ---------------------------------------------------------------------------
   Lite is about bytes, not motion. When navigator.connection reports
   saveData, an effectiveType of slow-2g or 2g, or 3g with a downlink of
   0.7 Mbps or less (or no downlink figure), scrub clips and image
   sequences are never fetched (posters hold, a sequence draws its first frame
   only) while cues, parallax, reveals, pointer devices and the worldflight
   poster push-in keep running. No navigator.connection (Safari, Firefox) means
   full mode, so those browsers and any 4g connection run exactly the code that
   existed before. The connection 'change' event re-evaluates the mode for
   assets not yet requested; nothing already painted is unloaded. Force it with
   data-sc-media="auto|lite|full" on the mount root or <html>, or per asset on a
   video[data-sc-scrub], canvas[data-sc-sequence] or worldflight <video>, or
   mount(root, { media }). The state is class sc-lite on <html> (page mode) or
   the root (section mode) and api.media ('lite' | 'full').

   Bucket definitions, read from the WICG Network Information API draft
   (https://wicg.github.io/netinfo/, table "effective connection type") on
   2026-09-23: effectiveType is "determined using a combination of recently
   observed rtt and downlink values" against these thresholds:
       ECT       min RTT (ms)   max downlink (Kbps)
       slow-2g   2000           50
       2g        1400           70
       3g        270            700
       4g        0              unbounded
   ========================================================================== */

(function (root, factory) {
  // The global is always assigned (a Node ESM import of this .js file loads
  // it as CommonJS, so `module` exists there too, and scrollcraft.esm.js
  // reads the global); module.exports is set as well where it exists.
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.ScrollCraft = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Evaluated on the first mount(), not at import time, so the file can be
  // required or imported where there is no window (a server render).
  var reduce, fineMQ, smallMQ, coarse, envReady = false;
  function env() {
    if (envReady) return;
    envReady = true;
    if (typeof matchMedia !== 'function') {
      var none = { matches: false };
      reduce = false; coarse = false; fineMQ = none; smallMQ = none;
      return;
    }
    reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    fineMQ = matchMedia('(hover: hover) and (pointer: fine)');
    smallMQ = matchMedia('(max-width: 860px)');
    coarse = matchMedia('(hover: none) and (pointer: coarse)').matches;
  }
  var isMobile = function () { return coarse || smallMQ.matches; };

  var VERSION = '0.4.0';

  // The connection-derived half of media mode. Read live, every time, because
  // Chrome re-buckets a moving phone and the class has to follow.
  // 3g alone is not enough. Chrome buckets a line as 3g when EITHER its RTT is
  // 270ms or more OR its downlink is 700 Kbps or less, so a high-latency line
  // with ample bandwidth reads 3g too (measured 2026-09-23: 600 to 750ms RTT at
  // 1.75 Mbps). Lite is about bytes, so 3g counts only when the bandwidth half
  // is also 3g-class. No downlink figure means we cannot tell: 3g stays lite.
  var LITE_TYPES = ['slow-2g', '2g'];
  var LITE_3G_MAX_MBPS = 0.7;
  function connLite() {
    var c = typeof navigator !== 'undefined' && navigator.connection;
    if (!c) return false;
    if (c.saveData === true) return true;
    if (LITE_TYPES.indexOf(c.effectiveType) > -1) return true;
    if (c.effectiveType === '3g') {
      return !(typeof c.downlink === 'number' && c.downlink > LITE_3G_MAX_MBPS);
    }
    return false;
  }

  var clamp = function (x, a, b) { return x < a ? a : x > b ? b : x; };
  var clamp01 = function (x) { return clamp(x, 0, 1); };
  var smooth = function (x) { x = clamp01(x); return x * x * (3 - 2 * x); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };

  // Monotone dwell remap. Settles the camera mid-act (where the copy peaks) and
  // moves quicker at the edges. f(0)=0 and f(1)=1 always, so seam frames between
  // consecutive clips are untouched and the chain stays invisible.
  function dwell(x, L) {
    if (!L) return x;
    L = clamp01(L);
    var c = x - 0.5;
    return (1 - L) * x + L * (4 * c * c * c + 0.5);
  }

  // Same curve, capped harder, and used per worldflight segment. Above ~0.6 the
  // derivative at the midpoint gets low enough that the camera visibly stops
  // dead mid-leg, which reads as a stall rather than a hold. The endpoints are
  // fixed by construction: f(0)=0, f(1)=1, so the first and last frames of every
  // leg are still exactly the frames the seam law matched, and the chain between
  // legs stays invisible no matter how much dwell a leg asks for.
  function lingerEase(x, L) {
    if (!L) return x;
    L = clamp(L, 0, 0.6);
    var c = x - 0.5;
    return (1 - L) * x + L * (4 * c * c * c + 0.5);
  }

  // The lerp is a mechanism, not a taste knob. It is exposed so a page whose
  // clips are unusually short (where 0.18 lags behind the pointer) can tighten
  // it, and it is never read as 0: a 0 lerp is a playhead that never moves.
  function lerpRate(el) {
    var v = parseFloat(el && el.getAttribute && el.getAttribute('data-sc-lerp'));
    return isNaN(v) || v <= 0 ? 0 : clamp(v, 0.02, 1);
  }

  // ---- colour -------------------------------------------------------------
  function parseColor(str) {
    str = (str || '').trim();
    var m = str.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    m = str.match(/rgba?\(([^)]+)\)/i);
    if (m) {
      var p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
      return [p[0], p[1], p[2]];
    }
    return null;
  }
  function mixColor(a, b, t) {
    return 'rgb(' + Math.round(lerp(a[0], b[0], t)) + ',' +
                    Math.round(lerp(a[1], b[1], t)) + ',' +
                    Math.round(lerp(a[2], b[2], t)) + ')';
  }

  // ---- text splitting -----------------------------------------------------
  // Wraps each unit in a masked span so the reveal can slide from behind a clean
  // edge instead of just fading. Lines are measured after layout, so this must
  // run once fonts are ready or the line boxes are wrong.
  function splitText(el, mode, keep) {
    if (el.__scSplit) return el.__scSplit;
    var text = el.textContent;
    var units = [];
    // Keep the ORIGINAL child nodes (the objects, detached, in order) so a
    // destroy() can put them back. A framework that rendered this heading holds
    // a reference to its text node; a clone would leave that reference pointing
    // at a node that is no longer in the document.
    if (keep && !keep.has(el)) keep.set(el, Array.prototype.slice.call(el.childNodes));

    if (mode === 'chars' || mode === 'words') {
      var parts = mode === 'chars' ? Array.from(text) : text.split(/(\s+)/);
      el.textContent = '';
      parts.forEach(function (t) {
        if (/^\s+$/.test(t)) { el.appendChild(document.createTextNode(t)); return; }
        var mask = document.createElement('span');
        mask.className = 'sc-split';
        var inner = document.createElement('span');
        inner.className = 'sc-split__i';
        inner.textContent = t;
        mask.appendChild(inner);
        el.appendChild(mask);
        units.push(inner);
      });
    } else {
      // lines: wrap every word, measure offsetTop, regroup words into line spans
      var words = text.split(/\s+/).filter(Boolean);
      el.textContent = '';
      var probes = words.map(function (w, i) {
        var s = document.createElement('span');
        s.textContent = w;
        el.appendChild(s);
        if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
        return s;
      });
      var lines = [], cur = null, lastTop = null;
      probes.forEach(function (s) {
        var top = s.offsetTop;
        if (lastTop === null || Math.abs(top - lastTop) > 1) { cur = []; lines.push(cur); lastTop = top; }
        cur.push(s.textContent);
      });
      el.textContent = '';
      lines.forEach(function (words, li) {
        var mask = document.createElement('span');
        mask.className = 'sc-split sc-split--line';
        var inner = document.createElement('span');
        inner.className = 'sc-split__i';
        inner.textContent = words.join(' ');
        mask.appendChild(inner);
        el.appendChild(mask);
        // Whitespace between the line spans. Without it the line boxes abut in
        // the text layer, so selecting and copying the heading yields
        // "even whenbreakfast" and a screen reader hears the same.
        if (li < lines.length - 1) el.appendChild(document.createTextNode(' '));
        units.push(inner);
      });
    }
    el.classList.add('sc-is-split');
    el.__scSplit = units;
    return units;
  }

  // ---- number formatting --------------------------------------------------
  function formatNum(v, template) {
    var decimals = 0;
    var dot = template.indexOf('.');
    if (dot > -1) decimals = template.length - dot - 1;
    var s = v.toFixed(decimals);
    if (/,/.test(template) || Math.abs(v) >= 10000) {
      var bits = s.split('.');
      bits[0] = bits[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      s = bits.join('.');
    }
    return s;
  }

  // =========================================================================
  function mount(root, opts) {
    env();
    root = typeof root === 'string' ? document.querySelector(root) : (root || document);
    opts = opts || {};
    if (!root) throw new Error('[scrollcraft] mount: root not found');

    var acts = [];
    var worlds = [];
    var drifts = [];
    var playheads = [];
    var scrollEls = [];
    var vh = innerHeight, vw = innerWidth;
    var y = 0, needsLayout = true;
    var progressBar = root.querySelector('[data-sc-progress]');
    var docEl = document.documentElement;

    // ---- scope ------------------------------------------------------------
    // Page mode is the document, <html> or <body>; anything else is a section
    // of a host page and the engine must not write on <html>. `modeEl` is
    // where sc-ready, sc-lite, --sc-canvas and --sc-seg go.
    var isPageRoot = root === document || root === docEl || root === document.body;
    var scope = opts.scope === 'page' || opts.scope === 'section' ? opts.scope
              : (root.getAttribute && root.getAttribute('data-sc-scope') === 'section') ? 'section'
              : (root.getAttribute && root.getAttribute('data-sc-scope') === 'page') ? 'page'
              : (isPageRoot ? 'page' : 'section');
    var modeEl = scope === 'section' ? root : docEl;

    // ---- media mode -------------------------------------------------------
    // Author preference (option, root attribute, <html> attribute, in that
    // order) resolved once; the connection half is read live in isLite().
    var mediaPref = (function () {
      var v = opts.media;
      if (v !== 'lite' && v !== 'full' && v !== 'auto') v = root.getAttribute && root.getAttribute('data-sc-media');
      if (v !== 'lite' && v !== 'full' && v !== 'auto') v = docEl.getAttribute('data-sc-media');
      return v === 'lite' || v === 'full' ? v : 'auto';
    })();
    function isLite() {
      if (mediaPref === 'lite') return true;
      if (mediaPref === 'full') return false;
      return connLite();
    }
    // Per-asset override: the attribute on the element wins for that element.
    function assetLite(el) {
      var v = el && el.getAttribute && el.getAttribute('data-sc-media');
      if (v === 'lite') return true;
      if (v === 'full') return false;
      return isLite();
    }
    var liteState = null;
    function syncLite() {
      var on = isLite();
      if (on === liteState) return on;
      liteState = on;
      if (on) addClass(modeEl, 'sc-lite'); else dropClass(modeEl, 'sc-lite');
      return on;
    }

    // ---- registries -------------------------------------------------------
    // Everything the mount attaches is recorded here so destroy() can take it
    // all back. `alive` gates every async continuation (rAF loops, fetch
    // resolutions, fonts.ready, timers), which is what makes a destroy during
    // an in-flight clip fetch safe: the blob arrives and is dropped on the floor.
    var alive = true;
    var subs = [];        // { t, type, fn, opts }
    var observers = [];   // IntersectionObserver instances
    var timers = [];      // setTimeout ids
    var blobs = [];       // object URLs
    var rafTick = 0, rafPointer = 0, rafScroll = 0;
    var subscribers = [];
    var moved = [];       // { el, parent, next } DOM moves to undo (worldflight copy layer)
    function listen(t, type, fn, o) {
      t.addEventListener(type, fn, o);
      subs.push({ t: t, type: type, fn: fn, o: o });
    }
    function unlisten(t, type, fn) {
      for (var i = subs.length - 1; i >= 0; i--) {
        var s = subs[i];
        if (s.t === t && s.type === type && s.fn === fn) {
          t.removeEventListener(type, fn, s.o);
          subs.splice(i, 1);
        }
      }
    }
    function later(fn, ms) {
      var id = setTimeout(function () {
        var k = timers.indexOf(id);
        if (k > -1) timers.splice(k, 1);
        if (alive) fn();
      }, ms);
      timers.push(id);
      return id;
    }

    // ---- snapshots --------------------------------------------------------
    // The first time the engine will write an element's inline style, the
    // style ATTRIBUTE (possibly null) is recorded; classes are recorded only
    // when the engine actually added them (a stage that already had .sc-stage
    // keeps it); counters record their text; kinetic splits record their
    // original child nodes. Restore puts every one of those back verbatim.
    var styleSnap = new Map();
    var classSnap = new Map();
    var attrSnap = new Map();   // el -> { name: value|null }
    var textSnap = new Map();
    var splitSnap = new Map();
    var propSnap = new Map();   // el -> { name: value } for video muted/playsInline/preload
    // The inline properties the engine writes. Restore touches ONLY these:
    // anything else on the element (a scroll lock's overflow on <html>, a
    // framework's own custom property on the root) belongs to someone else
    // and is left exactly as it is at restore time, not as it was at mount.
    var ENGINE_PROPS = ['opacity', 'transform', 'visibility', 'z-index', 'pointer-events',
      'clip-path', 'transition-delay', 'height',
      '--sc-p', '--sc-canvas', '--sc-seg', '--sc-segp', '--sc-mx', '--sc-my'];
    function snap(el) {
      if (el && el.nodeType === 1 && !styleSnap.has(el)) {
        var rec = { hadAttr: el.hasAttribute('style'), props: {} };
        for (var i = 0; i < ENGINE_PROPS.length; i++) {
          var v = el.style.getPropertyValue(ENGINE_PROPS[i]);
          if (v !== '') rec.props[ENGINE_PROPS[i]] = [v, el.style.getPropertyPriority(ENGINE_PROPS[i])];
        }
        styleSnap.set(el, rec);
      }
      return el;
    }
    function addClass(el, cls) {
      if (!el) return;
      if (!el.classList.contains(cls)) {
        var set = classSnap.get(el);
        // classList.remove() of the last class leaves class="" behind, which
        // is not the element the author wrote. Remember whether the attribute
        // existed at all so the restore can drop it.
        if (!set) { set = []; set.hadAttr = el.hasAttribute('class'); classSnap.set(el, set); }
        if (set.indexOf(cls) < 0) set.push(cls);
      }
      el.classList.add(cls);
    }
    function dropClass(el, cls) {
      if (!el) return;
      el.classList.remove(cls);
      var set = classSnap.get(el);
      if (set) { var k = set.indexOf(cls); if (k > -1) set.splice(k, 1); }
    }
    function snapAttr(el, name) {
      var rec = attrSnap.get(el);
      if (!rec) { rec = {}; attrSnap.set(el, rec); }
      if (!(name in rec)) rec[name] = el.getAttribute(name);
    }
    function setAttr(el, name, value) {
      snapAttr(el, name);
      el.setAttribute(name, value);
    }
    function snapText(el) {
      if (!textSnap.has(el)) textSnap.set(el, el.textContent);
    }
    function snapProps(el, names) {
      if (propSnap.has(el)) return;
      var rec = {};
      for (var i = 0; i < names.length; i++) rec[names[i]] = el[names[i]];
      propSnap.set(el, rec);
    }
    function unsplit(el) {
      var nodes = splitSnap.get(el);
      if (!nodes) return;
      el.textContent = '';
      for (var i = 0; i < nodes.length; i++) el.appendChild(nodes[i]);
      el.classList.remove('sc-is-split');
      el.__scSplit = null;
      try { delete el.__scSplit; } catch (e) {}
    }
    function restoreDom() {
      splitSnap.forEach(function (nodes, el) { unsplit(el); });
      splitSnap.clear();
      textSnap.forEach(function (txt, el) { el.textContent = txt; });
      textSnap.clear();
      styleSnap.forEach(function (rec, el) {
        for (var i = 0; i < ENGINE_PROPS.length; i++) {
          var name = ENGINE_PROPS[i], was = rec.props[name];
          if (was) el.style.setProperty(name, was[0], was[1]);
          else el.style.removeProperty(name);
        }
        if (!rec.hadAttr && el.getAttribute('style') === '') {
          el.removeAttribute('style');
          // Chrome (measured on 153) re-synthesises an empty style="" from the
          // inline CSSOM after the attribute is removed, lazily, on the next
          // read of it. Reading it back and removing it again is what actually
          // clears it; on a browser without the quirk the second call is a
          // no-op.
          if (el.getAttribute('style') !== null) el.removeAttribute('style');
        }
      });
      styleSnap.clear();
      classSnap.forEach(function (set, el) {
        for (var i = 0; i < set.length; i++) el.classList.remove(set[i]);
        if (!set.hadAttr && el.getAttribute('class') === '') el.removeAttribute('class');
      });
      classSnap.clear();
      // Properties before attributes: playsInline reflects to the playsinline
      // attribute, so the attribute restore has to be the last word.
      propSnap.forEach(function (rec, el) { for (var k in rec) { try { el[k] = rec[k]; } catch (e) {} } });
      propSnap.clear();
      attrSnap.forEach(function (rec, el) {
        for (var name in rec) {
          if (rec[name] === null) el.removeAttribute(name); else el.setAttribute(name, rec[name]);
        }
      });
      attrSnap.clear();
      for (var m = moved.length - 1; m >= 0; m--) {
        var mv = moved[m];
        if (mv.parent) mv.parent.insertBefore(mv.el, mv.next && mv.next.parentNode === mv.parent ? mv.next : null);
      }
      moved.length = 0;
      liteState = null;
    }
    // Release a video's decoder: pause, drop the src, load(). The standard
    // step for freeing a media element; without load() the old blob keeps
    // decoding in the background for the life of the document.
    function releaseClip(V) {
      var v = V.el;
      // A fetch still in flight is cancelled, not just ignored.
      if (V.ctrl) { try { V.ctrl.abort(); } catch (e) {} V.ctrl = null; }
      try { v.pause(); } catch (e) {}
      if (v.hasAttribute('src') || v.src) {
        v.removeAttribute('src');
        try { v.load(); } catch (e) {}
      }
    }
    // Drop every sequence frame's request and reference.
    function releaseSeqs() {
      acts.forEach(function (a) {
        var S = a.seq;
        if (!S) return;
        for (var i = 0; i < S.frames.length; i++) {
          var img = S.frames[i];
          if (img) { img.onload = null; try { img.src = ''; } catch (e) {} }
        }
        S.frames.length = 0; S.loaded = 0; S.drawn = -1; S.partial = false;
      });
    }
    // Bumped by every collect(). A continuation from an earlier collect (a
    // clip fetch that was in flight across a rescan) sees a stale generation
    // and bails, so the same <video> is never given two sources.
    var gen = 0;

    // One rate for the page, overridable per clip. Read from the mount root, the
    // document element, or the option bag, in that order.
    var LERP = lerpRate(root.nodeType === 1 ? root : null) ||
               lerpRate(docEl) ||
               (opts.lerp > 0 ? clamp(opts.lerp, 0.02, 1) : 0) ||
               0.18;

    // Every scrub clip on the page lives here, whatever drives it. tick() walks
    // this one list, so an act clip and a worldflight leg get the same playhead.
    function makeClip(v, host) {
      var rec = {
        el: v, host: host || v,
        ready: false, loading: false, painted: false,
        cur: 0, target: 0, live: false, stuckAt: 0,
        lerp: lerpRate(v) || LERP,
        gen: gen, ctrl: null
      };
      snap(v); snapProps(v, ['muted', 'playsInline']); snapAttr(v, 'preload'); snapAttr(v, 'src');
      v.muted = true; v.playsInline = true; v.preload = 'none';
      setAttr(v, 'muted', ''); setAttr(v, 'playsinline', '');
      playheads.push(rec);
      return rec;
    }

    // Everything from here to the end of the entry counters is collect(): it
    // reads the DOM under the root and builds the records. It runs once at
    // mount and again on rescan(), against the same arrays (identity kept, so
    // api.acts stays valid).
    function collect() {
    gen++;
    acts.length = 0; worlds.length = 0; drifts.length = 0; playheads.length = 0;
    tilts.length = 0; magnets.length = 0; spots.length = 0;
    primedCount = 0;
    progressBar = root.querySelector('[data-sc-progress]');
    snap(modeEl);
    if (progressBar) snap(progressBar);

    // ---- collect acts -----------------------------------------------------
    Array.prototype.forEach.call(root.querySelectorAll('[data-sc-act]'), function (el) {
      snap(el);
      var device = el.getAttribute('data-sc-act') || 'flow';
      var pinned = device === 'scrub' || device === 'pin' || device === 'pan';
      var act = {
        el: el,
        device: device,
        pinned: pinned,
        span: parseFloat(el.getAttribute('data-sc-span')) || (pinned ? 1.5 : 0),
        dwell: parseFloat(el.getAttribute('data-sc-dwell')) || 0,
        clipTravel: pinned && el.getAttribute('data-sc-clip-map') === 'travel',
        p: 0, raw: 0, top: 0, height: 0, live: false, warm: false, warmed: false,
        cues: [], parallax: [], reveals: [], counts: [],
        video: null, seq: null, rail: null
      };

      if (pinned) {
        act.stage = el.querySelector('[data-sc-stage]') || el.querySelector('.sc-stage');
        if (act.stage) addClass(act.stage, 'sc-stage');
        addClass(el, 'sc-act--pinned');
      }

      // scrub video
      var v = el.querySelector('video[data-sc-scrub]');
      if (v) act.video = makeClip(v, el);

      // image sequence
      var cv = el.querySelector('canvas[data-sc-sequence]');
      if (cv) {
        var spec = cv.getAttribute('data-sc-sequence').split(':');
        act.seq = {
          el: cv, ctx: cv.getContext('2d', { alpha: false }),
          tpl: spec[0], count: parseInt(spec[1], 10) || 1, start: parseInt(spec[2], 10) || 0,
          frames: [], loaded: 0, drawn: -1, partial: false
        };
      }

      // horizontal rail
      act.rail = el.querySelector('[data-sc-pan]');
      if (act.rail) { snap(act.rail); act.railExtra = parseFloat(act.rail.getAttribute('data-sc-pan')) || 0; }

      // cues
      Array.prototype.forEach.call(el.querySelectorAll('[data-sc-cue]'), function (c) {
        var nums = (c.getAttribute('data-sc-cue') || '').trim().split(/\s+/).map(parseFloat);
        // from [to [rampIn [rampOut]]]
        // rampIn/rampOut are fractions OF THE WINDOW, defaulting to 0.3 each.
        // That leaves a ~40% plateau at full opacity in the middle. Without a
        // plateau a cue is a triangle: it touches opacity 1 for a single
        // instant, so the reader has to stop on exactly the right pixel to see
        // the line at full strength, and every heading reads as slightly faded.
        var cue = {
          el: c,
          from: isNaN(nums[0]) ? 0 : nums[0],
          to: nums.length > 1 && !isNaN(nums[1]) ? nums[1] : null,
          rIn: nums.length > 2 && !isNaN(nums[2]) ? clamp01(nums[2]) : 0.3,
          rOut: nums.length > 3 && !isNaN(nums[3]) ? clamp01(nums[3]) : null,
          rise: parseFloat(c.getAttribute('data-sc-rise')),
          kinetic: c.getAttribute('data-sc-kinetic'),
          units: null, state: -1
        };
        if (cue.rOut === null) cue.rOut = (nums.length > 2 && !isNaN(nums[2])) ? 0.3 : 0.3;
        if (isNaN(cue.rise)) cue.rise = 1;
        snap(c);
        act.cues.push(cue);
      });

      // parallax
      Array.prototype.forEach.call(el.querySelectorAll('[data-sc-parallax]'), function (c) {
        snap(c);
        act.parallax.push({ el: c, rate: parseFloat(c.getAttribute('data-sc-parallax')) || 0 });
      });

      // reveals
      Array.prototype.forEach.call(el.querySelectorAll('[data-sc-reveal]'), function (c) {
        var nums = (c.getAttribute('data-sc-reveal-at') || '0 0.5').trim().split(/\s+/).map(parseFloat);
        snap(c);
        act.reveals.push({ el: c, dir: c.getAttribute('data-sc-reveal') || 'up', from: nums[0] || 0, to: nums[1] || 0.5 });
      });

      // counters
      Array.prototype.forEach.call(el.querySelectorAll('[data-sc-count]'), function (c) {
        var nums = (c.getAttribute('data-sc-count') || '').trim().split(/\s+/);
        var at = (c.getAttribute('data-sc-count-at') || '0.1 0.55').trim().split(/\s+/).map(parseFloat);
        // Strip separators before parsing so the author can write the target
        // exactly as it should render. Without this, "0 3,500" parses the target
        // as 3 (the comma stops parseFloat) and "0 3500" renders "3500", because
        // formatNum only adds separators above 10,000. So any real figure between
        // 1,000 and 9,999 could not be shown the way it is written everywhere
        // else on the page. The template still drives the formatting.
        var num = function (s) { return parseFloat(String(s).replace(/,/g, '')) || 0; };
        snapText(c);
        act.counts.push({
          el: c, a: num(nums[0]), b: num(nums[1]),
          tpl: nums[1] || '0', from: at[0], to: at[1], last: null
        });
      });

      acts.push(act);

      var d = el.getAttribute('data-sc-drift');
      if (d) { var rgb = parseColor(d); if (rgb) drifts.push({ act: act, rgb: rgb }); }
    });

    // ---- collect worldflights --------------------------------------------
    Array.prototype.forEach.call(root.querySelectorAll('[data-sc-mode="worldflight"]'), function (el) {
      var W = {
        el: el,
        stage: el.querySelector('[data-sc-world]') || el.querySelector('.sc-world'),
        copyLayer: el.querySelector('[data-sc-world-copy]') || el.querySelector('.sc-world__copy'),
        spacer: el.querySelector('[data-sc-spacer]') || el.querySelector('.sc-world__spacer'),
        seam: 0, segs: [], copies: [], total: 0, top: 0, index: -1, checked: false
      };
      var seam = parseFloat(el.getAttribute('data-sc-seam'));
      // A seam wider than the shortest leg would have three clips dissolving at
      // once and no leg ever fully present. Cap it well under that.
      W.seam = isNaN(seam) || seam <= 0 ? 0.12 : clamp(seam, 0.02, 0.4);
      snap(el);
      if (W.stage) addClass(W.stage, 'sc-world');
      if (W.copyLayer) addClass(W.copyLayer, 'sc-world__copy');
      if (W.spacer) { snap(W.spacer); addClass(W.spacer, 'sc-world__spacer'); }
      // Section mode: the stage is sticky, not fixed, so the copy layer has to
      // live INSIDE the stage to travel with it. Move it there if the author
      // left it beside the stage, and record the move so destroy() undoes it.
      if (scope === 'section' && W.stage && W.copyLayer && !W.stage.contains(W.copyLayer)) {
        moved.push({ el: W.copyLayer, parent: W.copyLayer.parentNode, next: W.copyLayer.nextSibling });
        W.stage.appendChild(W.copyLayer);
      }

      Array.prototype.forEach.call(el.querySelectorAll('[data-sc-segment]'), function (s) {
        var seg = {
          el: s,
          w: parseFloat(s.getAttribute('data-sc-w')) || 1.3,
          linger: clamp(parseFloat(s.getAttribute('data-sc-linger')) || 0, 0, 0.6),
          label: s.getAttribute('data-sc-waypoint') || '',
          poster: s.querySelector('[data-sc-poster]') || s.querySelector('.sc-world__poster') || s.querySelector('img'),
          c0: 0, c1: 0, local: 0, op: -1, z: -1, clip: null
        };
        snap(s);
        addClass(s, 'sc-world__seg');
        if (seg.poster) { snap(seg.poster); addClass(seg.poster, 'sc-world__poster'); }
        var v = s.querySelector('video');
        if (v) {
          // Mark it as a scrub clip whether or not the author did. Everything
          // downstream, the stylesheet and the verification harness included,
          // finds scrub media by this attribute.
          setAttr(v, 'data-sc-scrub', '');
          seg.clip = makeClip(v, s);
        }
        W.segs.push(seg);
      });

      var run = 0;
      W.segs.forEach(function (s) { s.c0 = run; run += Math.max(s.w, 0.1); s.c1 = run; });
      W.total = Math.max(run, 0.001);

      Array.prototype.forEach.call(el.querySelectorAll('[data-sc-copy]'), function (cEl) {
        var spec = (cEl.getAttribute('data-sc-window') || '').trim();
        var q = { el: cEl, from: 0, to: 1, rIn: 0.3, rOut: 0.3, state: -1 };
        var first = W.segs[0], last = W.segs[W.segs.length - 1];
        if (spec === 'hero') {
          // Present the instant the reader lands. A hero that fades IN has to
          // fade in from nothing over an empty first screen, which is the one
          // moment on the page where there is nothing else to look at.
          q.from = 0;
          q.to = first ? (0.62 * first.w) / W.total : 0.3;
          q.rIn = 0; q.rOut = 0.65;
        } else if (spec === 'finale') {
          q.from = last ? (last.c0 + 0.4 * last.w) / W.total : 0.7;
          q.to = 1; q.rIn = 0.55; q.rOut = 0;
        } else {
          var n = spec.split(/\s+/).map(parseFloat);
          q.from = isNaN(n[0]) ? 0 : clamp01(n[0]);
          q.to = (n.length > 1 && !isNaN(n[1])) ? clamp01(n[1]) : clamp01(q.from + 0.18);
          if (n.length > 2 && !isNaN(n[2])) q.rIn = clamp01(n[2]);
          if (n.length > 3 && !isNaN(n[3])) q.rOut = clamp01(n[3]);
        }
        if (q.to <= q.from) q.to = clamp01(q.from + 0.05);
        snap(cEl);
        W.copies.push(q);
      });

      worlds.push(W);
    });

    // ---- flow reveals (fire once) ----------------------------------------
    var io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          var el = e.target;
          addClass(el, 'sc-in');
          var stagger = parseFloat(el.getAttribute('data-sc-stagger'));
          if (!isNaN(stagger)) {
            Array.prototype.forEach.call(el.children, function (kid, i) {
              snap(kid);
              kid.style.transitionDelay = (i * stagger) + 'ms';
              addClass(kid, 'sc-in');
            });
          }
          io.unobserve(el);
        });
      }, { rootMargin: '0px 0px -12% 0px', threshold: 0.01 });
      observers.push(io);
      Array.prototype.forEach.call(root.querySelectorAll('[data-sc-in]'), function (el) { io.observe(el); });
    } else {
      Array.prototype.forEach.call(root.querySelectorAll('[data-sc-in]'), function (el) { addClass(el, 'sc-in'); });
    }

    // ---- entry counters (fire once) --------------------------------------
    // A [data-sc-count] outside any pinned act is not scrubbed by scroll; it
    // ticks up once when it enters view, over data-sc-count-ms (default 1400).
    // Same formatting rules as the act counter: write the target as it should
    // render. Reduced motion writes the final value and never animates.
    (function () {
      var ease = function (t) { return 1 - Math.pow(1 - t, 3); };
      var num = function (s) { return parseFloat(String(s).replace(/,/g, '')) || 0; };
      var spec = function (c) { return (c.getAttribute('data-sc-count') || '').trim().split(/\s+/); };
      var els = Array.prototype.filter.call(root.querySelectorAll('[data-sc-count]'), function (c) {
        return !c.closest('[data-sc-act]');
      });
      if (!els.length) return;
      function run(c) {
        var nums = spec(c);
        var a = num(nums[0]), b = num(nums[1]), tpl = nums[1] || '0';
        var ms = parseFloat(c.getAttribute('data-sc-count-ms')) || 1400;
        if (reduce || ms <= 0) { c.textContent = formatNum(b, tpl); return; }
        var t0 = null, last = null;
        function frame(now) {
          if (!alive) return;
          if (t0 === null) t0 = now;
          var t = Math.min((now - t0) / ms, 1);
          var out = formatNum(a + (b - a) * ease(t), tpl);
          if (out !== last) { c.textContent = out; last = out; }
          if (t < 1) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      }
      els.forEach(function (c) { snapText(c); var n = spec(c); c.textContent = formatNum(num(n[0]), n[1] || '0'); });
      if ('IntersectionObserver' in window) {
        var cio = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (!e.isIntersecting) return;
            run(e.target); cio.unobserve(e.target);
          });
        }, { rootMargin: '0px 0px -10% 0px', threshold: 0.5 });
        observers.push(cio);
        els.forEach(function (c) { cio.observe(c); });
      } else {
        els.forEach(run);
      }
    })();
    } // end collect()

    // ---- layout -----------------------------------------------------------
    var warnedDead = false;
    function deadWarn(what) {
      if (warnedDead) return;
      warnedDead = true;
      console.warn('[scrollcraft] ' + what + '() called after destroy(); ignored.');
    }
    function layout() {
      if (!alive) { deadWarn('layout'); return; }
      vh = innerHeight; vw = innerWidth;
      acts.forEach(function (a) {
        if (a.pinned) a.el.style.height = (a.span * 100) + 'vh';
      });
      // The spacer is the whole document flow of a worldflight. Its height is
      // the sum of the leg weights plus one viewport: without that extra screen
      // the track runs out at the moment the last leg reaches p=1, so the last
      // leg's final second is a place the reader can never actually stop.
      // Set in pixels, not vh, because .sc-world is sized in svh on phones and a
      // vh/svh mismatch would put the track and the stage on different rulers.
      // In section mode the stage is sticky and already occupies one viewport
      // of flow inside the mode root, so the spacer is total * vh: the sticky
      // stage supplies the landing viewport itself.
      worlds.forEach(function (W) {
        if (W.spacer) W.spacer.style.height = Math.round((W.total + (scope === 'section' ? 0 : 1)) * vh) + 'px';
      });
      acts.forEach(function (a) {
        var r = a.el.getBoundingClientRect();
        a.top = r.top + scrollY;
        a.height = r.height;
      });
      if (acts.length) {
        acts.forEach(function (a) {
          if (a.seq && a.seq.el) {
            var box = a.seq.el.getBoundingClientRect();
            var dpr = Math.min(devicePixelRatio || 1, 2);
            if (!attrSnap.has(a.seq.el)) {
              attrSnap.set(a.seq.el, { width: a.seq.el.getAttribute('width'), height: a.seq.el.getAttribute('height') });
            }
            a.seq.el.width = Math.round(box.width * dpr);
            a.seq.el.height = Math.round(box.height * dpr);
            a.seq.drawn = -1;
          }
        });
      }
      // A pinned act whose stage is not actually sticky fails silently: the
      // stage just scrolls by, the copy cues correctly against a frame nobody
      // can see, and every automated check passes. Any author rule that sets
      // `position` on the stage causes it. Say so.
      acts.forEach(function (a) {
        if (!a.pinned || !a.stage || a.stageChecked) return;
        a.stageChecked = true;
        var pos = getComputedStyle(a.stage).position;
        if (pos !== 'sticky' && pos !== '-webkit-sticky') {
          console.warn('[scrollcraft] act "' + (a.el.id || a.device) + '" will not pin: its stage computes ' +
            'position:' + pos + ', not sticky. Something is overriding .sc-stage.', a.stage);
        }
      });
      // Section mode: a sticky stage cannot pin inside any ancestor whose
      // vertical overflow is not visible, and nothing else in the engine would
      // name that. Walk each pinned act's ancestors, through the root and its
      // parents up to (not including) body, and say so once per act. body and
      // html are skipped: their overflow propagates to the viewport and does
      // not break sticky.
      if (scope === 'section') {
        acts.forEach(function (a) {
          if (!a.pinned || a.overflowChecked) return;
          a.overflowChecked = true;
          for (var an = a.el.parentElement; an && an !== document.body && an !== document.documentElement; an = an.parentElement) {
            var ov = getComputedStyle(an).overflowY;
            if (ov && ov !== 'visible') {
              var tag = an.tagName.toLowerCase() + (an.id ? '#' + an.id : '') +
                        (an.className && typeof an.className === 'string' ? '.' + an.className.trim().split(/\s+/).join('.') : '');
              console.warn('[scrollcraft] act "' + (a.el.id || a.device) + '" sits inside an overflow:' + ov +
                ' ancestor ' + tag + ', so its sticky stage cannot pin.', an);
              break;
            }
          }
        });
      }

      worlds.forEach(function (W) {
        W.top = W.el.getBoundingClientRect().top + scrollY;
        if (W.checked) return;
        W.checked = true;
        if (!W.stage) {
          console.warn('[scrollcraft] worldflight has no [data-sc-world] stage; nothing will fly.', W.el);
          return;
        }
        if (!W.spacer) {
          console.warn('[scrollcraft] worldflight has no [data-sc-spacer]; the page has no scroll track.', W.el);
        }
        // The same silent failure as an unpinned act, one level worse: a stage
        // that is not fixed scrolls away and takes the whole page with it, while
        // every progress number still reads correctly.
        var wp = getComputedStyle(W.stage).position;
        // In a section the stage is sticky by design (scrollcraft-section.css).
        if (scope === 'section' && (wp === 'sticky' || wp === '-webkit-sticky')) return;
        if (scope === 'section' && wp !== 'fixed') {
          console.warn('[scrollcraft] worldflight stage computes position:' + wp + ' inside a section mount; ' +
            'link scrollcraft-section.css so .sc-world is sticky, or mount the page.', W.stage);
          return;
        }
        if (wp !== 'fixed') {
          console.warn('[scrollcraft] worldflight stage computes position:' + wp + ', not fixed. ' +
            'Something is overriding .sc-world, and the flight will scroll off screen.', W.stage);
        }
      });

      needsLayout = false;
      read();
    }

    // ---- video ------------------------------------------------------------
    function loadVideo(a) { loadClip(a.video); }
    function loadClip(V) {
      // Under reduced motion the clip is never fetched. The poster holds the
      // frame and the copy still cues, so the page reads without the decode.
      if (reduce || !V || V.loading) return;
      // Lite: the bytes are never requested. Checked per call, so a clip that
      // was held while the connection was slow loads on the first warm read()
      // after the mode flips to full.
      if (assetLite(V.el)) return;
      var src = V.el.getAttribute('data-sc-src') ||
                (isMobile() && V.el.getAttribute('data-sc-src-mobile')) ||
                V.el.currentSrc || V.el.src;
      if (isMobile() && V.el.getAttribute('data-sc-src-mobile')) src = V.el.getAttribute('data-sc-src-mobile');
      if (!src) return;
      V.loading = true;
      var stale = function () { return !alive || V.gen !== gen; };
      V.ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      fetch(src, V.ctrl ? { signal: V.ctrl.signal } : undefined)
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.blob(); })
        .then(function (blob) {
          // A destroy() or rescan() while the fetch was in flight: the element
          // is no longer this record's to touch. Drop the blob.
          if (stale()) return;
          V.ctrl = null;
          // Listeners and preload BEFORE src. Assigning src starts the load, so
          // attaching afterwards and then calling load() restarts it and aborts
          // the first request (visible as ERR_ABORTED on the blob URL).
          listen(V.el, 'loadedmetadata', function () {
            if (stale()) return;
            V.ready = true;
            // Force one seek even when the target is already 0. The reveal is
            // gated on a 'seeked' event, and the raf loop only seeks when the
            // time actually needs to change, so a clip sitting at the very top
            // of its act would never seek, never fire 'seeked', and never
            // replace its poster until the reader scrolled it off zero.
            try { V.el.currentTime = Math.max(V.target * (V.el.duration || 1), 0.001); } catch (e) {}
            read();
            // Prime the decoder the moment the clip can be primed, without
            // waiting for a gesture. A muted inline play() is allowed with no
            // user activation on every platform except a restricted one (Low
            // Power Mode, data saver), and there the rejection is harmless: the
            // gesture listeners below retry on the next real touch.
            primeClip(V);
          });
          // Reveal only once a real frame has painted. iOS keeps a seeked-but-
          // never-played muted video blank, so hiding the poster on metadata
          // alone flashes an empty stage.
          var reveal = function () {
            if (V.painted || stale()) return;
            V.painted = true;
            addClass(V.host, 'sc-has-clip');
            addClass(V.el, 'sc-has-clip');
          };
          listen(V.el, 'seeked', reveal, { once: true });
          // Never let visibility depend only on an event that may not arrive.
          // On iOS a clip that has not been played can accept a seek and never
          // fire 'seeked', which leaves the element at opacity 0 for the life of
          // the page: the poster stays up, the act looks frozen, and every later
          // act is fine because by then the reader has touched the screen and
          // the decoder is live. Reveal on a timer as well. A stage that is
          // briefly blank is a smaller fault than one that never shows its clip.
          later(reveal, 2500);
          V.el.preload = 'auto';
          V.el.muted = true;            // as a property, not only an attribute
          V.el.playsInline = true;
          var url = URL.createObjectURL(blob);
          blobs.push(url);
          V.el.src = url;
        })
        .catch(function () { V.loading = false; V.ctrl = null; });
    }

    // ---- image sequence ---------------------------------------------------
    // Under lite only the first frame is fetched (S.partial) and drawn once, so
    // the canvas is never blank. If the mode later flips to full and the act is
    // still warm, the remaining frames are requested then.
    function loadSeq(a) {
      var S = a.seq;
      if (!S) return;
      var lite = assetLite(S.el);
      if (S.frames.length && !(S.partial && !lite)) return;
      var from = S.frames.length ? 1 : 0;
      var to = lite ? 1 : S.count;
      S.partial = lite;
      for (var i = from; i < to; i++) {
        (function (i) {
          var img = new Image();
          img.decoding = 'async';
          img.src = S.tpl.replace('{i}', String(S.start + i))
                         .replace('{ii}', String(S.start + i).padStart(2, '0'))
                         .replace('{iii}', String(S.start + i).padStart(3, '0'))
                         .replace('{iiii}', String(S.start + i).padStart(4, '0'));
          img.onload = function () { S.loaded++; if (S.loaded === 1) S.drawn = -1; };
          S.frames[i] = img;
        })(i);
      }
    }
    function drawSeq(a) {
      var S = a.seq;
      if (!S || !S.frames.length) return;
      var idx = S.partial ? 0 : clamp(Math.round(a.p * (S.count - 1)), 0, S.count - 1);
      if (idx === S.drawn) return;
      var img = S.frames[idx];
      if (!img || !img.complete || !img.naturalWidth) return;
      var cw = S.el.width, ch = S.el.height;
      // cover fit
      var scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
      var w = img.naturalWidth * scale, h = img.naturalHeight * scale;
      S.ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
      S.drawn = idx;
    }

    // ---- worldflight ------------------------------------------------------
    // t is the position along the flight, measured in viewport-heights of
    // scroll, so every number here is in the same unit the author wrote the
    // weights in. There is no per-segment geometry to read: the stage never
    // moves, so nothing needs measuring on scroll.
    function readWorld(W) {
      if (!W.segs.length) return;
      var S = W.seam;
      var t = clamp((y - W.top) / Math.max(vh, 1), 0, W.total);
      var pr = t / W.total;
      var i, s;

      // The current leg is the last one whose crossfade has begun.
      var k = 0;
      for (i = 0; i < W.segs.length; i++) if (t >= W.segs[i].c0 - S / 2) k = i;

      for (i = 0; i < W.segs.length; i++) {
        s = W.segs[i];
        var local = clamp01((t - s.c0) / Math.max(s.w, 0.001));
        s.local = local;

        // Fetch a leg only while it is within reach. Loading the whole flight up
        // front is tens of megabytes before the first frame paints; loading it
        // on arrival means arriving at a poster.
        if (s.clip && t > s.c0 - 1.6 && t < s.c1 + 1.6) loadClip(s.clip);

        // Opacity. The incoming leg fades UP over the outgoing one, which holds
        // at full strength underneath until it is completely covered. Fading
        // both halves of a crossfade is what puts the page ground through the
        // middle of the seam and reads as a flash.
        var op;
        if (i > k) op = 0;
        else if (i === k) op = i === 0 ? 1 : smooth((t - (s.c0 - S / 2)) / S);
        else op = t < s.c1 + S / 2 ? 1 : 0;

        var z = i === k ? 120 : Math.round(100 + op * 10);
        if (op !== s.op) {
          s.el.style.opacity = op.toFixed(3);
          // A leg at zero must stop compositing entirely. Six full-bleed video
          // layers all painting at opacity 0 costs the same as painting them.
          s.el.style.visibility = op > 0.002 ? 'visible' : 'hidden';
          s.op = op;
        }
        if (z !== s.z) { s.el.style.zIndex = String(z); s.z = z; }

        if (s.clip) {
          s.clip.live = op > 0.002;
          s.clip.target = lingerEase(local, s.linger);
        }
        // Until a real frame has painted, the poster carries the move. A still
        // that sits perfectly still while the page scrolls announces itself as a
        // placeholder; a slow push in reads as the camera already flying.
        if (s.poster && !reduce && !(s.clip && s.clip.painted) && op > 0.002) {
          s.poster.style.transform = 'scale(' + (1.03 + local * 0.14).toFixed(4) + ')';
        }
      }

      for (var c = 0; c < W.copies.length; c++) {
        var q = W.copies[c];
        var win = Math.max(q.to - q.from, 0.001);
        var inEnd = q.from + win * q.rIn;
        var outStart = q.to - win * q.rOut;
        var vis;
        // A hero declares rIn 0, so inEnd sits exactly on `from` and the ramp
        // branch is skipped: the block is simply present from the first pixel.
        if (pr < q.from) vis = 0;
        else if (pr < inEnd) vis = smooth((pr - q.from) / Math.max(inEnd - q.from, 0.001));
        else if (pr <= outStart) vis = 1;
        else vis = smooth(1 - (pr - outStart) / Math.max(q.to - outStart, 0.001));
        vis = clamp01(vis);

        // The ONLY transform on the copy side, and it is capped at 4vh across
        // the whole window. Anything larger stops reading as a parallax layer
        // over a moving world and starts reading as a second page scrolling at a
        // different speed, which is the exact cheapness this mode replaces.
        var wp = clamp01((pr - q.from) / win);
        q.el.style.opacity = vis.toFixed(3);
        q.el.style.transform = reduce ? 'none'
          : 'translate3d(0,' + ((0.5 - wp) * 4).toFixed(2) + 'vh,0)';
        var on = vis > 0.5;
        if (on !== (q.state === 1)) { q.state = on ? 1 : 0; q.el.style.pointerEvents = on ? 'auto' : 'none'; }
      }

      // Publish the route, draw none of it. A gauge, a map, a leg counter and a
      // set of chapter dots are all the same two numbers, and a runtime that
      // ships one of them ships it to every page that uses this mode.
      var cur = W.segs[k];
      W.el.style.setProperty('--sc-seg', String(k));
      W.el.style.setProperty('--sc-segp', cur.local.toFixed(4));
      // <html> in page mode, the mount root in section mode. Never <html> from
      // a section: that would be the engine writing on the host page.
      modeEl.style.setProperty('--sc-seg', String(k));
      modeEl.style.setProperty('--sc-segp', cur.local.toFixed(4));
      if (k !== W.index) {
        W.index = k;
        try {
          W.el.dispatchEvent(new CustomEvent('sc:waypoint', {
            bubbles: true,
            detail: { index: k, count: W.segs.length, label: cur.label, el: cur.el, progress: pr }
          }));
        } catch (e) {}
      }
    }

    // ---- per-frame scroll read -------------------------------------------
    function read() {
      if (!alive) { deadWarn('read'); return; }
      y = scrollY || pageYOffset;
      var driftA = null, driftB = null, driftT = 0;
      var maxY = Math.max((document.documentElement.scrollHeight || 0) - vh, 1);

      for (var i = 0; i < acts.length; i++) {
        var a = acts[i];
        var raw;
        if (a.pinned) {
          var travel = Math.max(a.height - vh, 1);
          raw = clamp01((y - a.top) / travel);
        } else {
          raw = clamp01((y + vh - a.top) / (a.height + vh));
        }
        a.raw = raw;
        a.p = a.dwell ? dwell(raw, a.dwell) : raw;

        // Clip time is NOT cue time. Cues belong to the pin, so they keep using
        // `p`. The clip belongs to the stage, and the stage is on screen for one
        // viewport before the pin starts and one after it ends. Driving the clip
        // from `p` therefore parks it on frame one for the whole entry slide and
        // on its last frame for the whole exit slide, which is a still
        // photograph moving up the screen under the reader's hand.
        //
        // So map the clip across the stage's entire visible life instead. Both
        // ends are clamped to scroll that actually exists: an act at the top of
        // the document has no entry slide and must still start on frame one, and
        // an act near the bottom must still reach its last frame while the page
        // can still scroll.
        a.vp = a.p;
        if (a.pinned && !a.clipTravel) {
          var startY = a.top - Math.min(vh, a.top);
          var endY = Math.min(a.top + a.height, maxY);
          var vraw = clamp01((y - startY) / Math.max(endY - startY, 1));
          a.vp = a.dwell ? dwell(vraw, a.dwell) : vraw;
        }
        a.live = (y > a.top - vh * 1.25) && (y < a.top + a.height + vh * 1.25);
        a.el.style.setProperty('--sc-p', a.p.toFixed(4));

        // Fetch earlier than we drive. A 1080p clip is megabytes, and a reader
        // who scrolls briskly will otherwise arrive at a stage that is still
        // downloading and see a poster where the camera move should be.
        var warm = (y > a.top - vh * 3) && (y < a.top + a.height + vh * 1.5);
        a.warm = warm;
        if (warm) {
          if (a.video) loadVideo(a);
          if (a.seq) loadSeq(a);
          // Once, the first time the window is entered: a consumer (the 3D
          // module) that must start its own loading gets the same head start
          // the clips get.
          if (!a.warmed) {
            a.warmed = true;
            try { a.el.dispatchEvent(new CustomEvent('sc:warm', { bubbles: true, detail: { act: a } })); } catch (e) {}
          }
        }
        if (a.live && a.seq) drawSeq(a);
        if (a.video) { a.video.live = a.live; if (a.video.ready) a.video.target = a.vp; }

        // horizontal rail
        if (a.rail) {
          var over = a.rail.scrollWidth - vw;
          if (over > 0) {
            var extra = over * (a.railExtra || 0);
            a.rail.style.transform = 'translate3d(' + (-(over + extra) * a.p).toFixed(2) + 'px,0,0)';
          }
        }

        if (!a.live) {
          // An act that scrolls out of range must release its cues rather than
          // freezing them at whatever they last were. A "hold" cue left at
          // opacity 1 keeps its element hit-testable and paintable long after
          // its act is gone, which shows up as a stray headline over a later
          // section. Zero once, then leave it alone.
          if (a.parked !== true) {
            for (var z = 0; z < a.cues.length; z++) {
              var pq = a.cues[z];
              pq.el.style.opacity = '0';
              pq.el.style.pointerEvents = 'none';
              pq.state = 0;
              if (pq.units) for (var zu = 0; zu < pq.units.length; zu++) pq.units[zu].style.opacity = '0';
            }
            a.parked = true;
          }
          continue;
        }
        a.parked = false;

        // cues
        for (var c = 0; c < a.cues.length; c++) {
          var q = a.cues[c];
          var vis;
          if (q.to === null) {
            vis = smooth((a.p - q.from) / 0.18);
          } else {
            var win = Math.max(q.to - q.from, 0.001);
            var inEnd = q.from + win * q.rIn;        // full opacity from here
            var outStart = q.to - win * q.rOut;      // starts leaving here
            if (a.p < inEnd) vis = smooth((a.p - q.from) / Math.max(inEnd - q.from, 0.001));
            else if (a.p <= outStart) vis = 1;       // the plateau
            else vis = smooth(1 - (a.p - outStart) / Math.max(q.to - outStart, 0.001));
          }
          vis = clamp01(vis);

          if (q.kinetic) {
            if (!q.units) q.units = splitText(q.el, q.kinetic, splitSnap);
            var n = q.units.length;
            // Stagger across the reveal window. 0.62 spread leaves the tail of
            // the window for the last unit to finish, so the line lands together
            // rather than trickling.
            for (var u = 0; u < n; u++) {
              var uStart = (u / Math.max(n, 1)) * 0.62;
              var uv = clamp01((vis - uStart) / (1 - 0.62 + 0.001));
              uv = smooth(uv);
              q.units[u].style.opacity = uv.toFixed(3);
              q.units[u].style.transform = reduce ? 'none'
                : 'translate3d(0,' + ((1 - uv) * 100).toFixed(2) + '%,0)';
            }
            q.el.style.opacity = '1';
          } else {
            q.el.style.opacity = vis.toFixed(3);
            q.el.style.transform = reduce ? 'none'
              : 'translate3d(0,' + ((1 - vis) * 2.4 * q.rise).toFixed(2) + 'vh,0)';
          }
          var on = vis > 0.5;
          if (on !== (q.state === 1)) { q.state = on ? 1 : 0; q.el.style.pointerEvents = on ? 'auto' : 'none'; }
        }

        // parallax
        if (!reduce) {
          for (var pz = 0; pz < a.parallax.length; pz++) {
            var pp = a.parallax[pz];
            pp.el.style.transform = 'translate3d(0,' + (pp.rate * (a.p - 0.5) * 100).toFixed(2) + 'px,0)';
          }
        }

        // reveals
        for (var rv = 0; rv < a.reveals.length; rv++) {
          var R = a.reveals[rv];
          var t = smooth((a.p - R.from) / Math.max(R.to - R.from, 0.001));
          var pct = ((1 - t) * 100).toFixed(2);
          R.el.style.clipPath =
            R.dir === 'down' ? 'inset(' + pct + '% 0 0 0)' :
            R.dir === 'left' ? 'inset(0 ' + pct + '% 0 0)' :
            R.dir === 'right' ? 'inset(0 0 0 ' + pct + '%)' :
            R.dir === 'iris' ? 'circle(' + (t * 78).toFixed(2) + '% at 50% 50%)' :
                               'inset(0 0 ' + pct + '% 0)';
        }

        // counters
        for (var ct = 0; ct < a.counts.length; ct++) {
          var K = a.counts[ct];
          var kt = smooth((a.p - K.from) / Math.max(K.to - K.from, 0.001));
          var val = lerp(K.a, K.b, kt);
          var out = formatNum(val, K.tpl);
          if (out !== K.last) { K.el.textContent = out; K.last = out; }
        }
      }

      for (var w = 0; w < worlds.length; w++) readWorld(worlds[w]);

      // background drift
      for (var d = 0; d < drifts.length; d++) {
        var D = drifts[d];
        if (D.act.raw > 0 && D.act.raw < 1) {
          driftA = D; driftT = smooth(D.act.raw / 0.35);
          driftB = drifts[d - 1] || D;
          break;
        }
        if (D.act.raw >= 1) { driftA = D; driftB = D; driftT = 1; }
      }
      if (driftA) {
        modeEl.style.setProperty('--sc-canvas', mixColor(driftB.rgb, driftA.rgb, driftT));
      }

      if (progressBar) {
        if (scope === 'section') {
          // The section's own flow progress: 0 as its top enters the bottom of
          // the viewport, 1 as its bottom leaves the top.
          var rr = root.getBoundingClientRect();
          var rootTop = rr.top + y;
          progressBar.style.transform = 'scaleX(' + clamp01((y + vh - rootTop) / Math.max(rr.height + vh, 1)).toFixed(4) + ')';
        } else {
          var max = Math.max(document.body.scrollHeight - vh, 1);
          progressBar.style.transform = 'scaleX(' + clamp01(y / max).toFixed(4) + ')';
        }
      }

      for (var sb = 0; sb < subscribers.length; sb++) {
        try { subscribers[sb](api); } catch (e) { console.error('[scrollcraft] subscriber threw', e); }
      }
      if (typeof opts.onRead === 'function') {
        try { opts.onRead(api); } catch (e) { console.error('[scrollcraft] onRead threw', e); }
      }
    }

    // ---- video seek loop --------------------------------------------------
    // Split from read() on purpose: seeking is asynchronous and rate-limited by
    // the decoder, while read() must stay cheap enough to run on every scroll
    // event. The lerp here is also what turns a jittery wheel into a glide.
    function tick() {
      if (!alive) return;
      // Deadband. A phone decoder cannot service a seek every frame, so asking
      // for one costs more than it shows; 20ms of clip is under a frame of
      // footage anyway.
      var eps = isMobile() ? 0.02 : 0.008;
      for (var i = 0; i < playheads.length; i++) {
        var V = playheads[i];
        if (!V.ready) continue;
        // Never queue a seek while the decoder is still resolving the last one.
        // On a phone a fast flick otherwise piles seeks up and freezes the clip.
        // But a seek that never completes would freeze the clip for the life of
        // the page through this very guard, so a seek stuck past 700ms is
        // re-issued rather than waited on forever.
        if (V.el.seeking) {
          var nw = performance.now();
          if (!V.stuckAt) V.stuckAt = nw;
          else if (nw - V.stuckAt > 700) {
            V.stuckAt = nw;
            try { V.el.currentTime = V.el.currentTime + 0.001; } catch (e) {}
          }
          continue;
        }
        V.stuckAt = 0;
        // An offscreen clip that has already arrived stops costing anything.
        if (!V.live && Math.abs(V.cur - V.target) < 0.002) continue;
        V.cur += (V.target - V.cur) * (reduce ? 1 : V.lerp);
        var dur = V.el.duration || 1;
        var t = clamp(V.cur, 0, 0.999) * dur;
        if (Math.abs(V.el.currentTime - t) > eps) { try { V.el.currentTime = t; } catch (e) {} }
      }
      rafTick = requestAnimationFrame(tick);
    }

    // iOS will not paint a muted video that has never been handed a user
    // gesture, so a clip can be loaded, seeked and still show nothing.
    //
    // This used to fire once, on the first touch, across every playhead. That
    // loses a race it cannot win. The first act's clip is still being fetched
    // when the reader's first touch arrives (they touch the screen in order to
    // scroll, and the clip is megabytes) so play() is called on a video with
    // no source, does nothing, and the one shot is spent. Every later act loads
    // long after that touch, with user activation already granted, and works
    // without ever needing this. That is the exact shape of the bug: the hero
    // frozen, everything below it fine.
    //
    // So: keep listening, prime each clip once it actually has a source, and
    // stop only when they are all done. And force a seek afterwards, because a
    // primed decoder still shows the stale frame until something asks it for a
    // different time, and the deadband in tick() will not ask if the playhead is
    // already where it should be.
    var primedCount = 0;
    function primeClip(V) {
      // priming guards the retry: play() is a promise, and calling it again
      // while the last one is unsettled produces "interrupted by pause" and can
      // leave the element playing.
      if (V.primed || V.priming || !V.el.src) return;
      V.priming = true;
      var done = function () {
        V.priming = false;
        // The play() promise can settle after destroy() or a rescan(); the
        // element is not this record's to touch any more.
        if (!alive || V.gen !== gen) return;
        if (!V.primed) { V.primed = true; primedCount++; }
        try { V.el.pause(); } catch (e) {}
        // repaint: nudge past the deadband so the next tick writes for real
        try {
          var dur = V.el.duration || 1;
          V.cur = clamp(V.cur, 0, 0.999);
          V.el.currentTime = clamp(V.cur * dur + 0.05, 0, dur * 0.999);
        } catch (e) {}
      };
      var fail = function () { V.priming = false; };
      // A play() promise is allowed to stay pending forever (iOS does this to a
      // video it has decided not to start). If that happened here, `priming`
      // would jam and no gesture could ever retry, so the flag is released on a
      // timer as well. A late resolution after the release still lands in
      // done(), which is idempotent.
      later(function () { if (V.priming) fail(); }, 2000);
      var pr;
      try { pr = V.el.play(); } catch (e) { fail(); return; }
      if (pr && pr.then) pr.then(done, fail);
      else done();
    }
    function prime() {
      for (var i = 0; i < playheads.length; i++) primeClip(playheads[i]);
      if (playheads.length && primedCount >= playheads.length) {
        unlisten(window, 'touchstart', prime);
        unlisten(window, 'touchend', prime);
        unlisten(window, 'pointerdown', prime);
        unlisten(window, 'click', prime);
        unlisten(window, 'scroll', prime);
        primeWired = false;
      }
    }
    // touchend and click are here because the HTML spec's list of activation-
    // triggering events includes touchend but NOT touchstart. A restricted
    // device (Low Power Mode) that rejects the touchstart prime for lacking
    // activation gets a second, valid chance the moment the finger lifts.
    // Re-wired by rescan() when the listeners had already been released: the
    // new clip set is unprimed.
    var primeWired = false;
    function wirePrime() {
      if (primeWired) return;
      primeWired = true;
      listen(window, 'touchstart', prime, { passive: true });
      listen(window, 'touchend', prime, { passive: true });
      listen(window, 'pointerdown', prime, { passive: true });
      listen(window, 'click', prime, { passive: true });
      listen(window, 'scroll', prime, { passive: true });
    }

    // ---- pointer devices --------------------------------------------------
    // Collection (the three querySelectorAll calls) is part of collect() in
    // spirit: rescan() empties these arrays and initPointer() refills them.
    // The pointermove listener and its rAF loop are attached once per mount.
    var tilts = [], magnets = [], spots = [];
    var pointerWired = false;
    function initPointer() {
      if (reduce || !fineMQ.matches) return;
      Array.prototype.forEach.call(root.querySelectorAll('[data-sc-tilt]'), function (el) {
        snap(el);
        tilts.push({ el: el, max: parseFloat(el.getAttribute('data-sc-tilt')) || 6, x: 0, ty: 0, tx: 0, y: 0 });
      });
      Array.prototype.forEach.call(root.querySelectorAll('[data-sc-magnet]'), function (el) {
        snap(el);
        magnets.push({ el: el, k: parseFloat(el.getAttribute('data-sc-magnet')) || 0.3, x: 0, y: 0, tx: 0, ty: 0 });
      });
      Array.prototype.forEach.call(root.querySelectorAll('[data-sc-spotlight]'), function (el) {
        snap(el);
        spots.push(el);
      });
      if (!tilts.length && !magnets.length && !spots.length) return;
      if (pointerWired) return;
      pointerWired = true;

      listen(window, 'pointermove', function (e) {
        if (e.pointerType !== 'mouse') return;
        for (var i = 0; i < tilts.length; i++) {
          var T = tilts[i], r = T.el.getBoundingClientRect();
          if (r.bottom < -200 || r.top > vh + 200) { T.tx = 0; T.ty = 0; continue; }
          var nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
          var ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
          var inside = Math.abs(nx) < 1.6 && Math.abs(ny) < 1.6;
          T.tx = inside ? clamp(ny, -1, 1) * -T.max : 0;
          T.ty = inside ? clamp(nx, -1, 1) * T.max : 0;
        }
        for (var m = 0; m < magnets.length; m++) {
          var M = magnets[m], mr = M.el.getBoundingClientRect();
          var dx = e.clientX - (mr.left + mr.width / 2);
          var dy = e.clientY - (mr.top + mr.height / 2);
          var near = Math.abs(dx) < mr.width && Math.abs(dy) < mr.height * 2.5;
          M.tx = near ? dx * M.k : 0;
          M.ty = near ? dy * M.k : 0;
        }
        for (var s = 0; s < spots.length; s++) {
          var sr = spots[s].getBoundingClientRect();
          spots[s].style.setProperty('--sc-mx', clamp01((e.clientX - sr.left) / sr.width).toFixed(3));
          spots[s].style.setProperty('--sc-my', clamp01((e.clientY - sr.top) / sr.height).toFixed(3));
        }
      }, { passive: true });

      (function pointerTick() {
        if (!alive) return;
        // Interpolate toward the target rather than tracking the pointer
        // directly. Direct tracking reads as artificial because it carries no
        // momentum; the lerp gives it weight.
        for (var i = 0; i < tilts.length; i++) {
          var T = tilts[i];
          T.x += (T.tx - T.x) * 0.09; T.y += (T.ty - T.y) * 0.09;
          if (Math.abs(T.x) > 0.001 || Math.abs(T.y) > 0.001) {
            T.el.style.transform = 'perspective(1100px) rotateX(' + T.x.toFixed(3) + 'deg) rotateY(' + T.y.toFixed(3) + 'deg)';
          }
        }
        for (var m = 0; m < magnets.length; m++) {
          var M = magnets[m];
          M.x += (M.tx - M.x) * 0.12; M.y += (M.ty - M.y) * 0.12;
          M.el.style.transform = 'translate3d(' + M.x.toFixed(2) + 'px,' + M.y.toFixed(2) + 'px,0)';
        }
        rafPointer = requestAnimationFrame(pointerTick);
      })();
    }

    // ---- wiring -----------------------------------------------------------
    // Everything from here to the first layout() is wire(): the window
    // listeners and the fonts hook. It runs once per mount; rescan() keeps it.
    var ticking = false;
    function wire() {
    wirePrime();
    listen(window, 'scroll', function () {
      if (!ticking) { ticking = true; rafScroll = requestAnimationFrame(function () { ticking = false; if (alive) read(); }); }
    }, { passive: true });

    // Keyboard focus on a pinned or panning act. The browser's own
    // scroll-into-view parks the focused element barely on screen, which is
    // exactly the scroll position at which its cue has not opened yet, so focus
    // lands on a control nobody can see and every automated opacity check still
    // passes. Centring the act instead is a position where the cue is lit by
    // definition. behavior:'instant' on purpose: scrollcraft.css sets
    // scroll-behavior:smooth, so the default animates the jump and focus sits
    // off screen for the whole of a multi-screen glide.
    listen(window, 'focusin', function (e) {
      var el = e.target;
      if (!el || !el.closest) return;
      var act = el.closest('[data-sc-act]');
      if (!act || !root.contains(act)) return;
      var cue = el.closest('[data-sc-cue]');
      if (!cue) return;
      if (parseFloat(getComputedStyle(cue).opacity || '1') > 0.85) return;
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    });

    var lastW = innerWidth;
    listen(window, 'resize', function () {
      // Ignore URL-bar-only height changes on phones. Relaying out on those
      // makes the page jump under the reader's thumb for no reason.
      if (innerWidth === lastW && isMobile()) { vh = innerHeight; return; }
      lastW = innerWidth;
      layout();
    }, { passive: true });

    // The connection re-buckets: follow it for the class and for anything not
    // yet requested. Nothing painted is touched (a src swap is a black frame).
    if (typeof navigator !== 'undefined' && navigator.connection && navigator.connection.addEventListener) {
      listen(navigator.connection, 'change', function () {
        if (!alive) return;
        syncLite();
        read();
      });
    }

    if (document.fonts && document.fonts.ready) {
      // Line splitting measures line boxes, so it has to wait for the real face.
      document.fonts.ready.then(function () {
        if (!alive) return;
        resplit();
        layout();
      });
    }
    } // end wire()

    // Invalidate every kinetic split so the next read() measures again. The
    // original nodes go back first, so the re-split reads the author's text
    // rather than the joined text of the previous split.
    function resplit() {
      acts.forEach(function (a) { a.cues.forEach(function (q) { if (q.kinetic && q.units) { unsplit(q.el); q.el.__scSplit = null; q.units = null; } }); });
    }

    // ---- lifecycle --------------------------------------------------------
    function destroy() {
      if (!alive) return;
      alive = false;
      cancelAnimationFrame(rafTick); cancelAnimationFrame(rafPointer); cancelAnimationFrame(rafScroll);
      for (var i = subs.length - 1; i >= 0; i--) subs[i].t.removeEventListener(subs[i].type, subs[i].fn, subs[i].o);
      subs.length = 0;
      observers.forEach(function (o) { o.disconnect(); });
      observers.length = 0;
      timers.forEach(clearTimeout);
      timers.length = 0;
      playheads.forEach(releaseClip);
      releaseSeqs();
      blobs.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
      blobs.length = 0;
      acts.forEach(function (a) { a.el.style.removeProperty('--sc-p'); });
      restoreDom();
      var k = ScrollCraft.instances.indexOf(api);
      if (k > -1) ScrollCraft.instances.splice(k, 1);
      api.destroyed = true;
      // Restoring this mount's act heights moved everything below it. Other
      // mounts on the page measured their acts against the old geometry, so
      // they re-measure now rather than on the next resize.
      for (var s = 0; s < ScrollCraft.instances.length; s++) {
        var o = ScrollCraft.instances[s];
        if (o !== api && !o.destroyed && typeof o.layout === 'function') o.layout();
      }
    }
    function refresh() {
      if (!alive) { deadWarn('refresh'); return; }
      syncLite();
      resplit();
      layout();
    }
    function rescan() {
      if (!alive) { deadWarn('rescan'); return; }
      observers.forEach(function (o) { o.disconnect(); });
      observers.length = 0;
      // Element listeners (loadedmetadata, seeked) belong to the old clip set;
      // window listeners stay so the api identity holds.
      for (var i = subs.length - 1; i >= 0; i--) {
        if (subs[i].t !== window && subs[i].t !== (navigator.connection || null)) {
          subs[i].t.removeEventListener(subs[i].type, subs[i].fn, subs[i].o);
          subs.splice(i, 1);
        }
      }
      playheads.forEach(releaseClip);
      releaseSeqs();
      blobs.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
      blobs.length = 0;
      acts.forEach(function (a) { a.el.style.removeProperty('--sc-p'); });
      restoreDom();
      collect();
      wirePrime();
      initPointer();
      addClass(modeEl, 'sc-ready');
      syncLite();
      layout();
    }
    function subscribe(fn) {
      subscribers.push(fn);
      return function () { var k = subscribers.indexOf(fn); if (k > -1) subscribers.splice(k, 1); };
    }

    var api = {
      layout: layout, read: read, acts: acts, worlds: worlds, clips: playheads, lerp: 0,
      root: root, scope: scope,
      get media() { return isLite() ? 'lite' : 'full'; },
      subscribe: subscribe, refresh: refresh, rescan: rescan, destroy: destroy,
      destroyed: false
    };

    collect();
    api.lerp = LERP;
    wire();
    syncLite();
    layout();
    initPointer();
    rafTick = requestAnimationFrame(tick);
    addClass(modeEl, 'sc-ready');

    ScrollCraft.instances.push(api);
    return api;
  }

  // The instance list is not an API for the page. It is how the verification
  // harness reads the real playhead records: a screenshot taken mid-lerp is a
  // frame the page never actually holds, so the harness has to be able to ask
  // whether the playhead has arrived rather than guess with a timeout.
  var ScrollCraft = {
    mount: mount,
    get reduce() { env(); return reduce; },
    instances: [],
    version: VERSION
  };
  return ScrollCraft;
});
