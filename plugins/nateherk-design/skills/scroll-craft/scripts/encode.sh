#!/usr/bin/env bash
# scrollcraft: encode a clip for scrubbing, not for playback.
#
# A normal web encode puts a keyframe every 2-5 seconds. Scrubbing seeks to an
# arbitrary time, and the decoder must walk from the previous keyframe to get
# there, so a sparse-GOP file feels like mud under the wheel while playing back
# perfectly. Dense keyframes cost file size and buy responsiveness. That trade
# is the entire point of this script.
#
#   ./encode.sh in.mp4 out.mp4            desktop master  (1080p, -g 8, crf 20)
#   ./encode.sh in.mp4 out-m.mp4 mobile   phone variant   (720p,  -g 4, crf 24)
#
# Tiers (DESIGN.md V4). `hero` is an alias of `desktop` and `hero-mobile` of
# `mobile`: same numbers, so nothing that already calls this script changes.
# `bed` and `bed-mobile` are the behind-copy background tier, for a clip that
# sits under a scrim and never carries the subject. Their numbers come from
# the measurement lab (encode-lab.mjs, seek-lab.mjs), not a guess, so both
# refuse to run with exit 2 until references/encode-tiers.md records Gustav's
# calibration. See the BED_* table below.
#
#   ./encode.sh in.mp4 out.mp4 hero             same numbers as desktop
#   ./encode.sh in.mp4 out.mp4 bed               behind-copy desktop tier
#   ./encode.sh in.mp4 out.mp4 bed-mobile        behind-copy mobile tier
#
# SCROLLCRAFT_GOP and SCROLLCRAFT_HEIGHT override the resolved tier's GOP and
# target height directly, same precedence as SCROLLCRAFT_CRF below: env wins
# over the tier default; there is no positional override for these two.
#
# CRF override, for the grain-heavy worlds assets.md warns about (marine snow,
# bioluminescence, smoke, film grain). A dense GOP doubles the cost of grain, so
# a world like that wants 22-23 rather than the default 20:
#
#   ./encode.sh in.mp4 out.mp4 desktop 23        fourth positional argument
#   SCROLLCRAFT_CRF=23 ./encode.sh in.mp4 out.mp4    or the env var
#
# The positional argument wins over the env var; with neither, the defaults
# below are unchanged.
#
# Audio is stripped: these clips are scrubbed, never played, and a muted track
# is dead weight plus an autoplay-policy hazard.
set -euo pipefail

# Resolve a FULL ffmpeg build. Several toolchains (Remotion, some Electron apps)
# put a stripped ffmpeg on PATH that carries maybe 50 filters and silently lacks
# scale/fps/tile. It fails with "No option name near ..." on any filter chain,
# which reads like a syntax error in your command rather than a missing filter.
# Count the filters and go looking for a real build if the count is low.
pick_ffmpeg() {
  local cand
  for cand in \
    "${SCROLLCRAFT_FFMPEG:-}" \
    "$(command -v ffmpeg 2>/dev/null || true)" \
    "${HOME:-/nonexistent}"/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_*/ffmpeg-*-full_build/bin/ffmpeg.exe \
    /usr/local/bin/ffmpeg /opt/homebrew/bin/ffmpeg /usr/bin/ffmpeg /snap/bin/ffmpeg
  do
    [ -n "$cand" ] && [ -x "$cand" ] || continue
    if [ "$("$cand" -hide_banner -filters 2>/dev/null | wc -l)" -gt 200 ]; then
      echo "$cand"; return 0
    fi
  done
  echo "ERROR: no full ffmpeg build found. Set SCROLLCRAFT_FFMPEG to one." >&2
  return 1
}
FFMPEG="$(pick_ffmpeg)"
FFPROBE="$(dirname "$FFMPEG")/ffprobe"
[ -x "$FFPROBE" ] || FFPROBE="$(command -v ffprobe)"

# bed tier table. Filled in by Packet E's measurement lab after Gustav's
# blind pick on the contact strips (references/encode-tiers.md). Height 0
# means "not calibrated"; encode.sh refuses to run the tier rather than guess.
BED_HEIGHT=0
BED_GOP=0
BED_CRF=0
BED_MOBILE_HEIGHT=0
BED_MOBILE_GOP=0
BED_MOBILE_CRF=0

IN="${1:?usage: encode.sh <in> <out> [desktop|mobile|hero|hero-mobile|bed|bed-mobile] [crf]}"
OUT="${2:?usage: encode.sh <in> <out> [desktop|mobile|hero|hero-mobile|bed|bed-mobile] [crf]}"
MODE="${3:-desktop}"

case "$MODE" in
  mobile|hero-mobile)
    SCALE_H=720; GOP=4; CRF=24 ;;
  bed-mobile)
    if [ "$BED_MOBILE_HEIGHT" -eq 0 ]; then
      echo "bed tier not yet calibrated, see references/encode-tiers.md" >&2
      exit 2
    fi
    SCALE_H="$BED_MOBILE_HEIGHT"; GOP="$BED_MOBILE_GOP"; CRF="$BED_MOBILE_CRF" ;;
  bed)
    if [ "$BED_HEIGHT" -eq 0 ]; then
      echo "bed tier not yet calibrated, see references/encode-tiers.md" >&2
      exit 2
    fi
    SCALE_H="$BED_HEIGHT"; GOP="$BED_GOP"; CRF="$BED_CRF" ;;
  *)
    # desktop, hero, and anything unrecognised: the original script's
    # behaviour was "mobile, or else desktop", preserved here so an unknown
    # third argument still produces today's file rather than erroring.
    SCALE_H=1080; GOP=8; CRF=20 ;;
esac

# Env overrides for GOP and height, same idea as the CRF override below.
GOP="${SCROLLCRAFT_GOP:-$GOP}"
case "$GOP" in
  ''|*[!0-9]*) echo "ERROR: SCROLLCRAFT_GOP must be an integer, got '$GOP'" >&2; exit 1 ;;
esac
SCALE_H="${SCROLLCRAFT_HEIGHT:-$SCALE_H}"
case "$SCALE_H" in
  ''|*[!0-9]*) echo "ERROR: SCROLLCRAFT_HEIGHT must be an integer, got '$SCALE_H'" >&2; exit 1 ;;
esac
SCALE="scale=-2:${SCALE_H}"

# Positional beats env var beats the mode default.
CRF="${4:-${SCROLLCRAFT_CRF:-$CRF}}"
case "$CRF" in
  ''|*[!0-9]*) echo "ERROR: crf must be an integer, got '$CRF'" >&2; exit 1 ;;
esac

mkdir -p "$(dirname "$OUT")"

"$FFMPEG" -y -hide_banner -loglevel error -i "$IN" \
  -an \
  -vf "${SCALE}:flags=lanczos,format=yuv420p" \
  -c:v libx264 -profile:v high -preset slow -crf "$CRF" \
  -g "$GOP" -keyint_min "$GOP" -sc_threshold 0 \
  -movflags +faststart \
  "$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
BYTES=$(wc -c < "$OUT" | tr -d ' ')
DUR=$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$OUT")
echo "$OUT  ${SIZE} (${BYTES} bytes)  ${DUR}s  gop=${GOP}  crf=${CRF}"
