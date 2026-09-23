/**
 * TEXT UNDER CHROME, shared by shoot.mjs and site-check.mjs.
 *
 * underChrome runs IN THE PAGE (hand it to page.evaluate), so it may use
 * nothing from this module's scope. Returns one row per text block whose ink
 * is overlapped by fixed or sticky chrome painted above it:
 *   { t: text snippet, by: covering element, px: overlap depth in px }
 *
 * Chrome is a fixed or sticky element that is visible, takes pointer events,
 * is not one of the engine's stages or a full-screen backdrop, and covers less
 * than 60% of the viewport. With a fill it covers its whole box; without one,
 * only its own text and images count.
 */
// In page: text whose ink is overlapped by fixed or sticky chrome painted
// above it. `all` checks every visible text node (the first screen); otherwise
// only cues that are meant to be visible where they are: a pinned act's cues
// at or near full strength, and worldflight copy blocks. Flow content that
// scrolls under a header while it is read is normal and is not reported.
export function underChrome({ all, scope }) {
  const R = (scope && document.querySelector(scope)) || document;
  const vw = innerWidth, vh = innerHeight;
  const snip = (el) => (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 46);
  const name = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
    (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "");
  const alpha = (c) => { const m = (c || "").match(/[\d.]+/g); return !m || m.length < 3 ? 0 : m.length < 4 ? 1 : +m[3]; };
  const textRects = (root) => {
    const out = [];
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = tw.nextNode());) {
      if (!n.nodeValue.trim()) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      for (const b of rg.getClientRects()) if (b.width >= 2 && b.height >= 6) out.push({ b, node: n });
    }
    return out;
  };

  // Chrome: fixed or sticky, visible, not the engine's own stages or a
  // full-screen backdrop, and what it actually paints (its box when it has a
  // fill, otherwise only its text and images).
  const chrome = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "sticky") continue;
    if (el.matches("[data-sc-stage],.sc-stage,[data-sc-world],[data-sc-world-copy],.sc-world,.sc-grain,[data-sc-progress]")) continue;
    if (el.closest("[data-sc-world],[data-sc-world-copy],[data-sc-stage]")) continue;
    if (cs.visibility === "hidden" || cs.display === "none" || (parseFloat(cs.opacity) || 0) < 0.1) continue;
    // pointer-events: none marks a decorative overlay (a bottom fade, a
    // vignette), not chrome a reader has to see past. Read it here, before
    // the hit-test probe below forces pointer-events on every element.
    if (cs.pointerEvents === "none") continue;
    const r = el.getBoundingClientRect();
    const iw = Math.min(r.right, vw) - Math.max(r.left, 0), ih = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    if (iw < 1 || ih < 1) continue;
    if (iw * ih > 0.6 * vw * vh) continue;
    const solid = alpha(cs.backgroundColor) >= 0.3 || cs.backgroundImage !== "none" ||
      (cs.backdropFilter && cs.backdropFilter !== "none");
    const paints = solid ? [r] : textRects(el).map((x) => x.b)
      .concat([...el.querySelectorAll("img,svg,video,canvas")].map((m) => m.getBoundingClientRect()));
    chrome.push({ el, paints });
  }
  if (!chrome.length) return [];
  const inChrome = (n) => chrome.some((c) => c.el.contains(n));

  const effOpacity = (el) => {
    let o = 1;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.visibility === "hidden" || cs.display === "none") return 0;
      o *= parseFloat(cs.opacity);
    }
    return o;
  };
  const cueOpacity = (el) => {
    const o = parseFloat(getComputedStyle(el).opacity) || 0;
    const units = el.querySelectorAll(".sc-split__i");
    if (!units.length) return o;
    let m = 0;
    units.forEach((u) => { m = Math.max(m, parseFloat(getComputedStyle(u).opacity) || 0); });
    return o * m;
  };

  let owners;
  if (all) owners = [R === document ? document.body : R];
  else {
    // Only while the act is actually stuck: on its entry and exit slides the
    // whole stage scrolls, and text passing under a header then is normal.
    const stuck = (act) => {
      const r = act.getBoundingClientRect();
      const s = (act.querySelector("[data-sc-stage]") || act).getBoundingClientRect();
      return r.top <= 1 && r.bottom >= vh - 1 && Math.abs(s.top) <= 1;
    };
    owners = [...R.querySelectorAll("[data-sc-cue],[data-sc-copy]")].filter((el) => {
      const act = el.closest("[data-sc-act]");
      const pinned = el.hasAttribute("data-sc-copy") ||
        (act && ["scrub", "pin", "pan"].includes(act.dataset.scAct) && stuck(act));
      return pinned && cueOpacity(el) >= 0.85;
    });
  }

  const hits = new Map();
  const probe = document.createElement("style");
  probe.textContent = "*{pointer-events:auto!important}";
  document.head.appendChild(probe);
  try {
    for (const owner of owners) {
      for (const { b, node } of textRects(owner)) {
        const pe = node.parentElement;
        if (!pe || inChrome(pe) || effOpacity(pe) < 0.5) continue;
        if (b.bottom <= 0 || b.top >= vh || b.right <= 0 || b.left >= vw) continue;
        // A line box carries leading above and below the glyphs; trim it so a
        // header that only touches the leading is not called a collision.
        const t = b.top + b.height * 0.15, bt = b.bottom - b.height * 0.15;
        for (const c of chrome) {
          for (const pr of c.paints) {
            const ix = Math.min(b.right, pr.right) - Math.max(b.left, pr.left);
            const iy = Math.min(bt, pr.bottom) - Math.max(t, pr.top);
            if (ix < 2 || iy < 2) continue;
            // Painted above the text? Hit-test the middle of the overlap.
            const cx = Math.max(0, Math.min(vw - 1, Math.max(b.left, pr.left) + ix / 2));
            const cy = Math.max(0, Math.min(vh - 1, Math.max(t, pr.top) + iy / 2));
            const stack = document.elementsFromPoint(cx, cy);
            const ci = stack.findIndex((e) => c.el === e || c.el.contains(e));
            const ti = stack.findIndex((e) => e === pe || pe.contains(e) || e.contains(pe));
            if (ci === -1 || (ti !== -1 && ti < ci)) continue;
            const blk = pe.closest("[data-sc-cue],[data-sc-copy],p,h1,h2,h3,h4,h5,h6,li,a,figcaption,blockquote,span") || pe;
            const key = snip(blk) + "|" + name(c.el);
            const prev = hits.get(key);
            if (!prev || prev.px < iy) hits.set(key, { t: snip(blk), by: name(c.el), px: Math.round(iy) });
          }
        }
      }
    }
  } finally { probe.remove(); }
  return [...hits.values()];
}
