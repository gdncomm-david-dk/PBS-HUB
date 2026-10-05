# Integrasi canvas — PBS Hub Host App

Solusi terpisah dari Ops Console: **`PBSHubHostApp`** (managed, `dist/PBSHubHostApp_1_0_17_0_managed.zip`), berisi
ketujuh control host dengan identifier baru `pbs_HostApp.*`. Solusi ini menggantikan `PBSHubHostPCF` +
`PBSHubHostSchedulePCF` (control lama `pbs_Host.*`). Karena nama solusi dan namespace control berbeda, solusi baru
bisa diimport berdampingan dengan yang lama tanpa bentrok. Publisher dan prefix tetap sama (`PBSHub` / `pbs`).

| Control | Layar desain (PBS Host App) | Fungsi |
|---|---|---|
| `pbs_HostApp.HostDashboard` | *Hari ini* | Sapaan, kartu shift (clock in / clock out), to-do (revisi, report belum dikirim, absen), jadwal hari ini, skor. |
| `pbs_HostApp.MyReports` | *Report saya* | Report sebulan + sesi yang belum dilaporkan, filter status, pilih bulan. |
| `pbs_HostApp.ClockIn` | *Clock in* (dibuka dari kartu shift *Hari ini*) | Clock in / clock out: GPS dicek terhadap radius `Studio Location - PBS`, selfie wajib saat in **dan** out, alasan wajib kalau di luar radius. Lihat bagian 9. |
| `pbs_HostApp.MyReportDetail` | *Send Report*, *Revisi*, *Detail report* | Satu control, tiga mode: form submit (metrik + screenshot), layar revisi (angka yang ditandai, perbaiki / sanggah), tampilan read-only. |
| `pbs_HostApp.MySchedule` | *Jadwal saya* (5a) | Tabel **atau kalender bulan** (toggle Daftar / Kalender), 4 KPI, strip *Hari ini* dengan tombol clock in / absen / kirim report, filter platform + status + cari. |
| `pbs_HostApp.ScheduleDetail` | *Detail sesi* (dibuka dari 4b / 5a / Hari ini) | Langkah berikutnya, **absen dan kirim report (metrik + screenshot) atau revisi langsung di layar ini**, 4 langkah sesi, detail jadwal, sesi lain di hari yang sama. |
| `pbs_HostApp.CreditScore` | *Skor saya* (dibuka dari kartu skor *Hari ini*) | Skor kredit dan level, poin lagi ke level berikutnya, tren, reward / penalty per bulan, daftar level, cara skor berubah, semua transaksi. Hanya membaca. Lihat bagian 11. |

Aturan kontrak sama dengan Ops (lihat [`CANVAS-INTEGRATION.md` §1](CANVAS-INTEGRATION.md#1-aturan-kontrak-berlaku-untuk-semua-control)):
control **tidak pernah menulis ke SharePoint**, tombol mengirim `ActionPayload`, canvas menulis di `OnChange`
dan membalas lewat `ActionResult` dengan `requestId` yang sama. Aksi yang **mengunci** (wajib dibalas):
`ABSEN`, `LIVE_BREAK`, `SUBMIT_REPORT`, `RESUBMIT_REPORT`, `DISPUTE_REVIEW`, `DELETE_REPORT`, `CLOCK_IN`, `CLOCK_OUT` (ClockIn). Sisanya navigasi, tidak perlu dibalas.

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
        maxShiftHours: 16,         // shift maksimal; 2 jam sebelumnya host diberi peringatan, lewat dari itu clock out ditutup
        tolerancePct: 5,           // PBS0005A ±5 % (layar revisi)
        imageMaxPx: 2000,          // sisi terpanjang screenshot setelah dikompres
        imageMaxKb: 1200           // batas ukuran JPEG yang dikirim ke flow
    }
}, JSONFormat.Compact));
Set(varMe, LookUp('Host - PBS Hub', Email.Email = User().Email));
// Koleksi *Filtered: SEMUA LookUp/Filter di OnVisible dan OnChange membaca dari sini, bukan langsung dari list.
// Tulis tetap ke list (Patch); setiap Patch di OnChange langsung menyalin baris hasilnya ke koleksi yang sama.
// Rentang: 3 bulan ke belakang, 2 bulan ke depan. Perlebar kalau host perlu buka bulan yang lebih lama.
Set(varFilterFrom, DateAdd(Today(), -90)); Set(varFilterTo, DateAdd(Today(), 60));
ClearCollect(scheduleFiltered, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date >= varFilterFrom, Date <= varFilterTo));
ClearCollect(clockInFiltered, Filter('Clock In - PBS Hub', HostID = varMe.Title, ClockInDate >= varFilterFrom));
ClearCollect(absenceFiltered, Filter('Host Absence - PBS Hub', HostID = varMe.Title, LiveDate >= varFilterFrom));
ClearCollect(reportFiltered, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate >= varFilterFrom));
// Schedule tidak punya AccountName: Schedule.Account = Title di list Account → AccountName (teks).
ClearCollect(colAccounts, ShowColumns('Account - PBS Hub', Title, AccountName));
// Inisialisasi semua variabel host. Power Apps menolak variabel yang belum pernah di-Set di mana pun
// ("Name isn't valid. 'varMrPeriod' isn't recognized"), jadi deklarasikan semuanya di sini sekali.
Set(varMrPeriod, "");  Set(varMrFilter, "");                 // Report saya: bulan "yyyy-mm" (kosong = bulan ini), filter
Set(varMsPeriod, "");  Set(varMsFilter, "");  Set(varMsView, "Week");   // Jadwal saya
Set(varSchId, "");     Set(varSchDate, Today());             // Detail sesi yang dibuka
Set(varRptId, Value(Blank())); Set(varRptSchedule, "");      // Kirim / revisi report (Value(Blank()) = angka kosong)
// Record kosong yang sudah bertipe: LookUp ke ID yang tidak ada. Set(var, Blank()) saja ditolak
// ("No type found for variable 'varMrdRep'") karena Power Apps tidak tahu bentuk recordnya.
Set(varMrdRep, LookUp(reportFiltered, ID = -1));
Set(varMrdSch, LookUp(scheduleFiltered, ID = -1));
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
| Co-Host | tidak perlu report; absen langsung menulis `Status = Finished` |
| Live Break | ditanya **saat host mau kirim report** (bukan saat absen), karena live yang terputus tetap harus dilaporkan. Di form report muncul *Apakah sesi ini Live Break?*. **Ya** → aksi `LIVE_BREAK`: tidak perlu report, canvas tetap membuat baris Report dengan semua angka 0 dan `ApprovalStatus = LiveBreak`, `Schedule.Status = Finished`, `LiveBreak = Yes`. **Tidak** → form report seperti biasa. Pertanyaan hanya muncul untuk report pertama sesi itu (belum ada report sama sekali) |
| Live terputus | satu sesi boleh punya beberapa Report (satu per Live ID). Control menjumlahkan `Durasi(Min)` semua report sesi itu dan membandingkannya dengan durasi jadwal (`EndTime − StartTime`). Kurang → status tetap `Waiting Report`, host melihat *kurang X menit, silakan report berikutnya*. Total ≥ durasi jadwal → `Status = Finished`, tombol Send Report hilang |
| Revisi | report yang `Need Revision` bisa diperbaiki termasuk Live ID, Playbook dan Durasi; status jadwal dihitung ulang dengan durasi baru |

Nama status bisa diganti lewat `Context.config`: `scheduleWaitingStatus` (default `Waiting Report`),
`scheduleDoneStatus` (default `Finished`); `requireWaitingStatus: false` mematikan syarat status. Pilihan Playbook dari
properti `PlaybooksJson` (mis. `JSON(Choices([@'Report - PBS Hub'].Playbook), JSONFormat.Compact)`), lalu
`config.playbooks`, lalu default *Flash Sale, Payday, Launching Produk, Reguler*. Report lama dengan `Durasi(Min)`
kosong dianggap sudah menutup sesi.

Angka yang ditandai reviewer dibaca dari baris `Metrik yang perlu diperbaiki: …` (baris lama: `dibetulkan`) di `ApprovalComment` yang
ditulis ReportDetail (Ops). Kalau baris itu tidak ada, control memakai metrik yang di luar toleransi.

## 3. HostDashboard (layar *Hari ini*)

```powerfx
// Screen.OnVisible
Set(varHdLoading, true);
ClearCollect(colMySch, Filter(scheduleFiltered, HostID = varMe.Title, Date >= Today() - 7, Date <= Today() + 7));
ClearCollect(colMyClk, Filter(clockInFiltered, HostID = varMe.Title, ClockInDate >= Today() - 14));
ClearCollect(colMyAbs, Filter(absenceFiltered, HostID = varMe.Title, LiveDate >= Today() - 14));
ClearCollect(colMyRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate >= Today() - 30));
Set(varHdLoading, false);
```

| Properti | Nilai |
|---|---|
| `Context` | `varHostCtx` |
| `HostJson` | `JSON(ForAll(Filter('Host - PBS Hub', Title = varMe.Title), {Title: Title, HostCode: HostCode, NamaHost: NamaHost, Package: Package.Value, CurrentScore: CurrentScore, InitialScore: InitialScore}), JSONFormat.Compact)` |
| `SchedulesJson` | `JSON(ForAll(colMySch, {ID: ID, Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime, BrandID: BrandID, StudioID: StudioID, HostID: HostID, Platform: Platform.Value, AccountID: Account, AccountName: With({a: Account}, LookUp(colAccounts, Title = a).AccountName), LiveBreak: Coalesce(LiveBreak.Value, "No"), Position: Position.Value, Status: Status.Value}), JSONFormat.Compact)` |
| `ClockInJson` | `JSON(ForAll(colMyClk, {ID: ID, ClockInDate: Text(ClockInDate, "yyyy-mm-dd"), CheckInTime: CheckInTime, CheckOutTime: CheckOutTime, ClockInTime: ClockInTime, ClockOutDate: Text(ClockOutDate, "yyyy-mm-dd"), ClockOutTime: ClockOutTime, CheckInOffice: CheckInOffice}), JSONFormat.Compact)` |
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
| `ABSEN` 🔒 | `{scheduleId, scheduleItemId, hostId, hostName, liveDate, brandId, studioId, platform, account, accountName, position, scheduleStatus}` | Patch Host Absence + `Schedule.Status` (tanpa pertanyaan Live Break) |
| `LIVE_BREAK` 🔒 | `{scheduleId, scheduleItemId, hostId, hostName, liveDate, brandId, studioId, platform, account, accountName, absId, scheduleStatus, report}` | dikirim dari form report (MyReportDetail dan ScheduleDetail): buat Report 0 + `LiveBreak = Yes` + `Status = Finished` (di bawah) |
| `NEW_REPORT` | `{scheduleId, scheduleItemId, liveDate}` | `Set(varRptSchedule, Text(p.scheduleId)); Set(varRptId, Blank()); Navigate(scrMyReportDetail)` |
| `OPEN_REPORT` | `{reportId, title, scheduleId}` | `Set(varRptId, Value(p.reportId)); Set(varRptSchedule, Text(p.scheduleId)); Navigate(scrMyReportDetail)` |
| `OPEN_SCHEDULE` | `{scheduleId, scheduleItemId, liveDate}` | `Set(varSchId, Text(p.scheduleId)); Set(varSchDate, DateValue(Text(p.liveDate))); Navigate(scrScheduleDetail)` (nama brand di kartu sesi) |
| `NAV` | `{target: "SCHEDULE" \| "REPORTS" \| "SCORE"}` | `Switch(Text(p.target), "REPORTS", Navigate(scrMyReports), "SCHEDULE", Navigate(scrMySchedule), "SCORE", Navigate(scrCreditScore))` (layar Skor saya, bagian 11) |
| `RELOAD` | `{}` | ulangi OnVisible |

**ABSEN** (dipakai HostDashboard, MySchedule, ScheduleDetail dan MyReportDetail). Satu ketukan, tanpa pop-up.

| Field | Isi |
|---|---|
| `position` | `Schedule.Position` (mis. `Host`, `Co-Host`) |
| `scheduleStatus` | nilai untuk `Schedule.Status`: `Finished` (Co-Host) atau `Waiting Report` |

Canvas: buat baris Host Absence dan `Patch` `Schedule.Status = p.scheduleStatus`.

**LIVE_BREAK** (dikirim form report, hanya untuk report pertama sesi itu). Field `report` =
`{approvalStatus: "LiveBreak", metrics: {semua 0}, liveId: "", playbook: "", durationMin: 0, fileName: ""}` dan
`scheduleStatus` = `Finished`. Canvas menolak (`conflict`) kalau jadwal bukan `Waiting Report` atau sesi itu sudah punya report;
selain itu buat baris Report dengan semua metrik 0, `ApprovalStatus = LiveBreak`, Title `REP-{ID}`, lalu
`Schedule.LiveBreak = Yes` dan `Status = p.scheduleStatus`. Balas ke `varMrdResult` / `varSdResult`.
Formula lengkapnya di bagian 10.

`OnChange` lengkap untuk layar ini (dan semua layar host lain) ada di **bagian 10**, siap salin.

## 4. MyReports (layar *Report saya*)

`OnChange` lengkap: bagian 10.

```powerfx
// Screen.OnVisible  (varMrPeriod = "yyyy-mm", kosong = bulan ini)
Set(varMrLoading, true);
With({from: If(IsBlank(varMrPeriod), Date(Year(Today()), Month(Today()), 1), DateValue(varMrPeriod & "-01"))},
    ClearCollect(colMrRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate >= from, LiveDate < DateAdd(from, 1, TimeUnit.Months)));
    // Schedule hanya untuk lookup jam sesi dari Report.ScheduleID.
    ClearCollect(colMrSch, Filter(scheduleFiltered, HostID = varMe.Title, Date >= from, Date < DateAdd(from, 1, TimeUnit.Months)))
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
With({rep: If(IsBlank(varRptId), Blank(), LookUp(reportFiltered, ID = varRptId && HostID = varMe.Title))},
    Set(varMrdRep, rep);
    Set(varMrdSch, LookUp(scheduleFiltered, Title = Coalesce(rep.ScheduleID, varRptSchedule) && HostID = varMe.Title))
);
ClearCollect(colMrdClk, Filter(clockInFiltered, HostID = varMe.Title, ClockInDate >= DateAdd(varMrdSch.Date, -1), ClockInDate <= varMrdSch.Date));
ClearCollect(colMrdAbs, Filter(absenceFiltered, HostID = varMe.Title, ScheduleID = varMrdSch.Title));
ClearCollect(colMrdEvi, Filter('Report Automation - PBS Hub', Title = varMrdRep.Title));
ClearCollect(colMrdSesRep, Filter(reportFiltered, HostID = varMe.Title, ScheduleID = varMrdSch.Title));
// Rata-rata host sendiri untuk peringatan "jauh di atas rata-rata kamu" (tidak memblokir):
ClearCollect(colMrdHist, FirstN(SortByColumns(Filter(reportFiltered, HostID = varMe.Title, Platform.Value = varMrdSch.Platform.Value), "Created", SortOrder.Descending), 10));
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
| `complete`, `scheduleStatus` | total ≥ durasi jadwal → `true`, `"Finished"`; kalau belum `false`, `"Waiting Report"` |

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
        With({cur: LookUp(reportFiltered, ID = Value(p.reportId) && HostID = varMe.Title)},
            With({_upd: Patch('Report - PBS Hub', cur, {ApprovalComment: cur.ApprovalComment & Char(10) & "[Sanggahan host] " & Text(p.reason)})}, RemoveIf(reportFiltered, ID = _upd.ID); Collect(reportFiltered, _upd); _upd);
            Set(varMrdRep, LookUp(reportFiltered, ID = cur.ID))
        );
        // opsional: kirim email ke cur.ApproverEmail
        Set(varMrdResult, JSON({requestId: rid, status: "ok", message: "Sanggahan terkirim ke reviewer."}, JSONFormat.Compact)),
        Set(varMrdResult, JSON({requestId: rid, status: "error", message: FirstError.Message}, JSONFormat.Compact))
    ),
```

### DELETE_REPORT 🔒

Host boleh menghapus report **miliknya sendiri yang belum Match**: `Match` bukan `Match`, `ApprovalStatus`
bukan `Done` dan bukan `LiveBreak` (report Live Break dibuat otomatis). Tombol *Delete Report* muncul di bawah
report (lihat maupun revisi); host mengisi alasan (min. 5 karakter) lalu konfirmasi. Baris Report Automation
(AI Report) dengan Title yang sama ikut dihapus.

Payload: `{reportId, title, scheduleId, hostId, liveDate, expectedModified, reason, deletedBy, scheduleStatus}`.
`scheduleStatus` dihitung control: `Waiting Report` kalau report sisanya di sesi itu belum menutup durasi
jadwal (atau tidak ada report lain), `Finished` kalau sudah. Canvas mengecek ulang aturan Match sebelum
`Remove`, lalu kembali ke layar sebelumnya (`Back()`). Rumus lengkap ada di bagian 10.3.

### Aksi lain

| Aksi | Canvas |
|---|---|
| `ABSEN` 🔒 | sama dengan HostDashboard (balas ke `varMrdResult`, lalu `ClearCollect(colMrdAbs, …)`) |
| `LIVE_BREAK` 🔒 | pertanyaan *Apakah sesi ini Live Break?* sebelum form report muncul; balas ke `varMrdResult`, lalu muat ulang `varMrdSch` dan `colMrdSesRep` |
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
        ClearCollect(colMsSch, Filter(scheduleFiltered, HostID = varMe.Title, Date >= from, Date < to));
        ClearCollect(colMsClk, Filter(clockInFiltered, HostID = varMe.Title, ClockInDate >= from, ClockInDate < to));
        ClearCollect(colMsAbs, Filter(absenceFiltered, HostID = varMe.Title, LiveDate >= from, LiveDate < to));
        ClearCollect(colMsRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate >= from, LiveDate < to))
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
| `DefaultView` | `Coalesce(varMsView, "Week")` — `"Week"` (papan Minggu, desain 11a, default; kosong juga Minggu), `"List"` (Daftar) atau `"Calendar"` (kalender Bulan, desain 10b). Tombol *Daftar / Minggu / Bulan* mengirim `VIEW_CHANGED {view}`; simpan di `OnChange`: `"VIEW_CHANGED", Set(varMsView, Text(p.view))` supaya pilihan host bertahan saat kembali ke layar. |
| Data yang dimuat | bulan lalu + bulan ini + 7 hari bulan depan (`SchedulesJson`, `ClockInJson`, `AbsenceJson`, `ReportsJson`). Angka bulan, daftar dan kalender tetap hanya bulan `Period`; bulan lalu dipakai panel *Bulan lalu* dan *Report tertunda*, 7 hari bulan depan dipakai papan minggu yang melewati akhir bulan. |
| `Context.config` | `holidays` (teks `"2026-08-17,2026-12-25"` atau array tanggal) → tanggal merah di kalender, *Hari libur nasional*, dan *Libur nasional* di papan; `picName` → nama di kartu *Ada yang tidak sesuai?*; `weekMaxHours` → *Jam live … dari maks X jam* di papan minggu. |
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

KPI: *Jadwal live* (sesi bulan ini, tanpa yang batal), *Jam live* (jam sesi yang sudah lewat dari total jam
terjadwal), *Absen hari ini*, *Hari clock in* (hari berjadwal sampai hari ini yang punya Clock In).

| Aksi | Canvas |
|---|---|
| `OPEN_SCHEDULE` `{scheduleId, scheduleItemId, liveDate}` | seperti HostDashboard → `Navigate(scrScheduleDetail)` |
| `ABSEN` 🔒 | sama dengan HostDashboard (balas ke `varMsResult`, lalu `Collect(colMsAbs, …)`) |
| `CLOCK_IN`, `NEW_REPORT`, `OPEN_REPORT` | sama dengan HostDashboard |
| `PERIOD_CHANGED` `{period}` | `Set(varMsPeriod, Text(p.period))` lalu ulangi OnVisible |
| `FILTER_CHANGED` `{status, platform, period}` | opsional: `Set(varMsFilter, Text(p.status))` supaya filter bertahan saat kembali |
| `VIEW_CHANGED` `{view: "List" \| "Week" \| "Calendar"}` | opsional: `Set(varMsView, Text(p.view))`, lalu `DefaultView = Coalesce(varMsView, "Week")` |
| `CONTACT_PIC` `{period}` | tombol *Hubungi PIC* di tampilan Bulan: `Launch(varPicUrl)` (mailto atau link chat) |
| `PERIOD_CHANGED` dari papan minggu | ‹ › ke minggu yang tidak menyentuh bulan `Period` mengirim bulan baru (bulan hari Kamis minggu itu); canvas memuat ulang seperti ganti bulan |
| `LOAD_MORE` `{period, loaded}` | hanya kalau `HasMore` dipakai |

Filter platform, status dan kotak cari (brand, akun, Schedule ID, studio) jalan di control, tanpa reload.

## 7. ScheduleDetail (layar *Detail sesi*)

`OnChange` lengkap: bagian 10.

Kirim sesi itu **plus sesi lain host di hari yang sama** (untuk daftar *Sesi lain hari ini*):

```powerfx
// Screen.OnVisible  (varSchId dan varSchDate diisi oleh OPEN_SCHEDULE)
Set(varSdLoading, true);
ClearCollect(colSdSch, Filter(scheduleFiltered, HostID = varMe.Title, Date = varSchDate));
// hari sebelumnya ikut: shift 22:00 → 03:00 kemarin juga menutup sesi 00:30 hari ini
ClearCollect(colSdClk, Filter(clockInFiltered, HostID = varMe.Title, ClockInDate >= DateAdd(varSchDate, -1), ClockInDate <= varSchDate));
ClearCollect(colSdAbs, Filter(absenceFiltered, HostID = varMe.Title, LiveDate = varSchDate));
ClearCollect(colSdRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate = varSchDate));
Set(varSdLoading, false);
```

| Properti | Nilai |
|---|---|
| `ScheduleId` | `varSchId` (Title `SCD-…`, atau ID item) |
| `SchedulesJson` | `JSON(ForAll(colSdSch, {ID: ID, Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime, BrandID: BrandID, StudioID: StudioID, HostID: HostID, Platform: Platform.Value, AccountID: Account, AccountName: With({a: Account}, LookUp(colAccounts, Title = a).AccountName), LiveBreak: Coalesce(LiveBreak.Value, "No"), Position: Position.Value, Status: Status.Value}), JSONFormat.Compact)` (wajib ada `AccountName`, kalau tidak kolom Akun menampilkan kode akun atau kosong) |
| `ClockInJson` | `JSON(ForAll(colSdClk, {ID: ID, ClockInDate: Text(ClockInDate, "yyyy-mm-dd"), CheckInTime: CheckInTime, CheckOutTime: CheckOutTime, ClockOutDate: Text(ClockOutDate, "yyyy-mm-dd"), ClockInTime: ClockInTime, CheckInOffice: CheckInOffice, IsInsideGeofence: IsInsideGeofence}), JSONFormat.Compact)` |
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
| `ABSEN` 🔒 | sama dengan HostDashboard (balas ke `varSdResult`, muat ulang `colSdAbs`, `colSdSch`, `colSdRep`) |
| `LIVE_BREAK` 🔒 | pertanyaan *Apakah sesi ini Live Break?* di form report. Handler sama dengan MyReportDetail, balas ke `varSdResult`, lalu muat ulang `colSdSch` dan `colSdRep` |
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
tombol berubah jadi **Send Next Report**; setelah total durasi ≥ durasi jadwal tombol hilang dan status
menjadi `Finished`. Report yang perlu revisi dibuka di tempat (angka, Live ID, Playbook, durasi; perbaiki atau sanggah).
Sesi tanpa clock in diarahkan minta clock in manual ke tim PBS, sesi batal hanya diberi keterangan.

## 8. Pemasangan

1. Import `dist/PBSHubHostApp_1_0_17_0_managed.zip` (Solutions → Import). Bisa di environment yang sama dengan
   `PBSHubOpsPCF` dan dengan solusi host lama.
   **Pindah dari solusi lama** (`PBSHubHostPCF` / `PBSHubHostSchedulePCF`, control `pbs_Host.*`): control baru tidak
   otomatis menggantikan yang lama di canvas. Di tiap layar hapus control lama, tambahkan control `pbs_HostApp.*`
   dengan nama yang sama (mis. `ScheduleDetail1`) supaya formula tetap cocok, isi ulang propertinya dan salin
   `OnChange` dari bagian 10. Setelah semua layar pindah dan app dipublish, solusi lama boleh dihapus.
2. Di canvas app host: **Insert → Get more components → Code** → `PBS Host App Dashboard`, `PBS Host App My Reports`,
   `PBS Host App My Report Detail`, `PBS Host App Clock In`, `PBS Host App My Schedule`, `PBS Host App Schedule Detail`.
3. Tambahkan data source **Office 365 Groups**. Screenshot report (bagian 5) dan selfie clock in (bagian 9)
   diunggah lewat Graph (`Office365Groups.HttpRequest`), tanpa flow.
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
    ClearCollect(colCkClk, Filter(clockInFiltered, HostID = varMe.Title, ClockInDate >= Today() - 1)),
    ClearCollect(colCkSch, Filter(scheduleFiltered, HostID = varMe.Title, Date >= Today() - 1, Date <= Today())),
    ClearCollect(colCkRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate >= Today() - 1))
);
Set(varCkLoading, false)
```

**Properti**

| Properti | Nilai |
|---|---|
| `Context` | `varHostCtx` |
| `HostJson` | `JSON(ForAll(Table(varMe), {Title: Title, NamaHost: NamaHost, Email: Email.Email}), JSONFormat.Compact)` |
| `LocationsJson` | `JSON(ForAll(colCkLoc, {Title: Title, LocationID: LocationID, Latitude: Latitude, Longitude: Longitude, RadiusMeter: RadiusMeter, IsActive: IsActive}), JSONFormat.Compact)` |
| `ClockInJson` | `JSON(ForAll(colCkClk, {ID: ID, Title: Title, HostID: HostID, ClockInDate: Text(ClockInDate, "yyyy-mm-dd"), CheckInTime: CheckInTime, CheckOutTime: CheckOutTime, ClockOutDate: Text(ClockOutDate, "yyyy-mm-dd"), ClockInTime: ClockInTime, ClockOutTime: ClockOutTime, CheckInOffice: CheckInOffice, Reason: Reason}), JSONFormat.Compact)` |
| `SchedulesJson` | `JSON(ForAll(colCkSch, {Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime, HostID: HostID, Status: Status.Value}), JSONFormat.Compact)` — untuk `ScheduleCount` (sesi *Cancelled* tidak dihitung) |
| `ReportsJson` | `JSON(ForAll(colCkRep, {Title: Title, ScheduleID: ScheduleID, HostID: HostID, LiveDate: Text(LiveDate, "yyyy-mm-dd")}), JSONFormat.Compact)` — untuk `TotalReports` saat clock out |
| `DeviceLocationJson` | `JSON({Latitude: Location.Latitude, Longitude: Location.Longitude}, JSONFormat.Compact)` — cadangan kalau browser/WebView menolak GPS; akurasinya tidak diketahui |
| `IsLoading` / `ActionResult` | `varCkLoading` / `varCkResult` |
| `ReferenceDate` | kosong (hanya untuk tes) |

Output kedua **`UploadData`** berisi base64 JPEG selfie, terisi bersama `CLOCK_IN` / `CLOCK_OUT` — polanya sama
dengan screenshot report (bagian 5). Nama file disusun control: `HST-001_20260925_IN_0803.jpg` / `…_OUT_1733.jpg`.

**Upload selfie — Graph, tanpa flow.** Sama dengan screenshot report: `Office365Groups.HttpRequest` PUT ke
`PBS Power Apps/Absence/<yyyy>/<mmmm>/<dd-mm-yyyy>/<nama file>` (mis. `Absence/2026/September/27-09-2026/`).
Tahun, bulan dan tanggal diambil dari hari clock in, jadi selfie clock out masuk folder yang sama walaupun shift
lewat tengah malam. `webUrl` dari respons → `SelfiePhotoUrl` / `SelfieOutPhotoUrl`. Butuh `varSiteID` /
`varDriveID` yang sama dengan screenshot report.

**Payload**

`CLOCK_IN`: `{hostId, hostName, employeeName, employeeEmail, clockInDate, checkInTime (ISO), clockInTime ("HH:mm"),
status, hkTugas, scheduleCount, latitude, longitude, accuracy, distance, office, locationId, inside, radius,
positionSource ("device" | "canvas"), reason, selfieSource ("Camera" | "Gallery"), deviceType ("Mobile" | "Tablet" | "Desktop"), deviceInfo (mis. "Android 14 · Chrome 126 · 412x915"), file: {name, ext, contentType, bytes, width, height}}`

`CLOCK_OUT`: `{clockInId, clockInTitle, hostId, clockOutDate, checkOutTime, clockOutTime, workingMinutes, workingHours,
scheduleCount, totalReports, statusAbsence, latitude, longitude, accuracy, distance, office, locationId, inside,
radius, positionSource, reason, reasonText, selfieSource, deviceType, deviceInfo, file}`. `reasonText` = alasan clock in + `[Clock out] …`
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
                        If(!IsBlank(LookUp(clockInFiltered, HostID = varMe.Title && ClockInDate = Today())),
                            Set(varCkResult, JSON({requestId: rid, status: "conflict", message: "Kamu sudah clock in hari ini. Satu hari hanya satu clock in."}, JSONFormat.Compact)),
                        // Shift semalam yang masih berjalan (< 16 jam) harus di-clock out dulu. 16 = maxShiftHours.
                        !IsBlank(LookUp(clockInFiltered, HostID = varMe.Title && IsBlank(CheckOutTime) && !IsBlank(CheckInTime) && DateDiff(CheckInTime, Now(), TimeUnit.Minutes) < 16 * 60)),
                            Set(varCkResult, JSON({requestId: rid, status: "conflict", message: "Shift sebelumnya masih berjalan. Clock out dulu."}, JSONFormat.Compact)),
                            IfError(
                                // Selfie dulu: nama file tidak butuh ID, jadi upload gagal tidak meninggalkan baris tanpa foto.
                                // PBS Power Apps/Absence/<yyyy>/<mmmm>/<dd-mm-yyyy>/<file> lewat Graph (sama dengan screenshot report).
                                With({up: Office365Groups.HttpRequest(
                                    "https://graph.microsoft.com/v1.0/sites/" & varSiteID & "/drives/" & varDriveID & "/root:/Absence/" &
                                    Text(Today(), "yyyy") & "/" & Text(Today(), "mmmm") & "/" & Text(Today(), "dd-mm-yyyy") & "/" & Text(p.file.name) & ":/content",
                                    "PUT",
                                    "data:image/jpeg;base64," & data
                                )},
                                    With({row: With({_new: Patch('Clock In - PBS Hub', Defaults('Clock In - PBS Hub'), {
                                            HostID: varMe.Title, HostName: Text(p.hostName),
                                            EmployeeName: Text(p.employeeName), EmployeeEmail: Text(p.employeeEmail),
                                            ClockInDate: Today(), CheckInTime: Now(), ClockInTime: Text(Now(), "hh:mm"),
                                            Status: {Value: Text(p.status)}, HKTugas: Value(p.hkTugas),
                                            ScheduleCount: Value(p.scheduleCount),
                                            CheckInLatitude: Value(p.latitude), CheckInLongitude: Value(p.longitude),
                                            CheckInAccuracy: Value(p.accuracy), CheckInDistance: Value(p.distance),
                                            CheckInOffice: Text(p.office), IsInsideGeofence: Boolean(p.inside),
                                            Reason: Text(p.reason), SelfieSource: Text(p.selfieSource),
                                            CheckInDevice: Text(p.deviceType), CheckInDeviceInfo: Text(p.deviceInfo),   // kolom Text baru: HP / tablet / laptop
                                            SelfiePhotoUrl: Text(up.webUrl)
                                        })}, Collect(clockInFiltered, _new); _new)},
                                        With({_upd: Patch('Clock In - PBS Hub', row, {Title: "CLK-" & Text(row.ID, "0000")})}, RemoveIf(clockInFiltered, ID = _upd.ID); Collect(clockInFiltered, _upd); _upd);
                                        ClearCollect(colCkClk, Filter(clockInFiltered, HostID = varMe.Title, ClockInDate >= Today() - 1));
                                        Set(varCkResult, JSON({requestId: rid, status: "ok", message: "Clock in " & Text(Now(), "hh:mm") & " tersimpan (CLK-" & Text(row.ID, "0000") & ")."}, JSONFormat.Compact))
                                    )
                                ),
                                Set(varCkResult, JSON({requestId: rid, status: "error", message: "Gagal clock in: " & FirstError.Message}, JSONFormat.Compact))
                            )
                        ),
                    "CLOCK_OUT",
                        With({cur: LookUp(clockInFiltered, ID = Value(p.clockInId) && HostID = varMe.Title)},
                            If(IsBlank(cur) || !IsBlank(cur.CheckOutTime),
                                Set(varCkResult, JSON({requestId: rid, status: "conflict", message: "Shift ini sudah di-clock out. Muat ulang."}, JSONFormat.Compact)),
                            // Shift maksimal 16 jam (= maxShiftHours): lewat dari itu jam clock out diisi Ops.
                            DateDiff(cur.CheckInTime, Now(), TimeUnit.Minutes) > 16 * 60,
                                Set(varCkResult, JSON({requestId: rid, status: "conflict", message: "Shift sudah lewat 16 jam, clock out ditutup. Minta tim PBS mengisi jam clock out."}, JSONFormat.Compact)),
                                IfError(
                                    // Folder tanggal clock in (bukan hari ini): shift lewat tengah malam tetap satu folder.
                                    With({up: Office365Groups.HttpRequest(
                                        "https://graph.microsoft.com/v1.0/sites/" & varSiteID & "/drives/" & varDriveID & "/root:/Absence/" &
                                        Text(cur.ClockInDate, "yyyy") & "/" & Text(cur.ClockInDate, "mmmm") & "/" & Text(cur.ClockInDate, "dd-mm-yyyy") & "/" & Text(p.file.name) & ":/content",
                                        "PUT",
                                        "data:image/jpeg;base64," & data
                                    )},
                                        With({_upd: Patch('Clock In - PBS Hub', cur, {
                                            CheckOutTime: Now(), ClockOutDate: Today(),
                                            ClockOutTime: Coalesce(Text(p.clockOutTime), Text(Now(), "hh:mm")),   // "HH:mm", pasangan ClockInTime
                                            CheckOutLatitude: Value(p.latitude), CheckOutLongitude: Value(p.longitude),
                                            CheckOutAccuracy: Value(p.accuracy), CheckOutDistance: Value(p.distance),
                                            CheckOutOffice: Text(p.office),
                                            CheckOutDevice: Text(p.deviceType), CheckOutDeviceInfo: Text(p.deviceInfo),   // kolom Text baru
                                            WorkingDuration: DateDiff(Coalesce(cur.CheckInTime, Now()), Now(), TimeUnit.Minutes),  // menit; pakai /60 kalau kolomnya jam
                                            ScheduleCount: Value(p.scheduleCount), TotalReports: Value(p.totalReports),
                                            Reason: Text(p.reasonText),
                                            SelfieOutPhotoUrl: Text(up.webUrl)
                                            // , StatusAbsence: {Value: Text(p.statusAbsence)}   ← aktifkan kalau config.statusAbsence diisi
                                        })}, RemoveIf(clockInFiltered, ID = _upd.ID); Collect(clockInFiltered, _upd); _upd)
                                    );
                                    ClearCollect(colCkClk, Filter(clockInFiltered, HostID = varMe.Title, ClockInDate >= Today() - 1));
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
- **Satu hari maksimal satu clock in, tapi bisa dua clock out.** `ClockInDate = Today()` di pengecekan konflik:
  satu baris clock in per host per hari (sama dengan clock in manual di Ops). Clock out dihitung per shift, jadi
  tanggal 29 bisa punya dua clock out: 03:00 (menutup shift tanggal 28) dan 18:00 (menutup shift tanggal 29).
- **Shift maksimal 16 jam** (`maxShiftHours`). Mulai jam ke-14 host diberi peringatan dengan batas jam clock out.
  Lewat 16 jam, shift itu dianggap lupa clock out: `CLOCK_OUT` ditolak dan jam clock out diisi Ops lewat
  *Sesuaikan* di HostDetail. Kalau shift itu dari hari sebelumnya, host tetap bisa clock in hari ini. Kalau dari
  hari ini, tidak ada clock in kedua. Angka `16` di formula harus sama dengan `maxShiftHours`.
- **Shift lewat tengah malam** (jadwal 28 Sep 22:00 → 29 Sep 03:00): `ClockInDate` = 28 (hari clock in),
  `CLOCK_OUT` menulis `ClockOutDate: Today()` = 29. Pengecekan konflik hanya melihat `ClockInDate`, jadi host tetap
  bisa clock in lagi tanggal 29 untuk jadwal berikutnya. Selama shift masih terbuka (jam 02:00 tanggal 29), layar
  Clock In menampilkan shift tanggal 28 dengan tombol *Clock Out* — karena itu `colCkClk` memuat `Today() - 1`.
  Sesi yang mulai sesudah tengah malam di dalam shift itu (29 Sep 00:30) dihitung sudah clock in.
- **Perangkat.** Control membaca browser yang dipakai (aplikasi Power Apps di HP, browser HP, browser laptop) dan mengirim `deviceType` = `Mobile` / `Tablet` / `Desktop` plus `deviceInfo` (OS · browser · ukuran layar). Buat 4 kolom **Text** di `Clock In - PBS Hub`: `CheckInDevice`, `CheckInDeviceInfo`, `CheckOutDevice`, `CheckOutDeviceInfo` (`Note` untuk yang `…Info`). Kolom belum dibuat? Hapus barisnya dari formula. Di PBS Console tab *Kehadiran* muncul kolom *Perangkat* (HP / Tablet / Laptop; *HP → Laptop* kalau clock out dari perangkat lain) kalau `ClockInJson` HostDetail ikut mengirim keempat kolom itu.
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
`scrScheduleDetail`, `scrClockIn`, `scrCreditScore` (Skor saya); upload screenshot Graph dengan `varSiteID` / `varDriveID` (bagian 5). Ganti kalau
nama di app berbeda. Schedule tidak punya kolom nama akun: `Schedule.Account` adalah `Title` di list Account, dan
namanya diambil dari `colAccounts` (dimuat di App.OnStart). `AccountID` di Report diisi kode akun (`s.Account`).

Kolom **`Account` di Report adalah Choice** (dicocokkan ke pilihan lewat nama akun, tanpa peduli huruf besar-kecil/spasi) dan **di Host Absence teks**: diisi nama akun dari `colAccounts` (`Title = s.Account` → `AccountName`), dengan cadangan `accountName` dari payload lalu kode akun.

| Layar | Variabel `ActionResult` | Koleksi yang diperbarui |
|---|---|---|
| Hari ini (HostDashboard) | `varHdResult` | `colMyAbs`, `colMySch`, `colMyRep` |
| Report saya (MyReports) | — (tidak ada aksi terkunci) | `colMrRep`, `colMrSch` |
| Kirim / revisi report (MyReportDetail) | `varMrdResult` | `colMrdAbs`, `colMrdSesRep`, `varMrdSch`, `varMrdRep` |
| Jadwal saya (MySchedule) | `varMsResult` | `colMsAbs`, `colMsSch`, `colMsRep`, koleksi `colMs…` saat ganti bulan |
| Detail sesi (ScheduleDetail) | `varSdResult` | `colSdAbs`, `colSdSch`, `colSdRep` |
| Skor saya (CreditScore) | — (hanya membaca) | `colCsTx` saat *Muat lebih banyak* |

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
                        // Jadwal dicari lewat ID SharePoint (scheduleItemId), Title hanya dicocokkan.
                        With({s: LookUp(scheduleFiltered, ID = Value(p.scheduleItemId)),
                              ex: LookUp(absenceFiltered, ScheduleID = Text(p.scheduleId) && HostID = varMe.Title),
                              st: Coalesce(Text(p.scheduleStatus), "Waiting Report")},   // dari control: Waiting Report, atau Finished (Co-Host)
                            If(
                                IsBlank(s) || s.Title <> Text(p.scheduleId) || s.HostID <> varMe.Title,
                                    Set(varHdResult, JSON({requestId: rid, status: "error", message: "Jadwal " & Text(p.scheduleId) & " tidak ditemukan untuk akunmu. Muat ulang dulu."}, JSONFormat.Compact)),
                                // Satu ScheduleID = satu absen. Sudah ada → ditolak, tidak ada baris absen baru.
                                // Absen lama yang gagal di tengah (jadwal masih Planned / Status belum Hadir) dilengkapi sekalian.
                                !IsBlank(ex),
                                    If(s.Status.Value <> "Waiting Report" && s.Status.Value <> "Finished" && s.Status.Value <> "Done",
                                        With({_upd: Patch('Schedule - PBS Hub', s, {Status: {Value: st}})}, RemoveIf(scheduleFiltered, ID = _upd.ID); Collect(scheduleFiltered, _upd); _upd));
                                    If(Coalesce(ex.Status.Value, "") <> "Hadir", With({_upd: Patch('Host Absence - PBS Hub', ex, {Status: {Value: "Hadir"}})}, RemoveIf(absenceFiltered, ID = _upd.ID); Collect(absenceFiltered, _upd); _upd));
                                    If(!(ex.ID in colMyAbs.ID), Collect(colMyAbs, LookUp(absenceFiltered, ID = ex.ID)));
                                    ClearCollect(colMySch, Filter(scheduleFiltered, HostID = varMe.Title, Date >= Today() - 7, Date <= Today() + 7));
                                    ClearCollect(colMyRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate >= Today() - 30));
                                    Set(varHdResult, JSON({requestId: rid, status: "conflict", message: "Absen sesi ini sudah tercatat (" & ex.Title & "). Status jadwal " & LookUp(scheduleFiltered, ID = s.ID).Status.Value & "."}, JSONFormat.Compact)),
                                // 1. Status jadwal. Gagal → pesan error asli, belum ada yang ditulis.
                                With({sp: IfError(With({_upd: Patch('Schedule - PBS Hub', s, {Status: {Value: st}})}, RemoveIf(scheduleFiltered, ID = _upd.ID); Collect(scheduleFiltered, _upd); _upd),
                                            Set(varHdResult, JSON({requestId: rid, status: "error", message: "Gagal mengubah status jadwal ke " & st & ": " & FirstError.Message}, JSONFormat.Compact)); Blank())},
                                    If(!IsBlank(sp),
                                            // 2. Baris absen baru, Status Hadir.
                                            With({row: IfError(With({_new: Patch('Host Absence - PBS Hub', Defaults('Host Absence - PBS Hub'), {
                                                        ScheduleID: s.Title, HostID: varMe.Title, HostName: Coalesce(LookUp('Host - PBS Hub', Title = varMe.Title).NamaHost, Text(p.hostName)), LiveDate: s.Date,
                                                        BrandID: s.BrandID, Platform: {Value: s.Platform.Value},
                                                        Account: Coalesce(LookUp(colAccounts, Title = s.Account).AccountName, Text(p.accountName), s.Account),
                                                        Status: {Value: "Hadir"}   // Choice Status di Host Absence; kalau kolomnya teks: Status: "Hadir"
                                                    })}, Collect(absenceFiltered, _new); _new),
                                                    Set(varHdResult, JSON({requestId: rid, status: "error", message: "Status jadwal sudah " & st & ", tapi absen gagal dicatat: " & FirstError.Message}, JSONFormat.Compact)); Blank())},
                                                If(!IsBlank(row),
                                                    With({_upd: Patch('Host Absence - PBS Hub', row, {Title: "ABS-" & row.ID})}, RemoveIf(absenceFiltered, ID = _upd.ID); Collect(absenceFiltered, _upd); _upd);
                                                    Collect(colMyAbs, LookUp(absenceFiltered, ID = row.ID));
                                                    ClearCollect(colMySch, Filter(scheduleFiltered, HostID = varMe.Title, Date >= Today() - 7, Date <= Today() + 7));
                                                    ClearCollect(colMyRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate >= Today() - 30));
                                                    // Pesan membaca ulang SharePoint, jadi yang tampil adalah status yang benar-benar tersimpan.
                                                    Set(varHdResult, JSON({requestId: rid, status: "ok", message: "Absen tercatat (ABS-" & row.ID & "). Status jadwal sekarang " & LookUp(scheduleFiltered, ID = s.ID).Status.Value & "."}, JSONFormat.Compact))
                                                )
                                            )
                                    )
                                )
                            )
                        ),
                    "NEW_REPORT",
                        Set(varRptSchedule, Text(p.scheduleId)); Set(varRptId, Blank()); Navigate(scrMyReportDetail),
                    "OPEN_REPORT",
                        Set(varRptId, Value(p.reportId)); Set(varRptSchedule, Text(p.scheduleId)); Navigate(scrMyReportDetail),
                    "OPEN_SCHEDULE",
                        Set(varSchId, Text(p.scheduleId)); Set(varSchDate, DateValue(Text(p.liveDate))); Navigate(scrScheduleDetail),
                    "NAV",
                        Switch(Text(p.target), "REPORTS", Navigate(scrMyReports), "SCHEDULE", Navigate(scrMySchedule), "SCORE", Navigate(scrCreditScore)),
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
                            ClearCollect(colMrRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate >= from, LiveDate < DateAdd(from, 1, TimeUnit.Months)));
                            ClearCollect(colMrSch, Filter(scheduleFiltered, HostID = varMe.Title, Date >= from, Date < DateAdd(from, 1, TimeUnit.Months)))
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
`varMrdRep` sengaja tidak diisi, jadi form tetap di layar dengan tombol *Send Next Report*.

```powerfx
If(!IsBlank(Self.ActionPayload),
    With({req: ParseJSON(Self.ActionPayload)},
        With({act: Text(req.action), rid: Text(req.requestId), p: req.payload, data: Self.UploadData},
            If(!(rid in colPbsProcessed.Id),
                Collect(colPbsProcessed, {Id: rid});
                Switch(act,
                    "ABSEN",
                        // Jadwal dicari lewat ID SharePoint (scheduleItemId), Title hanya dicocokkan.
                        With({s: LookUp(scheduleFiltered, ID = Value(p.scheduleItemId)),
                              ex: LookUp(absenceFiltered, ScheduleID = Text(p.scheduleId) && HostID = varMe.Title),
                              st: Coalesce(Text(p.scheduleStatus), "Waiting Report")},   // dari control: Waiting Report, atau Finished (Co-Host)
                            If(
                                IsBlank(s) || s.Title <> Text(p.scheduleId) || s.HostID <> varMe.Title,
                                    Set(varMrdResult, JSON({requestId: rid, status: "error", message: "Jadwal " & Text(p.scheduleId) & " tidak ditemukan untuk akunmu. Muat ulang dulu."}, JSONFormat.Compact)),
                                // Satu ScheduleID = satu absen. Sudah ada → ditolak, tidak ada baris absen baru.
                                // Absen lama yang gagal di tengah (jadwal masih Planned / Status belum Hadir) dilengkapi sekalian.
                                !IsBlank(ex),
                                    If(s.Status.Value <> "Waiting Report" && s.Status.Value <> "Finished" && s.Status.Value <> "Done",
                                        With({_upd: Patch('Schedule - PBS Hub', s, {Status: {Value: st}})}, RemoveIf(scheduleFiltered, ID = _upd.ID); Collect(scheduleFiltered, _upd); _upd));
                                    If(Coalesce(ex.Status.Value, "") <> "Hadir", With({_upd: Patch('Host Absence - PBS Hub', ex, {Status: {Value: "Hadir"}})}, RemoveIf(absenceFiltered, ID = _upd.ID); Collect(absenceFiltered, _upd); _upd));
                                    If(!(ex.ID in colMrdAbs.ID), Collect(colMrdAbs, LookUp(absenceFiltered, ID = ex.ID)));
                                    Set(varMrdSch, LookUp(scheduleFiltered, ID = varMrdSch.ID));
                                    ClearCollect(colMrdSesRep, Filter(reportFiltered, HostID = varMe.Title, ScheduleID = varMrdSch.Title));
                                    Set(varMrdResult, JSON({requestId: rid, status: "conflict", message: "Absen sesi ini sudah tercatat (" & ex.Title & "). Status jadwal " & LookUp(scheduleFiltered, ID = s.ID).Status.Value & "."}, JSONFormat.Compact)),
                                // 1. Status jadwal. Gagal → pesan error asli, belum ada yang ditulis.
                                With({sp: IfError(With({_upd: Patch('Schedule - PBS Hub', s, {Status: {Value: st}})}, RemoveIf(scheduleFiltered, ID = _upd.ID); Collect(scheduleFiltered, _upd); _upd),
                                            Set(varMrdResult, JSON({requestId: rid, status: "error", message: "Gagal mengubah status jadwal ke " & st & ": " & FirstError.Message}, JSONFormat.Compact)); Blank())},
                                    If(!IsBlank(sp),
                                            // 2. Baris absen baru, Status Hadir.
                                            With({row: IfError(With({_new: Patch('Host Absence - PBS Hub', Defaults('Host Absence - PBS Hub'), {
                                                        ScheduleID: s.Title, HostID: varMe.Title, HostName: Coalesce(LookUp('Host - PBS Hub', Title = varMe.Title).NamaHost, Text(p.hostName)), LiveDate: s.Date,
                                                        BrandID: s.BrandID, Platform: {Value: s.Platform.Value},
                                                        Account: Coalesce(LookUp(colAccounts, Title = s.Account).AccountName, Text(p.accountName), s.Account),
                                                        Status: {Value: "Hadir"}   // Choice Status di Host Absence; kalau kolomnya teks: Status: "Hadir"
                                                    })}, Collect(absenceFiltered, _new); _new),
                                                    Set(varMrdResult, JSON({requestId: rid, status: "error", message: "Status jadwal sudah " & st & ", tapi absen gagal dicatat: " & FirstError.Message}, JSONFormat.Compact)); Blank())},
                                                If(!IsBlank(row),
                                                    With({_upd: Patch('Host Absence - PBS Hub', row, {Title: "ABS-" & row.ID})}, RemoveIf(absenceFiltered, ID = _upd.ID); Collect(absenceFiltered, _upd); _upd);
                                                    Collect(colMrdAbs, LookUp(absenceFiltered, ID = row.ID));
                                                    Set(varMrdSch, LookUp(scheduleFiltered, ID = varMrdSch.ID));
                                                    ClearCollect(colMrdSesRep, Filter(reportFiltered, HostID = varMe.Title, ScheduleID = varMrdSch.Title));
                                                    // Pesan membaca ulang SharePoint, jadi yang tampil adalah status yang benar-benar tersimpan.
                                                    Set(varMrdResult, JSON({requestId: rid, status: "ok", message: "Absen tercatat (ABS-" & row.ID & "). Status jadwal sekarang " & LookUp(scheduleFiltered, ID = s.ID).Status.Value & "."}, JSONFormat.Compact))
                                                )
                                            )
                                    )
                                )
                            )
                        ),
                    "SUBMIT_REPORT",
                        With({m: p.metrics, s: LookUp(scheduleFiltered, Title = Text(p.scheduleId) && HostID = varMe.Title)},
                            // Hapus cabang ini kalau config.requireAbsen = false.
                            If(IsBlank(LookUp(absenceFiltered, ScheduleID = Text(p.scheduleId) && HostID = varMe.Title)),
                                Set(varMrdResult, JSON({requestId: rid, status: "error", message: "Absen sesi ini belum tercatat."}, JSONFormat.Compact)),
                            // Report hanya dibuka saat jadwal Waiting Report (hapus kalau config.requireWaitingStatus = false).
                            // Setelah durasi terpenuhi statusnya Finished, jadi report tambahan ditolak di sini.
                            s.Status.Value <> "Waiting Report",
                                Set(varMrdResult, JSON({requestId: rid, status: "conflict", message: "Status jadwal " & s.Status.Value & ", report tidak bisa dikirim. Muat ulang dulu."}, JSONFormat.Compact)),
                            // Live terputus boleh punya beberapa report, tapi satu Live ID hanya sekali.
                            !IsBlank(LookUp(reportFiltered, ScheduleID = s.Title && HostID = varMe.Title && LiveID = Text(p.liveId))),
                                Set(varMrdResult, JSON({requestId: rid, status: "conflict", message: "Live ID " & Text(p.liveId) & " sudah dilaporkan untuk sesi ini."}, JSONFormat.Compact)),
                                IfError(
                                    With({row: With({_new: Patch('Report - PBS Hub', Defaults('Report - PBS Hub'), {
                                            ScheduleID: s.Title, HostID: varMe.Title, BrandID: s.BrandID, Platform: {Value: s.Platform.Value},
                                            AccountID: s.Account, HostName: Coalesce(LookUp('Host - PBS Hub', Title = varMe.Title).NamaHost, Text(p.hostName)),   // nama host dari list Host
                                            Account: With({nm: Trim(Coalesce(LookUp(colAccounts, Title = s.Account).AccountName, Text(p.accountName), s.Account)), cd: Trim(s.Account)},
                            Coalesce(LookUp(Choices([@'Report - PBS Hub'].Account), Lower(Trim(Value)) = Lower(nm) || Lower(Trim(Value)) = Lower(cd) || (Len(nm) > 0 && Lower(nm) in Lower(Value)) || (Len(cd) > 0 && Lower(cd) in Lower(Value))), {Value: nm})),   // Choice: cocokkan nama akun, cadangan teks nama
                                            LiveDate: s.Date, AbsID: Text(p.absId),
                                            Penjualan: Value(m.Penjualan), Pesanan: Value(m.Pesanan), ProdukTerjual: Value(m.ProdukTerjual),
                                            JumlahPembeli: Value(m.JumlahPembeli), CTR: Value(m.CTR), CTOR: Value(m.CTOR), PeakViewer: Value(m.PeakViewer),
                                            'Durasi(Min)': Value(m.'Durasi(Min)'), AddToCart: Value(m.AddToCart), TotalViewer: Value(m.TotalViewer),
                                            Comment: Value(m.Comment),
                                            LiveID: Text(p.liveId), Playbook: {Value: Text(p.playbook)},
                                            ApprovalStatus: {Value: "Waiting Approval"}
                                        })}, Collect(reportFiltered, _new); _new)},
                                        With({title: "REP-" & row.ID},
                                            With({_upd: Patch('Report - PBS Hub', row, {Title: title})}, RemoveIf(reportFiltered, ID = _upd.ID); Collect(reportFiltered, _upd); _upd);
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
                                                    With({_upd: Patch('Report - PBS Hub', row, {Attachment: Text(up.webUrl)})}, RemoveIf(reportFiltered, ID = _upd.ID); Collect(reportFiltered, _upd); _upd)
                                                )
                                            );
                                            // Total Durasi(Min) semua report sesi ini ≥ durasi jadwal → "Finished", kalau belum tetap "Waiting Report".
                                            With({_upd: Patch('Schedule - PBS Hub', s, {Status: {Value: Text(p.scheduleStatus)}})}, RemoveIf(scheduleFiltered, ID = _upd.ID); Collect(scheduleFiltered, _upd); _upd);
                                            // ---- Tier harian di Clock In: host ini, tanggal s.Date. Aturan sama dengan hitung ulang bulanan.
                                            IfError(
                                                With({tDate: s.Date},
                                                With({clk: LookUp(clockInFiltered, HostID = varMe.Title && ClockInDate = tDate),
                                                      schDay: Filter(scheduleFiltered, HostID = varMe.Title && Date = tDate),
                                                      repDay: Filter(reportFiltered, HostID = varMe.Title && LiveDate = tDate),
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
                                                      // Akun terbaik hari itu: TotalViewer dijumlah, Avg View Duration (kolom PeakViewer) dan CTR diambil maksimum.
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
                                                    With({_upd: Patch('Clock In - PBS Hub', clk, {
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
                                                                Coalesce(best.CTR, 0) & " (min " & t3.CTR & "), Avg View Duration: " & Coalesce(best.PeakViewer, 0) & " (min " & t3.AvgViewDur &
                                                                "), Durasi: " & jam & " jam (min " & t3.Duration & " jam)",
                                                            tier & " karena " & Concat(Filter([
                                                                If(w1, "Jam Live 00:00-06:00 (" & t1Win & " menit, min " & varT1MinInWindow & ")", ""),
                                                                If(w2, "Jam Live 21:00-24:00 (" & t2Win & " menit, min " & varT2MinInWindow & ")", ""),
                                                                If(m1, "Metric Tier 1 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Avg View Duration " & best.PeakViewer & ")", ""),
                                                                If(m2 && !m1, "Metric Tier 2 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Avg View Duration " & best.PeakViewer & ")", ""),
                                                                If(m3 && !m2, "Metric Tier 3 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Avg View Duration " & best.PeakViewer & ")", ""),
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
                                                    })}, RemoveIf(clockInFiltered, ID = _upd.ID); Collect(clockInFiltered, _upd); _upd);
                                                    true   // IfError butuh tipe yang sama dengan Notify (Boolean), bukan record hasil Patch
                                                )))))))))),
                                                // Report tetap tersimpan kalau hitung Tier gagal; hitung ulang bulanan akan membetulkannya.
                                                Notify("Report tersimpan, tapi Tier belum terhitung: " & FirstError.Message, NotificationType.Warning)
                                            );
                                            Set(varMrdSch, LookUp(scheduleFiltered, ID = varMrdSch.ID));
                                            ClearCollect(colMrdSesRep, Filter(reportFiltered, HostID = varMe.Title, ScheduleID = varMrdSch.Title));
                                            If(Boolean(p.complete), Set(varRptId, row.ID); Set(varMrdRep, LookUp(reportFiltered, ID = row.ID)));
                                            Set(varMrdResult, JSON({requestId: rid, status: "ok", message: If(Boolean(p.complete), "Report " & title & " terkirim. Durasi sesi terpenuhi.", "Report " & title & " terkirim. Kurang " & Text(p.remainingMin) & " menit, kirim report berikutnya.")}, JSONFormat.Compact))
                                        )
                                    ),
                                    Set(varMrdResult, JSON({requestId: rid, status: "error", message: "Gagal mengirim report: " & FirstError.Message}, JSONFormat.Compact))
                                )
                            )
                        ),
                    "LIVE_BREAK",
                        With({s: LookUp(scheduleFiltered, Title = Text(p.scheduleId) && HostID = varMe.Title),
                              ex: LookUp(absenceFiltered, ScheduleID = Text(p.scheduleId) && HostID = varMe.Title)},
                            If(IsBlank(s),
                                Set(varMrdResult, JSON({requestId: rid, status: "error", message: "Jadwal " & Text(p.scheduleId) & " tidak ditemukan untuk akunmu. Muat ulang dulu."}, JSONFormat.Compact)),
                            // Sama dengan report: harus sudah absen dan jadwal Waiting Report.
                            IsBlank(ex),
                                Set(varMrdResult, JSON({requestId: rid, status: "error", message: "Absen sesi ini belum tercatat."}, JSONFormat.Compact)),
                            s.Status.Value <> "Waiting Report",
                                Set(varMrdResult, JSON({requestId: rid, status: "conflict", message: "Status jadwal " & s.Status.Value & ", Live Break tidak bisa ditandai. Muat ulang dulu."}, JSONFormat.Compact)),
                            // Sudah ada report untuk sesi ini (live terputus sebagian): bukan Live Break lagi.
                            !IsBlank(LookUp(reportFiltered, ScheduleID = s.Title && HostID = varMe.Title)),
                                Set(varMrdResult, JSON({requestId: rid, status: "conflict", message: "Sesi ini sudah punya report, jadi tidak bisa ditandai Live Break."}, JSONFormat.Compact)),
                                IfError(
                                    With({rep: With({_new: Patch('Report - PBS Hub', Defaults('Report - PBS Hub'), {
                                            ScheduleID: s.Title, HostID: varMe.Title, BrandID: s.BrandID, Platform: {Value: s.Platform.Value},
                                            AccountID: s.Account, HostName: Coalesce(LookUp('Host - PBS Hub', Title = varMe.Title).NamaHost, Text(p.hostName)),   // nama host dari list Host
                                            Account: With({nm: Trim(Coalesce(LookUp(colAccounts, Title = s.Account).AccountName, Text(p.accountName), s.Account)), cd: Trim(s.Account)},
                            Coalesce(LookUp(Choices([@'Report - PBS Hub'].Account), Lower(Trim(Value)) = Lower(nm) || Lower(Trim(Value)) = Lower(cd) || (Len(nm) > 0 && Lower(nm) in Lower(Value)) || (Len(cd) > 0 && Lower(cd) in Lower(Value))), {Value: nm})),   // Choice: cocokkan nama akun, cadangan teks nama
                                            LiveDate: s.Date, AbsID: ex.Title,
                                            Penjualan: 0, Pesanan: 0, ProdukTerjual: 0, JumlahPembeli: 0, CTR: 0, CTOR: 0, PeakViewer: 0,
                                            'Durasi(Min)': 0, AddToCart: 0, TotalViewer: 0, Comment: 0,
                                            ApprovalStatus: {Value: "LiveBreak"}
                                        })}, Collect(reportFiltered, _new); _new)},
                                        With({_upd: Patch('Report - PBS Hub', rep, {Title: "REP-" & rep.ID})}, RemoveIf(reportFiltered, ID = _upd.ID); Collect(reportFiltered, _upd); _upd);
                                        // LiveBreak = Yes (Choice Yes/No) dan Status jadwal Finished.
                                        With({_upd: Patch('Schedule - PBS Hub', s, {LiveBreak: {Value: "Yes"}, Status: {Value: Text(p.scheduleStatus)}})}, RemoveIf(scheduleFiltered, ID = _upd.ID); Collect(scheduleFiltered, _upd); _upd);
                                        // ---- Tier harian di Clock In: host ini, tanggal s.Date. Aturan sama dengan hitung ulang bulanan.
                                        IfError(
                                            With({tDate: s.Date},
                                            With({clk: LookUp(clockInFiltered, HostID = varMe.Title && ClockInDate = tDate),
                                                  schDay: Filter(scheduleFiltered, HostID = varMe.Title && Date = tDate),
                                                  repDay: Filter(reportFiltered, HostID = varMe.Title && LiveDate = tDate),
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
                                                  // Akun terbaik hari itu: TotalViewer dijumlah, Avg View Duration (kolom PeakViewer) dan CTR diambil maksimum.
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
                                                With({_upd: Patch('Clock In - PBS Hub', clk, {
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
                                                            Coalesce(best.CTR, 0) & " (min " & t3.CTR & "), Avg View Duration: " & Coalesce(best.PeakViewer, 0) & " (min " & t3.AvgViewDur &
                                                            "), Durasi: " & jam & " jam (min " & t3.Duration & " jam)",
                                                        tier & " karena " & Concat(Filter([
                                                            If(w1, "Jam Live 00:00-06:00 (" & t1Win & " menit, min " & varT1MinInWindow & ")", ""),
                                                            If(w2, "Jam Live 21:00-24:00 (" & t2Win & " menit, min " & varT2MinInWindow & ")", ""),
                                                            If(m1, "Metric Tier 1 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Avg View Duration " & best.PeakViewer & ")", ""),
                                                            If(m2 && !m1, "Metric Tier 2 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Avg View Duration " & best.PeakViewer & ")", ""),
                                                            If(m3 && !m2, "Metric Tier 3 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Avg View Duration " & best.PeakViewer & ")", ""),
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
                                                })}, RemoveIf(clockInFiltered, ID = _upd.ID); Collect(clockInFiltered, _upd); _upd);
                                                true   // IfError butuh tipe yang sama dengan Notify (Boolean), bukan record hasil Patch
                                            )))))))))),
                                            // Report tetap tersimpan kalau hitung Tier gagal; hitung ulang bulanan akan membetulkannya.
                                            Notify("Report tersimpan, tapi Tier belum terhitung: " & FirstError.Message, NotificationType.Warning)
                                        );
                                        Set(varMrdSch, LookUp(scheduleFiltered, ID = varMrdSch.ID));
                                        ClearCollect(colMrdSesRep, Filter(reportFiltered, HostID = varMe.Title, ScheduleID = varMrdSch.Title));
                                        Set(varMrdResult, JSON({requestId: rid, status: "ok", message: "Sesi " & s.Title & " ditandai Live Break. Report 0 dibuat (REP-" & rep.ID & ")."}, JSONFormat.Compact))
                                    ),
                                    Set(varMrdResult, JSON({requestId: rid, status: "error", message: "Gagal menandai Live Break: " & FirstError.Message}, JSONFormat.Compact))
                                )
                            )
                        ),
                    "RESUBMIT_REPORT",
                        With({cur: LookUp(reportFiltered, ID = Value(p.reportId) && HostID = varMe.Title), m: p.metrics},
                            // Modified dari JSON berformat UTC ("…Z"); DateTimeValue mengubahnya ke jam lokal sebelum dibandingkan.
                            If(IsBlank(cur) || cur.ApprovalStatus.Value <> "Need Revision" ||
                               Abs(DateDiff(cur.Modified, DateTimeValue(Text(p.expectedModified)), TimeUnit.Seconds)) > 1,
                                Set(varMrdResult, JSON({requestId: rid, status: "conflict", message: "Report ini sudah berubah. Muat ulang dulu."}, JSONFormat.Compact)),
                                IfError(
                                    With({_upd: Patch('Report - PBS Hub', cur, {
                                        Penjualan: Value(m.Penjualan), Pesanan: Value(m.Pesanan), ProdukTerjual: Value(m.ProdukTerjual),
                                        JumlahPembeli: Value(m.JumlahPembeli), CTR: Value(m.CTR), CTOR: Value(m.CTOR), PeakViewer: Value(m.PeakViewer),
                                        'Durasi(Min)': Value(m.'Durasi(Min)'), AddToCart: Value(m.AddToCart), TotalViewer: Value(m.TotalViewer),
                                        Comment: Value(m.Comment),
                                        LiveID: Text(p.liveId), Playbook: {Value: Text(p.playbook)},
                                        ApprovalStatus: {Value: Text(p.approvalStatus)},   // "Waiting Approval Revision"
                                        ApprovalComment: cur.ApprovalComment & Char(10) & "[Revisi host] " &
                                            If(IsBlank(Text(p.note)), "angka diperbaiki: " & Concat(Table(p.changed), Text(ThisRecord.Value), ", "), Text(p.note))
                                    })}, RemoveIf(reportFiltered, ID = _upd.ID); Collect(reportFiltered, _upd); _upd);
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
                                            With({_upd: Patch('Report - PBS Hub', LookUp(reportFiltered, ID = cur.ID), {Attachment: Text(up.webUrl)})}, RemoveIf(reportFiltered, ID = _upd.ID); Collect(reportFiltered, _upd); _upd))
                                    );
                                    // Durasi bisa ikut direvisi: status jadwal dihitung ulang oleh control (Waiting Report / Finished).
                                    If(!IsBlank(Text(p.scheduleStatus)),
                                        With({_upd: Patch('Schedule - PBS Hub', LookUp(scheduleFiltered, Title = cur.ScheduleID && HostID = varMe.Title), {Status: {Value: Text(p.scheduleStatus)}})}, RemoveIf(scheduleFiltered, ID = _upd.ID); Collect(scheduleFiltered, _upd); _upd));
                                    // Angka berubah → Tier hari itu dihitung ulang.
                                    // ---- Tier harian di Clock In: host ini, tanggal cur.LiveDate. Aturan sama dengan hitung ulang bulanan.
                                    IfError(
                                        With({tDate: cur.LiveDate},
                                        With({clk: LookUp(clockInFiltered, HostID = varMe.Title && ClockInDate = tDate),
                                              schDay: Filter(scheduleFiltered, HostID = varMe.Title && Date = tDate),
                                              repDay: Filter(reportFiltered, HostID = varMe.Title && LiveDate = tDate),
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
                                              // Akun terbaik hari itu: TotalViewer dijumlah, Avg View Duration (kolom PeakViewer) dan CTR diambil maksimum.
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
                                            With({_upd: Patch('Clock In - PBS Hub', clk, {
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
                                                        Coalesce(best.CTR, 0) & " (min " & t3.CTR & "), Avg View Duration: " & Coalesce(best.PeakViewer, 0) & " (min " & t3.AvgViewDur &
                                                        "), Durasi: " & jam & " jam (min " & t3.Duration & " jam)",
                                                    tier & " karena " & Concat(Filter([
                                                        If(w1, "Jam Live 00:00-06:00 (" & t1Win & " menit, min " & varT1MinInWindow & ")", ""),
                                                        If(w2, "Jam Live 21:00-24:00 (" & t2Win & " menit, min " & varT2MinInWindow & ")", ""),
                                                        If(m1, "Metric Tier 1 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Avg View Duration " & best.PeakViewer & ")", ""),
                                                        If(m2 && !m1, "Metric Tier 2 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Avg View Duration " & best.PeakViewer & ")", ""),
                                                        If(m3 && !m2, "Metric Tier 3 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Avg View Duration " & best.PeakViewer & ")", ""),
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
                                            })}, RemoveIf(clockInFiltered, ID = _upd.ID); Collect(clockInFiltered, _upd); _upd);
                                            true   // IfError butuh tipe yang sama dengan Notify (Boolean), bukan record hasil Patch
                                        )))))))))),
                                        // Report tetap tersimpan kalau hitung Tier gagal; hitung ulang bulanan akan membetulkannya.
                                        Notify("Report tersimpan, tapi Tier belum terhitung: " & FirstError.Message, NotificationType.Warning)
                                    );
                                    Set(varMrdRep, LookUp(reportFiltered, ID = cur.ID));
                                    Set(varMrdSch, LookUp(scheduleFiltered, ID = varMrdSch.ID));
                                    ClearCollect(colMrdSesRep, Filter(reportFiltered, HostID = varMe.Title, ScheduleID = varMrdSch.Title));
                                    Set(varMrdResult, JSON({requestId: rid, status: "ok", message: "Revisi terkirim, menunggu review ulang."}, JSONFormat.Compact)),
                                    Set(varMrdResult, JSON({requestId: rid, status: "error", message: "Gagal mengirim revisi: " & FirstError.Message}, JSONFormat.Compact))
                                )
                            )
                        ),
                    "DISPUTE_REVIEW",
                        With({cur: LookUp(reportFiltered, ID = Value(p.reportId) && HostID = varMe.Title)},
                            If(IsBlank(cur) || cur.ApprovalStatus.Value <> "Need Revision",
                                Set(varMrdResult, JSON({requestId: rid, status: "conflict", message: "Report ini sudah tidak menunggu revisi. Muat ulang dulu."}, JSONFormat.Compact)),
                                IfError(
                                    // Status tetap Need Revision; reviewer membaca sanggahan di ApprovalComment.
                                    With({_upd: Patch('Report - PBS Hub', cur, {ApprovalComment: cur.ApprovalComment & Char(10) & "[Sanggahan host] " & Text(p.reason)})}, RemoveIf(reportFiltered, ID = _upd.ID); Collect(reportFiltered, _upd); _upd);
                                    Set(varMrdRep, LookUp(reportFiltered, ID = cur.ID));
                                    Set(varMrdSch, LookUp(scheduleFiltered, ID = varMrdSch.ID));
                                    ClearCollect(colMrdSesRep, Filter(reportFiltered, HostID = varMe.Title, ScheduleID = varMrdSch.Title));
                                    Set(varMrdResult, JSON({requestId: rid, status: "ok", message: "Sanggahan terkirim ke reviewer."}, JSONFormat.Compact)),
                                    Set(varMrdResult, JSON({requestId: rid, status: "error", message: "Gagal mengirim sanggahan: " & FirstError.Message}, JSONFormat.Compact))
                                )
                            )
                        ),
                    "DELETE_REPORT",
                        With({cur: LookUp(reportFiltered, ID = Value(p.reportId) && HostID = varMe.Title)},
                            If(IsBlank(cur),
                                Set(varMrdResult, JSON({requestId: rid, status: "conflict", message: "Report ini sudah tidak ada. Muat ulang dulu."}, JSONFormat.Compact)),
                            // Sudah Match / Done / Live Break: host tidak boleh menghapus (sama dengan aturan di control).
                            Coalesce(cur.Match.Value, "") = "Match" || cur.ApprovalStatus.Value in ["Done", "LiveBreak"],
                                Set(varMrdResult, JSON({requestId: rid, status: "conflict", message: "Report ini sudah Match atau disetujui, jadi tidak bisa dihapus. Hubungi tim PBS."}, JSONFormat.Compact)),
                                IfError(
                                    // AI Report (Report Automation) dengan Title yang sama ikut dihapus.
                                    RemoveIf('Report Automation - PBS Hub', Title = cur.Title);
                                    Remove('Report - PBS Hub', LookUp('Report - PBS Hub', ID = cur.ID));
                                    RemoveIf(reportFiltered, ID = cur.ID);
                                    // Status jadwal dihitung control: kembali Waiting Report kalau report sisanya belum menutup durasi sesi.
                                    With({s: LookUp(scheduleFiltered, Title = cur.ScheduleID && HostID = varMe.Title)},
                                        If(!IsBlank(s) && !IsBlank(Text(p.scheduleStatus)) && s.Status.Value <> Text(p.scheduleStatus),
                                            With({_upd: Patch('Schedule - PBS Hub', s, {Status: {Value: Text(p.scheduleStatus)}})}, RemoveIf(scheduleFiltered, ID = _upd.ID); Collect(scheduleFiltered, _upd); _upd)));
                                    Set(varRptId, Blank()); Set(varMrdRep, LookUp(reportFiltered, ID = -1));
                                    Set(varMrdSch, LookUp(scheduleFiltered, ID = varMrdSch.ID));
                                    ClearCollect(colMrdSesRep, Filter(reportFiltered, HostID = varMe.Title, ScheduleID = varMrdSch.Title));
                                    Set(varMrdResult, JSON({requestId: rid, status: "ok", message: "Report " & Text(p.title) & " dihapus."}, JSONFormat.Compact));
                                    Back(),
                                    Set(varMrdResult, JSON({requestId: rid, status: "error", message: "Gagal menghapus report: " & FirstError.Message}, JSONFormat.Compact))
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
                        // Jadwal dicari lewat ID SharePoint (scheduleItemId), Title hanya dicocokkan.
                        With({s: LookUp(scheduleFiltered, ID = Value(p.scheduleItemId)),
                              ex: LookUp(absenceFiltered, ScheduleID = Text(p.scheduleId) && HostID = varMe.Title),
                              st: Coalesce(Text(p.scheduleStatus), "Waiting Report")},   // dari control: Waiting Report, atau Finished (Co-Host)
                            If(
                                IsBlank(s) || s.Title <> Text(p.scheduleId) || s.HostID <> varMe.Title,
                                    Set(varMsResult, JSON({requestId: rid, status: "error", message: "Jadwal " & Text(p.scheduleId) & " tidak ditemukan untuk akunmu. Muat ulang dulu."}, JSONFormat.Compact)),
                                // Satu ScheduleID = satu absen. Sudah ada → ditolak, tidak ada baris absen baru.
                                // Absen lama yang gagal di tengah (jadwal masih Planned / Status belum Hadir) dilengkapi sekalian.
                                !IsBlank(ex),
                                    If(s.Status.Value <> "Waiting Report" && s.Status.Value <> "Finished" && s.Status.Value <> "Done",
                                        With({_upd: Patch('Schedule - PBS Hub', s, {Status: {Value: st}})}, RemoveIf(scheduleFiltered, ID = _upd.ID); Collect(scheduleFiltered, _upd); _upd));
                                    If(Coalesce(ex.Status.Value, "") <> "Hadir", With({_upd: Patch('Host Absence - PBS Hub', ex, {Status: {Value: "Hadir"}})}, RemoveIf(absenceFiltered, ID = _upd.ID); Collect(absenceFiltered, _upd); _upd));
                                    If(!(ex.ID in colMsAbs.ID), Collect(colMsAbs, LookUp(absenceFiltered, ID = ex.ID)));
                                    // bulan lalu ikut dimuat (panel "Bulan lalu", report tertunda), plus 7 hari bulan depan (papan minggu)
                                    With({from: DateAdd(If(IsBlank(varMsPeriod), Date(Year(Today()), Month(Today()), 1), DateValue(varMsPeriod & "-01")), -1, TimeUnit.Months)},
                                        ClearCollect(colMsSch, Filter(scheduleFiltered, HostID = varMe.Title, Date >= from, Date < DateAdd(from, 2, TimeUnit.Months) + 7));
                                        ClearCollect(colMsRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate >= from, LiveDate < DateAdd(from, 2, TimeUnit.Months) + 7))
                                    );
                                    Set(varMsResult, JSON({requestId: rid, status: "conflict", message: "Absen sesi ini sudah tercatat (" & ex.Title & "). Status jadwal " & LookUp(scheduleFiltered, ID = s.ID).Status.Value & "."}, JSONFormat.Compact)),
                                // 1. Status jadwal. Gagal → pesan error asli, belum ada yang ditulis.
                                With({sp: IfError(With({_upd: Patch('Schedule - PBS Hub', s, {Status: {Value: st}})}, RemoveIf(scheduleFiltered, ID = _upd.ID); Collect(scheduleFiltered, _upd); _upd),
                                            Set(varMsResult, JSON({requestId: rid, status: "error", message: "Gagal mengubah status jadwal ke " & st & ": " & FirstError.Message}, JSONFormat.Compact)); Blank())},
                                    If(!IsBlank(sp),
                                            // 2. Baris absen baru, Status Hadir.
                                            With({row: IfError(With({_new: Patch('Host Absence - PBS Hub', Defaults('Host Absence - PBS Hub'), {
                                                        ScheduleID: s.Title, HostID: varMe.Title, HostName: Coalesce(LookUp('Host - PBS Hub', Title = varMe.Title).NamaHost, Text(p.hostName)), LiveDate: s.Date,
                                                        BrandID: s.BrandID, Platform: {Value: s.Platform.Value},
                                                        Account: Coalesce(LookUp(colAccounts, Title = s.Account).AccountName, Text(p.accountName), s.Account),
                                                        Status: {Value: "Hadir"}   // Choice Status di Host Absence; kalau kolomnya teks: Status: "Hadir"
                                                    })}, Collect(absenceFiltered, _new); _new),
                                                    Set(varMsResult, JSON({requestId: rid, status: "error", message: "Status jadwal sudah " & st & ", tapi absen gagal dicatat: " & FirstError.Message}, JSONFormat.Compact)); Blank())},
                                                If(!IsBlank(row),
                                                    With({_upd: Patch('Host Absence - PBS Hub', row, {Title: "ABS-" & row.ID})}, RemoveIf(absenceFiltered, ID = _upd.ID); Collect(absenceFiltered, _upd); _upd);
                                                    Collect(colMsAbs, LookUp(absenceFiltered, ID = row.ID));
                                                    // bulan lalu ikut dimuat (panel "Bulan lalu", report tertunda), plus 7 hari bulan depan (papan minggu)
                                                    With({from: DateAdd(If(IsBlank(varMsPeriod), Date(Year(Today()), Month(Today()), 1), DateValue(varMsPeriod & "-01")), -1, TimeUnit.Months)},
                                                        ClearCollect(colMsSch, Filter(scheduleFiltered, HostID = varMe.Title, Date >= from, Date < DateAdd(from, 2, TimeUnit.Months) + 7));
                                                        ClearCollect(colMsRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate >= from, LiveDate < DateAdd(from, 2, TimeUnit.Months) + 7))
                                                    );
                                                    // Pesan membaca ulang SharePoint, jadi yang tampil adalah status yang benar-benar tersimpan.
                                                    Set(varMsResult, JSON({requestId: rid, status: "ok", message: "Absen tercatat (ABS-" & row.ID & "). Status jadwal sekarang " & LookUp(scheduleFiltered, ID = s.ID).Status.Value & "."}, JSONFormat.Compact))
                                                )
                                            )
                                    )
                                )
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
                        // bulan lalu + bulan ini + 7 hari bulan depan: panel Bulan lalu, report tertunda, papan minggu
                        With({from: DateAdd(If(IsBlank(varMsPeriod), Date(Year(Today()), Month(Today()), 1), DateValue(varMsPeriod & "-01")), -1, TimeUnit.Months)},
                            With({to: DateAdd(from, 2, TimeUnit.Months) + 7},
                                ClearCollect(colMsSch, Filter(scheduleFiltered, HostID = varMe.Title, Date >= from, Date < to));
                                ClearCollect(colMsClk, Filter(clockInFiltered, HostID = varMe.Title, ClockInDate >= from, ClockInDate < to));
                                ClearCollect(colMsAbs, Filter(absenceFiltered, HostID = varMe.Title, LiveDate >= from, LiveDate < to));
                                ClearCollect(colMsRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate >= from, LiveDate < to))
                            )
                        );
                        Set(varMsLoading, false),
                    "FILTER_CHANGED", Set(varMsFilter, Text(p.status)),
                    "VIEW_CHANGED", Set(varMsView, Text(p.view)),
                    "CONTACT_PIC", Launch(varPicUrl),   // mis. "mailto:pic@…" atau link chat Teams PIC jadwal
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
                        // Jadwal dicari lewat ID SharePoint (scheduleItemId), Title hanya dicocokkan.
                        With({s: LookUp(scheduleFiltered, ID = Value(p.scheduleItemId)),
                              ex: LookUp(absenceFiltered, ScheduleID = Text(p.scheduleId) && HostID = varMe.Title),
                              st: Coalesce(Text(p.scheduleStatus), "Waiting Report")},   // dari control: Waiting Report, atau Finished (Co-Host)
                            If(
                                IsBlank(s) || s.Title <> Text(p.scheduleId) || s.HostID <> varMe.Title,
                                    Set(varSdResult, JSON({requestId: rid, status: "error", message: "Jadwal " & Text(p.scheduleId) & " tidak ditemukan untuk akunmu. Muat ulang dulu."}, JSONFormat.Compact)),
                                // Satu ScheduleID = satu absen. Sudah ada → ditolak, tidak ada baris absen baru.
                                // Absen lama yang gagal di tengah (jadwal masih Planned / Status belum Hadir) dilengkapi sekalian.
                                !IsBlank(ex),
                                    If(s.Status.Value <> "Waiting Report" && s.Status.Value <> "Finished" && s.Status.Value <> "Done",
                                        With({_upd: Patch('Schedule - PBS Hub', s, {Status: {Value: st}})}, RemoveIf(scheduleFiltered, ID = _upd.ID); Collect(scheduleFiltered, _upd); _upd));
                                    If(Coalesce(ex.Status.Value, "") <> "Hadir", With({_upd: Patch('Host Absence - PBS Hub', ex, {Status: {Value: "Hadir"}})}, RemoveIf(absenceFiltered, ID = _upd.ID); Collect(absenceFiltered, _upd); _upd));
                                    If(!(ex.ID in colSdAbs.ID), Collect(colSdAbs, LookUp(absenceFiltered, ID = ex.ID)));
                                    ClearCollect(colSdSch, Filter(scheduleFiltered, HostID = varMe.Title, Date = varSchDate));
                                    ClearCollect(colSdRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate = varSchDate));
                                    Set(varSdResult, JSON({requestId: rid, status: "conflict", message: "Absen sesi ini sudah tercatat (" & ex.Title & "). Status jadwal " & LookUp(scheduleFiltered, ID = s.ID).Status.Value & "."}, JSONFormat.Compact)),
                                // 1. Status jadwal. Gagal → pesan error asli, belum ada yang ditulis.
                                With({sp: IfError(With({_upd: Patch('Schedule - PBS Hub', s, {Status: {Value: st}})}, RemoveIf(scheduleFiltered, ID = _upd.ID); Collect(scheduleFiltered, _upd); _upd),
                                            Set(varSdResult, JSON({requestId: rid, status: "error", message: "Gagal mengubah status jadwal ke " & st & ": " & FirstError.Message}, JSONFormat.Compact)); Blank())},
                                    If(!IsBlank(sp),
                                            // 2. Baris absen baru, Status Hadir.
                                            With({row: IfError(With({_new: Patch('Host Absence - PBS Hub', Defaults('Host Absence - PBS Hub'), {
                                                        ScheduleID: s.Title, HostID: varMe.Title, HostName: Coalesce(LookUp('Host - PBS Hub', Title = varMe.Title).NamaHost, Text(p.hostName)), LiveDate: s.Date,
                                                        BrandID: s.BrandID, Platform: {Value: s.Platform.Value},
                                                        Account: Coalesce(LookUp(colAccounts, Title = s.Account).AccountName, Text(p.accountName), s.Account),
                                                        Status: {Value: "Hadir"}   // Choice Status di Host Absence; kalau kolomnya teks: Status: "Hadir"
                                                    })}, Collect(absenceFiltered, _new); _new),
                                                    Set(varSdResult, JSON({requestId: rid, status: "error", message: "Status jadwal sudah " & st & ", tapi absen gagal dicatat: " & FirstError.Message}, JSONFormat.Compact)); Blank())},
                                                If(!IsBlank(row),
                                                    With({_upd: Patch('Host Absence - PBS Hub', row, {Title: "ABS-" & row.ID})}, RemoveIf(absenceFiltered, ID = _upd.ID); Collect(absenceFiltered, _upd); _upd);
                                                    Collect(colSdAbs, LookUp(absenceFiltered, ID = row.ID));
                                                    ClearCollect(colSdSch, Filter(scheduleFiltered, HostID = varMe.Title, Date = varSchDate));
                                                    ClearCollect(colSdRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate = varSchDate));
                                                    // Pesan membaca ulang SharePoint, jadi yang tampil adalah status yang benar-benar tersimpan.
                                                    Set(varSdResult, JSON({requestId: rid, status: "ok", message: "Absen tercatat (ABS-" & row.ID & "). Status jadwal sekarang " & LookUp(scheduleFiltered, ID = s.ID).Status.Value & "."}, JSONFormat.Compact))
                                                )
                                            )
                                    )
                                )
                            )
                        ),
                    "SUBMIT_REPORT",
                        With({m: p.metrics, s: LookUp(scheduleFiltered, Title = Text(p.scheduleId) && HostID = varMe.Title)},
                            // Hapus cabang ini kalau config.requireAbsen = false.
                            If(IsBlank(LookUp(absenceFiltered, ScheduleID = Text(p.scheduleId) && HostID = varMe.Title)),
                                Set(varSdResult, JSON({requestId: rid, status: "error", message: "Absen sesi ini belum tercatat."}, JSONFormat.Compact)),
                            // Report hanya dibuka saat jadwal Waiting Report (hapus kalau config.requireWaitingStatus = false).
                            // Setelah durasi terpenuhi statusnya Finished, jadi report tambahan ditolak di sini.
                            s.Status.Value <> "Waiting Report",
                                Set(varSdResult, JSON({requestId: rid, status: "conflict", message: "Status jadwal " & s.Status.Value & ", report tidak bisa dikirim. Muat ulang dulu."}, JSONFormat.Compact)),
                            // Live terputus boleh punya beberapa report, tapi satu Live ID hanya sekali.
                            !IsBlank(LookUp(reportFiltered, ScheduleID = s.Title && HostID = varMe.Title && LiveID = Text(p.liveId))),
                                Set(varSdResult, JSON({requestId: rid, status: "conflict", message: "Live ID " & Text(p.liveId) & " sudah dilaporkan untuk sesi ini."}, JSONFormat.Compact)),
                                IfError(
                                    With({row: With({_new: Patch('Report - PBS Hub', Defaults('Report - PBS Hub'), {
                                            ScheduleID: s.Title, HostID: varMe.Title, BrandID: s.BrandID, Platform: {Value: s.Platform.Value},
                                            AccountID: s.Account, HostName: Coalesce(LookUp('Host - PBS Hub', Title = varMe.Title).NamaHost, Text(p.hostName)),   // nama host dari list Host
                                            Account: With({nm: Trim(Coalesce(LookUp(colAccounts, Title = s.Account).AccountName, Text(p.accountName), s.Account)), cd: Trim(s.Account)},
                            Coalesce(LookUp(Choices([@'Report - PBS Hub'].Account), Lower(Trim(Value)) = Lower(nm) || Lower(Trim(Value)) = Lower(cd) || (Len(nm) > 0 && Lower(nm) in Lower(Value)) || (Len(cd) > 0 && Lower(cd) in Lower(Value))), {Value: nm})),   // Choice: cocokkan nama akun, cadangan teks nama
                                            LiveDate: s.Date, AbsID: Text(p.absId),
                                            Penjualan: Value(m.Penjualan), Pesanan: Value(m.Pesanan), ProdukTerjual: Value(m.ProdukTerjual),
                                            JumlahPembeli: Value(m.JumlahPembeli), CTR: Value(m.CTR), CTOR: Value(m.CTOR), PeakViewer: Value(m.PeakViewer),
                                            'Durasi(Min)': Value(m.'Durasi(Min)'), AddToCart: Value(m.AddToCart), TotalViewer: Value(m.TotalViewer),
                                            Comment: Value(m.Comment),
                                            LiveID: Text(p.liveId), Playbook: {Value: Text(p.playbook)},
                                            ApprovalStatus: {Value: "Waiting Approval"}
                                        })}, Collect(reportFiltered, _new); _new)},
                                        With({title: "REP-" & row.ID},
                                            With({_upd: Patch('Report - PBS Hub', row, {Title: title})}, RemoveIf(reportFiltered, ID = _upd.ID); Collect(reportFiltered, _upd); _upd);
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
                                                    With({_upd: Patch('Report - PBS Hub', row, {Attachment: Text(up.webUrl)})}, RemoveIf(reportFiltered, ID = _upd.ID); Collect(reportFiltered, _upd); _upd)
                                                )
                                            );
                                            // Total Durasi(Min) semua report sesi ini ≥ durasi jadwal → "Finished", kalau belum tetap "Waiting Report".
                                            With({_upd: Patch('Schedule - PBS Hub', s, {Status: {Value: Text(p.scheduleStatus)}})}, RemoveIf(scheduleFiltered, ID = _upd.ID); Collect(scheduleFiltered, _upd); _upd);
                                            // ---- Tier harian di Clock In: host ini, tanggal s.Date. Aturan sama dengan hitung ulang bulanan.
                                            IfError(
                                                With({tDate: s.Date},
                                                With({clk: LookUp(clockInFiltered, HostID = varMe.Title && ClockInDate = tDate),
                                                      schDay: Filter(scheduleFiltered, HostID = varMe.Title && Date = tDate),
                                                      repDay: Filter(reportFiltered, HostID = varMe.Title && LiveDate = tDate),
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
                                                      // Akun terbaik hari itu: TotalViewer dijumlah, Avg View Duration (kolom PeakViewer) dan CTR diambil maksimum.
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
                                                    With({_upd: Patch('Clock In - PBS Hub', clk, {
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
                                                                Coalesce(best.CTR, 0) & " (min " & t3.CTR & "), Avg View Duration: " & Coalesce(best.PeakViewer, 0) & " (min " & t3.AvgViewDur &
                                                                "), Durasi: " & jam & " jam (min " & t3.Duration & " jam)",
                                                            tier & " karena " & Concat(Filter([
                                                                If(w1, "Jam Live 00:00-06:00 (" & t1Win & " menit, min " & varT1MinInWindow & ")", ""),
                                                                If(w2, "Jam Live 21:00-24:00 (" & t2Win & " menit, min " & varT2MinInWindow & ")", ""),
                                                                If(m1, "Metric Tier 1 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Avg View Duration " & best.PeakViewer & ")", ""),
                                                                If(m2 && !m1, "Metric Tier 2 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Avg View Duration " & best.PeakViewer & ")", ""),
                                                                If(m3 && !m2, "Metric Tier 3 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Avg View Duration " & best.PeakViewer & ")", ""),
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
                                                    })}, RemoveIf(clockInFiltered, ID = _upd.ID); Collect(clockInFiltered, _upd); _upd);
                                                    true   // IfError butuh tipe yang sama dengan Notify (Boolean), bukan record hasil Patch
                                                )))))))))),
                                                // Report tetap tersimpan kalau hitung Tier gagal; hitung ulang bulanan akan membetulkannya.
                                                Notify("Report tersimpan, tapi Tier belum terhitung: " & FirstError.Message, NotificationType.Warning)
                                            );
                                            ClearCollect(colSdSch, Filter(scheduleFiltered, HostID = varMe.Title, Date = varSchDate));
                                            ClearCollect(colSdRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate = varSchDate));
                                            Set(varSdResult, JSON({requestId: rid, status: "ok", message: If(Boolean(p.complete), "Report " & title & " terkirim. Durasi sesi terpenuhi.", "Report " & title & " terkirim. Kurang " & Text(p.remainingMin) & " menit, kirim report berikutnya.")}, JSONFormat.Compact))
                                        )
                                    ),
                                    Set(varSdResult, JSON({requestId: rid, status: "error", message: "Gagal mengirim report: " & FirstError.Message}, JSONFormat.Compact))
                                )
                            )
                        ),
                    "LIVE_BREAK",
                        With({s: LookUp(scheduleFiltered, Title = Text(p.scheduleId) && HostID = varMe.Title),
                              ex: LookUp(absenceFiltered, ScheduleID = Text(p.scheduleId) && HostID = varMe.Title)},
                            If(IsBlank(s),
                                Set(varSdResult, JSON({requestId: rid, status: "error", message: "Jadwal " & Text(p.scheduleId) & " tidak ditemukan untuk akunmu. Muat ulang dulu."}, JSONFormat.Compact)),
                            // Sama dengan report: harus sudah absen dan jadwal Waiting Report.
                            IsBlank(ex),
                                Set(varSdResult, JSON({requestId: rid, status: "error", message: "Absen sesi ini belum tercatat."}, JSONFormat.Compact)),
                            s.Status.Value <> "Waiting Report",
                                Set(varSdResult, JSON({requestId: rid, status: "conflict", message: "Status jadwal " & s.Status.Value & ", Live Break tidak bisa ditandai. Muat ulang dulu."}, JSONFormat.Compact)),
                            // Sudah ada report untuk sesi ini (live terputus sebagian): bukan Live Break lagi.
                            !IsBlank(LookUp(reportFiltered, ScheduleID = s.Title && HostID = varMe.Title)),
                                Set(varSdResult, JSON({requestId: rid, status: "conflict", message: "Sesi ini sudah punya report, jadi tidak bisa ditandai Live Break."}, JSONFormat.Compact)),
                                IfError(
                                    With({rep: With({_new: Patch('Report - PBS Hub', Defaults('Report - PBS Hub'), {
                                            ScheduleID: s.Title, HostID: varMe.Title, BrandID: s.BrandID, Platform: {Value: s.Platform.Value},
                                            AccountID: s.Account, HostName: Coalesce(LookUp('Host - PBS Hub', Title = varMe.Title).NamaHost, Text(p.hostName)),   // nama host dari list Host
                                            Account: With({nm: Trim(Coalesce(LookUp(colAccounts, Title = s.Account).AccountName, Text(p.accountName), s.Account)), cd: Trim(s.Account)},
                            Coalesce(LookUp(Choices([@'Report - PBS Hub'].Account), Lower(Trim(Value)) = Lower(nm) || Lower(Trim(Value)) = Lower(cd) || (Len(nm) > 0 && Lower(nm) in Lower(Value)) || (Len(cd) > 0 && Lower(cd) in Lower(Value))), {Value: nm})),   // Choice: cocokkan nama akun, cadangan teks nama
                                            LiveDate: s.Date, AbsID: ex.Title,
                                            Penjualan: 0, Pesanan: 0, ProdukTerjual: 0, JumlahPembeli: 0, CTR: 0, CTOR: 0, PeakViewer: 0,
                                            'Durasi(Min)': 0, AddToCart: 0, TotalViewer: 0, Comment: 0,
                                            ApprovalStatus: {Value: "LiveBreak"}
                                        })}, Collect(reportFiltered, _new); _new)},
                                        With({_upd: Patch('Report - PBS Hub', rep, {Title: "REP-" & rep.ID})}, RemoveIf(reportFiltered, ID = _upd.ID); Collect(reportFiltered, _upd); _upd);
                                        // LiveBreak = Yes (Choice Yes/No) dan Status jadwal Finished.
                                        With({_upd: Patch('Schedule - PBS Hub', s, {LiveBreak: {Value: "Yes"}, Status: {Value: Text(p.scheduleStatus)}})}, RemoveIf(scheduleFiltered, ID = _upd.ID); Collect(scheduleFiltered, _upd); _upd);
                                        // ---- Tier harian di Clock In: host ini, tanggal s.Date. Aturan sama dengan hitung ulang bulanan.
                                        IfError(
                                            With({tDate: s.Date},
                                            With({clk: LookUp(clockInFiltered, HostID = varMe.Title && ClockInDate = tDate),
                                                  schDay: Filter(scheduleFiltered, HostID = varMe.Title && Date = tDate),
                                                  repDay: Filter(reportFiltered, HostID = varMe.Title && LiveDate = tDate),
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
                                                  // Akun terbaik hari itu: TotalViewer dijumlah, Avg View Duration (kolom PeakViewer) dan CTR diambil maksimum.
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
                                                With({_upd: Patch('Clock In - PBS Hub', clk, {
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
                                                            Coalesce(best.CTR, 0) & " (min " & t3.CTR & "), Avg View Duration: " & Coalesce(best.PeakViewer, 0) & " (min " & t3.AvgViewDur &
                                                            "), Durasi: " & jam & " jam (min " & t3.Duration & " jam)",
                                                        tier & " karena " & Concat(Filter([
                                                            If(w1, "Jam Live 00:00-06:00 (" & t1Win & " menit, min " & varT1MinInWindow & ")", ""),
                                                            If(w2, "Jam Live 21:00-24:00 (" & t2Win & " menit, min " & varT2MinInWindow & ")", ""),
                                                            If(m1, "Metric Tier 1 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Avg View Duration " & best.PeakViewer & ")", ""),
                                                            If(m2 && !m1, "Metric Tier 2 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Avg View Duration " & best.PeakViewer & ")", ""),
                                                            If(m3 && !m2, "Metric Tier 3 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Avg View Duration " & best.PeakViewer & ")", ""),
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
                                                })}, RemoveIf(clockInFiltered, ID = _upd.ID); Collect(clockInFiltered, _upd); _upd);
                                                true   // IfError butuh tipe yang sama dengan Notify (Boolean), bukan record hasil Patch
                                            )))))))))),
                                            // Report tetap tersimpan kalau hitung Tier gagal; hitung ulang bulanan akan membetulkannya.
                                            Notify("Report tersimpan, tapi Tier belum terhitung: " & FirstError.Message, NotificationType.Warning)
                                        );
                                        ClearCollect(colSdSch, Filter(scheduleFiltered, HostID = varMe.Title, Date = varSchDate));
                                        ClearCollect(colSdRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate = varSchDate));
                                        Set(varSdResult, JSON({requestId: rid, status: "ok", message: "Sesi " & s.Title & " ditandai Live Break. Report 0 dibuat (REP-" & rep.ID & ")."}, JSONFormat.Compact))
                                    ),
                                    Set(varSdResult, JSON({requestId: rid, status: "error", message: "Gagal menandai Live Break: " & FirstError.Message}, JSONFormat.Compact))
                                )
                            )
                        ),
                    "RESUBMIT_REPORT",
                        With({cur: LookUp(reportFiltered, ID = Value(p.reportId) && HostID = varMe.Title), m: p.metrics},
                            // Modified dari JSON berformat UTC ("…Z"); DateTimeValue mengubahnya ke jam lokal sebelum dibandingkan.
                            If(IsBlank(cur) || cur.ApprovalStatus.Value <> "Need Revision" ||
                               Abs(DateDiff(cur.Modified, DateTimeValue(Text(p.expectedModified)), TimeUnit.Seconds)) > 1,
                                Set(varSdResult, JSON({requestId: rid, status: "conflict", message: "Report ini sudah berubah. Muat ulang dulu."}, JSONFormat.Compact)),
                                IfError(
                                    With({_upd: Patch('Report - PBS Hub', cur, {
                                        Penjualan: Value(m.Penjualan), Pesanan: Value(m.Pesanan), ProdukTerjual: Value(m.ProdukTerjual),
                                        JumlahPembeli: Value(m.JumlahPembeli), CTR: Value(m.CTR), CTOR: Value(m.CTOR), PeakViewer: Value(m.PeakViewer),
                                        'Durasi(Min)': Value(m.'Durasi(Min)'), AddToCart: Value(m.AddToCart), TotalViewer: Value(m.TotalViewer),
                                        Comment: Value(m.Comment),
                                        LiveID: Text(p.liveId), Playbook: {Value: Text(p.playbook)},
                                        ApprovalStatus: {Value: Text(p.approvalStatus)},   // "Waiting Approval Revision"
                                        ApprovalComment: cur.ApprovalComment & Char(10) & "[Revisi host] " &
                                            If(IsBlank(Text(p.note)), "angka diperbaiki: " & Concat(Table(p.changed), Text(ThisRecord.Value), ", "), Text(p.note))
                                    })}, RemoveIf(reportFiltered, ID = _upd.ID); Collect(reportFiltered, _upd); _upd);
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
                                            With({_upd: Patch('Report - PBS Hub', LookUp(reportFiltered, ID = cur.ID), {Attachment: Text(up.webUrl)})}, RemoveIf(reportFiltered, ID = _upd.ID); Collect(reportFiltered, _upd); _upd))
                                    );
                                    // Durasi bisa ikut direvisi: status jadwal dihitung ulang oleh control (Waiting Report / Finished).
                                    If(!IsBlank(Text(p.scheduleStatus)),
                                        With({_upd: Patch('Schedule - PBS Hub', LookUp(scheduleFiltered, Title = cur.ScheduleID && HostID = varMe.Title), {Status: {Value: Text(p.scheduleStatus)}})}, RemoveIf(scheduleFiltered, ID = _upd.ID); Collect(scheduleFiltered, _upd); _upd));
                                    // Angka berubah → Tier hari itu dihitung ulang.
                                    // ---- Tier harian di Clock In: host ini, tanggal cur.LiveDate. Aturan sama dengan hitung ulang bulanan.
                                    IfError(
                                        With({tDate: cur.LiveDate},
                                        With({clk: LookUp(clockInFiltered, HostID = varMe.Title && ClockInDate = tDate),
                                              schDay: Filter(scheduleFiltered, HostID = varMe.Title && Date = tDate),
                                              repDay: Filter(reportFiltered, HostID = varMe.Title && LiveDate = tDate),
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
                                              // Akun terbaik hari itu: TotalViewer dijumlah, Avg View Duration (kolom PeakViewer) dan CTR diambil maksimum.
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
                                            With({_upd: Patch('Clock In - PBS Hub', clk, {
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
                                                        Coalesce(best.CTR, 0) & " (min " & t3.CTR & "), Avg View Duration: " & Coalesce(best.PeakViewer, 0) & " (min " & t3.AvgViewDur &
                                                        "), Durasi: " & jam & " jam (min " & t3.Duration & " jam)",
                                                    tier & " karena " & Concat(Filter([
                                                        If(w1, "Jam Live 00:00-06:00 (" & t1Win & " menit, min " & varT1MinInWindow & ")", ""),
                                                        If(w2, "Jam Live 21:00-24:00 (" & t2Win & " menit, min " & varT2MinInWindow & ")", ""),
                                                        If(m1, "Metric Tier 1 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Avg View Duration " & best.PeakViewer & ")", ""),
                                                        If(m2 && !m1, "Metric Tier 2 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Avg View Duration " & best.PeakViewer & ")", ""),
                                                        If(m3 && !m2, "Metric Tier 3 (Views " & best.TotalViewer & ", CTR " & best.CTR & ", Avg View Duration " & best.PeakViewer & ")", ""),
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
                                            })}, RemoveIf(clockInFiltered, ID = _upd.ID); Collect(clockInFiltered, _upd); _upd);
                                            true   // IfError butuh tipe yang sama dengan Notify (Boolean), bukan record hasil Patch
                                        )))))))))),
                                        // Report tetap tersimpan kalau hitung Tier gagal; hitung ulang bulanan akan membetulkannya.
                                        Notify("Report tersimpan, tapi Tier belum terhitung: " & FirstError.Message, NotificationType.Warning)
                                    );
                                    ClearCollect(colSdSch, Filter(scheduleFiltered, HostID = varMe.Title, Date = varSchDate));
                                    ClearCollect(colSdRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate = varSchDate));
                                    Set(varSdResult, JSON({requestId: rid, status: "ok", message: "Revisi terkirim, menunggu review ulang."}, JSONFormat.Compact)),
                                    Set(varSdResult, JSON({requestId: rid, status: "error", message: "Gagal mengirim revisi: " & FirstError.Message}, JSONFormat.Compact))
                                )
                            )
                        ),
                    "DISPUTE_REVIEW",
                        With({cur: LookUp(reportFiltered, ID = Value(p.reportId) && HostID = varMe.Title)},
                            If(IsBlank(cur) || cur.ApprovalStatus.Value <> "Need Revision",
                                Set(varSdResult, JSON({requestId: rid, status: "conflict", message: "Report ini sudah tidak menunggu revisi. Muat ulang dulu."}, JSONFormat.Compact)),
                                IfError(
                                    // Status tetap Need Revision; reviewer membaca sanggahan di ApprovalComment.
                                    With({_upd: Patch('Report - PBS Hub', cur, {ApprovalComment: cur.ApprovalComment & Char(10) & "[Sanggahan host] " & Text(p.reason)})}, RemoveIf(reportFiltered, ID = _upd.ID); Collect(reportFiltered, _upd); _upd);
                                    ClearCollect(colSdSch, Filter(scheduleFiltered, HostID = varMe.Title, Date = varSchDate));
                                    ClearCollect(colSdRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate = varSchDate));
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

### 10.6 CreditScore — `OnChange`

Tidak ada Patch. Ganti bulan dan filter dikerjakan control di baris yang sudah dimuat; canvas hanya menyimpan
pilihannya (`Period`, `DefaultFilter`) supaya tetap sama saat layar dibuka lagi. `LOAD_MORE` memuat 200 transaksi lebih lama.

```powerfx
If(!IsBlank(Self.ActionPayload),
    With({req: ParseJSON(Self.ActionPayload)},
        With({act: Text(req.action), rid: Text(req.requestId), p: req.payload},
            If(!(rid in colPbsProcessed.Id),
                Collect(colPbsProcessed, {Id: rid});
                Switch(act,
                    "PERIOD_CHANGED", Set(varCsPeriod, Text(p.period)),
                    "FILTER_CHANGED", Set(varCsFilter, Text(p.filter)),
                    "LOAD_MORE",
                        Set(varCsTop, varCsTop + 200);
                        Set(varCsLoading, true);
                        ClearCollect(colCsTx, FirstN(Sort(Filter('[FAS STUDIO] HostScoreTransactions', HostID = varMe.Title), CreatedDate, SortOrder.Descending), varCsTop));
                        Set(varCsLoading, false),
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
- `LOAD_MORE` tidak ditangani di layar lain karena `HasMore = false` (data per host per bulan kecil); hanya Skor saya memakainya.

## 11. CreditScore (layar *Skor saya*)

Control `pbs_HostApp.CreditScore` (H-7). Isi layar: skor dan level sekarang (`CurrentScore`, kalau kosong
`InitialScore`, kalau kosong `scoreInitial` di Context), *X poin lagi ke level …*, peringatan kalau skor tinggal
kurang dari 10 poin dari batas bawah level, tren skor dari `ScoreAfter` transaksi, kartu Reward / Penalty /
Perubahan / Dibatalkan untuk bulan yang dipilih, daftar level (`HostScoreThreshold`), *Cara skor berubah* (dari
`RulesJson`, atau rule yang ada di transaksi host), dan tabel transaksi dengan filter Semua / Reward / Penalty / Dibatalkan.
Hanya transaksi `Status = Active` (atau kosong) yang dihitung, sama dengan Ops HostDetail. Baris `Status = Reversal`
(ditulis Ops *Skor host* saat membatalkan transaksi) tampil dengan badge *Koreksi* dan tidak dihitung, sama seperti
baris aslinya yang jadi *Dibatalkan*. Selisih skor tersimpan vs ledger **tidak** ditampilkan ke host (hanya Ops yang
bisa memperbaikinya).

| Properti | Isi |
|---|---|
| `Context` | `varHostCtx` (config `scoreInitial`, `scoreMin`, `scoreMax` dari `[FAS STUDIO] ScoreConfig`) |
| `HostJson` | baris host yang login: `Title, HostCode, NamaHost, Package, CurrentScore, InitialScore` |
| `ScoreTxJson` | `[FAS STUDIO] HostScoreTransactions` host ini, terbaru dulu: `ID, TransactionID, RuleID, TransactionType, Point, ScoreBefore, ScoreAfter, Reason, Notes, Status, CreatedDate, CreatedBy` |
| `ThresholdsJson` | `[FAS STUDIO] HostScoreThreshold`: `ThresholdID, Label, Description, MinimumScore, MaximumScore, Tone, Active, SortOrder` |
| `RulesJson` | opsional: `RuleID, RuleName, RuleType, Point, Description, Active` |
| `Period` | `yyyy-mm`, `All`, atau kosong (bulan ini) |
| `DefaultFilter` | `All`, `Reward`, `Penalty`, `Void` |
| `HasMore` / `IsLoading` | tombol *Muat lebih banyak* / skeleton |

| Aksi | Payload | Canvas |
|---|---|---|
| `PERIOD_CHANGED` | `{period: "yyyy-mm" \| "All"}` | `Set(varCsPeriod, …)` |
| `FILTER_CHANGED` | `{filter, period}` | `Set(varCsFilter, …)` |
| `LOAD_MORE` | `{loaded}` | `varCsTop + 200`, muat ulang `colCsTx` |

HostDashboard mengirim `NAV {target: "SCORE"}` dari *Lihat rincian* di kartu skor → `Navigate(scrCreditScore)`.
Langkah setup lengkap: HOST-SETUP.md Langkah 11.
