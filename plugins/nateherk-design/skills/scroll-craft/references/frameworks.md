# Frameworks: Vite, Next.js, Astro and plain HTML

The engine is one file that reads `data-sc-*` attributes, so every framework
gets the same page markup. What changes per framework is only three things:
where the files go, how the stylesheet is loaded, and when `mount()` and
`destroy()` run. This page answers those three for each stack.

Pick the stylesheet by what the experience is:

| The scroll experience is | Stylesheet | Mount |
|---|---|---|
| The whole page | `engine/scrollcraft.css` | `ScrollCraft.mount(document.body)` (page scope) |
| A part of a page (a component, a section on a host site) | `engine/scrollcraft-section.css` | `ScrollCraft.mount('#story')` on an element with class `sc-scope` (section scope) |

The section stylesheet is generated from the page one (`scripts/scope-css.mjs`);
never edit it by hand. Link it after the host's own CSS.

Lifecycle rules that hold everywhere:

- Mount after the markup exists and before the reader scrolls. `mount()`
  measures, so it needs the elements in the document.
- Destroy when the markup goes away (a client-side route change, a component
  unmount). A full page load needs nothing: the engine dies with the document.
- After adding or removing acts inside a mounted root, call `api.rescan()`.
  After fonts, images or heights change without DOM changes, `api.refresh()`.

---

## 1. Plain HTML

Nothing to install. Copy `engine/scrollcraft.js` and the stylesheet beside the
page.

```html
<link rel="stylesheet" href="scrollcraft.css">
...
<script src="scrollcraft.js"></script>
<script>ScrollCraft.mount(document.body);</script>
```

One section on an existing site:

```html
<link rel="stylesheet" href="scrollcraft-section.css">
<section id="story" class="sc-scope">
  <section data-sc-act="pin" data-sc-span="2.4">
    <div data-sc-stage> ... </div>
  </section>
</section>
<script src="scrollcraft.js"></script>
<script>ScrollCraft.mount('#story');</script>
```

As a module (no global needed in your own code):

```html
<script type="module">
  import ScrollCraft from './scrollcraft.esm.js';
  ScrollCraft.mount('#story');
</script>
```

`scrollcraft.esm.js` imports `scrollcraft.js` beside it, so copy both.

Multi-page sites with cross-document View Transitions need no lifecycle code;
see `site.md`. A site that swaps content without a page load (Barba, htmx,
Turbo) calls `api.destroy()` before the swap and `ScrollCraft.mount()` after.

---

## 2. Vite

### Vanilla

Put the engine under `src/scrollcraft/engine/` and import it:

```js
// src/main.js
import './scrollcraft/engine/scrollcraft.css';
import ScrollCraft from './scrollcraft/engine/scrollcraft.esm.js';

ScrollCraft.mount(document.body);
```

Vite bundles the UMD file as CommonJS in a production build and as a plain
script in dev; the engine sets both `module.exports` and the global, so the
default export is the engine in both. Verify with `vite build` and
`vite preview` before shipping, not only `vite dev`.

### React (Vite, or any React SPA)

Use the adapter. Copy `engine/` and `adapters/react/` side by side, for
example `src/scrollcraft/engine/` and `src/scrollcraft/adapters/react/`, and
read `adapters/react/README.md` for the props and the constraints.

```jsx
// src/main.jsx
import './scrollcraft/engine/scrollcraft-section.css';
```

```jsx
// src/Story.jsx
import { ScrollCraft, Kinetic } from './scrollcraft/adapters/react/scrollcraft-react.js';

export function Story({ headline }) {
  return (
    <ScrollCraft id="story">
      <section data-sc-act="pin" data-sc-span="2.4">
        <div data-sc-stage>
          <Kinetic as="h1" cue="0 0.78 0" split="lines">{headline}</Kinetic>
        </div>
      </section>
    </ScrollCraft>
  );
}
```

React Router (or TanStack Router): nothing extra. Leaving the route unmounts
`<ScrollCraft>`, and its effect cleanup calls `destroy()`; coming back mounts
a fresh instance. StrictMode's double mount in development is handled the
same way. To make the first mount synchronous (styles on the first frame),
call `preloadScrollCraft()` in `main.jsx` before rendering.

Three rules from the adapter README that matter most:

1. No `style` prop with `opacity` or `transform` on an element the engine
   drives. Use classes.
2. Keep `className` static on engine-driven elements, including the root, or
   call `rescan()` after changing it.
3. Kinetic headings go through `<Kinetic>`, never `data-sc-kinetic` on an
   element whose children React renders.

---

## 3. Next.js (app router)

The engine touches `window` only inside `mount()`, and the adapter imports it
only inside an effect, so nothing runs on the server. The component that
renders `<ScrollCraft>` must still be a Client Component, because it uses
effects.

```tsx
// app/(home)/Story.tsx
'use client';

import { ScrollCraft, Kinetic } from '@/scrollcraft/adapters/react/scrollcraft-react.js';

export default function Story() {
  return (
    <ScrollCraft id="story">
      <section data-sc-act="pin" data-sc-span="2.4">
        <div data-sc-stage>
          <Kinetic as="h1" cue="0 0.78 0" split="lines">The promise, in under nine words.</Kinetic>
        </div>
      </section>
    </ScrollCraft>
  );
}
```

```tsx
// app/(home)/page.tsx  (a Server Component; it only renders the client one)
import Story from './Story';
export default function Page() { return <Story />; }
```

```tsx
// app/layout.tsx
import '@/scrollcraft/engine/scrollcraft-section.css';
```

- **CSS** is a global stylesheet import. The root layout is the safe place.
  Use `scrollcraft.css` instead only if the scroll experience is the whole page
  and the layout adds nothing else to the body.
- **The engine import** is the adapter's `import()` inside `useEffect`, so the
  engine lands in a client chunk and is never evaluated during server
  rendering. Do not import `scrollcraft.js` at the top of a Server Component.
- **TypeScript** picks up `scrollcraft-react.d.ts` beside the `.js` file; no
  `allowJs` is needed for the import.
- **Navigation.** A `<Link>` to another page unmounts the page's client
  components, so the cleanup destroys the engine. If `<ScrollCraft>` sits in a
  layout that persists across pages, it is not unmounted: pass the changing
  route segment in `deps` so the engine rescans the new content.
- **Hydration.** `<Kinetic>` renders the same escaped string on the server and
  the client, and the engine only splits it after hydration, inside the
  effect, so there is no hydration mismatch.

Pages router: the same component works; there is no `'use client'` line.

---

## 4. Astro

### Plain island (no framework)

The page is static HTML with a module script. Astro bundles and deduplicates
the script and runs it once per page load.

```astro
---
// src/pages/index.astro
import '../scrollcraft/engine/scrollcraft-section.css';
---
<section id="story" class="sc-scope">
  <section data-sc-act="pin" data-sc-span="2.4">
    <div data-sc-stage> ... </div>
  </section>
</section>

<script>
  import ScrollCraft from '../scrollcraft/engine/scrollcraft.esm.js';
  ScrollCraft.mount('#story');
</script>
```

With Astro's client router (`<ClientRouter />`, formerly `<ViewTransitions />`)
the script does not re-run on navigation. Mount on `astro:page-load` and
destroy before the swap:

```astro
<script>
  import ScrollCraft from '../scrollcraft/engine/scrollcraft.esm.js';
  let api = null;
  document.addEventListener('astro:page-load', () => {
    const root = document.querySelector('#story');
    if (root) api = ScrollCraft.mount(root);
  });
  document.addEventListener('astro:before-swap', () => {
    if (api) { api.destroy(); api = null; }
  });
</script>
```

### React island

```astro
---
import Story from '../components/Story.jsx';
import '../scrollcraft/engine/scrollcraft-section.css';
---
<Story client:only="react" />
```

Use `client:only="react"`, not `client:load`. There is nothing useful to
render on the server for a scroll experience whose every state is set by the
engine, and `client:only` skips server rendering of the component tree
entirely, so there is no server HTML to hydrate against. The component itself
is the same as in the Vite section above.

---

## 5. What to verify, whatever the stack

- Run `scripts/shoot.mjs` against the built site (`--section '#story'` for a
  section mount), not the dev server.
- In a client-routed app, navigate away and back twice and confirm
  `ScrollCraft.instances.length` is 1 in the console. A number that grows is a
  missing `destroy()`.
- In React, the adapter's lab test (`lab/react-app/test/strict.mjs`) is the
  reference for what "no leak" means: listener counts after navigating away and
  back equal those of a fresh mount.
