#!/usr/bin/env bash
# Builds the managed solution with the official Power Platform MSBuild targets and copies it to dist/.
# Needs: .NET SDK (8+) — the cdsproj pulls Microsoft.PowerApps.MSBuild.Solution/Pcf from NuGet.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(grep -oP '(?<=<Version>)[^<]+' solution/PBSHubOpsPCF/src/Other/Solution.xml)
(cd solution/PBSHubOpsPCF && dotnet build -c Release -nologo -v:minimal)
mkdir -p dist
OUT="dist/PBSHubOpsPCF_${VERSION//./_}_managed.zip"
cp solution/PBSHubOpsPCF/bin/Release/PBSHubOpsPCF.zip "$OUT"
echo "managed solution: $OUT"
