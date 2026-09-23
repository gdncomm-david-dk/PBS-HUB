#!/usr/bin/env bash
# Builds the three controls in production mode.
set -euo pipefail
cd "$(dirname "$0")/.."
for c in Dashboard ReportReview ReportDetail; do
  (cd "controls/$c" && npx pcf-scripts build --buildMode production > "/tmp/pcf-build-$c.log" 2>&1) || { cat "/tmp/pcf-build-$c.log"; exit 1; }
  grep -q "Succeeded" "/tmp/pcf-build-$c.log" && echo "built $c ($(du -k controls/$c/out/controls/$c/bundle.js | cut -f1) KB)"
done
