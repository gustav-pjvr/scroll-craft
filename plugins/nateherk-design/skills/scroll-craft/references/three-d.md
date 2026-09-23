# The 3D route

A scroll act that turns a real glTF model with three.js, driven by the engine's
own act progress. It is an escalation, like a clip: the default hero is layered
stills (hero-depth.md), and BRIEF.md records why stills were not enough before
this route is used.

The module is `engine/scrollcraft-3d.js`, an ES module that sits beside the
engine. `scrollcraft.js` stays dependency-free. three.js is vendored into the
build by `scripts/vendor-three.mjs` and is never fetched from a CDN at runtime.

## 1. Choose the route

| The subject needs | Route | Why |
|---|---|---|
| Depth from planes, occlusion, a foreground overtaking the product | Layered stills (default) | Cheapest premium signal; no runtime cost beyond transforms |
| A flat or near-flat object (card, poster, phone screen) turning a few degrees | CSS 3D on a still or an alpha cutout | `perspective` plus `rotateY` driven from `--sc-p`; zero extra bytes |
| A physical object rotating past 30 degrees, reflections or shading that must change with angle, a lighting control the visitor can use | 3D module with a glTF | Only a renderer can show the back of the thing and re-light it |
| Real camera motion through a place, fluid, smoke, fabric, people | Video (justified in BRIEF.md) | Nothing else fakes it; pay the bytes |

A generic primitive is not a substitute for the real object
(approved-collection.md §3). If there is no accurate model of the product or
the brand mark, this route is not available; use stills.

## 2. Get a model

No model ships with the skill. A third-party model is not committed to the
repo, and a client's model is the client's.

- **The client's own CAD or product model.** Ask for glTF 2.0 (`.glb`). Most
  tools export it: Blender (File, Export, glTF 2.0), Cinema 4D and Maya via
  their glTF exporters, Onshape and Fusion via STEP then Blender.
- **Made for the job.** A 3D artist, or Blender from reference photos. Budget
  the time; accuracy is the point of this route.
- **Licensed stock** (Sketchfab, Poly Haven, Fab): check the licence permits
  commercial web use and record it in BRIEF.md with the source URL.
- **For testing only:** the Khronos samples at
  `github.com/KhronosGroup/glTF-Sample-Assets` (`Models/<Name>/glTF-Binary/`).
  Each folder has a `LICENSE.md`; many are CC-BY-4.0 and need attribution,
  some are CC0. The skill's own tests used DamagedHelmet (CC-BY-4.0, 3.7MB)
  and Duck in its `glTF-Draco` variant, downloaded into the lab, never
  committed.

### Prepare it

- One `.glb` per subject, centred and at real-world scale. The module
  centres and normalises the model to its bounding sphere, so any unit works.
- **Draco** geometry compression is supported by the vendored decoder
  (`gltf-transform draco in.glb out.glb`, or Blender's export option). The
  decoder (about 250KB) loads only when a model actually uses it.
- **Textures** dominate the size. Resize to what the canvas can show (2048
  is the ceiling for a hero, 1024 is usually enough), and prefer WebP or
  JPEG inside the glb (`gltf-transform webp`, `gltf-transform resize`).
  KTX2 and meshopt need decoders this vendor set does not include; add them
  only when a real build needs them.
- The model's own PBR material. Light and environment come from the module
  (or your `.hdr`), not baked into the textures.

Check the numbers the budget is judged on:

```
node scripts/vendor-three.mjs --model assets/model.glb
```

It prints file size, texture bytes and formats, and which compression
extensions are used. The size budget is set once Gustav has seen the first
real build's numbers next to the encode tiers (encode-tiers.md); until then,
record the printed numbers in BRIEF.md.

## 3. Vendor three.js

```
node scripts/vendor-three.mjs --out <build>/vendor/three
node scripts/vendor-three.mjs --out <build>/vendor/three --check
```

The script pins one version (the `VERSION` constant) and a SHA-384 for every
file, downloads from jsDelivr's npm mirror, verifies every file before writing
any, and rewrites the addons' bare `'three'` import to a relative path so the
graph resolves with no import map. `--check` re-hashes the installed files and
exits non-zero on any mismatch or missing file; run it before every deploy.

The pinned build is the unminified `three.module.js` plus `three.core.js`,
because the npm package no longer ships a `.min.js` and jsDelivr's generated
one must not be hash-pinned. JS fetched when a glTF act warms: about 450KB
gzip (roughly 340KB brotli). Nothing is fetched before that.

## 4. Markup

Files in the build: `scrollcraft.css`, `scrollcraft.js`, `scrollcraft-3d.js`,
`vendor/three/`, `assets/model.glb`, `assets/poster.webp`,
`assets/poster-m.webp`. `references/example-3d.html` is the worked example.

```html
<section id="object" data-sc-act="pin" data-sc-span="3">
  <div data-sc-stage>
    <picture>
      <source media="(max-width: 860px)" srcset="assets/poster-m.webp">
      <img class="sc-stage__poster" src="assets/poster.webp" alt="What the object is">
    </picture>
    <canvas data-sc-3d="assets/model.glb" data-sc-3d-spin="-20 300"
            data-sc-3d-light="-30 150" aria-hidden="true"></canvas>
    <div class="sc-copy sc-copy--lead" data-sc-cue="0.08 0.46"> ... </div>
  </div>
</section>

<script src="scrollcraft.js"></script>
<script>ScrollCraft.mount(document.body);</script>
<script type="module">
  import ScrollCraft3D from './scrollcraft-3d.js';
  ScrollCraft3D.mount(document.body);
</script>
```

The canvas needs the same box as a clip. Until the engine stylesheet carries
it, add this to the page:

```css
.sc-stage canvas[data-sc-3d] { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
```

The canvas is transparent, so the stage ground and scrims show through, and
the poster underneath shows until the first frame. The `alt` goes on the
poster; the canvas is `aria-hidden`. Mount the engine first; the module finds
the engine instance that owns each act.

### Attributes (on the canvas)

| Attribute | Values | Default | Effect |
|---|---|---|---|
| `data-sc-3d` | path to `.glb`/`.gltf` | required | The model |
| `data-sc-3d-spin` | `"a b"` degrees | `0 180` | Yaw across p 0 to 1 |
| `data-sc-3d-tilt` | `"a b"` degrees | `0 0` | Pitch across p |
| `data-sc-3d-light` | `"a b"` degrees | `0 0` | Key-light azimuth across p; 0 is a three-quarter key 40 degrees to camera right |
| `data-sc-3d-pointer` | 0 to 1 | `0` | Pointer influence on yaw and pitch, fraction of the spin range; fine pointer only |
| `data-sc-3d-dpr` | number | `1.5` | Pixel-ratio cap, clamped 1 to 2 |
| `data-sc-3d-env` | path to `.hdr` | built-in softbox | Environment for reflections |
| `data-sc-3d-poster-p` | 0 to 1 | `0` | Progress the poster is captured at |
| `data-sc-media` | `lite` or `full` | page mode | Overrides the page's media mode for this scene |

Progress is the stage's visible-life progress, the same value a scrub clip
uses, so the object is already turning as the stage slides in. Put
`data-sc-clip-map="travel"` on the act to map it to the pinned travel instead.

Keep the material response in the light, not only the object: moving the key
from `-30` to `150` while the object turns is what makes a surface read as
metal, leather or glass.

### Bespoke motion

The signature move belongs in page code, not in the module:

```js
ScrollCraft3D.mount(document.body, {
  scene({ THREE, scene, camera, renderer, model, pivot, key, act, canvas }) {
    // once, after the default scene is built: add a ground shadow, swap a material
  },
  frame(ctx, p, pointer) {
    // before every render, after the attribute choreography
    ctx.model.position.y = Math.sin(p * Math.PI) * 0.08;
  },
});
```

## 5. How it behaves

- **Lazy.** Nothing of three.js loads until the act is warm (the engine's
  `sc:warm` and `act.warm`, or the same 3-viewports-ahead window computed from
  the act's rect on an older engine). Then the module graph and the model are
  fetched once each.
- **Poster crossfade.** After the first frame renders, the module adds
  `sc-has-clip` to the act and the canvas; the engine stylesheet fades the
  poster out, exactly as for a clip.
- **Render on change.** No animation loop. A frame renders only while the act
  is live, and only when progress moved past 0.001, the pointer moved, or the
  canvas resized. Idle and far away, the render count does not move.
- **One live scene.** With several 3D acts, only the most visible live one
  renders; the others hold their last frame. Contexts are kept between visits.
- **Pointer.** `(hover: hover) and (pointer: fine)`, not under reduced motion.
  Reads `--sc-mx`/`--sc-my` from a `[data-sc-spotlight]` ancestor when there
  is one, otherwise its own `pointermove` on the act. Never pointer lock or
  capture.
- **Held states.** No WebGL, reduced motion, or lite (Save-Data or a slow
  connection, `sc-lite`): three.js is never imported and the poster holds for
  the life of the page. A lite hold lifts if the connection recovers before
  the act is reached.
- **Lifecycle.** `handle.destroy()` disposes geometry, materials, textures and
  the renderer, forces context loss, removes every listener and puts the
  poster back. A later `mount()` on the same canvas restores the context, so
  React StrictMode's mount, destroy, mount works.

## 6. Posters

The poster is what reduced-motion, lite and no-WebGL visitors see for the
whole page, so it is a capture of the real scene, never a stand-in. With the
page served:

```
node scripts/poster-3d.mjs --url http://localhost:4500 --act "#object" --out assets/
```

It writes `poster.webp` (1440 by 900 viewport, `--dpr 1`) and `poster-m.webp`
(390 by 844, `--dpr-m 2`) through `ScrollCraft3D.capture()`, a throwaway
renderer with `preserveDrawingBuffer: true`. The live canvas never uses that
flag. Capture at the progress the reader sees on arrival (`--p`, default the
canvas's `data-sc-3d-poster-p`) or the crossfade jumps. Re-run it whenever the
model, the choreography or the lighting changes.

## 7. Verify

Serve the build (file:// blocks the model fetch), then check, in installed
Chrome:

1. `vendor-three.mjs --check` passes.
2. Before scrolling, the network panel shows no `vendor/three` and no model
   request. Scrolled to within three screens of the act, each file loads once.
3. Mid-act, the poster is at opacity 0 and the object turns with scroll; at
   rest, nothing renders (DevTools Performance shows no frames).
4. **WebGL off**: launch Chrome with `--disable-webgl`, or in a test stub
   `HTMLCanvasElement.prototype.getContext` to return `null` for `webgl` and
   `webgl2`. Turning off graphics acceleration is not enough: Chrome can
   still hand out a software context. The poster holds, the copy reads,
   nothing errors.
5. Reduced motion (DevTools Rendering, emulate `prefers-reduced-motion`) and
   Save-Data: the same.
6. The phone composition from `poster-m.webp` and the live canvas on a real
   phone: the object is whole and the copy is readable.

Headless Chrome needs `--enable-unsafe-swiftshader` for software WebGL;
`poster-3d.mjs` passes it.
