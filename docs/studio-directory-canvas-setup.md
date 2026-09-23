# pbs_Ops.StudioDirectory — canvas app setup

The control renders the **Studio list (SD-1)** and **Studio detail (SD-2)** screens. It reads the SharePoint
lists described in `DESIGN.md` and **never writes**: it emits an `ActionPayload`, the canvas app does the
`Patch`, and replies through `ActionResult` with the same `requestId`.

## 1. Import

1. Power Apps → **Solutions → Import** → `releases/PBSStudioDirectory_managed_1.1.1.zip` (managed).
2. Canvas app → **Settings → Updates** → turn on **Power Apps component framework for canvas apps**.
3. **Insert → Get more components → Code** → `PBS Studio Directory` (`pbs_Ops.StudioDirectory`).
4. Give it the full screen next to `BlibliUniversalSidebar`. Minimum width 1040 px.

## 2. Period variables

Utilization and GMV are computed over the schedules and reports you bind. Load the previous month
as well: the month-over-month delta needs it.

```powerfx
// Screen.OnVisible
Set(varPeriodStart, Date(Year(Today()), Month(Today()) - 1, 1));
Set(varPeriodEnd,   DateAdd(Date(Year(Today()), Month(Today()) + 1, 1), -1, TimeUnit.Days));
Set(varStudioResult, "");
```

## 3. Bind the datasets (`Items`)

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

**JSON fallback.** If you prefer, leave a dataset empty and fill the matching `*Json` property instead, e.g.
`SchedulesJson = JSON(ShowColumns(Filter('Schedule - PBS Hub', …), Title, Date, StudioID, BrandID, HostID, StartTime, EndTime, JamLive, Status, Platform, Account, Shift), JSONFormat.IgnoreBinaryData)`.
A non-empty `*Json` value wins over its dataset.

## 4. Other inputs

| Property | Value |
|---|---|
| `Context` | `JSON({ userEmail: User().Email, userName: User().FullName, roles: Concat(colUserRoles, RoleCode, ","), permissions: Concat(colUserPermissions, PermissionCode, ","), config: { maxAccuracyMeters: 100 } }, JSONFormat.Compact)` |
| `Mode` | `If(userRole.Value = "PBS_Team", "Admin", "ReadOnly")` |
| `ActionResult` | `varStudioResult` |
| `OperatingHourStart` / `OperatingHourEnd` | `8` / `22` — the utilization denominator |
| `SelectedStudioId` | blank for the list, or a StudioID to deep-link. Read it back to know which studio is open |

If `Context.permissions` is non-empty, edit actions need `STUDIO_EDIT`. If it is empty, `Mode` decides.

## 5. Handle actions (`OnChange`)

```powerfx
With({ req: ParseJSON(Self.ActionPayload) },
With({ action: Text(req.action), rid: Text(req.requestId), p: req.payload },
If(rid <> varLastStudioRid,
    Set(varLastStudioRid, rid);   // never process the same request twice
    Set(varOk, true); Set(varErr, ""); Set(varData, "{}");
    Switch(action,
        "SET_FILTER",
            Set(varPeriodStart, DateValue(Text(p.periodStart)));
            Set(varPeriodEnd, DateValue(Text(p.periodEnd))),

        "CREATE_STUDIO",
            If(!IsBlank(LookUp('Studio - PBS Hub', Title = Text(p.studioId))),
                Set(varOk, false); Set(varErr, "StudioID " & Text(p.studioId) & " sudah dipakai."),
                IfError(
                    Patch('Studio - PBS Hub', Defaults('Studio - PBS Hub'), {
                        Title: Text(p.studioId), NamaStudio: Text(p.namaStudio),
                        KapasitasHost: Value(p.kapasitasHost), LokasiStudio: Text(p.lokasiStudio),
                        Status: { Value: Text(p.status) } }),
                    Set(varOk, false); Set(varErr, FirstError.Message))),

        "EDIT_STUDIO",
            IfError(
                Patch('Studio - PBS Hub', LookUp('Studio - PBS Hub', Title = Text(p.studioId)), {
                    NamaStudio: Text(p.namaStudio), KapasitasHost: Value(p.kapasitasHost),
                    LokasiStudio: Text(p.lokasiStudio), Status: { Value: Text(p.status) } }),
                Set(varOk, false); Set(varErr, FirstError.Message)),

        "SET_GEOFENCE",
            IfError(
                If(IsBlank(p.locationItemId),
                    Patch('Studio Location - PBS', Defaults('Studio Location - PBS'), {
                        Title: Text(p.title), Latitude: Value(p.latitude), Longitude: Value(p.longitude),
                        RadiusMeter: Value(p.radiusMeter), IsActive: Boolean(p.isActive) }),
                    Patch('Studio Location - PBS', LookUp('Studio Location - PBS', ID = Value(p.locationItemId)), {
                        Latitude: Value(p.latitude), Longitude: Value(p.longitude),
                        RadiusMeter: Value(p.radiusMeter), IsActive: Boolean(p.isActive) })),
                Set(varOk, false); Set(varErr, FirstError.Message)),

        "TOGGLE_GEOFENCE_ACTIVE",
            IfError(
                Patch('Studio Location - PBS', LookUp('Studio Location - PBS', ID = Value(p.locationItemId)),
                    { IsActive: Boolean(p.isActive) }),
                Set(varOk, false); Set(varErr, FirstError.Message))
        // NAV_STUDIO_DETAIL is informational; SelectedStudioId already carries the open studio.
    );
    If(action in ["CREATE_STUDIO", "EDIT_STUDIO", "SET_GEOFENCE", "TOGGLE_GEOFENCE_ACTIVE"],
        Set(varStudioResult, JSON({
            requestId: rid,
            status: If(varOk, "ok", "error"),
            message: varErr,
            data: { studioId: Text(p.studioId) } }, JSONFormat.Compact)))
)))
```

The control stays locked until its own `requestId` comes back, and gives up after 30 seconds with a warning.

## 6. How the numbers are derived

| What | Source | Rule |
|---|---|---|
| **Utilization** | Schedule + Studio.KapasitasHost | scheduled host-hours ÷ (KapasitasHost × operating hours × days). Cancelled/Leave excluded; hours clipped to the operating window. Overall = active studios only. Daily and monthly, overall and per studio |
| **Sedang digunakan** | Schedule | sessions whose Date is today and StartTime ≤ now < EndTime (overnight sessions from yesterday included). Shows brand (via BrandID → Brand.NamaBrand), host(s) (HostID → Host.NamaHost), time left and slots used vs capacity |
| **Capacity per slot** | Schedule | distinct hosts per hour vs KapasitasHost; over-capacity slots are flagged (v1 never enforced capacity) |
| **GMV** | Report.Penjualan | Report has no StudioID, so it is joined `Report.ScheduleID → Schedule.Title → Schedule.StudioID`; several reports per session (one per account) are summed. Split into *Terverifikasi* (`ApprovalStatus = Done`), *Menunggu review* and *Perlu revisi*. Ended sessions without a report are counted as "Belum ada report" |
| **Geofence link** | Studio Location | v1 has no key between Studio and Studio Location. Match order: a `StudioID` column on the location → `Title = StudioID` → `Title = NamaStudio`. New geofences are created with `Title = NamaStudio` |

These are display metrics. Nothing that money depends on is computed in the control.
