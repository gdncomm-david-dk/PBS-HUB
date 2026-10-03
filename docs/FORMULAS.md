# PBS Hub — canvas formulas (copy sheet)

All `Items`, inputs and `OnChange` for the three screens, for **Studio Hub 1.8.0** and **Schedule Hub 1.7.0**.
Explanations and troubleshooting are in [`SETUP.md`](SETUP.md); this file only collects what you paste.

For every dataset, also open **Fields → Edit** and add the columns the property description lists.
On a phone, size each control `X: 0, Y: 0, Width: Parent.Width, Height: Parent.Height` and turn off
*Scale to fit* and *Lock orientation* in **Settings → Display**.

---

## 1. Studio screen (`pbs_Ops.StudioHub`)

### Screen.OnVisible

```powerfx
Set(varPeriodStart, Date(Year(Today()), Month(Today()) - 1, 1));
Set(varPeriodEnd,   DateAdd(Date(Year(Today()), Month(Today()) + 1, 1), -1, TimeUnit.Days));
Set(varStudioResult, "")
```

### Datasets (`Items`)

| Property | Formula |
|---|---|
| `studios` | `'Studio - PBS Hub'` |
| `locations` | `'Studio Location - PBS'` |
| `schedules` | `Filter('Schedule - PBS Hub', Date >= varPeriodStart && Date <= varPeriodEnd)` |
| `reports` | `Filter('Report - PBS Hub', LiveDate >= varPeriodStart && LiveDate <= varPeriodEnd)` |
| `brands` | `ShowColumns('Brand - PBS Hub', Title, NamaBrand)` |
| `accounts` | `ShowColumns('Account - PBS Hub', Title, AccountName)` |
| `hosts` | `ShowColumns('Host - PBS Hub', Title, NamaHost)` (never the whole list: KTP, NoRekening) |

Fields to add: `LocationID` on `studios` **and** `locations`; `LiveBreak`, `Position` on `schedules`;
`ApprovalStatus`, `Penjualan`, `ScheduleID` on `reports`.

### Other inputs

| Property | Value |
|---|---|
| `Context` | `JSON({ userEmail: User().Email, userName: User().FullName, roles: Concat(colUserRoles, RoleCode, ","), permissions: Concat(colUserPermissions, PermissionCode, ","), config: { maxAccuracyMeters: 100 } }, JSONFormat.Compact)` |
| `Mode` | `If(userRole.Value = "PBS_Team", "Admin", "ReadOnly")` |
| `ActionResult` | `varStudioResult` |
| `OperatingHourStart` | `8` |
| `OperatingHourEnd` | `22` |
| `SelectedStudioId` | blank (or a StudioID to open that studio) |

### OnChange

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

---

## 2. Schedule screen (`pbs_Ops.ScheduleHub`, `View = "Board"`)

### Screen.OnVisible

```powerfx
Set(varSchedStart, DateAdd(Today(), -(Weekday(Today(), StartOfWeek.Monday) - 1), TimeUnit.Days));
Set(varSchedEnd, DateAdd(varSchedStart, 6, TimeUnit.Days));
Set(varSchedResult, "")
```

### Datasets (`Items`)

The control sends `SET_FILTER` with a period two weeks wider than the screen, so these filters follow it.

| Property | Formula |
|---|---|
| `schedules` | `Filter('Schedule - PBS Hub', Date >= DateAdd(varSchedStart, -1, TimeUnit.Days) && Date <= DateAdd(varSchedEnd, 1, TimeUnit.Days))` |
| `brands` | `ShowColumns('Brand - PBS Hub', ID, Title, NamaBrand, Status)` (add `BrandID` if the list has it) |
| `accounts` | `'Account - PBS Hub'` |
| `studios` | `'Studio - PBS Hub'` |
| `hosts` | `ShowColumns('Host - PBS Hub', ID, Title, NamaHost, HostName, Status)` (add `HostID` if the list has it) |
| `reports` | `Filter('Report - PBS Hub', LiveDate >= varSchedStart && LiveDate <= varSchedEnd)` |
| `absences` | `Filter('Host Absence - PBS Hub', LiveDate >= varSchedStart && LiveDate <= varSchedEnd)` |
| `clockins` | `ShowColumns(Filter('Clock In - PBS Hub', ClockInDate >= varSchedStart && ClockInDate <= varSchedEnd), Title, HostID, ClockInDate, CheckInTime, CheckOutTime, ClockInTime, ClockOutTime, IsInsideGeofence, CheckInOffice, Status)` |
| `evidence` | `Filter('Report Automation - PBS Hub', LiveDate >= varSchedStart && LiveDate <= varSchedEnd)` |

Fields to add: `LiveBreak`, `Position` on `schedules`; `Attachment`, `ApprovalStatus`, `Match`, `ApprovalComment`
and every metric column (Penjualan, Pesanan, TotalViewer, durasi, Avg View Duration, Likes…) on `reports` and `evidence`.

### Filtered tables used by `OnChange`

`scheduleFiltered`, `reportFiltered`, `automationFiltered` (keep this one **without** a date filter, so
`LOAD_EVIDENCE` finds rows whose LiveDate is blank or outside the period), plus your `varSiteID` / `varDriveID`
for the Graph upload. See SETUP C4.

### Other inputs

| Property | Value |
|---|---|
| `View` | `"Board"` |
| `Mode` | `If(userRole.Value = "PBS_Team", "Admin", "ReadOnly")` |
| `ActionResult` | `varSchedResult` |
| `SelectedScheduleId` | blank |
| `Context` | below |

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

### OnChange

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
            // Every schedule can be deleted (the control warns when a host report exists; the report stays).
            IfError(Remove('Schedule - PBS Hub', LookUp(scheduleFiltered, Title = Text(p.scheduleId)));
                    Refresh('Schedule - PBS Hub'); true,
                Set(varSchedOk, false); Set(varSchedErr, FirstError.Message)),

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

        // List view: tick sessions, then Hapus. Sessions with a report can be deleted too (the report stays).
        "BULK_DELETE_SCHEDULE",
            IfError(
                ForAll(Table(p.scheduleIds) As x,
                    Remove('Schedule - PBS Hub', LookUp(scheduleFiltered, Title = Text(x.Value))));
                Set(varSchedMsg, CountRows(Table(p.scheduleIds)) & " jadwal dihapus.");
                Refresh('Schedule - PBS Hub'); true,
                Set(varSchedOk, false); Set(varSchedErr, FirstError.Message)),

        "LOAD_EVIDENCE",
            // The session detail asks for this when a report has no Report Automation row in `evidence`
            // (its LiveDate is blank or outside the loaded period). Title = is delegable. Replies itself.
            // Whole rows are sent, so every metric column shows up in Report host vs AI.
            Set(varSchedResult, JSON({
                requestId: rid, status: "ok", message: "",
                data: { rows: Filter(automationFiltered, Title = Text(p.reportId)) } },
                JSONFormat.Compact & JSONFormat.IgnoreUnsupportedTypes & JSONFormat.IgnoreBinaryData)),

        "REFRESH",
            // "Muat ulang" button: reload every list the control is bound to.
            Refresh('Schedule - PBS Hub'); Refresh('Report - PBS Hub'); Refresh('Report Automation - PBS Hub'),

        // Only sent with View = "Detail" (C4d): Kembali, or after the session was deleted.
        "NAV_BACK", Back(),

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
                        ForAll(Filter(automationFiltered, Title = Text(p.reportId)) As ra,
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

---

## 3. Schedule Detail screen (`scrScheduleDetail`, `View = "Detail"`)

A second **PBS Schedule Hub** control that shows one session. Link to it from any screen:

```powerfx
Set(varLinkScheduleId, ThisItem.ScheduleID);   // e.g. "SCD-447"
Navigate(scrScheduleDetail)
```

### Screen.OnVisible

```powerfx
Set(varSchedResult, "");
Set(varDetailDate, LookUp('Schedule - PBS Hub', Title = varLinkScheduleId).Date)
```

### Datasets (`Items`)

The session's day ± 1 day, so the conflict check and the evidence chain have what they need.

| Property | Formula |
|---|---|
| `schedules` | `Filter('Schedule - PBS Hub', Date >= DateAdd(varDetailDate, -1, TimeUnit.Days) && Date <= DateAdd(varDetailDate, 1, TimeUnit.Days))` |
| `reports` | `Filter('Report - PBS Hub', LiveDate >= DateAdd(varDetailDate, -1, TimeUnit.Days) && LiveDate <= DateAdd(varDetailDate, 1, TimeUnit.Days))` |
| `absences` | `Filter('Host Absence - PBS Hub', LiveDate >= DateAdd(varDetailDate, -1, TimeUnit.Days) && LiveDate <= DateAdd(varDetailDate, 1, TimeUnit.Days))` |
| `clockins` | `ShowColumns(Filter('Clock In - PBS Hub', ClockInDate >= DateAdd(varDetailDate, -1, TimeUnit.Days) && ClockInDate <= DateAdd(varDetailDate, 1, TimeUnit.Days)), Title, HostID, ClockInDate, CheckInTime, CheckOutTime, ClockInTime, ClockOutTime, IsInsideGeofence, CheckInOffice, Status)` |
| `evidence` | `Filter('Report Automation - PBS Hub', LiveDate >= DateAdd(varDetailDate, -1, TimeUnit.Days) && LiveDate <= DateAdd(varDetailDate, 1, TimeUnit.Days))` |
| `brands`, `accounts`, `studios`, `hosts` | same as the Schedule screen |

### Other inputs

| Property | Value |
|---|---|
| `View` | `"Detail"` |
| `SelectedScheduleId` | `varLinkScheduleId` |
| `Context`, `Mode`, `ActionResult` | same as the Schedule screen |

### OnChange

The Schedule screen's formula with three differences: the session is looked up in the list itself (the
board's `scheduleFiltered` / `reportFiltered` may not hold a session outside the board's period),
`EDIT_SCHEDULE` moves `varDetailDate` along, and `NAV_BACK` (Kembali, or after a delete) runs `Back()`.

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
                Set(varSchedId, Text(p.scheduleId));
                Set(varDetailDate, DateValue(Text(p.date))),   // keep the session in view after a date change
                Set(varSchedOk, false); Set(varSchedErr, FirstError.Message)),

        "DELETE_SCHEDULE",
            // Every schedule can be deleted (the control warns when a host report exists; the report stays).
            IfError(Remove('Schedule - PBS Hub', LookUp('Schedule - PBS Hub', Title = Text(p.scheduleId)));
                    Refresh('Schedule - PBS Hub'); true,
                Set(varSchedOk, false); Set(varSchedErr, FirstError.Message)),

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

        // List view: tick sessions, then Hapus. Sessions with a report can be deleted too (the report stays).
        "BULK_DELETE_SCHEDULE",
            IfError(
                ForAll(Table(p.scheduleIds) As x,
                    Remove('Schedule - PBS Hub', LookUp('Schedule - PBS Hub', Title = Text(x.Value))));
                Set(varSchedMsg, CountRows(Table(p.scheduleIds)) & " jadwal dihapus.");
                Refresh('Schedule - PBS Hub'); true,
                Set(varSchedOk, false); Set(varSchedErr, FirstError.Message)),

        "LOAD_EVIDENCE",
            // The session detail asks for this when a report has no Report Automation row in `evidence`
            // (its LiveDate is blank or outside the loaded period). Title = is delegable. Replies itself.
            // Whole rows are sent, so every metric column shows up in Report host vs AI.
            Set(varSchedResult, JSON({
                requestId: rid, status: "ok", message: "",
                data: { rows: Filter(automationFiltered, Title = Text(p.reportId)) } },
                JSONFormat.Compact & JSONFormat.IgnoreUnsupportedTypes & JSONFormat.IgnoreBinaryData)),

        "REFRESH",
            // "Muat ulang" button: reload every list the control is bound to.
            Refresh('Schedule - PBS Hub'); Refresh('Report - PBS Hub'); Refresh('Report Automation - PBS Hub'),

        // Only sent with View = "Detail" (C4d): Kembali, or after the session was deleted.
        "NAV_BACK", Back(),

        // Judgement on a host report after comparing it with Report Automation (Title = Report.Title).
        // revision: Report → Need Revision + Unmatch + comment + approver; Report Automation → Status Unmatch.
        // approve:  Report → Done + Match (+ comment if given) + approver.
        "REVIEW_REPORT",
            IfError(
                With({ rep: LookUp('Report - PBS Hub', Title = Text(p.reportId)), revise: Text(p.decision) = "revision" },
                    Patch('Report - PBS Hub', rep, {
                        ApprovalStatus: { Value: If(revise, "Need Revision", "Done") },
                        Match: { Value: If(revise, "Unmatch", "Match") },
                        ApprovalComment: If(IsBlank(Text(p.comment)), rep.ApprovalComment, Text(p.comment)),
                        ApproverEmail: User().Email });
                    If(revise,
                        ForAll(Filter(automationFiltered, Title = Text(p.reportId)) As ra,
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
