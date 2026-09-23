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
 *   transition  @view-transition in a loaded stylesheet, when the site's
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
 *               declared). Chrome aborting the transition itself is printed
 *               as a BROWSER NOTE with its count, not scored (see smokeOnce)
 *   subject     --subject event: some page carries Event JSON-LD (an @type
 *               ending in Event, or Festival) whose startDate states a time
 *               zone, and some page links an .ics file
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
  rec.shots.push(...await shootThree(d.page, pages.length, "d"));
  const m = await open(phone, url);
  rec.overflow = m.error ? null : await m.page.evaluate(overflowAt, PHONE.width);
  if (!m.error) rec.shots.push(...await shootThree(m.page, pages.length, "m"));
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

async function shootThree(page, n, tag) {
  const out = [];
  const max = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - innerHeight));
  const ys = [0, Math.round(max / 2), max];
  for (let k = 0; k < 3; k++) {
    await page.evaluate((y) => scrollTo({ top: y, behavior: "instant" }), ys[k]);
    await page.waitForTimeout(350);
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
        if (types.some((t) => /Event$|^Festival$/.test(String(t)))) events.push({ type: types.join(","), startDate: o.startDate || null });
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
    sheets, hasVT, header: hdrInfo, forms, ld, links, ics,
    tokensOk: sheets.some((s) => s.name === tokens && s.loaded),
    engineCssOk: sheets.some((s) => /^scrollcraft(-section)?\.css$/.test(s.name) && s.loaded),
    engine: !!window.ScrollCraft,
  };
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
  checkForms(p);
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
  else {
    const withEvent = ok.filter((p) => p.facts.ld.some((b) => b.ok && b.events.length));
    const withIcs = ok.filter((p) => p.facts.ics);
    if (!withEvent.length) defect(null, "subject", "no page carries an Event JSON-LD block (subjects.md, events)");
    for (const p of withEvent) {
      for (const e of p.facts.ld.flatMap((b) => b.events || [])) {
        if (!e.startDate) defect(p.url, "subject", `${e.type} JSON-LD has no startDate`);
        else if (/T\d/.test(e.startDate) && !/(Z|[+-]\d\d:?\d\d)$/.test(e.startDate)) {
          defect(p.url, "subject", `${e.type} startDate "${e.startDate}" states no time zone`);
        }
      }
    }
    if (!withIcs.length) defect(null, "subject", "no page links an .ics calendar file (subjects.md, events)");
  }
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

// One click from home to the target. Chrome raising "InvalidStateError:
// Transition was aborted" on the incoming page is NOT scored as a page defect:
// in measurement it came from the browser, not page code. Headless Chrome 153
// aborts an inbound cross-document transition when a parser-blocking script
// delays the new page's first render (a plain busy loop reproduces it; the
// same pages with the engine loaded `defer` do not). It is counted and printed
// as a browser-level note so a reader can see it and decide.
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
  if (t.aborted) {
    console.log(`  BROWSER NOTE (not a page defect): Chrome aborted the view transition in ${t.aborted} of ${t.runs} runs ` +
      "(InvalidStateError: Transition was aborted). Seen when a parser-blocking script delays the incoming page's " +
      "first render; loading scrollcraft.js with defer removed it in measurement.");
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
