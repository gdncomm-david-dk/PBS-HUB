# Integrasi canvas — PBS Hub Ops PCF

Tiga code component di solusi `PBSHubOpsPCF` (managed):

| Control | Layar desain | Fungsi |
|---|---|---|
| `pbs_Ops.Dashboard` | Ops Console 3a/3b (D-1) | Antrean yang menunggu tim hari ini. Read-only, hanya emit `NAV`. |
| `pbs_Ops.ReportReview` | Ops Console 4a (R-1) | Daftar report + antrean rekonsiliasi, urut umur, kolom **Alasan**, bulk approve terbatas. |
| `pbs_Ops.ReportDetail` | Ops Console 4b/4c/4d (R-2) | Detail report: klaim host vs bukti AI vs selisih, Setujui / Perlu revisi / Eskalasi. |

Semua control hanya merender **isi modul** (judul, filter, tabel, kartu). Header dan sidebar tetap dari
app (`BlibliUniversalSidebar`).

## 1. Aturan kontrak (berlaku untuk ketiganya)

- **Control tidak pernah menulis ke SharePoint.** Tombol mengirim `ActionPayload` (JSON teks):
  `{"action":"APPROVE","requestId":"rd-…","payload":{…}}`. Canvas menulis di `OnChange`, lalu membalas
  lewat properti `ActionResult`: `{"requestId":"…","status":"ok"|"error"|"conflict","message":"…"}`.
- Control mengunci tombol sampai `requestId` yang sama kembali. Tanpa balasan, tombol tetap terkunci —
  **setiap cabang `OnChange` wajib men-set `ActionResult`**, termasuk saat error (`IfError`).
- Aksi navigasi/informasi (`NAV`, `OPEN_REPORT`, `BACK`, `RELOAD`, `OPEN_EVIDENCE`, `LOAD_MORE`,
  `FILTER_CHANGED`) tidak mengunci dan tidak perlu dibalas.
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
                pageSize: 50
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
| `Penjualan`, `Pesanan`, `ProdukTerjual`, `JumlahPembeli`, `CTR`, `CTOR`, `PeakViewer` | idem | **7 metrik yang dibandingkan PBS0005A** |
| `DurasiMin`, `AddToCart`, `TotalViewer`, `Comment`, `Share` | `Durasi(Min)`, … | strip "Tidak dibandingkan" (M1) |
| `ApprovalStatus`, `Match` | Choice | tab & status (`Waiting Approval`/kosong = menunggu, `Need Revision` = perlu revisi, `Done` = selesai; komentar `Automated…` = otomatis) |
| `ApprovalComment`, `Approver`, `ApproverEmail` | idem | ringkasan keputusan, banner "sudah diputuskan oleh…" |
| `Attachment` | Attachment (Note, URL) | fallback URL screenshot |
| `Created`, `Modified` | sistem | umur antrean, "diputuskan X menit lalu" |

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
| `SchedulesJson` | `Schedule - PBS Hub` | `ID, Title, Date (yyyy-mm-dd), StartTime, EndTime, JamLive, BrandID, HostID, StudioID, Platform, Status` |
| `ClockInJson` | `Clock In - PBS Hub` | `HostID, ClockInDate, CheckInTime, CheckOutTime, ClockOutTime, IsInsideGeofence, Streak` |
| `HostsJson` | `Host - PBS Hub` | `Title, NamaHost, Status, HasRekening` (**bukan** NoRekening) |
| `StudiosJson` | `Studio - PBS Hub` | `Title, NamaStudio, KapasitasHost, Status` |
| `BrandsJson` | `Brand - PBS Hub` | `Title, NamaBrand` |
| `PayrollJson` | `Payroll - PBS Hub` | `ID, Title, Periode, Status, Created` |

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
    ClearCollect(colDashReport, Filter('Report - PBS Hub', LiveDate >= DateAdd(Today(), -35) || ApprovalStatus.Value = "Waiting Approval")),
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
SchedulesJson = JSON(ForAll(colDashSchedule, {ID: ID, Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime, JamLive: JamLive, BrandID: BrandID, HostID: HostID, StudioID: StudioID, Platform: Platform.Value, Status: Status.Value}), JSONFormat.Compact)
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
ReportsJson  = JSON(ForAll(colRrReport, {ID: ID, Title: Title, ScheduleID: ScheduleID, HostID: HostID, BrandID: BrandID, AccountID: AccountID, Account: Account, Platform: Platform.Value, LiveDate: Text(LiveDate, "yyyy-mm-dd"), Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual, JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer, ApprovalStatus: ApprovalStatus.Value, Match: Match.Value, ApprovalComment: ApprovalComment, ApproverEmail: ApproverEmail, Created: Created, Modified: Modified}), JSONFormat.Compact)
EvidenceJson = JSON(ForAll(colRrEvidence, {ID: ID, Title: Title, HostID: HostID, ScheduleID: ScheduleID, AccountID: AccountID, Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual, JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer, Status: Status.Value, Created: Created}), JSONFormat.Compact)
HostsJson    = JSON(ForAll('Host - PBS Hub', {Title: Title, NamaHost: NamaHost}), JSONFormat.Compact)
BrandsJson   = JSON(ForAll('Brand - PBS Hub', {Title: Title, NamaBrand: NamaBrand}), JSONFormat.Compact)
```

**OnChange**

```powerfx
If(!IsBlank(Self.ActionPayload),
    With({req: ParseJSON(Self.ActionPayload)},
        With({act: Text(req.action), rid: Text(req.requestId), p: req.payload},
            If(!(rid in colPbsProcessed.Id),
                Collect(colPbsProcessed, {Id: rid});
                Switch(act,
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
                                    If(cur.ApprovalStatus.Value = "Waiting Approval" || IsBlank(cur.ApprovalStatus.Value),
                                        Patch('Report - PBS Hub', cur, {
                                            ApprovalStatus: {Value: "Done"}, Match: {Value: "Match"},
                                            ApprovalComment: Text(p.comment), ApproverEmail: User().Email
                                        });
                                        If(!IsBlank(Text(it.evidenceId)),
                                            Patch('Report Automation - PBS Hub', LookUp('Report Automation - PBS Hub', ID = Value(it.evidenceId)), {Status: {Value: "Match"}}))
                                    )
                                )
                            );
                            Refresh('Report - PBS Hub');
                            ClearCollect(colRrReport, FirstN(Sort('Report - PBS Hub', ID, SortOrder.Descending), varRrTop));
                            Set(varRrResult, JSON({requestId: rid, status: "ok", message: CountRows(Table(p.items)) & " report disetujui."}, JSONFormat.Compact)),
                            Set(varRrResult, JSON({requestId: rid, status: "error", message: "Bulk approve gagal: " & FirstError.Message}, JSONFormat.Compact))
                        ),
                    "FILTER_CHANGED", false
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
ReportJson   = JSON(ForAll(Filter('Report - PBS Hub', ID = varSelectedReportId), {ID: ID, Title: Title, ScheduleID: ScheduleID, HostID: HostID, BrandID: BrandID, AccountID: AccountID, Account: Account, Platform: Platform.Value, LiveDate: Text(LiveDate, "yyyy-mm-dd"), Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual, JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)', AddToCart: AddToCart, TotalViewer: TotalViewer, Comment: Comment, Share: Share, ApprovalStatus: ApprovalStatus.Value, Match: Match.Value, ApprovalComment: ApprovalComment, Approver: Approver.DisplayName, ApproverEmail: ApproverEmail, Attachment: Attachment, Created: Created, Modified: Modified}), JSONFormat.Compact)
EvidenceJson = JSON(ForAll(Filter('Report Automation - PBS Hub', Title = LookUp('Report - PBS Hub', ID = varSelectedReportId).Title), {ID: ID, Title: Title, HostID: HostID, ScheduleID: ScheduleID, AccountID: AccountID, Platform: Platform.Value, Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual, JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)', AddToCart: AddToCart, TotalViewer: TotalViewer, Comment: Comment, Share: Share, Status: Status.Value, Attachment: Attachment, Created: Created}), JSONFormat.Compact)
HostsJson    = JSON(ForAll(Filter('Host - PBS Hub', Title = LookUp('Report - PBS Hub', ID = varSelectedReportId).HostID), {Title: Title, NamaHost: NamaHost}), JSONFormat.Compact)
BrandsJson   = JSON(ForAll('Brand - PBS Hub', {Title: Title, NamaBrand: NamaBrand}), JSONFormat.Compact)
```

**Payload keputusan** (semua berisi `reportId`, `title`, `evidenceId`, `evidenceTitle`, `expectedModified`,
`approverEmail`, `approverName`, `reason`):

| Aksi | `approvalStatus` | `match` | `comment` |
|---|---|---|---|
| `APPROVE` | `Done` | `Match` | komentar reviewer |
| `APPROVE_WITHOUT_EVIDENCE` | `Done` | kosong (jangan diubah) | `[Tanpa bukti] …` (wajib diisi) |
| `REQUEST_REVISION` | `Need Revision` | `Unmatch` | catatan + `Metrik yang perlu dibetulkan: …`; `flaggedMetrics: ["Penjualan","CTOR"]` |
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
                            !(cur.ApprovalStatus.Value = "Waiting Approval" || IsBlank(cur.ApprovalStatus.Value)),
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
                                If(!IsBlank(Text(p.evidenceId)) && !IsBlank(Text(p.match)),
                                    Patch('Report Automation - PBS Hub',
                                        LookUp('Report Automation - PBS Hub', ID = Value(p.evidenceId)),
                                        {Status: {Value: Text(p.match)}}));
                                Refresh('Report - PBS Hub');
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

Tiga sifat yang harus dipertahankan:

1. `colPbsProcessed` membuat replay aman — `requestId` yang sama tidak diproses dua kali.
2. `IfError` membungkus tulis. Patch gagal menghasilkan `status: "error"`, tidak pernah melaporkan sukses
   (defect v1 di `ScreenPayroll.pa.yaml:4437`).
3. Cek status sebelum tulis menutup race R2 (flow PBS0005A / reviewer lain / host menulis kolom yang sama).

## 7. Alasan (kolom *Alasan* di antrean)

Dihitung di control dari Report + Report Automation, urutan prioritas:

| Alasan | Kondisi |
|---|---|
| Bukti belum ada | tidak ada baris Report Automation yang ter-join |
| Bukti yatim | bukti ter-join tapi `HostID`/`ScheduleID`/`AccountID`/`BrandID` berbeda (M6) |
| Metrik kosong | salah satu dari 7 metrik kosong di bukti |
| Nol lawan nol | ketujuh metrik 0 di klaim dan bukti (M4) |
| Confidence rendah | kolom `Confidence` ada dan < `confidenceThreshold` |
| Di luar toleransi | ada metrik di luar `bukti × (1 ± 5 %)`, rumus sama dengan PBS0005A |
| Semua cocok | ketujuh metrik dalam toleransi (menunggu karena flow belum memutuskan) |

Bulk approve hanya bisa untuk **Confidence rendah** yang ketujuh metriknya cocok. Selama kolom `Confidence`
belum ada di v1, bulk approve tidak akan muncul — itu disengaja.

## 8. Pemasangan

1. Power Platform admin center → environment → **Settings → Product → Features** → aktifkan
   *Allow publishing of canvas apps with code components*.
2. make.powerapps.com → **Solutions → Import solution** → `PBSHubOpsPCF_1_0_0_0_managed.zip`.
3. Di canvas app: **Insert → Get more components → Code** → pilih `PBS Ops Dashboard`,
   `PBS Ops Report Review`, `PBS Ops Report Detail`.
4. Taruh tiap control di layar masing-masing (ukuran = area konten di samping sidebar), isi properti
   sesuai bagian 4–6.

Update: naikkan `version` di ketiga `ControlManifest.Input.xml` **dan** `Version` di
`solution/PBSHubOpsPCF/src/Other/Solution.xml`, lalu `npm run release`. Managed solution hanya bisa
di-upgrade dengan versi yang lebih tinggi.
