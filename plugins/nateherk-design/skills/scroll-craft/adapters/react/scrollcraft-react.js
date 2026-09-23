/* ============================================================================
   scrollcraft-react: a thin React adapter for the scrollcraft engine
   ----------------------------------------------------------------------------
   Plain ES module. No JSX, no build step: every bundler (Vite, Next.js,
   webpack, Astro) consumes it as it is. React 18 or 19.

     useScrollCraft(ref, options)  -> apiRef   mount on ref.current
     <ScrollCraft as scope media lerp onReady className ...rest>
     <Kinetic as cue split rise ...rest>text</Kinetic>
     preloadScrollCraft(loader?)   -> Promise  warm the engine before render

   The engine owns the DOM inside the mount root while it is mounted: it writes
   inline opacity and transform on cues, adds classes (sc-ready, sc-in,
   sc-has-clip, sc-is-split) and splits kinetic headings into spans. React must
   not fight it, which is why:

   - the engine is mounted in an effect and destroyed in that effect's
     cleanup. StrictMode's mount, destroy, mount and a route change are both
     just "cleanup, then maybe mount again"; destroy() restores the DOM
     exactly, so a second mount starts from a clean root.
   - kinetic text goes through <Kinetic>, which hands React one opaque
     innerHTML string, so React never diffs inside a split heading. The
     element is keyed on its text: a text change replaces the element and
     asks the engine to rescan() once.
   - options.deps changing calls rescan(), not a remount, so the api object
     (and anything holding it) stays the same across content changes.

   Constraints the adapter cannot enforce are in README.md beside this file.
   ========================================================================== */

import {
  createContext,
  createElement,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef
} from 'react';

// ---- engine loading ---------------------------------------------------------

// The default location assumes the skill's own layout: adapters/react/ and
// engine/ side by side. If you copied the engine somewhere else, pass
// options.engine (an async function) or edit this one line.
function defaultEngineLoader() {
  return import('../../engine/scrollcraft.esm.js');
}

var EMPTY = [];
var PREFIX = '[scrollcraft-react] ';

// Resolved engines, keyed by loader function. A cache hit lets the effect mount
// synchronously, which matters for two reasons: the first frame after commit
// already carries the engine's styles, and StrictMode's double effect really
// does mount, destroy, mount instead of cancelling a pending import.
var resolved = new WeakMap();
var inflight = new WeakMap();

// Accepts whatever the loader resolves to: the ScrollCraft object itself, an
// ES module namespace whose default is ScrollCraft, a CommonJS interop wrapper
// ({ default: { default: ... } }), or nothing at all when the UMD file only
// assigned the global.
// globalName is where a UMD build may have put it instead ('ScrollCraft' for
// the engine, 'ScrollCraft3D' for the 3D module).
function unwrapEngine(mod, globalName) {
  var seen = 0;
  while (mod && typeof mod.mount !== 'function' && mod.default && seen < 3) {
    mod = mod.default;
    seen++;
  }
  if (mod && typeof mod.mount === 'function') return mod;
  var g = typeof globalThis !== 'undefined' ? globalThis[globalName || 'ScrollCraft'] : undefined;
  if (g && typeof g.mount === 'function') return g;
  return null;
}

function loadEngine(loader, globalName) {
  loader = loader || defaultEngineLoader;
  if (resolved.has(loader)) return Promise.resolve(resolved.get(loader));
  if (inflight.has(loader)) return inflight.get(loader);
  var p = Promise.resolve()
    .then(function () { return loader(); })
    .then(function (mod) {
      var engine = unwrapEngine(mod, globalName);
      if (!engine) throw new Error('the loader resolved, but no ' + (globalName || 'ScrollCraft') + '.mount was found in it');
      resolved.set(loader, engine);
      inflight.delete(loader);
      return engine;
    }, function (err) {
      inflight.delete(loader);
      throw err;
    });
  inflight.set(loader, p);
  return p;
}

/**
 * Start loading the engine before the first render. Optional. When the engine
 * is already resolved, useScrollCraft mounts synchronously inside its effect.
 * @param {() => Promise<unknown>} [loader]
 * @returns {Promise<object>} the ScrollCraft object
 */
export function preloadScrollCraft(loader) {
  return loadEngine(loader);
}

// ---- rescan scheduling ------------------------------------------------------

// Several <Kinetic> headings changing in one commit, plus a deps change in the
// same commit, must cost one rescan, not five. Coalesce per api ref into one
// microtask, which runs after React has committed the DOM and before paint.
var queued = new WeakSet();
var microtask = typeof queueMicrotask === 'function'
  ? queueMicrotask
  : function (fn) { Promise.resolve().then(fn); };

function scheduleRescan(apiRef) {
  if (!apiRef || queued.has(apiRef)) return;
  queued.add(apiRef);
  microtask(function () {
    queued.delete(apiRef);
    var api = apiRef.current;
    if (!api || api.destroyed) return;
    if (typeof api.rescan === 'function') api.rescan();
    else warnOnce('norescan', 'this engine has no rescan(); content changes inside a mount are not picked up. Update engine/scrollcraft.js.');
  });
}

var warned = {};
function warnOnce(key, msg) {
  if (warned[key]) return;
  warned[key] = true;
  if (typeof console !== 'undefined') console.warn(PREFIX + msg);
}

function sameDeps(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

// Only the options the engine reads go to mount(); adapter options stay here.
function engineOptions(o) {
  var out = {};
  if (o.scope != null) out.scope = o.scope;
  if (o.media != null) out.media = o.media;
  if (o.lerp != null) out.lerp = o.lerp;
  if (typeof o.onRead === 'function') out.onRead = o.onRead;
  return out;
}

// ---- the hook ----------------------------------------------------------------

/**
 * Mount the scrollcraft engine on ref.current for the life of the component.
 *
 * Mount-time options (scope, media, lerp, engine, threeD, threeDOptions) are
 * read once per mount. To change them, remount (change the component's key).
 * deps is the exception: when its contents change the hook calls rescan().
 *
 * @param {{ current: Element | null }} ref
 * @param {object} [options]
 * @returns {{ current: object | null }} a ref holding the live api, or null
 */
export function useScrollCraft(ref, options) {
  var apiRef = useRef(null);
  var optsRef = useRef(options || {});
  optsRef.current = options || {};

  useEffect(function () {
    var el = ref && ref.current;
    if (!el) return undefined;
    var alive = true;
    var api = null;
    var handle3d = null;
    var o = optsRef.current;
    var loader = typeof o.engine === 'function' ? o.engine : defaultEngineLoader;

    function start(engine) {
      if (!alive) return;
      var cur = optsRef.current;
      api = engine.mount(el, engineOptions(cur));
      apiRef.current = api;
      if (api && typeof api.destroy !== 'function') {
        warnOnce('nodestroy', 'this engine has no destroy(); unmounting cannot clean up and StrictMode will leak listeners. Update engine/scrollcraft.js.');
      }
      if (typeof cur.onReady === 'function') cur.onReady(api);
      if (typeof cur.threeD === 'function') start3d(cur);
    }

    function start3d(cur) {
      loadEngine(cur.threeD, 'ScrollCraft3D').then(function (m3d) {
        if (!alive) return null;
        var extra = cur.threeDOptions || {};
        var opts3d = Object.assign({}, extra, { api: api });
        return m3d.mount(el, opts3d);
      }).then(function (handle) {
        if (!handle) return;
        if (alive) { handle3d = handle; return; }
        // Unmounted while the 3D module was mounting.
        if (typeof handle.destroy === 'function') handle.destroy();
      }).catch(function (err) {
        if (alive && typeof console !== 'undefined') console.error(PREFIX + '3D module failed to load or mount', err);
      });
    }

    if (resolved.has(loader)) {
      start(resolved.get(loader));
    } else {
      loadEngine(loader).then(start, function (err) {
        if (alive && typeof console !== 'undefined') console.error(PREFIX + 'engine failed to load', err);
      });
    }

    return function () {
      alive = false;
      if (handle3d && typeof handle3d.destroy === 'function') handle3d.destroy();
      handle3d = null;
      if (api && typeof api.destroy === 'function') api.destroy();
      if (apiRef.current === api) apiRef.current = null;
      api = null;
    };
  }, [ref]);

  // deps: rescan when the contents change. Compared against the last seen
  // array so StrictMode's second effect pass (same deps) does not rescan.
  var deps = (options && options.deps) || EMPTY;
  var lastDeps = useRef(null);
  useEffect(function () {
    if (lastDeps.current === null) { lastDeps.current = deps; return; }
    if (sameDeps(lastDeps.current, deps)) return;
    lastDeps.current = deps;
    scheduleRescan(apiRef);
  }, deps);

  return apiRef;
}

// ---- <ScrollCraft> -------------------------------------------------------------

var ApiContext = createContext(null);

function hasClass(className, name) {
  return (' ' + (className || '') + ' ').indexOf(' ' + name + ' ') > -1;
}

function assignRef(r, value) {
  if (typeof r === 'function') r(value);
  else if (r) r.current = value;
}

/**
 * A mount root. Section scope by default, because a component is a part of a
 * page; in section scope the element also gets class "sc-scope", which
 * engine/scrollcraft-section.css keys on.
 */
export var ScrollCraft = forwardRef(function ScrollCraft(props, forwardedRef) {
  var as = props.as || 'section';
  var scope = props.scope || 'section';
  var className = props.className;
  if (scope === 'section' && !hasClass(className, 'sc-scope')) {
    className = className ? 'sc-scope ' + className : 'sc-scope';
  }

  var rest = {};
  for (var k in props) {
    if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
    if (k === 'as' || k === 'scope' || k === 'media' || k === 'lerp' || k === 'onReady' ||
        k === 'onRead' || k === 'engine' || k === 'deps' || k === 'threeD' ||
        k === 'threeDOptions' || k === 'className' || k === 'children') continue;
    rest[k] = props[k];
  }

  var elRef = useRef(null);
  var setRef = useCallback(function (node) {
    elRef.current = node;
    assignRef(forwardedRef, node);
  }, [forwardedRef]);

  var apiRef = useScrollCraft(elRef, {
    scope: scope,
    media: props.media,
    lerp: props.lerp,
    onRead: props.onRead,
    onReady: props.onReady,
    engine: props.engine,
    deps: props.deps,
    threeD: props.threeD,
    threeDOptions: props.threeDOptions
  });

  rest.ref = setRef;
  rest.className = className;
  return createElement(ApiContext.Provider, { value: apiRef },
    createElement(as, rest, props.children));
});

/**
 * The live api of the nearest <ScrollCraft>, as a ref (null until mounted).
 * @returns {{ current: object | null } | null}
 */
export function useScrollCraftApi() {
  return useContext(ApiContext);
}

// ---- <Kinetic> -------------------------------------------------------------------

var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
}

// Kinetic text is text. Strings and numbers (and arrays of them, which is what
// JSX produces for "Hello {name}") are joined; anything else is dropped with a
// warning, because the engine splits textContent and would flatten it anyway.
function textOf(children) {
  if (children == null || typeof children === 'boolean') return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) {
    var out = '';
    for (var i = 0; i < children.length; i++) out += textOf(children[i]);
    return out;
  }
  warnOnce('kinetictext', '<Kinetic> takes plain text only; element children were dropped.');
  return '';
}

/**
 * A kinetic heading. Renders data-sc-cue and data-sc-kinetic, and the text
 * HTML-escaped through dangerouslySetInnerHTML, so React never diffs the spans
 * the engine splits it into. Keyed on the text: a change replaces the element,
 * and inside a <ScrollCraft> the engine is asked to rescan() once.
 */
export function Kinetic(props) {
  var as = props.as || 'h2';
  var text = textOf(props.children);
  var rest = {};
  for (var k in props) {
    if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
    if (k === 'as' || k === 'cue' || k === 'split' || k === 'rise' || k === 'children') continue;
    rest[k] = props[k];
  }
  rest.key = text;
  rest['data-sc-cue'] = props.cue == null ? '0' : String(props.cue);
  rest['data-sc-kinetic'] = props.split || 'lines';
  if (props.rise != null) rest['data-sc-rise'] = String(props.rise);
  rest.dangerouslySetInnerHTML = { __html: escapeHtml(text) };

  var apiRef = useContext(ApiContext);
  var lastText = useRef(null);
  useEffect(function () {
    if (lastText.current === null) { lastText.current = text; return; }
    if (lastText.current === text) return;
    lastText.current = text;
    if (apiRef) scheduleRescan(apiRef);
  }, [text, apiRef]);

  return createElement(as, rest);
}

// Exposed for tests and for adapters to other frameworks.
export { escapeHtml as _escapeHtml, unwrapEngine as _unwrapEngine };
