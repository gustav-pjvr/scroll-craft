# Site mode: more than one page

Everything else in this skill describes one page. A site is a home page built
exactly that way plus a set of calmer inner pages that share its tokens, its
header and its transitions. Read this before planning a build whose brief
names more than one page, and record the choice in BRIEF.md's Site shape
field.

---

## 1. Home vs inner grammar

**The home page is the scroll experience.** Everything the skill does
today, unchanged: the grammar from uniqueness.md, the device score, the
signature move, the layered-stills default hero, worldflight if the brief
earns it.

**Inner pages use a calmer grammar**, because a visitor who followed a link
to "About" or "Contact" is looking for information, not a second ride:

- Real document flow. `flow` acts with `data-sc-in`, the same fade-and-rise
  the home page uses for its own flow sections.
- At most one `reveal` per page.
- No `scrub`. An inner page is not where the media budget goes.
- `pin` allowed once, with `data-sc-span` at or below 1.5.
- No `drift`. Each inner page paints its own ground; there is nothing long
  enough on one page to interpolate across.
- The same header and footer partial as the home page, the same tokens.

Nothing here forbids depth or feeling on an inner page. It forbids the home
page's whole toolkit from leaking onto a page that exists to be read, not
ridden.

---

## 2. Inner page shapes

One paragraph of shape per kind. Use real content; do not invent facts to
fill a shape.

- **About.** A short opening statement, then the actual story in reading
  order: origin, people, what changed. One photograph or plane composition
  at most, held to the inner grammar's `pin` cap if it moves at all.
- **Services.** A list that is actually a list: named offerings, what each
  one includes, who it is for. Resist turning it into a second hero; the
  home page already made the case, this page proves it.
- **Contact.** The form (see [subjects.md](subjects.md) for the rule that
  governs it), a real address or map when there is one, and the same
  primary CTA label as everywhere else on the site.
- **Article.** A single column, a byline, a date, real body copy set at
  taste.md's measure. `Article` JSON-LD when the subject is a case study;
  see subjects.md.
- **Case study.** Problem, approach, outcome, in that order, with real
  numbers where they exist and none where they do not. `data-sc-reveal`
  once, at the problem-to-approach turn, is the one `reveal` this page gets
  to spend. See subjects.md for the interview questions and the JSON-LD.

---

## 3. Shared tokens

The six colours and two fonts that theme `scrollcraft.css` (SKILL.md Step 4)
move into their own `tokens.css`, linked by every page before
`scrollcraft.css` (or `scrollcraft-section.css` on an inner page that mounts
a section rather than the whole page). The engine declares its defaults on
`:where(:root)`, which has zero specificity, so an author `:root` block wins
in any link order; linking tokens first is only a convention, because it reads
top to bottom as "brand, then mechanism". Before that change, tokens linked
first lost to the engine's own `:root` defaults at equal specificity, which
the first real site build hit.

The section stylesheet does the same with `:where(.sc-scope)`. A host page
themes a mounted section with its own `.sc-scope { --sc-... }` or
`#story { --sc-... }` rule, and it wins wherever it is linked. A host's
`:root` tokens do not leak into the scope: the section keeps its own defaults
until the host sets them on the scope itself.

```html
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="scrollcraft.css">
```

One file, one set of values, read once. A site that redefines the accent on
page three because nobody checked is not a brand, it is a rename in
progress.

---

## 4. The header partial

One header, used verbatim on every page: plain HTML fragment copied into
each page by the build (a static site) or one component (React, Astro). The
primary CTA carries **one label across the entire site**, the same rule
taste.md already states for a single page, now applied site-wide: a visitor
who reads "Get started" on the home page and "Start now" on the contact page
has just been told those are two different actions.

Navigation is real `<a href>` links to real pages. A site is not the place
to fake a multi-page structure with anchors into one long document; that is
what the single-page grammar in uniqueness.md is for.

---

## 5. Transitions between pages

Three options, in order of cost. Record the choice in BRIEF.md.

**Cross-document View Transitions, the default.** Zero JavaScript,
progressive (a browser without support just navigates), and it works on a
static host with no server logic. **Declare the opt-in inline in every
page's `<head>`, never only in an external stylesheet:**

```html
<head>
  <style>@view-transition { navigation: auto; }</style>
  <link rel="stylesheet" href="tokens.css">
  ...
```

Chrome decides whether to run the transition at the moment it lifts the
incoming page's render block, and at that moment it reads the incoming
document's `@view-transition` rule. When the rule lives only in an external
stylesheet and the page also compiles a large script (the engine is about
90 KB), that stylesheet has not been applied yet, Chrome sees no opt-in and
skips the transition; its trace says `SkipTransition` with reason
"ViewTransition opt-in disabled". Measured in Chrome 153, headed and
headless alike: rule external only, the transition ran on 0 of 6
navigations; the same pages with the rule inline in `<head>`, 6 of 6. Any
large script reproduces it, not only the engine, and `defer` neither causes
nor prevents it. The rest of the transition styling can stay in `tokens.css`:

```css
::view-transition-old(root),
::view-transition-new(root) { animation-duration: 0.32s; }

@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(root),
  ::view-transition-new(root) { animation: none; }
}
```

Name shared elements so they carry across the navigation instead of
crossfading with everything else:

```css
.site-bar__mark { view-transition-name: sc-mark; }
.hero-subject    { view-transition-name: sc-hero-subject; }
```

Give `sc-hero-subject` only to the element that is genuinely the same
subject on both pages (the home hero's product shot reappearing on its case
study). Naming two different things with the same transition name is a
worse jump cut than no transition at all.

If you load the engine with `defer`, as template.html does, mount on
`DOMContentLoaded`: a deferred script runs just before that event, and an
inline mount call would run before the engine exists.

```html
<script src="scrollcraft.js" defer></script>
<script>
  document.addEventListener('DOMContentLoaded', () => ScrollCraft.mount(document.body));
</script>
```

The engine on the outgoing page simply dies with the document; there is no
lifecycle work, because nothing survives the navigation to clean up.

**Barba.js or an SPA router.** Choose this when the site is already an SPA,
or needs a
transition the platform cannot do (a shared video element that must keep
playing across the navigation). It uses the
lifecycle API (`destroy()` on leave, `mount()` on enter):

```js
// Barba
barba.init({
  transitions: [{
    leave() { return scrollcraft?.destroy(); },
    enter(data) { window.scrollcraft = ScrollCraft.mount(data.next.container); }
  }]
});
```

```jsx
// React Router, via the adapter
useEffect(() => {
  const api = mount(ref.current, opts);
  return () => api.destroy();
}, [location.pathname]);
```

The adapter itself, including what it does under StrictMode and the
constraints on `style` and `className` for an engine-driven element, is
documented in `adapters/react/README.md`. Next.js and Astro each need a
slightly different mount point; see
[references/frameworks.md](frameworks.md) for both.

**No transitions.** A plain navigation, no crossfade. Acceptable for
editorial and gallery grammars, where a hard cut between pages reads as
correct rather than as a missing feature. Record it as a choice, not an
omission.

---

## 6. The fingerprint gate for a site

The gate in [uniqueness.md §4](uniqueness.md) runs **once per site**, keyed
on the home page, on the same six dimensions. Inner pages are not additional
rows: two different sites can share an inner-page shape without that
counting against either one. A seventh, informational column, **inner
grammar**, is recorded alongside the six gated dimensions so a future build
can see what inner-page shape a site used, but it does not gate.

The signature move lives on the home page. An inner page may echo it (a
trace rail that started on the home page continuing into an article) but
may not introduce a second one; a site with two signature moves has none,
because neither reads as the one the visitor remembers.

---

## 7. Verifying a site

`shoot.mjs` and `worldflight-assert.mjs` verify one page. For a site, add
`scripts/site-check.mjs`:

```bash
node <skill>/scripts/site-check.mjs --url http://localhost:4500 --out lab/site
```

It crawls same-origin links from the home page (depth 2, capped at 40
pages) and checks what a single-page shoot cannot: `tokens.css` and the
engine stylesheet loaded on every page, the header partial present with an
identical link set and CTA label, exactly one `<h1>` and a unique `<title>`
per page, no broken links, no console errors, no failed requests, no
horizontal overflow at 390px wide, and, when BRIEF.md declares transitions,
`@view-transition` present in a loaded stylesheet. It shoots top, middle and
bottom at 1440 by 900 and 390 by 844 and tiles a `site-sheet.png`, and it
runs the ordinary `shoot.mjs` pass on the home page. It runs the TEXT UNDER
CHROME check on every page's six shots. For an event whose date is not announced,
pass `--date-tba` (or `--brief <path>` so it reads the TBA state from
BRIEF.md) and it checks for the absence of date claims instead of their
presence (subjects.md, verify.md).

It does not grade contrast. That stays `shoot.mjs`'s job on the home page;
inner pages are static documents and get the standard contrast check
instead, which is a real limitation, not an oversight: a static page cannot
fail the composited, frame-by-frame contrast pass that a scrubbing hero can.
