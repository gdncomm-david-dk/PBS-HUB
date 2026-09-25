# Integrasi canvas — PBS Hub Ops PCF

Tujuh code component di solusi `PBSHubOpsPCF` (managed):

| Control | Layar desain | Fungsi |
|---|---|---|
| `pbs_Ops.Dashboard` | Ops Console 3a/3b (D-1) | Antrean yang menunggu tim hari ini. Read-only, hanya emit `NAV`. |
| `pbs_Ops.ReportReview` | Ops Console 4a (R-1) | Daftar report + antrean rekonsiliasi, urut umur, kolom **Alasan**, bulk approve terbatas. |
| `pbs_Ops.ReportDetail` | Ops Console 4b/4c/4d (R-2) | Detail report: klaim host vs bukti AI vs selisih, Setujui / Perlu revisi / Eskalasi. |
| `pbs_Ops.PayrollRuns` | Payroll P-1 + P-2 | Daftar run payroll (status, total, 4 titik approval, slip) + modal **Jalankan payroll** dengan preflight. |
| `pbs_Ops.PayrollRunDetail` | Payroll P-3 + P-4 + P-5 | Baris per host (expand ke Clock In), tracker 4 gate approval, status slip gaji. |
| `pbs_Ops.HostList` | Host HD-1 | Direktori host: package, status, skor + band, peringatan tanpa data bank. |
| `pbs_Ops.HostDetail` | Host HD-2 | Satu host: Ringkasan (skor + ledger), Jadwal, Report, Payroll, Data pribadi (tersamar, dibuka dengan log). |

Semua control hanya merender **isi modul** (judul, filter, tabel, kartu). Header dan sidebar tetap dari
app (`BlibliUniversalSidebar`).

## 1. Aturan kontrak (berlaku untuk semua control)

- **Control tidak pernah menulis ke SharePoint.** Tombol mengirim `ActionPayload` (JSON teks):
  `{"action":"APPROVE","requestId":"rd-…","payload":{…}}`. Canvas menulis di `OnChange`, lalu membalas
  lewat properti `ActionResult`: `{"requestId":"…","status":"ok"|"error"|"conflict","message":"…"}`.
- Control mengunci tombol sampai `requestId` yang sama kembali. Tanpa balasan, tombol tetap terkunci —
  **setiap cabang `OnChange` wajib men-set `ActionResult`**, termasuk saat error (`IfError`).
- Aksi navigasi/informasi (`NAV`, `OPEN_REPORT`, `BACK`, `RELOAD`, `OPEN_EVIDENCE`, `LOAD_MORE`,
  `FILTER_CHANGED`) tidak mengunci dan tidak perlu dibalas.
- **List tidak dipotong per halaman.** Semua baris yang dikirim canvas langsung tampil, dengan *Total N …* di
  bawah tabel (config `pageSize` sudah tidak dipakai). Tombol *Muat lebih banyak* hanya muncul kalau `HasMore`
  = true, yaitu canvas belum memuat semua baris dari SharePoint (mis. `varRrTop`).
- Data masuk sebagai **JSON teks** di properti `…Json`. Bentuk baris lewat `ForAll(…, {…})` supaya nama
  field pasti, kolom Choice jadi teks, dan kolom `Attachments` tidak ikut (`JSON()` gagal pada kolom itu).
- **Jangan kirim `KTP`, `NoRekening`, `Alamat`, GPS, atau selfie** ke control mana pun. Dashboard hanya butuh
  `HasRekening` (boolean) yang dihitung di canvas.

## 2. Context (semua control)

Taruh di `App.OnStart` setelah `userRole` di-resolve (lihat `App.pa.yaml:483` di v1):

```powerfx
Set(
    varPbsCtx,
    JSON(
        {
            userEmail: User().Email,
            userName: User().FullName,
            roles: userRole.Value,          // "PBS_Team" | "FAS_Team" | "HOST" (Role - PBS Hub)
            permissions: "",                // kosong = izin diturunkan dari role (lihat tabel)
            config: {
                tolerancePct: 5,            // PBS0005A: ±5 %
                confidenceThreshold: 0.85,
                maxShiftHours: 12,          // sama dengan varMaxShiftHours
                missingReportDays: 2,
                payrollLabelOffset: -1,     // Payroll.Periode = bulan run, data = bulan sebelumnya (P8)
                payrollAssemblyMinutes: 30, // run baru < 30 menit dengan gate 1 terbuka = "Sedang disusun"
                payrollAnyPeriod: false,    // true hanya kalau flow sudah menerima periode sebagai input
                scoreInitial: First('[FAS STUDIO] ScoreConfig').InitialScore,   // dipakai kalau kolom Host kosong
                scoreMin: First('[FAS STUDIO] ScoreConfig').MinimumScore,
                scoreMax: First('[FAS STUDIO] ScoreConfig').MaximumScore,
                piiRevealSeconds: 30,       // data pribadi yang dibuka hilang otomatis
                tierRates: {tier1: 75000, tier2: 65000, tier3: 55000},   // insentif per tier (default sama); tanpa tier = 0
                weeklyBonus: 75000          // CONTOH — nominal Streak / weekly
            }
        },
        JSONFormat.Compact
    )
);
```

Izin kalau `permissions` kosong (model legacy `Role - PBS Hub`, satu-satunya yang benar-benar menggating di v1):

| Kode | PBS_Team | FAS_Team | HOST |
|---|---|---|---|
| `SCHEDULE_CREATE` (tombol Upload massal / Buat jadwal) | ✓ | ✓ | – |
| `REPORT_ADJUDICATE` (Setujui, Perlu revisi, bulk approve) | ✓ | ✓ | – |
| `RECONCILIATION_CONFIG` (tombol Konfigurasi toleransi) | ✓ | ✓ | – |
| `PAYROLL_VIEW` (tombol Buka payroll) | ✓ | – | – |
| `PAYROLL_RUN` (Jalankan payroll, Kirim ulang slip) | ✓ | – | – |
| `HOST_EDIT` (Tambah host, Edit, Nonaktifkan) | ✓ | ✓ | – |
| `HOST_PII_VIEW` (tab Data pribadi: KTP, rekening, alamat, telepon) | ✓ | – | – |
| `HOST_CLOCKIN` (Clock in manual; edit jam, status, tier dan weekly di tab Kehadiran) | ✓ | ✓ | – |

Kalau nanti pindah ke `[FAS STUDIO] RolePermissions`, isi `permissions: Concat(colUserPermissions, Value, ",")`
dan control hanya memakai daftar itu.

## 3. Data mapping (sumber: DESIGN.md → Database Schema)

Field di kiri adalah nama yang dibaca control; kanan adalah kolom list v1. Control juga menerima nama
internal SharePoint (`Durasi_x0028_Min_x0029_`) dan Choice berbentuk `{"Value":…}`, tapi shaping eksplisit
di bawah yang disarankan.

### `Report - PBS Hub` (klaim host) → `ReportsJson` / `ReportJson`

| Field JSON | Kolom | Dipakai untuk |
|---|---|---|
| `ID`, `Title` | ID, Title | kunci + join ke bukti |
| `ScheduleID`, `HostID`, `BrandID`, `AccountID` | idem | nama, filter, cek bukti yatim |
| `Platform`, `Account` | Platform (Choice), Account | kolom Platform, Akun, pilihan prompt |
| `LiveDate` | LiveDate | tanggal live (kirim `Text(LiveDate,"yyyy-mm-dd")`) |
| `Penjualan`, `Pesanan`, `ProdukTerjual`, `JumlahPembeli`, `CTR`, `CTOR`, `PeakViewer` | idem | 7 metrik inti PBS0005A (selalu dibandingkan) |
| `DurasiMin`, `AddToCart`, `TotalViewer`, `Comment`, `Share` | `Durasi(Min)`, … | ikut dibandingkan di tabel yang sama bila klaim atau bukti berisi nilai |
| `ApprovalStatus`, `Match` | Choice | tab & kolom *Status* (nilai `ApprovalStatus` apa adanya; `Waiting Approval`, `Waiting Approval Revision` = menunggu; kosong = *Belum ada status*, tidak masuk antrean, `Need Revision` = perlu revisi, `Done` = selesai; komentar `Automated…` = otomatis) |
| `ApprovalComment`, `Approver`, `ApproverEmail` | idem | ringkasan keputusan, banner "sudah diputuskan oleh…" |
| `Playbook` | Playbook (Choice) | kolom & detail *Playbook*. Kirim `Playbook: Playbook.Value` (Choice multi-pilih: `Concat(Playbook, Value, ", ")`) |
| `Attachment` | Attachment (Note, URL) | fallback URL screenshot |
| `Created`, `Modified` | sistem | umur antrean, "diputuskan X menit lalu" |

**Pilihan kolom (Choice) yang dibaca control:**

| List · kolom | Nilai | Arti di control |
|---|---|---|
| `Report.ApprovalStatus` | `Waiting Approval` | menunggu review (tab *Menunggu review*) |
| | `Waiting Approval Revision` | host sudah memperbaiki report yang diminta revisi — menunggu review lagi, badge *Menunggu review (revisi)* |
| | `Need Revision` | dikembalikan ke host (tab *Perlu revisi*) |
| | `Done` | selesai (manual, atau *Otomatis* kalau `ApprovalComment` berisi "Automated …") |
| | `LiveBreak` | live terputus — badge *Live break*, tidak menunggu siapa pun |
| | *(kosong)* | *Belum ada status* — **tidak** masuk tab *Menunggu review* (hanya di *Semua*) dan tidak bisa diputuskan sampai `ApprovalStatus` diisi |
| `Report.Match` | `Match` / `Unmatch` | hasil keputusan reviewer |
| `Report Automation.Status` | `Match` / `Unmatch` | hasil pembacaan AI |

`Report Automation.Title` = `Report.Title` (mis. `REP-120` ↔ `REP-120`); itu kunci join bukti ke report.
Minta revisi menulis ke Report: `Match = Unmatch`, `ApprovalComment` = komentar reviewer, `ApproverEmail` =
reviewer, `ApprovalStatus = Need Revision`. Host yang memperbaiki menulis `ApprovalStatus = Waiting Approval
Revision` dan `Report Automation.Status = Unmatch` (hanya kolom itu) — lihat `HOST-CANVAS-INTEGRATION.md` §5.

> **Jam live tampil "—"?** Jam diambil dari `Schedule - PBS Hub` kolom `StartTime` dan `EndTime`, dicocokkan
> lewat `Report.ScheduleID` = `Schedule.Title` (atau kolom `Schedule.ScheduleID`, atau angka ID-nya). Cek: (1)
> properti `SchedulesJson` sudah diisi di ReportReview / ReportDetail — properti ini baru sejak 1.4.0, jadi
> kosong setelah upgrade; (2) `colRrSchedule` memuat jadwal report yang lama (perlebar `DateAdd(Today(), -90)`
> kalau perlu); (3) `StartTime`/`EndTime` boleh teks (`10:00`, `10.00`, `1000`) atau kolom Date and Time — dua-duanya
> dibaca, Date and Time ditampilkan dalam jam lokal.

> **Report `Waiting Approval Revision` tidak muncul di antrean?** Kontrol memasukkannya ke tab *Menunggu review*
> (juga ejaan `Waiting Revision Approval`). Report dengan `ApprovalStatus` kosong memang tidak masuk antrean. Kalau tetap tidak muncul, baris itu tidak sampai ke kontrol: cek
> `Filter(...)` di OnVisible/OnStart canvas yang hanya memuat `ApprovalStatus.Value = "Waiting Approval"`
> (contoh lama untuk Dashboard), dan pastikan `ReportsJson` mengirim `ApprovalStatus: ApprovalStatus.Value`.

### `Report Automation - PBS Hub` (bukti AI) → `EvidenceJson`

| Field JSON | Kolom | Catatan |
|---|---|---|
| `ID`, `Title` | ID, Title | join: `Title = Report.Title`, fallback angka di ujung `Title` = `Report.ID` (trik `int(last(split(Title,'-')))` PBS0005A) |
| `HostID`, `ScheduleID`, `AccountID`, `BrandID` | idem | kalau berbeda dari report → **Bukti yatim** (M6) |
| 7 + 5 metrik | idem | nilai "Bukti AI" |
| `Status` | Match/Unmatch | verdict flow, hitungan "Rekonsiliasi otomatis" |
| `Attachment` | Attachment | screenshot di rail kanan |
| `Confidence` | *tidak ada di v1* | opsional. Kalau kolom ini ditambahkan, alasan **Confidence rendah** dan bulk approve aktif |
| `Created` | sistem | "Dibaca", "Pembacaan bukti AI hari ini" |

### Dashboard: list lain

| Properti | List | Field |
|---|---|---|
| `SchedulesJson` | `Schedule - PBS Hub` | `ID, Title, Date (yyyy-mm-dd), StartTime, EndTime, JamLive, BrandID, HostID, StudioID, Platform, AccountID, AccountName, LiveBreak, Position, Status` — `LiveBreak = Yes` atau `Position = Co-Host` = tidak ada report yang ditunggu |
| `ClockInJson` | `Clock In - PBS Hub` | `HostID, ClockInDate, CheckInTime, CheckOutTime, ClockOutTime, IsInsideGeofence, Streak` |
| `HostsJson` | `Host - PBS Hub` | `Title, NamaHost, Status, HasRekening` (**bukan** NoRekening) |
| `StudiosJson` | `Studio - PBS Hub` | `Title, NamaStudio, KapasitasHost, Status` |
| `BrandsJson` | `Brand - PBS Hub` | `Title, NamaBrand` |
| `PayrollJson` | `Payroll - PBS Hub` | `ID, Title, Periode, Status, Created` |

`Schedule.Status` yang dikenali: `Planned` (atau kosong) = terjadwal, **`Finished`** = sesi selesai (status akhir; nilai lama `Done` dibaca sama), `Waiting Report`, `Cancelled` / `Leave` = tidak dihitung.

Kartu dashboard dan sumbernya:

| Kartu | Rumus |
|---|---|
| Report menunggu review | Report dengan `ApprovalStatus` kosong / `Waiting…`; rincian per Alasan; "lewat 3 hari" dari `Created` |
| Pengecualian GPS | Clock In bulan ini dengan `IsInsideGeofence = false` (v1 tidak memverifikasi ulang — UC-1) |
| Shift belum clock out | `CheckInTime` terisi, `CheckOutTime`/`ClockOutTime` kosong, lebih dari `maxShiftHours` |
| Report belum masuk | Schedule lewat `missingReportDays` hari, status bukan Cancelled/Leave, tidak ada Report dengan `ScheduleID` itu |
| Sesi hari ini | Schedule `Date` = hari ini; status: Sedang live / Waiting report / Belum dimulai / Report masuk |
| Konflik minggu ini | Host dengan jam tumpang tindih di hari yang sama; studio dengan sesi bersamaan > `KapasitasHost` |
| Payroll | host aktif, punya Clock In bulan ini, report belum direview, host tanpa rekening, run `Payroll` terakhir |

> Penyesuaian jam (A-5 di desain) belum punya list di v1, jadi kartu ketiga diganti **Shift belum clock out**
> yang bisa dihitung dari `Clock In`.

## 4. Dashboard

**Screen.OnVisible**

```powerfx
Set(varDashLoading, true);
Concurrent(
    ClearCollect(colDashSchedule, Filter('Schedule - PBS Hub', Date >= DateAdd(Today(), -30), Date <= DateAdd(Today(), 7))),
    ClearCollect(colDashReport, Filter('Report - PBS Hub', LiveDate >= DateAdd(Today(), -35) || ApprovalStatus.Value = "Waiting Approval" || ApprovalStatus.Value = "Waiting Approval Revision")),
    ClearCollect(colDashEvidence, Filter('Report Automation - PBS Hub', Created >= DateAdd(Today(), -35))),
    ClearCollect(colDashClockIn, Filter('Clock In - PBS Hub', ClockInDate >= DateAdd(Date(Year(Today()), Month(Today()), 1), -7))),
    ClearCollect(colDashHost, ShowColumns('Host - PBS Hub', Title, NamaHost, Status, NoRekening)),
    ClearCollect(colDashPayroll, FirstN(Sort('Payroll - PBS Hub', ID, SortOrder.Descending), 3))
);
Set(varDashLoading, false);
```

**Properti control**

```powerfx
Context      = varPbsCtx
IsLoading    = varDashLoading
SchedulesJson = JSON(ForAll(colDashSchedule, {ID: ID, Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime, JamLive: JamLive, BrandID: BrandID, HostID: HostID, StudioID: StudioID, Platform: Platform.Value, LiveBreak: LiveBreak, Position: Position.Value, Status: Status.Value}), JSONFormat.Compact)
ReportsJson  = JSON(ForAll(colDashReport, {ID: ID, Title: Title, ScheduleID: ScheduleID, HostID: HostID, BrandID: BrandID, LiveDate: Text(LiveDate, "yyyy-mm-dd"), ApprovalStatus: ApprovalStatus.Value, ApprovalComment: ApprovalComment, Created: Created, Modified: Modified, Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual, JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer}), JSONFormat.Compact)
EvidenceJson = JSON(ForAll(colDashEvidence, {ID: ID, Title: Title, HostID: HostID, ScheduleID: ScheduleID, Status: Status.Value, Created: Created, Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual, JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer}), JSONFormat.Compact)
ClockInJson  = JSON(ForAll(colDashClockIn, {HostID: HostID, ClockInDate: ClockInDate, CheckInTime: CheckInTime, CheckOutTime: CheckOutTime, ClockOutTime: ClockOutTime, IsInsideGeofence: IsInsideGeofence, Streak: Streak}), JSONFormat.Compact)
HostsJson    = JSON(ForAll(colDashHost, {Title: Title, NamaHost: NamaHost, Status: Status.Value, HasRekening: !IsBlank(NoRekening)}), JSONFormat.Compact)
StudiosJson  = JSON(ForAll('Studio - PBS Hub', {Title: Title, NamaStudio: NamaStudio, KapasitasHost: KapasitasHost, Status: Status.Value}), JSONFormat.Compact)
BrandsJson   = JSON(ForAll('Brand - PBS Hub', {Title: Title, NamaBrand: NamaBrand}), JSONFormat.Compact)
PayrollJson  = JSON(ForAll(colDashPayroll, {ID: ID, Title: Title, Periode: Periode, Status: Status.Value, Created: Created}), JSONFormat.Compact)
```

**OnChange**

```powerfx
If(!IsBlank(Self.ActionPayload),
    With({req: ParseJSON(Self.ActionPayload)},
        If(Text(req.action) = "NAV",
            Switch(Text(req.payload.target),
                "REVIEW",          Navigate(ScreenReportReview),
                "REPORT_MISSING",  Navigate(ScreenSchedule),
                "SCHEDULE",        Navigate(ScreenSchedule),
                "SESSION",         Set(varSelectedScheduleId, Value(req.payload.scheduleId)); Navigate(ScreenSchedule),
                "CLOCKIN",         Navigate(ScreenClockIn),
                "PAYROLL",         Navigate(ScreenPayroll),
                "UPLOAD_SCHEDULE", Navigate(ScreenSchedule),
                "CREATE_SCHEDULE", Navigate(ScreenSchedule)
            )
        )
    )
)
```

## 5. ReportReview

**Screen.OnVisible** (server-side paging dengan `varRrTop`)

```powerfx
Set(varRrTop, 500);
Set(varRrLoading, true);
ClearCollect(colRrReport, FirstN(Sort('Report - PBS Hub', ID, SortOrder.Descending), varRrTop));
ClearCollect(colRrEvidence, Filter('Report Automation - PBS Hub', Created >= DateAdd(Today(), -60)));
// Jam live di list diambil dari Schedule lewat Report.ScheduleID = Schedule.Title
// (Filter tanggal supaya tetap delegable di SharePoint; `Title in colRrReport.ScheduleID` tidak delegable)
ClearCollect(colRrSchedule, ShowColumns(Filter('Schedule - PBS Hub', Date >= DateAdd(Today(), -90)), ID, Title, Date, StartTime, EndTime));
Set(varRrLoading, false);
Clear(colPbsProcessed);
```

**Properti**

```powerfx
Context      = varPbsCtx
Mode         = If(userRole.Value = "HOST", "ReadOnly", "Admin")
DefaultTab   = "Waiting"
IsLoading    = varRrLoading
HasMore      = CountRows(colRrReport) >= varRrTop
ActionResult = varRrResult
ReportsJson  = JSON(ForAll(colRrReport, {ID: ID, Title: Title, ScheduleID: ScheduleID, HostID: HostID, BrandID: BrandID, AccountID: AccountID, Account: Account, Platform: Platform.Value, LiveDate: Text(LiveDate, "yyyy-mm-dd"), Playbook: Playbook.Value, Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual, JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)', AddToCart: AddToCart, TotalViewer: TotalViewer, Comment: Comment, Share: Share, ApprovalStatus: ApprovalStatus.Value, Match: Match.Value, ApprovalComment: ApprovalComment, Approver: Approver.DisplayName, ApproverEmail: ApproverEmail, Attachment: Attachment, Created: Created, Modified: Modified}), JSONFormat.Compact)
EvidenceJson = JSON(ForAll(colRrEvidence, {ID: ID, Title: Title, HostID: HostID, ScheduleID: ScheduleID, AccountID: AccountID, Platform: Platform.Value, Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual, JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)', AddToCart: AddToCart, TotalViewer: TotalViewer, Comment: Comment, Share: Share, Status: Status.Value, Attachment: Attachment, Created: Created}), JSONFormat.Compact)
HostsJson    = JSON(ForAll('Host - PBS Hub', {Title: Title, NamaHost: NamaHost}), JSONFormat.Compact)
BrandsJson   = JSON(ForAll('Brand - PBS Hub', {Title: Title, NamaBrand: NamaBrand}), JSONFormat.Compact)
SchedulesJson = JSON(ForAll(colRrSchedule, {ID: ID, Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime}), JSONFormat.Compact)
```

Setiap baris punya dua tombol: **Review** membuka popup (tabel metrik lengkap, bukti, dan tombol
keputusan) sehingga reviewer bisa langsung menyetujui / minta revisi dari antrean; **Detail** mengirim
`OPEN_REPORT` untuk pindah ke layar ReportDetail. Popup juga punya tautan *Lihat detail* (`OPEN_REPORT`).
Karena itu `OnChange` ReportReview harus menangani **aksi keputusan yang sama** dengan ReportDetail
(`APPROVE`, `APPROVE_WITHOUT_EVIDENCE`, `REQUEST_REVISION`, `ESCALATE`, `REMIND_HOST`, `OPEN_EVIDENCE`)
dan membalas lewat `varRrResult`. Popup tertutup sendiri setelah `status: "ok"`.

**Yang ditulis saat review** (popup ReportReview dan ReportDetail memakai rumus yang sama):

| Keputusan | `Report - PBS Hub` | `Report Automation - PBS Hub` (baris dengan `Title` = `Report.Title`) |
|---|---|---|
| Setujui (`APPROVE`, `BULK_APPROVE`) | `ApprovalStatus = Done`, `Match = Match`, `ApprovalComment`, `ApproverEmail`, `Approver` | `Status = Match` |
| Setujui tanpa bukti | `ApprovalStatus = Done`, `Match` tetap, `ApprovalComment = [Tanpa bukti] …`, approver | tidak diubah |
| Perlu revisi (`REQUEST_REVISION`) | `ApprovalStatus = Need Revision`, `Match = Unmatch`, `ApprovalComment` = komentar reviewer, `ApproverEmail` = reviewer, `TanggalRevisi` | `Status = Unmatch` |
| Eskalasi | `ApprovalStatus` tetap, `ApprovalComment = [Eskalasi] …` | tidak diubah |
| Host kirim perbaikan (Host app, `RESUBMIT_REPORT`) | `ApprovalStatus = Waiting Approval Revision`, metrik baru | `Status = Unmatch` saja |

Keputusan hanya ditulis kalau `ApprovalStatus` masih `Waiting Approval` / `Waiting Approval Revision`; selain itu
canvas membalas `conflict` dan tidak menulis apa pun.

**OnChange**

```powerfx
If(!IsBlank(Self.ActionPayload),
    With({req: ParseJSON(Self.ActionPayload)},
        With({act: Text(req.action), rid: Text(req.requestId), p: req.payload},
            If(!(rid in colPbsProcessed.Id),
                Collect(colPbsProcessed, {Id: rid});
                Switch(act,
                    "OPEN_EVIDENCE", Launch(Text(p.url)),
                    "RELOAD", Refresh('Report - PBS Hub'); ClearCollect(colRrReport, FirstN(Sort('Report - PBS Hub', ID, SortOrder.Descending), varRrTop)),
                    "REMIND_HOST",
                        IfError(
                            Office365Outlook.SendEmailV2(
                                LookUp('Host - PBS Hub', Title = Text(p.hostId)).Email.Email,
                                "Bukti report " & Text(p.title) & " belum masuk",
                                "Halo, screenshot untuk report " & Text(p.title) & " belum kami terima. Mohon unggah ke folder Report Automation dengan nama ReportID_Platform_AccountID."
                            );
                            Set(varRrResult, JSON({requestId: rid, status: "ok"}, JSONFormat.Compact)),
                            Set(varRrResult, JSON({requestId: rid, status: "error", message: FirstError.Message}, JSONFormat.Compact))
                        ),
                    "OPEN_REPORT",
                        Set(varSelectedReportId, Value(p.reportId));
                        Navigate(ScreenReportDetail),
                    "LOAD_MORE",
                        Set(varRrTop, varRrTop + 500);
                        Set(varRrLoading, true);
                        ClearCollect(colRrReport, FirstN(Sort('Report - PBS Hub', ID, SortOrder.Descending), varRrTop));
                        Set(varRrLoading, false),
                    "NAV",
                        If(Text(p.target) = "TOLERANCE_CONFIG", Navigate(ScreenToleranceConfig)),
                    "BULK_APPROVE",
                        IfError(
                            ForAll(Table(p.items),
                                With({it: ThisRecord.Value, cur: LookUp('Report - PBS Hub', ID = Value(ThisRecord.Value.reportId))},
                                    // Lewati yang sudah diputuskan orang lain sejak layar dibuka.
                                    If(cur.ApprovalStatus.Value in ["Waiting Approval", "Waiting Approval Revision"],
                                        Patch('Report - PBS Hub', cur, {
                                            ApprovalStatus: {Value: "Done"}, Match: {Value: "Match"},
                                            ApprovalComment: Text(p.comment), ApproverEmail: User().Email
                                        });
                                        With({ev: If(IsBlank(Text(it.evidenceId)),
                                                    First(Sort(Filter('Report Automation - PBS Hub', Title = cur.Title), ID, SortOrder.Descending)),
                                                    LookUp('Report Automation - PBS Hub', ID = Value(it.evidenceId)))},
                                            If(!IsBlank(ev), Patch('Report Automation - PBS Hub', ev, {Status: {Value: "Match"}})))
                                    )
                                )
                            );
                            Refresh('Report - PBS Hub');
                            ClearCollect(colRrReport, FirstN(Sort('Report - PBS Hub', ID, SortOrder.Descending), varRrTop));
                            ClearCollect(colRrEvidence, Filter('Report Automation - PBS Hub', Created >= DateAdd(Today(), -60)));
                            Set(varRrResult, JSON({requestId: rid, status: "ok", message: CountRows(Table(p.items)) & " report disetujui."}, JSONFormat.Compact)),
                            Set(varRrResult, JSON({requestId: rid, status: "error", message: "Bulk approve gagal: " & FirstError.Message}, JSONFormat.Compact))
                        ),
                    "FILTER_CHANGED", false
                );
                // Keputusan dari popup: logika sama persis dengan ReportDetail (§6), balasan ke varRrResult.
                If(act in ["APPROVE", "APPROVE_WITHOUT_EVIDENCE", "REQUEST_REVISION", "ESCALATE"],
                    With({cur: LookUp('Report - PBS Hub', ID = Value(p.reportId))},
                        If(
                            !(cur.ApprovalStatus.Value in ["Waiting Approval", "Waiting Approval Revision"]),
                            Set(varRrResult, JSON({requestId: rid, status: "conflict",
                                decidedBy: Coalesce(cur.Approver.DisplayName, cur.ApproverEmail, "orang lain"),
                                decidedAt: cur.Modified}, JSONFormat.Compact)),
                            IfError(
                                Patch('Report - PBS Hub', cur, {
                                    ApprovalStatus: {Value: Text(p.approvalStatus)},
                                    Match: If(IsBlank(Text(p.match)), cur.Match, {Value: Text(p.match)}),
                                    ApprovalComment: Text(p.comment),
                                    ApproverEmail: User().Email,
                                    Approver: {
                                        '@odata.type': "#Microsoft.Azure.Connectors.SharePoint.SPListExpandedUser",
                                        Claims: "i:0#.f|membership|" & Lower(User().Email),
                                        DisplayName: User().FullName, Email: User().Email,
                                        Department: "", JobTitle: "", Picture: ""
                                    },
                                    TanggalRevisi: If(act = "REQUEST_REVISION", Now(), cur.TanggalRevisi)
                                });
                                // Report Automation: baris dengan Title yang sama (REP-xxx); yang terbaru kalau lebih dari satu.
                                With({ev: If(IsBlank(Text(p.evidenceId)),
                                            First(Sort(Filter('Report Automation - PBS Hub', Title = cur.Title), ID, SortOrder.Descending)),
                                            LookUp('Report Automation - PBS Hub', ID = Value(p.evidenceId)))},
                                    If(!IsBlank(ev) && !IsBlank(Text(p.match)),
                                        Patch('Report Automation - PBS Hub', ev, {Status: {Value: Text(p.match)}})));
                                Refresh('Report - PBS Hub');
                                ClearCollect(colRrReport, FirstN(Sort('Report - PBS Hub', ID, SortOrder.Descending), varRrTop));
                                ClearCollect(colRrEvidence, Filter('Report Automation - PBS Hub', Created >= DateAdd(Today(), -60)));
                                Set(varRrResult, JSON({requestId: rid, status: "ok"}, JSONFormat.Compact)),
                                Set(varRrResult, JSON({requestId: rid, status: "error", message: "Gagal menyimpan " & Text(p.title) & ": " & FirstError.Message}, JSONFormat.Compact))
                            )
                        )
                    )
                )
            )
        )
    )
)
```

> Filter di control berjalan di atas baris yang sudah dimuat. `FILTER_CHANGED` dikirim supaya canvas bisa
> memuat ulang dari server kalau datanya lebih besar dari `varRrTop`.

## 6. ReportDetail

**Properti**

```powerfx
Context      = varPbsCtx
Mode         = If(userRole.Value = "HOST", "ReadOnly", "Admin")
IsLoading    = varRdLoading
ActionResult = varRdResult
ReportJson   = JSON(ForAll(Filter('Report - PBS Hub', ID = varSelectedReportId), {ID: ID, Title: Title, ScheduleID: ScheduleID, HostID: HostID, BrandID: BrandID, AccountID: AccountID, Account: Account, Platform: Platform.Value, LiveDate: Text(LiveDate, "yyyy-mm-dd"), Playbook: Playbook.Value, Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual, JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)', AddToCart: AddToCart, TotalViewer: TotalViewer, Comment: Comment, Share: Share, ApprovalStatus: ApprovalStatus.Value, Match: Match.Value, ApprovalComment: ApprovalComment, Approver: Approver.DisplayName, ApproverEmail: ApproverEmail, Attachment: Attachment, Created: Created, Modified: Modified}), JSONFormat.Compact)
EvidenceJson = JSON(ForAll(Filter('Report Automation - PBS Hub', Title = LookUp('Report - PBS Hub', ID = varSelectedReportId).Title), {ID: ID, Title: Title, HostID: HostID, ScheduleID: ScheduleID, AccountID: AccountID, Platform: Platform.Value, Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual, JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)', AddToCart: AddToCart, TotalViewer: TotalViewer, Comment: Comment, Share: Share, Status: Status.Value, Attachment: Attachment, Created: Created}), JSONFormat.Compact)
HostsJson    = JSON(ForAll(Filter('Host - PBS Hub', Title = LookUp('Report - PBS Hub', ID = varSelectedReportId).HostID), {Title: Title, NamaHost: NamaHost}), JSONFormat.Compact)
BrandsJson   = JSON(ForAll('Brand - PBS Hub', {Title: Title, NamaBrand: NamaBrand}), JSONFormat.Compact)
SchedulesJson = JSON(ForAll(Filter('Schedule - PBS Hub', Title = LookUp('Report - PBS Hub', ID = varSelectedReportId).ScheduleID), {ID: ID, Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime}), JSONFormat.Compact)
```

**Payload keputusan** (semua berisi `reportId`, `title`, `evidenceId`, `evidenceTitle`, `expectedModified`,
`approverEmail`, `approverName`, `reason`):

| Aksi | `approvalStatus` | `match` | `comment` |
|---|---|---|---|
| `APPROVE` | `Done` | `Match` | komentar reviewer |
| `APPROVE_WITHOUT_EVIDENCE` | `Done` | kosong (jangan diubah) | `[Tanpa bukti] …` (wajib diisi) |
| `REQUEST_REVISION` | `Need Revision` | `Unmatch` | catatan + `Metrik yang perlu dibetulkan: …`; `flaggedMetrics: ["Penjualan","CTOR"]` (hanya metrik yang selisihnya ≠ 0 %) |
| `ESCALATE` | tetap (`Waiting Approval`) | tetap | `[Eskalasi] …` |
| `REMIND_HOST` | – | – | kirim email/notifikasi ke host (`hostId`) |

**OnChange**

```powerfx
If(!IsBlank(Self.ActionPayload),
    With({req: ParseJSON(Self.ActionPayload)},
        With({act: Text(req.action), rid: Text(req.requestId), p: req.payload},
            If(!(rid in colPbsProcessed.Id),
                Collect(colPbsProcessed, {Id: rid});
                Switch(act,
                    "BACK", Back(),
                    "RELOAD", Refresh('Report - PBS Hub'); Refresh('Report Automation - PBS Hub'),
                    "OPEN_EVIDENCE", Launch(Text(p.url)),
                    "REMIND_HOST",
                        IfError(
                            Office365Outlook.SendEmailV2(
                                LookUp('Host - PBS Hub', Title = Text(p.hostId)).Email.Email,
                                "Bukti report " & Text(p.title) & " belum masuk",
                                "Halo, screenshot untuk report " & Text(p.title) & " belum kami terima. Mohon unggah ke folder Report Automation dengan nama ReportID_Platform_AccountID."
                            );
                            Set(varRdResult, JSON({requestId: rid, status: "ok"}, JSONFormat.Compact)),
                            Set(varRdResult, JSON({requestId: rid, status: "error", message: FirstError.Message}, JSONFormat.Compact))
                        ),
                    // APPROVE, APPROVE_WITHOUT_EVIDENCE, REQUEST_REVISION, ESCALATE
                    If(!(act in ["APPROVE", "APPROVE_WITHOUT_EVIDENCE", "REQUEST_REVISION", "ESCALATE"]),
                        Set(varRdResult, JSON({requestId: rid, status: "error", message: "Aksi tidak dikenal: " & act}, JSONFormat.Compact)),
                    With({cur: LookUp('Report - PBS Hub', ID = Value(p.reportId))},
                        If(
                            // Sudah diputuskan orang lain sejak layar dibuka → tolak tulis (race R2).
                            !(cur.ApprovalStatus.Value in ["Waiting Approval", "Waiting Approval Revision"]),
                            Set(varRdResult, JSON({requestId: rid, status: "conflict",
                                decidedBy: Coalesce(cur.Approver.DisplayName, cur.ApproverEmail, "orang lain"),
                                decidedAt: cur.Modified}, JSONFormat.Compact)),
                            IfError(
                                Patch('Report - PBS Hub', cur, {
                                    ApprovalStatus: {Value: Text(p.approvalStatus)},
                                    Match: If(IsBlank(Text(p.match)), cur.Match, {Value: Text(p.match)}),
                                    ApprovalComment: Text(p.comment),
                                    ApproverEmail: User().Email,
                                    Approver: {
                                        '@odata.type': "#Microsoft.Azure.Connectors.SharePoint.SPListExpandedUser",
                                        Claims: "i:0#.f|membership|" & Lower(User().Email),
                                        DisplayName: User().FullName, Email: User().Email,
                                        Department: "", JobTitle: "", Picture: ""
                                    },
                                    TanggalRevisi: If(act = "REQUEST_REVISION", Now(), cur.TanggalRevisi)
                                });
                                // Report Automation: baris dengan Title yang sama (REP-xxx); yang terbaru kalau lebih dari satu.
                                With({ev: If(IsBlank(Text(p.evidenceId)),
                                            First(Sort(Filter('Report Automation - PBS Hub', Title = cur.Title), ID, SortOrder.Descending)),
                                            LookUp('Report Automation - PBS Hub', ID = Value(p.evidenceId)))},
                                    If(!IsBlank(ev) && !IsBlank(Text(p.match)),
                                        Patch('Report Automation - PBS Hub', ev, {Status: {Value: Text(p.match)}})));
                                Refresh('Report - PBS Hub'); Refresh('Report Automation - PBS Hub');
                                Set(varRdResult, JSON({requestId: rid, status: "ok"}, JSONFormat.Compact)),
                                Set(varRdResult, JSON({requestId: rid, status: "error", message: "Gagal menyimpan " & Text(p.title) & ": " & FirstError.Message}, JSONFormat.Compact))
                            )
                        )
                    ))
                )
            )
        )
    )
)
```

**Minta revisi.** Semua metrik tampil di satu tabel. Di panel revisi, metrik yang selisihnya ≠ 0 % sudah
tercentang; metrik yang sama persis (0 %) tidak bisa dicentang dan tidak pernah dikirim di `flaggedMetrics`.
Kalau semua metrik sama persis, tombol *Perlu revisi* nonaktif.

Tiga sifat yang harus dipertahankan:

1. `colPbsProcessed` membuat replay aman — `requestId` yang sama tidak diproses dua kali.
2. `IfError` membungkus tulis. Patch gagal menghasilkan `status: "error"`, tidak pernah melaporkan sukses
   (defect v1 di `ScreenPayroll.pa.yaml:4437`).
3. Cek status sebelum tulis menutup race R2 (flow PBS0005A / reviewer lain / host menulis kolom yang sama).

## 7. Payroll

### Data mapping

| Properti | List | Field |
|---|---|---|
| `PayrollJson` | `Payroll - PBS Hub` | `ID, Title, PayrollName, Periode, Status, Trigger, TotalPayroll, TotalHost, PBSApproval, HCApproval, FASApproval, FinanceApproval, PBSComment, HCComment, FASComment, FinanceComment, Created, Modified` |
| `PayrollDataJson` (Runs) | `Payroll Data` | `payroll_id, TotalGaji` saja: untuk total dan jumlah host per run |
| `PayrollDataJson` (Detail) | `Payroll Data` | `Title, payroll_id, Employee_Name, Employee_Email, Periode, JumlahHari, UangKehadiran, Mingguan, Tier1, Tier2, Tier3, PPh21, TotalGaji, NetTHP, Bank` + **dihitung di canvas**: `HostID` (dari Host.Email), `NorekLast4 = Right(Norek, 4)`, `HasRekening` |
| `ClockInJson` (Detail) | `Clock In - PBS Hub` | bulan data run: `HostID, ClockInDate, CheckInTime, CheckOutTime, ClockOutTime, IsInsideGeofence, HKTugas, Insentif, Tier, Streak` |
| `HostsJson` (Runs) | `Host - PBS Hub` | `Title, NamaHost, Status, HasRekening` |
| `PreflightJson` (Runs) | Clock In + Report | objek `{period, clockIns, reports}` untuk bulan yang dipilih di modal |
| `PayslipJson` | *tidak ada di v1* | opsional: log slip `{payroll_id, LineID/Employee_Email, Status, SentAt, Error}` |

**Jangan kirim** `Employee_ID` (isinya KTP, P6), `Norek` lengkap, `Alamat`, atau `KTP` ke control.

Cara control membaca data v1:

| Fakta v1 | Yang dilakukan control |
|---|---|
| `Payroll.Periode` = bulan run, data = bulan sebelumnya (P8) | Periode data = label + `payrollLabelOffset` (−1). Label asli tetap tampil kecil di bawahnya. |
| `TotalPayroll` / `TotalHost` tidak pernah ditulis (P9) | Total dan jumlah host dihitung dari `Payroll Data`. Kalau suatu saat diisi dan berbeda → banner merah "Total tidak rekonsil". |
| `Payroll Data.Periode` literal `August-2026` (P2) | Dibandingkan dengan periode data run → banner "Label periode tidak cocok". |
| `Status` satu kolom yang ditimpa tiap gate, dua gate paralel saling menimpa | Gate dibaca dari `Status` + kolom `HCApproval` / `PBSApproval` (Head of PBS) / `FASApproval`. `Approved by <nama>` tanpa kata HC/PBS/FAS = gate 1 (PBS internal); kolom `HCApproval` membedakannya dari P7. |
| `PPh21 = 0` (P3) | Kartu KPI menyebut "PPh21 Rp0 di semua baris". |
| Finance tidak pernah approve (P5) | Gate Finance "terkirim ke Finance" saat `Status = Done`. |
| Run manual PBS0003M tidak menulis `Payroll Data` | Run tanpa baris → banner yang menyebut PBS0003M. |
| Tidak ada log slip | Tab Slip gaji: "Status slip belum tercatat" sampai `PayslipJson` diisi. |

Preflight (dihitung di control dari `PreflightJson` + `HostsJson` + daftar run):

| Cek | Level |
|---|---|
| Periode data ≠ bulan lalu, selama `payrollAnyPeriod = false` (flow v1 tidak menerima periode) | ✗ memblokir |
| Periode ini sudah punya run yang tidak ditolak (P11) | ✗ memblokir |
| Masih ada run lain yang terbuka | ✗ memblokir |
| Host aktif yang punya kehadiran tapi tanpa data rekening | ✗ memblokir |
| Tidak ada host aktif / tidak ada kehadiran sama sekali | ✗ memblokir |
| Host aktif tanpa kehadiran (flow tetap membuat baris Rp0) | ⚠ peringatan |
| Host nonaktif punya kehadiran (tidak dibayar) | ⚠ peringatan |
| Shift tanpa clock out · clock in di luar geofence (tetap dihitung, W2) | ⚠ peringatan |
| Report bulan itu belum direview | ⚠ peringatan |
| Pernah dijalankan lalu ditolak | ⚠ peringatan |

Peringatan harus dicentang dulu sebelum tombol **Jalankan payroll** aktif. Tarif yang tampil adalah nilai
yang paling sering muncul di `HKTugas` / `Insentif` per Tier / `Streak` bulan itu (v1 belum punya tabel tarif).

### PayrollRuns

**Screen.OnVisible**

```powerfx
Set(varPrTop, 24);
Set(varPrLoading, true);
Set(varPfJson, "");
Concurrent(
    ClearCollect(colPrRun, FirstN(Sort('Payroll - PBS Hub', ID, SortOrder.Descending), varPrTop)),
    ClearCollect(colPrHost, ShowColumns('Host - PBS Hub', Title, NamaHost, Status, NoRekening))
);
// "in" tidak didelegasikan: aman selama Payroll Data < batas baris app (2000).
ClearCollect(colPrLine, ShowColumns(Filter('Payroll Data', payroll_id in colPrRun.Title), payroll_id, TotalGaji));
Set(varPrLoading, false);
Clear(colPbsProcessed);
```

**Properti**

```powerfx
Context          = varPbsCtx
IsLoading        = varPrLoading
HasMore          = CountRows(colPrRun) >= varPrTop
PreflightJson    = varPfJson
PreflightLoading = varPfLoading
ActionResult     = varPrResult
PayrollJson      = JSON(ForAll(colPrRun, {ID: ID, Title: Title, PayrollName: PayrollName, Periode: Periode, Status: Status.Value, Trigger: Trigger.Value, TotalPayroll: TotalPayroll, TotalHost: TotalHost, PBSApproval: PBSApproval, HCApproval: HCApproval, FASApproval: FASApproval, FinanceApproval: FinanceApproval, PBSComment: PBSComment, HCComment: HCComment, FASComment: FASComment, FinanceComment: FinanceComment, Created: Created, Modified: Modified}), JSONFormat.Compact)
PayrollDataJson  = JSON(ForAll(colPrLine, {payroll_id: payroll_id, TotalGaji: TotalGaji}), JSONFormat.Compact)
HostsJson        = JSON(ForAll(colPrHost, {Title: Title, NamaHost: NamaHost, Status: Status.Value, HasRekening: !IsBlank(NoRekening)}), JSONFormat.Compact)
PayslipJson      = ""
```

**OnChange**

```powerfx
If(!IsBlank(Self.ActionPayload),
    With({req: ParseJSON(Self.ActionPayload)},
        With({act: Text(req.action), rid: Text(req.requestId), p: req.payload},
            If(!(rid in colPbsProcessed.Id),
                Collect(colPbsProcessed, {Id: rid});
                Switch(act,
                    "OPEN_RUN",
                        Set(varSelectedPayrollId, Value(p.payrollId));
                        Navigate(ScreenPayrollDetail),
                    "PREFLIGHT_PERIOD",
                        Set(varPfLoading, true);
                        With({start: Date(Value(p.year), Value(p.month), 1)},
                            Set(varPfJson, JSON({
                                period: Text(p.period),
                                clockIns: ForAll(Filter('Clock In - PBS Hub', ClockInDate >= start, ClockInDate < DateAdd(start, 1, TimeUnit.Months)),
                                    {HostID: HostID, ClockInDate: ClockInDate, CheckInTime: CheckInTime, CheckOutTime: CheckOutTime, ClockOutTime: ClockOutTime, IsInsideGeofence: IsInsideGeofence, HKTugas: HKTugas, Insentif: Insentif, Tier: Tier.Value, Streak: Streak}),
                                reports: ForAll(Filter('Report - PBS Hub', LiveDate >= start, LiveDate < DateAdd(start, 1, TimeUnit.Months)),
                                    {ID: ID, LiveDate: Text(LiveDate, "yyyy-mm-dd"), ApprovalStatus: ApprovalStatus.Value, ApprovalComment: ApprovalComment})
                            }, JSONFormat.Compact))
                        );
                        Set(varPfLoading, false),
                    "RUN_PAYROLL",
                        IfError(
                            // Cek ulang di server: layar bisa basi, dan flow v1 tidak punya guard periode ganda (P11).
                            If(!IsBlank(LookUp('Payroll - PBS Hub', !(Status.Value = "Done" || StartsWith(Status.Value, "Rejected")))),
                                Set(varPrResult, JSON({requestId: rid, status: "error", message: "Masih ada run payroll yang terbuka. Muat ulang daftar."}, JSONFormat.Compact)),
                                // Ganti dengan koneksi flow payroll di app ini (lihat catatan PBS0003M di bawah).
                                PBS0003MMonthlyPayrollApprovalManual.Run();
                                ClearCollect(colPrRun, FirstN(Sort('Payroll - PBS Hub', ID, SortOrder.Descending), varPrTop));
                                Set(varPrResult, JSON({requestId: rid, status: "ok", message: "Payroll " & Text(p.label) & " dijalankan. Run baru muncul setelah flow membuat item Payroll."}, JSONFormat.Compact))
                            ),
                            Set(varPrResult, JSON({requestId: rid, status: "error", message: FirstError.Message}, JSONFormat.Compact))
                        ),
                    "NAV",
                        Switch(Text(p.target),
                            "CLOCKIN", Navigate(ScreenClockIn),
                            "HOSTS",   Navigate(ScreenHost),
                            "REVIEW",  Navigate(ScreenReportReview)
                        ),
                    "LOAD_MORE",
                        Set(varPrTop, varPrTop + 24);
                        Set(varPrLoading, true);
                        ClearCollect(colPrRun, FirstN(Sort('Payroll - PBS Hub', ID, SortOrder.Descending), varPrTop));
                        ClearCollect(colPrLine, ShowColumns(Filter('Payroll Data', payroll_id in colPrRun.Title), payroll_id, TotalGaji));
                        Set(varPrLoading, false)
                )
            )
        )
    )
)
```

> ⚠️ **Flow yang dipanggil tombol.** Tombol app v1 memanggil `PBS0003M` (legacy), yang **tidak menulis
> `Payroll Data`** dan membawa defect lain (DESIGN.md UC-6). Run dari tombol ini akan tampil di detail
> dengan banner "Run manual … tidak menulis Payroll Data". Rekomendasi: buat salinan `PBS0003A` dengan
> trigger Power Apps yang menerima `period` (`yyyy-mm`), lalu set `payrollAnyPeriod: true`.
> Selama flow belum menerima periode, preflight hanya mengizinkan bulan lalu.

### PayrollRunDetail

**Screen.OnVisible**

```powerfx
Set(varPdLoading, true);
Set(varPdRun, LookUp('Payroll - PBS Hub', ID = varSelectedPayrollId));
// Periode "Sep 2026" = bulan run; data kehadiran = bulan sebelumnya (P8).
Set(varPdStart, DateAdd(DateValue("1 " & varPdRun.Periode, "en-US"), -1, TimeUnit.Months));
Concurrent(
    ClearCollect(colPdLine, Filter('Payroll Data', payroll_id = varPdRun.Title)),
    ClearCollect(colPdHost, ShowColumns('Host - PBS Hub', Title, Email)),
    ClearCollect(colPdClockIn, Filter('Clock In - PBS Hub', ClockInDate >= varPdStart, ClockInDate < DateAdd(varPdStart, 1, TimeUnit.Months)))
);
Set(varPdLoading, false);
Clear(colPbsProcessed);
```

**Properti**

```powerfx
Context         = varPbsCtx
DefaultTab      = "Lines"
IsLoading       = varPdLoading
ActionResult    = varPdResult
PayrollJson     = JSON(ForAll(Filter('Payroll - PBS Hub', ID = varSelectedPayrollId), {ID: ID, Title: Title, PayrollName: PayrollName, Periode: Periode, Status: Status.Value, Trigger: Trigger.Value, TotalPayroll: TotalPayroll, TotalHost: TotalHost, PBSApproval: PBSApproval, HCApproval: HCApproval, FASApproval: FASApproval, FinanceApproval: FinanceApproval, PBSComment: PBSComment, HCComment: HCComment, FASComment: FASComment, FinanceComment: FinanceComment, Created: Created, Modified: Modified}), JSONFormat.Compact)
PayrollDataJson = JSON(ForAll(colPdLine, {Title: Title, payroll_id: payroll_id, HostID: LookUp(colPdHost, Lower(Email.Email) = Lower(Employee_Email)).Title, Employee_Name: Employee_Name, Employee_Email: Employee_Email, Periode: Periode, JumlahHari: JumlahHari, UangKehadiran: UangKehadiran, Mingguan: Mingguan, Tier1: Tier1, Tier2: Tier2, Tier3: Tier3, PPh21: PPh21, TotalGaji: TotalGaji, NetTHP: NetTHP, Bank: Bank, NorekLast4: Right(Norek, 4), HasRekening: !IsBlank(Norek) && !IsBlank(Bank)}), JSONFormat.Compact)
ClockInJson     = JSON(ForAll(colPdClockIn, {HostID: HostID, ClockInDate: ClockInDate, CheckInTime: CheckInTime, CheckOutTime: CheckOutTime, ClockOutTime: ClockOutTime, IsInsideGeofence: IsInsideGeofence, HKTugas: HKTugas, Insentif: Insentif, Tier: Tier.Value, Streak: Streak}), JSONFormat.Compact)
PayslipJson     = ""
```

**OnChange**

```powerfx
If(!IsBlank(Self.ActionPayload),
    With({req: ParseJSON(Self.ActionPayload)},
        With({act: Text(req.action), rid: Text(req.requestId), p: req.payload},
            If(!(rid in colPbsProcessed.Id),
                Collect(colPbsProcessed, {Id: rid});
                Switch(act,
                    "BACK", Back(),
                    "RELOAD",
                        Set(varPdLoading, true);
                        Refresh('Payroll - PBS Hub');
                        Set(varPdRun, LookUp('Payroll - PBS Hub', ID = varSelectedPayrollId));
                        ClearCollect(colPdLine, Filter('Payroll Data', payroll_id = varPdRun.Title));
                        Set(varPdLoading, false),
                    "RESEND_PAYSLIPS",
                        // Hanya relevan setelah ada log slip + flow kirim ulang. Tanpa itu, balas error yang jelas.
                        Set(varPdResult, JSON({requestId: rid, status: "error", message: "Kirim ulang slip belum tersedia: v1 tidak punya flow kirim ulang."}, JSONFormat.Compact))
                )
            )
        )
    )
)
```

Aksi: `BACK`, `RELOAD` (`{payrollId, title}`) tidak mengunci. `RESEND_PAYSLIPS`
(`{payrollId, title, items: [{lineId, name, email, hostId}]}`) mengunci dan wajib dibalas; tombolnya
hanya muncul untuk `PAYROLL_RUN` dan hanya aktif kalau ada slip Gagal/Bounce di `PayslipJson`.

## 8. Host

### Data mapping

| Kolom v1 | Dikirim sebagai | Catatan |
|---|---|---|
| `Title` | `Title` | HostID, kunci join ke Schedule, Report, Clock In, Score |
| `HostCode` / `NamaHost` / `HostName` | sama | Tampil: `HostCode` (fallback `Title`), nama: `NamaHost` → `HostName` |
| `Status` (Choice) | `Status: Status.Value` | `Active` / `Inactive`. Payroll v1 **tidak** menyaring kolom ini |
| `Package` (Choice) | `Package: Package.Value` | |
| `Email` (Person) | `Email: Email.Email` | Email kerja |
| `JoinDate`, `RegistrationDate`, `RegisteredBy` | sama | |
| `InitialScore`, `CurrentScore`, `MinimumScore`, `MaximumScore` | sama | Kosong → `scoreInitial/scoreMin/scoreMax` di Context (`[FAS STUDIO] ScoreConfig`) |
| `NoRekening`, `Bank` | `HasRekening`, `NorekLast4`, `Bank` | **Nomor lengkap tidak pernah dikirim** |
| `KTP` | `KtpLast4` | Hanya di HostDetail |
| `PhoneNumber` | `PhoneLast4` | Hanya di HostDetail |
| `Alamat`, `NamaRekening`, `PersonalEmail` | `HasAlamat`, `HasNamaRekening`, `HasPersonalEmail` | Boolean saja |
| (belum ada) | `DeactivatedDate` | Opsional. Tanpa kolom ini, "periode terdampak" = bulan berjalan + bulan lalu |
| `[FAS STUDIO] HostScoreTransactions` | `ScoreTxJson` | Hanya `Status = Active` (atau kosong) yang dihitung |
| `[FAS STUDIO] HostScoreThreshold` | `ThresholdsJson` | `Tone` boleh `Success/Warning/Danger/Info` atau hijau/kuning/merah/biru |

Kalau `HostJson`/`HostsJson` ternyata memuat `KTP`, `NoRekening`, `Alamat`, `PhoneNumber`, `PersonalEmail`,
`NamaRekening` atau `Employee_ID`, control tetap menyamarkannya **dan** menampilkan banner merah: datanya
sudah terkirim ke perangkat, jadi perbaiki `ForAll` di canvas.

**Data pribadi dibuka satu kolom per permintaan.** Tombol *Lihat* mengirim `REVEAL_PII`; canvas menulis log
akses dulu, baru mengisi `RevealedJson` dengan satu nilai. Nilai hilang sendiri setelah `piiRevealSeconds`
(default 30) — control mengirim `HIDE_PII` dan canvas mengosongkan variabelnya. Tab *Data pribadi* hanya ada
untuk `HOST_PII_VIEW`; tanpa izin itu tab-nya tidak dirender sama sekali.

Log akses butuh list baru **`Host PII Access Log`** (Title, HostID, Field, ViewedBy, ViewedAt). Kalau log
gagal ditulis, data **tidak** dibuka.

### HostList

**Screen.OnVisible**

```powerfx
Set(varHlLoading, true);
Concurrent(
    ClearCollect(colHlHost, 'Host - PBS Hub'),
    ClearCollect(colScoreBand, Filter('[FAS STUDIO] HostScoreThreshold', Active))
);
Set(varHlLoading, false);
Clear(colPbsProcessed);
```

**Properti**

```powerfx
Context        = varPbsCtx
IsLoading      = varHlLoading
HasMore        = CountRows(colHlHost) >= 2000   // batas delegasi: tampilkan "Muat lebih banyak"
ActionResult   = varHlResult
HostsJson      = JSON(ForAll(colHlHost, {ID: ID, Title: Title, HostCode: HostCode, NamaHost: NamaHost, Status: Status.Value, Package: Package.Value, Email: Email.Email, JoinDate: JoinDate, InitialScore: InitialScore, CurrentScore: CurrentScore, MinimumScore: MinimumScore, MaximumScore: MaximumScore, HasRekening: !IsBlank(NoRekening) && !IsBlank(Bank)}), JSONFormat.Compact)
ThresholdsJson = JSON(ForAll(colScoreBand, {ThresholdID: ThresholdID, Label: Label, Description: Description, MinimumScore: MinimumScore, MaximumScore: MaximumScore, Tone: Tone.Value, Active: Active, SortOrder: SortOrder}), JSONFormat.Compact)
SchedulesJson  = JSON(ForAll(scheduleFiltered, {Title: Title, HostID: HostID, Date: Date, StartTime: StartTime, EndTime: EndTime, Status: Status.Value}), JSONFormat.Compact)
ClockInJson    = JSON(ForAll(clockInFiltered, {HostID: HostID, ClockInDate: ClockInDate}), JSONFormat.Compact)
```

`SchedulesJson` dan `ClockInJson` hanya dipakai popup **Clock in** (lihat di bawah); cukup kolom di atas.
`scheduleFiltered` / `clockInFiltered` = koleksi yang sudah ada di app v1.

`LedgerScore` (jumlah ledger per host) opsional; kalau dikirim, baris yang `CurrentScore`-nya berbeda diberi
ikon peringatan. Jangan hitung dengan `Sum(Filter(HostScoreTransactions…))` per baris di list besar (S5,
delegasi) — lebih baik dari flow terjadwal.

**OnChange**

```powerfx
If(!IsBlank(Self.ActionPayload),
    With({req: ParseJSON(Self.ActionPayload)},
        With({act: Text(req.action), rid: Text(req.requestId), p: req.payload},
            If(!(rid in colPbsProcessed.Id),
                Collect(colPbsProcessed, {Id: rid});
                Switch(act,
                    "OPEN_HOST", Set(varSelectedHostId, Text(p.hostId)); Navigate(scrHostDetail),
                    "ADD_HOST", Navigate(scrHostForm),                       // form v1 (HOST0001A)
                    "LOAD_MORE", Notify("Gunakan filter untuk mempersempit daftar host.", NotificationType.Information),
                    "ADD_CLOCK_IN",
                        With({d: DateValue(Text(p.clockInDate)), hid: Text(p.hostId)},
                            If(!IsBlank(LookUp('Clock In - PBS Hub', HostID = hid && ClockInDate = d)),
                                // Sudah ada clock in di tanggal itu (host clock in sendiri / admin lain).
                                Set(varHlResult, JSON({requestId: rid, status: "conflict", message: "Host ini sudah punya clock in di " & Text(d, "dd mmm yyyy") & "."}, JSONFormat.Compact)),
                                IfError(
                                    Set(varNewClockIn, Patch('Clock In - PBS Hub', Defaults('Clock In - PBS Hub'), {
                                        HostID: hid,
                                        HostName: Text(p.hostName),
                                        ClockInDate: d,
                                        ClockInTime: Text(p.clockInTime),     // "HH:mm"
                                        ClockOutTime: Text(p.clockOutTime),
                                        Status: {Value: Text(p.status)},
                                        HKTugas: Value(p.hkTugas)
                                    }));
                                    Patch('Clock In - PBS Hub', varNewClockIn, {Title: "CLK-" & Text(varNewClockIn.ID, "0000")});
                                    Collect(clockInFiltered, varNewClockIn);        // tanggal ini hilang dari pilihan
                                    Set(varHlResult, JSON({requestId: rid, status: "ok",
                                        message: "Clock in tersimpan: CLK-" & Text(varNewClockIn.ID, "0000") & " · " & Text(d, "dd mmm yyyy") & " " & Text(p.clockInTime) & "–" & Text(p.clockOutTime) & " · HKTugas Rp " & Text(Value(p.hkTugas), "#,##0")}, JSONFormat.Compact));
                                    Set(varNewClockIn, Blank()),
                                    Set(varHlResult, JSON({requestId: rid, status: "error", message: "Gagal menyimpan clock in: " & FirstError.Message}, JSONFormat.Compact))
                                )
                            )
                        )
                )
            )
        )
    )
)
```

Aksi: `OPEN_HOST` (`{hostId, id}`), `ADD_HOST`, `FILTER_CHANGED` (`{filters, sort}`), `LOAD_MORE` — tidak
mengunci. Tombol *Tambah host* hanya untuk `HOST_EDIT`.

**Clock in manual** (menggantikan `varPopUpAddClockIn` + combobox v1). Tombol *Clock in* di tiap baris
HostList dan di header HostDetail membuka popup:

- **Tanggal**: hanya tanggal yang ada di jadwal host dan **belum ada clock in** — rumus yang sama dengan
  `colAvailableDates` v1, diurutkan dari yang terlama. Dibatasi sampai hari ini dan jadwal yang dibatalkan
  tidak ikut. Kalau tidak ada tanggal tersisa, popup menampilkan *"… sudah clock in di semua jadwalnya"*.
- **Jam clock in / clock out**: pilihan per 30 menit, terisi otomatis dari jam jadwal hari itu; clock out
  harus setelah clock in.
- **Status**: `Hadir - Tugas` (HKTugas 180.000) dan `Hadir - Retainer` (30.000). Bisa diganti lewat
  `config.clockInStatuses` di Context, mis. `[{label: "Hadir - Tugas", hk: 180000}, {label: "Izin", hk: 0}]`.

`ADD_CLOCK_IN` **mengunci** sampai dibalas. Payload: `{hostId, hostName, clockInDate: "yyyy-mm-dd",
clockInTime: "HH:mm", clockOutTime: "HH:mm", status, hkTugas, scheduleIds}`. Balas `ok` dengan `message`
(tampil sebagai banner, popup tertutup), `conflict` kalau tanggal itu ternyata sudah punya clock in, atau
`error`. Kalau `ClockInTime`/`ClockOutTime` di list bertipe Date and Time, ganti dengan
`DateValue(Text(p.clockInDate)) + TimeValue(Text(p.clockInTime))`. Tombol hanya untuk izin `HOST_CLOCKIN`
(fallback role: PBS_Team dan FAS_Team).

### HostDetail

**Screen.OnVisible** / **OnHidden**

```powerfx
// OnVisible
Set(varHdLoading, true);
Set(varHdReveal, "");
Set(varHdHost, LookUp('Host - PBS Hub', Title = varSelectedHostId));
Set(varHdFrom, Date(Year(Today()), Month(Today()) - 1, 1));   // bulan lalu + bulan ini
Concurrent(
    ClearCollect(colHdSched, Filter('Schedule - PBS Hub', HostID = varSelectedHostId, Date >= DateAdd(Today(), -60, TimeUnit.Days))),
    ClearCollect(colHdReport, Filter('Report - PBS Hub', HostID = varSelectedHostId)),
    ClearCollect(colHdClockIn, Filter('Clock In - PBS Hub', HostID = varSelectedHostId, ClockInDate >= varHdFrom)),
    ClearCollect(colHdLine, Filter('Payroll Data', Employee_Email = varHdHost.Email.Email)),
    ClearCollect(colHdTx, Filter('[FAS STUDIO] HostScoreTransactions', HostID = varSelectedHostId)),
    ClearCollect(colScoreBand, Filter('[FAS STUDIO] HostScoreThreshold', Active))
);
ClearCollect(colHdRun, Filter('Payroll - PBS Hub', Title in colHdLine.payroll_id));
Set(varHdLoading, false);
Clear(colPbsProcessed);

// OnHidden: nilai yang sudah dibuka tidak boleh tertinggal di variabel.
Set(varHdReveal, "")
```

**Properti**

```powerfx
Context         = varPbsCtx
DefaultTab      = "Summary"          // Summary | Schedule | Attendance | Reports | Payroll | Personal
IsLoading       = varHdLoading
ActionResult    = varHdResult
RevealedJson    = varHdReveal
HostJson        = JSON(ForAll(Table(varHdHost), {ID: ID, Title: Title, HostCode: HostCode, NamaHost: NamaHost, Status: Status.Value, Package: Package.Value, Email: Email.Email, JoinDate: JoinDate, RegistrationDate: RegistrationDate, RegisteredBy: RegisteredBy, InitialScore: InitialScore, CurrentScore: CurrentScore, MinimumScore: MinimumScore, MaximumScore: MaximumScore, Modified: Modified, Bank: Bank, HasRekening: !IsBlank(NoRekening) && !IsBlank(Bank), NorekLast4: Right(NoRekening, 4), KtpLast4: Right(KTP, 4), PhoneLast4: Right(PhoneNumber, 4), HasAlamat: !IsBlank(Alamat), HasNamaRekening: !IsBlank(NamaRekening), HasPersonalEmail: !IsBlank(PersonalEmail)}), JSONFormat.Compact)
SchedulesJson   = JSON(ForAll(colHdSched, {ID: ID, Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime, BrandID: BrandID, StudioID: StudioID, HostID: HostID, Platform: Platform.Value, AccountID: AccountID, AccountName: AccountName, LiveBreak: LiveBreak, Position: Position.Value, Status: Status.Value}), JSONFormat.Compact)
// LiveBreak: Yes/No -> kirim apa adanya (boolean) atau LiveBreak.Value kalau Choice. Position: Position.Value kalau Choice, Position kalau Text.
// AccountName tampil di kolom Akun tab Jadwal (fallback ke AccountID kalau kosong).
ReportsJson     = JSON(ForAll(colHdReport, {ID: ID, Title: Title, ScheduleID: ScheduleID, Playbook: Playbook.Value, LiveDate: LiveDate, BrandID: BrandID, HostID: HostID, Platform: Platform.Value, Penjualan: Penjualan, ApprovalStatus: ApprovalStatus.Value, ApprovalComment: ApprovalComment, Modified: Modified}), JSONFormat.Compact)
ClockInJson     = JSON(ForAll(colHdClockIn, {ID: ID, Title: Title, HostID: HostID, ClockInDate: Text(ClockInDate, "yyyy-mm-dd"), CheckInTime: CheckInTime, CheckOutTime: CheckOutTime, ClockInTime: ClockInTime, ClockOutTime: ClockOutTime, IsInsideGeofence: IsInsideGeofence, StatusKehadiran: Status.Value, HKTugas: HKTugas, Tier: Tier.Value, Insentif: Insentif, Streak: Streak, AdjustedBy: AdjustedBy, AdjustedAt: AdjustedAt, AdjustReason: AdjustReason, Modified: Modified}), JSONFormat.Compact)
// Tier: pakai Tier.Value kalau kolomnya Choice, Tier kalau Text. AdjustedBy/At/Reason opsional (lihat Kehadiran di bawah).
PayrollDataJson = JSON(ForAll(colHdLine, {Title: Title, payroll_id: payroll_id, HostID: varSelectedHostId, Periode: Periode, JumlahHari: JumlahHari, TotalGaji: TotalGaji, PPh21: PPh21, NetTHP: NetTHP, Bank: Bank, NorekLast4: Right(Norek, 4), HasRekening: !IsBlank(Norek) && !IsBlank(Bank)}), JSONFormat.Compact)
PayrollJson     = JSON(ForAll(colHdRun, {ID: ID, Title: Title, PayrollName: PayrollName, Periode: Periode, Status: Status.Value, PBSApproval: PBSApproval, HCApproval: HCApproval, FASApproval: FASApproval, Created: Created, Modified: Modified}), JSONFormat.Compact)
ScoreTxJson     = JSON(ForAll(colHdTx, {ID: ID, TransactionID: TransactionID, RuleID: RuleID, TransactionType: TransactionType.Value, Point: Point, ScoreBefore: ScoreBefore, ScoreAfter: ScoreAfter, Reason: Reason, Notes: Notes, Status: Status.Value, CreatedDate: CreatedDate, CreatedBy: CreatedBy.DisplayName}), JSONFormat.Compact)
ThresholdsJson  = JSON(ForAll(colScoreBand, {ThresholdID: ThresholdID, Label: Label, Description: Description, MinimumScore: MinimumScore, MaximumScore: MaximumScore, Tone: Tone.Value, Active: Active, SortOrder: SortOrder}), JSONFormat.Compact)
BrandsJson      = JSON(ShowColumns('Brand - PBS Hub', Title, NamaBrand), JSONFormat.Compact)
StudiosJson     = JSON(ShowColumns('Studio - PBS Hub', Title, NamaStudio), JSONFormat.Compact)
```

**Tab Jadwal — status sesi**

| Kondisi di Schedule | Status yang tampil |
|---|---|
| `LiveBreak = Yes` | *Finished* + badge *Live break* — tidak ada report yang ditunggu |
| `Position = Co-Host` (walau `LiveBreak = No`) | *Finished* + badge *Co-Host* — sama, tidak ada report |
| `Status = Waiting Report` dan report untuk `ScheduleID` itu sudah ada di `ReportsJson` | *Finished* |
| `Status = Waiting Report` lainnya | *Waiting Report* |
| lainnya | *Planned* / *Finished* / *Cancelled* sesuai `Status` |

Kolom tab Jadwal: Schedule ID (`Title`), Tanggal, Waktu, Brand & platform, Akun (`AccountName`), Studio,
Status, Clock in. Tab Kehadiran membaca jam dari `CheckInTime`/`CheckOutTime`, kalau kosong dari
`ClockInTime`/`ClockOutTime` (date-time atau teks jam) — jadi keduanya harus ada di `ClockInJson`.
Tab Report butuh `ScheduleID` dan `Playbook: Playbook.Value` di `ReportsJson`; kalau kolom *Schedule ID* /
*Playbook* kosong, hampir selalu karena field itu tidak ikut di `ForAll`.

**OnChange**

```powerfx
If(!IsBlank(Self.ActionPayload),
    With({req: ParseJSON(Self.ActionPayload)},
        With({act: Text(req.action), rid: Text(req.requestId), p: req.payload},
            If(!(rid in colPbsProcessed.Id),
                Collect(colPbsProcessed, {Id: rid});
                Switch(act,
                    "BACK", Set(varHdReveal, ""); Back(),
                    "RELOAD", Refresh('Host - PBS Hub'); Set(varHdHost, LookUp('Host - PBS Hub', Title = varSelectedHostId)),
                    "NAV", Switch(Text(p.target),
                        "EDIT_HOST", Navigate(scrHostForm),
                        "SCORE_LEDGER", Navigate(scrCreditScore),
                        "SCHEDULE", Navigate(scrSchedule)),
                    "OPEN_SCHEDULE", Set(varSelectedScheduleId, Value(p.scheduleId)); Navigate(scrScheduleDetail),
                    "OPEN_REPORT", Set(varSelectedReportId, Value(p.reportId)); Navigate(scrReportDetail),
                    "OPEN_RUN", Set(varSelectedPayrollId, Value(p.runId)); Navigate(scrPayrollRunDetail),
                    "HIDE_PII", Set(varHdReveal, ""),
                    "ADD_CLOCK_IN",
                        With({d: DateValue(Text(p.clockInDate)), hid: Text(p.hostId)},
                            If(!IsBlank(LookUp('Clock In - PBS Hub', HostID = hid && ClockInDate = d)),
                                // Sudah ada clock in di tanggal itu (host clock in sendiri / admin lain).
                                Set(varHdResult, JSON({requestId: rid, status: "conflict", message: "Host ini sudah punya clock in di " & Text(d, "dd mmm yyyy") & "."}, JSONFormat.Compact)),
                                IfError(
                                    Set(varNewClockIn, Patch('Clock In - PBS Hub', Defaults('Clock In - PBS Hub'), {
                                        HostID: hid,
                                        HostName: Text(p.hostName),
                                        ClockInDate: d,
                                        ClockInTime: Text(p.clockInTime),     // "HH:mm"
                                        ClockOutTime: Text(p.clockOutTime),
                                        Status: {Value: Text(p.status)},
                                        HKTugas: Value(p.hkTugas)
                                    }));
                                    Patch('Clock In - PBS Hub', varNewClockIn, {Title: "CLK-" & Text(varNewClockIn.ID, "0000")});
                                    Collect(colHdClockIn, varNewClockIn);        // tanggal ini hilang dari pilihan
                                    Set(varHdResult, JSON({requestId: rid, status: "ok",
                                        message: "Clock in tersimpan: CLK-" & Text(varNewClockIn.ID, "0000") & " · " & Text(d, "dd mmm yyyy") & " " & Text(p.clockInTime) & "–" & Text(p.clockOutTime) & " · HKTugas Rp " & Text(Value(p.hkTugas), "#,##0")}, JSONFormat.Compact));
                                    Set(varNewClockIn, Blank()),
                                    Set(varHdResult, JSON({requestId: rid, status: "error", message: "Gagal menyimpan clock in: " & FirstError.Message}, JSONFormat.Compact))
                                )
                            )
                        ),
                    "ADJUST_CLOCK_IN",
                        With({cur: LookUp('Clock In - PBS Hub', ID = Value(p.clockInId))},
                            If(IsBlank(cur) || (!IsBlank(Text(p.expectedModified)) && Text(cur.Modified, DateTimeFormat.UTC) <> Text(DateTimeValue(Text(p.expectedModified)), DateTimeFormat.UTC)),
                                Set(varHdResult, JSON({requestId: rid, status: "conflict", message: "Baris clock in ini sudah diubah orang lain. Muat ulang lalu coba lagi."}, JSONFormat.Compact)),
                                IfError(
                                    Patch('Clock In - PBS Hub', cur,
                                        // Baris GeoAttendance memakai CheckInTime/CheckOutTime (DateTime); baris manual memakai ClockInTime/ClockOutTime (teks).
                                        If(Boolean(p.manualRow),
                                            {ClockInTime: Text(p.clockInTime), ClockOutTime: Text(p.clockOutTime)},
                                            {CheckInTime: DateTimeValue(Text(p.checkInAt)),
                                             CheckOutTime: If(IsBlank(Text(p.checkOutAt)), Blank(), DateTimeValue(Text(p.checkOutAt)))}),
                                        {
                                            Status: {Value: Text(p.status)},
                                            HKTugas: Value(p.hkTugas),
                                            Tier: If(IsBlank(Text(p.tier)), Blank(), {Value: Text(p.tier)}),   // kolom Text: Text(p.tier)
                                            Insentif: Value(p.insentif),
                                            Streak: Value(p.streak),
                                            AdjustedBy: User().FullName,           // kolom opsional untuk audit
                                            AdjustedAt: Now(),
                                            AdjustReason: Text(p.reason)
                                        }
                                    );
                                    ClearCollect(colHdClockIn, Filter('Clock In - PBS Hub', HostID = varSelectedHostId, ClockInDate >= varHdFrom));
                                    Set(varHdResult, JSON({requestId: rid, status: "ok",
                                        message: "Kehadiran " & Text(DateValue(Text(p.clockInDate)), "dd mmm yyyy") & " disesuaikan · total Rp " & Text(Value(p.totalBefore), "#,##0") & " → Rp " & Text(Value(p.totalAfter), "#,##0")}, JSONFormat.Compact)),
                                    Set(varHdResult, JSON({requestId: rid, status: "error", message: "Gagal menyimpan: " & FirstError.Message}, JSONFormat.Compact))
                                )
                            )
                        ),
                    "REVEAL_PII",
                        With({f: Text(p.field)},
                            If(userRole.Value <> "PBS_Team",
                                Set(varHdResult, JSON({requestId: rid, status: "error", message: "Tidak punya izin membuka data pribadi."}, JSONFormat.Compact)),
                            With({log: IfError(Patch('Host PII Access Log', Defaults('Host PII Access Log'), {Title: rid, HostID: varSelectedHostId, Field: f, ViewedBy: User().Email, ViewedAt: Now()}), Blank())},
                                If(IsBlank(log),
                                    Set(varHdResult, JSON({requestId: rid, status: "error", message: "Log akses gagal ditulis, data tidak dibuka."}, JSONFormat.Compact)),
                                    Set(varHdReveal, JSON({hostId: varSelectedHostId, field: f, value: Switch(f,
                                        "KTP", varHdHost.KTP, "NoRekening", varHdHost.NoRekening, "NamaRekening", varHdHost.NamaRekening,
                                        "Alamat", varHdHost.Alamat, "PhoneNumber", varHdHost.PhoneNumber, "PersonalEmail", varHdHost.PersonalEmail)}, JSONFormat.Compact));
                                    Set(varHdResult, JSON({requestId: rid, status: "ok"}, JSONFormat.Compact))
                                )
                            ))
                        ),
                    "SET_HOST_STATUS",
                        With({cur: LookUp('Host - PBS Hub', ID = Value(p.id))},
                            If(Text(cur.Modified, DateTimeFormat.UTC) <> Text(DateTimeValue(Text(p.expectedModified)), DateTimeFormat.UTC),
                                Set(varHdResult, JSON({requestId: rid, status: "conflict", decidedBy: cur.'Modified By'.DisplayName, decidedAt: cur.Modified}, JSONFormat.Compact)),
                                IfError(
                                    Patch('Host - PBS Hub', cur, {Status: {Value: Text(p.status)}});
                                    Set(varHdHost, LookUp('Host - PBS Hub', ID = Value(p.id)));
                                    Set(varHdResult, JSON({requestId: rid, status: "ok", message: "Status host disimpan."}, JSONFormat.Compact)),
                                    Set(varHdResult, JSON({requestId: rid, status: "error", message: FirstError.Message}, JSONFormat.Compact))
                                )
                            )
                        )
                )
            )
        )
    )
)
```

Aksi yang **mengunci** dan wajib dibalas: `REVEAL_PII` (`{hostId, id, field}`; `field` salah satu
`KTP | NoRekening | NamaRekening | Alamat | PhoneNumber | PersonalEmail`) dan `SET_HOST_STATUS`
(`{hostId, id, status: "Inactive"|"Active", reason, effectiveDate, expectedModified, upcomingSchedules}`).
`reason` wajib saat menonaktifkan; simpan ke kolom catatan kalau ada, atau ke list log. `upcomingSchedules`
= jadwal mendatang yang perlu dialihkan ke host lain. Lainnya (`BACK`, `RELOAD`, `NAV`, `OPEN_SCHEDULE`,
`OPEN_REPORT`, `OPEN_RUN`, `HIDE_PII`) tidak mengunci.

`ADD_CLOCK_IN` sama dengan di HostList (lihat di atas); tombol *Clock in* di header menampilkan jumlah jadwal
yang belum ada clock in-nya.

**Tab Kehadiran (edit clock in, tier, weekly).** Satu baris per hari dari `Clock In - PBS Hub`: jam masuk/keluar,
durasi, status (HKTugas), Tier + Insentif, Weekly (`Streak`) dan total — semuanya kolom di baris Clock In itu,
yang dijumlahkan flow payroll per host per bulan. Tombol **Edit** membuka form: jam clock in/out (clock out lebih
awal dari clock in = hari berikutnya), status kehadiran, tier (insentif **mengikuti tier**, tidak diketik: Tier 1 = Rp75.000,
Tier 2 = Rp65.000, Tier 3 = Rp55.000, tanpa tier = Rp0), weekly (centang + nominal) dan **alasan wajib**. Form menampilkan ringkasan perubahan dan total hari itu
sebelum → sesudah.

`ADJUST_CLOCK_IN` **mengunci**. Payload: `{clockInId, title, hostId, hostName, clockInDate, clockInTime,
clockOutTime ("HH:mm"), checkInAt, checkOutAt ("yyyy-mm-ddThh:mm:ss", lokal), manualRow, status, hkTugas,
tier ("Tier 1".."Tier 3" | ""), insentif, streak, totalBefore, totalAfter, reason, changes: [{field, from, to}],
expectedModified, payrollRun: {id, title, phase} | null}`.

- Rate card tier: default 75.000 / 65.000 / 55.000 / 0. Kalau nanti berubah, isi `config.tierRates: {tier1, tier2, tier3}`
  di Context. Weekly memakai `config.weeklyBonus`, tanpa itu nominal weekly yang paling sering di data.
- Baris yang `Insentif`-nya tidak sama dengan rate tier-nya ditandai **Insentif ≠ tier** di tabel; membuka Edit
  langsung menampilkan koreksinya di ringkasan perubahan.
- Kalau bulan kehadiran itu sudah dipakai run payroll, form menampilkan peringatan: run masih approval →
  perubahan ikut kalau run disusun ulang; run sudah **Done** → slip tidak berubah, selisih dikoreksi manual.
- Audit: tambahkan kolom opsional `AdjustedBy` (Text), `AdjustedAt` (DateTime), `AdjustReason` (Note) di
  `Clock In - PBS Hub`. Baris yang terisi ditandai *Disesuaikan* di tab. Tanpa kolom itu, hapus tiga field
  tersebut dari Patch dan simpan `p.changes` + `p.reason` ke list log.
- `varHdFrom` di OnVisible menentukan bulan yang bisa dipilih (default bulan lalu + bulan ini).

Tab *Payroll* hanya untuk `PAYROLL_VIEW`, tab *Data pribadi* hanya untuk `HOST_PII_VIEW`, tombol *Edit* /
*Nonaktifkan* hanya untuk `HOST_EDIT`, tombol *Clock in* dan *Edit* di tab Kehadiran hanya untuk `HOST_CLOCKIN`. Tab Kehadiran tampil untuk `HOST_CLOCKIN`
atau `PAYROLL_VIEW`.

## 9. Alasan (kolom *Alasan* di antrean)

Dihitung di control dari Report + Report Automation, urutan prioritas:

| Alasan | Kondisi |
|---|---|
| Bukti belum ada | tidak ada baris Report Automation yang ter-join |
| Bukti yatim | bukti ter-join tapi `HostID`/`ScheduleID`/`AccountID`/`BrandID` berbeda (M6) |
| Metrik kosong | salah satu metrik kosong di bukti (7 metrik inti selalu; 5 metrik tambahan bila klaim atau bukti berisi nilai) |
| Nol lawan nol | ketujuh metrik inti 0 di klaim dan bukti (M4), meskipun durasi/viewer terisi |
| Confidence rendah | kolom `Confidence` ada dan < `confidenceThreshold` |
| Di luar toleransi | ada metrik di luar `bukti × (1 ± 5 %)`, rumus sama dengan PBS0005A |
| Semua cocok | semua metrik dalam toleransi (menunggu karena flow belum memutuskan) |

Bulk approve hanya bisa untuk **Confidence rendah** yang semua metriknya cocok. Selama kolom `Confidence`
belum ada di v1, bulk approve tidak akan muncul — itu disengaja.

## 10. Pemasangan

1. Power Platform admin center → environment → **Settings → Product → Features** → aktifkan
   *Allow publishing of canvas apps with code components*.
2. make.powerapps.com → **Solutions → Import solution** → `PBSHubOpsPCF_1_6_3_0_managed.zip`
   (sudah pernah import versi lama? Import ini meng-**upgrade** solusi yang sama — pilih *Upgrade*, bukan
   *Stage for upgrade* yang belum di-*Apply*).
3. Di canvas app: **Insert → Get more components → Code** → pilih `PBS Ops Dashboard`,
   `PBS Ops Report Review`, `PBS Ops Report Detail`, `PBS Ops Payroll Runs`, `PBS Ops Payroll Run Detail`,
   `PBS Ops Host List`, `PBS Ops Host Detail`.
4. Taruh tiap control di layar masing-masing (ukuran = area konten di samping sidebar), isi properti
   sesuai bagian 4–8.

**Control di app tidak berubah setelah import?** Canvas app menyimpan salinan code component saat
disisipkan. Setelah upgrade solusi: buka app di Studio → akan muncul banner *"Updated code components
detected"* → **Update**. Kalau banner tidak muncul: tutup Studio, hard refresh browser (Ctrl+Shift+R), buka
lagi. Lalu **Save + Publish** app. Pastikan juga di Solutions → PBS Hub Ops PCF → History bahwa versi
1.6.3.0 benar-benar terpasang. Versi control di solusi ini: Dashboard 1.3.4, ReportReview / ReportDetail
1.4.3, PayrollRuns 1.2.5, PayrollRunDetail 1.2.4, HostList 1.2.6, HostDetail 1.3.7. ReportReview dan
ReportDetail 1.4.0 punya properti baru `SchedulesJson` — isi di canvas supaya kolom *Jam live* terisi.

**Tampilan rusak di app (tabel tidak full, tombol tanpa border, checkbox hilang)?** Itu CSS global Power
Apps player yang menimpa style control. Sejak 1.3.0 setiap control dirender di dalam Shadow DOM sehingga
CSS host tidak bisa masuk; cukup *Update code components* ke versi terbaru.

Update: naikkan `version` di setiap `ControlManifest.Input.xml` yang bundelnya berubah **dan** `Version` di
`solution/PBSHubOpsPCF/src/Other/Solution.xml`, lalu `npm run release`. Managed solution hanya bisa
di-upgrade dengan versi yang lebih tinggi, dan canvas hanya menawarkan *Update* kalau versi control naik.
