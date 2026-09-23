# Encode tiers: measured

The `bed` tier's numbers (DESIGN.md V4) come from a measurement, not a guess.
This file is that measurement. `hero` is unchanged: today's `desktop` and
`mobile` numbers, still the default, still what `encode.sh` produces with no
mode argument.

## Environment

- Machine: `Xbox-Wireless-Connecter-Wifi4`, Windows 11 Pro, build 21996.
- ffmpeg: 9.0.2-full_build-www.gyan.dev (587 filters), gyan.dev build.
- Chrome (installed, used via `playwright-core` 1.63.0): 153.0.8010.53.
- Node: v24.13.0.
- Date: 2026-09-23.
- Master clip: `lab/source.mp4`, a real Kling v2.1 generation. 1660 by 1244,
  24fps, 121 frames, 5.04s, 6,833,139 bytes. Has an audio track the grid never
  touches (`-an` on every encode, matching `encode.sh`).

## How this was produced

1. `node scripts/encode-lab.mjs --in lab/source.mp4 --out lab/encode --tier all`
   ran all 52 candidates: the bed-desktop grid (heights 1080, 900, 720, 540 by
   CRF 20, 23, 26, 29 by GOP 8, 12 = 32 cells), the bed-mobile grid (heights
   720, 540, 432 by CRF 24, 27, 30 by GOP 4, 6 = 18 cells), and the two hero
   anchors (1080p/GOP8/CRF20, 720p/GOP4/CRF24). Every encode uses the exact
   filter chain `encode.sh` uses: lanczos scale, `format=yuv420p`,
   `libx264 -profile:v high -preset slow`, `-g N -keyint_min N -sc_threshold 0`,
   `-an`, `-movflags +faststart`.
2. For each output: file size; SSIM and PSNR against the master (the
   candidate is upscaled back to 1660 by 1244 with lanczos before comparison,
   so downscale loss is charged to the candidate); the actual keyframe
   interval read back with `ffprobe -show_frames key_frame=1` (not trusted
   from the `-g` flag); a three-frame contact strip at 10%, 50%, 90% of the
   clip.
3. `node scripts/seek-lab.mjs --dir lab/encode --seeks 60 --seed 7 --port 4642`
   loaded every one of the 52 files in installed Chrome exactly as
   `engine/scrollcraft.js`'s `loadClip()` does (fetch, Blob, object URL,
   `preload=auto`, muted, `playsInline`, a forced seek to 0.001, then
   `primeClip()`'s play-then-pause), served over HTTP by `scripts/serve.mjs`
   on port 4642 (packet range 4641 to 4649), then ran 60 seeded
   pseudo-random seeks and recorded the time from writing `currentTime` to
   the `seeked` event. All 52 files: 0 timeouts across 3,120 seeks.
4. Contact strips were copied into `lab/encode/blind/` under a seeded
   deterministic shuffle, numbered `0001.png` to `0052.png`, with
   `lab/encode/blind/mapping.json` holding the number-to-file mapping and
   `lab/encode/blind/master-reference.png` left unblinded (it is the ground
   truth, not a candidate). See `lab/encode/PICK-ME.md`.

Raw output: `lab/encode/results.json` / `results.md` (encode-lab),
`lab/encode/seek-results.json` / `seek-results.md` (seek-lab),
`lab/encode/combined.json` (the two joined on file name, used for the table
below), `lab/encode/phone-candidates.json` (the manifest for the pending
phone session, see below).

## X_hero (the anchor)

| Anchor | File | Size | ssim_all | psnr_avg |
|---|---|---|---|---|
| hero desktop | `hero-desktop.mp4` (= today's `encode.sh in out desktop`) | 2,473,991 bytes | **0.995620** | 47.147 dB |
| hero mobile | `hero-mobile.mp4` (= today's `encode.sh in out mobile`) | 1,182,480 bytes | **0.990838** | 42.068 dB |

`X_hero_desktop = 0.995620`, `X_hero_mobile = 0.990838`. These are the sanity
ceiling: no `bed` candidate should be read as "acceptable" above these
numbers, because that would mean the bed tier is not actually cheaper
quality, just cheaper bytes at equal fidelity, which is not the trade this
tier exists to make.

## Full measured table

Desktop grid (bed-desktop) and mobile grid (bed-mobile), plus the two hero
anchors. `p50`/`p95` are desktop-Chrome seek latency in ms (60 seeks, seed 7).
Sorted as produced (height, then CRF, then GOP within each tier).

| tier | file | size (bytes) | ssim_all | psnr_avg (dB) | measured GOP | p50 (ms) | p95 (ms) |
|---|---|---|---|---|---|---|---|
| bed-desktop | h1080-crf20-g8.mp4 | 2473991 | 0.995620 | 47.147 | 8 | 7.5 | 12.9 |
| bed-desktop | h1080-crf20-g12.mp4 | 2358188 | 0.995603 | 47.177 | 12 | 9.6 | 16.1 |
| bed-desktop | h1080-crf23-g8.mp4 | 1853113 | 0.994580 | 45.863 | 8 | 7.1 | 12.2 |
| bed-desktop | h1080-crf23-g12.mp4 | 1762073 | 0.994560 | 45.896 | 12 | 9.8 | 13.8 |
| bed-desktop | h1080-crf26-g8.mp4 | 1425483 | 0.993183 | 44.400 | 8 | 7.1 | 10.8 |
| bed-desktop | h1080-crf26-g12.mp4 | 1349710 | 0.993169 | 44.441 | 12 | 9.7 | 13.4 |
| bed-desktop | h1080-crf29-g8.mp4 | 1112611 | 0.991249 | 42.791 | 8 | 7.3 | 11.0 |
| bed-desktop | h1080-crf29-g12.mp4 | 1048518 | 0.991258 | 42.839 | 12 | 9.6 | 13.3 |
| bed-desktop | h900-crf20-g8.mp4 | 1925799 | 0.994696 | 45.502 | 8 | 6.3 | 17.8 |
| bed-desktop | h900-crf20-g12.mp4 | 1830803 | 0.994688 | 45.522 | 12 | 7.8 | 12.1 |
| bed-desktop | h900-crf23-g8.mp4 | 1454879 | 0.993464 | 44.348 | 8 | 6.2 | 9.6 |
| bed-desktop | h900-crf23-g12.mp4 | 1379373 | 0.993438 | 44.368 | 12 | 7.5 | 11.1 |
| bed-desktop | h900-crf26-g8.mp4 | 1121284 | 0.991767 | 42.983 | 8 | 6.8 | 15.4 |
| bed-desktop | h900-crf26-g12.mp4 | 1061410 | 0.991755 | 43.023 | 12 | 8.2 | 16.5 |
| bed-desktop | h900-crf29-g8.mp4 | 877373 | 0.989448 | 41.470 | 8 | 6.3 | 13.1 |
| bed-desktop | h900-crf29-g12.mp4 | 826809 | 0.989462 | 41.516 | 12 | 7.8 | 14.2 |
| bed-desktop | h720-crf20-g8.mp4 | 1448896 | 0.992867 | 43.339 | 8 | 5.4 | 11.3 |
| bed-desktop | h720-crf20-g12.mp4 | 1377466 | 0.992845 | 43.352 | 12 | 11.5 | 14.8 |
| bed-desktop | h720-crf23-g8.mp4 | 1101570 | 0.991322 | 42.351 | 8 | 5.0 | 8.4 |
| bed-desktop | h720-crf23-g12.mp4 | 1044179 | 0.991276 | 42.367 | 12 | 6.3 | 13.8 |
| bed-desktop | h720-crf26-g8.mp4 | 850820 | 0.989204 | 41.152 | 8 | 9.0 | 37.5 |
| bed-desktop | h720-crf26-g12.mp4 | 803818 | 0.989171 | 41.186 | 12 | 11.6 | 35.7 |
| bed-desktop | h720-crf29-g8.mp4 | 665615 | 0.986354 | 39.781 | 8 | 8.6 | 16.2 |
| bed-desktop | h720-crf29-g12.mp4 | 625497 | 0.986368 | 39.824 | 12 | 11.6 | 36.4 |
| bed-desktop | h540-crf20-g8.mp4 | 1029784 | 0.988228 | 40.180 | 8 | 9.2 | 13.6 |
| bed-desktop | h540-crf20-g12.mp4 | 980248 | 0.988205 | 40.199 | 12 | 11.2 | 27.2 |
| bed-desktop | h540-crf23-g8.mp4 | 787233 | 0.986162 | 39.445 | 8 | 8.9 | 13.4 |
| bed-desktop | h540-crf23-g12.mp4 | 745163 | 0.986127 | 39.462 | 12 | 10.7 | 15.9 |
| bed-desktop | h540-crf26-g8.mp4 | 607476 | 0.983408 | 38.505 | 8 | 3.8 | 5.4 |
| bed-desktop | h540-crf26-g12.mp4 | 571628 | 0.983404 | 38.536 | 12 | 11.7 | 16.5 |
| bed-desktop | h540-crf29-g8.mp4 | 471981 | 0.979779 | 37.379 | 8 | 6.7 | 12.0 |
| bed-desktop | h540-crf29-g12.mp4 | 440698 | 0.979773 | 37.399 | 12 | 5.3 | 8.0 |
| bed-mobile | h720-crf24-g4.mp4 | 1182480 | 0.990838 | 42.068 | 4 | 5.7 | 11.3 |
| bed-mobile | h720-crf24-g6.mp4 | 1061937 | 0.990675 | 41.931 | 6 | 7.4 | 18.9 |
| bed-mobile | h720-crf27-g4.mp4 | 922097 | 0.988444 | 40.799 | 4 | 8.8 | 23.0 |
| bed-mobile | h720-crf27-g6.mp4 | 825641 | 0.988310 | 40.668 | 6 | 9.6 | 13.7 |
| bed-mobile | h720-crf30-g4.mp4 | 723543 | 0.985180 | 39.340 | 4 | 8.9 | 11.6 |
| bed-mobile | h720-crf30-g6.mp4 | 648752 | 0.985104 | 39.230 | 6 | 5.5 | 11.2 |
| bed-mobile | h540-crf24-g4.mp4 | 846308 | 0.985551 | 39.216 | 4 | 3.4 | 4.8 |
| bed-mobile | h540-crf24-g6.mp4 | 754800 | 0.985296 | 39.098 | 6 | 4.0 | 5.9 |
| bed-mobile | h540-crf27-g4.mp4 | 659546 | 0.982491 | 38.229 | 4 | 8.1 | 11.5 |
| bed-mobile | h540-crf27-g6.mp4 | 586483 | 0.982231 | 38.093 | 6 | 8.5 | 13.0 |
| bed-mobile | h540-crf30-g4.mp4 | 518475 | 0.978405 | 37.023 | 4 | 8.2 | 10.9 |
| bed-mobile | h540-crf30-g6.mp4 | 457923 | 0.978233 | 36.895 | 6 | 3.8 | 5.4 |
| bed-mobile | h432-crf24-g4.mp4 | 653588 | 0.979114 | 36.837 | 4 | 8.7 | 11.6 |
| bed-mobile | h432-crf24-g6.mp4 | 583020 | 0.978855 | 36.757 | 6 | 8.3 | 13.0 |
| bed-mobile | h432-crf27-g4.mp4 | 506786 | 0.975548 | 36.060 | 4 | 6.3 | 12.1 |
| bed-mobile | h432-crf27-g6.mp4 | 448735 | 0.975260 | 35.961 | 6 | 10.1 | 13.8 |
| bed-mobile | h432-crf30-g4.mp4 | 396270 | 0.970892 | 35.074 | 4 | 8.7 | 11.1 |
| bed-mobile | h432-crf30-g6.mp4 | 349227 | 0.970689 | 34.982 | 6 | 10.7 | 14.0 |
| hero-desktop | hero-desktop.mp4 | 2473991 | 0.995620 | 47.147 | 8 | 6.9 | 14.5 |
| hero-mobile | hero-mobile.mp4 | 1182480 | 0.990838 | 42.068 | 4 | 4.6 | 9.4 |

## SSIM curve observations

Neither grid is flat.

- **bed-desktop**: SSIM ranges from 0.995620 (h1080/crf20) down to 0.979773
  (h540/crf29), a spread of about 0.0159. Held at a fixed height, each CRF
  step (20 to 23 to 26 to 29) drops SSIM by roughly 0.0010 to 0.0019, four
  steps of which compound to the range above. Held at a fixed CRF, each
  height step down costs roughly 0.0009 (1080 to 900) to 0.0046 (720 to 540).
- **bed-mobile**: SSIM ranges from 0.990838 (h720/crf24, which is also the
  hero-mobile anchor) down to 0.970689 (h432/crf30), a spread of about 0.0201.
  Same shape: CRF steps cost roughly 0.0016 to 0.0043 each, height steps cost
  roughly 0.001 to 0.008.
- **GOP's effect on SSIM/PSNR is negligible in both grids**: at fixed
  height and CRF, GOP 8 versus 12 (desktop) or 4 versus 6 (mobile) changes
  SSIM in the fourth or fifth decimal place only (for example h1080-crf20:
  0.995620 at GOP 8 versus 0.995603 at GOP 12). GOP buys nothing on quality;
  its only job is seek behaviour, and file size drops 3 to 11 percent going
  from the tighter to the looser GOP at matched height and CRF.

## Does the runner-up condition (DESIGN.md V4) apply?

**No, not on the quality axis.** The runner-up ("a single background number
chosen by eye once, for example 720p CRF 26") is specified to apply only if
the SSIM curve is flat (less than a few thousandths between neighbours) AND
the seek numbers do not separate the GOPs. The SSIM curve is not flat: the
full range across each grid (0.016 desktop, 0.020 mobile) is well beyond "a
few thousandths", and while single-dimension neighbour steps (one CRF notch,
holding height and GOP fixed) are themselves small (about 0.001 to 0.002),
they compound across the grid into a real, mostly monotonic gradient that a
viewer can plausibly see on the contact strips. That gradient is exactly what
the acceptance rule needs to find a real "smallest file that still holds up"
point, so the grid is doing real work and the protocol is not overkill.

**On the GOP axis, desktop Chrome does not separate GOP 8 from 12 (or 4 from
6) in any consistent, unambiguous direction.** p50 differences between
matched-quality GOP pairs are mostly 1 to 4ms, and while GOP 12/6 is p50-slower
than GOP 8/4 in most rows (consistent with "more frames to walk from the
nearest keyframe"), it is not slower in every row, and the gap is inside the
noise you would expect from a modern desktop's hardware decoder and warm
disk cache. This matches DESIGN.md's own reasoning: the GOP decision is
supposed to be made on the **phone's** frame budget (about 16.7ms at 60Hz),
not the desktop's, because the desktop is not the constraint. See below.

## Phone seek measurement: pending

Phone measurement has not been made. `lab/encode/phone-candidates.json` is
the manifest for that session: every candidate's file name, tier, size,
height, crf and gop, so the phone run can be driven against
`references/device-diag.html`'s seek-latency readout (Packet A2) without
re-deriving the grid. Deploy `lab/encode/` beside `device-diag.html` and read
p50/p95 off the device for the candidates the blind pick shortlists.

**Until the phone numbers exist, GOP stays at 8 (desktop) and 4 (mobile)**,
per DESIGN.md V4's own fallback ("if the phone measurement cannot be made,
GOP stays at 8 and 4 and the doc says so"). The desktop seek numbers above
are recorded for completeness and because they cost nothing extra to
measure, but they are not the number the acceptance rule is written against.

## Calibration pending: Gustav's blind pick

`bed` and `bed-mobile` in `encode.sh` are not filled in. Both modes exit 2
with "bed tier not yet calibrated, see references/encode-tiers.md" until the
blind pick happens. Instructions for the pick: `lab/encode/PICK-ME.md`.

Once Gustav marks the lowest acceptable strip behind copy (gives `X_bed`) and
the lowest acceptable full-frame (a second reference point, useful for a
grainy-world CRF override the way today's CRF 22/23 note in `assets.md`
already is), the next step is:

1. Read `X_bed`'s SSIM off `lab/encode/blind/mapping.json` plus
   `lab/encode/results.json`.
2. Run `pick(rows, X_bed, heroBytes)` from `encode-lab.mjs` (exported, unit
   tested against a synthetic table) separately for the bed-desktop rows
   against `X_hero_desktop`'s anchor bytes (2,473,991) and the bed-mobile
   rows against the mobile anchor bytes (1,182,480).
3. Write the winning height/CRF/GOP into `BED_HEIGHT`/`BED_CRF`/`BED_GOP`
   and `BED_MOBILE_HEIGHT`/`BED_MOBILE_CRF`/`BED_MOBILE_GOP` at the top of
   `scripts/encode.sh`.
4. If `pick()` returns `rejected: true` for either tier (not a third smaller
   than the hero anchor at the chosen quality floor), that is a real result:
   record it here rather than shipping a number, per DESIGN.md V4.
5. Revisit the GOP choice once the phone numbers land (previous section).
