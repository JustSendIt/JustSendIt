#!/usr/bin/env bash
# Render WHITEPAPER.html to a print-ready PDF.
#
#   ./scripts/build-whitepaper.sh              → WHITEPAPER.pdf next to the HTML
#   ./scripts/build-whitepaper.sh ~/Desktop    → writes into that directory instead
#
# Uses headless Chrome, which is already on every machine that can run this site's
# browser tests. The @media print block at the bottom of WHITEPAPER.html is what makes
# the output paginate properly: it drops the sidebar, forces the light palette so the
# PDF is printable, and keeps tables and callouts from splitting across pages.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/WHITEPAPER.html"
OUT_DIR="${1:-$ROOT}"
OUT="$OUT_DIR/JustSendIt-Whitepaper.pdf"

[ -f "$SRC" ] || { echo "error: $SRC not found" >&2; exit 1; }

# First browser that exists wins. Chrome and Brave are both Chromium, so both work.
CHROME=""
for candidate in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  "$(command -v google-chrome || true)" \
  "$(command -v chromium || true)"
do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then CHROME="$candidate"; break; fi
done

if [ -z "$CHROME" ]; then
  echo "error: no Chromium-based browser found. Install Google Chrome or Brave." >&2
  exit 1
fi

echo "rendering with: $CHROME"

# --virtual-time-budget gives the Google Fonts request time to land before printing;
# without it the PDF can fall back to system fonts. 2>/dev/null hides the harmless
# CVDisplayLink noise macOS emits in headless mode.
"$CHROME" \
  --headless=new \
  --disable-gpu \
  --no-sandbox \
  --virtual-time-budget=12000 \
  --no-pdf-header-footer \
  --print-to-pdf="$OUT" \
  "file://$SRC" 2>/dev/null

if [ ! -s "$OUT" ]; then
  echo "error: no PDF was produced" >&2
  exit 1
fi

echo "wrote: $OUT"
command -v pdftotext >/dev/null 2>&1 && echo "pages: $(pdftotext "$OUT" - 2>/dev/null | grep -c $'\f')" || true
ls -lh "$OUT"
