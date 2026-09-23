#!/usr/bin/env node
/**
 * scrollcraft site check: the things a single-page shoot cannot see.
 *
 * Crawls same-origin links from the home page and checks every page against
 * the site shape in references/site.md, then shoots each page top, middle and
 * bottom at desktop and phone size and tiles them into one site-sheet.png.
 *
 *   node site-check.mjs --url http://localhost:4500 --out lab/site
 *   node site-check.mjs --url ... --depth 2 --max 40
 *   node site-check.mjs --url ... --subject event          also lint the event rules
 *   node site-check.mjs --url ... --subject event --date-tba   the date is not announced yet
 *   node site-check.mjs --url ... --transitions none       site chose no page transition
 *   node site-check.mjs --url ... --brief BRIEF.md         read the transition choice from the brief
 *   node site-check.mjs --url ... --no-shoot               skip the shoot.mjs pass on the home page
 *
 * Per page (desktop 1440x900 unless noted):
 *   http        the page answers 200
 *   h1          exactly one <h1>
 *   title       a non-empty <title>, unique across the site
 *   tokens      tokens.css linked and loaded (--tokens to rename)
 *   engine-css  scrollcraft.css or scrollcraft-section.css linked and loaded
 *   header      the header partial is present with the home page's link set
 *   cta         and the home page's CTA label ([data-sc-cta], else .cta,
 *               else the header's last link; --header to pick the partial)
 *   console     no console errors (desktop and phone passes)
 *   requests    no failed requests and no 4xx or 5xx subresource
 *   overflow    no horizontal overflow at 390 wide (names the widest culprits)
 *   transition  @view-transition in a loaded stylesheet AND inline in <head>
 *               (external only: Chrome skips it on a page that loads a large
 *               script, see site.md §5), when the site's
 *               transition is View Transitions (the default; --transitions
 *               barba or none turns it off)
 *   form        every <form> posts (method="post") to an action that is not
 *               the page itself, and no GET form carries personal data (an
 *               email, tel or text input named like a name, email or phone).
 *               A search form (role="search", or only type=search inputs) may
 *               use GET.
 * Site-wide:
 *   links       every same-origin link resolves (4xx and 5xx are broken)
 *   transition  a click from home to an inner page navigates with no console
 *               error, three times (cross-document View Transitions, when
 *               declared). Chrome skipping or aborting the transition is printed
 *               as a TRANSITION NOTE with its count, not scored (see smokeOnce)
 *   subject     --subject event: some page carries Event JSON-LD (an @type
 *               ending in Event, or Festival) whose startDate is a date and
 *               time with a time zone and is not in the past (endDate, when
 *               given, counts as "not over yet"), and some page links an .ics
 *               file.
 *               With --date-tba (or a BRIEF.md line saying the date is to be
 *               announced, read via --brief) the lint turns round: no Event
 *               JSON-LD with a startDate, no .ics link, no countdown
 *               ([data-sc-countdown], or an id or class naming a countdown),
 *               and at least one page states the date is to be announced.
 *   chrome      per page, desktop and phone: no text sits under fixed or
 *               sticky chrome on the first screen, or in a pinned act while
 *               its cue is at full strength (the shoot.mjs TEXT UNDER CHROME
 *               check, run on the top, middle and bottom shots)
 *   shoot       shoot.mjs runs clean on the home page (its findings are
 *               advisory, as they are when you run it yourself)
 *
 * Exit 0 when nothing is found, 1 on any defect, 2 when the home page cannot
 * be reached. Writes site-report.json, per-page shots and site-sheet.png.
 *
 * Limits: contrast is graded only by the shoot pass on the home page; inner
 * pages are static documents and need an ordinary contrast audit. Off-origin
 * links are not requested. The --brief reading is a keyword match (Barba, or
 * "no transitions"), so pass --transitions when the brief says anything subtler.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let chromium;
try {
  ({ chromium } = createRequire(path.join(process.cwd(), "package.json"))("playwright-core"));
} catch {
  console.error("playwright-core not found. Run this in the build project after:\n  npm i playwright-core");
  process.exit(2);
}

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

const HOME = arg("--url", "http://localhost:4500");
const OUT = path.resolve(arg("--out", "lab/site"));
const DEPTH = Math.max(0, parseInt(arg("--depth", "2"), 10) || 0);
const MAX = Math.max(1, parseInt(arg("--max", "40"), 10) || 40);
const SUBJECT = arg("--subject", null);
const TOKENS = arg("--tokens", "tokens.css");
const HEADER = arg("--header", "header");
const SHOOT = !has("--no-shoot");
const MAX_LINK_CHECKS = 200;
const SMOKE_RUNS = 3;
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1440, height: 900 };

// Event date not yet announced: the flag, or a BRIEF.md line that says so
// ("date: to be announced", "TBA", "not yet announced", "not yet confirmed").
// The subject lint then asserts the ABSENCE of date claims instead of their
// presence (subjects.md, "date not yet announced").
const BRIEF_TEXT = arg("--brief", null) ? fs.readFileSync(path.resolve(arg("--brief")), "utf8") : "";
const DATE_TBA = has("--date-tba") ||
  /\bdates?\b[^\n]{0,60}\b(to be announced|tba|tbc|not (yet )?(announced|confirmed|set))\b/i.test(BRIEF_TEXT);

// Transition choice: explicit flag, else the brief, else the site.md default.
let TRANSITIONS = arg("--transitions", null);
let transitionsFrom = "flag";
if (!TRANSITIONS && arg("--brief", null)) {
  const brief = fs.readFileSync(path.resolve(arg("--brief")), "utf8");
  TRANSITIONS = /barba/i.test(brief) ? "barba"
    : /\bno (page )?transitions?\b|transitions?\s*[:=]\s*none/i.test(brief) ? "none" : "vt";
  transitionsFrom = "brief";
}
if (!TRANSITIONS) { TRANSITIONS = "vt"; transitionsFrom = "default"; }
if (!["vt", "barba", "none"].includes(TRANSITIONS)) {
  console.error(`--transitions must be vt, barba or none, got "${TRANSITIONS}"`);
  process.exit(2);
}

const CHROME = [
  process.env.SCROLLCRAFT_CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
].find((p) => p && fs.existsSync(p));
if (!CHROME) {
  console.error("No installed Chrome found. Set SCROLLCRAFT_CHROME to its path.");
  process.exit(2);
}

// ------------------------------------------------------------- urls ----
const ORIGIN = new URL(HOME).origin;
// One key per document: no hash, and /dir/index.html is the same page as /dir/.
function norm(u) {
  const x = new URL(u);
  x.hash = "";
  if (x.pathname.endsWith("/index.html")) x.pathname = x.pathname.slice(0, -"index.html".length);
  return x.href;
}
const short = (u) => { const x = new URL(u); return x.origin === ORIGIN ? x.pathname + x.search : u; };
const NOT_A_PAGE = /\.(ics|pdf|zip|png|jpe?g|webp|avif|gif|svg|mp4|webm|mp3|wav|css|js|mjs|json|xml|txt|woff2?|ttf)$/i;

// ---------------------------------------------------------- defects ----
const defects = [];
const defect = (page, check, detail) => defects.push({ page: page ? short(page) : "site", check, detail });

// ------------------------------------------------------------ crawl ----
fs.mkdirSync(path.join(OUT, "shots"), { recursive: true });
// Pin Chrome's own connection estimate to 4G. The engine holds clips on their
// posters when navigator.connection reads slow, and on a high-latency line
// Chrome's live estimate drifts to "3g" mid-run (measured 600 to 750 ms RTT on
// a 1.75 Mbps line), which silently turns an ordinary run into a lite one.
// --lite still installs its own slow connection on top of this.
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--force-effective-connection-type=4G"] });
const desk = await browser.newContext({ viewport: DESK, deviceScaleFactor: 1 });
const phone = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 1, isMobile: true, hasTouch: true });

const pages = [];                 // crawled HTML documents, in crawl order
const seen = new Set();
const linkSources = new Map();    // target url -> Set of source page urls
const queue = [{ url: norm(HOME), depth: 0 }];
seen.add(norm(HOME));

// Visits are capped as well as pages: a URL that redirects off-site or is not
// HTML costs a browser load but adds no page, so a page full of such links
// could otherwise keep the crawl going far past --max.
const MAX_VISITS = MAX * 2;
let visits = 0;
while (queue.length && pages.length < MAX && visits < MAX_VISITS) {
  const { url, depth } = queue.shift();
  visits++;
  const rec = await visit(url, depth);
  if (!rec) continue;
  pages.push(rec);
  for (const l of rec.facts?.links || []) {
    let t;
    try { t = norm(l); } catch { continue; }
    if (new URL(t).origin !== ORIGIN) continue;
    if (!linkSources.has(t)) linkSources.set(t, new Set());
    linkSources.get(t).add(url);
    if (!seen.has(t) && depth < DEPTH && !NOT_A_PAGE.test(new URL(t).pathname)) {
      seen.add(t);
      queue.push({ url: t, depth: depth + 1 });
    }
  }
}
if (!pages.length || pages[0].status == null) {
  console.error(`site-check: could not load ${HOME}${pages[0]?.error ? ": " + pages[0].error : ""}`);
  await browser.close();
  process.exit(2);
}
if (queue.length) console.log(`note: stopped at --max ${MAX}; ${queue.length} queued page(s) were not crawled`);

// Open one page, attach the collectors, and wait for the engine if it runs.
async function open(ctx, url) {
  const page = await ctx.newPage();
  const log = { console: [], failed: [] };
  page.on("console", (m) => { if (m.type() === "error") log.console.push({ text: m.text(), at: m.location()?.url || "" }); });
  page.on("pageerror", (e) => log.console.push({ text: String(e), at: "" }));
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (/^(data|blob):/.test(u) || r.resourceType() === "media") return;
    log.failed.push({ url: u, why: r.failure()?.errorText || "failed" });
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && r.request().resourceType() !== "document") {
      log.failed.push({ url: r.url(), why: `HTTP ${r.status()}` });
    }
  });
  let res = null, error = null;
  try {
    res = await page.goto(url, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => !window.ScrollCraft || !!document.querySelector(".sc-ready"),
      null, { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
  } catch (e) { error = String(e.message || e).split("\n")[0]; }
  return { page, log, res, error };
}

async function visit(url, depth) {
  const d = await open(desk, url);
  const rec = { url, depth, status: d.res ? d.res.status() : null, error: d.error, shots: [] };
  const type = d.res ? (d.res.headers()["content-type"] || "") : "";
  const final = d.page.url();
  if (d.error && !d.res) {
    defect(url, "http", `did not load: ${d.error}`);
    await d.page.close();
    return rec;
  }
  if (new URL(final).origin !== ORIGIN) {
    await d.page.close();
    return null;                                   // redirected off-site: not ours to check
  }
  if (!/text\/html/i.test(type)) {
    await d.page.close();
    return null;                                   // a file, handled by the link pass
  }
  if (rec.status !== 200) {
    defect(url, "http", `answered HTTP ${rec.status}`);
    await d.page.close();
    return rec;
  }
  rec.facts = await d.page.evaluate(pageFacts, { header: HEADER, tokens: TOKENS });
  rec.chrome = [];
  rec.shots.push(...await shootThree(d.page, pages.length, "d", rec.chrome));
  const m = await open(phone, url);
  rec.overflow = m.error ? null : await m.page.evaluate(overflowAt, PHONE.width);
  if (!m.error) rec.shots.push(...await shootThree(m.page, pages.length, "m", rec.chrome));
  rec.console = dedupeConsole([...d.log.console, ...m.log.console], [...d.log.failed, ...m.log.failed]);
  rec.failed = [...new Map([...d.log.failed, ...m.log.failed].map((f) => [f.url + f.why, f])).values()];
  await d.page.close();
  await m.page.close();
  return rec;
}

// Chrome logs every 404 subresource as a console error too. The request is
// already reported, so drop the echo rather than count one fault twice.
function dedupeConsole(msgs, failed) {
  const bad = new Set(failed.map((f) => f.url));
  const out = msgs.filter((c) => !(/^Failed to load resource/.test(c.text) && (bad.has(c.at) || !c.at)));
  return [...new Set(out.map((c) => c.text))];
}

async function shootThree(page, n, tag, chromeHits) {
  const out = [];
  const max = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - innerHeight));
  const ys = [0, Math.round(max / 2), max];
  for (let k = 0; k < 3; k++) {
    await page.evaluate((y) => scrollTo({ top: y, behavior: "instant" }), ys[k]);
    await page.waitForTimeout(350);
    // Text under fixed or sticky chrome: everything on the first screen, only
    // stuck pinned cues further down (flow text scrolling under a header is normal).
    if (chromeHits) {
      const hits = await page.evaluate(underChrome, { all: k === 0, scope: null });
      hits.forEach((h) => chromeHits.push({ ...h, where: `${tag === "d" ? "desktop" : "phone"} ${["top", "middle", "bottom"][k]}` }));
    }
    const file = path.join(OUT, "shots", `p${String(n).padStart(3, "0")}-${tag}${k}.png`);
    await page.screenshot({ path: file });
    out.push(file);
  }
  return out;
}

// ------------------------------------------------ in-page collectors ----
// Runs in the page. Everything the per-page checks need, in one pass.
function pageFacts({ header, tokens }) {
  const abs = (h) => { try { return new URL(h, location.href).href; } catch { return null; } };
  const normHref = (h) => {
    const u = abs(h);
    if (!u) return h;
    const x = new URL(u);
    if (x.pathname.endsWith("/index.html")) x.pathname = x.pathname.slice(0, -"index.html".length);
    return x.href;
  };
  const text = (el) => (el?.innerText || el?.textContent || "").trim().replace(/\s+/g, " ");
  const base = (h) => { try { return new URL(h, location.href).pathname.split("/").pop(); } catch { return ""; } };

  const sheets = [...document.querySelectorAll('link[rel~="stylesheet"]')].map((l) => ({
    href: l.href, name: base(l.getAttribute("href") || ""), loaded: !!l.sheet,
  }));

  // @view-transition anywhere in a readable stylesheet, including inside @media.
  const hasVT = (() => {
    const walk = (rules) => {
      for (const r of rules || []) {
        if ((r.constructor && r.constructor.name === "CSSViewTransitionRule") || /^@view-transition\b/.test(r.cssText)) return true;
        if (r.cssRules && walk(r.cssRules)) return true;
      }
      return false;
    };
    for (const s of document.styleSheets) {
      try { if (walk(s.cssRules)) return true; } catch { /* cross-origin sheet */ }
    }
    return false;
  })();
  // The opt-in has to be inline in <head>: Chrome reads it when it lifts the
  // incoming page's render block, before a large script lets an external
  // sheet apply, and skips the transition otherwise (site.md §5).
  const vtInline = [...document.querySelectorAll("head style")]
    .some((s) => /@view-transition\s*\{[^}]*navigation\s*:\s*auto/.test(s.textContent));

  const hdr = document.querySelector(header);
  const hdrInfo = hdr ? {
    links: [...new Set([...hdr.querySelectorAll("a[href]")].map((a) => normHref(a.getAttribute("href"))))].sort(),
    cta: text(hdr.querySelector("[data-sc-cta]") || hdr.querySelector(".cta") || [...hdr.querySelectorAll("a[href]")].pop()),
  } : null;

  const here = new URL(location.href);
  const forms = [...document.querySelectorAll("form")].map((f, i) => {
    const method = (f.getAttribute("method") || "get").trim().toLowerCase();
    const action = f.getAttribute("action");
    const fields = [...f.querySelectorAll("input, textarea, select")]
      .filter((e) => !["submit", "button", "hidden", "reset", "image"].includes((e.type || "").toLowerCase()));
    const search = f.getAttribute("role") === "search" || !!f.closest("search") ||
      (fields.length > 0 && fields.every((e) => (e.type || "").toLowerCase() === "search"));
    const personal = fields.filter((e) => ["email", "tel", "text"].includes((e.getAttribute("type") || "text").toLowerCase()) &&
      /(^|[_-])(name|full_?name|first_?name|last_?name|e-?mail|phone|tel|mobile)([_-]|$)|^(name|email|phone|tel)$/i
        .test(e.name || e.id || "")).map((e) => e.name || e.id);
    let self = false;
    if (action === null || action.trim() === "") self = true;
    else {
      try {
        const t = new URL(action, location.href);
        self = /^https?:$/.test(t.protocol) && t.origin === here.origin && t.pathname === here.pathname;
      } catch { self = false; }
    }
    const id = f.id ? `form#${f.id}` : `form ${i + 1}` + (fields[0] ? ` (${fields.map((e) => e.name || e.type).slice(0, 3).join(", ")})` : "");
    return { id, method, action, search, personal, self };
  });

  // JSON-LD: every @type anywhere in each block, @graph included.
  const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => {
    try {
      const data = JSON.parse(s.textContent);
      const events = [];
      const walk = (o) => {
        if (Array.isArray(o)) return o.forEach(walk);
        if (!o || typeof o !== "object") return;
        const types = [].concat(o["@type"] || []);
        if (types.some((t) => /Event$|^Festival$/.test(String(t)))) events.push({ type: types.join(","), startDate: o.startDate || null, endDate: o.endDate || null });
        Object.values(o).forEach(walk);
      };
      walk(data);
      return { ok: true, events };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  const links = [...document.querySelectorAll("a[href]")]
    .map((a) => a.getAttribute("href"))
    .filter((h) => h && !/^(mailto:|tel:|javascript:|#)/i.test(h.trim()))
    .map(abs).filter(Boolean);
  const ics = [...document.querySelectorAll("a[href]")].some((a) => {
    const h = a.getAttribute("href") || "";
    return /\.ics(\?|#|$)/i.test(h) || /^webcal:/i.test(h) || /^data:text\/calendar/i.test(h);
  });

  return {
    title: (document.title || "").trim(),
    h1: document.querySelectorAll("h1").length,
    sheets, hasVT, vtInline, header: hdrInfo, forms, ld, links, ics,
    tokensOk: sheets.some((s) => s.name === tokens && s.loaded),
    engineCssOk: sheets.some((s) => /^scrollcraft(-section)?\.css$/.test(s.name) && s.loaded),
    engine: !!window.ScrollCraft,
    // For the date-TBA lint: a countdown widget, and an honest "to be announced".
    countdown: (() => {
      const c = document.querySelector("[data-sc-countdown],[id*=countdown i],[class*=countdown i]");
      return c ? c.tagName.toLowerCase() + (c.id ? "#" + c.id : "") + (typeof c.className === "string" && c.className ? "." + c.className.trim().split(/\s+/)[0] : "") : null;
    })(),
    tba: /\b(to be announced|to be confirmed|date(s)? (is |are )?(tba|tbc)|(not yet|still to be) (announced|confirmed))\b/i.test(document.body ? document.body.innerText : ""),
  };
}

// Copied verbatim from shoot.mjs (keep the two in step).
// In page: text whose ink is overlapped by fixed or sticky chrome painted
// above it. `all` checks every visible text node (the first screen); otherwise
// only cues that are meant to be visible where they are: a pinned act's cues
// at or near full strength, and worldflight copy blocks. Flow content that
// scrolls under a header while it is read is normal and is not reported.
function underChrome({ all, scope }) {
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

// Runs in the phone page. Horizontal overflow, and who causes it.
function overflowAt(W) {
  const sw = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
  if (sw <= W + 1) return { width: sw, culprits: [] };
  const clips = (el) => {
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      if (/(hidden|clip|auto|scroll)/.test(getComputedStyle(p).overflowX)) return true;
    }
    return false;
  };
  const wide = [...document.body.querySelectorAll("*")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && (r.right > W + 1 || r.left < -1) && !clips(el);
  });
  // Outermost offenders only: a wide box drags its children out with it.
  const top = wide.filter((el) => !wide.includes(el.parentElement));
  const name = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
    (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).join(".") : "");
  return {
    width: sw,
    culprits: top.slice(0, 3).map((el) => `${name(el)} (${Math.round(el.getBoundingClientRect().width)}px wide, right edge ${Math.round(el.getBoundingClientRect().right)}px)`),
  };
}

// ----------------------------------------------------- page checks ----
const ok = pages.filter((p) => p.facts);
const homeRec = ok.find((p) => p.url === norm(HOME));
const refHeader = homeRec?.facts.header || null;
if (homeRec && !refHeader) defect(homeRec.url, "header", `the home page has no ${HEADER} element to use as the header partial`);

const titles = new Map();
for (const p of ok) titles.set(p.facts.title, [...(titles.get(p.facts.title) || []), p.url]);

for (const p of ok) {
  const f = p.facts;
  if (f.h1 !== 1) defect(p.url, "h1", `${f.h1} <h1> elements (exactly one required)`);
  if (!f.title) defect(p.url, "title", "empty <title>");
  else if (titles.get(f.title).length > 1) {
    defect(p.url, "title", `title "${f.title}" is shared with ${titles.get(f.title).filter((u) => u !== p.url).map(short).join(", ")}`);
  }
  if (!f.tokensOk) defect(p.url, "tokens", `${TOKENS} is not linked, or did not load`);
  if (!f.engineCssOk) defect(p.url, "engine-css", "scrollcraft.css (or scrollcraft-section.css) is not linked, or did not load");
  checkHeader(p);
  for (const c of p.console || []) defect(p.url, "console", c.slice(0, 200));
  for (const r of p.failed || []) defect(p.url, "requests", `${r.why} ${short(r.url)}`);
  if (p.overflow && p.overflow.culprits !== undefined && p.overflow.width > PHONE.width + 1) {
    defect(p.url, "overflow", `document is ${p.overflow.width}px wide at ${PHONE.width}` +
      (p.overflow.culprits.length ? `; widest: ${p.overflow.culprits.join("; ")}` : ""));
  }
  if (TRANSITIONS === "vt" && !f.hasVT) defect(p.url, "transition", "no @view-transition rule in any loaded stylesheet");
  else if (TRANSITIONS === "vt" && !f.vtInline) defect(p.url, "transition", "@view-transition is only in an external stylesheet; declare it inline in <head>, or Chrome skips the transition on a page that loads a large script (site.md §5)");
  checkForms(p);
  for (const h of p.chrome || []) defect(p.url, "chrome", `"${h.t}" sits under ${h.by} (${h.px}px deep, ${h.where})`);
  f.ld.filter((b) => !b.ok).forEach((b) => defect(p.url, "json-ld", `a JSON-LD block does not parse: ${b.error}`));
}

function checkHeader(p) {
  if (!refHeader || p === homeRec) return;
  const h = p.facts.header;
  if (!h) { defect(p.url, "header", `no ${HEADER} element: the shared header partial is missing`); return; }
  const missing = refHeader.links.filter((l) => !h.links.includes(l));
  const extra = h.links.filter((l) => !refHeader.links.includes(l));
  if (missing.length || extra.length) {
    defect(p.url, "header", "header links differ from the home page's" +
      (missing.length ? `; missing ${missing.map(short).join(", ")}` : "") +
      (extra.length ? `; extra ${extra.map(short).join(", ")}` : ""));
  }
  if (h.cta !== refHeader.cta) defect(p.url, "cta", `CTA label "${h.cta}", the home page says "${refHeader.cta}"`);
}

function checkForms(p) {
  for (const f of p.facts.forms) {
    if (f.method === "get" && f.personal.length) {
      defect(p.url, "form", `${f.id} puts personal data (${f.personal.join(", ")}) in the URL: method is GET`);
    } else if (!f.search && f.method !== "post") {
      defect(p.url, "form", `${f.id} method is "${f.method}", must be post`);
    }
    if (!f.search && f.self) {
      defect(p.url, "form", `${f.id} has ${f.action === null ? "no action" : `action "${f.action}"`}: it submits to the page itself, not to a real endpoint`);
    }
  }
}

// ------------------------------------------------------ link check ----
const byUrl = new Map(pages.map((p) => [p.url, p]));
let checked = 0;
for (const [target, from] of linkSources) {
  let status = byUrl.get(target)?.status;
  if (status === undefined) {
    if (checked >= MAX_LINK_CHECKS) continue;
    checked++;
    try {
      const r = await desk.request.get(target, { maxRedirects: 5, timeout: 15000 });
      status = r.status();
    } catch (e) { status = String(e.message || e).split("\n")[0]; }
  }
  if (status === null || typeof status === "string" || status >= 400) {
    for (const src of from) defect(src, "links", `broken link -> ${short(target)} (${status ?? "no response"})`);
  }
}

// --------------------------------------------------- subject: event ----
if (SUBJECT) {
  if (SUBJECT !== "event") console.log(`note: no lint exists for --subject ${SUBJECT}; only "event" is checked`);
  else if (DATE_TBA) lintEventTba();
  else lintEventDated();
}

// A claimed date: Event JSON-LD whose startDate is a date AND time with a time
// zone (a date-only startDate cannot say when the day starts for a visitor in
// another zone), not already over, plus an .ics link somewhere on the site.
function lintEventDated() {
  const withEvent = ok.filter((p) => p.facts.ld.some((b) => b.ok && b.events.length));
  const withIcs = ok.filter((p) => p.facts.ics);
  if (!withEvent.length) defect(null, "subject", "no page carries an Event JSON-LD block (subjects.md, events). If the date is not announced yet, run with --date-tba");
  const now = Date.now(), DAY = 86400000;
  for (const p of withEvent) {
    for (const e of p.facts.ld.flatMap((b) => b.events || [])) {
      if (!e.startDate) { defect(p.url, "subject", `${e.type} JSON-LD has no startDate`); continue; }
      if (!/T\d/.test(e.startDate)) defect(p.url, "subject", `${e.type} startDate "${e.startDate}" is a date without a time and time zone`);
      else if (!/(Z|[+-]\d\d:?\d\d)$/.test(e.startDate)) defect(p.url, "subject", `${e.type} startDate "${e.startDate}" states no time zone`);
      const end = Date.parse(e.endDate || e.startDate);
      if (!isNaN(end) && end + (e.endDate ? 0 : DAY) < now) {
        defect(p.url, "subject", `${e.type} ${e.endDate ? "endDate" : "startDate"} "${e.endDate || e.startDate}" is in the past: a finished event is not the next one`);
      }
    }
  }
  if (!withIcs.length) defect(null, "subject", "no page links an .ics calendar file (subjects.md, events)");
}

// Date not announced: the honest page makes no date claim a machine or a
// visitor could act on, and says plainly that the date is to be announced.
function lintEventTba() {
  for (const p of ok) {
    for (const e of p.facts.ld.flatMap((b) => (b.ok && b.events) || [])) {
      if (!e.startDate) continue;
      // A past edition's Event block is an archive record (a results page), not
      // a claim about the next date. Only a current or future date is a claim.
      const end = Date.parse(e.endDate || e.startDate);
      if (!isNaN(end) && end + (e.endDate ? 0 : 86400000) < Date.now()) continue;
      defect(p.url, "subject", `date is TBA, but ${e.type} JSON-LD claims startDate "${e.startDate}"`);
    }
    if (p.facts.ics) defect(p.url, "subject", "date is TBA, but the page links an .ics calendar file");
    if (p.facts.countdown) defect(p.url, "subject", `date is TBA, but the page has a countdown (${p.facts.countdown})`);
  }
  if (!ok.some((p) => p.facts.tba)) defect(null, "subject", "date is TBA, but no page says so (an honest \"to be announced\" line and an updates route, subjects.md)");
}

// --------------------------------------------- transition smoke test ----
let transitionSmoke = null;
if (TRANSITIONS === "vt" && homeRec) {
  const target = homeRec.facts.links.map((l) => { try { return norm(l); } catch { return null; } })
    .find((l) => l && l !== homeRec.url && byUrl.get(l)?.status === 200);
  if (target) {
    transitionSmoke = { from: short(homeRec.url), to: short(target), runs: SMOKE_RUNS, navigated: 0, ran: 0, aborted: 0, startViewTransition: null, errors: [] };
    for (let run = 0; run < SMOKE_RUNS; run++) await smokeOnce(target, transitionSmoke);
    const t = transitionSmoke;
    if (t.navigated < t.runs) defect(homeRec.url, "transition", `clicking through to ${t.to} navigated in ${t.navigated} of ${t.runs} runs`);
    for (const e of [...new Set(t.errors)]) defect(target, "transition", `console error during the navigation from home: ${e.slice(0, 200)}`);
  }
}

// One click from home to the target. A transition that Chrome skips or aborts
// on the incoming page (pagereveal carries no viewTransition, or its promise
// rejects with InvalidStateError) is NOT scored as a page defect; it is counted
// and printed as a note so a reader can see it and decide. What is measured
// (lab/tests/engine/vt, Chrome 153, headless and headed alike): Chrome reads
// the incoming page's @view-transition rule when it lifts the render block; if
// the rule is only in an external stylesheet and the page compiles a large
// script, that sheet has not applied yet and Chrome skips ("ViewTransition
// opt-in disabled"). Rule external only: 0 of 6; inline in <head>: 6 of 6. The
// per-page "transition" check flags the external-only case as a defect.
async function smokeOnce(target, t) {
  const d = await open(desk, homeRec.url);
  await d.page.addInitScript(() => {
    addEventListener("pagereveal", (e) => { window.__scVT = e.viewTransition ? "ran" : "none"; });
  });
  if (t.startViewTransition === null) t.startViewTransition = await d.page.evaluate(() => typeof document.startViewTransition === "function");
  const before = d.log.console.length;
  try {
    await Promise.all([
      d.page.waitForURL((u) => norm(u.href) === target, { timeout: 15000 }),
      d.page.evaluate((tu) => {
        const a = [...document.querySelectorAll("a[href]")].find((x) => {
          try { const u = new URL(x.href); u.hash = ""; return u.href === tu || u.href === tu + "index.html"; } catch { return false; }
        });
        a.click();
      }, target),
    ]);
    await d.page.waitForLoadState("load");
    await d.page.waitForTimeout(600);
    t.navigated++;
    if (await d.page.evaluate(() => window.__scVT === "ran")) t.ran++;
  } catch { /* counted by navigated */ }
  for (const c of d.log.console.slice(before)) {
    if (/Transition was aborted/i.test(c.text)) t.aborted++;
    else if (!/^Failed to load resource/.test(c.text)) t.errors.push(c.text);   // scored by the requests check
  }
  await d.page.close();
}

await browser.close();

// ----------------------------------------------------- shoot on home ----
let shoot = null;
if (SHOOT && homeRec) {
  console.log(`\nshoot.mjs on the home page ...`);
  const r = spawnSync(process.execPath, [path.join(HERE, "shoot.mjs"), "--url", homeRec.url, "--out", path.join(OUT, "home-shoot")],
    { cwd: process.cwd(), encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024 });
  const outText = (r.stdout || "") + (r.stderr || "");
  const findings = outText.split("\n").filter((l) => /^[A-Z][A-Z -]{6,}[:(]/.test(l.trim())).map((l) => l.trim());
  shoot = { status: r.status, findings, out: path.join(OUT, "home-shoot") };
  if (r.status !== 0) defect(homeRec.url, "shoot", `shoot.mjs exited ${r.status}: ${outText.trim().split("\n").slice(-3).join(" | ")}`);
}

// ---------------------------------------------------------- sheet ----
const sheet = tileSheet(ok.filter((p) => p.shots.length === 6));

function pickFfmpeg() {
  const tryOne = (c) => {
    try {
      return execFileSync(c, ["-hide_banner", "-filters"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
        .split("\n").length > 200;
    } catch { return false; }
  };
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const winget = path.join(home, "AppData/Local/Microsoft/WinGet/Packages");
  const globbed = fs.existsSync(winget) ? fs.readdirSync(winget).filter((d) => /^Gyan\.FFmpeg/i.test(d))
    .flatMap((d) => fs.readdirSync(path.join(winget, d)).map((v) => path.join(winget, d, v, "bin/ffmpeg.exe"))) : [];
  return [process.env.SCROLLCRAFT_FFMPEG, "ffmpeg", ...globbed, "/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/bin/ffmpeg"]
    .filter(Boolean).find(tryOne) || null;
}

// One 1440x600 block per page (desktop top, middle, bottom over phone top,
// middle, bottom), stacked in crawl order.
function tileSheet(list) {
  if (!list.length) return null;
  const ff = pickFfmpeg();
  if (!ff) { console.log("site sheet skipped: no full ffmpeg build found (set SCROLLCRAFT_FFMPEG)"); return null; }
  const tmp = path.join(OUT, "blocks");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const cell = "480:300";
  const graph = [0, 1, 2].map((i) => `[${i}]scale=${cell}[d${i}]`)
    .concat([3, 4, 5].map((i) => `[${i}]scale=-2:300,pad=${cell}:(ow-iw)/2:0:color=0x16181c[m${i}]`))
    .concat(["[d0][d1][d2]hstack=3[t]", "[m3][m4][m5]hstack=3[u]", "[t][u]vstack=2"]).join(";");
  for (let i = 0; i < list.length; i++) {
    const r = spawnSync(ff, ["-y", "-v", "error", ...list[i].shots.flatMap((s) => ["-i", s]),
      "-filter_complex", graph, "-frames:v", "1", path.join(tmp, `${String(i).padStart(3, "0")}.png`)], { encoding: "utf8" });
    if (r.status !== 0) { console.log(`site sheet skipped: ffmpeg failed on ${short(list[i].url)}: ${(r.stderr || "").trim()}`); return null; }
  }
  const file = path.join(OUT, "site-sheet.png");
  const r = spawnSync(ff, ["-y", "-v", "error", "-i", path.join(tmp, "%03d.png"), "-vf", `tile=1x${list.length}`,
    "-frames:v", "1", file], { encoding: "utf8" });
  if (r.status !== 0) { console.log(`site sheet skipped: ${(r.stderr || "").trim()}`); return null; }
  return { file, order: list.map((p) => short(p.url)) };
}

// ---------------------------------------------------------- report ----
const report = {
  home: HOME, depth: DEPTH, max: MAX, transitions: TRANSITIONS, transitionsFrom, subject: SUBJECT,
  pages: pages.map((p) => ({
    url: short(p.url), depth: p.depth, status: p.status, title: p.facts?.title, h1: p.facts?.h1,
    engine: p.facts?.engine, overflowWidth: p.overflow?.width, shots: p.shots.map((s) => path.relative(OUT, s)),
  })),
  linksChecked: linkSources.size, transitionSmoke, shoot, sheet, defects,
};
fs.writeFileSync(path.join(OUT, "site-report.json"), JSON.stringify(report, null, 2));

console.log(`\nsite-check  ${HOME}  depth ${DEPTH}, max ${MAX}, transitions ${TRANSITIONS} (${transitionsFrom})` +
  (SUBJECT ? `, subject ${SUBJECT}` : ""));
console.log(`crawled ${pages.length} page(s), checked ${linkSources.size} same-origin link target(s)`);
for (const p of pages) console.log(`  ${String(p.status ?? "---").padEnd(4)} ${short(p.url)}${p.facts ? `  "${p.facts.title}"` : ""}`);
if (transitionSmoke) {
  const t = transitionSmoke;
  console.log(`transition smoke: ${t.from} -> ${t.to}, navigated ${t.navigated} of ${t.runs}, view transition ran ${t.ran} of ${t.runs}` +
    `, document.startViewTransition ${t.startViewTransition ? "present" : "absent"} in this Chrome`);
  if (t.ran < t.navigated) {
    console.log(`  TRANSITION NOTE (not scored): the view transition ran on ${t.ran} of ${t.navigated} navigations` +
      (t.aborted ? ` (${t.aborted} aborted with InvalidStateError)` : "") + ". The usual cause: @view-transition declared only in an external stylesheet on a page that " +
      "loads a large script, so Chrome sees no opt-in when it lifts the render block. Declare it inline in <head> " +
      "(site.md §5); the per-page transition check reports the pages where it is not.");
  }
}
if (shoot) {
  console.log(`home shoot: exit ${shoot.status}, ${shoot.out}`);
  if (shoot.findings.length) console.log("  advisory findings (read home-shoot/sheet.png):\n    " + shoot.findings.join("\n    "));
}
if (sheet) console.log(`site sheet: ${sheet.file}\n  rows, top to bottom: ${sheet.order.join(", ")}`);

if (defects.length) {
  console.log(`\nDEFECTS (${defects.length}):`);
  const groups = new Map();
  for (const d of defects) groups.set(d.page, [...(groups.get(d.page) || []), d]);
  for (const [pg, ds] of groups) {
    console.log(`  ${pg}`);
    for (const d of ds) console.log(`    [${d.check}] ${d.detail}`);
  }
  console.log(`\nsite-report.json in ${OUT}`);
  process.exit(1);
}
console.log(`\nno defects found\nsite-report.json in ${OUT}`);
