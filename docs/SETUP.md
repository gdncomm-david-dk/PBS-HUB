# PBS Hub — canvas app setup

Setup for the two PBS Hub code components in the Ops Console canvas app. Follow part A once, then part B
for the Studio screens and part C for the Schedule screen.

| Control | Display name | Solution (managed) | Version | Screens |
|---|---|---|---|---|
| `pbs_Ops.StudioHub` | PBS Studio Hub | `releases/PBSStudioHub_managed_1.5.1.zip` (`PBSStudioHub`) | 1.5.1 | Studio list, Studio detail |
| `pbs_Ops.Schedule` | PBS Schedule | `releases/PBSSchedule_managed_1.2.1.zip` (`PBSSchedule`) | 1.2.1 | Schedule board, session detail, create/edit, bulk & AI upload |

Neither control writes to SharePoint. Each one emits an `ActionPayload` `{ action, requestId, payload }`; the
canvas app does the `Patch` and replies through `ActionResult` with the same `requestId`. Until that reply
arrives the control stays locked. It gives up after 30 seconds for a save, or 3 minutes per uploaded file.

---

# A. Before you start

## A1. Import and enable

1. Power Apps → **Solutions → Import**. Import both zips from `releases/` as managed solutions.
2. Canvas app → **Settings → Updates** → turn on **Power Apps component framework for canvas apps**.
3. **Insert → Get more components → Code** → add **PBS Studio Hub** and **PBS Schedule**.
4. Give each control the full screen next to `BlibliUniversalSidebar`. The minimum width is 1040 px.
5. When you later import a newer version, accept **Update code components** in the editor, then save and publish.

**Check the version.** From 1.5.0 the Studio control is a new component, **PBS Studio Hub**
(`pbs_Ops.StudioHub`, solution `PBSStudioHub`), so the app cannot keep running a cached older build. Delete the old
*PBS Studio Master* / *PBS Studio Directory* control from the screen, insert *PBS Studio Hub* and set the same
properties and `OnChange` on it. The header then shows `pbs_Ops.StudioHub 1.5.1`.

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
| `Report - PBS Hub` | `ApprovalStatus` | A live break's report row has `LiveBreak`. It counts as no report and adds no GMV |
| `Brand - PBS Hub` / `Host - PBS Hub` | `NamaBrand` / `NamaHost` | Used to show names instead of IDs |

## A3. Fields decide which columns arrive

A canvas dataset carries only the columns listed under the property's **Fields → Edit**. For every dataset
below, open **Fields → Edit** and add the columns named in the property's description. This matters most for
two datasets:

- On the Studio control, add `LocationID` to both `studios` and `locations`. Without it no studio can be linked.
- On the Studio control, add `LiveBreak` to `schedules` and `ApprovalStatus` to `reports`. Without them a live
  break shows *Belum ada report*.
- On the Schedule control, add `ID`, `Title` and `BrandID` / `HostID` to `brands` and `hosts`. Without them
  the board cannot show names.

Each dataset also has a `*Json` fallback (`StudiosJson`, `SchedulesJson`, `BrandsJson`, …). A non-empty
`*Json` value wins over its dataset.

**Never bind the whole `Host - PBS Hub` list.** It holds `KTP` and `NoRekening`. Bind only the columns shown
in the tables below.

---

# B. PBS Studio Hub (`pbs_Ops.StudioHub` 1.5.1)

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
| **GMV** | Report.Penjualan | Report has no StudioID, so it is joined `Report.ScheduleID → Schedule.Title → Schedule.StudioID`; several reports per session (one per account) are summed. Split into *Terverifikasi* (`ApprovalStatus = Done`), *Menunggu review* and *Perlu revisi*. Ended sessions without a report are counted as "Belum ada report", except live breaks: a session whose `Schedule.LiveBreak` is `Yes`, or whose only report rows have `ApprovalStatus = LiveBreak`, shows **Live Break**, needs no report and adds no GMV. A LiveBreak row next to real reports is ignored |
| **Geofence link** | Studio.LocationID → Studio Location | The lookup item ID first (lookup column only), else the text value against `Studio Location.LocationID` (then `Title`). One location serves many studios; the list, detail and Geofence tab show how many, and editing a shared geofence warns that it applies to all of them. A LocationID that no location carries is shown as *LocationID tidak ditemukan*. Studios without a LocationID fall back to the v1 name match (a `StudioID` column → `Title = StudioID` → `Title = NamaStudio`) and are offered a one-click *Tautkan* |

These are display metrics. Nothing that money depends on is computed in the control.

---

# C. PBS Schedule (`pbs_Ops.Schedule` 1.2.1)

The control renders the **Schedule board (S-1)** as a calendar (week × brand lanes, or studio lanes) or a list, grouped by brand and sorted by start time,, and the
**session detail (S-2)** with the seven-step evidence chain. It also provides three ways to create schedules:

| Button | What the control does | What canvas does |
|---|---|---|
| **Buat jadwal** (single) | Form with Brand → Account dropdowns, conflict warnings that must be ticked, then `CREATE_SCHEDULE` | `Patch` into `Schedule - PBS Hub`, then `Patch` `Title = "SCD-" & ID` |
| **Upload massal** (bulk) | Reads each `.xlsx` (the `Table1` table, as PBS0001A does) and gives every row a verdict. It then sends each file as `UPLOAD_SCHEDULE_FILE` with `kind = "BULK"`, one file at a time | Graph `PUT` into `/PBS Power Apps/Bulk Schedule`, then runs **PBS0001A** with that file name |
| **AI Schedule** | Sends each file as `UPLOAD_SCHEDULE_FILE` with `kind = "AI"` | Graph `PUT` into `/PBS Power Apps/Schedule AI Automation`. **PBS0002A** triggers on the new file |

The control **never writes**. It emits `ActionPayload`; canvas does the write and replies through
`ActionResult` with the same `requestId`.

## C1. Period variables

The control opens on the current week (Monday–Sunday). Whenever the user changes the range it sends
`SET_FILTER`, and it also sends one on start.

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
| `reports` | `Report - PBS Hub` | `Filter('Report - PBS Hub', LiveDate >= varSchedStart && LiveDate <= varSchedEnd)` |
| `absences` | `Host Absence - PBS Hub` | `Filter('Host Absence - PBS Hub', LiveDate >= varSchedStart && LiveDate <= varSchedEnd)` |
| `clockins` | `Clock In - PBS Hub` | `ShowColumns(Filter('Clock In - PBS Hub', ClockInDate >= varSchedStart && ClockInDate <= varSchedEnd), Title, HostID, ClockInDate, CheckInTime, CheckOutTime, ClockInTime, ClockOutTime, IsInsideGeofence, CheckInOffice, Status)` — never bind GPS or selfie columns |
| `evidence` | `Report Automation - PBS Hub` | `Filter('Report Automation - PBS Hub', LiveDate >= varSchedStart && LiveDate <= varSchedEnd)` |

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
| `SelectedScheduleId` | blank for the board, or a ScheduleID to deep-link. Read it back to know which session is open |

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

The single-schedule form no longer asks for Shift, Sesi, Live break or Campaign name; the handlers below do
not write those columns, so existing values stay as they are on edit. **Position** is a choice of
`Main Host` / `Co-Host` — the `Schedule.Position` choice column must carry exactly these two values.

If `Context.permissions` is non-empty, editing and uploading need `SCHEDULE_EDIT`. If it is empty, `Mode` decides.

## C4. Handle actions (`OnChange`)

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
                Patch('Schedule - PBS Hub', LookUp('Schedule - PBS Hub', Title = Text(p.scheduleId)), {
                    Date: DateValue(Text(p.date)),
                    BrandID: Text(p.brandId), StudioID: Text(p.studioId), HostID: Text(p.hostId),
                    Account: Text(p.accountId), Platform: { Value: Text(p.platform) },
                    StartTime: Text(p.startTime), EndTime: Text(p.endTime),
                    JamLive: Value(p.jamLive), TotalLiveTime: Value(p.jamLive),
                    Position: { Value: Text(p.position) }, Status: { Value: Text(p.status) } });
                Set(varSchedId, Text(p.scheduleId)),
                Set(varSchedOk, false); Set(varSchedErr, FirstError.Message)),

        "DELETE_SCHEDULE",
            If(!IsBlank(LookUp('Report - PBS Hub', ScheduleID = Text(p.scheduleId))),
                Set(varSchedOk, false); Set(varSchedErr, "Report sudah ada untuk jadwal ini."),
                IfError(Remove('Schedule - PBS Hub', LookUp('Schedule - PBS Hub', Title = Text(p.scheduleId))); true,
                    Set(varSchedOk, false); Set(varSchedErr, FirstError.Message))),

        "UPLOAD_SCHEDULE_FILE",
            IfError(
                // Same Graph call as today; only the body source changes (see C4a).
                Office365Groups.HttpRequest(
                    "https://graph.microsoft.com/v1.0/sites/" & varSiteID & "/drives/" & varDriveID &
                        "/root:/" & EncodeUrl(Text(p.folder)) & "/" & EncodeUrl(Text(p.fileName)) & ":/content",
                    "PUT",
                    "data:" & Text(p.mimeType) & ";base64," & Text(p.contentBase64));
                If(Text(p.kind) = "BULK",
                    // One run per file. v1 ran the flow for the FIRST file only.
                    'PBS0001A-CreateAutomatedSchedule[AIPowered]'.Run(Text(p.fileName));
                    Set(varSchedMsg, "Terunggah, PBS0001A berjalan"),
                    Set(varSchedMsg, "Terunggah, AI Schedule berjalan")),
                Set(varSchedOk, false); Set(varSchedErr, FirstError.Message)),

        "REMIND_HOST",
            // Optional. Any channel you already use; e-mail shown.
            IfError(
                Office365Outlook.SendEmailV2(
                    LookUp('Host - PBS Hub', Title = Text(p.hostId)).Email.Email,
                    "Pengingat PBS Hub: " & Text(p.scheduleId),
                    Text(p.reason)); true,
                Set(varSchedOk, false); Set(varSchedErr, FirstError.Message))
        // NAV_SESSION_DETAIL is informational; SelectedScheduleId already carries the open session.
    );
    If(action in ["CREATE_SCHEDULE", "EDIT_SCHEDULE", "DELETE_SCHEDULE", "UPLOAD_SCHEDULE_FILE", "REMIND_HOST"],
        Set(varSchedResult, JSON({
            requestId: rid, status: If(varSchedOk, "ok", "error"),
            message: If(varSchedOk, varSchedMsg, varSchedErr), data: { scheduleId: varSchedId } }, JSONFormat.Compact)))
)))
```

`'PBS0001A-CreateAutomatedSchedule[AIPowered]'.Run(...)` is the call your app already makes. If the flow
returns the number of rows it created, add `created: <number>` to `data` and the dialog will show it.

The control stays locked until its own `requestId` comes back. It waits 30 seconds for a save and
3 minutes per uploaded file.

### C4a. The upload body — test this first

The control reads each file in the browser and sends it as **base64** (`p.contentBase64`, plus `p.mimeType`,
`p.sizeBytes`, `p.fileName`). Your current upload is:

```powerfx
ForAll(Attachments.Attachments,
    Office365Groups.HttpRequest(
        "https://graph.microsoft.com/v1.0/sites/" & varSiteID & "/drives/" & varDriveID & "/root:/" & varFolder & "/" & ThisRecord.Name & ":/content",
        "PUT", ThisRecord.Value));
Reset(Attachments);
```

The handler keeps that exact Graph call; only two things change. `ThisRecord.Name` becomes `p.fileName` (already
prefixed `ddMMyyHHmmss_`) and `varFolder` becomes `p.folder` (`bulkFolder` / `aiFolder` from Context). The
difference is the body: `ThisRecord.Value` is a file object from the Attachments control, and a code component
cannot create one — it can only hand canvas text. No `ForAll` is needed; the control sends one file per request.

- **A — keep the Graph call in canvas** (above): pass the data URI
  `"data:<mime>;base64,<content>"` as the body. Canvas converts a data URI into bytes for file parameters, but
  **this has not been tested on your tenant**. Try it with one small file and open the result in the library.
  If the file opens, you are done. If it contains the `data:` text, or Excel says it is damaged, use B.
- **B — move the same Graph call into a flow** (always works): create a flow with a *PowerApps (V2)* trigger
  and three text inputs, `folder`, `fileName` and `contentBase64`. Give it one action,
  *Office 365 Groups → Send an HTTP request V2*, `PUT` to the same URL, with body
  `base64ToBinary(triggerBody()['text_2'])` (or *SharePoint → Create file* with the same
  `base64ToBinary`). In the handler above, replace `Office365Groups.HttpRequest(...)` with
  `PBSUploadScheduleFile.Run(Text(p.folder), Text(p.fileName), Text(p.contentBase64))`.

File names are `ddMMyyHHmmss_<original name>`, the same prefix as your `Text(Now(), "ddmmyyhhmmss_")`
(Power Fx `hh` is already 24-hour when the format has no AM/PM).

### C4b. Keep your current Attachments upload (`uploadMode: "canvas"`)

If you would rather not change the upload at all, set `uploadMode: "canvas"` in `Context.config`. The
**Upload massal** and **AI Schedule** buttons then only emit `OPEN_UPLOAD` (`p.kind` = `BULK` or `AI`) and your
existing popup does the work. You lose the control's row check before upload; everything else stays.

Add this branch to the `Switch` in `OnChange` (no `ActionResult` reply is needed):

```powerfx
        "OPEN_UPLOAD",
            If(Text(p.kind) = "BULK",
                Set(varPopUpAddScheduleAutomate, true),      // bulk popup with Attachments
                Set(varPopUpAddScheduleAutomateAI, true)),   // AI popup with Attachments_1
```

Your bulk button can stay as it is, with two small fixes:

```powerfx
Set(varIsProcessingBulk, true);
If(CountRows(Attachments.Attachments) = 0,
    Notify("Please attach Excel/CSV file", NotificationType.Error, 3000);
    Set(varIsProcessingBulk, false);
    Exit());

Set(varIdentifierBulk, Text(Now(), "ddmmyyhhmmss_"));
// 1. Remember the names before Reset(Attachments) clears them (the Notify below read an empty list).
ClearCollect(colBulkFiles, ForAll(Attachments.Attachments, { Name: varIdentifierBulk & ThisRecord.Name }));

ForAll(Attachments.Attachments,
    Office365Groups.HttpRequest(
        "https://graph.microsoft.com/v1.0/sites/" & varSiteID & "/drives/" & varDriveID &
            "/root:/Bulk Schedule/" & varIdentifierBulk & ThisRecord.Name & ":/content",
        "PUT", ThisRecord.Value));

// 2. One flow run per file. Today only the first file is processed; the others are uploaded but never read.
ForAll(colBulkFiles, 'PBS0001A-CreateAutomatedSchedule[AIPowered]'.Run(Name));

Notify("✅ Bulk upload started: " & Concat(colBulkFiles, Name, ", "), NotificationType.Success, 8000);
Reset(Attachments);
Set(varPopUpAddScheduleAutomate, false);
Set(varIsProcessingBulk, false);
Refresh('Schedule - PBS Hub');   // the control's schedules dataset reloads from the list
```

The AI Schedule button works the same way, with `Attachments_1` and the `Schedule AI Automation` folder.
It calls no flow: PBS0002A starts on its own when the file lands in the folder.

```powerfx
Set(varIsProcessingBulk, true);
If(CountRows(Attachments_1.Attachments) = 0,
    Notify("Please attach PDF file", NotificationType.Error, 3000);
    Set(varIsProcessingBulk, false);
    Exit());

Set(varIdentifierBulk, Text(Now(), "ddmmyyhhmmss_"));
// Remember the names before Reset(Attachments_1) clears them.
ClearCollect(colAiFiles, ForAll(Attachments_1.Attachments, { Name: varIdentifierBulk & ThisRecord.Name }));

ForAll(Attachments_1.Attachments,
    Office365Groups.HttpRequest(
        "https://graph.microsoft.com/v1.0/sites/" & varSiteID & "/drives/" & varDriveID &
            "/root:/Schedule AI Automation/" & varIdentifierBulk & ThisRecord.Name & ":/content",
        "PUT", ThisRecord.Value));

Notify("✅ AI Schedule started: " & Concat(colAiFiles, Name, ", ") & Char(10) &
    "Jadwal muncul setelah PBS0002A selesai", NotificationType.Success, 8000);
Reset(Attachments_1);
Set(varPopUpAddScheduleAI, false);
Set(varPopUpAddScheduleAutomateAI, false);
Set(varPopUpAddScheduleConfirmationAI, false);
Set(varPopUpAddScheduleOption, false);
Set(varIsProcessingBulk, false);
Refresh('Schedule - PBS Hub');
```

`Refresh('Schedule - PBS Hub')` replaces `ClearCollect(colSchedule, ...)` for the control: it binds to the list
directly. The flow may still be writing rows, so the refresh can come too early; the board updates on the
next refresh.

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

The bulk columns are matched by name, ignoring case, spaces and underscores:
`Date`/`Tanggal`, `BrandID`, `StudioID`/`Studio`, `HostID`/`Host`, `StartTime`/`Jam Mulai`,
`EndTime`/`Jam Selesai`, `Account`, `Platform`, `Shift`, `JamLive`, `Brand` (campaign), `Sesi` and `Position`.
Studio and host also match by name. If the template uses other headers, the dialog lists the headers it
found, and the user can still upload after ticking "sesuai template".

AI-schedule files are not validated. PBS0002A was not exported (DESIGN.md), so the control only reports that the
file was uploaded.

---

# D. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Studio header does not show `pbs_Ops.StudioHub 1.5.1` | The screen still holds the old control, or the code component was not updated | Delete the control, insert **PBS Studio Hub**, then save and publish. After an import, accept **Update code components** |
| *Mapping lokasi* banner: studios not linked | `LocationID` is missing from **Fields** on `studios` or `locations` | Open **Lihat kolom** in the banner to see which columns actually arrive. Add `LocationID` under **Fields → Edit** on both datasets, or use `StudiosJson` as in B2 |
| *LocationID tidak ditemukan* on a studio | The studio's `LocationID` is not carried by any item in the `locations` dataset (typo, extra space, or the item is filtered out) | Bind the whole `Studio Location - PBS` list, or pick another location in the Geofence tab |
| Brand or host shows an ID, with a yellow banner | `brands` / `hosts` are not bound, or lack `ID`, `Title`, `BrandID`/`HostID` or the name column | See C2 *Names, not IDs* |
| Saving a session fails on Status or Position | The choice column lacks `Finished`, or `Main Host` / `Co-Host` | Add the values in SharePoint (A2) |
| Patch error *LocationID … expected type 'Text'. Found type 'Record'* | `Studio.LocationID` is a text column but the formula writes a lookup record | Write `LocationID: Text(p.locationId)` (B4) |
| *Invalid argument type (Boolean). Expecting a Record value instead* in `OnChange` | An `IfError(Patch(...), Set(...))` without `; true` | End the first argument with `; true` (B4) |
| Studio › Jadwal shows *Belum ada report* for a live break | `Schedule.LiveBreak` does not reach `schedules`, or `Report.ApprovalStatus` does not reach `reports` | The Jadwal card shows a banner naming the missing column; open **Lihat kolom** and add it under **Fields → Edit** (or to `SchedulesJson` / `ReportsJson`) |
| The Studio `OnChange` is red on its first line (`With({ req: ParseJSON(...) },`) | Power Apps reports every error in the formula there. Common causes: a variable (`varOk`, `varErr`, `varData`, `varPeriodStart`) already has another type in the app, or a column type differs (`Status` text instead of choice, `KapasitasHost` text instead of number) | Hover the red line for the message. Use the handler as in B4 (own variable names). For a text `Status` write `Status: Text(p.status)`; for a text `KapasitasHost` write `KapasitasHost: Text(p.kapasitasHost)` |
| Uploaded file is corrupt, or contains `data:` text | The tenant does not convert a data URI into bytes | Use the flow (C4a option B), or `uploadMode: "canvas"` (C4b) |
| The control stays locked after an action | `ActionResult` is not set to the reply variable, or the reply's `requestId` differs | Check that `ActionResult` = `varStudioResult` / `varSchedResult`, and that the handler echoes `rid` |
| Only the first bulk file creates schedules | The old button ran PBS0001A once | Use the `ForAll(colBulkFiles, …Run(Name))` in C4b |
