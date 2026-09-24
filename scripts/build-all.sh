#!/usr/bin/env bash
# Builds every control in production mode.
set -euo pipefail
cd "$(dirname "$0")/.."
for c in Dashboard ReportReview ReportDetail PayrollRuns PayrollRunDetail HostList HostDetail HostDashboard MyReports MyReportDetail; do
  (cd "controls/$c" && npx pcf-scripts build --buildMode production > "/tmp/pcf-build-$c.log" 2>&1) || { cat "/tmp/pcf-build-$c.log"; exit 1; }
  grep -q "Succeeded" "/tmp/pcf-build-$c.log" || { cat "/tmp/pcf-build-$c.log"; exit 1; }
  echo "built $c ($(du -k controls/$c/out/controls/$c/bundle.js | cut -f1) KB)"
done
