# PBS Hub — PCF

| Control | Screens | Managed solution | Canvas setup |
|---|---|---|---|
| `pbs_Ops.StudioHub` | Studio list, Studio detail | `releases/PBSStudioHub_managed_1.5.0.zip` | [`docs/SETUP.md` § B](docs/SETUP.md) |
| `pbs_Ops.Schedule` | Schedule board, session detail, create/edit, bulk & AI upload | `releases/PBSSchedule_managed_1.2.1.zip` | [`docs/SETUP.md` § C](docs/SETUP.md) |

## `pbs_Ops.StudioHub` (Studio list + Studio detail)

Power Apps code component for the **Studio** and **Studio detail** screens of the PBS Hub Ops Console,
built on the SharePoint data model in `DESIGN.md`.

- **Studio list** — KPIs (utilization today / this month with delta, studios in use, studios needing action),
  "Sedang digunakan sekarang" tiles (which brand and which host is live in each studio right now), daily
  utilization chart, searchable table with per-studio utilization, live usage, status and geofence state,
  the studio's location (LocationID, with how many studios share it) and a location filter.
- **Studio detail** — header with utilization and GMV; tabs:
  - **Ringkasan**: who is using the studio now, utilization today/month, **GMV this month** (verified vs
    waiting review, per session, per live hour, per brand), upcoming schedule, studio and geofence details.
  - **Geofence**: the location the studio points to through the `Studio.LocationID` lookup and every
    studio that shares it; move the studio to another location or create a new one (unique LocationID);
    to-scale map editor (drag pin, drag radius), lat/long/radius fields, active toggle, warnings for no
    location, a LocationID that does not exist, radius < 25 m, inactive geofence, and edits that apply to
    all studios at a shared location.
  - **Jadwal**: daily utilization, per-hour capacity slots for a day, that day's sessions, and **every
    session of the month** with GMV and report status.
- Create / edit studio modal, including the Lokasi (LocationID) picker.

## `pbs_Ops.Schedule` (Schedule + session detail)

- **Board** — KPIs (sessions and live hours in range, live now, conflicts, ended sessions without a report),
  date range with Hari ini / Minggu ini / Bulan ini, Brand / Host / Studio / Platform / Status filters and search.
  Everything is grouped by **brand** (A–Z) and sorted by date and start time, with brand and host **names**.
  **Kalender**: week columns × brand lanes (or studio lanes), chips coloured by status, red dot on conflicts,
  lock when a report is in, today tinted. **List**: a header per brand (sessions, hours), then Tanggal, Jam,
  Account, Host (+ position), Studio, Platform, Status, row menu, "Muat lebih banyak" paging.
- **Session detail** — the evidence chain Dijadwalkan → Clock in → Absen → Report host → Bukti AI → Verdict →
  Baris payroll; each step says what is missing and offers "Ingatkan host"; conflicts; other sessions of the
  same host or studio that day. Edit, duplicate, delete (locked once a report exists).
- **Buat jadwal** (single, from the app) — Tanggal, Studio, Brand → Account, Host, Platform, jam, Posisi
  (Main Host / Co-Host); Brand → Account dependent dropdowns, host / studio / account conflict and
  capacity warnings that must each be ticked before saving.
- **Upload massal** — multi-file `.xlsx`, parsed in the browser (the `Table1` table PBS0001A reads), per-row verdict
  (Valid / Peringatan / Ditolak) against master data and existing sessions, downloadable error list; each clean
  file is uploaded through the canvas Graph call and PBS0001A runs per file.
- **AI Schedule** — upload to `/Schedule AI Automation` for PBS0002A.


```
pcf/StudioDirectory/            PCF project (pac pcf init, standard control, React 18)
  StudioDirectory/core/         pure logic: data mapping, utilization, GMV, geo, time
  StudioDirectory/ui/           React UI
  tests/                        Jest unit tests for core/
  harness/                      local preview with mock data (not shipped)
pcf/Schedule/                   PCF project for pbs_Ops.Schedule (same layout)
solution/PBSStudioHub/          Dataverse solution project (pac solution init), builds the managed zip
solution/PBSSchedule/           same, for pbs_Ops.Schedule
releases/                       built managed solution
```

### Build

```bash
cd pcf/StudioDirectory && npm install && npm test && npm run build
# preview: open pcf/StudioDirectory/harness/index.html (after npm run build)
cd ../../solution/PBSStudioHub && dotnet build -c Release   # → bin/Release/PBSStudioHub.zip (managed)
# Schedule: same steps in pcf/Schedule and solution/PBSSchedule
```

Requires Node 18+, .NET SDK 8 and the Power Platform CLI (`dotnet tool install -g Microsoft.PowerApps.CLI.Tool`).
