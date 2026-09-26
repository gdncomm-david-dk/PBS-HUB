# Report host dari nol — panduan canvas langkah demi langkah

Panduan ini khusus alur **report** di app host: dari host absen sampai report selesai direview. Ikuti urutannya
dari atas ke bawah. Rujukan lengkap semua control ada di [`HOST-CANVAS-INTEGRATION.md`](HOST-CANVAS-INTEGRATION.md);
di sini semua formula yang dibutuhkan untuk report ditulis utuh, tanpa `…`.

## R1. Gambaran alur

```text
 Jadwal (Schedule)        Host Absence           Report                      Ops Console
 ───────────────────      ────────────           ──────                      ───────────
 Status = Planned
        │  host clock in (ClockIn)
        ▼
 host klik Absen ──► pop-up "Live Break?" ──► baris ABS-… dibuat
        │                                        │
        ├─ Tidak (live biasa) ─► Status = Waiting Report
        │         │
        │         ▼  host klik Send Report (isi Live ID, Durasi, Playbook, angka, screenshot)
        │      baris REP-… dibuat, ApprovalStatus = Waiting Approval
        │         │
        │         ├─ total Durasi < durasi jadwal ─► Status tetap Waiting Report
        │         │                                  ("kurang X menit", Send Report berikutnya)
        │         └─ total Durasi ≥ durasi jadwal ─► Status = Done (tombol Send Report hilang)
        │                                                  │
        │                                                  ▼  reviewer Ops
        │                                    Done / Need Revision ──► host revisi ──► Waiting Approval Revision
        │
        ├─ Ya (Live Break) ─► Status = Done, LiveBreak = Yes, baris REP-… semua angka 0, ApprovalStatus = LiveBreak
        │
        └─ Position = Co-Host (tidak ditanya) ─► Status = Done, tanpa report
```

Yang perlu diingat:

1. **Control tidak pernah menulis ke SharePoint.** Setiap tombol hanya mengirim teks JSON lewat output
   `ActionPayload`. Formula **OnChange** control di canvas-lah yang membaca JSON itu, melakukan `Patch`, lalu
   membalas lewat variabel yang dipasang ke properti `ActionResult`.
2. Tombol yang "mengunci" (Absen, Send Report, Kirim revisi, Sanggah) memutar spinner sampai canvas membalas.
   Kalau tidak pernah dibalas, tombol berputar terus — tanda OnChange belum terpasang.
3. Semua angka sisa menit, status berikutnya (`Waiting Report` / `Done`) dan validasi form **dihitung control**.
   Canvas tinggal menulis nilai yang ada di payload.

## R2. Siapkan kolom SharePoint

Cek dulu list berikut. Kolom bertanda **baru** mungkin belum ada di list v1.

**`Schedule - PBS Hub`**

| Kolom | Tipe | Isi |
|---|---|---|
| `Status` | Choice | minimal: `Planned`, `Waiting Report`, `Done` (plus nilai lain yang sudah dipakai, mis. `Cancelled`) — **tambahkan `Waiting Report` kalau belum ada** |
| `LiveBreak` | Choice `Yes` / `No` | `Yes` kalau sesi Live Break; kosong dianggap `No` |
| `Account` | teks | kode akun = `Title` di list Account. Schedule **tidak** punya AccountName: nama akun di-lookup dari list Account (kolom `AccountName`) |
| `Position` | Choice | `Host`, `Co-Host` |
| `StartTime`, `EndTime` | teks `HH:mm` atau Date and Time | dipakai menghitung durasi jadwal (menit) |

**`Report - PBS Hub`**

| Kolom | Tipe | Isi |
|---|---|---|
| `Title` | teks | `REP-{ID}` (diisi canvas setelah baris dibuat) |
| `ScheduleID`, `HostID`, `BrandID`, `AccountID`, `AbsID` | teks | dari jadwal / absen; `AccountID` = kode akun (`Schedule.Account`) |
| `Account` | Lookup ke list Account (atau Choice) | ditulis sebagai record: `LookUp(Choices([@'Report - PBS Hub'].Account), Value = kode \|\| Value = nama)`; dibaca `Account.Value`. Sama untuk `Account` di Host Absence |
| `Platform` | Choice | disalin dari Schedule |
| `LiveDate` | Date | tanggal sesi |
| `LiveID` **baru** | Single line of text | ID live dari Seller Center; unik per sesi |
| `Playbook` | Choice | mis. `Flash Sale`, `Payday`, `Launching Produk`, `Reguler` |
| `Durasi(Min)`, `AddToCart`, `Pesanan`, `Penjualan`, `ProdukTerjual`, `JumlahPembeli`, `CTR`, `PeakViewer`, `TotalViewer`, `CTOR`, `Comment` | Number | angka dari Seller Center; `AddToCart` hanya diisi untuk Shopee |
| `ApprovalStatus` | Choice | `Waiting Approval`, `Waiting Approval Revision`, `Need Revision`, `Done`, `LiveBreak` — **tambahkan `LiveBreak` kalau belum ada** |
| `ApprovalComment` | Multiple lines | catatan reviewer / revisi host |
| `Attachment` | teks / hyperlink | URL screenshot dari flow |

`Share` tidak dipakai lagi oleh host (boleh tetap ada di list).

> Nama kolom di formula adalah **display name**. Kalau di list kamu namanya lain (mis. `Live ID` dengan spasi),
> ganti di formula menjadi `'Live ID'`.

## R3. Buat flow upload screenshot

Screenshot tidak dikirim di `ActionPayload`, tapi lewat output kedua control, **`UploadData`** (base64 JPEG yang
sudah dikecilkan). Canvas meneruskannya ke flow.

1. Power Automate → **Create → Instant cloud flow** → trigger **Power Apps (V2)**. Nama: `PBS Host - Upload report screenshot`.
2. Di trigger tambahkan dua input **Text**: `fileName` lalu `fileBase64` (urutan ini penting).
3. **+ New step → SharePoint → Create file**
   - Site Address: site PBS Hub (`StudioTeamBlibli`)
   - Folder Path: `/PBS Power Apps/Report Automation`
   - File Name: `fileName` (dynamic content dari trigger)
   - File Content: expression `base64ToBinary(triggerBody()?['text_1'])`
     (`text_1` = input Text kedua; kalau di trigger kamu namanya lain, lihat *Peek code* di trigger)
4. **+ New step → Power Apps → Respond to a PowerApp or flow** → output **Text** bernama `url`, isi
   `Path` dari Create file (atau link absolut ke file).
5. Save. Di Power Apps Studio: panel **Power Automate** → **Add flow** → pilih flow ini. Namanya di formula menjadi
   `'PBSHost-Uploadreportscreenshot'` (Studio menghapus spasi dan tanda baca). Kalau beda, ganti di semua formula.

Nama file disusun control: `REP-{ID}_Platform_AccountID.jpg`. `{ID}` diganti canvas dengan ID baris Report yang baru
dibuat, jadi flow AI yang membaca folder itu tetap bisa mencocokkan bukti dengan report.

## R4. App.OnStart

```powerfx
Set(varHostCtx, JSON({
    userEmail: User().Email,
    userName: User().FullName,
    roles: "HOST",
    permissions: "",
    config: {
        requireAbsen: true,                     // report baru bisa setelah absen
        requireWaitingStatus: true,             // report hanya saat Schedule.Status = Waiting Report
        scheduleWaitingStatus: "Waiting Report",// nilai Choice Status di list Schedule
        scheduleDoneStatus: "Done",
        absenLeadMin: 30,
        reportDeadlineDays: 2,
        maxShiftHours: 12,
        tolerancePct: 5,
        imageMaxPx: 2000,
        imageMaxKb: 1200
    }
}, JSONFormat.Compact));
Set(varMe, LookUp('Host - PBS Hub', Email.Email = User().Email));
ClearCollect(colPbsProcessed, {Id: ""});        // requestId yang sudah diproses (anti dobel)
// Nama akun: Schedule.Account = Title di list Account → ambil AccountName (teks). Sesuaikan nama list kalau beda.
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

Kalau nilai Choice di list kamu bukan `Waiting Report` / `Done`, ganti `scheduleWaitingStatus` /
`scheduleDoneStatus` **dan** teks `"Waiting Report"` di formula `SUBMIT_REPORT` (R6).

## R5. Layar yang dipakai untuk report

| Layar | Control | Dipakai untuk | Variabel navigasi |
|---|---|---|---|
| `scrScheduleDetail` | `pbs_HostApp.ScheduleDetail` | **tempat utama**: Absen, Send Report, report berikutnya, revisi | `varSchId` (Title jadwal), `varSchDate` (tanggal) |
| `scrMyReportDetail` | `pbs_HostApp.MyReportDetail` | kirim / revisi / lihat satu report (dibuka dari *Report saya* atau *Hari ini*) | `varRptSchedule` (Title jadwal), `varRptId` (ID report, kosong = report baru) |
| `scrMyReports` | `pbs_HostApp.MyReports` | daftar report sebulan; tombol membuka `scrMyReportDetail` | `varMrPeriod`, `varMrFilter` |

Cukup pasang **ScheduleDetail** dulu kalau ingin mulai kecil: semua alur report bisa dijalankan dari situ.

### Bentuk record yang dipakai berulang

Semua properti `…Json` di bawah memakai bentuk record ini. Salin apa adanya.

**Schedule**
```powerfx
{ID: ID, Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime,
 BrandID: BrandID, StudioID: StudioID, HostID: HostID, Platform: Platform.Value, AccountID: Account,
 AccountName: With({a: Account}, LookUp(colAccounts, Title = a).AccountName), LiveBreak: Coalesce(LiveBreak.Value, "No"), Position: Position.Value, Status: Status.Value}
```

**Report**
```powerfx
{ID: ID, Title: Title, ScheduleID: ScheduleID, HostID: HostID, BrandID: BrandID, AccountID: AccountID,
 Account: Account.Value, Platform: Platform.Value, LiveDate: Text(LiveDate, "yyyy-mm-dd"), LiveID: LiveID,
 Playbook: Playbook.Value, Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual,
 JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)',
 AddToCart: AddToCart, TotalViewer: TotalViewer, Comment: Comment, ApprovalStatus: ApprovalStatus.Value,
 ApprovalComment: ApprovalComment, Approver: Approver.DisplayName, ApproverEmail: ApproverEmail,
 Attachment: Attachment, Created: Created, Modified: Modified}
```

**Report Automation (bukti AI)**
```powerfx
{ID: ID, Title: Title, HostID: HostID, ScheduleID: ScheduleID, AccountID: AccountID, Platform: Platform.Value,
 Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual, JumlahPembeli: JumlahPembeli, CTR: CTR,
 CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)', AddToCart: AddToCart, TotalViewer: TotalViewer,
 Comment: Comment, Status: Status.Value, Attachment: Attachment, Created: Created}
```

**Clock In**: `{ID: ID, ClockInDate: Text(ClockInDate, "yyyy-mm-dd"), CheckInTime: CheckInTime, CheckOutTime: CheckOutTime, ClockInTime: ClockInTime, ClockOutTime: ClockOutTime, CheckInOffice: CheckInOffice}`

**Host Absence**: `{Title: Title, ScheduleID: ScheduleID, LiveDate: Text(LiveDate, "yyyy-mm-dd"), Status: Status.Value, Created: Created}`

Kolom yang tidak ada di list kamu (mis. `Approver`) hapus saja dari record — control mengabaikan field yang kosong.

Dua catatan untuk record Schedule: `AccountID` diisi dari kolom `Account`, dan `AccountName` di-lookup dari list
Account (`colAccounts`, dimuat di App.OnStart). `LiveBreak` adalah Choice, jadi dikirim `LiveBreak.Value`; kosong
dikirim `"No"`.

## R6. Layar Detail sesi (`scrScheduleDetail`)

**Cara membuka layar** (dari tombol / galeri mana pun):

```powerfx
Set(varSchId, "SCD-3313"); Set(varSchDate, DateValue("2026-09-13")); Navigate(scrScheduleDetail)
```

Control lain (HostDashboard, MySchedule) sudah melakukan ini lewat aksi `OPEN_SCHEDULE`.

**Screen.OnVisible**

```powerfx
Set(varSdLoading, true);
ClearCollect(colSdSch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date = varSchDate));
ClearCollect(colSdClk, Filter('Clock In - PBS Hub', HostID = varMe.Title, ClockInDate = varSchDate));
ClearCollect(colSdAbs, Filter('Host Absence - PBS Hub', HostID = varMe.Title, LiveDate = varSchDate));
ClearCollect(colSdRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate = varSchDate));
ClearCollect(colSdEvi, Filter('Report Automation - PBS Hub', Title in colSdRep.Title));
Set(varSdLoading, false);
```

**Properti control** (pilih control → panel kanan / formula bar):

| Properti | Formula |
|---|---|
| `Context` | `varHostCtx` |
| `ScheduleId` | `varSchId` |
| `HostJson` | `JSON(ForAll(Filter('Host - PBS Hub', Title = varMe.Title), {Title: Title, HostCode: HostCode, NamaHost: NamaHost}), JSONFormat.Compact)` |
| `SchedulesJson` | `JSON(ForAll(colSdSch, {` *record Schedule* `}), JSONFormat.Compact)` |
| `ClockInJson` | `JSON(ForAll(colSdClk, {` *record Clock In* `}), JSONFormat.Compact)` |
| `AbsenceJson` | `JSON(ForAll(colSdAbs, {` *record Host Absence* `}), JSONFormat.Compact)` |
| `ReportsJson` | `JSON(ForAll(colSdRep, {` *record Report* `}), JSONFormat.Compact)` |
| `EvidenceJson` | `JSON(ForAll(colSdEvi, {` *record Report Automation* `}), JSONFormat.Compact)` |
| `HistoryJson` | opsional, untuk peringatan *jauh di atas rata-rata kamu*: `JSON(ForAll(FirstN(SortByColumns(Filter('Report - PBS Hub', HostID = varMe.Title), "Created", SortOrder.Descending), 10), {` *record Report* `}), JSONFormat.Compact)` |
| `PlaybooksJson` | `JSON(Choices([@'Report - PBS Hub'].Playbook), JSONFormat.Compact)` |
| `BrandsJson` | `JSON(ForAll('Brand', {Title: Title, NamaBrand: NamaBrand}), JSONFormat.Compact)` |
| `StudiosJson` | `JSON(ForAll('Studio - PBS Hub', {Title: Title, NamaStudio: NamaStudio}), JSONFormat.Compact)` |
| `IsLoading` | `varSdLoading` |
| `ActionResult` | `varSdResult` |
| `OnChange` | formula lengkap di bagian **10.5** di [HOST-CANVAS-INTEGRATION.md](HOST-CANVAS-INTEGRATION.md) — salin utuh |

Contoh `SchedulesJson` yang sudah diisi (supaya tidak salah tempel):

```powerfx
JSON(ForAll(colSdSch, {ID: ID, Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime,
    BrandID: BrandID, StudioID: StudioID, HostID: HostID, Platform: Platform.Value, AccountID: Account,
    AccountName: With({a: Account}, LookUp(colAccounts, Title = a).AccountName), LiveBreak: Coalesce(LiveBreak.Value, "No"), Position: Position.Value, Status: Status.Value}), JSONFormat.Compact)
```

**Apa yang terjadi di OnChange per tombol** (sudah ada di formula 10.5, ini penjelasannya):

| Tombol di control | Aksi | Yang ditulis canvas |
|---|---|---|
| **Absen** → pilih *Tidak* | `ABSEN` `liveBreak: false` | Host Absence baru `ABS-{ID}`; `Schedule.Status = "Waiting Report"` |
| **Absen** → pilih *Ya, Live Break* | `ABSEN` `liveBreak: true` | Host Absence baru; `Schedule.Status = "Done"`, `LiveBreak = Yes`; Report baru `REP-{ID}` semua angka 0, `ApprovalStatus = LiveBreak` |
| **Absen** (Co-Host) | `ABSEN` tanpa pop-up | Host Absence baru; `Schedule.Status = "Done"` |
| **Send Report** | `SUBMIT_REPORT` | cek: absen ada, `Status = Waiting Report`, Live ID belum dipakai di sesi itu → Report baru `REP-{ID}` (`Waiting Approval`, `LiveID`, `Playbook`, angka) → flow upload → `Attachment` → `Schedule.Status = p.scheduleStatus` |
| **Kirim revisi** | `RESUBMIT_REPORT` | Report: angka, `LiveID`, `Playbook`, `ApprovalStatus = Waiting Approval Revision`, catatan di `ApprovalComment`; Report Automation `Status = Unmatch`; screenshot baru (opsional); `Schedule.Status = p.scheduleStatus` |
| **Saya rasa angka saya benar** (sanggah) | `DISPUTE_REVIEW` | `ApprovalComment` + `[Sanggahan host] …`, status tetap `Need Revision` |

Setiap cabang diakhiri `Set(varSdResult, JSON({requestId: rid, status: "ok" | "conflict" | "error", message: …}))`.
Itulah yang menghentikan spinner dan memunculkan pesan di control.

## R7. Layar Kirim / revisi report (`scrMyReportDetail`) — opsional

Dibuka dari *Report saya* dan *Hari ini* lewat aksi `NEW_REPORT` / `OPEN_REPORT` (formula navigasinya sudah ada di
OnChange layar-layar itu, bagian 10.1 dan 10.2).

**Screen.OnVisible**

```powerfx
Set(varMrdLoading, true);
With({rep: If(IsBlank(varRptId), Blank(), LookUp('Report - PBS Hub', ID = varRptId && HostID = varMe.Title))},
    Set(varMrdRep, rep);
    Set(varMrdSch, LookUp('Schedule - PBS Hub', Title = Coalesce(rep.ScheduleID, varRptSchedule) && HostID = varMe.Title))
);
ClearCollect(colMrdClk, Filter('Clock In - PBS Hub', HostID = varMe.Title, ClockInDate = varMrdSch.Date));
ClearCollect(colMrdAbs, Filter('Host Absence - PBS Hub', HostID = varMe.Title, ScheduleID = varMrdSch.Title));
ClearCollect(colMrdEvi, Filter('Report Automation - PBS Hub', Title = varMrdRep.Title));
ClearCollect(colMrdSesRep, Filter('Report - PBS Hub', HostID = varMe.Title, ScheduleID = varMrdSch.Title));
ClearCollect(colMrdHist, FirstN(SortByColumns(Filter('Report - PBS Hub', HostID = varMe.Title, Platform.Value = varMrdSch.Platform.Value), "Created", SortOrder.Descending), 10));
Set(varMrdLoading, false);
```

| Properti | Formula |
|---|---|
| `Context` | `varHostCtx` |
| `HostJson` | seperti R6 |
| `ReportJson` | `If(IsBlank(varMrdRep), "[]", JSON(ForAll(Table(varMrdRep), {` *record Report* `}), JSONFormat.Compact))` |
| `ScheduleJson` | `If(IsBlank(varMrdSch), "[]", JSON(ForAll(Table(varMrdSch), {` *record Schedule* `}), JSONFormat.Compact))` |
| `SessionReportsJson` | `JSON(ForAll(colMrdSesRep, {` *record Report* `}), JSONFormat.Compact)` — semua bagian report sesi ini, untuk menjumlah durasi |
| `EvidenceJson` | `JSON(ForAll(colMrdEvi, {` *record Report Automation* `}), JSONFormat.Compact)` |
| `ClockInJson`, `AbsenceJson` | dari `colMrdClk`, `colMrdAbs` dengan record R5 |
| `HistoryJson` | `JSON(ForAll(colMrdHist, {` *record Report* `}), JSONFormat.Compact)` |
| `PlaybooksJson` | `JSON(Choices([@'Report - PBS Hub'].Playbook), JSONFormat.Compact)` |
| `BrandsJson`, `StudiosJson` | seperti R6 |
| `IsLoading` / `ActionResult` | `varMrdLoading` / `varMrdResult` |
| `OnChange` | bagian **10.3** di [HOST-CANVAS-INTEGRATION.md](HOST-CANVAS-INTEGRATION.md) |

Mode dipilih otomatis: `ReportJson` kosong → form Send Report; report `Need Revision` → form revisi; selainnya →
tampilan baca saja. Selama durasi sesi belum terpenuhi, OnChange sengaja **tidak** mengisi `varMrdRep`, supaya form
tetap terbuka untuk *Send Report berikutnya*.

## R8. Tes satu per satu

Pakai satu jadwal tes milik akun kamu sendiri (HostID = `varMe.Title`), tanggal hari ini, durasi 120 menit
yang **sudah mulai** (mis. jam sekarang s.d. 2 jam lagi), platform Shopee, `Status = Planned`, `Position = Host`.
Clock in dulu lewat layar Clock in.

| # | Langkah | Yang harus terlihat di control | Yang harus ada di SharePoint |
|---|---|---|---|
| 1 | Buka Detail sesi sebelum absen | tombol Send Report nonaktif, keterangan *Absen sesi ini belum tercatat* | — |
| 2 | Klik **Absen** → *Tidak* → Absen | pesan *Absen tercatat*, Send Report aktif | Host Absence `ABS-…`; Schedule `Status = Waiting Report` |
| 3 | **Send Report**: Live ID `111`, Durasi `60`, isi semua angka + screenshot → kirim | *Report terkirim. Kurang 60 menit*, tombol jadi **Send Report berikutnya** | Report `REP-…` LiveID 111, Durasi 60, `Waiting Approval`, Attachment terisi; Schedule tetap `Waiting Report` |
| 4 | **Send Report berikutnya** dengan Live ID `111` lagi | ditolak: *Live ID sudah dipakai* | — |
| 5 | Live ID `222`, Durasi `60` → kirim | *Durasi sesi terpenuhi*, tombol Send Report hilang | Report kedua; Schedule `Status = Done` |
| 6 | Jadwal TikTok | kolom AddToCart tidak muncul | Report `AddToCart` kosong |
| 7 | Jadwal lain → Absen → *Ya, Live Break* | badge *Live Break · tanpa report* | Schedule `Done`, `LiveBreak = Yes`; Report angka 0, `ApprovalStatus = LiveBreak` |
| 8 | Jadwal dengan `Position = Co-Host` → Absen | tidak ada pop-up, tidak ada tombol Send Report | Schedule `Done`, tidak ada Report |
| 9 | Di Ops Console set report #3 ke `Need Revision`, lalu buka Detail sesi | form revisi muncul (angka, Live ID, Playbook, Durasi) | — |
| 10 | Ubah Durasi jadi `50` → Kirim revisi | *Revisi terkirim* | Report `Waiting Approval Revision`; Schedule kembali `Waiting Report` (total 110 < 120) |

## R9. Kalau ada yang tidak jalan

| Gejala | Penyebab paling sering | Perbaikan |
|---|---|---|
| Klik tombol, spinner berputar terus | OnChange belum dipasang, atau `ActionResult` tidak diisi `varSdResult` | pasang OnChange 10.5 utuh; cek properti `ActionResult` |
| *Name isn't valid. 'varMrPeriod' isn't recognized* (atau variabel `var…` lain) | variabel belum pernah di-`Set` di app | tempel blok inisialisasi variabel di App.OnStart (R4), lalu *Run OnStart* |
| *No type found for variable 'varMrdRep'* | variabel record hanya pernah di-`Set` ke `Blank()` | inisialisasi dengan `LookUp('Report - PBS Hub', ID = -1)` seperti di R4 (record kosong yang bertipe) |
| Klik tombol, tidak terjadi apa-apa sama sekali | `colPbsProcessed` belum dibuat | jalankan App.OnStart (R4) atau *Run OnStart* di Studio |
| Send Report nonaktif *Status jadwal masih Planned — report dibuka saat status Waiting Report* | Absen dibuat sebelum OnChange baru terpasang, jadi Status tidak diubah | ubah `Status` jadwal itu ke `Waiting Report` manual sekali; atau `requireWaitingStatus: false` |
| Pesan *Status jadwal Done, report tidak bisa dikirim* | durasi sudah terpenuhi, atau Choice Status beda ejaan | cek ejaan Choice di list = `scheduleWaitingStatus` di config dan teks di formula |
| Send Report gagal dengan error di kolom Playbook | pilihan dropdown tidak ada di Choice `Playbook` | pakai `PlaybooksJson = JSON(Choices(...))` supaya dropdown = Choice list |
| *The type of this argument 'Account' does not match the expected type 'Record'* | kolom `Account` di Report / Host Absence adalah Lookup/Choice, tidak bisa diisi teks | pakai formula `Choices(...)` di OnChange bagian 10 (sudah diperbarui); kalau kolomnya teks biasa, sebaliknya pakai `LookUp(colAccounts, Title = s.Account).AccountName` |
| Nama akun kosong di layar | `colAccounts` belum dimuat, atau `Schedule.Account` tidak sama dengan `Title` di list Account | jalankan App.OnStart; cek isi kedua kolom |
| Report terbuat tapi `Attachment` kosong | flow gagal / belum di-add ke app / urutan input flow terbalik | cek run history flow; input kedua harus `fileBase64` (`text_1`) |
| Durasi report lama tidak terhitung | `ReportsJson` tidak mengirim `DurasiMin` | pakai record Report di R5 persis |
| Pesan *Report ini sudah berubah. Muat ulang dulu* saat revisi | data di layar lama (`Modified` beda) | keluar-masuk layar (OnVisible memuat ulang) |
| Form revisi tidak muncul | `ApprovalStatus` bukan persis `Need Revision` | cek ejaan Choice |
