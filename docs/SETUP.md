# PBS Hub — canvas app setup

Setup for the two PBS Hub code components in the Ops Console canvas app. Follow part A once, then part B
for the Studio screens and part C for the Schedule screen.

| Control | Display name | Solution (managed) | Version | Screens |
|---|---|---|---|---|
| `pbs_Ops.StudioHub` | PBS Studio Hub | `releases/PBSStudioHub_managed_1.7.0.zip` (`PBSStudioHub`) | 1.7.0 | Studio list, Studio detail |
| `pbs_Ops.ScheduleHub` | PBS Schedule Hub | `releases/PBSScheduleHub_managed_1.5.2.zip` (`PBSScheduleHub`) | 1.5.2 | Schedule board, session detail, create/edit, bulk & AI upload |

Neither control writes to SharePoint. Each one emits an `ActionPayload` `{ action, requestId, payload }`; the
canvas app does the `Patch` and replies through `ActionResult` with the same `requestId`. Until that reply
arrives the control stays locked. It gives up after 30 seconds for a save, or 3 minutes per uploaded file.

---

# A. Before you start

## A1. Import and enable

1. Power Apps → **Solutions → Import**. Import both zips from `releases/` as managed solutions.
2. Canvas app → **Settings → Updates** → turn on **Power Apps component framework for canvas apps**.
3. **Insert → Get more components → Code** → add **PBS Studio Hub** and **PBS Schedule Hub**.
4. Give each control the full screen next to `BlibliUniversalSidebar`. The minimum width is 1040 px.
5. When you later import a newer version, accept **Update code components** in the editor, then save and publish.

**Check the version.** From 1.5.0 the Studio control is a new component, **PBS Studio Hub**
(`pbs_Ops.StudioHub`, solution `PBSStudioHub`), so the app cannot keep running a cached older build. Delete the old
*PBS Studio Master* / *PBS Studio Directory* control from the screen, insert *PBS Studio Hub* and set the same
properties and `OnChange` on it. The header then shows `pbs_Ops.StudioHub 1.7.0`.

The old solutions `PBSStudioMaster`, `PBSHubStudio` and `PBSStudioDirectory` can be deleted once the app runs
`pbs_Ops.StudioHub`.

## A2. SharePoint columns the controls expect

| List | Column | Requirement |
|---|---|---|
| `Studio - PBS Hub` | `LocationID` | **Single line of text** holding the location's `LocationID` (e.g. `LOC-CWG`). A lookup column also works; see B4 |
| `Studio Location - PBS` | `LocationID` | Text, unique (e.g. `LOC-CWG`). One location can serve many studios |
| `Schedule - PBS Hub` | `Status` | Choice that includes **`Finished`**. The full set is `Planned`, `Waiting Report`, `Finished`, `Cancelled`, `Leave` |
| `Schedule - PBS Hub` | `Position` | Choice with exactly **`Main Host`** and **`Co-Host`** |
| `Schedule - PBS Hub` | `LiveBreak` | Choice `Yes` / `No`. `Yes` marks a live break: the Studio page shows *Live Break* instead of *Belum ada report* |
| `Schedule - PBS Hub` | `Position` (for reports) | `Co-Host` needs no report either (the main host files it): the Studio page shows *Co-Host* instead of *Belum ada report* |
| `Report - PBS Hub` | `ApprovalStatus` | A live break's report row has `LiveBreak`. It counts as no report and adds no GMV |
| `Brand - PBS Hub` / `Host - PBS Hub` | `NamaBrand` / `NamaHost` | Used to show names instead of IDs |

## A3. Fields decide which columns arrive

A canvas dataset carries only the columns listed under the property's **Fields → Edit**. For every dataset
below, open **Fields → Edit** and add the columns named in the property's description. This matters most for
two datasets:

- On the Studio control, add `LocationID` to both `studios` and `locations`. Without it no studio can be linked.
- On the Studio control, add `LiveBreak` and `Position` to `schedules` and `ApprovalStatus` to `reports`. Without
  them a live break or a Co-Host session shows *Belum ada report*.
- On the Schedule control, add `ID`, `Title` and `BrandID` / `HostID` to `brands` and `hosts`. Without them
  the board cannot show names.

Each dataset also has a `*Json` fallback (`StudiosJson`, `SchedulesJson`, `BrandsJson`, …). A non-empty
`*Json` value wins over its dataset.

**Choice columns.** Canvas hands a PCF dataset the option *number* of a Choice column (`Status` 4, `Platform` 1).
From Studio Hub 1.6.0 and Schedule 1.2.2 the controls read the label (`Finished`, `Tiktok`, `Yes`) instead. On an
older version the board shows `0`, `4`, `5` in the Status column and live breaks are missed.

**Never bind the whole `Host - PBS Hub` list.** It holds `KTP` and `NoRekening`. Bind only the columns shown
in the tables below.

---

# B. PBS Studio Hub (`pbs_Ops.StudioHub` 1.7.0)

## B1. Period variables

Utilization and GMV are computed over the schedules and reports you bind. Load the previous month
as well: the month-over-month delta needs it.

```powerfx
// Screen.OnVisible
Set(varPeriodStart, Date(Year(Today()), Month(Today()) - 1, 1));
Set(varPeriodEnd,   DateAdd(Date(Year(Today()), Month(Today()) + 1, 1), -1, TimeUnit.Days));
Set(varStudioResult, "");
```

## B2. Bind the datasets (`Items`)

| Property | List (DESIGN.md) | Formula |
|---|---|---|
| `studios` | `Studio - PBS Hub` | `'Studio - PBS Hub'` |
| `locations` | `Studio Location - PBS` | `'Studio Location - PBS'` |
| `schedules` | `Schedule - PBS Hub` | `Filter('Schedule - PBS Hub', Date >= varPeriodStart && Date <= varPeriodEnd)` |
| `reports` | `Report - PBS Hub` | `Filter('Report - PBS Hub', LiveDate >= varPeriodStart && LiveDate <= varPeriodEnd)` |
| `brands` | `Brand - PBS Hub` | `ShowColumns('Brand - PBS Hub', Title, NamaBrand)` |
| `accounts` | `Account - PBS Hub` | `ShowColumns('Account - PBS Hub', Title, AccountName)`. Shows the account name instead of `AC-017` |
| `hosts` | `Host - PBS Hub` | `ShowColumns('Host - PBS Hub', Title, NamaHost)` — **never bind the whole list**: it holds `KTP` and `NoRekening` |

All `Filter` clauses above are delegable to SharePoint. The control pages through every result page itself.
For each dataset, open **Fields → Edit** and add the columns listed in the property's description, so the
dataset carries them.

**Fields decide which columns arrive.** A canvas dataset only carries the columns listed under the property's
**Edit fields**. If `LocationID` is not added there, for `studios` and for `locations`, no studio can be linked.
The list page shows a *Mapping lokasi* banner with the link counts and, under *Lihat kolom*, the columns each
dataset actually delivers.

**Studio ↔ Studio Location.** `Studio - PBS Hub.LocationID` holds the `LocationID` of a
`Studio Location - PBS` item, as text (a lookup column showing `LocationID` is read too). One location serves many studios (e.g. `LOC-CWG` holds every
Cawang studio), so latitude, longitude, radius and IsActive are shared by all of them. Add `LocationID` to the
`studios` and `locations` field lists. With the JSON fallback, keep the lookup as a record:
`StudiosJson = JSON(ShowColumns('Studio - PBS Hub', ID, Title, NamaStudio, KapasitasHost, LokasiStudio, LocationID, Status), JSONFormat.IgnoreBinaryData)`
works for both column types: a text value is matched to `Studio Location.LocationID`, a lookup `{ Id, Value }` by its item ID.

**JSON fallback.** If you prefer, leave a dataset empty and fill the matching `*Json` property instead, e.g.
`SchedulesJson = JSON(ShowColumns(Filter('Schedule - PBS Hub', …), Title, Date, StudioID, BrandID, HostID, StartTime, EndTime, JamLive, Status, Platform, Account, Shift), JSONFormat.IgnoreBinaryData)`.
A non-empty `*Json` value wins over its dataset.

## B3. Other inputs

| Property | Value |
|---|---|
| `Context` | `JSON({ userEmail: User().Email, userName: User().FullName, roles: Concat(colUserRoles, RoleCode, ","), permissions: Concat(colUserPermissions, PermissionCode, ","), config: { maxAccuracyMeters: 100 } }, JSONFormat.Compact)` |
| `Mode` | `If(userRole.Value = "PBS_Team", "Admin", "ReadOnly")` |
| `ActionResult` | `varStudioResult` |
| `OperatingHourStart` / `OperatingHourEnd` | `8` / `22` — the utilization denominator |
| `SelectedStudioId` | blank for the list, or a StudioID to deep-link. Read it back to know which studio is open |

If `Context.permissions` is non-empty, edit actions need `STUDIO_EDIT`. If it is empty, `Mode` decides.

## B4. Handle actions (`OnChange`)

```powerfx
With({ req: ParseJSON(Self.ActionPayload) },
With({ action: Text(req.action), rid: Text(req.requestId), p: req.payload },
If(rid <> varLastStudioRid,
    Set(varLastStudioRid, rid);   // never process the same request twice
    Set(varStudioOk, true); Set(varStudioErr, "");
    Switch(action,
        "SET_FILTER",
            Set(varPeriodStart, DateValue(Text(p.periodStart)));
            Set(varPeriodEnd, DateValue(Text(p.periodEnd))),

        "CREATE_STUDIO",
            If(!IsBlank(LookUp('Studio - PBS Hub', Title = Text(p.studioId))),
                Set(varStudioOk, false); Set(varStudioErr, "StudioID " & Text(p.studioId) & " sudah dipakai."),
                IfError(
                    Patch('Studio - PBS Hub', Defaults('Studio - PBS Hub'), {
                        Title: Text(p.studioId), NamaStudio: Text(p.namaStudio),
                        KapasitasHost: Value(p.kapasitasHost), LokasiStudio: Text(p.lokasiStudio),
                        LocationID: Text(p.locationId),   // Text column; "" = no location
                        Status: { Value: Text(p.status) } }); true,
                    Set(varStudioOk, false); Set(varStudioErr, FirstError.Message))),

        "EDIT_STUDIO",
            IfError(
                Patch('Studio - PBS Hub', LookUp('Studio - PBS Hub', Title = Text(p.studioId)), {
                    NamaStudio: Text(p.namaStudio), KapasitasHost: Value(p.kapasitasHost),
                    LokasiStudio: Text(p.lokasiStudio), Status: { Value: Text(p.status) },
                    LocationID: Text(p.locationId) }); true,
                Set(varStudioOk, false); Set(varStudioErr, FirstError.Message)),

        // Point one studio at another existing location. Other studios at the old location are untouched.
        "SET_STUDIO_LOCATION",
            IfError(
                Patch('Studio - PBS Hub', LookUp('Studio - PBS Hub', Title = Text(p.studioId)), {
                    LocationID: Text(p.locationId) }); true,
                Set(varStudioOk, false); Set(varStudioErr, FirstError.Message)),

        // p.isNew: create the location (LocationID must be unique), then link the studio to it.
        // Otherwise: update the shared location; every studio in p.affectedStudioIds uses the new values.
        // p.linkStudio on an existing location means the studio only matched it by name, so link it for good.
        "SET_GEOFENCE",
            If(Boolean(p.isNew) && !IsBlank(LookUp('Studio Location - PBS', LocationID = Text(p.locationId))),
                Set(varStudioOk, false); Set(varStudioErr, "LocationID " & Text(p.locationId) & " sudah dipakai."),
                IfError(
                    With({ loc:
                        If(Boolean(p.isNew),
                            Patch('Studio Location - PBS', Defaults('Studio Location - PBS'), {
                                Title: Text(p.title), LocationID: Text(p.locationId),
                                Latitude: Value(p.latitude), Longitude: Value(p.longitude),
                                RadiusMeter: Value(p.radiusMeter), IsActive: Boolean(p.isActive) }),
                            Patch('Studio Location - PBS', LookUp('Studio Location - PBS', ID = Value(p.locationItemId)), {
                                Latitude: Value(p.latitude), Longitude: Value(p.longitude),
                                RadiusMeter: Value(p.radiusMeter), IsActive: Boolean(p.isActive) })) },
                        If(Boolean(p.linkStudio),
                            Patch('Studio - PBS Hub', LookUp('Studio - PBS Hub', Title = Text(p.studioId)), {
                                LocationID: Coalesce(loc.LocationID, Text(p.locationId)) }))); true,
                    Set(varStudioOk, false); Set(varStudioErr, FirstError.Message))),

        "TOGGLE_GEOFENCE_ACTIVE",
            IfError(
                Patch('Studio Location - PBS', LookUp('Studio Location - PBS', ID = Value(p.locationItemId)),
                    { IsActive: Boolean(p.isActive) }); true,
                Set(varStudioOk, false); Set(varStudioErr, FirstError.Message))
        // NAV_STUDIO_DETAIL is informational; SelectedStudioId already carries the open studio.
    );
    If(action in ["CREATE_STUDIO", "EDIT_STUDIO", "SET_STUDIO_LOCATION", "SET_GEOFENCE", "TOGGLE_GEOFENCE_ACTIVE"],
        Set(varStudioResult, JSON({
            requestId: rid,
            status: If(varStudioOk, "ok", "error"),
            message: varStudioErr,
            data: { studioId: Text(p.studioId) } }, JSONFormat.Compact)))
)))
```

**Variable names.** The handlers use their own names (`varStudioOk` / `varStudioErr`, and `varSchedOk` / `varSchedErr` / `varSchedMsg` in C4). A generic name such as `varOk`,
`varErr` or `varData` that the app already uses with another type (a record, a number) makes Power Apps reject the
whole formula and underline its first line, `With({ req: ParseJSON(Self.ActionPayload) },`. Hover that red line to
read the real message; the usual ones are in section D.

**`; true` inside `IfError`.** `IfError(value, fallback)` needs both arguments to have the same type. `Patch`
returns a record and `Set` returns a Boolean, so `IfError(Patch(...), Set(...))` fails with *"Invalid argument
type (Boolean). Expecting a Record value instead."* Ending the value with `; true` makes both sides Boolean.
The same applies to every `IfError` in C4.

**`Studio.LocationID` column type.** The handler above writes it as **text**. If Patch reports
*"The type of this argument 'LocationID' does not match the expected type 'Text'. Found type 'Record'"*, the
column is text and an older record-style formula is still in place: replace every `LocationID: { Id: …, Value: … }`
with `LocationID: Text(p.locationId)`. Only if you convert the column to a **lookup** to `Studio Location - PBS`
use the record form instead:
`LocationID: If(IsBlank(p.locationItemId), Blank(), { Id: Value(p.locationItemId), Value: Text(p.locationId) })`
(and `{ Id: loc.ID, Value: loc.LocationID }` in `SET_GEOFENCE`).

The control stays locked until its own `requestId` comes back, and gives up after 30 seconds with a warning.

## B5. How the numbers are derived

| What | Source | Rule |
|---|---|---|
| **Utilization** | Schedule + Studio.KapasitasHost | scheduled host-hours ÷ (KapasitasHost × operating hours × days). Cancelled/Leave excluded; hours clipped to the operating window. Overall = active studios only. Daily and monthly, overall and per studio |
| **Sedang digunakan** | Schedule | sessions whose Date is today and StartTime ≤ now < EndTime (overnight sessions from yesterday included). Shows brand (via BrandID → Brand.NamaBrand), host(s) (HostID → Host.NamaHost), time left and slots used vs capacity |
| **Capacity per slot** | Schedule | distinct hosts per hour vs KapasitasHost; over-capacity slots are flagged (v1 never enforced capacity) |
| **GMV** | Report.Penjualan | Report has no StudioID, so it is joined `Report.ScheduleID → Schedule.Title → Schedule.StudioID`; several reports per session (one per account) are summed. Split into *Terverifikasi* (`ApprovalStatus = Done`), *Menunggu review* and *Perlu revisi*. Ended sessions without a report are counted as "Belum ada report", except live breaks and Co-Host sessions: a session whose `Schedule.Position` is `Co-Host` shows **Co-Host**, and a session whose `Schedule.LiveBreak` is `Yes`, or whose only report rows have `ApprovalStatus = LiveBreak`, shows **Live Break**, needs no report and adds no GMV. A LiveBreak row next to real reports is ignored |
| **Geofence link** | Studio.LocationID → Studio Location | The lookup item ID first (lookup column only), else the text value against `Studio Location.LocationID` (then `Title`). One location serves many studios; the list, detail and Geofence tab show how many, and editing a shared geofence warns that it applies to all of them. A LocationID that no location carries is shown as *LocationID tidak ditemukan*. Studios without a LocationID fall back to the v1 name match (a `StudioID` column → `Title = StudioID` → `Title = NamaStudio`) and are offered a one-click *Tautkan* |

These are display metrics. Nothing that money depends on is computed in the control.

---

# C. PBS Schedule Hub (`pbs_Ops.ScheduleHub` 1.5.2)

> **Moving from the old `pbs_Ops.Schedule` (1.4.x).** Since 1.5.0 the control has a new identity (`pbs_Ops.ScheduleHub`, solution `PBSScheduleHub`), so Power Apps cannot keep loading a cached old build.
> 1. Import `releases/PBSScheduleHub_managed_1.5.2.zip`.
> 2. In the app, copy the old control's **Items / Context / Mode / ActionResult / SelectedScheduleId / OnChange** formulas somewhere safe, then delete that control.
> 3. **Insert → Get more components → Code → PBS Schedule Hub**, then paste the formulas back (same names as in C2–C4).
> 4. Check that the header reads `pbs_Ops.ScheduleHub 1.5.2`. Once no app uses the old control, the `PBSSchedule` solution can be deleted.

The control renders the **Schedule board (S-1)** as a calendar (week × brand lanes, or studio lanes) or a list, grouped by brand and sorted by start time,, and the
**session detail (S-2)** with the seven-step evidence chain. It also provides three ways to create schedules:

| Button | What the control does | What canvas does |
|---|---|---|
| **Buat jadwal** (single) | Form with Brand → Account dropdowns, conflict warnings that must be ticked, then `CREATE_SCHEDULE` | `Patch` into `Schedule - PBS Hub`, then `Patch` `Title = "SCD-" & ID` |
| **Upload massal** (bulk) | Reads each `.xlsx` (the `Table1` table, as PBS0001A does) and gives every row a verdict. It then sends each file as `UPLOAD_SCHEDULE_FILE` with `kind = "BULK"`, one file at a time | Graph `PUT` into `/PBS Power Apps/Bulk Schedule`, then runs **PBS0001A** (Power Apps trigger) with that file name, after the reply is sent |
| **AI Schedule** | Sends each file as `UPLOAD_SCHEDULE_FILE` with `kind = "AI"` | Graph `PUT` into `/PBS Power Apps/Schedule AI Automation`. **PBS0002A** triggers on the new file |

The control **never writes**. It emits `ActionPayload`; canvas does the write and replies through
`ActionResult` with the same `requestId`.

## C1. Period variables

The control opens on the current week (Monday–Sunday) and sends `SET_FILTER` on start. The period in
`SET_FILTER` is **two weeks wider on each side** than the range on screen, so the previous and next week are
already loaded. It sends a new one only when the visible range comes within a week of the loaded edge. While
that reload runs the board keeps showing the rows it has (header: *memperbarui…*), not an empty grid.

Bind `schedules` to the list or a named formula (`Filter(...)`), not to a collection built with
`ClearCollect`. A collection does not change after `Remove`/`Patch`, so edits would not show. Deleted
rows are hidden by the control either way.

```powerfx
// Screen.OnVisible
Set(varSchedStart, DateAdd(Today(), -(Weekday(Today(), StartOfWeek.Monday) - 1), TimeUnit.Days));
Set(varSchedEnd, DateAdd(varSchedStart, 6, TimeUnit.Days));
Set(varSchedResult, "");
```

## C2. Bind the datasets (`Items`)

Conflicts are checked against the day before and the day after, because sessions can run overnight.
For that reason every filter widens the range by one day on each side.

**Names, not IDs.** The board shows brand and host *names*. `Schedule.BrandID`/`HostID` are matched to
`BrandID`/`HostID` (or `Title`) of the Brand/Host list, and also to its `ID` when the schedule column is a
lookup. The name comes from `NamaBrand` / `NamaHost` (or `HostName`); when the list keys on a `BrandID`/`HostID`
column, `Title` is taken as the name. If a name still cannot be found, the ID is shown and a yellow banner
lists which IDs are unmatched — that means the `brands`/`hosts` dataset is not bound or misses those columns.

| Property | List (DESIGN.md) | Formula |
|---|---|---|
| `schedules` | `Schedule - PBS Hub` | `Filter('Schedule - PBS Hub', Date >= DateAdd(varSchedStart, -1, TimeUnit.Days) && Date <= DateAdd(varSchedEnd, 1, TimeUnit.Days))` |
| `brands` | `Brand - PBS Hub` | `ShowColumns('Brand - PBS Hub', ID, Title, NamaBrand, Status)` (add `BrandID` if the list has it) — never bind PIC contacts |
| `accounts` | `Account - PBS Hub` | `'Account - PBS Hub'` |
| `studios` | `Studio - PBS Hub` | `'Studio - PBS Hub'` |
| `hosts` | `Host - PBS Hub` | `ShowColumns('Host - PBS Hub', ID, Title, NamaHost, HostName, Status)` (add `HostID` if the list has it) — **never bind the whole list** (KTP, NoRekening) |
| `reports` | `Report - PBS Hub` | `Filter('Report - PBS Hub', LiveDate >= varSchedStart && LiveDate <= varSchedEnd)`. Fields: `ID`, `Title`, `ScheduleID`, `AccountID`, `Platform`, `Penjualan`, `Pesanan`, `TotalViewer`, durasi, `ApprovalStatus`, `Match`, `ApprovalComment`, `ApproverEmail`, `Attachment` |
| `absences` | `Host Absence - PBS Hub` | `Filter('Host Absence - PBS Hub', LiveDate >= varSchedStart && LiveDate <= varSchedEnd)` |
| `clockins` | `Clock In - PBS Hub` | `ShowColumns(Filter('Clock In - PBS Hub', ClockInDate >= varSchedStart && ClockInDate <= varSchedEnd), Title, HostID, ClockInDate, CheckInTime, CheckOutTime, ClockInTime, ClockOutTime, IsInsideGeofence, CheckInOffice, Status)` — never bind GPS or selfie columns |
| `evidence` | `Report Automation - PBS Hub` | `Filter('Report Automation - PBS Hub', LiveDate >= varSchedStart && LiveDate <= varSchedEnd)`. Fields: `ID`, `Title` (= `Report.Title`, e.g. `REP-120`), `Status` (Match / Unmatch), `Penjualan`, `Pesanan`, `TotalViewer`, durasi, `StartHour`, `EndHour` |

`reports`, `absences`, `clockins` and `evidence` are optional. Without them the detail page shows those steps as
"belum". A session that has a report is **locked**: it cannot be edited or deleted. For each dataset,
open **Fields → Edit** and add the columns listed in the property's description.

Each dataset also has a `*Json` fallback (`SchedulesJson`, `BrandsJson`, …). A non-empty value wins over
the dataset.

## C3. Other inputs

| Property | Value |
|---|---|
| `Context` | see below |
| `Mode` | `If(userRole.Value = "PBS_Team", "Admin", "ReadOnly")` |
| `ActionResult` | `varSchedResult` |
| `SelectedScheduleId` | Read it back to know which session is open. The control always starts on the board and clears a value left over from an earlier visit; setting it to a ScheduleID **after** the screen has loaded opens that session |

```powerfx
JSON({
    userEmail: User().Email, userName: User().FullName,
    roles: Concat(colUserRoles, RoleCode, ","), permissions: Concat(colUserPermissions, PermissionCode, ","),
    config: {
        platforms: ["Shopee", "TikTok"],
        maxUploadMb: 10,
        bulkFolder: "Bulk Schedule", aiFolder: "Schedule AI Automation", bulkTable: "Table1",
        aiAccept: ".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.docx,.txt",
        templateUrl: "<link to the bulk template in /PBS Power Apps/Template>",
        uploadMode: "control"   // or "canvas": keep your Attachments popup, see C4b
    }
}, JSONFormat.Compact)
```

**Status.** A session ends as **`Finished`** (not `Done`). The edit form offers Planned, Waiting Report,
Finished, Cancelled and Leave, plus any other value already in the list; an old `Done` row is still shown as
*Selesai*. The `Schedule.Status` choice column must have a `Finished` value.

**Live Break and Co-Host.** As on the Studio page, a session needs no report when `Schedule.LiveBreak` is `Yes`,
when its only report row has `ApprovalStatus = LiveBreak`, or when `Schedule.Position` is `Co-Host` (the main host
reports). Such a session is not counted under *Belum ada report*, and its Report, Bukti AI and Verdict steps read
*Live Break* or *Co-Host*.

**Report host vs AI.** The session detail puts every host report next to its Report Automation row
(`Report Automation.Title` = `Report.Title`, e.g. `REP-120`): Penjualan, Pesanan, Total viewer, Durasi, Jam live and
the AI `Status`, with each difference marked. The reviewer then either approves (**Sesuai — setujui**) or, with a
comment, asks for a revision (**Tidak sesuai — minta revisi**), which emits `REVIEW_REPORT` (handler in C4):

| Decision | Report | Report Automation |
|---|---|---|
| Minta revisi | `ApprovalStatus` → `Need Revision`, `Match` → `Unmatch`, `ApprovalComment` → the comment, `ApproverEmail` → the reviewer | `Status` → `Unmatch` (only this column) |
| Setujui | `ApprovalStatus` → `Done`, `Match` → `Match`, `ApproverEmail` → the reviewer (comment kept unless a new one is given) | unchanged |

When the host resubmits, the host app sets `ApprovalStatus` to `Waiting Approval Revision`; the detail then asks for a
new comparison. `ApprovalStatus` values: `Waiting Approval`, `Waiting Approval Revision`, `Need Revision`, `Done`,
`LiveBreak`. If `ApproverEmail` is a Person column instead of text, write
`ApproverEmail: { Claims: "i:0#.f|membership|" & User().Email, DisplayName: User().FullName, Email: User().Email, Department: "", JobTitle: "", Picture: "" }`.

The single-schedule form no longer asks for Shift, Sesi, Live break or Campaign name; the handlers below do
not write those columns, so existing values stay as they are on edit. **Position** is a choice of
`Main Host` / `Co-Host` — the `Schedule.Position` choice column must carry exactly these two values.

If `Context.permissions` is non-empty, editing and uploading need `SCHEDULE_EDIT`. If it is empty, `Mode` decides.

## C4. Handle actions (`OnChange`)

**Filtered sources.** Every `LookUp` / `Filter` in the handler reads from the app's filtered tables instead of
the whole list:

| Table | Replaces | Used by |
|---|---|---|
| `scheduleFiltered` | `'Schedule - PBS Hub'` | EDIT, DELETE, BULK_DELETE |
| `reportFiltered` | `'Report - PBS Hub'` | DELETE / BULK_DELETE (report check), REVIEW_REPORT |
| `clockInFiltered` | `'Clock In - PBS Hub'` | not used by the handler today; use it for any clock-in lookup you add |
| `absenceFiltered` | `'Host Absence - PBS Hub'` | not used by the handler today; use it for any absence lookup you add |

`Patch`, `Remove`, `Defaults` and `Refresh` still name the SharePoint list: a record found in a filtered table
keeps its `ID`, so SharePoint knows which item to change. Keep in mind:
- The filtered tables must hold every row the control shows, at least the current period (`varSchedStart`–`varSchedEnd`).
  A session outside them is not found, and EDIT/DELETE then fail with a blank-record error.
- The *report exists* check before a delete only sees `reportFiltered`. Filter it on the same period, or a
  report outside the period will not block the delete.
- If they are **collections** (`ClearCollect`), re-collect them after a write (for example after `Refresh(...)`),
  otherwise the next action reads stale rows. Named formulas (App › Formulas) update by themselves.
- `REVIEW_REPORT` still patches `'Report Automation - PBS Hub'` directly (no filtered table for it).

`varSiteID` and `varDriveID` are the site and drive IDs your current Graph upload already uses
(the `PBS Power Apps` library on `sites/StudioTeamBlibli`).

```powerfx
With({ req: ParseJSON(Self.ActionPayload) },
With({ action: Text(req.action), rid: Text(req.requestId), p: req.payload },
If(rid <> varLastSchedRid,
    Set(varLastSchedRid, rid);   // never process the same request twice
    Set(varSchedOk, true); Set(varSchedErr, ""); Set(varSchedMsg, ""); Set(varSchedId, "");
    Switch(action,
        "SET_FILTER",
            Set(varSchedStart, DateValue(Text(p.periodStart)));
            Set(varSchedEnd, DateValue(Text(p.periodEnd))),

        "CREATE_SCHEDULE",
            IfError(
                With({ n: Patch('Schedule - PBS Hub', Defaults('Schedule - PBS Hub'), {
                        Date: DateValue(Text(p.date)),
                        BrandID: Text(p.brandId), StudioID: Text(p.studioId), HostID: Text(p.hostId),
                        Account: Text(p.accountId), Platform: { Value: Text(p.platform) },
                        StartTime: Text(p.startTime), EndTime: Text(p.endTime),
                        JamLive: Value(p.jamLive), TotalLiveTime: Value(p.jamLive),
                        Position: { Value: Text(p.position) },   // "Main Host" or "Co-Host"
                        TotalAccount: Value(p.totalAccount),
                        Status: { Value: "Planned" } }) },
                    // Second step, as v1: Title is only known after the insert (race R5).
                    Patch('Schedule - PBS Hub', n, { Title: "SCD-" & n.ID });
                    Set(varSchedId, "SCD-" & n.ID)),
                Set(varSchedOk, false); Set(varSchedErr, FirstError.Message)),

        "EDIT_SCHEDULE",
            IfError(
                Patch('Schedule - PBS Hub', LookUp(scheduleFiltered, Title = Text(p.scheduleId)), {
                    Date: DateValue(Text(p.date)),
                    BrandID: Text(p.brandId), StudioID: Text(p.studioId), HostID: Text(p.hostId),
                    Account: Text(p.accountId), Platform: { Value: Text(p.platform) },
                    StartTime: Text(p.startTime), EndTime: Text(p.endTime),
                    JamLive: Value(p.jamLive), TotalLiveTime: Value(p.jamLive),
                    Position: { Value: Text(p.position) }, Status: { Value: Text(p.status) } });
                Set(varSchedId, Text(p.scheduleId)),
                Set(varSchedOk, false); Set(varSchedErr, FirstError.Message)),

        "DELETE_SCHEDULE",
            If(!IsBlank(LookUp(reportFiltered, ScheduleID = Text(p.scheduleId))),
                Set(varSchedOk, false); Set(varSchedErr, "Report sudah ada untuk jadwal ini."),
                IfError(Remove('Schedule - PBS Hub', LookUp(scheduleFiltered, Title = Text(p.scheduleId)));
                        Refresh('Schedule - PBS Hub'); true,
                    Set(varSchedOk, false); Set(varSchedErr, FirstError.Message))),

        "UPLOAD_SCHEDULE_FILE",
            IfError(
                // Same Graph call as today; only the body source changes (see C4a).
                Office365Groups.HttpRequest(
                    "https://graph.microsoft.com/v1.0/sites/" & varSiteID & "/drives/" & varDriveID &
                        "/root:/" & EncodeUrl(Text(p.folder)) & "/" & EncodeUrl(Text(p.fileName)) & ":/content",
                    "PUT",
                    "data:" & Text(p.mimeType) & ";base64," & Text(p.contentBase64));
                // Reply NOW: the dialog shows "Terunggah" without waiting for the flow.
                Set(varSchedResult, JSON({ requestId: rid, status: "ok",
                    message: If(Text(p.kind) = "BULK", "Terunggah, PBS0001A berjalan", "Terunggah, AI Schedule berjalan"),
                    data: { scheduleId: "" } }, JSONFormat.Compact));
                // BULK: PBS0001A has a Power Apps trigger, so it only starts from this Run (one run per file).
                // AI: PBS0002A starts on its own (When a file is created).
                If(Text(p.kind) = "BULK",
                    IfError('PBS0001A-CreateAutomatedSchedule[AIPowered]'.Run(Text(p.fileName)); true,
                        Notify("PBS0001A gagal untuk " & Text(p.fileName) & ": " & FirstError.Message, NotificationType.Error)));
                Refresh('Schedule - PBS Hub'),
                Set(varSchedOk, false); Set(varSchedErr, FirstError.Message)),

        // List view: tick sessions, then Duplikat. Each item carries the CREATE_SCHEDULE fields plus the new date.
        "BULK_CREATE_SCHEDULE",
            IfError(
                ForAll(Table(p.items) As it,
                    With({ n: Patch('Schedule - PBS Hub', Defaults('Schedule - PBS Hub'), {
                            Date: DateValue(Text(it.Value.date)),
                            BrandID: Text(it.Value.brandId), StudioID: Text(it.Value.studioId), HostID: Text(it.Value.hostId),
                            Account: Text(it.Value.accountId), Platform: { Value: Text(it.Value.platform) },
                            StartTime: Text(it.Value.startTime), EndTime: Text(it.Value.endTime),
                            JamLive: Value(it.Value.jamLive), TotalLiveTime: Value(it.Value.jamLive),
                            Position: { Value: Text(it.Value.position) },
                            TotalAccount: Value(it.Value.totalAccount),
                            Status: { Value: "Planned" } }) },
                        Patch('Schedule - PBS Hub', n, { Title: "SCD-" & n.ID })));
                Set(varSchedMsg, CountRows(Table(p.items)) & " jadwal berhasil diduplikat.");
                Refresh('Schedule - PBS Hub'); true,
                Set(varSchedOk, false); Set(varSchedErr, FirstError.Message)),

        // List view: tick sessions, then Hapus. The control already leaves out sessions with a report.
        "BULK_DELETE_SCHEDULE",
            IfError(
                ForAll(Table(p.scheduleIds) As x,
                    If(IsBlank(LookUp(reportFiltered, ScheduleID = Text(x.Value))),
                        Remove('Schedule - PBS Hub', LookUp(scheduleFiltered, Title = Text(x.Value)))));
                Set(varSchedMsg, CountRows(Table(p.scheduleIds)) & " jadwal dihapus.");
                Refresh('Schedule - PBS Hub'); true,
                Set(varSchedOk, false); Set(varSchedErr, FirstError.Message)),

        "REFRESH",
            // "Muat ulang" button: reload every list the control is bound to.
            Refresh('Schedule - PBS Hub'); Refresh('Report - PBS Hub'); Refresh('Report Automation - PBS Hub'),

        // Judgement on a host report after comparing it with Report Automation (Title = Report.Title).
        // revision: Report → Need Revision + Unmatch + comment + approver; Report Automation → Status Unmatch.
        // approve:  Report → Done + Match (+ comment if given) + approver.
        "REVIEW_REPORT",
            IfError(
                With({ rep: LookUp(reportFiltered, Title = Text(p.reportId)), revise: Text(p.decision) = "revision" },
                    Patch('Report - PBS Hub', rep, {
                        ApprovalStatus: { Value: If(revise, "Need Revision", "Done") },
                        Match: { Value: If(revise, "Unmatch", "Match") },
                        ApprovalComment: If(IsBlank(Text(p.comment)), rep.ApprovalComment, Text(p.comment)),
                        ApproverEmail: User().Email });
                    If(revise,
                        ForAll(Filter('Report Automation - PBS Hub', Title = Text(p.reportId)) As ra,
                            Patch('Report Automation - PBS Hub', ra, { Status: { Value: "Unmatch" } })));
                    Set(varSchedMsg, Text(p.reportId) & If(revise, " dikembalikan ke host untuk revisi.", " disetujui."))); true,
                Set(varSchedOk, false); Set(varSchedErr, FirstError.Message))
        // NAV_SESSION_DETAIL is informational; SelectedScheduleId already carries the open session.
        // REMIND_HOST is optional; add it here only with a channel you use (e.g. Office365Outlook.SendEmailV2).
    );   // ← this closes Switch. Keep it OUTSIDE any /* comment */, or the reply below never runs.
    // Reply for everything else, and for an upload that failed (a good upload already replied above).
    If(action in ["CREATE_SCHEDULE", "EDIT_SCHEDULE", "DELETE_SCHEDULE", "BULK_CREATE_SCHEDULE", "BULK_DELETE_SCHEDULE", "REVIEW_REPORT", "REMIND_HOST"]
            || (action = "UPLOAD_SCHEDULE_FILE" && !varSchedOk),
        Set(varSchedResult, JSON({
            requestId: rid, status: If(varSchedOk, "ok", "error"),
            message: If(varSchedOk, varSchedMsg, varSchedErr), data: { scheduleId: varSchedId } }, JSONFormat.Compact)))
)))
```

### Several reports for one schedule

A live that drops and restarts (for example 14:00–15:00, then 15:20–17:20) gives **one report per part**, all
with the same `ScheduleID`. The detail shows every report: *Report host* sums GMV and duration (`GMV … · 2 bagian
live · … menit`), *Bukti AI* and *Hasil review* list each report with its own Report Automation row, and
**Lampiran report (2)** groups the files per report. The session counts as approved only when every report is Done.

### C4c. Lampiran report (no handler)

**Lampiran report** in the session detail lists the links stored in the Report list's **`Attachment`** column
(multiple lines of text) for every report of the session, with **Buka** to open each one in a new tab. The control
reads the column straight from the `reports` dataset, so `OnChange` needs no branch for it.

- Add `Attachment` to the `reports` dataset: **Fields → Edit**, and to `reportFiltered` if it uses `ShowColumns`.
- Every `https://…` in the text becomes one file: one link per line, links separated by `;` or `,`, rich text
  (`<a href>`) and JSON (a Hyperlink or Image value) all work. The file name is the last part of the URL.
- Text without a full `https://` URL (only a file name, or a `/sites/...` path) is not shown.
- The button is disabled while a session has no report (including Live Break and Co-Host).

## C5. What the control checks (v1 checked none of this)

| Check | Where | Effect |
|---|---|---|
| Host booked twice at overlapping times | form, bulk preview, board (red dot), detail | Warning; in the form, "Tetap simpan" must be ticked |
| Account live in two sessions at once | same | Warning |
| Studio over `KapasitasHost` (distinct hosts at the busiest moment) | same | Warning |
| Unknown `BrandID` / `StudioID` / `HostID` in a bulk row | bulk preview | Row **rejected**; a file with rejected rows is not uploaded (PBS0001A would write dangling IDs) |
| Unreadable date or time, start = end | bulk preview, form | Rejected / field error |
| Inactive brand, host or studio; date in the past; overnight session; duplicate row | form, bulk preview | Warning |
| Report already submitted | board (lock), detail, row menu | Edit and delete disabled |

The bulk columns are matched by name, ignoring case, spaces and underscores. The PBS template (`Table1`, header
in row 2) is read as is: `Date`, `StartHour`, `EndHour`, `Brand`, `Host`, `Studio`, `Account`, `Position`, `Platform`,
`BrandID`, `HostID`, `StudioID`, `AccountID`, `TotalAccount`, `AutomatedDuration`. The ID columns are checked
against the master lists; when an ID cell is empty, the name column is used instead (`Account` may be
`sidomunculstore` or `sidomunculstore - Tiktok`). Older headers still work: `Tanggal`, `StartTime`/`Jam Mulai`,
`EndTime`/`Jam Selesai`, `JamLive`, `Shift`, `Sesi`. If the template uses other headers, the dialog lists the headers it
found, and the user can still upload after ticking "sesuai template".

AI-schedule files are not validated. PBS0002A was not exported (DESIGN.md), so the control only reports that the
file was uploaded.

---

# D. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Studio header does not show `pbs_Ops.StudioHub 1.7.0` | The screen still holds the old control, or the code component was not updated | Delete the control, insert **PBS Studio Hub**, then save and publish. After an import, accept **Update code components** |
| *Mapping lokasi* banner: studios not linked | `LocationID` is missing from **Fields** on `studios` or `locations` | Open **Lihat kolom** in the banner to see which columns actually arrive. Add `LocationID` under **Fields → Edit** on both datasets, or use `StudiosJson` as in B2 |
| *LocationID tidak ditemukan* on a studio | The studio's `LocationID` is not carried by any item in the `locations` dataset (typo, extra space, or the item is filtered out) | Bind the whole `Studio Location - PBS` list, or pick another location in the Geofence tab |
| Brand or host shows an ID, with a yellow banner | `brands` / `hosts` are not bound, or lack `ID`, `Title`, `BrandID`/`HostID` or the name column | See C2 *Names, not IDs* |
| Saving a session fails on Status or Position | The choice column lacks `Finished`, or `Main Host` / `Co-Host` | Add the values in SharePoint (A2) |
| Patch error *LocationID … expected type 'Text'. Found type 'Record'* | `Studio.LocationID` is a text column but the formula writes a lookup record | Write `LocationID: Text(p.locationId)` (B4) |
| *Invalid argument type (Boolean). Expecting a Record value instead* in `OnChange` | An `IfError(Patch(...), Set(...))` without `; true` | End the first argument with `; true` (B4) |
| Studio › Jadwal shows *Belum ada report* for a live break | `Schedule.LiveBreak` does not reach `schedules`, or `Report.ApprovalStatus` does not reach `reports` | The Jadwal card shows a banner naming the missing column; open **Lihat kolom** and add it under **Fields → Edit** (or to `SchedulesJson` / `ReportsJson`) |
| The Studio `OnChange` is red on its first line (`With({ req: ParseJSON(...) },`) | Power Apps reports every error in the formula there. Common causes: a variable (`varOk`, `varErr`, `varData`, `varPeriodStart`) already has another type in the app, or a column type differs (`Status` text instead of choice, `KapasitasHost` text instead of number) | Hover the red line for the message. Use the handler as in B4 (own variable names). For a text `Status` write `Status: Text(p.status)`; for a text `KapasitasHost` write `KapasitasHost: Text(p.kapasitasHost)` |
| Status shows `0`, `4`, `5`; Platform shows `1`; a Finished live break shows *Menunggu review* | The control is older than Studio Hub 1.6.0 / Schedule 1.2.2 and reads Choice option numbers | Import the current zips and accept **Update code components** |
| Uploaded file is corrupt, or contains `data:` text | The tenant does not convert a data URI into bytes | Use the flow (C4a option B), or `uploadMode: "canvas"` (C4b) |
| The control stays locked after an action | `ActionResult` is not set to the reply variable, or the reply's `requestId` differs | Check that `ActionResult` = `varStudioResult` / `varSchedResult`, and that the handler echoes `rid` |
| Upload dialog: *Aplikasi tidak membalas dalam 180 detik* / *belum dikonfirmasi*, but the file and the flow are fine | The reply (`varSchedResult`) is never set (the final `If(action in [...])` block commented out or missing), or set after `PBS0001A….Run()` | Use the C4 handler: upload branch sets the message only, `.Run()` at the bottom after the reply. Check that `"UPLOAD_SCHEDULE_FILE"` is in the `If(action in [...])` list and that `ActionResult` = `varSchedResult` |
| Upload works, but the reply never comes (or only REVIEW_REPORT replies) | The `)` that closes `Switch(` sits inside a `/* … */` comment, so the reply block became part of the last Switch branch | Keep `);` after the last branch outside any comment (C4) |
| Schedule opens a session detail straight away instead of the list | Before Schedule 1.4.0 the bound `SelectedScheduleId` reopened the last session on return | Import 1.4.0: the control always starts on the list |
| Lampiran shows only *Memuat lampiran dari SharePoint…* | The app still runs Schedule 1.4.1/1.4.2 | Import the current zip, accept **Update code components**, then check the header reads `pbs_Ops.ScheduleHub 1.5.2` |
| Lampiran report says *belum punya lampiran* although the report has links | `Attachment` is not in the `reports` dataset (or `reportFiltered`), or the text holds no full `https://` URL | Add `Attachment` under **Fields → Edit** (C4c) |
| Bulk Duplikat / Hapus shows *tidak membalas* | `BULK_CREATE_SCHEDULE` / `BULK_DELETE_SCHEDULE` are missing from the Switch or from the reply list | Add both branches and both names as in C4 |
| Deleted schedule comes back after reopening the screen | `schedules` is bound to a collection, or `DELETE_SCHEDULE` has no `Refresh` | Bind to the list / `Filter(...)` and keep the `Refresh('Schedule - PBS Hub')` in C4 |
| Every week change shows a loading grid | The app still runs 1.5.0 or older | Import the current zip; the header should read `pbs_Ops.ScheduleHub 1.5.2` |
| Week/filter resets after leaving the screen | Browser storage is blocked in the host | The board then starts on this week; everything else works |
| New schedules from a flow do not appear | Canvas apps are not pushed SharePoint changes | Press **Muat ulang**, or add the Timer in C4 *Auto update* |
| Bulk: notification OK and file in *Bulk Schedule*, but no schedules | `PBS0001A….Run()` was removed; the flow has a Power Apps trigger | Keep the `.Run()` at the bottom of the C4 handler |
