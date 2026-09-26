#!/bin/bash
# Regenerate how-to-use PDF from the HTML source using headless Chrome.
# Usage: ./build.sh [output-pdf-path]
# Default output: ./how-to-use.new.pdf next to this script.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HTML_PATH="$SCRIPT_DIR/how-to-use.html"
OUT_PATH="${1:-$SCRIPT_DIR/how-to-use.new.pdf}"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [ ! -x "$CHROME" ]; then
  echo "Google Chrome not found at $CHROME" >&2
  exit 1
fi

"$CHROME" \
  --headless=new \
  --no-pdf-header-footer \
  --generate-pdf-document-outline \
  --disable-gpu \
  --print-to-pdf="$OUT_PATH" \
  "file://$HTML_PATH"

echo "Wrote $OUT_PATH"
