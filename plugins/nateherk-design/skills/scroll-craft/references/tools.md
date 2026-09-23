# Tools: use what the session actually has

The first real build this skill produced cut its hero into planes with
hand-written mask scripts, exported the hero photograph smaller than the
screen showed it, and never noticed that the same session had background
removal, subject selection, generative expand, an upscaler, image and video
generation, font search, web scraping and a real browser it could drive. The
builder's BRIEF.md says "no alpha cutout tool installed". Several were
connected; nobody looked.

So the inventory is a step, not an instinct. Do it in Bootstrap, before any
asset is planned, and write it down.

---

## 1. Take the inventory

1. **Read your own tool list.** Every tool and connector the session exposes,
   not only the ones you have used before. Some harnesses list tools by name
   only and load their schemas on demand through a search tool: a name in
   that list is a tool you have. Load it before calling it.
2. **Group by capability, not brand.** The same job is often offered by two or
   three connectors. The table in §2 is the checklist of jobs.
3. **Map each job the build needs to a tool.** The jobs come from Step 0
   question 8 (what they already have), the hero plan (hero-depth.md) and the
   score. Note for each: whether it costs credits or money, and whether it
   would send the client's material to a third party.
4. **Write it into BRIEF.md** as a Tools block, before generating or editing
   anything:

```
## Tools (inventory, <date>)
| Job                  | Tool in this session                  | Cost            | Client files leave the machine | Approved |
|----------------------|---------------------------------------|-----------------|--------------------------------|----------|
| Background removal   | Adobe image_remove_background         | not stated      | yes: hero photo                | yes, <date> |
| Upscale hero plate   | Higgsfield upscale_image              | <credits>       | yes: hero photo                | asked    |
| Brand research       | Firecrawl firecrawl_scrape            | not stated      | no (public site)               | n/a      |
| Real-browser checks  | Claude in Chrome                      | none            | no                             | n/a      |
| Image generation     | none needed (client photos only)      |                 |                                |          |
```

A job with no tool gets a row too, with the workaround you will use instead.
That row is what the report's "could not do" line comes from.

The list varies by session and by user. The examples below were seen in real
sessions; yours may have none of them, or others that do the same jobs. Check
what you really have. Never assume a tool from this page exists, and never
skip one because this page does not name it.

---

## 2. Jobs and the tools that do them

| Job | What to look for | Seen in real sessions |
|---|---|---|
| Image generation | text-to-image, image-to-image with a reference | Higgsfield `generate_image`; Canva `generate-image`; kie.ai through `scripts/kie.mjs` (assets.md) |
| Background removal and cutouts | remove background, select subject, select by prompt, separate layers | Adobe for creativity `image_remove_background`, `image_select_subject`, `image_select_by_prompt`; Canva `remove-background`, `separate-image-layers`; Higgsfield `remove_background` |
| Clean plates and extension | generative fill, generative expand, outpaint | Adobe `image_fill_area`, `image_generative_expand`; Higgsfield `outpaint_image` |
| Upscale | image upscale (and video upscale) | Higgsfield `upscale_image`, `upscale_video` |
| Depth cues on a plate | lens blur, depth of field | Adobe `image_apply_lens_blur` |
| Video generation | image-to-video, camera moves | Higgsfield `generate_video`; kie.ai `kie.mjs shot` |
| 3D generation | image-to-mesh (GLB) | Higgsfield `generate_3d` |
| Font discovery and pairing | font search, recommendation, type palettes | Adobe `find_fonts`, `font_recommend`, `suggest_type_palettes` |
| Brand and web research | scrape a URL, search the web | Firecrawl `firecrawl_scrape`, `firecrawl_search`; a web fetch or web search tool |
| Design tools | layouts, brand kits, asset production | Canva, Adobe Express, Figma connectors |
| Real-browser verification | drive, resize, screenshot and record a real browser | Claude in Chrome (`navigate`, `computer`, `resize_window`, `gif_creator`, `read_console_messages`); a DevTools-protocol server for performance traces and CPU throttling |

Notes that decide whether a tool actually helps:

- **Follow each server's own instructions.** Some require an initialisation
  call before any other tool on that server (Adobe for creativity did), some
  want a media upload step before an edit. The server's instructions outrank
  this table.
- **3D generation does not lift the accuracy rule.** A generated mesh is a
  route only when it is accurate to the real object (three-d.md §1,
  approved-collection.md §3). A plausible lookalike of the client's product is
  a generic primitive with more polygons.
- **Fonts must be licensed for the web.** A face found through a design tool
  may only be usable inside that tool. Confirm a web licence or a web kit, or
  fall back to a face served under an open licence.
- **Design tools draw; the page is still real HTML.** Use them for asset
  production and layout exploration. A layout exported as an image is text
  baked into an image, which SKILL.md's hard rules ban.
- **Browser tools add to the harness, they do not replace it.** `shoot.mjs`
  is still the mechanical pass. A real browser adds a real GPU, the user's
  real profile, and recordings for the screen-record test (feel.md §2). Do not
  point two browser controllers at the same tab.

---

## 3. The rules

**Prefer a real tool over a workaround.** A real cutout beats a mask. A
generative fill beats a clean plate faked by cropping. Scraping the client's
real site beats guessing their colours. A real browser beats reasoning about
what one would show. Reach for the workaround only when the inventory says no
tool does the job, and say so in the report.

**Anything that spends credits or money needs the user's explicit yes, with
the cost stated first.** State what you will run, how many calls, and what it
costs: from the tool's own balance or pricing call when it has one
(Higgsfield exposed a balance tool; kie.ai has `kie.mjs probe` and the unit
costs in assets.md), otherwise say plainly that the tool does not state a
cost. Then ask, and record the question, the answer and the date in BRIEF.md.

- **Creative delegation is not consent to spend.** "Use your judgment" or
  "builder decides" hands over taste, not the user's account. Ask for the
  spend separately, in one batched question that lists every paid call the
  plan needs, so the user answers once.
- **An unreachable user means no spend.** Build on the free routes, and list
  in the report what each paid tool would have improved and what it would
  have cost.
- **A yes covers what was asked, not what comes after.** A reroll wave beyond
  the approved count is a new question.

**Never upload a client's private material to a third-party service without
the user's yes.** Treat every supplied file (photographs, footage, brand kits,
documents) as private unless the user says otherwise or it is already
published on the client's own public site. The question names the service the
file would go to. This holds under creative delegation too.

**Look at every output.** A tool's result is an asset like any other: read the
file, check alpha edges over light and dark grounds, check that an upscale did
not invent detail on a face or a logo, check that a generative fill did not
add a second subject. The inspection rules in assets.md and hero-depth.md
apply unchanged.

**Record which tools were used.** BRIEF.md's Tools block is updated as the
build goes, and the final report lists, per job, the tool used (or the
workaround and why), the spend approved and the spend made. Keep originals
and tool outputs in `<workspace>/lab/<name>/`, not in the build folder.

---

## 4. kie.ai is one option, not the default

`scripts/kie.mjs` stays documented in [assets.md](assets.md) because it is
scripted end to end: known models, known aspect ratios, published unit costs,
a balance probe. That makes it a dependable generation route, not the first
one. The order of preference for any image in the page is the client's real
material, prepared with the session's own editing tools where it needs it,
then generation through whichever route (a session tool or kie.ai) the
inventory and the user's yes allow.
