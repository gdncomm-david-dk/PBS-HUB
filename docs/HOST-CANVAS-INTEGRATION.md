# Integrasi canvas — PBS Hub Host App

Solusi terpisah dari Ops Console: **`PBSHubHostApp`** (managed, `dist/PBSHubHostApp_1_0_0_0_managed.zip`), berisi
keenam control host dengan identifier baru `pbs_HostApp.*`. Solusi ini menggantikan `PBSHubHostPCF` +
`PBSHubHostSchedulePCF` (control lama `pbs_Host.*`). Karena nama solusi dan namespace control berbeda, solusi baru
bisa diimport berdampingan dengan yang lama tanpa bentrok. Publisher dan prefix tetap sama (`PBSHub` / `pbs`).

| Control | Layar desain (PBS Host App) | Fungsi |
|---|---|---|
| `pbs_HostApp.HostDashboard` | *Hari ini* | Sapaan, kartu shift (clock in / clock out), to-do (revisi, report belum dikirim, absen), jadwal hari ini, skor. |
| `pbs_HostApp.MyReports` | *Report saya* | Report sebulan + sesi yang belum dilaporkan, filter status, pilih bulan. |
| `pbs_HostApp.ClockIn` | *Clock in* (dibuka dari kartu shift *Hari ini*) | Clock in / clock out: GPS dicek terhadap radius `Studio Location - PBS`, selfie wajib saat in **dan** out, alasan wajib kalau di luar radius. Lihat bagian 9. |
| `pbs_HostApp.MyReportDetail` | *Kirim report*, *Revisi*, *Detail report* | Satu control, tiga mode: form submit (metrik + screenshot), layar revisi (angka yang ditandai, perbaiki / sanggah), tampilan read-only. |
| `pbs_HostApp.MySchedule` | *Jadwal saya* (5a) | Tabel **atau kalender bulan** (toggle Daftar / Kalender), 4 KPI, strip *Hari ini* dengan tombol clock in / absen / kirim report, filter platform + status + cari. |
| `pbs_HostApp.ScheduleDetail` | *Detail sesi* (dibuka dari 4b / 5a / Hari ini) | Langkah berikutnya, **absen dan kirim report (metrik + screenshot) atau revisi langsung di layar ini**, 4 langkah sesi, detail jadwal, sesi lain di hari yang sama. |

Aturan kontrak sama dengan Ops (lihat [`CANVAS-INTEGRATION.md` §1](CANVAS-INTEGRATION.md#1-aturan-kontrak-berlaku-untuk-semua-control)):
control **tidak pernah menulis ke SharePoint**, tombol mengirim `ActionPayload`, canvas menulis di `OnChange`
dan membalas lewat `ActionResult` dengan `requestId` yang sama. Aksi yang **mengunci** (wajib dibalas):
`ABSEN`, `SUBMIT_REPORT`, `RESUBMIT_REPORT`, `DISPUTE_REVIEW`, `CLOCK_IN`, `CLOCK_OUT` (ClockIn). Sisanya navigasi, tidak perlu dibalas.

> **Baru mulai memasang?** Ikuti [`HOST-SETUP.md`](HOST-SETUP.md): Langkah 0–12 berurutan, setiap layar lengkap
> (OnVisible, semua properti dengan formula utuh, OnChange), plus tes alur report dan troubleshooting. Dokumen ini
> adalah rujukan per aksi.

Control hanya merender isi layar. Header dan sidebar/tab bar tetap milik app. Layar clock in (GPS + selfie) sekarang juga control (`pbs_HostApp.ClockIn`, bagian 9); layar GeoAttendance lama boleh dipensiunkan.

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
        imageMaxKb: 1200           // batas ukuran JPEG yang dikirim ke flow
    }
}, JSONFormat.Compact));
Set(varMe, LookUp('Host - PBS Hub', Email.Email = User().Email));
// Schedule tidak punya AccountName: Schedule.Account = Title di list Account → AccountName (teks).
ClearCollect(colAccounts, ShowColumns('Account - PBS Hub', Title, AccountName));
// Inisialisasi semua variabel host. Power Apps menolak variabel yang belum pernah di-Set di mana pun
// ("Name isn't valid. 'varMrPeriod' isn't recognized"), jadi deklarasikan semuanya di sini sekali.
Set(varMrPeriod, "");  Set(varMrFilter, "");                 // Report saya: bulan "yyyy-mm" (kosong = bulan ini), filter
Set(varMsPeriod, "");  Set(varMsFilter, "");  Set(varMsView, "List");   // Jadwal saya
Set(varSchId, "");     Set(varSchDate, Today());             // Detail sesi yang dibuka
Set(varRptId, Value(Blank())); Set(varRptSchedule, "");      // Kirim / revisi report (Value(Blank()) = angka kosong)
// Record kosong yang sudah bertipe: LookUp ke ID yang tidak ada. Set(var, Blank()) saja ditolak
// ("No type found for variable 'varMrdRep'") karena Power Apps tidak tahu bentuk recordnya.
Set(varMrdRep, LookUp('Report - PBS Hub', ID = -1));
Set(varMrdSch, LookUp('Schedule - PBS Hub', ID = -1));
Set(varHdLoading, false); Set(varMrLoading, false); Set(varMrdLoading, false);
Set(varMsLoading, false); Set(varSdLoading, false); Set(varCkLoading, false);
Set(varHdResult, "");  Set(varMrdResult, ""); Set(varMsResult, ""); Set(varSdResult, ""); Set(varCkResult, "");
```

**Hanya baris milik host yang dikirim** (filter `HostID = varMe.Title` di canvas). Jangan kirim `KTP`,
`NoRekening`, `Alamat`, `PhoneNumber` di `HostJson` — control tidak memakainya.

## 2. Data

| Properti | List | Field (bentuk lewat `ForAll`) |
|---|---|---|
| `HostJson` | `Host - PBS Hub` | `Title, HostCode, NamaHost, Package, CurrentScore, InitialScore` |
| `SchedulesJson` / `ScheduleJson` | `Schedule - PBS Hub` | `ID, Title, Date (yyyy-mm-dd), StartTime, EndTime, BrandID, StudioID, HostID, Platform, Account` (dikirim sebagai `AccountID`), `AccountName` (lookup `Schedule.Account` → `Title` list Account, ambil `AccountName`), `LiveBreak` (Choice Yes/No, kosong = No), `Position (Position.Value), Status (Status.Value)`. Sesi dengan `LiveBreak = Yes` atau `Position = Co-Host` **tidak perlu report**: tampil *Tanpa report* / *Finished*, tanpa tombol Send Report. Report hanya bisa dikirim saat `Status = Waiting Report` (lihat *Report per sesi* di bawah) |
| `ClockInJson` | `Clock In - PBS Hub` | `ID, ClockInDate, CheckInTime, CheckOutTime, ClockInTime, ClockOutTime, CheckInOffice` |
| `AbsenceJson` | `Host Absence - PBS Hub` | `Title, ScheduleID, LiveDate, Status, Created` |
| `ReportsJson` / `ReportJson` / `HistoryJson` | `Report - PBS Hub` | sama dengan Ops (`ID, Title, ScheduleID, HostID, BrandID, AccountID, Account, Platform, LiveDate`, `LiveID`, `Playbook: Playbook.Value` (Choice), 12 metrik, `ApprovalStatus, Match, ApprovalComment, Approver, ApproverEmail, Attachment, Created, Modified`). List dan detail menampilkan Rep ID (`Title`), Schedule ID, jam live (dari `SchedulesJson`), kolom *Status* = `ApprovalStatus` apa adanya, dan `Playbook`. `ApprovalStatus` kosong tampil *Belum ada status* (bukan menunggu review) |
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
| Menunggu review / Menunggu review ulang / Perlu revisi / Selesai / Otomatis disetujui / Live break | dari `Report.ApprovalStatus` (`Waiting Approval`, `Waiting Approval Revision`, `Need Revision`, `Done`, `LiveBreak`) + `ApprovalComment` (sama dengan Ops) |

### Report per sesi (Send Report, live terputus, Live Break)

| Aturan | Detail |
|---|---|
| Kapan bisa report | sudah clock in, absen tercatat, sesi sudah mulai, **dan** `Schedule.Status = Waiting Report`. Canvas mengisi status itu saat ABSEN (`p.scheduleStatus`). Status lain (mis. *Planned*) → tombol **Send Report** nonaktif dengan keterangan |
| Isian | Live ID (teks), `Durasi(Min)`, Playbook (dropdown), `AddToCart` (**hanya Shopee**; TikTok dan lainnya tidak ditanya, dikirim `null`), Pesanan, Penjualan, ProdukTerjual, JumlahPembeli, CTR, PeakViewer, TotalViewer, CTOR, Comment, screenshot. Semua wajib. `Share` tidak dipakai lagi |
| Co-Host | tidak perlu report; absen langsung menulis `Status = Done` |
| Live Break | saat absen host ditanya *Live Break atau bukan*. **Ya** → tidak perlu report, tapi canvas tetap membuat baris Report dengan semua angka 0 dan `ApprovalStatus = LiveBreak`, `Schedule.Status = Done`, `LiveBreak = Yes` |
| Live terputus | satu sesi boleh punya beberapa Report (satu per Live ID). Control menjumlahkan `Durasi(Min)` semua report sesi itu dan membandingkannya dengan durasi jadwal (`EndTime − StartTime`). Kurang → status tetap `Waiting Report`, host melihat *kurang X menit, silakan report berikutnya*. Total ≥ durasi jadwal → `Status = Done`, tombol Send Report hilang |
| Revisi | report yang `Need Revision` bisa diperbaiki termasuk Live ID, Playbook dan Durasi; status jadwal dihitung ulang dengan durasi baru |

Nama status bisa diganti lewat `Context.config`: `scheduleWaitingStatus` (default `Waiting Report`),
`scheduleDoneStatus` (default `Done`); `requireWaitingStatus: false` mematikan syarat status. Pilihan Playbook dari
properti `PlaybooksJson` (mis. `JSON(Choices([@'Report - PBS Hub'].Playbook), JSONFormat.Compact)`), lalu
`config.playbooks`, lalu default *Flash Sale, Payday, Launching Produk, Reguler*. Report lama dengan `Durasi(Min)`
kosong dianggap sudah menutup sesi.

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
| `SchedulesJson` | `JSON(ForAll(colMySch, {ID: ID, Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime, BrandID: BrandID, StudioID: StudioID, HostID: HostID, Platform: Platform.Value, AccountID: Account, AccountName: With({a: Account}, LookUp(colAccounts, Title = a).AccountName), LiveBreak: Coalesce(LiveBreak.Value, "No"), Position: Position.Value, Status: Status.Value}), JSONFormat.Compact)` |
| `ClockInJson` | `JSON(ForAll(colMyClk, {ID: ID, ClockInDate: Text(ClockInDate, "yyyy-mm-dd"), CheckInTime: CheckInTime, CheckOutTime: CheckOutTime, ClockInTime: ClockInTime, ClockOutTime: ClockOutTime, CheckInOffice: CheckInOffice}), JSONFormat.Compact)` |
| `AbsenceJson` | `JSON(ForAll(colMyAbs, {Title: Title, ScheduleID: ScheduleID, LiveDate: Text(LiveDate, "yyyy-mm-dd"), Status: Status.Value, Created: Created}), JSONFormat.Compact)` |
| `ReportsJson` | `JSON(ForAll(colMyRep, {ID: ID, Title: Title, ScheduleID: ScheduleID, HostID: HostID, BrandID: BrandID, AccountID: AccountID, Account: Account.Value, Platform: Platform.Value, LiveDate: Text(LiveDate, "yyyy-mm-dd"), LiveID: LiveID, Playbook: Playbook.Value, Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual, JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)', AddToCart: AddToCart, TotalViewer: TotalViewer, Comment: Comment, ApprovalStatus: ApprovalStatus.Value, ApprovalComment: ApprovalComment, Approver: Approver.DisplayName, ApproverEmail: ApproverEmail, Attachment: Attachment, Created: Created, Modified: Modified}), JSONFormat.Compact)` |
| `ScoreTxJson`, `ThresholdsJson`, `BrandsJson`, `StudiosJson` | seperti HostDetail |
| `IsLoading` | `varHdLoading` |
| `ActionResult` | `varHdResult` |

Aksi:

| Aksi | Payload | Canvas |
|---|---|---|
| `CLOCK_IN` | `{}` | `Navigate(scrClockIn)` — layar dengan control `pbs_HostApp.ClockIn` (bagian 9) |
| `CLOCK_OUT` | `{clockInId}` | `Navigate(scrClockIn)` — control yang sama membuka mode clock out kalau shift masih terbuka |
| `ABSEN` 🔒 | `{scheduleId, scheduleItemId, hostId, hostName, liveDate, brandId, studioId, platform, account, accountName, position, liveBreak, scheduleStatus, report}` | Patch Host Absence + `Schedule.Status`; kalau `liveBreak` buat Report 0 (di bawah) |
| `NEW_REPORT` | `{scheduleId, scheduleItemId, liveDate}` | `Set(varRptSchedule, Text(p.scheduleId)); Set(varRptId, Blank()); Navigate(scrMyReportDetail)` |
| `OPEN_REPORT` | `{reportId, title, scheduleId}` | `Set(varRptId, Value(p.reportId)); Set(varRptSchedule, Text(p.scheduleId)); Navigate(scrMyReportDetail)` |
| `OPEN_SCHEDULE` | `{scheduleId, scheduleItemId, liveDate}` | `Set(varSchId, Text(p.scheduleId)); Set(varSchDate, DateValue(Text(p.liveDate))); Navigate(scrScheduleDetail)` (nama brand di kartu sesi) |
| `NAV` | `{target: "SCHEDULE" \| "REPORTS" \| "SCORE"}` | `Switch(Text(p.target), "REPORTS", Navigate(scrMyReports), "SCHEDULE", Navigate(scrMySchedule))` (tambahkan `"SCORE"` kalau ada layar skor) |
| `RELOAD` | `{}` | ulangi OnVisible |

**ABSEN** (dipakai HostDashboard, MySchedule, ScheduleDetail dan MyReportDetail). Sebelum mengirim, control
menampilkan pop-up *Apakah sesi ini Live Break?* (Co-Host tidak ditanya, `liveBreak: false`).

| Field | Isi |
|---|---|
| `liveBreak` | `true` kalau host memilih *Ya, Live Break* |
| `position` | `Schedule.Position` (mis. `Host`, `Co-Host`) |
| `scheduleStatus` | nilai untuk `Schedule.Status`: `Done` (Live Break atau Co-Host) atau `Waiting Report` |
| `report` | Live Break: `{approvalStatus: "LiveBreak", metrics: {semua 0}, liveId: "", playbook: "", durationMin: 0, fileName: ""}`; selain itu `null` |

Canvas: buat baris Host Absence, `Patch` `Schedule.Status = p.scheduleStatus`; kalau `p.liveBreak` juga
`LiveBreak = Yes` dan buat baris Report dengan semua metrik 0, `ApprovalStatus = LiveBreak`, Title `REP-{ID}`.
Formula lengkapnya di bagian 10.

`OnChange` lengkap untuk layar ini (dan semua layar host lain) ada di **bagian 10**, siap salin.

## 4. MyReports (layar *Report saya*)

`OnChange` lengkap: bagian 10.

```powerfx
// Screen.OnVisible  (varMrPeriod = "yyyy-mm", kosong = bulan ini)
Set(varMrLoading, true);
With({from: If(IsBlank(varMrPeriod), Date(Year(Today()), Month(Today()), 1), DateValue(varMrPeriod & "-01"))},
    ClearCollect(colMrRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate >= from, LiveDate < DateAdd(from, 1, TimeUnit.Months)));
    // Schedule hanya untuk lookup jam sesi dari Report.ScheduleID.
    ClearCollect(colMrSch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date >= from, Date < DateAdd(from, 1, TimeUnit.Months)))
);
Set(varMrLoading, false);
```

| Properti | Nilai |
|---|---|
| `Period` | `varMrPeriod` |
| `DefaultFilter` | `varMrFilter` (`All`, `Revision`, `Waiting`, `Done`, `Auto`, `LiveBreak`) — mis. dari to-do dashboard |
| `ReportsJson`, `SchedulesJson`, `BrandsJson` | seperti HostDashboard, dari koleksi `colMr…` (`ClockInJson`, `AbsenceJson`: kosongkan) |
| `HasMore` | `false` (report per bulan per host kecil; pakai `LOAD_MORE` kalau dibatasi delegasi) |
| `IsLoading` | `varMrLoading` |

| Aksi | Canvas |
|---|---|
| `PERIOD_CHANGED` `{period}` | `Set(varMrPeriod, Text(p.period))` lalu ulangi OnVisible |
| `FILTER_CHANGED` `{filter, period}` | opsional: `Set(varMrFilter, Text(p.filter))` |
| `OPEN_REPORT`, `NEW_REPORT` | sama dengan HostDashboard |
| `LOAD_MORE` `{period, loaded}` | muat halaman berikut kalau `HasMore` dipakai |

Daftar ini **hanya baris Report** (`colMrRep`); `SchedulesJson` dipakai untuk lookup `Report.ScheduleID` →
jam sesi. `ClockInJson` dan `AbsenceJson` tidak dipakai lagi (boleh kosong). Sesi yang belum dilaporkan
muncul di *Hari ini* dan *Jadwal saya*, bukan di sini.

## 5. MyReportDetail (kirim / revisi / lihat)

Mode dipilih dari data: `ReportJson` kosong → **form Send Report** untuk `ScheduleJson` (juga untuk report bagian berikutnya dari live yang terputus); report `Need Revision`
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
ClearCollect(colMrdSesRep, Filter('Report - PBS Hub', HostID = varMe.Title, ScheduleID = varMrdSch.Title));
// Rata-rata host sendiri untuk peringatan "jauh di atas rata-rata kamu" (tidak memblokir):
ClearCollect(colMrdHist, FirstN(SortByColumns(Filter('Report - PBS Hub', HostID = varMe.Title, Platform.Value = varMrdSch.Platform.Value), "Created", SortOrder.Descending), 10));
Set(varMrdLoading, false);
```

| Properti | Nilai |
|---|---|
| `HostJson` | `{Title, NamaHost}` host sendiri |
| `ReportJson` | `If(IsBlank(varMrdRep), "[]", JSON(ForAll(Table(varMrdRep), {ID: ID, Title: Title, ScheduleID: ScheduleID, HostID: HostID, BrandID: BrandID, AccountID: AccountID, Account: Account.Value, Platform: Platform.Value, LiveDate: Text(LiveDate, "yyyy-mm-dd"), LiveID: LiveID, Playbook: Playbook.Value, Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual, JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)', AddToCart: AddToCart, TotalViewer: TotalViewer, Comment: Comment, ApprovalStatus: ApprovalStatus.Value, ApprovalComment: ApprovalComment, Approver: Approver.DisplayName, ApproverEmail: ApproverEmail, Attachment: Attachment, Created: Created, Modified: Modified}), JSONFormat.Compact))` |
| `ScheduleJson` | `If(IsBlank(varMrdSch), "[]", JSON(ForAll(Table(varMrdSch), {ID: ID, Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime, BrandID: BrandID, StudioID: StudioID, HostID: HostID, Platform: Platform.Value, AccountID: Account, AccountName: With({a: Account}, LookUp(colAccounts, Title = a).AccountName), LiveBreak: Coalesce(LiveBreak.Value, "No"), Position: Position.Value, Status: Status.Value}), JSONFormat.Compact))` |
| `EvidenceJson`, `ClockInJson`, `AbsenceJson`, `HistoryJson` | dari `colMrdEvi`, `colMrdClk`, `colMrdAbs`, `colMrdHist` |
| `SessionReportsJson` | semua report sesi ini (live terputus): `JSON(ForAll(colMrdSesRep, {ID: ID, Title: Title, ScheduleID: ScheduleID, HostID: HostID, BrandID: BrandID, AccountID: AccountID, Account: Account.Value, Platform: Platform.Value, LiveDate: Text(LiveDate, "yyyy-mm-dd"), LiveID: LiveID, Playbook: Playbook.Value, Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual, JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)', AddToCart: AddToCart, TotalViewer: TotalViewer, Comment: Comment, ApprovalStatus: ApprovalStatus.Value, ApprovalComment: ApprovalComment, Approver: Approver.DisplayName, ApproverEmail: ApproverEmail, Attachment: Attachment, Created: Created, Modified: Modified}), JSONFormat.Compact)` |
| `PlaybooksJson` | `JSON(Choices([@'Report - PBS Hub'].Playbook), JSONFormat.Compact)` (opsional) |
| `IsLoading` / `ActionResult` | `varMrdLoading` / `varMrdResult` |

### Screenshot: `UploadData`

Host hanya memilih gambar. Control mengecilkannya jadi JPEG (sisi terpanjang `imageMaxPx`, ukuran ≤ `imageMaxKb`)
dan mengirim base64-nya lewat **output kedua `UploadData`**, bukan di `ActionPayload` (tetap kecil). Nama file
disusun control: `ReportID_Platform_AccountID.jpg` — defect O1 v1 (host harus menamai file sendiri) hilang.
Untuk report baru ID belum ada, jadi `file.name` berisi `REP-{ID}_…`; canvas mengganti `{ID}` setelah baris
Report dibuat.

Canvas mengunggah screenshot sendiri lewat **Graph `Office365Groups.HttpRequest` PUT** — cara yang sama dengan
app upload jadwal bulk/AI, tanpa flow. Path:
`/root:/Report Automation/<NamaBrand>/<yyyy>/<mmmm>/REP-<ID>/REP-<ID>_<Platform>_<AccountID>_Report.png:/content`.
`UploadData` adalah base64 tanpa prefix, jadi body-nya `"data:image/jpeg;base64," & data`. `webUrl` dari respons
Graph disimpan di `Report.Attachment`. Revisi menulis ke path yang sama (folder bulan dari `Created`), jadi file lama
ditimpa dan flow AI membacanya ulang. Butuh data source **Office 365 Groups** dan `varSiteID` / `varDriveID` di
App.OnStart (nilainya sama dengan app upload jadwal).

Setelah report tersimpan, canvas menghitung **Tier hari itu** untuk host tersebut dan menulisnya ke baris
`Clock In - PBS Hub` di tanggal live (Tier, Insentif, TotalReports, LastTierUpdate, Reason, Total_Jam_Live, Schedule,
statusupdate). Aturannya sama dengan hitung ulang bulanan: Co-Host mayoritas → No; tanggal merah → Tier 1;
metrik / durasi / jam live (00:00–06:00 ≥ 2 jam → Tier 1, 21:00–24:00 ≥ 2 jam → Tier 2); Sabtu/Minggu minimal
Tier 2. Konfigurasi dari `'Performance Tier - PBS Hub'` (`colTierConfig`) dan `varHolidays` di App.OnStart.

### SUBMIT_REPORT 🔒

Payload: `{scheduleId, scheduleItemId, hostId, hostName, brandId, studioId, platform, account, accountName, liveDate,
absId, liveId, playbook, approvalStatus: "Waiting Approval", metrics: {Penjualan, Pesanan, ProdukTerjual,
JumlahPembeli, CTR, CTOR, PeakViewer, 'Durasi(Min)', AddToCart, TotalViewer, Comment, Share: null}, part,
durationMin, requiredMin, reportedMin, remainingMin, complete, scheduleStatus, file: {name, ext, contentType, bytes,
width, height}, warnings: [..]}`. `AddToCart` bernilai `null` di luar Shopee.

| Field | Arti |
|---|---|
| `part` | report ke berapa untuk sesi ini (1, 2, …) |
| `durationMin` | `Durasi(Min)` report ini |
| `requiredMin` / `reportedMin` / `remainingMin` | durasi jadwal / total setelah report ini / sisa |
| `complete`, `scheduleStatus` | total ≥ durasi jadwal → `true`, `"Done"`; kalau belum `false`, `"Waiting Report"` |

Canvas menolak (`conflict`) kalau `Schedule.Status` bukan `Waiting Report` atau Live ID yang sama sudah ada
untuk sesi itu; selain itu Patch Report (termasuk `LiveID`, `Playbook`), upload screenshot, lalu
`Schedule.Status = p.scheduleStatus`. Pengecekan lama *"report untuk sesi ini sudah ada"* **dihapus** karena satu
sesi bisa punya beberapa report. Formula lengkap di bagian 10.3.

`Self.UploadData` dibaca di `OnChange` yang sama dengan `ActionPayload` — control mengisi keduanya sekaligus dan
mengosongkan `UploadData` pada aksi berikutnya. Kalau upload gagal, baris Report sudah ada tapi `Attachment`
kosong: Ops Console menampilkannya sebagai *Tanpa bukti*, host bisa mengganti screenshot lewat revisi.

### RESUBMIT_REPORT 🔒

Payload: `{reportId, title, scheduleId, expectedModified, approvalStatus: "Waiting Approval Revision", evidenceId,
evidenceTitle, evidenceStatus: "Unmatch", metrics, liveId, playbook, changed: ["Penjualan","LiveID"], flagged: [..],
durationMin, reportedMin, remainingMin, complete, scheduleStatus, note, file: {…} | null}`. Tombol *Kirim revisi*
baru aktif kalau ada angka / Live ID / Playbook yang berubah **atau** screenshot baru. Canvas juga menulis
`LiveID`, `Playbook` dan `Schedule.Status = p.scheduleStatus` (durasi bisa berubah). Formula lengkap di bagian 10.3.

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

## 6. MySchedule (layar *Jadwal saya*)

`OnChange` lengkap: bagian 10.

```powerfx
// Screen.OnVisible  (varMsPeriod = "yyyy-mm", kosong = bulan ini)
Set(varMsLoading, true);
With({from: If(IsBlank(varMsPeriod), Date(Year(Today()), Month(Today()), 1), DateValue(varMsPeriod & "-01"))},
    With({to: DateAdd(from, 1, TimeUnit.Months)},
        ClearCollect(colMsSch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date >= from, Date < to));
        ClearCollect(colMsClk, Filter('Clock In - PBS Hub', HostID = varMe.Title, ClockInDate >= from, ClockInDate < to));
        ClearCollect(colMsAbs, Filter('Host Absence - PBS Hub', HostID = varMe.Title, LiveDate >= from, LiveDate < to));
        ClearCollect(colMsRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate >= from, LiveDate < to))
    )
);
Set(varMsLoading, false);
```

| Properti | Nilai |
|---|---|
| `Period` | `varMsPeriod` |
| `DefaultFilter` | `varMsFilter` — kosong, `ACTION` (perlu tindakan), `PLANNED`, `FINISHED`, `CANCELLED` |
| `HostJson` | seperti HostDashboard (dipakai untuk payload `ABSEN`) |
| `SchedulesJson` | seperti HostDashboard dari `colMsSch`, **plus** `JamLive: JamLive` (`Position`, `LiveBreak`, `AccountName` sudah ikut dari HostDashboard). Kolom *Posisi* hanya tampil kalau ada baris yang mengisinya. |
| `ClockInJson`, `AbsenceJson`, `ReportsJson`, `BrandsJson`, `StudiosJson` | seperti HostDashboard, dari koleksi `colMs…` |
| `DefaultView` | `Coalesce(varMsView, "List")` — `"List"` (tabel) atau `"Calendar"` (kalender bulan). Tombol *Daftar / Kalender* mengirim `VIEW_CHANGED {view}`; simpan di `OnChange`: `"VIEW_CHANGED", Set(varMsView, Text(p.view))` supaya pilihan host bertahan saat kembali ke layar. |
| `HasMore` | `false` (per host per bulan kecil) |
| `IsLoading` | `varMsLoading` |
| `ActionResult` | `varMsResult` |

Status yang dilihat host (sama dengan dashboard, dengan kata dari app v1):

| Status | Syarat |
|---|---|
| **Planned** | sebelum absen dibuka |
| Segera mulai / Sedang live | jendela absen terbuka / sesi berjalan |
| Perlu absen · Tanpa clock in | langkah yang masih kurang |
| Belum report · Report terlambat | clock in + absen ada, belum ada Report (terlambat setelah H+`reportDeadlineDays`) |
| Perlu revisi · Menunggu review | dari `Report.ApprovalStatus` |
| **Finished** | report disetujui (manual atau otomatis), atau `Schedule.Status = Finished` tanpa report yang masih menunggu |
| Dibatalkan | `Schedule.Status` Cancelled / Leave |

KPI: *Live schedule* (sesi bulan ini, tanpa yang batal), *Jam live* (jam sesi yang sudah lewat dari total jam
terjadwal), *Absen hari ini*, *Hari clock in* (hari berjadwal sampai hari ini yang punya Clock In).

| Aksi | Canvas |
|---|---|
| `OPEN_SCHEDULE` `{scheduleId, scheduleItemId, liveDate}` | seperti HostDashboard → `Navigate(scrScheduleDetail)` |
| `ABSEN` 🔒 | sama dengan HostDashboard (balas ke `varMsResult`, lalu `Collect(colMsAbs, …)`) |
| `CLOCK_IN`, `NEW_REPORT`, `OPEN_REPORT` | sama dengan HostDashboard |
| `PERIOD_CHANGED` `{period}` | `Set(varMsPeriod, Text(p.period))` lalu ulangi OnVisible |
| `FILTER_CHANGED` `{status, platform, period}` | opsional: `Set(varMsFilter, Text(p.status))` supaya filter bertahan saat kembali |
| `VIEW_CHANGED` `{view: "List" \| "Calendar"}` | opsional: `Set(varMsView, Text(p.view))`, lalu `DefaultView = Coalesce(varMsView, "List")` |
| `LOAD_MORE` `{period, loaded}` | hanya kalau `HasMore` dipakai |

Filter platform, status dan kotak cari (brand, akun, Schedule ID, studio) jalan di control, tanpa reload.

## 7. ScheduleDetail (layar *Detail sesi*)

`OnChange` lengkap: bagian 10.

Kirim sesi itu **plus sesi lain host di hari yang sama** (untuk daftar *Sesi lain hari ini*):

```powerfx
// Screen.OnVisible  (varSchId dan varSchDate diisi oleh OPEN_SCHEDULE)
Set(varSdLoading, true);
ClearCollect(colSdSch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date = varSchDate));
ClearCollect(colSdClk, Filter('Clock In - PBS Hub', HostID = varMe.Title, ClockInDate = varSchDate));
ClearCollect(colSdAbs, Filter('Host Absence - PBS Hub', HostID = varMe.Title, LiveDate = varSchDate));
ClearCollect(colSdRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate = varSchDate));
Set(varSdLoading, false);
```

| Properti | Nilai |
|---|---|
| `ScheduleId` | `varSchId` (Title `SCD-…`, atau ID item) |
| `SchedulesJson` | seperti MySchedule, dari `colSdSch` |
| `ClockInJson` | `JSON(ForAll(colSdClk, {ID: ID, ClockInDate: Text(ClockInDate, "yyyy-mm-dd"), CheckInTime: CheckInTime, CheckOutTime: CheckOutTime, ClockInTime: ClockInTime, CheckInOffice: CheckInOffice, IsInsideGeofence: IsInsideGeofence}), JSONFormat.Compact)` |
| `AbsenceJson` | seperti HostDashboard, plus `CheckInTime` (jam absen yang ditampilkan) |
| `ReportsJson` | field Report lengkap seperti MyReportDetail (12 metrik, `ApprovalStatus, ApprovalComment, Approver, Modified, Playbook`) — form revisi membaca angka lama dari sini |
| `EvidenceJson` | `Report Automation - PBS Hub` untuk report di atas (`Title` = Title report), seperti MyReportDetail |
| `HistoryJson` | opsional: report host sebelumnya di platform yang sama (peringatan "jauh di atas rata-rata kamu") |
| `HostJson`, `BrandsJson`, `StudiosJson` | seperti HostDashboard |
| `PlaybooksJson` | pilihan dropdown Playbook, mis. `JSON(Choices([@'Report - PBS Hub'].Playbook), JSONFormat.Compact)` (opsional) |
| `IsLoading` | `varSdLoading` |
| `ActionResult` | `varSdResult` |

| Output | Nilai |
|---|---|
| `UploadData` | base64 JPEG screenshot, terisi bersama `SUBMIT_REPORT` / `RESUBMIT_REPORT` — sama persis dengan MyReportDetail (bagian 5) |

| Aksi | Canvas |
|---|---|
| `ABSEN` 🔒 | pop-up Live Break lalu sama dengan HostDashboard (balas ke `varSdResult`, muat ulang `colSdAbs`, `colSdSch`, `colSdRep`) |
| `SUBMIT_REPORT` 🔒 | tombol **Send Report** di kepala halaman. Handler yang sama dengan MyReportDetail (flow upload dengan `ScheduleDetail.UploadData`, Patch Report + `Schedule.Status`), balas ke `varSdResult`, lalu muat ulang `colSdSch` dan `colSdRep` supaya daftar report dan sisa durasi terbarui |
| `RESUBMIT_REPORT` 🔒, `DISPUTE_REVIEW` 🔒 | sama dengan MyReportDetail, balas ke `varSdResult`, lalu `ClearCollect(colSdRep, …)` |
| `CLOCK_IN` | `Navigate(scrClockIn)` |
| `OPEN_REPORT`, `OPEN_EVIDENCE` | sama dengan MyReportDetail / HostDashboard (report yang sudah selesai dibuka read-only) |
| `OPEN_SCHEDULE` `{scheduleId, …}` | sesi lain di hari yang sama: `Set(varSchId, Text(p.scheduleId))` — data sudah ada, tidak perlu reload |
| `BACK` | `Back()` |

Tata letak mengikuti desain 10–11: kepala halaman (breadcrumb *Jadwal saya / SCD-…*, judul brand, tombol **Absen**,
**Clock in**, **Send Report** di kanan), baris ringkas sesi (tanggal, jam, platform, posisi, status), kolom utama 8/12
(langkah berikutnya, form report, revisi, daftar report per bagian, waktu & tempat) dan kolom samping 4/12 (durasi
report, langkah sesi, sesi lain hari itu).

**Send Report** hanya aktif kalau `Schedule.Status = Waiting Report` (plus clock in, absen, sesi sudah mulai);
kalau tidak, tombolnya nonaktif dengan keterangan kenapa. Co-Host dan Live Break tidak punya tombol ini
(*tanpa report*). Setelah report terkirim dan durasinya belum mencukupi, halaman menampilkan *kurang X menit* dan
tombol berubah jadi **Send Report berikutnya**; setelah total durasi ≥ durasi jadwal tombol hilang dan status
menjadi `Done`. Report yang perlu revisi dibuka di tempat (angka, Live ID, Playbook, durasi; perbaiki atau sanggah).
Sesi tanpa clock in diarahkan minta clock in manual ke tim PBS, sesi batal hanya diberi keterangan.

## 8. Pemasangan

1. Import `dist/PBSHubHostApp_1_0_0_0_managed.zip` (Solutions → Import). Bisa di environment yang sama dengan
   `PBSHubOpsPCF` dan dengan solusi host lama.
   **Pindah dari solusi lama** (`PBSHubHostPCF` / `PBSHubHostSchedulePCF`, control `pbs_Host.*`): control baru tidak
   otomatis menggantikan yang lama di canvas. Di tiap layar hapus control lama, tambahkan control `pbs_HostApp.*`
   dengan nama yang sama (mis. `ScheduleDetail1`) supaya formula tetap cocok, isi ulang propertinya dan salin
   `OnChange` dari bagian 10. Setelah semua layar pindah dan app dipublish, solusi lama boleh dihapus.
2. Di canvas app host: **Insert → Get more components → Code** → `PBS Host App Dashboard`, `PBS Host App My Reports`,
   `PBS Host App My Report Detail`, `PBS Host App Clock In`, `PBS Host App My Schedule`, `PBS Host App Schedule Detail`.
3. Buat flow *PBS Host – Upload selfie* (bagian 9) dan tambahkan ke app (**Power Automate** pane). Screenshot
   report diunggah lewat Graph (`Office365Groups.HttpRequest`, bagian 5): tambahkan data source **Office 365 Groups**.
4. Satu control per layar, ukuran = area konten. Layout menyesuaikan lebar sendiri (container query): di HP
   (≤ 560 px) kolom tunggal, di tablet/desktop kolom tengah 720 px. *Jadwal saya* memakai kolom lebar
   (sampai 1160 px) dan menyembunyikan kolom Akun / Posisi / Studio di bawah 900 px.

Update: naikkan `version` di `ControlManifest.Input.xml` yang berubah **dan** `Version` di
`solution/PBSHubHostApp/src/Other/Solution.xml`, lalu `npm run release` (membangun semua solusi; hanya host:
`SOLUTIONS=PBSHubHostApp ./scripts/package-solution.sh`).

## 9. ClockIn (layar *Clock in*)

Satu layar untuk clock in **dan** clock out. Control membaca shift hari ini dari `ClockInJson`: belum ada baris →
mode *Clock in*; baris dengan `CheckOutTime` kosong (termasuk shift semalam yang belum ditutup) → mode *Clock out*;
sudah clock out → *Shift selesai*.

Alur host: **Cek lokasi** (GPS HP, akurasi tinggi, maks. 20 detik) → **Ambil selfie** (kamera depan terbuka;
foto dikecilkan jadi JPEG ≤ `selfieMaxKb`) → kalau **di luar radius**, isi **Alasan** (wajib, min. `minReasonChars`
karakter) → **Clock in sekarang** / **Clock out sekarang**. Posisi yang lebih tua dari 5 menit harus dicek ulang.
Di luar radius **tetap boleh** clock in/out; baris ditandai `IsInsideGeofence = false` dan alasannya tersimpan.

Geofence: jarak ke setiap baris aktif `Studio Location - PBS` (`IsActive = Yes`, `Latitude`/`Longitude` terisi).
*Di dalam radius* = jarak ≤ `RadiusMeter`; `RadiusMeter` kosong memakai `defaultRadiusM`. Kalau di luar semua
radius, studio terdekat yang ditulis ke `CheckInOffice` / `CheckOutOffice` bersama jaraknya.

**Context** — `varHostCtx` yang sama, config tambahan (semua opsional):

```powerfx
clockInStatus: "Hadir - Tugas",   // nilai Choice Status saat clock in
hkTugas: 180000,                  // HKTugas yang ditulis (default mengikuti clockInStatus)
statusAbsence: "",                // nilai Choice StatusAbsence saat clock out; kosong = kolom tidak ditulis
defaultRadiusM: 100,              // radius kalau RadiusMeter kosong
weakAccuracyM: 100,               // akurasi GPS di atas ini diberi peringatan (tidak memblokir)
minReasonChars: 10,               // panjang minimum alasan di luar radius
selfieMaxPx: 960, selfieMaxKb: 350
```

**OnVisible**

```powerfx
Set(varCkLoading, true);
Concurrent(
    ClearCollect(colCkLoc, Filter('Studio Location - PBS', IsActive = true)),
    ClearCollect(colCkClk, Filter('Clock In - PBS Hub', HostID = varMe.Title, ClockInDate >= Today() - 1)),
    ClearCollect(colCkSch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date >= Today() - 1, Date <= Today())),
    ClearCollect(colCkRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate >= Today() - 1))
);
Set(varCkLoading, false)
```

**Properti**

| Properti | Nilai |
|---|---|
| `Context` | `varHostCtx` |
| `HostJson` | `JSON(ForAll(Table(varMe), {Title: Title, NamaHost: NamaHost, Email: Email.Email}), JSONFormat.Compact)` |
| `LocationsJson` | `JSON(ForAll(colCkLoc, {Title: Title, LocationID: LocationID, Latitude: Latitude, Longitude: Longitude, RadiusMeter: RadiusMeter, IsActive: IsActive}), JSONFormat.Compact)` |
| `ClockInJson` | `JSON(ForAll(colCkClk, {ID: ID, Title: Title, HostID: HostID, ClockInDate: Text(ClockInDate, "yyyy-mm-dd"), CheckInTime: CheckInTime, CheckOutTime: CheckOutTime, ClockInTime: ClockInTime, CheckInOffice: CheckInOffice, Reason: Reason}), JSONFormat.Compact)` |
| `SchedulesJson` | `JSON(ForAll(colCkSch, {Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime, HostID: HostID, Status: Status.Value}), JSONFormat.Compact)` — untuk `ScheduleCount` (sesi *Cancelled* tidak dihitung) |
| `ReportsJson` | `JSON(ForAll(colCkRep, {Title: Title, ScheduleID: ScheduleID, HostID: HostID, LiveDate: Text(LiveDate, "yyyy-mm-dd")}), JSONFormat.Compact)` — untuk `TotalReports` saat clock out |
| `DeviceLocationJson` | `JSON({Latitude: Location.Latitude, Longitude: Location.Longitude}, JSONFormat.Compact)` — cadangan kalau browser/WebView menolak GPS; akurasinya tidak diketahui |
| `IsLoading` / `ActionResult` | `varCkLoading` / `varCkResult` |
| `ReferenceDate` | kosong (hanya untuk tes) |

Output kedua **`UploadData`** berisi base64 JPEG selfie, terisi bersama `CLOCK_IN` / `CLOCK_OUT` — polanya sama
dengan screenshot report (bagian 5). Nama file disusun control: `HST-001_20260925_IN_0803.jpg` / `…_OUT_1733.jpg`.

**Flow *PBS Host – Upload selfie*** — trigger *Power Apps (V2)* dengan input Text `fileName`, `fileBase64`;
**SharePoint → Create file** ke mis. `/PBS Power Apps/Selfie Clock In`, File content
`base64ToBinary(triggerBody()?['text_1'])`; **Respond to a PowerApp** dengan `url`. Di app
namanya `'PBSHost-Uploadselfie'`.

**Payload**

`CLOCK_IN`: `{hostId, hostName, employeeName, employeeEmail, clockInDate, checkInTime (ISO), clockInTime ("HH:mm"),
status, hkTugas, scheduleCount, latitude, longitude, accuracy, distance, office, locationId, inside, radius,
positionSource ("device" | "canvas"), reason, selfieSource ("Camera" | "Gallery"), file: {name, ext, contentType, bytes, width, height}}`

`CLOCK_OUT`: `{clockInId, clockInTitle, hostId, clockOutDate, checkOutTime, clockOutTime, workingMinutes, workingHours,
scheduleCount, totalReports, statusAbsence, latitude, longitude, accuracy, distance, office, locationId, inside,
radius, positionSource, reason, reasonText, selfieSource, file}`. `reasonText` = alasan clock in + `[Clock out] …`
(satu kolom `Reason` untuk dua ujung shift). `scheduleCount` / `totalReports` dihitung untuk **hari clock in**
(shift yang lewat tengah malam tetap milik hari itu).

**OnChange**

```powerfx
If(!IsBlank(Self.ActionPayload),
    With({req: ParseJSON(Self.ActionPayload)},
        With({act: Text(req.action), rid: Text(req.requestId), p: req.payload, data: Self.UploadData},
            If(!(rid in colPbsProcessed.Id),
                Collect(colPbsProcessed, {Id: rid});
                Switch(act,
                    "CLOCK_IN",
                        If(!IsBlank(LookUp('Clock In - PBS Hub', HostID = varMe.Title && ClockInDate = Today())),
                            Set(varCkResult, JSON({requestId: rid, status: "conflict", message: "Kamu sudah clock in hari ini."}, JSONFormat.Compact)),
                            IfError(
                                // Selfie dulu: nama file tidak butuh ID, jadi upload gagal tidak meninggalkan baris tanpa foto.
                                With({up: 'PBSHost-Uploadselfie'.Run(Text(p.file.name), data)},
                                    With({row: Patch('Clock In - PBS Hub', Defaults('Clock In - PBS Hub'), {
                                            HostID: varMe.Title, HostName: Text(p.hostName),
                                            EmployeeName: Text(p.employeeName), EmployeeEmail: Text(p.employeeEmail),
                                            ClockInDate: Today(), CheckInTime: Now(), ClockInTime: Text(Now(), "hh:mm"),
                                            Status: {Value: Text(p.status)}, HKTugas: Value(p.hkTugas),
                                            ScheduleCount: Value(p.scheduleCount),
                                            CheckInLatitude: Value(p.latitude), CheckInLongitude: Value(p.longitude),
                                            CheckInAccuracy: Value(p.accuracy), CheckInDistance: Value(p.distance),
                                            CheckInOffice: Text(p.office), IsInsideGeofence: Boolean(p.inside),
                                            Reason: Text(p.reason), SelfieSource: Text(p.selfieSource),
                                            SelfiePhotoUrl: up.url
                                        })},
                                        Patch('Clock In - PBS Hub', row, {Title: "CLK-" & Text(row.ID, "0000")});
                                        ClearCollect(colCkClk, Filter('Clock In - PBS Hub', HostID = varMe.Title, ClockInDate >= Today() - 1));
                                        Set(varCkResult, JSON({requestId: rid, status: "ok", message: "Clock in " & Text(Now(), "hh:mm") & " tersimpan (CLK-" & Text(row.ID, "0000") & ")."}, JSONFormat.Compact))
                                    )
                                ),
                                Set(varCkResult, JSON({requestId: rid, status: "error", message: "Gagal clock in: " & FirstError.Message}, JSONFormat.Compact))
                            )
                        ),
                    "CLOCK_OUT",
                        With({cur: LookUp('Clock In - PBS Hub', ID = Value(p.clockInId) && HostID = varMe.Title)},
                            If(IsBlank(cur) || !IsBlank(cur.CheckOutTime),
                                Set(varCkResult, JSON({requestId: rid, status: "conflict", message: "Shift ini sudah di-clock out. Muat ulang."}, JSONFormat.Compact)),
                                IfError(
                                    With({up: 'PBSHost-Uploadselfie'.Run(Text(p.file.name), data)},
                                        Patch('Clock In - PBS Hub', cur, {
                                            CheckOutTime: Now(), ClockOutDate: Today(),
                                            CheckOutLatitude: Value(p.latitude), CheckOutLongitude: Value(p.longitude),
                                            CheckOutAccuracy: Value(p.accuracy), CheckOutDistance: Value(p.distance),
                                            CheckOutOffice: Text(p.office),
                                            WorkingDuration: DateDiff(Coalesce(cur.CheckInTime, Now()), Now(), TimeUnit.Minutes),  // menit; pakai /60 kalau kolomnya jam
                                            ScheduleCount: Value(p.scheduleCount), TotalReports: Value(p.totalReports),
                                            Reason: Text(p.reasonText),
                                            SelfieOutPhotoUrl: up.url
                                            // , StatusAbsence: {Value: Text(p.statusAbsence)}   ← aktifkan kalau config.statusAbsence diisi
                                        })
                                    );
                                    ClearCollect(colCkClk, Filter('Clock In - PBS Hub', HostID = varMe.Title, ClockInDate >= Today() - 1));
                                    Set(varCkResult, JSON({requestId: rid, status: "ok", message: "Clock out " & Text(Now(), "hh:mm") & " tersimpan."}, JSONFormat.Compact)),
                                    Set(varCkResult, JSON({requestId: rid, status: "error", message: "Gagal clock out: " & FirstError.Message}, JSONFormat.Compact))
                                )
                            )
                        ),
                    "NAV", Navigate(scrHome)   // tombol "Hari ini" / "Kembali ke Hari ini" ({target: "HOME"})
                )
            )
        )
    )
)
```

Catatan:
- Waktu yang disimpan `Now()` saat canvas menulis (bukan jam HP yang dikirim control); `checkInTime` /
  `checkOutTime` di payload hanya untuk log.
- Selfie di-upload **sebelum** baris ditulis (clock in) / di-patch (clock out). Upload gagal → `IfError` membalas
  error, tidak ada baris setengah jadi, host tinggal menekan tombol lagi.
- `ClockInDate = Today()` di pengecekan konflik: satu baris clock in per host per hari (sama dengan clock in manual
  di Ops).
- Izin lokasi: Power Apps mobile meminta izin lokasi saat pertama kali; di browser, situs `apps.powerapps.com` harus
  diizinkan. Kalau ditolak, control memakai `DeviceLocationJson` (sinyal `Location` canvas) bila terisi.

## 10. OnChange lengkap (salin per layar)

Formula di bawah bisa ditempel utuh ke properti **OnChange** control di tiap layar. Semuanya memakai kerangka yang
sama: baca `ActionPayload`, abaikan `requestId` yang sudah diproses (`colPbsProcessed`), jalankan aksinya, lalu
untuk aksi *terkunci* balas lewat variabel `ActionResult` layar itu. `ClockIn` sudah lengkap di bagian 9.

Siapkan sekali di **App.OnStart** (selain `varHostCtx` dan `varMe` dari bagian 1):

```powerfx
ClearCollect(colPbsProcessed, {Id: ""});   // skema koleksi requestId yang sudah diproses
// Upload screenshot (Graph) dan Tier harian — lengkapnya di HOST-SETUP.md Langkah 3 blok 5.
Set(varSiteID, "<site-id>"); Set(varDriveID, "<drive-id>");
ClearCollect(colTierConfig, 'Performance Tier - PBS Hub');
Set(varSlotMin, 15); Set(varT1MinInWindow, 120); Set(varT2MinInWindow, 120);
Set(varHolidays, [Date(2026,1,1), Date(2026,2,16) /* … */]);
```

Nama yang dipakai: layar `scrHome` (Hari ini), `scrMyReports`, `scrMyReportDetail`, `scrMySchedule`,
`scrScheduleDetail`, `scrClockIn`; upload screenshot Graph dengan `varSiteID` / `varDriveID` (bagian 5). Ganti kalau
nama di app berbeda. Schedule tidak punya kolom nama akun: `Schedule.Account` adalah `Title` di list Account, dan
namanya diambil dari `colAccounts` (dimuat di App.OnStart). `AccountID` di Report diisi kode akun (`s.Account`).

Kolom **`Account` di Report dan Host Absence adalah kolom Lookup/Choice** (bukan teks), jadi nilainya harus record.
Formula memakai `LookUp(Choices([@'Report - PBS Hub'].Account), Value = kode || Value = nama)`: mengambil pilihan
yang cocok dengan kode akun (kalau lookup menampilkan `Title`) atau nama akun (kalau menampilkan `AccountName`).
Kalau di list kamu `Account` ternyata teks biasa, `Choices` akan error — ganti dengan
`Account: LookUp(colAccounts, Title = s.Account).AccountName`.

| Layar | Variabel `ActionResult` | Koleksi yang diperbarui |
|---|---|---|
| Hari ini (HostDashboard) | `varHdResult` | `colMyAbs`, `colMySch`, `colMyRep` |
| Report saya (MyReports) | — (tidak ada aksi terkunci) | `colMrRep`, `colMrSch` |
| Kirim / revisi report (MyReportDetail) | `varMrdResult` | `colMrdAbs`, `colMrdSesRep`, `varMrdSch`, `varMrdRep` |
| Jadwal saya (MySchedule) | `varMsResult` | `colMsAbs`, `colMsSch`, `colMsRep`, koleksi `colMs…` saat ganti bulan |
| Detail sesi (ScheduleDetail) | `varSdResult` | `colSdAbs`, `colSdSch`, `colSdRep` |

### 10.1 HostDashboard — `OnChange`

```powerfx
If(!IsBlank(Self.ActionPayload),
    With({req: ParseJSON(Self.ActionPayload)},
        With({act: Text(req.action), rid: Text(req.requestId), p: req.payload},
            If(!(rid in colPbsProcessed.Id),
                Collect(colPbsProcessed, {Id: rid});
                Switch(act,
                    "CLOCK_IN", Navigate(scrClockIn),
                    "CLOCK_OUT", Navigate(scrClockIn),
                    "ABSEN",
                        If(!IsBlank(LookUp('Host Absence - PBS Hub', ScheduleID = Text(p.scheduleId) && HostID = varMe.Title)),
                            Set(varHdResult, JSON({requestId: rid, status: "conflict", message: "Absen sesi ini sudah tercatat."}, JSONFormat.Compact)),
                            IfError(
                                With({s: LookUp('Schedule - PBS Hub', Title = Text(p.scheduleId) && HostID = varMe.Title), lb: Boolean(p.liveBreak)},
                                    With({row: Patch('Host Absence - PBS Hub', Defaults('Host Absence - PBS Hub'), {
                                            ScheduleID: s.Title, HostID: varMe.Title, HostName: Text(p.hostName), LiveDate: s.Date,
                                            BrandID: s.BrandID, Platform: {Value: s.Platform.Value}, Account: LookUp(Choices([@'Host Absence - PBS Hub'].Account), Value = s.Account || Value = LookUp(colAccounts, Title = s.Account).AccountName)
                                            // , Status: {Value: "Present"}   ← nilai Choice Status di Host Absence, kalau kolomnya ada
                                        })},
                                        Patch('Host Absence - PBS Hub', row, {Title: "ABS-" & row.ID});
                                        Collect(colMyAbs, LookUp('Host Absence - PBS Hub', ID = row.ID));
                                        // Status jadwal dari control: "Waiting Report" (report dibuka) atau "Done" (Live Break / Co-Host).
                                        Patch('Schedule - PBS Hub', s, {Status: {Value: Text(p.scheduleStatus)}});
                                        // Live Break: host tidak perlu report, tapi baris Report tetap dibuat, semua angka 0.
                                        If(lb,
                                            Patch('Schedule - PBS Hub', LookUp('Schedule - PBS Hub', ID = s.ID), {LiveBreak: {Value: "Yes"}});   // Choice Yes/No
                                            With({rep: Patch('Report - PBS Hub', Defaults('Report - PBS Hub'), {
                                                    ScheduleID: s.Title, HostID: varMe.Title, BrandID: s.BrandID, Platform: {Value: s.Platform.Value},
                                                    AccountID: s.Account, Account: LookUp(Choices([@'Report - PBS Hub'].Account), Value = s.Account || Value = LookUp(colAccounts, Title = s.Account).AccountName), LiveDate: s.Date, AbsID: "ABS-" & row.ID,
                                                    Penjualan: 0, Pesanan: 0, ProdukTerjual: 0, JumlahPembeli: 0, CTR: 0, CTOR: 0, PeakViewer: 0,
                                                    'Durasi(Min)': 0, AddToCart: 0, TotalViewer: 0, Comment: 0,
                                                    ApprovalStatus: {Value: "LiveBreak"}
                                                })},
                                                Patch('Report - PBS Hub', rep, {Title: "REP-" & rep.ID})
                                            );
                                            // ---- Tier harian di Clock In: host ini, tanggal s.Date. Aturan sama dengan hitung ulang bulanan.
                                            IfError(
                                                With({tDate: s.Date},
                                                With({clk: LookUp('Clock In - PBS Hub', HostID = varMe.Title && ClockInDate = tDate),
                                                      schDay: Filter('Schedule - PBS Hub', HostID = varMe.Title && Date = tDate),
                                                      repDay: Filter('Report - PBS Hub', HostID = varMe.Title && LiveDate = tDate),
                                                      t1: LookUp(colTierConfig, Title = "Tier 1"), t2: LookUp(colTierConfig, Title = "Tier 2"),
                                                      t3: LookUp(colTierConfig, Title = "Tier 3")},
                                                If(!IsBlank(clk),
                                                // Segmen jadwal aktif (bukan Cancelled, jam lengkap). Lewat tengah malam: EndMin + 1440.
                                                With({seg: ForAll(Filter(schDay, !IsBlank(StartTime) && !IsBlank(EndTime) && Status.Value <> "Cancelled") As S,
                                                            With({sm: Hour(TimeValue(S.StartTime)) * 60 + Minute(TimeValue(S.StartTime)),
                                                                  em: Hour(TimeValue(S.EndTime)) * 60 + Minute(TimeValue(S.EndTime))},
                                                                {Title: S.Title, BrandID: S.BrandID, StartTime: S.StartTime, EndTime: S.EndTime,
                                                                 Co: S.Position.Value = "Co-Host",          // "Host" / "Main Host" = main host
                                                                 StartMin: sm, EndMin: If(em >= sm, em, em + 1440)}))},
                                                With({mainSeg: Filter(seg, !Co), mainMin: Sum(Filter(seg, !Co), EndMin - StartMin), coMin: Sum(Filter(seg, Co), EndMin - StartMin)},
                                                // Grid 15 menit selama 2 hari (0–2880): slot yang tertutup jadwal main host.
                                                With({slots: ForAll(Sequence(2880 / varSlotMin, 0, 1) As Sl,
                                                            With({ms: Sl.Value * varSlotMin}, {SlotStart: ms, Covered: !IsEmpty(Filter(mainSeg, StartMin <= ms && EndMin > ms))}))},
                                                With({liveMin: CountRows(Filter(slots, Covered)) * varSlotMin,
                                                      t1Win: CountRows(Filter(slots, Covered && (SlotStart < 360 || (SlotStart >= 1440 && SlotStart < 1800)))) * varSlotMin,     // 00:00–06:00
                                                      t2Win: CountRows(Filter(slots, Covered && ((SlotStart >= 1260 && SlotStart < 1440) || SlotStart >= 2700))) * varSlotMin,  // 21:00–24:00
                                                      // Akun terbaik hari itu: TotalViewer dijumlah, Peak dan CTR diambil maksimum.
                                                      best: First(Sort(ForAll(Distinct(repDay, Account.Value) As D,
                                                                With({r: Filter(repDay, Account.Value = D.Value)},
                                                                    {Account: D.Value, TotalViewer: Sum(r, TotalViewer), PeakViewer: Max(r, PeakViewer), CTR: Max(r, CTR)})),
                                                            TotalViewer * PeakViewer * CTR, SortOrder.Descending))},
                                                With({m1: !IsBlank(best) && best.TotalViewer >= t1.MinViews && best.CTR >= t1.CTR && best.PeakViewer >= t1.AvgViewDur,
                                                      m2: !IsBlank(best) && best.TotalViewer >= t2.MinViews && best.CTR >= t2.CTR && best.PeakViewer >= t2.AvgViewDur,
                                                      m3: !IsBlank(best) && best.TotalViewer >= t3.MinViews && best.CTR >= t3.CTR && best.PeakViewer >= t3.AvgViewDur,
                                                      d1: liveMin >= t1.Duration * 60, d2: liveMin >= t2.Duration * 60, d3: liveMin >= t3.Duration * 60,
                                                      w1: t1Win >= varT1MinInWindow, w2: t2Win >= varT2MinInWindow,
                                                      jam: Round(liveMin / 60, 2), main: mainMin > coMin,
                                                      hol: tDate in varHolidays, wkd: Weekday(tDate) = 1 || Weekday(tDate) = 7},
                                                With({calc: If(m1 || d1 || w1, "Tier 1", m2 || d2 || w2, "Tier 2", m3 || d3, "Tier 3", "No")},
                                                // Urutan: Co-Host mayoritas → No; tanggal merah → Tier 1; Sabtu/Minggu → minimal Tier 2.
                                                With({tier: If(!main, "No", hol, "Tier 1", wkd && calc <> "Tier 1", "Tier 2", calc)},
                                                    Patch('Clock In - PBS Hub', clk, {
                                                        Tier: {Value: tier},
                                                        Insentif: Switch(tier, "Tier 1", 75000, "Tier 2", 65000, "Tier 3", 55000, 0),
                                                        TotalReports: CountRows(repDay),
                                                        LastTierUpdate: Now(),
                                                        Reason: If(
                                                            !main,
                                                                If(mainMin = 0, "Tidak mendapatkan Tier karena hanya sebagai Co-Host. Main Host: 0 jam, Co-Host: " & Round(coMin / 60, 2) & " jam",
                                                                    "Tidak eligible Tier karena durasi Co-Host lebih besar atau sama dengan Main Host. Main Host: " &
                                                                    Round(mainMin / 60, 2) & " jam, Co-Host: " & Round(coMin / 60, 2) & " jam"),
                                                            hol, "Auto Tier 1 karena Tanggal Merah (Libur Nasional)",
                                                            tier = "No",
                                                                "Belum mencapai target minimum. Views: " & Coalesce(best.TotalViewer, 0) & " (min " & t3.MinViews & "), CTR: " &
                                                                Coalesce(best.CTR, 0) & " (min " & t3.CTR & "), Peak: " & Coalesce(best.PeakViewer, 0) & " (min " & t3.AvgViewDur &
                                                                "), Durasi: " & jam & " jam (min " & t3.Duration & " jam)",
                                                            tier & " karena " & Concat(Filter([
                                                                If(w1, "Jam Live 00:00-06:00 (" & t1Win & " menit, min " & varT1MinInWindow & ")", ""),
                                                                If(w2, "Jam Live 21:00-24:00 (" & t2Win & " menit, min " & varT2MinInWindow & ")", ""),
                                                                If(m1, "Metric Tier 1 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                                If(m2 && !m1, "Metric Tier 2 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                                If(m3 && !m2, "Metric Tier 3 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                                If(d1, "Durasi Live >= " & t1.Duration & " Jam (" & jam & " jam)", ""),
                                                                If(d2 && !d1, "Durasi Live >= " & t2.Duration & " Jam (" & jam & " jam)", ""),
                                                                If(d3 && !d2, "Durasi Live >= " & t3.Duration & " Jam (" & jam & " jam)", ""),
                                                                If(wkd && calc <> "Tier 1", "Weekend (Auto Tier 2 minimum)", ""),
                                                                If(wkd && calc = "Tier 1", "Weekend + memenuhi syarat Tier 1", "")
                                                            ], Value <> ""), Value, " + ")
                                                        ),
                                                        Total_Jam_Live: If(main, jam, 0),
                                                        Schedule: If(main,
                                                            Concat(Sort(mainSeg, StartMin), With({b: BrandID},
                                                                Title & "_" & LookUp(colBrands, Title = b).NamaBrand & "_" & Substitute(StartTime, ":", ".") & "-" & Substitute(EndTime, ":", ".")), ", "),
                                                            "Not Eligible - Main Host " & Round(mainMin / 60, 2) & " jam vs Co-Host " & Round(coMin / 60, 2) & " jam"),
                                                        statusupdate: If(clk.Tier.Value = tier, "Tier tetap " & tier & " (tidak ada perubahan)",
                                                            "Berhasil update dari " & Coalesce(clk.Tier.Value, "-") & " → " & tier)
                                                    })
                                                )))))))))),
                                                // Report tetap tersimpan kalau hitung Tier gagal; hitung ulang bulanan akan membetulkannya.
                                                Notify("Report tersimpan, tapi Tier belum terhitung: " & FirstError.Message, NotificationType.Warning)
                                            )
                                        )
                                    )
                                );
                                ClearCollect(colMySch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date >= Today() - 7, Date <= Today() + 7));
                                ClearCollect(colMyRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate >= Today() - 30));
                                Set(varHdResult, JSON({requestId: rid, status: "ok", message: If(Boolean(p.liveBreak), "Absen tercatat. Live Break: report 0 dibuat otomatis.", "Absen tercatat untuk " & Text(p.scheduleId) & ".")}, JSONFormat.Compact)),
                                Set(varHdResult, JSON({requestId: rid, status: "error", message: "Gagal absen: " & FirstError.Message}, JSONFormat.Compact))
                            )
                        ),
                    "NEW_REPORT",
                        Set(varRptSchedule, Text(p.scheduleId)); Set(varRptId, Blank()); Navigate(scrMyReportDetail),
                    "OPEN_REPORT",
                        Set(varRptId, Value(p.reportId)); Set(varRptSchedule, Text(p.scheduleId)); Navigate(scrMyReportDetail),
                    "OPEN_SCHEDULE",
                        Set(varSchId, Text(p.scheduleId)); Set(varSchDate, DateValue(Text(p.liveDate))); Navigate(scrScheduleDetail),
                    "NAV",
                        // "SCORE": tambahkan Navigate(layar skor) kalau app punya layar skor sendiri.
                        Switch(Text(p.target), "REPORTS", Navigate(scrMyReports), "SCHEDULE", Navigate(scrMySchedule)),
                    // aksi lain: tidak ada yang perlu dilakukan
                    false
                )
            )
        )
    )
)
```

### 10.2 MyReports — `OnChange`

```powerfx
If(!IsBlank(Self.ActionPayload),
    With({req: ParseJSON(Self.ActionPayload)},
        With({act: Text(req.action), rid: Text(req.requestId), p: req.payload},
            If(!(rid in colPbsProcessed.Id),
                Collect(colPbsProcessed, {Id: rid});
                Switch(act,
                    "PERIOD_CHANGED",
                        Set(varMrPeriod, Text(p.period));
                        Set(varMrLoading, true);
                        With({from: If(IsBlank(varMrPeriod), Date(Year(Today()), Month(Today()), 1), DateValue(varMrPeriod & "-01"))},
                            ClearCollect(colMrRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate >= from, LiveDate < DateAdd(from, 1, TimeUnit.Months)));
                            ClearCollect(colMrSch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date >= from, Date < DateAdd(from, 1, TimeUnit.Months)))
                        );
                        Set(varMrLoading, false),
                    "FILTER_CHANGED", Set(varMrFilter, Text(p.filter)),
                    "NEW_REPORT",
                        Set(varRptSchedule, Text(p.scheduleId)); Set(varRptId, Blank()); Navigate(scrMyReportDetail),
                    "OPEN_REPORT",
                        Set(varRptId, Value(p.reportId)); Set(varRptSchedule, Text(p.scheduleId)); Navigate(scrMyReportDetail),
                    // aksi lain: tidak ada yang perlu dilakukan
                    false
                )
            )
        )
    )
)
```

### 10.3 MyReportDetail — `OnChange`

`data: Self.UploadData` dibaca sekali di awal: control mengisi `UploadData` (screenshot) bersamaan dengan
`ActionPayload` dan mengosongkannya di aksi berikutnya. Selama durasi sesi belum terpenuhi (`p.complete = false`)
`varMrdRep` sengaja tidak diisi, jadi form tetap di layar dengan tombol *Send Report berikutnya*.

```powerfx
If(!IsBlank(Self.ActionPayload),
    With({req: ParseJSON(Self.ActionPayload)},
        With({act: Text(req.action), rid: Text(req.requestId), p: req.payload, data: Self.UploadData},
            If(!(rid in colPbsProcessed.Id),
                Collect(colPbsProcessed, {Id: rid});
                Switch(act,
                    "ABSEN",
                        If(!IsBlank(LookUp('Host Absence - PBS Hub', ScheduleID = Text(p.scheduleId) && HostID = varMe.Title)),
                            Set(varMrdResult, JSON({requestId: rid, status: "conflict", message: "Absen sesi ini sudah tercatat."}, JSONFormat.Compact)),
                            IfError(
                                With({s: LookUp('Schedule - PBS Hub', Title = Text(p.scheduleId) && HostID = varMe.Title), lb: Boolean(p.liveBreak)},
                                    With({row: Patch('Host Absence - PBS Hub', Defaults('Host Absence - PBS Hub'), {
                                            ScheduleID: s.Title, HostID: varMe.Title, HostName: Text(p.hostName), LiveDate: s.Date,
                                            BrandID: s.BrandID, Platform: {Value: s.Platform.Value}, Account: LookUp(Choices([@'Host Absence - PBS Hub'].Account), Value = s.Account || Value = LookUp(colAccounts, Title = s.Account).AccountName)
                                            // , Status: {Value: "Present"}   ← nilai Choice Status di Host Absence, kalau kolomnya ada
                                        })},
                                        Patch('Host Absence - PBS Hub', row, {Title: "ABS-" & row.ID});
                                        Collect(colMrdAbs, LookUp('Host Absence - PBS Hub', ID = row.ID));
                                        // Status jadwal dari control: "Waiting Report" (report dibuka) atau "Done" (Live Break / Co-Host).
                                        Patch('Schedule - PBS Hub', s, {Status: {Value: Text(p.scheduleStatus)}});
                                        // Live Break: host tidak perlu report, tapi baris Report tetap dibuat, semua angka 0.
                                        If(lb,
                                            Patch('Schedule - PBS Hub', LookUp('Schedule - PBS Hub', ID = s.ID), {LiveBreak: {Value: "Yes"}});   // Choice Yes/No
                                            With({rep: Patch('Report - PBS Hub', Defaults('Report - PBS Hub'), {
                                                    ScheduleID: s.Title, HostID: varMe.Title, BrandID: s.BrandID, Platform: {Value: s.Platform.Value},
                                                    AccountID: s.Account, Account: LookUp(Choices([@'Report - PBS Hub'].Account), Value = s.Account || Value = LookUp(colAccounts, Title = s.Account).AccountName), LiveDate: s.Date, AbsID: "ABS-" & row.ID,
                                                    Penjualan: 0, Pesanan: 0, ProdukTerjual: 0, JumlahPembeli: 0, CTR: 0, CTOR: 0, PeakViewer: 0,
                                                    'Durasi(Min)': 0, AddToCart: 0, TotalViewer: 0, Comment: 0,
                                                    ApprovalStatus: {Value: "LiveBreak"}
                                                })},
                                                Patch('Report - PBS Hub', rep, {Title: "REP-" & rep.ID})
                                            );
                                            // ---- Tier harian di Clock In: host ini, tanggal s.Date. Aturan sama dengan hitung ulang bulanan.
                                            IfError(
                                                With({tDate: s.Date},
                                                With({clk: LookUp('Clock In - PBS Hub', HostID = varMe.Title && ClockInDate = tDate),
                                                      schDay: Filter('Schedule - PBS Hub', HostID = varMe.Title && Date = tDate),
                                                      repDay: Filter('Report - PBS Hub', HostID = varMe.Title && LiveDate = tDate),
                                                      t1: LookUp(colTierConfig, Title = "Tier 1"), t2: LookUp(colTierConfig, Title = "Tier 2"),
                                                      t3: LookUp(colTierConfig, Title = "Tier 3")},
                                                If(!IsBlank(clk),
                                                // Segmen jadwal aktif (bukan Cancelled, jam lengkap). Lewat tengah malam: EndMin + 1440.
                                                With({seg: ForAll(Filter(schDay, !IsBlank(StartTime) && !IsBlank(EndTime) && Status.Value <> "Cancelled") As S,
                                                            With({sm: Hour(TimeValue(S.StartTime)) * 60 + Minute(TimeValue(S.StartTime)),
                                                                  em: Hour(TimeValue(S.EndTime)) * 60 + Minute(TimeValue(S.EndTime))},
                                                                {Title: S.Title, BrandID: S.BrandID, StartTime: S.StartTime, EndTime: S.EndTime,
                                                                 Co: S.Position.Value = "Co-Host",          // "Host" / "Main Host" = main host
                                                                 StartMin: sm, EndMin: If(em >= sm, em, em + 1440)}))},
                                                With({mainSeg: Filter(seg, !Co), mainMin: Sum(Filter(seg, !Co), EndMin - StartMin), coMin: Sum(Filter(seg, Co), EndMin - StartMin)},
                                                // Grid 15 menit selama 2 hari (0–2880): slot yang tertutup jadwal main host.
                                                With({slots: ForAll(Sequence(2880 / varSlotMin, 0, 1) As Sl,
                                                            With({ms: Sl.Value * varSlotMin}, {SlotStart: ms, Covered: !IsEmpty(Filter(mainSeg, StartMin <= ms && EndMin > ms))}))},
                                                With({liveMin: CountRows(Filter(slots, Covered)) * varSlotMin,
                                                      t1Win: CountRows(Filter(slots, Covered && (SlotStart < 360 || (SlotStart >= 1440 && SlotStart < 1800)))) * varSlotMin,     // 00:00–06:00
                                                      t2Win: CountRows(Filter(slots, Covered && ((SlotStart >= 1260 && SlotStart < 1440) || SlotStart >= 2700))) * varSlotMin,  // 21:00–24:00
                                                      // Akun terbaik hari itu: TotalViewer dijumlah, Peak dan CTR diambil maksimum.
                                                      best: First(Sort(ForAll(Distinct(repDay, Account.Value) As D,
                                                                With({r: Filter(repDay, Account.Value = D.Value)},
                                                                    {Account: D.Value, TotalViewer: Sum(r, TotalViewer), PeakViewer: Max(r, PeakViewer), CTR: Max(r, CTR)})),
                                                            TotalViewer * PeakViewer * CTR, SortOrder.Descending))},
                                                With({m1: !IsBlank(best) && best.TotalViewer >= t1.MinViews && best.CTR >= t1.CTR && best.PeakViewer >= t1.AvgViewDur,
                                                      m2: !IsBlank(best) && best.TotalViewer >= t2.MinViews && best.CTR >= t2.CTR && best.PeakViewer >= t2.AvgViewDur,
                                                      m3: !IsBlank(best) && best.TotalViewer >= t3.MinViews && best.CTR >= t3.CTR && best.PeakViewer >= t3.AvgViewDur,
                                                      d1: liveMin >= t1.Duration * 60, d2: liveMin >= t2.Duration * 60, d3: liveMin >= t3.Duration * 60,
                                                      w1: t1Win >= varT1MinInWindow, w2: t2Win >= varT2MinInWindow,
                                                      jam: Round(liveMin / 60, 2), main: mainMin > coMin,
                                                      hol: tDate in varHolidays, wkd: Weekday(tDate) = 1 || Weekday(tDate) = 7},
                                                With({calc: If(m1 || d1 || w1, "Tier 1", m2 || d2 || w2, "Tier 2", m3 || d3, "Tier 3", "No")},
                                                // Urutan: Co-Host mayoritas → No; tanggal merah → Tier 1; Sabtu/Minggu → minimal Tier 2.
                                                With({tier: If(!main, "No", hol, "Tier 1", wkd && calc <> "Tier 1", "Tier 2", calc)},
                                                    Patch('Clock In - PBS Hub', clk, {
                                                        Tier: {Value: tier},
                                                        Insentif: Switch(tier, "Tier 1", 75000, "Tier 2", 65000, "Tier 3", 55000, 0),
                                                        TotalReports: CountRows(repDay),
                                                        LastTierUpdate: Now(),
                                                        Reason: If(
                                                            !main,
                                                                If(mainMin = 0, "Tidak mendapatkan Tier karena hanya sebagai Co-Host. Main Host: 0 jam, Co-Host: " & Round(coMin / 60, 2) & " jam",
                                                                    "Tidak eligible Tier karena durasi Co-Host lebih besar atau sama dengan Main Host. Main Host: " &
                                                                    Round(mainMin / 60, 2) & " jam, Co-Host: " & Round(coMin / 60, 2) & " jam"),
                                                            hol, "Auto Tier 1 karena Tanggal Merah (Libur Nasional)",
                                                            tier = "No",
                                                                "Belum mencapai target minimum. Views: " & Coalesce(best.TotalViewer, 0) & " (min " & t3.MinViews & "), CTR: " &
                                                                Coalesce(best.CTR, 0) & " (min " & t3.CTR & "), Peak: " & Coalesce(best.PeakViewer, 0) & " (min " & t3.AvgViewDur &
                                                                "), Durasi: " & jam & " jam (min " & t3.Duration & " jam)",
                                                            tier & " karena " & Concat(Filter([
                                                                If(w1, "Jam Live 00:00-06:00 (" & t1Win & " menit, min " & varT1MinInWindow & ")", ""),
                                                                If(w2, "Jam Live 21:00-24:00 (" & t2Win & " menit, min " & varT2MinInWindow & ")", ""),
                                                                If(m1, "Metric Tier 1 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                                If(m2 && !m1, "Metric Tier 2 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                                If(m3 && !m2, "Metric Tier 3 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                                If(d1, "Durasi Live >= " & t1.Duration & " Jam (" & jam & " jam)", ""),
                                                                If(d2 && !d1, "Durasi Live >= " & t2.Duration & " Jam (" & jam & " jam)", ""),
                                                                If(d3 && !d2, "Durasi Live >= " & t3.Duration & " Jam (" & jam & " jam)", ""),
                                                                If(wkd && calc <> "Tier 1", "Weekend (Auto Tier 2 minimum)", ""),
                                                                If(wkd && calc = "Tier 1", "Weekend + memenuhi syarat Tier 1", "")
                                                            ], Value <> ""), Value, " + ")
                                                        ),
                                                        Total_Jam_Live: If(main, jam, 0),
                                                        Schedule: If(main,
                                                            Concat(Sort(mainSeg, StartMin), With({b: BrandID},
                                                                Title & "_" & LookUp(colBrands, Title = b).NamaBrand & "_" & Substitute(StartTime, ":", ".") & "-" & Substitute(EndTime, ":", ".")), ", "),
                                                            "Not Eligible - Main Host " & Round(mainMin / 60, 2) & " jam vs Co-Host " & Round(coMin / 60, 2) & " jam"),
                                                        statusupdate: If(clk.Tier.Value = tier, "Tier tetap " & tier & " (tidak ada perubahan)",
                                                            "Berhasil update dari " & Coalesce(clk.Tier.Value, "-") & " → " & tier)
                                                    })
                                                )))))))))),
                                                // Report tetap tersimpan kalau hitung Tier gagal; hitung ulang bulanan akan membetulkannya.
                                                Notify("Report tersimpan, tapi Tier belum terhitung: " & FirstError.Message, NotificationType.Warning)
                                            )
                                        )
                                    )
                                );
                                Set(varMrdSch, LookUp('Schedule - PBS Hub', ID = varMrdSch.ID));
                                ClearCollect(colMrdSesRep, Filter('Report - PBS Hub', HostID = varMe.Title, ScheduleID = varMrdSch.Title));
                                Set(varMrdResult, JSON({requestId: rid, status: "ok", message: If(Boolean(p.liveBreak), "Absen tercatat. Live Break: report 0 dibuat otomatis.", "Absen tercatat untuk " & Text(p.scheduleId) & ".")}, JSONFormat.Compact)),
                                Set(varMrdResult, JSON({requestId: rid, status: "error", message: "Gagal absen: " & FirstError.Message}, JSONFormat.Compact))
                            )
                        ),
                    "SUBMIT_REPORT",
                        With({m: p.metrics, s: LookUp('Schedule - PBS Hub', Title = Text(p.scheduleId) && HostID = varMe.Title)},
                            // Hapus cabang ini kalau config.requireAbsen = false.
                            If(IsBlank(LookUp('Host Absence - PBS Hub', ScheduleID = Text(p.scheduleId) && HostID = varMe.Title)),
                                Set(varMrdResult, JSON({requestId: rid, status: "error", message: "Absen sesi ini belum tercatat."}, JSONFormat.Compact)),
                            // Report hanya dibuka saat jadwal Waiting Report (hapus kalau config.requireWaitingStatus = false).
                            // Setelah durasi terpenuhi statusnya Done, jadi report tambahan ditolak di sini.
                            s.Status.Value <> "Waiting Report",
                                Set(varMrdResult, JSON({requestId: rid, status: "conflict", message: "Status jadwal " & s.Status.Value & ", report tidak bisa dikirim. Muat ulang dulu."}, JSONFormat.Compact)),
                            // Live terputus boleh punya beberapa report, tapi satu Live ID hanya sekali.
                            !IsBlank(LookUp('Report - PBS Hub', ScheduleID = s.Title && HostID = varMe.Title && LiveID = Text(p.liveId))),
                                Set(varMrdResult, JSON({requestId: rid, status: "conflict", message: "Live ID " & Text(p.liveId) & " sudah dilaporkan untuk sesi ini."}, JSONFormat.Compact)),
                                IfError(
                                    With({row: Patch('Report - PBS Hub', Defaults('Report - PBS Hub'), {
                                            ScheduleID: s.Title, HostID: varMe.Title, BrandID: s.BrandID, Platform: {Value: s.Platform.Value},
                                            AccountID: s.Account, Account: LookUp(Choices([@'Report - PBS Hub'].Account), Value = s.Account || Value = LookUp(colAccounts, Title = s.Account).AccountName), LiveDate: s.Date, AbsID: Text(p.absId),
                                            Penjualan: Value(m.Penjualan), Pesanan: Value(m.Pesanan), ProdukTerjual: Value(m.ProdukTerjual),
                                            JumlahPembeli: Value(m.JumlahPembeli), CTR: Value(m.CTR), CTOR: Value(m.CTOR), PeakViewer: Value(m.PeakViewer),
                                            'Durasi(Min)': Value(m.'Durasi(Min)'), AddToCart: Value(m.AddToCart), TotalViewer: Value(m.TotalViewer),
                                            Comment: Value(m.Comment),
                                            LiveID: Text(p.liveId), Playbook: {Value: Text(p.playbook)},
                                            ApprovalStatus: {Value: "Waiting Approval"}
                                        })},
                                        With({title: "REP-" & row.ID},
                                            Patch('Report - PBS Hub', row, {Title: title});
                                            // Screenshot → Report Automation/<Brand>/<yyyy>/<mmmm>/REP-<ID>/REP-<ID>_<Platform>_<Account>_Report.png
                                            // (Graph PUT, sama dengan app upload jadwal bulk/AI). webUrl dari respons Graph → Attachment.
                                            If(!IsBlank(data),
                                                With({up: Office365Groups.HttpRequest(
                                                        "https://graph.microsoft.com/v1.0/sites/" & varSiteID & "/drives/" & varDriveID & "/root:/Report Automation/" &
                                                        LookUp(colBrands, Title = s.BrandID).NamaBrand & "/" & Text(Today(), "yyyy") & "/" & Text(Today(), "mmmm") & "/" &
                                                        title & "/" & title & "_" & s.Platform.Value & "_" & s.Account & "_Report.png:/content",
                                                        "PUT",
                                                        "data:image/jpeg;base64," & data
                                                    )},
                                                    Patch('Report - PBS Hub', row, {Attachment: Text(up.webUrl)})
                                                )
                                            );
                                            // Total Durasi(Min) semua report sesi ini ≥ durasi jadwal → "Done", kalau belum tetap "Waiting Report".
                                            Patch('Schedule - PBS Hub', s, {Status: {Value: Text(p.scheduleStatus)}});
                                            // ---- Tier harian di Clock In: host ini, tanggal s.Date. Aturan sama dengan hitung ulang bulanan.
                                            IfError(
                                                With({tDate: s.Date},
                                                With({clk: LookUp('Clock In - PBS Hub', HostID = varMe.Title && ClockInDate = tDate),
                                                      schDay: Filter('Schedule - PBS Hub', HostID = varMe.Title && Date = tDate),
                                                      repDay: Filter('Report - PBS Hub', HostID = varMe.Title && LiveDate = tDate),
                                                      t1: LookUp(colTierConfig, Title = "Tier 1"), t2: LookUp(colTierConfig, Title = "Tier 2"),
                                                      t3: LookUp(colTierConfig, Title = "Tier 3")},
                                                If(!IsBlank(clk),
                                                // Segmen jadwal aktif (bukan Cancelled, jam lengkap). Lewat tengah malam: EndMin + 1440.
                                                With({seg: ForAll(Filter(schDay, !IsBlank(StartTime) && !IsBlank(EndTime) && Status.Value <> "Cancelled") As S,
                                                            With({sm: Hour(TimeValue(S.StartTime)) * 60 + Minute(TimeValue(S.StartTime)),
                                                                  em: Hour(TimeValue(S.EndTime)) * 60 + Minute(TimeValue(S.EndTime))},
                                                                {Title: S.Title, BrandID: S.BrandID, StartTime: S.StartTime, EndTime: S.EndTime,
                                                                 Co: S.Position.Value = "Co-Host",          // "Host" / "Main Host" = main host
                                                                 StartMin: sm, EndMin: If(em >= sm, em, em + 1440)}))},
                                                With({mainSeg: Filter(seg, !Co), mainMin: Sum(Filter(seg, !Co), EndMin - StartMin), coMin: Sum(Filter(seg, Co), EndMin - StartMin)},
                                                // Grid 15 menit selama 2 hari (0–2880): slot yang tertutup jadwal main host.
                                                With({slots: ForAll(Sequence(2880 / varSlotMin, 0, 1) As Sl,
                                                            With({ms: Sl.Value * varSlotMin}, {SlotStart: ms, Covered: !IsEmpty(Filter(mainSeg, StartMin <= ms && EndMin > ms))}))},
                                                With({liveMin: CountRows(Filter(slots, Covered)) * varSlotMin,
                                                      t1Win: CountRows(Filter(slots, Covered && (SlotStart < 360 || (SlotStart >= 1440 && SlotStart < 1800)))) * varSlotMin,     // 00:00–06:00
                                                      t2Win: CountRows(Filter(slots, Covered && ((SlotStart >= 1260 && SlotStart < 1440) || SlotStart >= 2700))) * varSlotMin,  // 21:00–24:00
                                                      // Akun terbaik hari itu: TotalViewer dijumlah, Peak dan CTR diambil maksimum.
                                                      best: First(Sort(ForAll(Distinct(repDay, Account.Value) As D,
                                                                With({r: Filter(repDay, Account.Value = D.Value)},
                                                                    {Account: D.Value, TotalViewer: Sum(r, TotalViewer), PeakViewer: Max(r, PeakViewer), CTR: Max(r, CTR)})),
                                                            TotalViewer * PeakViewer * CTR, SortOrder.Descending))},
                                                With({m1: !IsBlank(best) && best.TotalViewer >= t1.MinViews && best.CTR >= t1.CTR && best.PeakViewer >= t1.AvgViewDur,
                                                      m2: !IsBlank(best) && best.TotalViewer >= t2.MinViews && best.CTR >= t2.CTR && best.PeakViewer >= t2.AvgViewDur,
                                                      m3: !IsBlank(best) && best.TotalViewer >= t3.MinViews && best.CTR >= t3.CTR && best.PeakViewer >= t3.AvgViewDur,
                                                      d1: liveMin >= t1.Duration * 60, d2: liveMin >= t2.Duration * 60, d3: liveMin >= t3.Duration * 60,
                                                      w1: t1Win >= varT1MinInWindow, w2: t2Win >= varT2MinInWindow,
                                                      jam: Round(liveMin / 60, 2), main: mainMin > coMin,
                                                      hol: tDate in varHolidays, wkd: Weekday(tDate) = 1 || Weekday(tDate) = 7},
                                                With({calc: If(m1 || d1 || w1, "Tier 1", m2 || d2 || w2, "Tier 2", m3 || d3, "Tier 3", "No")},
                                                // Urutan: Co-Host mayoritas → No; tanggal merah → Tier 1; Sabtu/Minggu → minimal Tier 2.
                                                With({tier: If(!main, "No", hol, "Tier 1", wkd && calc <> "Tier 1", "Tier 2", calc)},
                                                    Patch('Clock In - PBS Hub', clk, {
                                                        Tier: {Value: tier},
                                                        Insentif: Switch(tier, "Tier 1", 75000, "Tier 2", 65000, "Tier 3", 55000, 0),
                                                        TotalReports: CountRows(repDay),
                                                        LastTierUpdate: Now(),
                                                        Reason: If(
                                                            !main,
                                                                If(mainMin = 0, "Tidak mendapatkan Tier karena hanya sebagai Co-Host. Main Host: 0 jam, Co-Host: " & Round(coMin / 60, 2) & " jam",
                                                                    "Tidak eligible Tier karena durasi Co-Host lebih besar atau sama dengan Main Host. Main Host: " &
                                                                    Round(mainMin / 60, 2) & " jam, Co-Host: " & Round(coMin / 60, 2) & " jam"),
                                                            hol, "Auto Tier 1 karena Tanggal Merah (Libur Nasional)",
                                                            tier = "No",
                                                                "Belum mencapai target minimum. Views: " & Coalesce(best.TotalViewer, 0) & " (min " & t3.MinViews & "), CTR: " &
                                                                Coalesce(best.CTR, 0) & " (min " & t3.CTR & "), Peak: " & Coalesce(best.PeakViewer, 0) & " (min " & t3.AvgViewDur &
                                                                "), Durasi: " & jam & " jam (min " & t3.Duration & " jam)",
                                                            tier & " karena " & Concat(Filter([
                                                                If(w1, "Jam Live 00:00-06:00 (" & t1Win & " menit, min " & varT1MinInWindow & ")", ""),
                                                                If(w2, "Jam Live 21:00-24:00 (" & t2Win & " menit, min " & varT2MinInWindow & ")", ""),
                                                                If(m1, "Metric Tier 1 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                                If(m2 && !m1, "Metric Tier 2 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                                If(m3 && !m2, "Metric Tier 3 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                                If(d1, "Durasi Live >= " & t1.Duration & " Jam (" & jam & " jam)", ""),
                                                                If(d2 && !d1, "Durasi Live >= " & t2.Duration & " Jam (" & jam & " jam)", ""),
                                                                If(d3 && !d2, "Durasi Live >= " & t3.Duration & " Jam (" & jam & " jam)", ""),
                                                                If(wkd && calc <> "Tier 1", "Weekend (Auto Tier 2 minimum)", ""),
                                                                If(wkd && calc = "Tier 1", "Weekend + memenuhi syarat Tier 1", "")
                                                            ], Value <> ""), Value, " + ")
                                                        ),
                                                        Total_Jam_Live: If(main, jam, 0),
                                                        Schedule: If(main,
                                                            Concat(Sort(mainSeg, StartMin), With({b: BrandID},
                                                                Title & "_" & LookUp(colBrands, Title = b).NamaBrand & "_" & Substitute(StartTime, ":", ".") & "-" & Substitute(EndTime, ":", ".")), ", "),
                                                            "Not Eligible - Main Host " & Round(mainMin / 60, 2) & " jam vs Co-Host " & Round(coMin / 60, 2) & " jam"),
                                                        statusupdate: If(clk.Tier.Value = tier, "Tier tetap " & tier & " (tidak ada perubahan)",
                                                            "Berhasil update dari " & Coalesce(clk.Tier.Value, "-") & " → " & tier)
                                                    })
                                                )))))))))),
                                                // Report tetap tersimpan kalau hitung Tier gagal; hitung ulang bulanan akan membetulkannya.
                                                Notify("Report tersimpan, tapi Tier belum terhitung: " & FirstError.Message, NotificationType.Warning)
                                            );
                                            Set(varMrdSch, LookUp('Schedule - PBS Hub', ID = varMrdSch.ID));
                                            ClearCollect(colMrdSesRep, Filter('Report - PBS Hub', HostID = varMe.Title, ScheduleID = varMrdSch.Title));
                                            If(Boolean(p.complete), Set(varRptId, row.ID); Set(varMrdRep, LookUp('Report - PBS Hub', ID = row.ID)));
                                            Set(varMrdResult, JSON({requestId: rid, status: "ok", message: If(Boolean(p.complete), "Report " & title & " terkirim. Durasi sesi terpenuhi.", "Report " & title & " terkirim. Kurang " & Text(p.remainingMin) & " menit, kirim report berikutnya.")}, JSONFormat.Compact))
                                        )
                                    ),
                                    Set(varMrdResult, JSON({requestId: rid, status: "error", message: "Gagal mengirim report: " & FirstError.Message}, JSONFormat.Compact))
                                )
                            )
                        ),
                    "RESUBMIT_REPORT",
                        With({cur: LookUp('Report - PBS Hub', ID = Value(p.reportId) && HostID = varMe.Title), m: p.metrics},
                            // Modified dari JSON berformat UTC ("…Z"); DateTimeValue mengubahnya ke jam lokal sebelum dibandingkan.
                            If(IsBlank(cur) || cur.ApprovalStatus.Value <> "Need Revision" ||
                               Abs(DateDiff(cur.Modified, DateTimeValue(Text(p.expectedModified)), TimeUnit.Seconds)) > 1,
                                Set(varMrdResult, JSON({requestId: rid, status: "conflict", message: "Report ini sudah berubah. Muat ulang dulu."}, JSONFormat.Compact)),
                                IfError(
                                    Patch('Report - PBS Hub', cur, {
                                        Penjualan: Value(m.Penjualan), Pesanan: Value(m.Pesanan), ProdukTerjual: Value(m.ProdukTerjual),
                                        JumlahPembeli: Value(m.JumlahPembeli), CTR: Value(m.CTR), CTOR: Value(m.CTOR), PeakViewer: Value(m.PeakViewer),
                                        'Durasi(Min)': Value(m.'Durasi(Min)'), AddToCart: Value(m.AddToCart), TotalViewer: Value(m.TotalViewer),
                                        Comment: Value(m.Comment),
                                        LiveID: Text(p.liveId), Playbook: {Value: Text(p.playbook)},
                                        ApprovalStatus: {Value: Text(p.approvalStatus)},   // "Waiting Approval Revision"
                                        ApprovalComment: cur.ApprovalComment & Char(10) & "[Revisi host] " &
                                            If(IsBlank(Text(p.note)), "angka diperbaiki: " & Concat(Table(p.changed), Text(ThisRecord.Value), ", "), Text(p.note))
                                    });
                                    // Report Automation dengan Title yang sama: hanya Status yang diubah (Unmatch → dibaca ulang).
                                    With({ev: LookUp('Report Automation - PBS Hub', Title = cur.Title)},
                                        If(!IsBlank(ev), Patch('Report Automation - PBS Hub', ev, {Status: {Value: Text(p.evidenceStatus)}}))
                                    );
                                    // Screenshot baru (opsional): path dan nama file sama dengan upload pertama (folder bulan dari Created)
                                    // → file lama ditimpa, flow AI membaca ulang.
                                    If(!IsBlank(p.file) && !IsBlank(data),
                                        With({up: Office365Groups.HttpRequest(
                                                "https://graph.microsoft.com/v1.0/sites/" & varSiteID & "/drives/" & varDriveID & "/root:/Report Automation/" &
                                                LookUp(colBrands, Title = cur.BrandID).NamaBrand & "/" & Text(cur.Created, "yyyy") & "/" & Text(cur.Created, "mmmm") & "/" &
                                                cur.Title & "/" & cur.Title & "_" & cur.Platform.Value & "_" & cur.AccountID & "_Report.png:/content",
                                                "PUT",
                                                "data:image/jpeg;base64," & data
                                            )},
                                            Patch('Report - PBS Hub', LookUp('Report - PBS Hub', ID = cur.ID), {Attachment: Text(up.webUrl)}))
                                    );
                                    // Durasi bisa ikut direvisi: status jadwal dihitung ulang oleh control (Waiting Report / Done).
                                    If(!IsBlank(Text(p.scheduleStatus)),
                                        Patch('Schedule - PBS Hub', LookUp('Schedule - PBS Hub', Title = cur.ScheduleID && HostID = varMe.Title), {Status: {Value: Text(p.scheduleStatus)}}));
                                    // Angka berubah → Tier hari itu dihitung ulang.
                                    // ---- Tier harian di Clock In: host ini, tanggal cur.LiveDate. Aturan sama dengan hitung ulang bulanan.
                                    IfError(
                                        With({tDate: cur.LiveDate},
                                        With({clk: LookUp('Clock In - PBS Hub', HostID = varMe.Title && ClockInDate = tDate),
                                              schDay: Filter('Schedule - PBS Hub', HostID = varMe.Title && Date = tDate),
                                              repDay: Filter('Report - PBS Hub', HostID = varMe.Title && LiveDate = tDate),
                                              t1: LookUp(colTierConfig, Title = "Tier 1"), t2: LookUp(colTierConfig, Title = "Tier 2"),
                                              t3: LookUp(colTierConfig, Title = "Tier 3")},
                                        If(!IsBlank(clk),
                                        // Segmen jadwal aktif (bukan Cancelled, jam lengkap). Lewat tengah malam: EndMin + 1440.
                                        With({seg: ForAll(Filter(schDay, !IsBlank(StartTime) && !IsBlank(EndTime) && Status.Value <> "Cancelled") As S,
                                                    With({sm: Hour(TimeValue(S.StartTime)) * 60 + Minute(TimeValue(S.StartTime)),
                                                          em: Hour(TimeValue(S.EndTime)) * 60 + Minute(TimeValue(S.EndTime))},
                                                        {Title: S.Title, BrandID: S.BrandID, StartTime: S.StartTime, EndTime: S.EndTime,
                                                         Co: S.Position.Value = "Co-Host",          // "Host" / "Main Host" = main host
                                                         StartMin: sm, EndMin: If(em >= sm, em, em + 1440)}))},
                                        With({mainSeg: Filter(seg, !Co), mainMin: Sum(Filter(seg, !Co), EndMin - StartMin), coMin: Sum(Filter(seg, Co), EndMin - StartMin)},
                                        // Grid 15 menit selama 2 hari (0–2880): slot yang tertutup jadwal main host.
                                        With({slots: ForAll(Sequence(2880 / varSlotMin, 0, 1) As Sl,
                                                    With({ms: Sl.Value * varSlotMin}, {SlotStart: ms, Covered: !IsEmpty(Filter(mainSeg, StartMin <= ms && EndMin > ms))}))},
                                        With({liveMin: CountRows(Filter(slots, Covered)) * varSlotMin,
                                              t1Win: CountRows(Filter(slots, Covered && (SlotStart < 360 || (SlotStart >= 1440 && SlotStart < 1800)))) * varSlotMin,     // 00:00–06:00
                                              t2Win: CountRows(Filter(slots, Covered && ((SlotStart >= 1260 && SlotStart < 1440) || SlotStart >= 2700))) * varSlotMin,  // 21:00–24:00
                                              // Akun terbaik hari itu: TotalViewer dijumlah, Peak dan CTR diambil maksimum.
                                              best: First(Sort(ForAll(Distinct(repDay, Account.Value) As D,
                                                        With({r: Filter(repDay, Account.Value = D.Value)},
                                                            {Account: D.Value, TotalViewer: Sum(r, TotalViewer), PeakViewer: Max(r, PeakViewer), CTR: Max(r, CTR)})),
                                                    TotalViewer * PeakViewer * CTR, SortOrder.Descending))},
                                        With({m1: !IsBlank(best) && best.TotalViewer >= t1.MinViews && best.CTR >= t1.CTR && best.PeakViewer >= t1.AvgViewDur,
                                              m2: !IsBlank(best) && best.TotalViewer >= t2.MinViews && best.CTR >= t2.CTR && best.PeakViewer >= t2.AvgViewDur,
                                              m3: !IsBlank(best) && best.TotalViewer >= t3.MinViews && best.CTR >= t3.CTR && best.PeakViewer >= t3.AvgViewDur,
                                              d1: liveMin >= t1.Duration * 60, d2: liveMin >= t2.Duration * 60, d3: liveMin >= t3.Duration * 60,
                                              w1: t1Win >= varT1MinInWindow, w2: t2Win >= varT2MinInWindow,
                                              jam: Round(liveMin / 60, 2), main: mainMin > coMin,
                                              hol: tDate in varHolidays, wkd: Weekday(tDate) = 1 || Weekday(tDate) = 7},
                                        With({calc: If(m1 || d1 || w1, "Tier 1", m2 || d2 || w2, "Tier 2", m3 || d3, "Tier 3", "No")},
                                        // Urutan: Co-Host mayoritas → No; tanggal merah → Tier 1; Sabtu/Minggu → minimal Tier 2.
                                        With({tier: If(!main, "No", hol, "Tier 1", wkd && calc <> "Tier 1", "Tier 2", calc)},
                                            Patch('Clock In - PBS Hub', clk, {
                                                Tier: {Value: tier},
                                                Insentif: Switch(tier, "Tier 1", 75000, "Tier 2", 65000, "Tier 3", 55000, 0),
                                                TotalReports: CountRows(repDay),
                                                LastTierUpdate: Now(),
                                                Reason: If(
                                                    !main,
                                                        If(mainMin = 0, "Tidak mendapatkan Tier karena hanya sebagai Co-Host. Main Host: 0 jam, Co-Host: " & Round(coMin / 60, 2) & " jam",
                                                            "Tidak eligible Tier karena durasi Co-Host lebih besar atau sama dengan Main Host. Main Host: " &
                                                            Round(mainMin / 60, 2) & " jam, Co-Host: " & Round(coMin / 60, 2) & " jam"),
                                                    hol, "Auto Tier 1 karena Tanggal Merah (Libur Nasional)",
                                                    tier = "No",
                                                        "Belum mencapai target minimum. Views: " & Coalesce(best.TotalViewer, 0) & " (min " & t3.MinViews & "), CTR: " &
                                                        Coalesce(best.CTR, 0) & " (min " & t3.CTR & "), Peak: " & Coalesce(best.PeakViewer, 0) & " (min " & t3.AvgViewDur &
                                                        "), Durasi: " & jam & " jam (min " & t3.Duration & " jam)",
                                                    tier & " karena " & Concat(Filter([
                                                        If(w1, "Jam Live 00:00-06:00 (" & t1Win & " menit, min " & varT1MinInWindow & ")", ""),
                                                        If(w2, "Jam Live 21:00-24:00 (" & t2Win & " menit, min " & varT2MinInWindow & ")", ""),
                                                        If(m1, "Metric Tier 1 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                        If(m2 && !m1, "Metric Tier 2 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                        If(m3 && !m2, "Metric Tier 3 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                        If(d1, "Durasi Live >= " & t1.Duration & " Jam (" & jam & " jam)", ""),
                                                        If(d2 && !d1, "Durasi Live >= " & t2.Duration & " Jam (" & jam & " jam)", ""),
                                                        If(d3 && !d2, "Durasi Live >= " & t3.Duration & " Jam (" & jam & " jam)", ""),
                                                        If(wkd && calc <> "Tier 1", "Weekend (Auto Tier 2 minimum)", ""),
                                                        If(wkd && calc = "Tier 1", "Weekend + memenuhi syarat Tier 1", "")
                                                    ], Value <> ""), Value, " + ")
                                                ),
                                                Total_Jam_Live: If(main, jam, 0),
                                                Schedule: If(main,
                                                    Concat(Sort(mainSeg, StartMin), With({b: BrandID},
                                                        Title & "_" & LookUp(colBrands, Title = b).NamaBrand & "_" & Substitute(StartTime, ":", ".") & "-" & Substitute(EndTime, ":", ".")), ", "),
                                                    "Not Eligible - Main Host " & Round(mainMin / 60, 2) & " jam vs Co-Host " & Round(coMin / 60, 2) & " jam"),
                                                statusupdate: If(clk.Tier.Value = tier, "Tier tetap " & tier & " (tidak ada perubahan)",
                                                    "Berhasil update dari " & Coalesce(clk.Tier.Value, "-") & " → " & tier)
                                            })
                                        )))))))))),
                                        // Report tetap tersimpan kalau hitung Tier gagal; hitung ulang bulanan akan membetulkannya.
                                        Notify("Report tersimpan, tapi Tier belum terhitung: " & FirstError.Message, NotificationType.Warning)
                                    );
                                    Set(varMrdRep, LookUp('Report - PBS Hub', ID = cur.ID));
                                    Set(varMrdSch, LookUp('Schedule - PBS Hub', ID = varMrdSch.ID));
                                    ClearCollect(colMrdSesRep, Filter('Report - PBS Hub', HostID = varMe.Title, ScheduleID = varMrdSch.Title));
                                    Set(varMrdResult, JSON({requestId: rid, status: "ok", message: "Revisi terkirim, menunggu review ulang."}, JSONFormat.Compact)),
                                    Set(varMrdResult, JSON({requestId: rid, status: "error", message: "Gagal mengirim revisi: " & FirstError.Message}, JSONFormat.Compact))
                                )
                            )
                        ),
                    "DISPUTE_REVIEW",
                        With({cur: LookUp('Report - PBS Hub', ID = Value(p.reportId) && HostID = varMe.Title)},
                            If(IsBlank(cur) || cur.ApprovalStatus.Value <> "Need Revision",
                                Set(varMrdResult, JSON({requestId: rid, status: "conflict", message: "Report ini sudah tidak menunggu revisi. Muat ulang dulu."}, JSONFormat.Compact)),
                                IfError(
                                    // Status tetap Need Revision; reviewer membaca sanggahan di ApprovalComment.
                                    Patch('Report - PBS Hub', cur, {ApprovalComment: cur.ApprovalComment & Char(10) & "[Sanggahan host] " & Text(p.reason)});
                                    Set(varMrdRep, LookUp('Report - PBS Hub', ID = cur.ID));
                                    Set(varMrdSch, LookUp('Schedule - PBS Hub', ID = varMrdSch.ID));
                                    ClearCollect(colMrdSesRep, Filter('Report - PBS Hub', HostID = varMe.Title, ScheduleID = varMrdSch.Title));
                                    Set(varMrdResult, JSON({requestId: rid, status: "ok", message: "Sanggahan terkirim ke reviewer."}, JSONFormat.Compact)),
                                    Set(varMrdResult, JSON({requestId: rid, status: "error", message: "Gagal mengirim sanggahan: " & FirstError.Message}, JSONFormat.Compact))
                                )
                            )
                        ),
                    "OPEN_EVIDENCE", Launch(Text(p.url)),
                    "BACK", Back(),
                    // aksi lain: tidak ada yang perlu dilakukan
                    false
                )
            )
        )
    )
)
```

### 10.4 MySchedule — `OnChange`

```powerfx
If(!IsBlank(Self.ActionPayload),
    With({req: ParseJSON(Self.ActionPayload)},
        With({act: Text(req.action), rid: Text(req.requestId), p: req.payload},
            If(!(rid in colPbsProcessed.Id),
                Collect(colPbsProcessed, {Id: rid});
                Switch(act,
                    "OPEN_SCHEDULE",
                        Set(varSchId, Text(p.scheduleId)); Set(varSchDate, DateValue(Text(p.liveDate))); Navigate(scrScheduleDetail),
                    "ABSEN",
                        If(!IsBlank(LookUp('Host Absence - PBS Hub', ScheduleID = Text(p.scheduleId) && HostID = varMe.Title)),
                            Set(varMsResult, JSON({requestId: rid, status: "conflict", message: "Absen sesi ini sudah tercatat."}, JSONFormat.Compact)),
                            IfError(
                                With({s: LookUp('Schedule - PBS Hub', Title = Text(p.scheduleId) && HostID = varMe.Title), lb: Boolean(p.liveBreak)},
                                    With({row: Patch('Host Absence - PBS Hub', Defaults('Host Absence - PBS Hub'), {
                                            ScheduleID: s.Title, HostID: varMe.Title, HostName: Text(p.hostName), LiveDate: s.Date,
                                            BrandID: s.BrandID, Platform: {Value: s.Platform.Value}, Account: LookUp(Choices([@'Host Absence - PBS Hub'].Account), Value = s.Account || Value = LookUp(colAccounts, Title = s.Account).AccountName)
                                            // , Status: {Value: "Present"}   ← nilai Choice Status di Host Absence, kalau kolomnya ada
                                        })},
                                        Patch('Host Absence - PBS Hub', row, {Title: "ABS-" & row.ID});
                                        Collect(colMsAbs, LookUp('Host Absence - PBS Hub', ID = row.ID));
                                        // Status jadwal dari control: "Waiting Report" (report dibuka) atau "Done" (Live Break / Co-Host).
                                        Patch('Schedule - PBS Hub', s, {Status: {Value: Text(p.scheduleStatus)}});
                                        // Live Break: host tidak perlu report, tapi baris Report tetap dibuat, semua angka 0.
                                        If(lb,
                                            Patch('Schedule - PBS Hub', LookUp('Schedule - PBS Hub', ID = s.ID), {LiveBreak: {Value: "Yes"}});   // Choice Yes/No
                                            With({rep: Patch('Report - PBS Hub', Defaults('Report - PBS Hub'), {
                                                    ScheduleID: s.Title, HostID: varMe.Title, BrandID: s.BrandID, Platform: {Value: s.Platform.Value},
                                                    AccountID: s.Account, Account: LookUp(Choices([@'Report - PBS Hub'].Account), Value = s.Account || Value = LookUp(colAccounts, Title = s.Account).AccountName), LiveDate: s.Date, AbsID: "ABS-" & row.ID,
                                                    Penjualan: 0, Pesanan: 0, ProdukTerjual: 0, JumlahPembeli: 0, CTR: 0, CTOR: 0, PeakViewer: 0,
                                                    'Durasi(Min)': 0, AddToCart: 0, TotalViewer: 0, Comment: 0,
                                                    ApprovalStatus: {Value: "LiveBreak"}
                                                })},
                                                Patch('Report - PBS Hub', rep, {Title: "REP-" & rep.ID})
                                            );
                                            // ---- Tier harian di Clock In: host ini, tanggal s.Date. Aturan sama dengan hitung ulang bulanan.
                                            IfError(
                                                With({tDate: s.Date},
                                                With({clk: LookUp('Clock In - PBS Hub', HostID = varMe.Title && ClockInDate = tDate),
                                                      schDay: Filter('Schedule - PBS Hub', HostID = varMe.Title && Date = tDate),
                                                      repDay: Filter('Report - PBS Hub', HostID = varMe.Title && LiveDate = tDate),
                                                      t1: LookUp(colTierConfig, Title = "Tier 1"), t2: LookUp(colTierConfig, Title = "Tier 2"),
                                                      t3: LookUp(colTierConfig, Title = "Tier 3")},
                                                If(!IsBlank(clk),
                                                // Segmen jadwal aktif (bukan Cancelled, jam lengkap). Lewat tengah malam: EndMin + 1440.
                                                With({seg: ForAll(Filter(schDay, !IsBlank(StartTime) && !IsBlank(EndTime) && Status.Value <> "Cancelled") As S,
                                                            With({sm: Hour(TimeValue(S.StartTime)) * 60 + Minute(TimeValue(S.StartTime)),
                                                                  em: Hour(TimeValue(S.EndTime)) * 60 + Minute(TimeValue(S.EndTime))},
                                                                {Title: S.Title, BrandID: S.BrandID, StartTime: S.StartTime, EndTime: S.EndTime,
                                                                 Co: S.Position.Value = "Co-Host",          // "Host" / "Main Host" = main host
                                                                 StartMin: sm, EndMin: If(em >= sm, em, em + 1440)}))},
                                                With({mainSeg: Filter(seg, !Co), mainMin: Sum(Filter(seg, !Co), EndMin - StartMin), coMin: Sum(Filter(seg, Co), EndMin - StartMin)},
                                                // Grid 15 menit selama 2 hari (0–2880): slot yang tertutup jadwal main host.
                                                With({slots: ForAll(Sequence(2880 / varSlotMin, 0, 1) As Sl,
                                                            With({ms: Sl.Value * varSlotMin}, {SlotStart: ms, Covered: !IsEmpty(Filter(mainSeg, StartMin <= ms && EndMin > ms))}))},
                                                With({liveMin: CountRows(Filter(slots, Covered)) * varSlotMin,
                                                      t1Win: CountRows(Filter(slots, Covered && (SlotStart < 360 || (SlotStart >= 1440 && SlotStart < 1800)))) * varSlotMin,     // 00:00–06:00
                                                      t2Win: CountRows(Filter(slots, Covered && ((SlotStart >= 1260 && SlotStart < 1440) || SlotStart >= 2700))) * varSlotMin,  // 21:00–24:00
                                                      // Akun terbaik hari itu: TotalViewer dijumlah, Peak dan CTR diambil maksimum.
                                                      best: First(Sort(ForAll(Distinct(repDay, Account.Value) As D,
                                                                With({r: Filter(repDay, Account.Value = D.Value)},
                                                                    {Account: D.Value, TotalViewer: Sum(r, TotalViewer), PeakViewer: Max(r, PeakViewer), CTR: Max(r, CTR)})),
                                                            TotalViewer * PeakViewer * CTR, SortOrder.Descending))},
                                                With({m1: !IsBlank(best) && best.TotalViewer >= t1.MinViews && best.CTR >= t1.CTR && best.PeakViewer >= t1.AvgViewDur,
                                                      m2: !IsBlank(best) && best.TotalViewer >= t2.MinViews && best.CTR >= t2.CTR && best.PeakViewer >= t2.AvgViewDur,
                                                      m3: !IsBlank(best) && best.TotalViewer >= t3.MinViews && best.CTR >= t3.CTR && best.PeakViewer >= t3.AvgViewDur,
                                                      d1: liveMin >= t1.Duration * 60, d2: liveMin >= t2.Duration * 60, d3: liveMin >= t3.Duration * 60,
                                                      w1: t1Win >= varT1MinInWindow, w2: t2Win >= varT2MinInWindow,
                                                      jam: Round(liveMin / 60, 2), main: mainMin > coMin,
                                                      hol: tDate in varHolidays, wkd: Weekday(tDate) = 1 || Weekday(tDate) = 7},
                                                With({calc: If(m1 || d1 || w1, "Tier 1", m2 || d2 || w2, "Tier 2", m3 || d3, "Tier 3", "No")},
                                                // Urutan: Co-Host mayoritas → No; tanggal merah → Tier 1; Sabtu/Minggu → minimal Tier 2.
                                                With({tier: If(!main, "No", hol, "Tier 1", wkd && calc <> "Tier 1", "Tier 2", calc)},
                                                    Patch('Clock In - PBS Hub', clk, {
                                                        Tier: {Value: tier},
                                                        Insentif: Switch(tier, "Tier 1", 75000, "Tier 2", 65000, "Tier 3", 55000, 0),
                                                        TotalReports: CountRows(repDay),
                                                        LastTierUpdate: Now(),
                                                        Reason: If(
                                                            !main,
                                                                If(mainMin = 0, "Tidak mendapatkan Tier karena hanya sebagai Co-Host. Main Host: 0 jam, Co-Host: " & Round(coMin / 60, 2) & " jam",
                                                                    "Tidak eligible Tier karena durasi Co-Host lebih besar atau sama dengan Main Host. Main Host: " &
                                                                    Round(mainMin / 60, 2) & " jam, Co-Host: " & Round(coMin / 60, 2) & " jam"),
                                                            hol, "Auto Tier 1 karena Tanggal Merah (Libur Nasional)",
                                                            tier = "No",
                                                                "Belum mencapai target minimum. Views: " & Coalesce(best.TotalViewer, 0) & " (min " & t3.MinViews & "), CTR: " &
                                                                Coalesce(best.CTR, 0) & " (min " & t3.CTR & "), Peak: " & Coalesce(best.PeakViewer, 0) & " (min " & t3.AvgViewDur &
                                                                "), Durasi: " & jam & " jam (min " & t3.Duration & " jam)",
                                                            tier & " karena " & Concat(Filter([
                                                                If(w1, "Jam Live 00:00-06:00 (" & t1Win & " menit, min " & varT1MinInWindow & ")", ""),
                                                                If(w2, "Jam Live 21:00-24:00 (" & t2Win & " menit, min " & varT2MinInWindow & ")", ""),
                                                                If(m1, "Metric Tier 1 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                                If(m2 && !m1, "Metric Tier 2 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                                If(m3 && !m2, "Metric Tier 3 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                                If(d1, "Durasi Live >= " & t1.Duration & " Jam (" & jam & " jam)", ""),
                                                                If(d2 && !d1, "Durasi Live >= " & t2.Duration & " Jam (" & jam & " jam)", ""),
                                                                If(d3 && !d2, "Durasi Live >= " & t3.Duration & " Jam (" & jam & " jam)", ""),
                                                                If(wkd && calc <> "Tier 1", "Weekend (Auto Tier 2 minimum)", ""),
                                                                If(wkd && calc = "Tier 1", "Weekend + memenuhi syarat Tier 1", "")
                                                            ], Value <> ""), Value, " + ")
                                                        ),
                                                        Total_Jam_Live: If(main, jam, 0),
                                                        Schedule: If(main,
                                                            Concat(Sort(mainSeg, StartMin), With({b: BrandID},
                                                                Title & "_" & LookUp(colBrands, Title = b).NamaBrand & "_" & Substitute(StartTime, ":", ".") & "-" & Substitute(EndTime, ":", ".")), ", "),
                                                            "Not Eligible - Main Host " & Round(mainMin / 60, 2) & " jam vs Co-Host " & Round(coMin / 60, 2) & " jam"),
                                                        statusupdate: If(clk.Tier.Value = tier, "Tier tetap " & tier & " (tidak ada perubahan)",
                                                            "Berhasil update dari " & Coalesce(clk.Tier.Value, "-") & " → " & tier)
                                                    })
                                                )))))))))),
                                                // Report tetap tersimpan kalau hitung Tier gagal; hitung ulang bulanan akan membetulkannya.
                                                Notify("Report tersimpan, tapi Tier belum terhitung: " & FirstError.Message, NotificationType.Warning)
                                            )
                                        )
                                    )
                                );
                                With({from: If(IsBlank(varMsPeriod), Date(Year(Today()), Month(Today()), 1), DateValue(varMsPeriod & "-01"))},
                                    ClearCollect(colMsSch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date >= from, Date < DateAdd(from, 1, TimeUnit.Months)));
                                    ClearCollect(colMsRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate >= from, LiveDate < DateAdd(from, 1, TimeUnit.Months)))
                                );
                                Set(varMsResult, JSON({requestId: rid, status: "ok", message: If(Boolean(p.liveBreak), "Absen tercatat. Live Break: report 0 dibuat otomatis.", "Absen tercatat untuk " & Text(p.scheduleId) & ".")}, JSONFormat.Compact)),
                                Set(varMsResult, JSON({requestId: rid, status: "error", message: "Gagal absen: " & FirstError.Message}, JSONFormat.Compact))
                            )
                        ),
                    "CLOCK_IN", Navigate(scrClockIn),
                    "NEW_REPORT",
                        Set(varRptSchedule, Text(p.scheduleId)); Set(varRptId, Blank()); Navigate(scrMyReportDetail),
                    "OPEN_REPORT",
                        Set(varRptId, Value(p.reportId)); Set(varRptSchedule, Text(p.scheduleId)); Navigate(scrMyReportDetail),
                    "PERIOD_CHANGED",
                        Set(varMsPeriod, Text(p.period));
                        Set(varMsLoading, true);
                        With({from: If(IsBlank(varMsPeriod), Date(Year(Today()), Month(Today()), 1), DateValue(varMsPeriod & "-01"))},
                            With({to: DateAdd(from, 1, TimeUnit.Months)},
                                ClearCollect(colMsSch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date >= from, Date < to));
                                ClearCollect(colMsClk, Filter('Clock In - PBS Hub', HostID = varMe.Title, ClockInDate >= from, ClockInDate < to));
                                ClearCollect(colMsAbs, Filter('Host Absence - PBS Hub', HostID = varMe.Title, LiveDate >= from, LiveDate < to));
                                ClearCollect(colMsRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate >= from, LiveDate < to))
                            )
                        );
                        Set(varMsLoading, false),
                    "FILTER_CHANGED", Set(varMsFilter, Text(p.status)),
                    "VIEW_CHANGED", Set(varMsView, Text(p.view)),
                    // aksi lain: tidak ada yang perlu dilakukan
                    false
                )
            )
        )
    )
)
```

### 10.5 ScheduleDetail — `OnChange`

Handler report sama dengan MyReportDetail; bedanya hanya variabel balasan (`varSdResult`) dan koleksi yang
dimuat ulang (`colSdSch`, `colSdRep`), supaya status jadwal, daftar report dan sisa durasi langsung terbarui di layar yang sama.

```powerfx
If(!IsBlank(Self.ActionPayload),
    With({req: ParseJSON(Self.ActionPayload)},
        With({act: Text(req.action), rid: Text(req.requestId), p: req.payload, data: Self.UploadData},
            If(!(rid in colPbsProcessed.Id),
                Collect(colPbsProcessed, {Id: rid});
                Switch(act,
                    "ABSEN",
                        If(!IsBlank(LookUp('Host Absence - PBS Hub', ScheduleID = Text(p.scheduleId) && HostID = varMe.Title)),
                            Set(varSdResult, JSON({requestId: rid, status: "conflict", message: "Absen sesi ini sudah tercatat."}, JSONFormat.Compact)),
                            IfError(
                                With({s: LookUp('Schedule - PBS Hub', Title = Text(p.scheduleId) && HostID = varMe.Title), lb: Boolean(p.liveBreak)},
                                    With({row: Patch('Host Absence - PBS Hub', Defaults('Host Absence - PBS Hub'), {
                                            ScheduleID: s.Title, HostID: varMe.Title, HostName: Text(p.hostName), LiveDate: s.Date,
                                            BrandID: s.BrandID, Platform: {Value: s.Platform.Value}, Account: LookUp(Choices([@'Host Absence - PBS Hub'].Account), Value = s.Account || Value = LookUp(colAccounts, Title = s.Account).AccountName)
                                            // , Status: {Value: "Present"}   ← nilai Choice Status di Host Absence, kalau kolomnya ada
                                        })},
                                        Patch('Host Absence - PBS Hub', row, {Title: "ABS-" & row.ID});
                                        Collect(colSdAbs, LookUp('Host Absence - PBS Hub', ID = row.ID));
                                        // Status jadwal dari control: "Waiting Report" (report dibuka) atau "Done" (Live Break / Co-Host).
                                        Patch('Schedule - PBS Hub', s, {Status: {Value: Text(p.scheduleStatus)}});
                                        // Live Break: host tidak perlu report, tapi baris Report tetap dibuat, semua angka 0.
                                        If(lb,
                                            Patch('Schedule - PBS Hub', LookUp('Schedule - PBS Hub', ID = s.ID), {LiveBreak: {Value: "Yes"}});   // Choice Yes/No
                                            With({rep: Patch('Report - PBS Hub', Defaults('Report - PBS Hub'), {
                                                    ScheduleID: s.Title, HostID: varMe.Title, BrandID: s.BrandID, Platform: {Value: s.Platform.Value},
                                                    AccountID: s.Account, Account: LookUp(Choices([@'Report - PBS Hub'].Account), Value = s.Account || Value = LookUp(colAccounts, Title = s.Account).AccountName), LiveDate: s.Date, AbsID: "ABS-" & row.ID,
                                                    Penjualan: 0, Pesanan: 0, ProdukTerjual: 0, JumlahPembeli: 0, CTR: 0, CTOR: 0, PeakViewer: 0,
                                                    'Durasi(Min)': 0, AddToCart: 0, TotalViewer: 0, Comment: 0,
                                                    ApprovalStatus: {Value: "LiveBreak"}
                                                })},
                                                Patch('Report - PBS Hub', rep, {Title: "REP-" & rep.ID})
                                            );
                                            // ---- Tier harian di Clock In: host ini, tanggal s.Date. Aturan sama dengan hitung ulang bulanan.
                                            IfError(
                                                With({tDate: s.Date},
                                                With({clk: LookUp('Clock In - PBS Hub', HostID = varMe.Title && ClockInDate = tDate),
                                                      schDay: Filter('Schedule - PBS Hub', HostID = varMe.Title && Date = tDate),
                                                      repDay: Filter('Report - PBS Hub', HostID = varMe.Title && LiveDate = tDate),
                                                      t1: LookUp(colTierConfig, Title = "Tier 1"), t2: LookUp(colTierConfig, Title = "Tier 2"),
                                                      t3: LookUp(colTierConfig, Title = "Tier 3")},
                                                If(!IsBlank(clk),
                                                // Segmen jadwal aktif (bukan Cancelled, jam lengkap). Lewat tengah malam: EndMin + 1440.
                                                With({seg: ForAll(Filter(schDay, !IsBlank(StartTime) && !IsBlank(EndTime) && Status.Value <> "Cancelled") As S,
                                                            With({sm: Hour(TimeValue(S.StartTime)) * 60 + Minute(TimeValue(S.StartTime)),
                                                                  em: Hour(TimeValue(S.EndTime)) * 60 + Minute(TimeValue(S.EndTime))},
                                                                {Title: S.Title, BrandID: S.BrandID, StartTime: S.StartTime, EndTime: S.EndTime,
                                                                 Co: S.Position.Value = "Co-Host",          // "Host" / "Main Host" = main host
                                                                 StartMin: sm, EndMin: If(em >= sm, em, em + 1440)}))},
                                                With({mainSeg: Filter(seg, !Co), mainMin: Sum(Filter(seg, !Co), EndMin - StartMin), coMin: Sum(Filter(seg, Co), EndMin - StartMin)},
                                                // Grid 15 menit selama 2 hari (0–2880): slot yang tertutup jadwal main host.
                                                With({slots: ForAll(Sequence(2880 / varSlotMin, 0, 1) As Sl,
                                                            With({ms: Sl.Value * varSlotMin}, {SlotStart: ms, Covered: !IsEmpty(Filter(mainSeg, StartMin <= ms && EndMin > ms))}))},
                                                With({liveMin: CountRows(Filter(slots, Covered)) * varSlotMin,
                                                      t1Win: CountRows(Filter(slots, Covered && (SlotStart < 360 || (SlotStart >= 1440 && SlotStart < 1800)))) * varSlotMin,     // 00:00–06:00
                                                      t2Win: CountRows(Filter(slots, Covered && ((SlotStart >= 1260 && SlotStart < 1440) || SlotStart >= 2700))) * varSlotMin,  // 21:00–24:00
                                                      // Akun terbaik hari itu: TotalViewer dijumlah, Peak dan CTR diambil maksimum.
                                                      best: First(Sort(ForAll(Distinct(repDay, Account.Value) As D,
                                                                With({r: Filter(repDay, Account.Value = D.Value)},
                                                                    {Account: D.Value, TotalViewer: Sum(r, TotalViewer), PeakViewer: Max(r, PeakViewer), CTR: Max(r, CTR)})),
                                                            TotalViewer * PeakViewer * CTR, SortOrder.Descending))},
                                                With({m1: !IsBlank(best) && best.TotalViewer >= t1.MinViews && best.CTR >= t1.CTR && best.PeakViewer >= t1.AvgViewDur,
                                                      m2: !IsBlank(best) && best.TotalViewer >= t2.MinViews && best.CTR >= t2.CTR && best.PeakViewer >= t2.AvgViewDur,
                                                      m3: !IsBlank(best) && best.TotalViewer >= t3.MinViews && best.CTR >= t3.CTR && best.PeakViewer >= t3.AvgViewDur,
                                                      d1: liveMin >= t1.Duration * 60, d2: liveMin >= t2.Duration * 60, d3: liveMin >= t3.Duration * 60,
                                                      w1: t1Win >= varT1MinInWindow, w2: t2Win >= varT2MinInWindow,
                                                      jam: Round(liveMin / 60, 2), main: mainMin > coMin,
                                                      hol: tDate in varHolidays, wkd: Weekday(tDate) = 1 || Weekday(tDate) = 7},
                                                With({calc: If(m1 || d1 || w1, "Tier 1", m2 || d2 || w2, "Tier 2", m3 || d3, "Tier 3", "No")},
                                                // Urutan: Co-Host mayoritas → No; tanggal merah → Tier 1; Sabtu/Minggu → minimal Tier 2.
                                                With({tier: If(!main, "No", hol, "Tier 1", wkd && calc <> "Tier 1", "Tier 2", calc)},
                                                    Patch('Clock In - PBS Hub', clk, {
                                                        Tier: {Value: tier},
                                                        Insentif: Switch(tier, "Tier 1", 75000, "Tier 2", 65000, "Tier 3", 55000, 0),
                                                        TotalReports: CountRows(repDay),
                                                        LastTierUpdate: Now(),
                                                        Reason: If(
                                                            !main,
                                                                If(mainMin = 0, "Tidak mendapatkan Tier karena hanya sebagai Co-Host. Main Host: 0 jam, Co-Host: " & Round(coMin / 60, 2) & " jam",
                                                                    "Tidak eligible Tier karena durasi Co-Host lebih besar atau sama dengan Main Host. Main Host: " &
                                                                    Round(mainMin / 60, 2) & " jam, Co-Host: " & Round(coMin / 60, 2) & " jam"),
                                                            hol, "Auto Tier 1 karena Tanggal Merah (Libur Nasional)",
                                                            tier = "No",
                                                                "Belum mencapai target minimum. Views: " & Coalesce(best.TotalViewer, 0) & " (min " & t3.MinViews & "), CTR: " &
                                                                Coalesce(best.CTR, 0) & " (min " & t3.CTR & "), Peak: " & Coalesce(best.PeakViewer, 0) & " (min " & t3.AvgViewDur &
                                                                "), Durasi: " & jam & " jam (min " & t3.Duration & " jam)",
                                                            tier & " karena " & Concat(Filter([
                                                                If(w1, "Jam Live 00:00-06:00 (" & t1Win & " menit, min " & varT1MinInWindow & ")", ""),
                                                                If(w2, "Jam Live 21:00-24:00 (" & t2Win & " menit, min " & varT2MinInWindow & ")", ""),
                                                                If(m1, "Metric Tier 1 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                                If(m2 && !m1, "Metric Tier 2 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                                If(m3 && !m2, "Metric Tier 3 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                                If(d1, "Durasi Live >= " & t1.Duration & " Jam (" & jam & " jam)", ""),
                                                                If(d2 && !d1, "Durasi Live >= " & t2.Duration & " Jam (" & jam & " jam)", ""),
                                                                If(d3 && !d2, "Durasi Live >= " & t3.Duration & " Jam (" & jam & " jam)", ""),
                                                                If(wkd && calc <> "Tier 1", "Weekend (Auto Tier 2 minimum)", ""),
                                                                If(wkd && calc = "Tier 1", "Weekend + memenuhi syarat Tier 1", "")
                                                            ], Value <> ""), Value, " + ")
                                                        ),
                                                        Total_Jam_Live: If(main, jam, 0),
                                                        Schedule: If(main,
                                                            Concat(Sort(mainSeg, StartMin), With({b: BrandID},
                                                                Title & "_" & LookUp(colBrands, Title = b).NamaBrand & "_" & Substitute(StartTime, ":", ".") & "-" & Substitute(EndTime, ":", ".")), ", "),
                                                            "Not Eligible - Main Host " & Round(mainMin / 60, 2) & " jam vs Co-Host " & Round(coMin / 60, 2) & " jam"),
                                                        statusupdate: If(clk.Tier.Value = tier, "Tier tetap " & tier & " (tidak ada perubahan)",
                                                            "Berhasil update dari " & Coalesce(clk.Tier.Value, "-") & " → " & tier)
                                                    })
                                                )))))))))),
                                                // Report tetap tersimpan kalau hitung Tier gagal; hitung ulang bulanan akan membetulkannya.
                                                Notify("Report tersimpan, tapi Tier belum terhitung: " & FirstError.Message, NotificationType.Warning)
                                            )
                                        )
                                    )
                                );
                                ClearCollect(colSdSch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date = varSchDate));
                                ClearCollect(colSdRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate = varSchDate));
                                Set(varSdResult, JSON({requestId: rid, status: "ok", message: If(Boolean(p.liveBreak), "Absen tercatat. Live Break: report 0 dibuat otomatis.", "Absen tercatat untuk " & Text(p.scheduleId) & ".")}, JSONFormat.Compact)),
                                Set(varSdResult, JSON({requestId: rid, status: "error", message: "Gagal absen: " & FirstError.Message}, JSONFormat.Compact))
                            )
                        ),
                    "SUBMIT_REPORT",
                        With({m: p.metrics, s: LookUp('Schedule - PBS Hub', Title = Text(p.scheduleId) && HostID = varMe.Title)},
                            // Hapus cabang ini kalau config.requireAbsen = false.
                            If(IsBlank(LookUp('Host Absence - PBS Hub', ScheduleID = Text(p.scheduleId) && HostID = varMe.Title)),
                                Set(varSdResult, JSON({requestId: rid, status: "error", message: "Absen sesi ini belum tercatat."}, JSONFormat.Compact)),
                            // Report hanya dibuka saat jadwal Waiting Report (hapus kalau config.requireWaitingStatus = false).
                            // Setelah durasi terpenuhi statusnya Done, jadi report tambahan ditolak di sini.
                            s.Status.Value <> "Waiting Report",
                                Set(varSdResult, JSON({requestId: rid, status: "conflict", message: "Status jadwal " & s.Status.Value & ", report tidak bisa dikirim. Muat ulang dulu."}, JSONFormat.Compact)),
                            // Live terputus boleh punya beberapa report, tapi satu Live ID hanya sekali.
                            !IsBlank(LookUp('Report - PBS Hub', ScheduleID = s.Title && HostID = varMe.Title && LiveID = Text(p.liveId))),
                                Set(varSdResult, JSON({requestId: rid, status: "conflict", message: "Live ID " & Text(p.liveId) & " sudah dilaporkan untuk sesi ini."}, JSONFormat.Compact)),
                                IfError(
                                    With({row: Patch('Report - PBS Hub', Defaults('Report - PBS Hub'), {
                                            ScheduleID: s.Title, HostID: varMe.Title, BrandID: s.BrandID, Platform: {Value: s.Platform.Value},
                                            AccountID: s.Account, Account: LookUp(Choices([@'Report - PBS Hub'].Account), Value = s.Account || Value = LookUp(colAccounts, Title = s.Account).AccountName), LiveDate: s.Date, AbsID: Text(p.absId),
                                            Penjualan: Value(m.Penjualan), Pesanan: Value(m.Pesanan), ProdukTerjual: Value(m.ProdukTerjual),
                                            JumlahPembeli: Value(m.JumlahPembeli), CTR: Value(m.CTR), CTOR: Value(m.CTOR), PeakViewer: Value(m.PeakViewer),
                                            'Durasi(Min)': Value(m.'Durasi(Min)'), AddToCart: Value(m.AddToCart), TotalViewer: Value(m.TotalViewer),
                                            Comment: Value(m.Comment),
                                            LiveID: Text(p.liveId), Playbook: {Value: Text(p.playbook)},
                                            ApprovalStatus: {Value: "Waiting Approval"}
                                        })},
                                        With({title: "REP-" & row.ID},
                                            Patch('Report - PBS Hub', row, {Title: title});
                                            // Screenshot → Report Automation/<Brand>/<yyyy>/<mmmm>/REP-<ID>/REP-<ID>_<Platform>_<Account>_Report.png
                                            // (Graph PUT, sama dengan app upload jadwal bulk/AI). webUrl dari respons Graph → Attachment.
                                            If(!IsBlank(data),
                                                With({up: Office365Groups.HttpRequest(
                                                        "https://graph.microsoft.com/v1.0/sites/" & varSiteID & "/drives/" & varDriveID & "/root:/Report Automation/" &
                                                        LookUp(colBrands, Title = s.BrandID).NamaBrand & "/" & Text(Today(), "yyyy") & "/" & Text(Today(), "mmmm") & "/" &
                                                        title & "/" & title & "_" & s.Platform.Value & "_" & s.Account & "_Report.png:/content",
                                                        "PUT",
                                                        "data:image/jpeg;base64," & data
                                                    )},
                                                    Patch('Report - PBS Hub', row, {Attachment: Text(up.webUrl)})
                                                )
                                            );
                                            // Total Durasi(Min) semua report sesi ini ≥ durasi jadwal → "Done", kalau belum tetap "Waiting Report".
                                            Patch('Schedule - PBS Hub', s, {Status: {Value: Text(p.scheduleStatus)}});
                                            // ---- Tier harian di Clock In: host ini, tanggal s.Date. Aturan sama dengan hitung ulang bulanan.
                                            IfError(
                                                With({tDate: s.Date},
                                                With({clk: LookUp('Clock In - PBS Hub', HostID = varMe.Title && ClockInDate = tDate),
                                                      schDay: Filter('Schedule - PBS Hub', HostID = varMe.Title && Date = tDate),
                                                      repDay: Filter('Report - PBS Hub', HostID = varMe.Title && LiveDate = tDate),
                                                      t1: LookUp(colTierConfig, Title = "Tier 1"), t2: LookUp(colTierConfig, Title = "Tier 2"),
                                                      t3: LookUp(colTierConfig, Title = "Tier 3")},
                                                If(!IsBlank(clk),
                                                // Segmen jadwal aktif (bukan Cancelled, jam lengkap). Lewat tengah malam: EndMin + 1440.
                                                With({seg: ForAll(Filter(schDay, !IsBlank(StartTime) && !IsBlank(EndTime) && Status.Value <> "Cancelled") As S,
                                                            With({sm: Hour(TimeValue(S.StartTime)) * 60 + Minute(TimeValue(S.StartTime)),
                                                                  em: Hour(TimeValue(S.EndTime)) * 60 + Minute(TimeValue(S.EndTime))},
                                                                {Title: S.Title, BrandID: S.BrandID, StartTime: S.StartTime, EndTime: S.EndTime,
                                                                 Co: S.Position.Value = "Co-Host",          // "Host" / "Main Host" = main host
                                                                 StartMin: sm, EndMin: If(em >= sm, em, em + 1440)}))},
                                                With({mainSeg: Filter(seg, !Co), mainMin: Sum(Filter(seg, !Co), EndMin - StartMin), coMin: Sum(Filter(seg, Co), EndMin - StartMin)},
                                                // Grid 15 menit selama 2 hari (0–2880): slot yang tertutup jadwal main host.
                                                With({slots: ForAll(Sequence(2880 / varSlotMin, 0, 1) As Sl,
                                                            With({ms: Sl.Value * varSlotMin}, {SlotStart: ms, Covered: !IsEmpty(Filter(mainSeg, StartMin <= ms && EndMin > ms))}))},
                                                With({liveMin: CountRows(Filter(slots, Covered)) * varSlotMin,
                                                      t1Win: CountRows(Filter(slots, Covered && (SlotStart < 360 || (SlotStart >= 1440 && SlotStart < 1800)))) * varSlotMin,     // 00:00–06:00
                                                      t2Win: CountRows(Filter(slots, Covered && ((SlotStart >= 1260 && SlotStart < 1440) || SlotStart >= 2700))) * varSlotMin,  // 21:00–24:00
                                                      // Akun terbaik hari itu: TotalViewer dijumlah, Peak dan CTR diambil maksimum.
                                                      best: First(Sort(ForAll(Distinct(repDay, Account.Value) As D,
                                                                With({r: Filter(repDay, Account.Value = D.Value)},
                                                                    {Account: D.Value, TotalViewer: Sum(r, TotalViewer), PeakViewer: Max(r, PeakViewer), CTR: Max(r, CTR)})),
                                                            TotalViewer * PeakViewer * CTR, SortOrder.Descending))},
                                                With({m1: !IsBlank(best) && best.TotalViewer >= t1.MinViews && best.CTR >= t1.CTR && best.PeakViewer >= t1.AvgViewDur,
                                                      m2: !IsBlank(best) && best.TotalViewer >= t2.MinViews && best.CTR >= t2.CTR && best.PeakViewer >= t2.AvgViewDur,
                                                      m3: !IsBlank(best) && best.TotalViewer >= t3.MinViews && best.CTR >= t3.CTR && best.PeakViewer >= t3.AvgViewDur,
                                                      d1: liveMin >= t1.Duration * 60, d2: liveMin >= t2.Duration * 60, d3: liveMin >= t3.Duration * 60,
                                                      w1: t1Win >= varT1MinInWindow, w2: t2Win >= varT2MinInWindow,
                                                      jam: Round(liveMin / 60, 2), main: mainMin > coMin,
                                                      hol: tDate in varHolidays, wkd: Weekday(tDate) = 1 || Weekday(tDate) = 7},
                                                With({calc: If(m1 || d1 || w1, "Tier 1", m2 || d2 || w2, "Tier 2", m3 || d3, "Tier 3", "No")},
                                                // Urutan: Co-Host mayoritas → No; tanggal merah → Tier 1; Sabtu/Minggu → minimal Tier 2.
                                                With({tier: If(!main, "No", hol, "Tier 1", wkd && calc <> "Tier 1", "Tier 2", calc)},
                                                    Patch('Clock In - PBS Hub', clk, {
                                                        Tier: {Value: tier},
                                                        Insentif: Switch(tier, "Tier 1", 75000, "Tier 2", 65000, "Tier 3", 55000, 0),
                                                        TotalReports: CountRows(repDay),
                                                        LastTierUpdate: Now(),
                                                        Reason: If(
                                                            !main,
                                                                If(mainMin = 0, "Tidak mendapatkan Tier karena hanya sebagai Co-Host. Main Host: 0 jam, Co-Host: " & Round(coMin / 60, 2) & " jam",
                                                                    "Tidak eligible Tier karena durasi Co-Host lebih besar atau sama dengan Main Host. Main Host: " &
                                                                    Round(mainMin / 60, 2) & " jam, Co-Host: " & Round(coMin / 60, 2) & " jam"),
                                                            hol, "Auto Tier 1 karena Tanggal Merah (Libur Nasional)",
                                                            tier = "No",
                                                                "Belum mencapai target minimum. Views: " & Coalesce(best.TotalViewer, 0) & " (min " & t3.MinViews & "), CTR: " &
                                                                Coalesce(best.CTR, 0) & " (min " & t3.CTR & "), Peak: " & Coalesce(best.PeakViewer, 0) & " (min " & t3.AvgViewDur &
                                                                "), Durasi: " & jam & " jam (min " & t3.Duration & " jam)",
                                                            tier & " karena " & Concat(Filter([
                                                                If(w1, "Jam Live 00:00-06:00 (" & t1Win & " menit, min " & varT1MinInWindow & ")", ""),
                                                                If(w2, "Jam Live 21:00-24:00 (" & t2Win & " menit, min " & varT2MinInWindow & ")", ""),
                                                                If(m1, "Metric Tier 1 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                                If(m2 && !m1, "Metric Tier 2 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                                If(m3 && !m2, "Metric Tier 3 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                                If(d1, "Durasi Live >= " & t1.Duration & " Jam (" & jam & " jam)", ""),
                                                                If(d2 && !d1, "Durasi Live >= " & t2.Duration & " Jam (" & jam & " jam)", ""),
                                                                If(d3 && !d2, "Durasi Live >= " & t3.Duration & " Jam (" & jam & " jam)", ""),
                                                                If(wkd && calc <> "Tier 1", "Weekend (Auto Tier 2 minimum)", ""),
                                                                If(wkd && calc = "Tier 1", "Weekend + memenuhi syarat Tier 1", "")
                                                            ], Value <> ""), Value, " + ")
                                                        ),
                                                        Total_Jam_Live: If(main, jam, 0),
                                                        Schedule: If(main,
                                                            Concat(Sort(mainSeg, StartMin), With({b: BrandID},
                                                                Title & "_" & LookUp(colBrands, Title = b).NamaBrand & "_" & Substitute(StartTime, ":", ".") & "-" & Substitute(EndTime, ":", ".")), ", "),
                                                            "Not Eligible - Main Host " & Round(mainMin / 60, 2) & " jam vs Co-Host " & Round(coMin / 60, 2) & " jam"),
                                                        statusupdate: If(clk.Tier.Value = tier, "Tier tetap " & tier & " (tidak ada perubahan)",
                                                            "Berhasil update dari " & Coalesce(clk.Tier.Value, "-") & " → " & tier)
                                                    })
                                                )))))))))),
                                                // Report tetap tersimpan kalau hitung Tier gagal; hitung ulang bulanan akan membetulkannya.
                                                Notify("Report tersimpan, tapi Tier belum terhitung: " & FirstError.Message, NotificationType.Warning)
                                            );
                                            ClearCollect(colSdSch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date = varSchDate));
                                            ClearCollect(colSdRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate = varSchDate));
                                            Set(varSdResult, JSON({requestId: rid, status: "ok", message: If(Boolean(p.complete), "Report " & title & " terkirim. Durasi sesi terpenuhi.", "Report " & title & " terkirim. Kurang " & Text(p.remainingMin) & " menit, kirim report berikutnya.")}, JSONFormat.Compact))
                                        )
                                    ),
                                    Set(varSdResult, JSON({requestId: rid, status: "error", message: "Gagal mengirim report: " & FirstError.Message}, JSONFormat.Compact))
                                )
                            )
                        ),
                    "RESUBMIT_REPORT",
                        With({cur: LookUp('Report - PBS Hub', ID = Value(p.reportId) && HostID = varMe.Title), m: p.metrics},
                            // Modified dari JSON berformat UTC ("…Z"); DateTimeValue mengubahnya ke jam lokal sebelum dibandingkan.
                            If(IsBlank(cur) || cur.ApprovalStatus.Value <> "Need Revision" ||
                               Abs(DateDiff(cur.Modified, DateTimeValue(Text(p.expectedModified)), TimeUnit.Seconds)) > 1,
                                Set(varSdResult, JSON({requestId: rid, status: "conflict", message: "Report ini sudah berubah. Muat ulang dulu."}, JSONFormat.Compact)),
                                IfError(
                                    Patch('Report - PBS Hub', cur, {
                                        Penjualan: Value(m.Penjualan), Pesanan: Value(m.Pesanan), ProdukTerjual: Value(m.ProdukTerjual),
                                        JumlahPembeli: Value(m.JumlahPembeli), CTR: Value(m.CTR), CTOR: Value(m.CTOR), PeakViewer: Value(m.PeakViewer),
                                        'Durasi(Min)': Value(m.'Durasi(Min)'), AddToCart: Value(m.AddToCart), TotalViewer: Value(m.TotalViewer),
                                        Comment: Value(m.Comment),
                                        LiveID: Text(p.liveId), Playbook: {Value: Text(p.playbook)},
                                        ApprovalStatus: {Value: Text(p.approvalStatus)},   // "Waiting Approval Revision"
                                        ApprovalComment: cur.ApprovalComment & Char(10) & "[Revisi host] " &
                                            If(IsBlank(Text(p.note)), "angka diperbaiki: " & Concat(Table(p.changed), Text(ThisRecord.Value), ", "), Text(p.note))
                                    });
                                    // Report Automation dengan Title yang sama: hanya Status yang diubah (Unmatch → dibaca ulang).
                                    With({ev: LookUp('Report Automation - PBS Hub', Title = cur.Title)},
                                        If(!IsBlank(ev), Patch('Report Automation - PBS Hub', ev, {Status: {Value: Text(p.evidenceStatus)}}))
                                    );
                                    // Screenshot baru (opsional): path dan nama file sama dengan upload pertama (folder bulan dari Created)
                                    // → file lama ditimpa, flow AI membaca ulang.
                                    If(!IsBlank(p.file) && !IsBlank(data),
                                        With({up: Office365Groups.HttpRequest(
                                                "https://graph.microsoft.com/v1.0/sites/" & varSiteID & "/drives/" & varDriveID & "/root:/Report Automation/" &
                                                LookUp(colBrands, Title = cur.BrandID).NamaBrand & "/" & Text(cur.Created, "yyyy") & "/" & Text(cur.Created, "mmmm") & "/" &
                                                cur.Title & "/" & cur.Title & "_" & cur.Platform.Value & "_" & cur.AccountID & "_Report.png:/content",
                                                "PUT",
                                                "data:image/jpeg;base64," & data
                                            )},
                                            Patch('Report - PBS Hub', LookUp('Report - PBS Hub', ID = cur.ID), {Attachment: Text(up.webUrl)}))
                                    );
                                    // Durasi bisa ikut direvisi: status jadwal dihitung ulang oleh control (Waiting Report / Done).
                                    If(!IsBlank(Text(p.scheduleStatus)),
                                        Patch('Schedule - PBS Hub', LookUp('Schedule - PBS Hub', Title = cur.ScheduleID && HostID = varMe.Title), {Status: {Value: Text(p.scheduleStatus)}}));
                                    // Angka berubah → Tier hari itu dihitung ulang.
                                    // ---- Tier harian di Clock In: host ini, tanggal cur.LiveDate. Aturan sama dengan hitung ulang bulanan.
                                    IfError(
                                        With({tDate: cur.LiveDate},
                                        With({clk: LookUp('Clock In - PBS Hub', HostID = varMe.Title && ClockInDate = tDate),
                                              schDay: Filter('Schedule - PBS Hub', HostID = varMe.Title && Date = tDate),
                                              repDay: Filter('Report - PBS Hub', HostID = varMe.Title && LiveDate = tDate),
                                              t1: LookUp(colTierConfig, Title = "Tier 1"), t2: LookUp(colTierConfig, Title = "Tier 2"),
                                              t3: LookUp(colTierConfig, Title = "Tier 3")},
                                        If(!IsBlank(clk),
                                        // Segmen jadwal aktif (bukan Cancelled, jam lengkap). Lewat tengah malam: EndMin + 1440.
                                        With({seg: ForAll(Filter(schDay, !IsBlank(StartTime) && !IsBlank(EndTime) && Status.Value <> "Cancelled") As S,
                                                    With({sm: Hour(TimeValue(S.StartTime)) * 60 + Minute(TimeValue(S.StartTime)),
                                                          em: Hour(TimeValue(S.EndTime)) * 60 + Minute(TimeValue(S.EndTime))},
                                                        {Title: S.Title, BrandID: S.BrandID, StartTime: S.StartTime, EndTime: S.EndTime,
                                                         Co: S.Position.Value = "Co-Host",          // "Host" / "Main Host" = main host
                                                         StartMin: sm, EndMin: If(em >= sm, em, em + 1440)}))},
                                        With({mainSeg: Filter(seg, !Co), mainMin: Sum(Filter(seg, !Co), EndMin - StartMin), coMin: Sum(Filter(seg, Co), EndMin - StartMin)},
                                        // Grid 15 menit selama 2 hari (0–2880): slot yang tertutup jadwal main host.
                                        With({slots: ForAll(Sequence(2880 / varSlotMin, 0, 1) As Sl,
                                                    With({ms: Sl.Value * varSlotMin}, {SlotStart: ms, Covered: !IsEmpty(Filter(mainSeg, StartMin <= ms && EndMin > ms))}))},
                                        With({liveMin: CountRows(Filter(slots, Covered)) * varSlotMin,
                                              t1Win: CountRows(Filter(slots, Covered && (SlotStart < 360 || (SlotStart >= 1440 && SlotStart < 1800)))) * varSlotMin,     // 00:00–06:00
                                              t2Win: CountRows(Filter(slots, Covered && ((SlotStart >= 1260 && SlotStart < 1440) || SlotStart >= 2700))) * varSlotMin,  // 21:00–24:00
                                              // Akun terbaik hari itu: TotalViewer dijumlah, Peak dan CTR diambil maksimum.
                                              best: First(Sort(ForAll(Distinct(repDay, Account.Value) As D,
                                                        With({r: Filter(repDay, Account.Value = D.Value)},
                                                            {Account: D.Value, TotalViewer: Sum(r, TotalViewer), PeakViewer: Max(r, PeakViewer), CTR: Max(r, CTR)})),
                                                    TotalViewer * PeakViewer * CTR, SortOrder.Descending))},
                                        With({m1: !IsBlank(best) && best.TotalViewer >= t1.MinViews && best.CTR >= t1.CTR && best.PeakViewer >= t1.AvgViewDur,
                                              m2: !IsBlank(best) && best.TotalViewer >= t2.MinViews && best.CTR >= t2.CTR && best.PeakViewer >= t2.AvgViewDur,
                                              m3: !IsBlank(best) && best.TotalViewer >= t3.MinViews && best.CTR >= t3.CTR && best.PeakViewer >= t3.AvgViewDur,
                                              d1: liveMin >= t1.Duration * 60, d2: liveMin >= t2.Duration * 60, d3: liveMin >= t3.Duration * 60,
                                              w1: t1Win >= varT1MinInWindow, w2: t2Win >= varT2MinInWindow,
                                              jam: Round(liveMin / 60, 2), main: mainMin > coMin,
                                              hol: tDate in varHolidays, wkd: Weekday(tDate) = 1 || Weekday(tDate) = 7},
                                        With({calc: If(m1 || d1 || w1, "Tier 1", m2 || d2 || w2, "Tier 2", m3 || d3, "Tier 3", "No")},
                                        // Urutan: Co-Host mayoritas → No; tanggal merah → Tier 1; Sabtu/Minggu → minimal Tier 2.
                                        With({tier: If(!main, "No", hol, "Tier 1", wkd && calc <> "Tier 1", "Tier 2", calc)},
                                            Patch('Clock In - PBS Hub', clk, {
                                                Tier: {Value: tier},
                                                Insentif: Switch(tier, "Tier 1", 75000, "Tier 2", 65000, "Tier 3", 55000, 0),
                                                TotalReports: CountRows(repDay),
                                                LastTierUpdate: Now(),
                                                Reason: If(
                                                    !main,
                                                        If(mainMin = 0, "Tidak mendapatkan Tier karena hanya sebagai Co-Host. Main Host: 0 jam, Co-Host: " & Round(coMin / 60, 2) & " jam",
                                                            "Tidak eligible Tier karena durasi Co-Host lebih besar atau sama dengan Main Host. Main Host: " &
                                                            Round(mainMin / 60, 2) & " jam, Co-Host: " & Round(coMin / 60, 2) & " jam"),
                                                    hol, "Auto Tier 1 karena Tanggal Merah (Libur Nasional)",
                                                    tier = "No",
                                                        "Belum mencapai target minimum. Views: " & Coalesce(best.TotalViewer, 0) & " (min " & t3.MinViews & "), CTR: " &
                                                        Coalesce(best.CTR, 0) & " (min " & t3.CTR & "), Peak: " & Coalesce(best.PeakViewer, 0) & " (min " & t3.AvgViewDur &
                                                        "), Durasi: " & jam & " jam (min " & t3.Duration & " jam)",
                                                    tier & " karena " & Concat(Filter([
                                                        If(w1, "Jam Live 00:00-06:00 (" & t1Win & " menit, min " & varT1MinInWindow & ")", ""),
                                                        If(w2, "Jam Live 21:00-24:00 (" & t2Win & " menit, min " & varT2MinInWindow & ")", ""),
                                                        If(m1, "Metric Tier 1 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                        If(m2 && !m1, "Metric Tier 2 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                        If(m3 && !m2, "Metric Tier 3 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Peak " & best.PeakViewer & ")", ""),
                                                        If(d1, "Durasi Live >= " & t1.Duration & " Jam (" & jam & " jam)", ""),
                                                        If(d2 && !d1, "Durasi Live >= " & t2.Duration & " Jam (" & jam & " jam)", ""),
                                                        If(d3 && !d2, "Durasi Live >= " & t3.Duration & " Jam (" & jam & " jam)", ""),
                                                        If(wkd && calc <> "Tier 1", "Weekend (Auto Tier 2 minimum)", ""),
                                                        If(wkd && calc = "Tier 1", "Weekend + memenuhi syarat Tier 1", "")
                                                    ], Value <> ""), Value, " + ")
                                                ),
                                                Total_Jam_Live: If(main, jam, 0),
                                                Schedule: If(main,
                                                    Concat(Sort(mainSeg, StartMin), With({b: BrandID},
                                                        Title & "_" & LookUp(colBrands, Title = b).NamaBrand & "_" & Substitute(StartTime, ":", ".") & "-" & Substitute(EndTime, ":", ".")), ", "),
                                                    "Not Eligible - Main Host " & Round(mainMin / 60, 2) & " jam vs Co-Host " & Round(coMin / 60, 2) & " jam"),
                                                statusupdate: If(clk.Tier.Value = tier, "Tier tetap " & tier & " (tidak ada perubahan)",
                                                    "Berhasil update dari " & Coalesce(clk.Tier.Value, "-") & " → " & tier)
                                            })
                                        )))))))))),
                                        // Report tetap tersimpan kalau hitung Tier gagal; hitung ulang bulanan akan membetulkannya.
                                        Notify("Report tersimpan, tapi Tier belum terhitung: " & FirstError.Message, NotificationType.Warning)
                                    );
                                    ClearCollect(colSdSch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date = varSchDate));
                                    ClearCollect(colSdRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate = varSchDate));
                                    Set(varSdResult, JSON({requestId: rid, status: "ok", message: "Revisi terkirim, menunggu review ulang."}, JSONFormat.Compact)),
                                    Set(varSdResult, JSON({requestId: rid, status: "error", message: "Gagal mengirim revisi: " & FirstError.Message}, JSONFormat.Compact))
                                )
                            )
                        ),
                    "DISPUTE_REVIEW",
                        With({cur: LookUp('Report - PBS Hub', ID = Value(p.reportId) && HostID = varMe.Title)},
                            If(IsBlank(cur) || cur.ApprovalStatus.Value <> "Need Revision",
                                Set(varSdResult, JSON({requestId: rid, status: "conflict", message: "Report ini sudah tidak menunggu revisi. Muat ulang dulu."}, JSONFormat.Compact)),
                                IfError(
                                    // Status tetap Need Revision; reviewer membaca sanggahan di ApprovalComment.
                                    Patch('Report - PBS Hub', cur, {ApprovalComment: cur.ApprovalComment & Char(10) & "[Sanggahan host] " & Text(p.reason)});
                                    ClearCollect(colSdSch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date = varSchDate));
                                    ClearCollect(colSdRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate = varSchDate));
                                    Set(varSdResult, JSON({requestId: rid, status: "ok", message: "Sanggahan terkirim ke reviewer."}, JSONFormat.Compact)),
                                    Set(varSdResult, JSON({requestId: rid, status: "error", message: "Gagal mengirim sanggahan: " & FirstError.Message}, JSONFormat.Compact))
                                )
                            )
                        ),
                    "CLOCK_IN", Navigate(scrClockIn),
                    "NEW_REPORT",
                        Set(varRptSchedule, Text(p.scheduleId)); Set(varRptId, Blank()); Navigate(scrMyReportDetail),
                    "OPEN_REPORT",
                        Set(varRptId, Value(p.reportId)); Set(varRptSchedule, Text(p.scheduleId)); Navigate(scrMyReportDetail),
                    "OPEN_EVIDENCE", Launch(Text(p.url)),
                    "OPEN_SCHEDULE", Set(varSchId, Text(p.scheduleId)),   // sesi lain di hari yang sama: data sudah ada
                    "BACK", Back(),
                    // aksi lain: tidak ada yang perlu dilakukan
                    false
                )
            )
        )
    )
)
```

Catatan:
- `Switch(act, …, false)`: nilai terakhir hanya default supaya Switch valid; aksi yang tidak dikenal tidak melakukan apa-apa.
- `RESUBMIT_REPORT` membandingkan `Modified` dengan selisih detik, bukan teks: `Modified` di JSON berformat UTC
  (`…Z`), sedangkan `Text(cur.Modified, …)` memakai jam lokal, jadi perbandingan teks selalu dianggap *conflict*
  di zona WIB.
- `Boolean(p.liveBreak)` / `Boolean(p.complete)`: `p` hasil `ParseJSON`, jadi nilai true/false perlu dikonversi.
- Kolom `LiveBreak` di Schedule adalah Choice Yes/No: ditulis `{Value: "Yes"}`; kosong dibaca sebagai `No`.
- `LOAD_MORE` tidak ditangani karena `HasMore = false` (data per host per bulan kecil).
