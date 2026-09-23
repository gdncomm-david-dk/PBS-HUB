# pbs_Ops.Schedule — canvas app setup

The control renders the **Schedule board (S-1)** as a calendar (week × studio lanes) or a list, and the
**session detail (S-2)** with the seven-step evidence chain. It also provides three ways to create schedules:

| Button | What the control does | What canvas does |
|---|---|---|
| **Buat jadwal** (single) | Form with Brand → Account dropdowns, conflict warnings that must be ticked, then `CREATE_SCHEDULE` | `Patch` into `Schedule - PBS Hub`, then `Patch` `Title = "SCD-" & ID` |
| **Upload massal** (bulk) | Reads each `.xlsx` (the `Table1` table, as PBS0001A does) and gives every row a verdict. It then sends each file as `UPLOAD_SCHEDULE_FILE` with `kind = "BULK"`, one file at a time | Graph `PUT` into `/PBS Power Apps/Bulk Schedule`, then runs **PBS0001A** with that file name |
| **AI Schedule** | Sends each file as `UPLOAD_SCHEDULE_FILE` with `kind = "AI"` | Graph `PUT` into `/PBS Power Apps/Schedule AI Automation`. **PBS0002A** triggers on the new file |

The control **never writes**. It emits `ActionPayload`; canvas does the write and replies through
`ActionResult` with the same `requestId`.

## 1. Import

1. Power Apps → **Solutions → Import** → `releases/PBSSchedule_managed_1.0.0.zip` (managed).
2. Canvas app → **Settings → Updates** → turn on **Power Apps component framework for canvas apps**.
3. **Insert → Get more components → Code** → `PBS Schedule` (`pbs_Ops.Schedule`).
4. Give it the full screen next to the sidebar. Minimum width 1040 px.

## 2. Period variables

The control opens on the current week (Monday–Sunday). Whenever the user changes the range it sends
`SET_FILTER`, and it also sends one on start.

```powerfx
// Screen.OnVisible
Set(varSchedStart, DateAdd(Today(), -(Weekday(Today(), StartOfWeek.Monday) - 1), TimeUnit.Days));
Set(varSchedEnd, DateAdd(varSchedStart, 6, TimeUnit.Days));
Set(varSchedResult, "");
```

## 3. Bind the datasets (`Items`)

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

## 4. Other inputs

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
        templateUrl: "<link to the bulk template in /PBS Power Apps/Template>"
    }
}, JSONFormat.Compact)
```

The single-schedule form no longer asks for Shift, Sesi, Live break or Campaign name; the handlers below do
not write those columns, so existing values stay as they are on edit. **Position** is a choice of
`Main Host` / `Co-Host` — the `Schedule.Position` choice column must carry exactly these two values.

If `Context.permissions` is non-empty, editing and uploading need `SCHEDULE_EDIT`. If it is empty, `Mode` decides.

## 5. Handle actions (`OnChange`)

`varSiteId` and `varDriveId` are the site and drive IDs your current Graph upload already uses
(the `PBS Power Apps` library on `sites/StudioTeamBlibli`).

```powerfx
With({ req: ParseJSON(Self.ActionPayload) },
With({ action: Text(req.action), rid: Text(req.requestId), p: req.payload },
If(rid <> varLastSchedRid,
    Set(varLastSchedRid, rid);   // never process the same request twice
    Set(varOk, true); Set(varErr, ""); Set(varMsg, ""); Set(varSchedId, "");
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
                Set(varOk, false); Set(varErr, FirstError.Message)),

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
                Set(varOk, false); Set(varErr, FirstError.Message)),

        "DELETE_SCHEDULE",
            If(!IsBlank(LookUp('Report - PBS Hub', ScheduleID = Text(p.scheduleId))),
                Set(varOk, false); Set(varErr, "Report sudah ada untuk jadwal ini."),
                IfError(Remove('Schedule - PBS Hub', LookUp('Schedule - PBS Hub', Title = Text(p.scheduleId))),
                    Set(varOk, false); Set(varErr, FirstError.Message))),

        "UPLOAD_SCHEDULE_FILE",
            IfError(
                // Same Graph call as today; only the body source changes (see 5a).
                Office365Groups.HttpRequest(
                    "https://graph.microsoft.com/v1.0/sites/" & varSiteId & "/drives/" & varDriveId &
                        "/root:/" & EncodeUrl(Text(p.folder)) & "/" & EncodeUrl(Text(p.fileName)) & ":/content",
                    "PUT",
                    "data:" & Text(p.mimeType) & ";base64," & Text(p.contentBase64));
                If(Text(p.kind) = "BULK",
                    // One run per file. v1 ran the flow for the FIRST file only.
                    PBS0001A.Run(Text(p.fileName));
                    Set(varMsg, "Terunggah, PBS0001A berjalan"),
                    Set(varMsg, "Terunggah, AI Schedule berjalan")),
                Set(varOk, false); Set(varErr, FirstError.Message)),

        "REMIND_HOST",
            // Optional. Any channel you already use; e-mail shown.
            IfError(
                Office365Outlook.SendEmailV2(
                    LookUp('Host - PBS Hub', Title = Text(p.hostId)).Email.Email,
                    "Pengingat PBS Hub: " & Text(p.scheduleId),
                    Text(p.reason)),
                Set(varOk, false); Set(varErr, FirstError.Message))
        // NAV_SESSION_DETAIL is informational; SelectedScheduleId already carries the open session.
    );
    If(action in ["CREATE_SCHEDULE", "EDIT_SCHEDULE", "DELETE_SCHEDULE", "UPLOAD_SCHEDULE_FILE", "REMIND_HOST"],
        Set(varSchedResult, JSON({
            requestId: rid, status: If(varOk, "ok", "error"),
            message: If(varOk, varMsg, varErr), data: { scheduleId: varSchedId } }, JSONFormat.Compact)))
)))
```

`PBS0001A.Run(...)` stands for the call your app already makes. Keep its real name and parameters. If the flow
returns the number of rows it created, add `created: <number>` to `data` and the dialog will show it.

The control stays locked until its own `requestId` comes back. It waits 30 seconds for a save and
3 minutes per uploaded file.

### 5a. The upload body — test this first

The control reads each file in the browser and sends it as **base64** (`p.contentBase64`, plus `p.mimeType`,
`p.sizeBytes`, `p.fileName`). Your current upload is:

```powerfx
ForAll(Attachments.Attachments,
    Office365Groups.HttpRequest(
        "https://graph.microsoft.com/v1.0/sites/" & varSiteId & "/drives/" & varDriveId & "/root:/" & varFolder & "/" & ThisRecord.Name & ":/content",
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

File names are `ddMMyyHHmmss_<original name>`. This is v1's prefix with a 24-hour clock, so files uploaded
12 hours apart no longer collide.

## 6. What the control checks (v1 checked none of this)

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
