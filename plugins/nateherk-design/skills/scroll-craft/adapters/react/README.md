# scrollcraft-react

A thin React adapter for the scrollcraft engine. One plain ES module
(`scrollcraft-react.js`, written with `createElement`, no JSX, no build step)
and its types (`scrollcraft-react.d.ts`). Works with React 18 and 19 in any
bundler: Vite, Next.js, webpack, Astro.

The adapter does not change how a scrollcraft page is authored. Acts, stages,
cues and devices are still `data-sc-*` attributes on real elements; the adapter
only decides **when** the engine mounts, rescans and is destroyed, and keeps
React out of the parts of the DOM the engine owns.

Needs an engine with the lifecycle api (`destroy()`, `rescan()`), which is
engine 0.4.0 and later. With an older engine the adapter warns once and cannot
clean up.

---

## Files to copy

Copy the skill's `engine/` and `adapters/react/` folders into your project
**side by side**, for example:

```
src/scrollcraft/engine/scrollcraft.js
src/scrollcraft/engine/scrollcraft.esm.js
src/scrollcraft/engine/scrollcraft.css            (the whole page is the experience)
src/scrollcraft/engine/scrollcraft-section.css    (a component inside a host page)
src/scrollcraft/adapters/react/scrollcraft-react.js
src/scrollcraft/adapters/react/scrollcraft-react.d.ts
```

The adapter loads the engine lazily with
`import('../../engine/scrollcraft.esm.js')`, so that relative layout is what it
expects. If the engine lives somewhere else, pass `engine` (below) **and** edit
the one line in `defaultEngineLoader()`: bundlers resolve that static import at
build time even when you never call it.

Import the stylesheet once, globally (a root layout, `main.jsx`, or the Astro
page frontmatter). The adapter never imports CSS.

---

## Usage

```jsx
import { ScrollCraft, Kinetic } from './scrollcraft/adapters/react/scrollcraft-react.js';
import './scrollcraft/engine/scrollcraft-section.css';

export function Story({ headline }) {
  return (
    <ScrollCraft id="story" media="auto" onReady={(api) => console.info(api.scope)}>
      <section data-sc-act="pin" data-sc-span="2.4">
        <div data-sc-stage>
          <img className="sc-stage__poster" src="/hero.webp" alt="" />
          <div className="sc-copy sc-copy--lead">
            <Kinetic as="h1" cue="0 0.78 0" split="lines" className="sc-display sc-display--xl">
              {headline}
            </Kinetic>
          </div>
        </div>
      </section>
      <section className="sc-section" data-sc-act="flow">
        <p data-sc-in>Real document flow after the pin.</p>
      </section>
    </ScrollCraft>
  );
}
```

### `<ScrollCraft>`

| Prop | Default | Notes |
|---|---|---|
| `as` | `'section'` | Element to render |
| `scope` | `'section'` | A component is part of a page, so section mode is the default. In section scope the element also gets class `sc-scope`, which `scrollcraft-section.css` keys on. Use `scope="page"` with `scrollcraft.css` when the whole app is the scroll page |
| `media` | engine default (`'auto'`) | `'auto' \| 'lite' \| 'full'` |
| `lerp` | engine default | Playhead smoothing |
| `onReady` | none | `(api) => void`, once per mount |
| `onRead` | none | Passed to the engine, called after every `read()` |
| `deps` | `[]` | When its contents change (compared element by element) the adapter calls `api.rescan()` once. The length may change and the prop may come and go; omitted counts as `[]` |
| `engine` | the default loader | Async function returning the engine (module or object) |
| `threeD`, `threeDOptions` | none | See "3D" below |
| `className`, anything else | | Passed to the element. Keep `className` static |

`ref` is forwarded to the rendered element.

### `useScrollCraft(ref, options)`

The same thing as a hook, for when the mount root is an element you already
render. Returns a ref whose `.current` is the live api (null before mount and
after unmount).

```jsx
const root = useRef(null);
const api = useScrollCraft(root, { scope: 'section', deps: [items.length] });
return <div ref={root} className="sc-scope">...</div>;
```

Options: `scope`, `media`, `lerp`, `onRead`, `onReady`, `engine`, `deps`,
`threeD`, `threeDOptions`. Everything except `deps` is read once per mount; to
change `scope`, `media` or `lerp`, remount (change the component's `key`).

### `<Kinetic>`

```jsx
<Kinetic as="h2" cue="0.1 0.7" split="lines" rise={1}>Coffee that pulls its weight.</Kinetic>
```

Renders `data-sc-cue`, `data-sc-kinetic` (and `data-sc-rise` when given) on
the same element, which is where the engine looks for them, and
the text **HTML-escaped** through `dangerouslySetInnerHTML`, so React hands the
element one opaque string and never diffs the spans the engine splits it into.
The element is keyed on its text: when the text changes React replaces the
element, and inside a `<ScrollCraft>` the adapter asks the engine for one
`rescan()` (several headings changing in one commit still cost one rescan).
With the bare hook there is no context, so put the text in `deps`.

Children must be plain text: strings and numbers, or an array of them (which is
what `Hello {name}` produces). Elements are dropped with a warning.

### `preloadScrollCraft(loader?)`

Optional. Resolves the engine before first render. When the engine is already
resolved the effect mounts synchronously, so the first painted frame already
carries the engine's styles. Without it the first mount waits for the dynamic
import.

### `useScrollCraftApi()`

Inside a `<ScrollCraft>`, returns the api ref of the nearest one.

### 3D

```jsx
const load3d = () => import('./scrollcraft/engine/scrollcraft-3d.js');
<ScrollCraft threeD={load3d} threeDOptions={{ frame(ctx, p) { /* signature move */ } }}>...</ScrollCraft>
```

After the engine mounts, the adapter calls
`ScrollCraft3D.mount(root, { ...threeDOptions, api })` and destroys that handle
in the same cleanup, before the engine's `destroy()`.

Define loaders (`engine`, `threeD`) at module scope, not inline, so their
identity is stable and the resolved engine is reused across mounts.

---

## Lifecycle

- **Mount** happens in `useEffect`, after commit. The engine measures in
  `layout()`, which is fine one frame after commit.
- **Unmount** (a route change, a conditional render, `root.unmount()`) runs the
  effect cleanup, which calls `destroy()`. The engine removes every listener,
  observer, timer and blob URL it created and restores every inline style,
  class and split heading it touched.
- **StrictMode** in development runs mount, cleanup, mount. Because destroy is
  exact, the second mount starts from a clean root and exactly one instance is
  live. If the engine was not preloaded, the first mount is still waiting on
  the import when the cleanup runs, so it is cancelled rather than mounted and
  destroyed; either way one instance is live.
- **Content changes** inside the root (acts added or removed, a list that
  grows) need `rescan()`: pass the values that drive them in `deps`. The api
  object stays the same.
- **Server rendering**: nothing runs on the server. The engine is only
  imported inside the effect, so it never executes during SSR.

## Constraints (read these)

The engine writes to the DOM React rendered. These rules keep the two from
fighting; the adapter cannot enforce them.

1. **No `style` with `opacity` or `transform` on an engine-driven element.**
   Cues, kinetic headings and their units, `data-sc-parallax`, `data-sc-pan`
   rails, reveals, tilt and magnet targets all get inline `opacity`,
   `transform` or `clip-path` from the engine. React re-applies a `style` prop
   on the next render and overwrites the engine's value. Put your own styling
   in CSS classes; if an element needs its own transform, wrap it and style the
   wrapper.
2. **Keep `className` static on engine-driven elements**, including the
   `<ScrollCraft>` root. The engine adds `sc-ready`, `sc-lite`, `sc-in`,
   `sc-has-clip`, `sc-is-split`, `sc-stage` and others. When React re-sets
   `className` it drops them. If a class must change, change it and then call
   `rescan()` (put the value in `deps`).
3. **Kinetic text goes through `<Kinetic>`.** Never put `data-sc-kinetic` on an
   element whose children React renders: the engine replaces those children
   with spans, and React's next text update goes to a node that is no longer in
   the document.
4. **Structural changes need `deps`.** Adding or removing acts, cues or
   devices inside a mounted root is invisible to the engine until `rescan()`.
5. **One mount per root.** Do not nest `<ScrollCraft>` roots or mount the hook
   twice on the same element.

## Tests

`lab/react-app/test/strict.mjs` (lab, not committed) drives a StrictMode app
with two React Router routes in installed Chrome and asserts: mount twice and
destroy once on first render, one live instance, identical listener counts
after navigating away and back, a return to the pre-app baseline after
unmounting everything, one rescan per Kinetic text change, escaped Kinetic
text, and no React warnings in the console.
