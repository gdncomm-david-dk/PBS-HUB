# PBS Hub — PCF

## `pbs_Ops.StudioDirectory` (Studio list + Studio detail)

Power Apps code component for the **Studio** and **Studio detail** screens of the PBS Hub Ops Console,
built on the SharePoint data model in `DESIGN.md`.

- **Studio list** — KPIs (utilization today / this month with delta, studios in use, studios needing action),
  "Sedang digunakan sekarang" tiles (which brand and which host is live in each studio right now), daily
  utilization chart, searchable table with per-studio utilization, live usage, status and geofence state.
- **Studio detail** — header with utilization and GMV; tabs:
  - **Ringkasan**: who is using the studio now, utilization today/month, **GMV this month** (verified vs
    waiting review, per session, per live hour, per brand), upcoming schedule, studio and geofence details.
  - **Geofence**: to-scale map editor (drag pin, drag radius), lat/long/radius fields, active toggle,
    warnings for no geofence, radius < 25 m and inactive geofence.
  - **Jadwal**: daily utilization, per-hour capacity slots for a day, that day's sessions, and **every
    session of the month** with GMV and report status.
- Create / edit studio modal.

**Output:** `releases/PBSStudioDirectory_managed_1.1.1.zip` — managed Dataverse solution.
Setup and Power Fx: [`docs/studio-directory-canvas-setup.md`](docs/studio-directory-canvas-setup.md).

### Layout

```
pcf/StudioDirectory/            PCF project (pac pcf init, standard control, React 18)
  StudioDirectory/core/         pure logic: data mapping, utilization, GMV, geo, time
  StudioDirectory/ui/           React UI
  tests/                        Jest unit tests for core/
  harness/                      local preview with mock data (not shipped)
solution/PBSStudioDirectory/    Dataverse solution project (pac solution init), builds the managed zip
releases/                       built managed solution
```

### Build

```bash
cd pcf/StudioDirectory && npm install && npm test && npm run build
# preview: open pcf/StudioDirectory/harness/index.html (after npm run build)
cd ../../solution/PBSStudioDirectory && dotnet build -c Release   # → bin/Release/PBSStudioDirectory.zip (managed)
```

Requires Node 18+, .NET SDK 8 and the Power Platform CLI (`dotnet tool install -g Microsoft.PowerApps.CLI.Tool`).
