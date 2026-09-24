# Integrasi canvas — PBS Hub Host PCF

Solusi terpisah dari Ops Console: **`PBSHubHostPCF`** (managed, `dist/PBSHubHostPCF_1_0_1_0_managed.zip`).
Publisher dan prefix sama (`PBSHub` / `pbs`), jadi kedua solusi bisa dipasang berdampingan di environment yang
sama, tapi bisa di-upgrade sendiri-sendiri.

| Control | Layar desain (PBS Host App) | Fungsi |
|---|---|---|
| `pbs_Host.HostDashboard` | *Hari ini* | Sapaan, kartu shift (clock in / clock out), to-do (revisi, report belum dikirim, absen), jadwal hari ini, skor. |
| `pbs_Host.MyReports` | *Report saya* | Report sebulan + sesi yang belum dilaporkan, filter status, pilih bulan. |
| `pbs_Host.MyReportDetail` | *Kirim report*, *Revisi*, *Detail report* | Satu control, tiga mode: form submit (metrik + screenshot), layar revisi (angka yang ditandai, perbaiki / sanggah), tampilan read-only. |

Aturan kontrak sama dengan Ops (lihat [`CANVAS-INTEGRATION.md` §1](CANVAS-INTEGRATION.md#1-aturan-kontrak-berlaku-untuk-semua-control)):
control **tidak pernah menulis ke SharePoint**, tombol mengirim `ActionPayload`, canvas menulis di `OnChange`
dan membalas lewat `ActionResult` dengan `requestId` yang sama. Aksi yang **mengunci** (wajib dibalas):
`ABSEN`, `SUBMIT_REPORT`, `RESUBMIT_REPORT`, `DISPUTE_REVIEW`. Sisanya navigasi, tidak perlu dibalas.

Control hanya merender isi layar. Header, sidebar/tab bar, dan layar clock in (GPS + selfie) tetap milik app.

## 1. Context

Sama dengan Ops, dengan config khusus host:

```powerfx
Set(varHostCtx, JSON({
    userEmail: User().Email,
    userName: User().FullName,
    roles: "HOST",
    permissions: "",
    config: {
        requireAbsen: true,        // false kalau tenant tidak memakai Host Absence: clock in saja membuka report
        absenLeadMin: 30,          // absen bisa dari 30 menit sebelum sesi mulai
        reportDeadlineDays: 2,     // report "Terlambat" setelah H+2 (sama dengan missingReportDays di Ops)
        maxShiftHours: 12,         // shift terbuka lebih lama dari ini diberi peringatan "lupa clock out"
        tolerancePct: 5,           // PBS0005A ±5 % (layar revisi)
        imageMaxPx: 2000,          // sisi terpanjang screenshot setelah dikompres
        imageMaxKb: 1200,          // batas ukuran JPEG yang dikirim ke flow
        pageSize: 20
    }
}, JSONFormat.Compact));
Set(varMe, LookUp('Host - PBS Hub', Email.Email = User().Email));
```

**Hanya baris milik host yang dikirim** (filter `HostID = varMe.Title` di canvas). Jangan kirim `KTP`,
`NoRekening`, `Alamat`, `PhoneNumber` di `HostJson` — control tidak memakainya.

## 2. Data

| Properti | List | Field (bentuk lewat `ForAll`) |
|---|---|---|
| `HostJson` | `Host - PBS Hub` | `Title, HostCode, NamaHost, Package, CurrentScore, InitialScore` |
| `SchedulesJson` / `ScheduleJson` | `Schedule - PBS Hub` | `ID, Title, Date (yyyy-mm-dd), StartTime, EndTime, BrandID, StudioID, HostID, Platform, AccountID, Account, Status` |
| `ClockInJson` | `Clock In - PBS Hub` | `ID, ClockInDate, CheckInTime, CheckOutTime, ClockInTime, ClockOutTime, CheckInOffice` |
| `AbsenceJson` | `Host Absence - PBS Hub` | `Title, ScheduleID, LiveDate, Status, Created` |
| `ReportsJson` / `ReportJson` / `HistoryJson` | `Report - PBS Hub` | sama dengan Ops (`ID, Title, ScheduleID, HostID, BrandID, AccountID, Account, Platform, LiveDate`, 12 metrik, `ApprovalStatus, Match, ApprovalComment, Approver, ApproverEmail, Attachment, Created, Modified`) |
| `EvidenceJson` | `Report Automation - PBS Hub` | sama dengan Ops |
| `ScoreTxJson` / `ThresholdsJson` | `[FAS STUDIO] HostScoreTransactions` / `HostScoreThreshold` | sama dengan HostDetail |
| `BrandsJson` / `StudiosJson` | `Brand` / `Studio - PBS Hub` | `Title, NamaBrand` / `Title, NamaStudio` |

Status sesi yang dilihat host dihitung dari data di atas (aturan v1 tetap):

| Fase | Syarat |
|---|---|
| Belum mulai | lebih dari `absenLeadMin` sebelum `StartTime` |
| Sedang live / Clock in dulu / Absen | sesi berjalan; tombol **Absen** muncul kalau sudah clock in hari itu dan belum ada baris Host Absence |
| Perlu clock in | sesi lewat tanpa Clock In di hari itu → host diarahkan minta **clock in manual** ke tim PBS (fitur HostList / HostDetail) |
| Perlu absen | sudah clock in tapi tidak ada Host Absence untuk `ScheduleID` |
| Belum dikirim / Terlambat | clock in + absen ada, belum ada Report; *Terlambat* setelah H+`reportDeadlineDays` |
| Menunggu review / Perlu revisi / Selesai / Otomatis disetujui | dari `Report.ApprovalStatus` + `ApprovalComment` (sama dengan Ops) |

Angka yang ditandai reviewer dibaca dari baris `Metrik yang perlu dibetulkan: …` di `ApprovalComment` yang
ditulis ReportDetail (Ops). Kalau baris itu tidak ada, control memakai metrik yang di luar toleransi.

## 3. HostDashboard (layar *Hari ini*)

```powerfx
// Screen.OnVisible
Set(varHdLoading, true);
ClearCollect(colMySch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date >= Today() - 7, Date <= Today() + 7));
ClearCollect(colMyClk, Filter('Clock In - PBS Hub', HostID = varMe.Title, ClockInDate >= Today() - 14));
ClearCollect(colMyAbs, Filter('Host Absence - PBS Hub', HostID = varMe.Title, LiveDate >= Today() - 14));
ClearCollect(colMyRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate >= Today() - 30));
Set(varHdLoading, false);
```

| Properti | Nilai |
|---|---|
| `Context` | `varHostCtx` |
| `HostJson` | `JSON(ForAll(Filter('Host - PBS Hub', Title = varMe.Title), {Title: Title, HostCode: HostCode, NamaHost: NamaHost, Package: Package.Value, CurrentScore: CurrentScore, InitialScore: InitialScore}), JSONFormat.Compact)` |
| `SchedulesJson` | `JSON(ForAll(colMySch, {ID: ID, Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime, BrandID: BrandID, StudioID: StudioID, HostID: HostID, Platform: Platform.Value, AccountID: AccountID, Account: Account, Status: Status.Value}), JSONFormat.Compact)` |
| `ClockInJson` | `JSON(ForAll(colMyClk, {ID: ID, ClockInDate: Text(ClockInDate, "yyyy-mm-dd"), CheckInTime: CheckInTime, CheckOutTime: CheckOutTime, CheckInOffice: CheckInOffice}), JSONFormat.Compact)` |
| `AbsenceJson` | `JSON(ForAll(colMyAbs, {Title: Title, ScheduleID: ScheduleID, LiveDate: Text(LiveDate, "yyyy-mm-dd"), Status: Status.Value, Created: Created}), JSONFormat.Compact)` |
| `ReportsJson` | `JSON(ForAll(colMyRep, {…field Report…}), JSONFormat.Compact)` |
| `ScoreTxJson`, `ThresholdsJson`, `BrandsJson`, `StudiosJson` | seperti HostDetail |
| `IsLoading` | `varHdLoading` |
| `ActionResult` | `varHdResult` |

Aksi:

| Aksi | Payload | Canvas |
|---|---|---|
| `CLOCK_IN` | `{}` | `Navigate(scrClockIn)` — layar GeoAttendance yang sudah ada (GPS + geofence tetap di sana) |
| `CLOCK_OUT` | `{clockInId}` | `Navigate(scrClockIn)` (atau langsung patch `CheckOutTime` kalau layar itu tidak dipakai untuk clock out) |
| `ABSEN` 🔒 | `{scheduleId, scheduleItemId, hostId, hostName, liveDate, brandId, studioId, platform, account}` | Patch Host Absence (di bawah) |
| `NEW_REPORT` | `{scheduleId, scheduleItemId, liveDate}` | `Set(varRptSchedule, Text(p.scheduleId)); Set(varRptId, Blank()); Navigate(scrMyReportDetail)` |
| `OPEN_REPORT` | `{reportId, title, scheduleId}` | `Set(varRptId, Value(p.reportId)); Set(varRptSchedule, Text(p.scheduleId)); Navigate(scrMyReportDetail)` |
| `NAV` | `{target: "SCHEDULE" \| "REPORTS" \| "SCORE"}` | `Switch(Text(p.target), "REPORTS", Navigate(scrMyReports), "SCHEDULE", Navigate(scrMySchedule), "SCORE", Navigate(scrMyScore))` |
| `RELOAD` | `{}` | ulangi OnVisible |

**ABSEN** (dipakai HostDashboard dan MyReportDetail):

```powerfx
"ABSEN",
    If(CountRows(Filter('Host Absence - PBS Hub', ScheduleID = Text(p.scheduleId), HostID = Text(p.hostId))) > 0,
        Set(varHdResult, JSON({requestId: rid, status: "conflict", message: "Absen sesi ini sudah tercatat."}, JSONFormat.Compact)),
        IfError(
            With({s: LookUp('Schedule - PBS Hub', Title = Text(p.scheduleId))},
                With({row: Patch('Host Absence - PBS Hub', Defaults('Host Absence - PBS Hub'), {
                        ScheduleID: s.Title, HostID: s.HostID, HostName: Text(p.hostName), LiveDate: s.Date,
                        BrandID: s.BrandID, Platform: s.Platform, Account: s.Account
                        // Status: {Value: "Present"}  ← isi dengan nilai Choice yang dipakai v1
                    })},
                    Patch('Host Absence - PBS Hub', row, {Title: "ABS-" & row.ID});
                    Collect(colMyAbs, LookUp('Host Absence - PBS Hub', ID = row.ID))
                )
            );
            Set(varHdResult, JSON({requestId: rid, status: "ok", message: "Absen tercatat untuk " & Text(p.scheduleId) & "."}, JSONFormat.Compact)),
            Set(varHdResult, JSON({requestId: rid, status: "error", message: FirstError.Message}, JSONFormat.Compact))
        )
    ),
```

Kerangka `OnChange` sama dengan Ops: `ParseJSON(Self.ActionPayload)` → cek `rid in colPbsProcessed.Id` →
`Collect(colPbsProcessed, {Id: rid})` → `Switch(act, …)`. Di MyReportDetail ganti `varHdResult` dengan
`varMrdResult`.

## 4. MyReports (layar *Report saya*)

```powerfx
// Screen.OnVisible  (varMrPeriod = "yyyy-mm", kosong = bulan ini)
Set(varMrLoading, true);
With({from: If(IsBlank(varMrPeriod), Date(Year(Today()), Month(Today()), 1), DateValue(varMrPeriod & "-01"))},
    ClearCollect(colMrRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate >= from, LiveDate < DateAdd(from, 1, TimeUnit.Months)));
    ClearCollect(colMrSch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date >= from, Date < DateAdd(from, 1, TimeUnit.Months)));
    ClearCollect(colMrClk, Filter('Clock In - PBS Hub', HostID = varMe.Title, ClockInDate >= from, ClockInDate < DateAdd(from, 1, TimeUnit.Months)));
    ClearCollect(colMrAbs, Filter('Host Absence - PBS Hub', HostID = varMe.Title, LiveDate >= from, LiveDate < DateAdd(from, 1, TimeUnit.Months)))
);
Set(varMrLoading, false);
```

| Properti | Nilai |
|---|---|
| `Period` | `varMrPeriod` |
| `DefaultFilter` | `varMrFilter` (`All`, `Unsent`, `Revision`, `Waiting`, `Done`, `Auto`) — mis. dari to-do dashboard |
| `ReportsJson`, `SchedulesJson`, `ClockInJson`, `AbsenceJson`, `BrandsJson` | seperti HostDashboard, dari koleksi `colMr…` |
| `HasMore` | `false` (report per bulan per host kecil; pakai `LOAD_MORE` kalau dibatasi delegasi) |
| `IsLoading` | `varMrLoading` |

| Aksi | Canvas |
|---|---|
| `PERIOD_CHANGED` `{period}` | `Set(varMrPeriod, Text(p.period))` lalu ulangi OnVisible |
| `FILTER_CHANGED` `{filter, period}` | opsional: `Set(varMrFilter, Text(p.filter))` |
| `OPEN_REPORT`, `NEW_REPORT` | sama dengan HostDashboard |
| `LOAD_MORE` `{period, loaded}` | muat halaman berikut kalau `HasMore` dipakai |

Sesi *Belum dikirim* muncul di daftar ini walau belum punya baris Report, supaya host tidak lupa.

## 5. MyReportDetail (kirim / revisi / lihat)

Mode dipilih dari data: `ReportJson` kosong → **form submit** untuk `ScheduleJson`; report `Need Revision`
→ **layar revisi**; selain itu → **read-only**.

```powerfx
// Screen.OnVisible
Set(varMrdLoading, true);
With({rep: If(IsBlank(varRptId), Blank(), LookUp('Report - PBS Hub', ID = varRptId && HostID = varMe.Title))},
    Set(varMrdRep, rep);
    Set(varMrdSch, LookUp('Schedule - PBS Hub', Title = Coalesce(rep.ScheduleID, varRptSchedule) && HostID = varMe.Title))
);
ClearCollect(colMrdClk, Filter('Clock In - PBS Hub', HostID = varMe.Title, ClockInDate = varMrdSch.Date));
ClearCollect(colMrdAbs, Filter('Host Absence - PBS Hub', HostID = varMe.Title, ScheduleID = varMrdSch.Title));
ClearCollect(colMrdEvi, Filter('Report Automation - PBS Hub', Title = varMrdRep.Title));
// Rata-rata host sendiri untuk peringatan "jauh di atas rata-rata kamu" (tidak memblokir):
ClearCollect(colMrdHist, FirstN(SortByColumns(Filter('Report - PBS Hub', HostID = varMe.Title, Platform.Value = varMrdSch.Platform.Value), "Created", SortOrder.Descending), 10));
Set(varMrdLoading, false);
```

| Properti | Nilai |
|---|---|
| `HostJson` | `{Title, NamaHost}` host sendiri |
| `ReportJson` | `If(IsBlank(varMrdRep), "[]", JSON(ForAll(Table(varMrdRep), {…field Report…}), JSONFormat.Compact))` |
| `ScheduleJson` | `JSON(ForAll(Table(varMrdSch), {…field Schedule…}), JSONFormat.Compact)` |
| `EvidenceJson`, `ClockInJson`, `AbsenceJson`, `HistoryJson` | dari `colMrdEvi`, `colMrdClk`, `colMrdAbs`, `colMrdHist` |
| `IsLoading` / `ActionResult` | `varMrdLoading` / `varMrdResult` |

### Screenshot: `UploadData`

Host hanya memilih gambar. Control mengecilkannya jadi JPEG (sisi terpanjang `imageMaxPx`, ukuran ≤ `imageMaxKb`)
dan mengirim base64-nya lewat **output kedua `UploadData`**, bukan di `ActionPayload` (tetap kecil). Nama file
disusun control: `ReportID_Platform_AccountID.jpg` — defect O1 v1 (host harus menamai file sendiri) hilang.
Untuk report baru ID belum ada, jadi `file.name` berisi `RPT-{ID}_…`; canvas mengganti `{ID}` setelah baris
Report dibuat.

Buat flow **PBS Host – Upload report screenshot** (trigger *Power Apps (V2)*):

| Input | Tipe |
|---|---|
| `fileName` | Text |
| `fileBase64` | Text |

Nama flow di app mengikuti nama flow (contoh di bawah: `'PBSHost-Uploadreportscreenshot'`).
Langkah: **SharePoint → Create file** — Site `StudioTeamBlibli`, Folder `/PBS Power Apps/Report Automation`,
File name `fileName`, File content `base64ToBinary(triggerBody()?['text_1'])`. **Respond to a PowerApp** dengan
`url` = `Path` hasil Create file (atau link absolut). Flow AI yang sudah ada membaca folder itu seperti biasa.

### SUBMIT_REPORT 🔒

Payload: `{scheduleId, scheduleItemId, hostId, hostName, brandId, studioId, platform, account, liveDate, absId,
metrics: {Penjualan, Pesanan, ProdukTerjual, JumlahPembeli, CTR, CTOR, PeakViewer, 'Durasi(Min)', AddToCart,
TotalViewer, Comment, Share}, file: {name, ext, contentType, bytes, width, height}, warnings: [..]}`.
Metrik yang kosong bernilai `null`.

```powerfx
"SUBMIT_REPORT",
    If(!IsBlank(LookUp('Report - PBS Hub', ScheduleID = Text(p.scheduleId) && HostID = varMe.Title)),
        Set(varMrdResult, JSON({requestId: rid, status: "conflict", message: "Report untuk sesi ini sudah ada."}, JSONFormat.Compact)),
    // hapus cabang ini kalau config.requireAbsen = false
    IsBlank(LookUp('Host Absence - PBS Hub', ScheduleID = Text(p.scheduleId) && HostID = varMe.Title)),
        Set(varMrdResult, JSON({requestId: rid, status: "error", message: "Absen sesi ini belum tercatat."}, JSONFormat.Compact)),
        IfError(
            With({m: p.metrics, s: varMrdSch, data: Self.UploadData},
                With({row: Patch('Report - PBS Hub', Defaults('Report - PBS Hub'), {
                        ScheduleID: s.Title, HostID: varMe.Title, BrandID: s.BrandID, Platform: s.Platform,
                        AccountID: s.AccountID, Account: s.Account, LiveDate: s.Date, AbsID: Text(p.absId),
                        Penjualan: Value(m.Penjualan), Pesanan: Value(m.Pesanan), ProdukTerjual: Value(m.ProdukTerjual),
                        JumlahPembeli: Value(m.JumlahPembeli), CTR: Value(m.CTR), CTOR: Value(m.CTOR), PeakViewer: Value(m.PeakViewer),
                        'Durasi(Min)': Value(m.'Durasi(Min)'), AddToCart: Value(m.AddToCart), TotalViewer: Value(m.TotalViewer),
                        Comment: Value(m.Comment), Share: Value(m.Share),
                        ApprovalStatus: {Value: "Waiting Approval"}
                    })},
                    With({title: "RPT-" & row.ID},
                        With({up: 'PBSHost-Uploadreportscreenshot'.Run(Substitute(Text(p.file.name), "RPT-{ID}", title), data)},
                            Patch('Report - PBS Hub', row, {Title: title, Attachment: up.url})
                        );
                        Set(varRptId, row.ID);
                        Set(varMrdRep, LookUp('Report - PBS Hub', ID = row.ID));
                        Set(varMrdResult, JSON({requestId: rid, status: "ok", message: "Report " & title & " terkirim."}, JSONFormat.Compact))
                    )
                )
            ),
            Set(varMrdResult, JSON({requestId: rid, status: "error", message: FirstError.Message}, JSONFormat.Compact))
        )
    ),
```

`Self.UploadData` dibaca di `OnChange` yang sama dengan `ActionPayload` — control mengisi keduanya sekaligus dan
mengosongkan `UploadData` pada aksi berikutnya. Kalau upload gagal, baris Report sudah ada tapi `Attachment`
kosong: Ops Console menampilkannya sebagai *Tanpa bukti*, host bisa mengganti screenshot lewat revisi.

### RESUBMIT_REPORT 🔒

Payload: `{reportId, title, scheduleId, expectedModified, metrics, changed: ["Penjualan","CTOR"], flagged: [..],
note, file: {…} | null}`. Tombol *Kirim revisi* baru aktif kalau ada angka yang berubah **atau** screenshot baru.

```powerfx
"RESUBMIT_REPORT",
    With({cur: LookUp('Report - PBS Hub', ID = Value(p.reportId) && HostID = varMe.Title), m: p.metrics},
        If(cur.ApprovalStatus.Value <> "Need Revision" || Text(cur.Modified, "yyyy-mm-ddThh:mm:ss") <> Left(Text(p.expectedModified), 19),
            Set(varMrdResult, JSON({requestId: rid, status: "conflict", message: "Report ini sudah berubah. Muat ulang dulu."}, JSONFormat.Compact)),
            IfError(
                Patch('Report - PBS Hub', cur, {
                    Penjualan: Value(m.Penjualan), Pesanan: Value(m.Pesanan), ProdukTerjual: Value(m.ProdukTerjual),
                    JumlahPembeli: Value(m.JumlahPembeli), CTR: Value(m.CTR), CTOR: Value(m.CTOR), PeakViewer: Value(m.PeakViewer),
                    'Durasi(Min)': Value(m.'Durasi(Min)'), AddToCart: Value(m.AddToCart), TotalViewer: Value(m.TotalViewer),
                    Comment: Value(m.Comment), Share: Value(m.Share),
                    ApprovalStatus: {Value: "Waiting Approval"},
                    ApprovalComment: cur.ApprovalComment & Char(10) & "[Revisi host] " & Coalesce(Text(p.note), "angka diperbaiki: " & Concat(Table(p.changed), Text(ThisRecord.Value), ", "))
                });
                If(!IsBlank(p.file),
                    With({up: 'PBSHost-Uploadreportscreenshot'.Run(Text(p.file.name), Self.UploadData)},
                        Patch('Report - PBS Hub', LookUp('Report - PBS Hub', ID = cur.ID), {Attachment: up.url}))
                );
                Set(varMrdRep, LookUp('Report - PBS Hub', ID = cur.ID));
                Set(varMrdResult, JSON({requestId: rid, status: "ok", message: "Revisi terkirim, menunggu review ulang."}, JSONFormat.Compact)),
                Set(varMrdResult, JSON({requestId: rid, status: "error", message: FirstError.Message}, JSONFormat.Compact))
            )
        )
    ),
```

Screenshot baru ditulis dengan nama yang sama (`Title_Platform_AccountID.jpg`) sehingga flow AI membaca ulang
bukti untuk report itu.

### DISPUTE_REVIEW 🔒

*"Saya rasa angka saya benar"* — host tidak mengubah angka, tapi memberi alasan (min. 10 karakter).
Payload: `{reportId, title, expectedModified, reason}`. Status tetap `Need Revision`; reviewer melihat
sanggahan di ApprovalComment.

```powerfx
"DISPUTE_REVIEW",
    IfError(
        With({cur: LookUp('Report - PBS Hub', ID = Value(p.reportId) && HostID = varMe.Title)},
            Patch('Report - PBS Hub', cur, {ApprovalComment: cur.ApprovalComment & Char(10) & "[Sanggahan host] " & Text(p.reason)});
            Set(varMrdRep, LookUp('Report - PBS Hub', ID = cur.ID))
        );
        // opsional: kirim email ke cur.ApproverEmail
        Set(varMrdResult, JSON({requestId: rid, status: "ok", message: "Sanggahan terkirim ke reviewer."}, JSONFormat.Compact)),
        Set(varMrdResult, JSON({requestId: rid, status: "error", message: FirstError.Message}, JSONFormat.Compact))
    ),
```

### Aksi lain

| Aksi | Canvas |
|---|---|
| `ABSEN` 🔒 | sama dengan HostDashboard (balas ke `varMrdResult`, lalu `ClearCollect(colMrdAbs, …)`) |
| `OPEN_EVIDENCE` `{url, reportId, title}` | `Launch(Text(p.url))` |
| `BACK` | `Back()` |

### Draft

*Simpan draft* (dan autosave setiap 0,8 detik) menyimpan **angka saja** di perangkat host (`localStorage`,
kunci `pbs-host-draft:{HostID}:{ScheduleID}`). Tidak ada status baru di list Report. Screenshot tidak ikut
draft (terlalu besar); host memilihnya lagi saat submit. Draft dihapus setelah submit berhasil.

## 6. Pemasangan

1. Import `dist/PBSHubHostPCF_1_0_1_0_managed.zip` (Solutions → Import). Bisa di environment yang sama dengan
   `PBSHubOpsPCF`.
2. Di canvas app host: **Insert → Get more components → Code** → `PBS Host Dashboard`, `PBS Host My Reports`,
   `PBS Host My Report Detail`.
3. Buat flow *PBS Host – Upload report screenshot* (bagian 5) dan tambahkan ke app (**Power Automate** pane).
4. Satu control per layar, ukuran = area konten. Layout menyesuaikan lebar sendiri (container query): di HP
   (≤ 560 px) kolom tunggal, di tablet/desktop kolom tengah 720 px.

Update: naikkan `version` di `ControlManifest.Input.xml` yang berubah **dan** `Version` di
`solution/PBSHubHostPCF/src/Other/Solution.xml`, lalu `npm run release` (membangun kedua solusi; hanya satu:
`SOLUTIONS=PBSHubHostPCF ./scripts/package-solution.sh`).
