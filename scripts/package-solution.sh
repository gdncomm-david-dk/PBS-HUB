#!/usr/bin/env bash
# Builds the managed solutions with the official Power Platform MSBuild targets and copies them to dist/.
#   PBSHubOpsPCF  — Ops Console controls (pbs_Ops.*)
#   PBSHubHostApp — all six Host app controls (pbs_HostApp.*), a separate solution so each app ships on its own
# Needs: .NET SDK (8+) — the cdsproj pulls Microsoft.PowerApps.MSBuild.Solution/Pcf from NuGet.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
for SOL in ${SOLUTIONS:-PBSHubOpsPCF PBSHubHostApp}; do
  VERSION=$(grep -oP '(?<=<Version>)[^<]+' "solution/$SOL/src/Other/Solution.xml")
  (cd "solution/$SOL" && dotnet build -c Release -nologo -v:minimal)
  OUT="dist/${SOL}_${VERSION//./_}_managed.zip"
  cp "solution/$SOL/bin/Release/$SOL.zip" "$OUT"
  echo "managed solution: $OUT"
done
