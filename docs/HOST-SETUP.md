# Setup canvas app host — langkah demi langkah

Ikuti **berurutan dari Langkah 0 sampai 12**. Setiap layar ditulis lengkap: `OnVisible`, **semua** properti control
dengan formula utuh, dan `OnChange` utuh. Tidak ada "seperti layar lain" — cukup salin per blok.

**Cara kerja singkat.** Control tidak pernah menulis ke SharePoint. Tombol di control mengirim JSON lewat output
`ActionPayload`; formula **OnChange** control membaca JSON itu, melakukan `Patch`, lalu membalas lewat variabel yang
dipasang di properti `ActionResult`. Tombol yang mengunci (Absen, Send Report, Kirim revisi, Sanggah, Clock in,
Clock out) memutar spinner sampai balasan itu datang.

```text
Clock in
  └─ Absen → pop-up "Live Break?"
       ├─ Tidak   → Schedule.Status = Waiting Report
       │             └─ Send Report (boleh beberapa kali, satu per Live ID)
       │                  ├─ total Durasi < durasi jadwal → tetap Waiting Report ("kurang X menit")
       │                  └─ total Durasi ≥ durasi jadwal → Status = Done, tombol Send Report hilang
       ├─ Ya      → Status = Done, LiveBreak = Yes, Report semua 0 (ApprovalStatus LiveBreak)
       └─ Co-Host → (tidak ditanya) Status = Done, tanpa report
Ops review → Done / Need Revision → host revisi → Waiting Approval Revision
```

## Langkah 0 — Cek list dan kolom SharePoint

Nama kolom di formula adalah **display name**. Kalau di list kamu berbeda, sesuaikan di formula. Tanda ⚠ = sering
belum ada di list lama, cek dulu.

**`Schedule - PBS Hub`**

- `Title` (SCD-…), `Date`, `StartTime`, `EndTime`, `BrandID`, `StudioID`, `HostID`
- `Platform` — Choice (Shopee, TikTok, …)
- `Account` — teks, isinya `Title` di list Account. **Tidak ada kolom nama akun**; nama diambil dari list Account
- `LiveBreak` — Choice `Yes` / `No` (kosong dianggap `No`)
- `Position` — Choice `Host` (atau `Main Host`) / `Co-Host`. Tier menghitung semua selain `Co-Host` sebagai main host
- `Status` — Choice. ⚠ harus punya pilihan **`Waiting Report`** dan **`Done`**

**`Report - PBS Hub`**

- `Title` (REP-…), `ScheduleID`, `HostID`, `BrandID`, `AccountID` (teks), `LiveDate`, `AbsID`
- `Account` — Lookup ke list Account (atau Choice)
- `Platform` — Choice
- ⚠ `LiveID` — Single line of text (baru)
- `Playbook` — Choice (Flash Sale, Payday, …)
- Number: `Durasi(Min)`, `AddToCart`, `Pesanan`, `Penjualan`, `ProdukTerjual`, `JumlahPembeli`, `CTR`, `PeakViewer`,
  `TotalViewer`, `CTOR`, `Comment`
- `ApprovalStatus` — Choice. ⚠ harus punya `Waiting Approval`, `Waiting Approval Revision`, `Need Revision`, `Done`,
  **`LiveBreak`**
- `ApprovalComment`, `Approver` (Person), `ApproverEmail`, `Attachment`

**`Host Absence - PBS Hub`** — `Title` (ABS-…), `ScheduleID`, `HostID`, `HostName`, `LiveDate`, `BrandID`,
`Platform`, `Account`

**`Report Automation - PBS Hub`** — bukti AI; `Title` sama dengan Title report; `Status` Choice (termasuk `Unmatch`)

**`Clock In - PBS Hub`** — kolom clock in/out ada di Langkah 10. Kolom Tier (ditulis setiap report terkirim):
`Tier` (Choice `Tier 1` / `Tier 2` / `Tier 3` / `No`), `Insentif` (Number), `TotalReports` (Number),
`LastTierUpdate` (Date and time), `Reason` (Multiple lines), `Total_Jam_Live` (Number), `Schedule` (Multiple lines),
`statusupdate` (teks)

**`Performance Tier - PBS Hub`** — tiga baris `Title` = `Tier 1`, `Tier 2`, `Tier 3`, masing-masing `MinViews`,
`CTR`, `AvgViewDur` (dipakai sebagai batas **Peak Viewer**) dan `Duration` (jam live minimum, mis. 8 / 6 / 4)

**`Account - PBS Hub`** — `Title` (kode akun), `AccountName` (teks). Kalau nama list-nya lain, ganti di Langkah 3

**`Host - PBS Hub`** — `Title`, `HostCode`, `NamaHost`, `Email` (Person), `Package`, `CurrentScore`, `InitialScore`

**`Brand - PBS Hub`** — `Title`, `NamaBrand` · **`Studio - PBS Hub`** — `Title`, `NamaStudio` ·
**`Studio Location - PBS`** — `Title`, `LocationID`, `Latitude`, `Longitude`, `RadiusMeter`, `IsActive`

**Opsional (skor di Hari ini)** — `[FAS STUDIO] HostScoreTransactions`, `[FAS STUDIO] HostScoreThreshold`

## Langkah 1 — Import solusi dan tambahkan data source

1. Power Apps → **Solutions → Import solution** → pilih `dist/PBSHubHostApp_1_0_0_0_managed.zip` → Import.
2. Sekali per environment: Power Platform admin center → environment → **Settings → Product → Features** →
   *Allow publishing of canvas apps with code components* = **On**. Tanpa ini control tidak muncul di tab Code.
3. Panel **Data → Add data → SharePoint** → site PBS Hub → centang semua list di Langkah 0.
4. **Add data → Office 365 Groups** (connector yang sama dengan app upload jadwal bulk/AI). Dipakai untuk
   `Office365Groups.HttpRequest` yang mengunggah screenshot report ke Graph.

## Langkah 2 — Upload screenshot (Graph) dan flow selfie

**Screenshot report — tanpa flow.** Caranya sama dengan app upload jadwal bulk/AI: `Office365Groups.HttpRequest`
PUT ke Graph. File masuk ke

```text
Report Automation/<NamaBrand>/<yyyy>/<mmmm>/REP-<ID>/REP-<ID>_<Platform>_<AccountID>_Report.png
```

Yang perlu disiapkan hanya `varSiteID` dan `varDriveID` di Langkah 3 blok 5 — salin nilainya dari app upload jadwal.
Control mengirim base64 JPEG tanpa prefix, jadi body-nya `"data:image/jpeg;base64," & data`. `webUrl` dari
respons Graph disimpan ke `Report.Attachment`. Revisi dengan screenshot baru menimpa file yang sama (folder bulan
diambil dari `Created` report), sehingga flow AI membacanya ulang.

**Flow — `PBS Host - Upload selfie`** (untuk Clock in)

1. Power Automate → **Create → Instant cloud flow** → trigger **Power Apps (V2)**.
2. Di trigger tambahkan dua input **Text**, berurutan: `fileName`, lalu `fileBase64`.
3. **+ New step → SharePoint → Create file**: Site = site PBS Hub; Folder Path = `/PBS Power Apps/Selfie Clock In`;
   File Name = `fileName` (dynamic content); File Content = expression `base64ToBinary(triggerBody()?['text_1'])`
   (`text_1` = input kedua; cek lewat *Peek code* di trigger kalau namanya lain).
4. **+ New step → Power Apps → Respond to a PowerApp or flow** → output **Text** `url` = `Path` dari Create file.
5. Save. Di Power Apps Studio: panel **Power Automate → Add flow** → pilih flow ini. Namanya di formula menjadi
   `'PBSHost-Uploadselfie'`; kalau Studio memberi nama lain, ganti di formula Langkah 10.

## Langkah 3 — App.OnStart

Pilih **App** di tree view → properti **OnStart** → tempel utuh → klik `…` di App → **Run OnStart**.

```powerfx
// 1. Context: dikirim ke properti Context semua control host.
Set(varHostCtx, JSON({
    userEmail: User().Email,
    userName: User().FullName,
    roles: "HOST",
    permissions: "",
    config: {
        requireAbsen: true,                      // report baru bisa setelah absen
        requireWaitingStatus: true,              // report hanya saat Schedule.Status = Waiting Report
        scheduleWaitingStatus: "Waiting Report", // ejaan Choice Status di list Schedule
        scheduleDoneStatus: "Done",
        absenLeadMin: 30,                        // absen dibuka 30 menit sebelum sesi
        reportDeadlineDays: 2,                   // report "Terlambat" setelah H+2
        maxShiftHours: 12,
        tolerancePct: 5,
        imageMaxPx: 2000, imageMaxKb: 1200,      // screenshot report
        clockInStatus: "Hadir - Tugas",          // Choice Status di Clock In
        defaultRadiusM: 100, weakAccuracyM: 100, minReasonChars: 10,
        selfieMaxPx: 960, selfieMaxKb: 350
    }
}, JSONFormat.Compact));

// 2. Host yang login.
Set(varMe, LookUp('Host - PBS Hub', Email.Email = User().Email));

// 3. Data referensi (sekali).
ClearCollect(colAccounts, ShowColumns('Account - PBS Hub', Title, AccountName));   // Schedule.Account -> AccountName
ClearCollect(colBrands, ShowColumns('Brand - PBS Hub', Title, NamaBrand));
ClearCollect(colStudios, ShowColumns('Studio - PBS Hub', Title, NamaStudio));
ClearCollect(colScoreBand, Filter('[FAS STUDIO] HostScoreThreshold', Active));      // hapus kalau list skor tidak dipakai
ClearCollect(colPbsProcessed, {Id: ""});                                           // requestId yang sudah diproses

// 4. Semua variabel layar. Power Apps menolak variabel yang tidak pernah di-Set ("Name isn't valid") atau
//    hanya di-Set ke Blank() ("No type found"), jadi semuanya dideklarasikan di sini dengan tipe yang benar.
Set(varMrPeriod, "");  Set(varMrFilter, "All");                          // Report saya
Set(varMsPeriod, "");  Set(varMsFilter, "");  Set(varMsView, "List");    // Jadwal saya
Set(varSchId, "");     Set(varSchDate, Today());                         // Detail sesi
Set(varRptId, Value(Blank())); Set(varRptSchedule, "");                  // Kirim / revisi report
Set(varMrdRep, LookUp('Report - PBS Hub', ID = -1));                     // record kosong yang bertipe
Set(varMrdSch, LookUp('Schedule - PBS Hub', ID = -1));
Set(varHdLoading, false); Set(varMrLoading, false); Set(varMrdLoading, false);
Set(varMsLoading, false); Set(varSdLoading, false); Set(varCkLoading, false);
Set(varHdResult, ""); Set(varMrdResult, ""); Set(varMsResult, ""); Set(varSdResult, ""); Set(varCkResult, "");

// 5. Upload screenshot (Graph) dan Tier harian di Clock In.
Set(varSiteID, "<site-id>");     // sama dengan app upload jadwal bulk/AI
Set(varDriveID, "<drive-id>");
ClearCollect(colTierConfig, 'Performance Tier - PBS Hub');          // Tier 1/2/3: MinViews, CTR, AvgViewDur (Peak), Duration (jam)
Set(varSlotMin, 15);                                                // grid 15 menit
Set(varT1MinInWindow, 120);                                         // ≥ 2 jam live di 00:00–06:00 → Tier 1
Set(varT2MinInWindow, 120);                                         // ≥ 2 jam live di 21:00–24:00 → Tier 2
Set(varHolidays, [                                                  // tanggal merah → Tier 1 (perbarui tiap tahun)
    Date(2026,1,1), Date(2026,2,16), Date(2026,3,1), Date(2026,3,21), Date(2026,4,1), Date(2026,4,10),
    Date(2026,4,11), Date(2026,5,1), Date(2026,5,14), Date(2026,5,21), Date(2026,6,1), Date(2026,6,17),
    Date(2026,6,27), Date(2026,7,7), Date(2026,8,17), Date(2026,12,25)
])
```

### Aturan Tier (dihitung setiap report terkirim)

Setiap **Send Report**, **Kirim revisi** dan **Absen → Live Break**, OnChange menghitung Tier host itu untuk tanggal
live tersebut dan menulisnya ke baris `Clock In - PBS Hub` (`HostID` + `ClockInDate`). Belum clock in = belum ada
baris = dilewati; hitung ulang bulanan yang sudah kamu punya tetap bisa dijalankan dan hasilnya sama.

| Urutan | Syarat | Hasil |
|---|---|---|
| 1 | Menit Main Host ≤ menit Co-Host hari itu | **No**, insentif 0 |
| 2 | Tanggal ada di `varHolidays` | **Tier 1** |
| 3 | Metrik T1 (TotalViewer ≥ MinViews, CTR ≥ CTR, Peak ≥ AvgViewDur), **atau** live ≥ Duration T1 (8 jam), **atau** ≥ 2 jam di 00:00–06:00 | **Tier 1** |
| 4 | Metrik T2, **atau** live ≥ 6 jam, **atau** ≥ 2 jam di 21:00–24:00 | **Tier 2** |
| 5 | Metrik T3, **atau** live ≥ 4 jam | **Tier 3** |
| 6 | Sabtu / Minggu dan hasil 3–5 bukan Tier 1 | naik ke **Tier 2** |
| — | tidak ada yang cocok | **No** |

Jam live = gabungan jadwal Main Host (bukan Cancelled) di grid 15 menit, jadi jadwal yang tumpang tindih tidak
dihitung dua kali. Contoh: 4 jadwal total 8 jam → Tier 1; total 4 jam tapi live sampai 03:00 (≥ 2 jam setelah
00:00) → Tier 1. Metrik memakai akun terbaik hari itu (TotalViewer dijumlah, Peak dan CTR maksimum). Insentif:
Tier 1 = 75.000, Tier 2 = 65.000, Tier 3 = 55.000, No = 0.

## Langkah 4 — Buat enam layar

Nama layar dipakai di formula `Navigate(...)`. Pakai nama persis ini (atau ganti di semua formula).

| Layar | Control | Dibuka dari |
|---|---|---|
| `scrHome` | PBS Host App Dashboard | layar awal app (**App.StartScreen** = `scrHome`) |
| `scrMySchedule` | PBS Host App My Schedule | tab / tombol *Jadwal saya* |
| `scrScheduleDetail` | PBS Host App Schedule Detail | klik sesi di Hari ini / Jadwal saya |
| `scrMyReports` | PBS Host App My Reports | tab / tombol *Report saya* |
| `scrMyReportDetail` | PBS Host App My Report Detail | klik report di Report saya / to-do Hari ini |
| `scrClockIn` | PBS Host App Clock In | tombol Clock in / Clock out di Hari ini |

Navigasi utama (tab bar atau tombol di header, di luar control): `Navigate(scrHome)`, `Navigate(scrMySchedule)`,
`Navigate(scrMyReports)`. Sisanya dibuka oleh control lewat OnChange.

## Langkah 5 — Layar Hari ini (`scrHome`)

Sapaan, kartu shift (clock in / out), to-do, jadwal minggu ini, skor.

**5.1 Buat layar dan control.** Buat layar baru bernama `scrHome`. Insert → *Get more components* → tab **Code** → pilih **PBS Host App Dashboard** → Import, lalu tarik control itu ke layar. Atur X = 0, Y = 0, Width = `Parent.Width`, Height = `Parent.Height` (atau area konten kalau ada header/tab bar).

**5.2 `scrHome.OnVisible`** — pilih layar (bukan control), properti **OnVisible**:

```powerfx
Set(varHdLoading, true);
ClearCollect(colMySch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date >= Today() - 7, Date <= Today() + 7));
ClearCollect(colMyClk, Filter('Clock In - PBS Hub', HostID = varMe.Title, ClockInDate >= Today() - 14));
ClearCollect(colMyAbs, Filter('Host Absence - PBS Hub', HostID = varMe.Title, LiveDate >= Today() - 14));
ClearCollect(colMyRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate >= Today() - 30));
ClearCollect(colMyTx, Filter('[FAS STUDIO] HostScoreTransactions', HostID = varMe.Title, CreatedDate >= Today() - 30));   // hapus kalau tanpa skor
Set(varHdLoading, false)
```

**5.3 Properti control** — pilih control di layar ini, isi properti berikut satu per satu (panel kanan → *Advanced*, atau formula bar):

1. **`Context`**

```powerfx
varHostCtx
```

2. **`HostJson`**

```powerfx
JSON(ForAll(Table(varMe), {Title: Title, HostCode: HostCode, NamaHost: NamaHost, Email: Email.Email,
    Package: Package.Value, CurrentScore: CurrentScore, InitialScore: InitialScore}), JSONFormat.Compact)
```

3. **`SchedulesJson`**

```powerfx
JSON(ForAll(colMySch, {ID: ID, Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime,
    BrandID: BrandID, StudioID: StudioID, HostID: HostID, Platform: Platform.Value,
    AccountID: Account, AccountName: With({a: Account}, LookUp(colAccounts, Title = a).AccountName),
    LiveBreak: Coalesce(LiveBreak.Value, "No"), Position: Position.Value, Status: Status.Value}), JSONFormat.Compact)
```

4. **`ClockInJson`**

```powerfx
JSON(ForAll(colMyClk, {ID: ID, ClockInDate: Text(ClockInDate, "yyyy-mm-dd"), CheckInTime: CheckInTime, CheckOutTime: CheckOutTime,
    ClockInTime: ClockInTime, ClockOutTime: ClockOutTime, CheckInOffice: CheckInOffice, IsInsideGeofence: IsInsideGeofence}), JSONFormat.Compact)
```

5. **`AbsenceJson`**

```powerfx
JSON(ForAll(colMyAbs, {Title: Title, ScheduleID: ScheduleID, LiveDate: Text(LiveDate, "yyyy-mm-dd"), Created: Created}), JSONFormat.Compact)
```

6. **`ReportsJson`**

```powerfx
JSON(ForAll(colMyRep, {ID: ID, Title: Title, ScheduleID: ScheduleID, HostID: HostID, BrandID: BrandID, AccountID: AccountID,
    Account: Account.Value, Platform: Platform.Value, LiveDate: Text(LiveDate, "yyyy-mm-dd"), LiveID: LiveID,
    Playbook: Playbook.Value, Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual,
    JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)',
    AddToCart: AddToCart, TotalViewer: TotalViewer, Comment: Comment, ApprovalStatus: ApprovalStatus.Value,
    ApprovalComment: ApprovalComment, Approver: Approver.DisplayName, ApproverEmail: ApproverEmail,
    Attachment: Attachment, Created: Created, Modified: Modified}), JSONFormat.Compact)
```

7. **`ScoreTxJson`** — opsional; isi `"[]"` kalau tanpa skor

```powerfx
JSON(ForAll(colMyTx, {Point: Point, Status: Status.Value, CreatedDate: CreatedDate, Reason: Reason}), JSONFormat.Compact)
```

8. **`ThresholdsJson`** — opsional; isi `"[]"` kalau tanpa skor

```powerfx
JSON(ForAll(colScoreBand, {ThresholdID: ThresholdID, Label: Label, MinimumScore: MinimumScore, MaximumScore: MaximumScore, Tone: Tone.Value, Active: Active, SortOrder: SortOrder}), JSONFormat.Compact)
```

9. **`BrandsJson`**

```powerfx
JSON(ForAll(colBrands, {Title: Title, NamaBrand: NamaBrand}), JSONFormat.Compact)
```

10. **`StudiosJson`**

```powerfx
JSON(ForAll(colStudios, {Title: Title, NamaStudio: NamaStudio}), JSONFormat.Compact)
```

11. **`IsLoading`**

```powerfx
varHdLoading
```

12. **`ReferenceDate`** — kosong (hanya untuk tes)

```powerfx
""
```

13. **`ActionResult`**

```powerfx
varHdResult
```

**5.4 `OnChange` control** — properti **OnChange** control yang sama, tempel utuh:

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
                                                With({{tDate: s.Date}},
                                                With({{clk: LookUp('Clock In - PBS Hub', HostID = varMe.Title && ClockInDate = tDate),
                                                      schDay: Filter('Schedule - PBS Hub', HostID = varMe.Title && Date = tDate),
                                                      repDay: Filter('Report - PBS Hub', HostID = varMe.Title && LiveDate = tDate),
                                                      t1: LookUp(colTierConfig, Title = "Tier 1"), t2: LookUp(colTierConfig, Title = "Tier 2"),
                                                      t3: LookUp(colTierConfig, Title = "Tier 3")}},
                                                If(!IsBlank(clk),
                                                // Segmen jadwal aktif (bukan Cancelled, jam lengkap). Lewat tengah malam: EndMin + 1440.
                                                With({{seg: ForAll(Filter(schDay, !IsBlank(StartTime) && !IsBlank(EndTime) && Status.Value <> "Cancelled") As S,
                                                            With({{sm: Hour(TimeValue(S.StartTime)) * 60 + Minute(TimeValue(S.StartTime)),
                                                                  em: Hour(TimeValue(S.EndTime)) * 60 + Minute(TimeValue(S.EndTime))}},
                                                                {{Title: S.Title, BrandID: S.BrandID, StartTime: S.StartTime, EndTime: S.EndTime,
                                                                 Co: S.Position.Value = "Co-Host",          // "Host" / "Main Host" = main host
                                                                 StartMin: sm, EndMin: If(em >= sm, em, em + 1440)}}))}},
                                                With({{mainSeg: Filter(seg, !Co), mainMin: Sum(Filter(seg, !Co), EndMin - StartMin), coMin: Sum(Filter(seg, Co), EndMin - StartMin)}},
                                                // Grid 15 menit selama 2 hari (0–2880): slot yang tertutup jadwal main host.
                                                With({{slots: ForAll(Sequence(2880 / varSlotMin, 0, 1) As Sl,
                                                            With({{ms: Sl.Value * varSlotMin}}, {{SlotStart: ms, Covered: !IsEmpty(Filter(mainSeg, StartMin <= ms && EndMin > ms))}}))}},
                                                With({{liveMin: CountRows(Filter(slots, Covered)) * varSlotMin,
                                                      t1Win: CountRows(Filter(slots, Covered && (SlotStart < 360 || (SlotStart >= 1440 && SlotStart < 1800)))) * varSlotMin,     // 00:00–06:00
                                                      t2Win: CountRows(Filter(slots, Covered && ((SlotStart >= 1260 && SlotStart < 1440) || SlotStart >= 2700))) * varSlotMin,  // 21:00–24:00
                                                      // Akun terbaik hari itu: TotalViewer dijumlah, Peak dan CTR diambil maksimum.
                                                      best: First(Sort(ForAll(Distinct(repDay, Account.Value) As D,
                                                                With({{r: Filter(repDay, Account.Value = D.Value)}},
                                                                    {{Account: D.Value, TotalViewer: Sum(r, TotalViewer), PeakViewer: Max(r, PeakViewer), CTR: Max(r, CTR)}})),
                                                            TotalViewer * PeakViewer * CTR, SortOrder.Descending))}},
                                                With({{m1: !IsBlank(best) && best.TotalViewer >= t1.MinViews && best.CTR >= t1.CTR && best.PeakViewer >= t1.AvgViewDur,
                                                      m2: !IsBlank(best) && best.TotalViewer >= t2.MinViews && best.CTR >= t2.CTR && best.PeakViewer >= t2.AvgViewDur,
                                                      m3: !IsBlank(best) && best.TotalViewer >= t3.MinViews && best.CTR >= t3.CTR && best.PeakViewer >= t3.AvgViewDur,
                                                      d1: liveMin >= t1.Duration * 60, d2: liveMin >= t2.Duration * 60, d3: liveMin >= t3.Duration * 60,
                                                      w1: t1Win >= varT1MinInWindow, w2: t2Win >= varT2MinInWindow,
                                                      jam: Round(liveMin / 60, 2), main: mainMin > coMin,
                                                      hol: tDate in varHolidays, wkd: Weekday(tDate) = 1 || Weekday(tDate) = 7}},
                                                With({{calc: If(m1 || d1 || w1, "Tier 1", m2 || d2 || w2, "Tier 2", m3 || d3, "Tier 3", "No")}},
                                                // Urutan: Co-Host mayoritas → No; tanggal merah → Tier 1; Sabtu/Minggu → minimal Tier 2.
                                                With({{tier: If(!main, "No", hol, "Tier 1", wkd && calc <> "Tier 1", "Tier 2", calc)}},
                                                    Patch('Clock In - PBS Hub', clk, {{
                                                        Tier: {{Value: tier}},
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
                                                            Concat(Sort(mainSeg, StartMin), With({{b: BrandID}},
                                                                Title & "_" & LookUp(colBrands, Title = b).NamaBrand & "_" & Substitute(StartTime, ":", ".") & "-" & Substitute(EndTime, ":", ".")), ", "),
                                                            "Not Eligible - Main Host " & Round(mainMin / 60, 2) & " jam vs Co-Host " & Round(coMin / 60, 2) & " jam"),
                                                        statusupdate: If(clk.Tier.Value = tier, "Tier tetap " & tier & " (tidak ada perubahan)",
                                                            "Berhasil update dari " & Coalesce(clk.Tier.Value, "-") & " → " & tier)
                                                    }})
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

**5.5 Cek cepat.** Buka app: nama host tampil, sesi hari ini muncul. Klik nama brand sesi → pindah ke `scrScheduleDetail`.

## Langkah 6 — Layar Detail sesi (`scrScheduleDetail`) — Absen, Send Report, revisi

Layar utama report. Dibuka oleh aksi `OPEN_SCHEDULE` (Hari ini, Jadwal saya) yang mengisi `varSchId` dan `varSchDate`. Untuk tes langsung: tombol sementara dengan `Set(varSchId, "SCD-3313"); Set(varSchDate, DateValue("2026-09-13")); Navigate(scrScheduleDetail)`.

**6.1 Buat layar dan control.** Buat layar baru bernama `scrScheduleDetail`. Insert → *Get more components* → tab **Code** → pilih **PBS Host App Schedule Detail** → Import, lalu tarik control itu ke layar. Atur X = 0, Y = 0, Width = `Parent.Width`, Height = `Parent.Height` (atau area konten kalau ada header/tab bar).

**6.2 `scrScheduleDetail.OnVisible`** — pilih layar (bukan control), properti **OnVisible**:

```powerfx
Set(varSdLoading, true);
ClearCollect(colSdSch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date = varSchDate));
ClearCollect(colSdClk, Filter('Clock In - PBS Hub', HostID = varMe.Title, ClockInDate = varSchDate));
ClearCollect(colSdAbs, Filter('Host Absence - PBS Hub', HostID = varMe.Title, LiveDate = varSchDate));
ClearCollect(colSdRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate = varSchDate));
ClearCollect(colSdEvi, Filter('Report Automation - PBS Hub', HostID = varMe.Title, Title in colSdRep.Title));
ClearCollect(colSdHist, FirstN(Sort(Filter('Report - PBS Hub', HostID = varMe.Title), ID, SortOrder.Descending), 10));
Set(varSdLoading, false)
```

**6.3 Properti control** — pilih control di layar ini, isi properti berikut satu per satu (panel kanan → *Advanced*, atau formula bar):

1. **`Context`**

```powerfx
varHostCtx
```

2. **`ScheduleId`** — Title jadwal yang dibuka (diisi aksi `OPEN_SCHEDULE`)

```powerfx
varSchId
```

3. **`HostJson`**

```powerfx
JSON(ForAll(Table(varMe), {Title: Title, HostCode: HostCode, NamaHost: NamaHost, Email: Email.Email,
    Package: Package.Value, CurrentScore: CurrentScore, InitialScore: InitialScore}), JSONFormat.Compact)
```

4. **`SchedulesJson`** — sesi itu + sesi lain host di hari yang sama

```powerfx
JSON(ForAll(colSdSch, {ID: ID, Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime,
    BrandID: BrandID, StudioID: StudioID, HostID: HostID, Platform: Platform.Value,
    AccountID: Account, AccountName: With({a: Account}, LookUp(colAccounts, Title = a).AccountName),
    LiveBreak: Coalesce(LiveBreak.Value, "No"), Position: Position.Value, Status: Status.Value}), JSONFormat.Compact)
```

5. **`ClockInJson`**

```powerfx
JSON(ForAll(colSdClk, {ID: ID, ClockInDate: Text(ClockInDate, "yyyy-mm-dd"), CheckInTime: CheckInTime, CheckOutTime: CheckOutTime,
    ClockInTime: ClockInTime, ClockOutTime: ClockOutTime, CheckInOffice: CheckInOffice, IsInsideGeofence: IsInsideGeofence}), JSONFormat.Compact)
```

6. **`AbsenceJson`**

```powerfx
JSON(ForAll(colSdAbs, {Title: Title, ScheduleID: ScheduleID, LiveDate: Text(LiveDate, "yyyy-mm-dd"), Created: Created}), JSONFormat.Compact)
```

7. **`ReportsJson`** — semua bagian report (live terputus) ikut terkirim

```powerfx
JSON(ForAll(colSdRep, {ID: ID, Title: Title, ScheduleID: ScheduleID, HostID: HostID, BrandID: BrandID, AccountID: AccountID,
    Account: Account.Value, Platform: Platform.Value, LiveDate: Text(LiveDate, "yyyy-mm-dd"), LiveID: LiveID,
    Playbook: Playbook.Value, Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual,
    JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)',
    AddToCart: AddToCart, TotalViewer: TotalViewer, Comment: Comment, ApprovalStatus: ApprovalStatus.Value,
    ApprovalComment: ApprovalComment, Approver: Approver.DisplayName, ApproverEmail: ApproverEmail,
    Attachment: Attachment, Created: Created, Modified: Modified}), JSONFormat.Compact)
```

8. **`EvidenceJson`**

```powerfx
JSON(ForAll(colSdEvi, {ID: ID, Title: Title, HostID: HostID, ScheduleID: ScheduleID, AccountID: AccountID, Platform: Platform.Value,
    Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual, JumlahPembeli: JumlahPembeli, CTR: CTR,
    CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)', AddToCart: AddToCart, TotalViewer: TotalViewer,
    Comment: Comment, Status: Status.Value, Attachment: Attachment, Created: Created}), JSONFormat.Compact)
```

9. **`HistoryJson`** — peringatan angka jauh dari rata-rata; boleh `"[]"`

```powerfx
JSON(ForAll(colSdHist, {ID: ID, Title: Title, ScheduleID: ScheduleID, HostID: HostID, BrandID: BrandID, AccountID: AccountID,
    Account: Account.Value, Platform: Platform.Value, LiveDate: Text(LiveDate, "yyyy-mm-dd"), LiveID: LiveID,
    Playbook: Playbook.Value, Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual,
    JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)',
    AddToCart: AddToCart, TotalViewer: TotalViewer, Comment: Comment, ApprovalStatus: ApprovalStatus.Value,
    ApprovalComment: ApprovalComment, Approver: Approver.DisplayName, ApproverEmail: ApproverEmail,
    Attachment: Attachment, Created: Created, Modified: Modified}), JSONFormat.Compact)
```

10. **`BrandsJson`**

```powerfx
JSON(ForAll(colBrands, {Title: Title, NamaBrand: NamaBrand}), JSONFormat.Compact)
```

11. **`StudiosJson`**

```powerfx
JSON(ForAll(colStudios, {Title: Title, NamaStudio: NamaStudio}), JSONFormat.Compact)
```

12. **`PlaybooksJson`** — isi dropdown Playbook = pilihan Choice di list

```powerfx
JSON(Choices([@'Report - PBS Hub'].Playbook), JSONFormat.Compact)
```

13. **`IsLoading`**

```powerfx
varSdLoading
```

14. **`ReferenceDate`** — kosong

```powerfx
""
```

15. **`ActionResult`**

```powerfx
varSdResult
```

**6.4 `OnChange` control** — properti **OnChange** control yang sama, tempel utuh:

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
                                                With({{tDate: s.Date}},
                                                With({{clk: LookUp('Clock In - PBS Hub', HostID = varMe.Title && ClockInDate = tDate),
                                                      schDay: Filter('Schedule - PBS Hub', HostID = varMe.Title && Date = tDate),
                                                      repDay: Filter('Report - PBS Hub', HostID = varMe.Title && LiveDate = tDate),
                                                      t1: LookUp(colTierConfig, Title = "Tier 1"), t2: LookUp(colTierConfig, Title = "Tier 2"),
                                                      t3: LookUp(colTierConfig, Title = "Tier 3")}},
                                                If(!IsBlank(clk),
                                                // Segmen jadwal aktif (bukan Cancelled, jam lengkap). Lewat tengah malam: EndMin + 1440.
                                                With({{seg: ForAll(Filter(schDay, !IsBlank(StartTime) && !IsBlank(EndTime) && Status.Value <> "Cancelled") As S,
                                                            With({{sm: Hour(TimeValue(S.StartTime)) * 60 + Minute(TimeValue(S.StartTime)),
                                                                  em: Hour(TimeValue(S.EndTime)) * 60 + Minute(TimeValue(S.EndTime))}},
                                                                {{Title: S.Title, BrandID: S.BrandID, StartTime: S.StartTime, EndTime: S.EndTime,
                                                                 Co: S.Position.Value = "Co-Host",          // "Host" / "Main Host" = main host
                                                                 StartMin: sm, EndMin: If(em >= sm, em, em + 1440)}}))}},
                                                With({{mainSeg: Filter(seg, !Co), mainMin: Sum(Filter(seg, !Co), EndMin - StartMin), coMin: Sum(Filter(seg, Co), EndMin - StartMin)}},
                                                // Grid 15 menit selama 2 hari (0–2880): slot yang tertutup jadwal main host.
                                                With({{slots: ForAll(Sequence(2880 / varSlotMin, 0, 1) As Sl,
                                                            With({{ms: Sl.Value * varSlotMin}}, {{SlotStart: ms, Covered: !IsEmpty(Filter(mainSeg, StartMin <= ms && EndMin > ms))}}))}},
                                                With({{liveMin: CountRows(Filter(slots, Covered)) * varSlotMin,
                                                      t1Win: CountRows(Filter(slots, Covered && (SlotStart < 360 || (SlotStart >= 1440 && SlotStart < 1800)))) * varSlotMin,     // 00:00–06:00
                                                      t2Win: CountRows(Filter(slots, Covered && ((SlotStart >= 1260 && SlotStart < 1440) || SlotStart >= 2700))) * varSlotMin,  // 21:00–24:00
                                                      // Akun terbaik hari itu: TotalViewer dijumlah, Peak dan CTR diambil maksimum.
                                                      best: First(Sort(ForAll(Distinct(repDay, Account.Value) As D,
                                                                With({{r: Filter(repDay, Account.Value = D.Value)}},
                                                                    {{Account: D.Value, TotalViewer: Sum(r, TotalViewer), PeakViewer: Max(r, PeakViewer), CTR: Max(r, CTR)}})),
                                                            TotalViewer * PeakViewer * CTR, SortOrder.Descending))}},
                                                With({{m1: !IsBlank(best) && best.TotalViewer >= t1.MinViews && best.CTR >= t1.CTR && best.PeakViewer >= t1.AvgViewDur,
                                                      m2: !IsBlank(best) && best.TotalViewer >= t2.MinViews && best.CTR >= t2.CTR && best.PeakViewer >= t2.AvgViewDur,
                                                      m3: !IsBlank(best) && best.TotalViewer >= t3.MinViews && best.CTR >= t3.CTR && best.PeakViewer >= t3.AvgViewDur,
                                                      d1: liveMin >= t1.Duration * 60, d2: liveMin >= t2.Duration * 60, d3: liveMin >= t3.Duration * 60,
                                                      w1: t1Win >= varT1MinInWindow, w2: t2Win >= varT2MinInWindow,
                                                      jam: Round(liveMin / 60, 2), main: mainMin > coMin,
                                                      hol: tDate in varHolidays, wkd: Weekday(tDate) = 1 || Weekday(tDate) = 7}},
                                                With({{calc: If(m1 || d1 || w1, "Tier 1", m2 || d2 || w2, "Tier 2", m3 || d3, "Tier 3", "No")}},
                                                // Urutan: Co-Host mayoritas → No; tanggal merah → Tier 1; Sabtu/Minggu → minimal Tier 2.
                                                With({{tier: If(!main, "No", hol, "Tier 1", wkd && calc <> "Tier 1", "Tier 2", calc)}},
                                                    Patch('Clock In - PBS Hub', clk, {{
                                                        Tier: {{Value: tier}},
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
                                                            Concat(Sort(mainSeg, StartMin), With({{b: BrandID}},
                                                                Title & "_" & LookUp(colBrands, Title = b).NamaBrand & "_" & Substitute(StartTime, ":", ".") & "-" & Substitute(EndTime, ":", ".")), ", "),
                                                            "Not Eligible - Main Host " & Round(mainMin / 60, 2) & " jam vs Co-Host " & Round(coMin / 60, 2) & " jam"),
                                                        statusupdate: If(clk.Tier.Value = tier, "Tier tetap " & tier & " (tidak ada perubahan)",
                                                            "Berhasil update dari " & Coalesce(clk.Tier.Value, "-") & " → " & tier)
                                                    }})
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
                                                With({{tDate: s.Date}},
                                                With({{clk: LookUp('Clock In - PBS Hub', HostID = varMe.Title && ClockInDate = tDate),
                                                      schDay: Filter('Schedule - PBS Hub', HostID = varMe.Title && Date = tDate),
                                                      repDay: Filter('Report - PBS Hub', HostID = varMe.Title && LiveDate = tDate),
                                                      t1: LookUp(colTierConfig, Title = "Tier 1"), t2: LookUp(colTierConfig, Title = "Tier 2"),
                                                      t3: LookUp(colTierConfig, Title = "Tier 3")}},
                                                If(!IsBlank(clk),
                                                // Segmen jadwal aktif (bukan Cancelled, jam lengkap). Lewat tengah malam: EndMin + 1440.
                                                With({{seg: ForAll(Filter(schDay, !IsBlank(StartTime) && !IsBlank(EndTime) && Status.Value <> "Cancelled") As S,
                                                            With({{sm: Hour(TimeValue(S.StartTime)) * 60 + Minute(TimeValue(S.StartTime)),
                                                                  em: Hour(TimeValue(S.EndTime)) * 60 + Minute(TimeValue(S.EndTime))}},
                                                                {{Title: S.Title, BrandID: S.BrandID, StartTime: S.StartTime, EndTime: S.EndTime,
                                                                 Co: S.Position.Value = "Co-Host",          // "Host" / "Main Host" = main host
                                                                 StartMin: sm, EndMin: If(em >= sm, em, em + 1440)}}))}},
                                                With({{mainSeg: Filter(seg, !Co), mainMin: Sum(Filter(seg, !Co), EndMin - StartMin), coMin: Sum(Filter(seg, Co), EndMin - StartMin)}},
                                                // Grid 15 menit selama 2 hari (0–2880): slot yang tertutup jadwal main host.
                                                With({{slots: ForAll(Sequence(2880 / varSlotMin, 0, 1) As Sl,
                                                            With({{ms: Sl.Value * varSlotMin}}, {{SlotStart: ms, Covered: !IsEmpty(Filter(mainSeg, StartMin <= ms && EndMin > ms))}}))}},
                                                With({{liveMin: CountRows(Filter(slots, Covered)) * varSlotMin,
                                                      t1Win: CountRows(Filter(slots, Covered && (SlotStart < 360 || (SlotStart >= 1440 && SlotStart < 1800)))) * varSlotMin,     // 00:00–06:00
                                                      t2Win: CountRows(Filter(slots, Covered && ((SlotStart >= 1260 && SlotStart < 1440) || SlotStart >= 2700))) * varSlotMin,  // 21:00–24:00
                                                      // Akun terbaik hari itu: TotalViewer dijumlah, Peak dan CTR diambil maksimum.
                                                      best: First(Sort(ForAll(Distinct(repDay, Account.Value) As D,
                                                                With({{r: Filter(repDay, Account.Value = D.Value)}},
                                                                    {{Account: D.Value, TotalViewer: Sum(r, TotalViewer), PeakViewer: Max(r, PeakViewer), CTR: Max(r, CTR)}})),
                                                            TotalViewer * PeakViewer * CTR, SortOrder.Descending))}},
                                                With({{m1: !IsBlank(best) && best.TotalViewer >= t1.MinViews && best.CTR >= t1.CTR && best.PeakViewer >= t1.AvgViewDur,
                                                      m2: !IsBlank(best) && best.TotalViewer >= t2.MinViews && best.CTR >= t2.CTR && best.PeakViewer >= t2.AvgViewDur,
                                                      m3: !IsBlank(best) && best.TotalViewer >= t3.MinViews && best.CTR >= t3.CTR && best.PeakViewer >= t3.AvgViewDur,
                                                      d1: liveMin >= t1.Duration * 60, d2: liveMin >= t2.Duration * 60, d3: liveMin >= t3.Duration * 60,
                                                      w1: t1Win >= varT1MinInWindow, w2: t2Win >= varT2MinInWindow,
                                                      jam: Round(liveMin / 60, 2), main: mainMin > coMin,
                                                      hol: tDate in varHolidays, wkd: Weekday(tDate) = 1 || Weekday(tDate) = 7}},
                                                With({{calc: If(m1 || d1 || w1, "Tier 1", m2 || d2 || w2, "Tier 2", m3 || d3, "Tier 3", "No")}},
                                                // Urutan: Co-Host mayoritas → No; tanggal merah → Tier 1; Sabtu/Minggu → minimal Tier 2.
                                                With({{tier: If(!main, "No", hol, "Tier 1", wkd && calc <> "Tier 1", "Tier 2", calc)}},
                                                    Patch('Clock In - PBS Hub', clk, {{
                                                        Tier: {{Value: tier}},
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
                                                            Concat(Sort(mainSeg, StartMin), With({{b: BrandID}},
                                                                Title & "_" & LookUp(colBrands, Title = b).NamaBrand & "_" & Substitute(StartTime, ":", ".") & "-" & Substitute(EndTime, ":", ".")), ", "),
                                                            "Not Eligible - Main Host " & Round(mainMin / 60, 2) & " jam vs Co-Host " & Round(coMin / 60, 2) & " jam"),
                                                        statusupdate: If(clk.Tier.Value = tier, "Tier tetap " & tier & " (tidak ada perubahan)",
                                                            "Berhasil update dari " & Coalesce(clk.Tier.Value, "-") & " → " & tier)
                                                    }})
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
                                        With({{tDate: cur.LiveDate}},
                                        With({{clk: LookUp('Clock In - PBS Hub', HostID = varMe.Title && ClockInDate = tDate),
                                              schDay: Filter('Schedule - PBS Hub', HostID = varMe.Title && Date = tDate),
                                              repDay: Filter('Report - PBS Hub', HostID = varMe.Title && LiveDate = tDate),
                                              t1: LookUp(colTierConfig, Title = "Tier 1"), t2: LookUp(colTierConfig, Title = "Tier 2"),
                                              t3: LookUp(colTierConfig, Title = "Tier 3")}},
                                        If(!IsBlank(clk),
                                        // Segmen jadwal aktif (bukan Cancelled, jam lengkap). Lewat tengah malam: EndMin + 1440.
                                        With({{seg: ForAll(Filter(schDay, !IsBlank(StartTime) && !IsBlank(EndTime) && Status.Value <> "Cancelled") As S,
                                                    With({{sm: Hour(TimeValue(S.StartTime)) * 60 + Minute(TimeValue(S.StartTime)),
                                                          em: Hour(TimeValue(S.EndTime)) * 60 + Minute(TimeValue(S.EndTime))}},
                                                        {{Title: S.Title, BrandID: S.BrandID, StartTime: S.StartTime, EndTime: S.EndTime,
                                                         Co: S.Position.Value = "Co-Host",          // "Host" / "Main Host" = main host
                                                         StartMin: sm, EndMin: If(em >= sm, em, em + 1440)}}))}},
                                        With({{mainSeg: Filter(seg, !Co), mainMin: Sum(Filter(seg, !Co), EndMin - StartMin), coMin: Sum(Filter(seg, Co), EndMin - StartMin)}},
                                        // Grid 15 menit selama 2 hari (0–2880): slot yang tertutup jadwal main host.
                                        With({{slots: ForAll(Sequence(2880 / varSlotMin, 0, 1) As Sl,
                                                    With({{ms: Sl.Value * varSlotMin}}, {{SlotStart: ms, Covered: !IsEmpty(Filter(mainSeg, StartMin <= ms && EndMin > ms))}}))}},
                                        With({{liveMin: CountRows(Filter(slots, Covered)) * varSlotMin,
                                              t1Win: CountRows(Filter(slots, Covered && (SlotStart < 360 || (SlotStart >= 1440 && SlotStart < 1800)))) * varSlotMin,     // 00:00–06:00
                                              t2Win: CountRows(Filter(slots, Covered && ((SlotStart >= 1260 && SlotStart < 1440) || SlotStart >= 2700))) * varSlotMin,  // 21:00–24:00
                                              // Akun terbaik hari itu: TotalViewer dijumlah, Peak dan CTR diambil maksimum.
                                              best: First(Sort(ForAll(Distinct(repDay, Account.Value) As D,
                                                        With({{r: Filter(repDay, Account.Value = D.Value)}},
                                                            {{Account: D.Value, TotalViewer: Sum(r, TotalViewer), PeakViewer: Max(r, PeakViewer), CTR: Max(r, CTR)}})),
                                                    TotalViewer * PeakViewer * CTR, SortOrder.Descending))}},
                                        With({{m1: !IsBlank(best) && best.TotalViewer >= t1.MinViews && best.CTR >= t1.CTR && best.PeakViewer >= t1.AvgViewDur,
                                              m2: !IsBlank(best) && best.TotalViewer >= t2.MinViews && best.CTR >= t2.CTR && best.PeakViewer >= t2.AvgViewDur,
                                              m3: !IsBlank(best) && best.TotalViewer >= t3.MinViews && best.CTR >= t3.CTR && best.PeakViewer >= t3.AvgViewDur,
                                              d1: liveMin >= t1.Duration * 60, d2: liveMin >= t2.Duration * 60, d3: liveMin >= t3.Duration * 60,
                                              w1: t1Win >= varT1MinInWindow, w2: t2Win >= varT2MinInWindow,
                                              jam: Round(liveMin / 60, 2), main: mainMin > coMin,
                                              hol: tDate in varHolidays, wkd: Weekday(tDate) = 1 || Weekday(tDate) = 7}},
                                        With({{calc: If(m1 || d1 || w1, "Tier 1", m2 || d2 || w2, "Tier 2", m3 || d3, "Tier 3", "No")}},
                                        // Urutan: Co-Host mayoritas → No; tanggal merah → Tier 1; Sabtu/Minggu → minimal Tier 2.
                                        With({{tier: If(!main, "No", hol, "Tier 1", wkd && calc <> "Tier 1", "Tier 2", calc)}},
                                            Patch('Clock In - PBS Hub', clk, {{
                                                Tier: {{Value: tier}},
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
                                                    Concat(Sort(mainSeg, StartMin), With({{b: BrandID}},
                                                        Title & "_" & LookUp(colBrands, Title = b).NamaBrand & "_" & Substitute(StartTime, ":", ".") & "-" & Substitute(EndTime, ":", ".")), ", "),
                                                    "Not Eligible - Main Host " & Round(mainMin / 60, 2) & " jam vs Co-Host " & Round(coMin / 60, 2) & " jam"),
                                                statusupdate: If(clk.Tier.Value = tier, "Tier tetap " & tier & " (tidak ada perubahan)",
                                                    "Berhasil update dari " & Coalesce(clk.Tier.Value, "-") & " → " & tier)
                                            }})
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

**6.5 Cek cepat.** Absen → pilih *Tidak* → di SharePoint ada baris Host Absence dan `Schedule.Status = Waiting Report`; tombol **Send Report** aktif. Kirim report → baris Report baru + `Attachment` terisi.

## Langkah 7 — Layar Report saya (`scrMyReports`)

Daftar report sebulan, KPI (Belum dikirim, Perlu revisi, Menunggu review, Disetujui), filter, pilih bulan.

**7.1 Buat layar dan control.** Buat layar baru bernama `scrMyReports`. Insert → *Get more components* → tab **Code** → pilih **PBS Host App My Reports** → Import, lalu tarik control itu ke layar. Atur X = 0, Y = 0, Width = `Parent.Width`, Height = `Parent.Height` (atau area konten kalau ada header/tab bar).

**7.2 `scrMyReports.OnVisible`** — pilih layar (bukan control), properti **OnVisible**:

```powerfx
Set(varMrLoading, true);
With({from: If(IsBlank(varMrPeriod), Date(Year(Today()), Month(Today()), 1), DateValue(varMrPeriod & "-01"))},
    ClearCollect(colMrRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate >= from, LiveDate < DateAdd(from, 1, TimeUnit.Months)));
    ClearCollect(colMrSch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date >= from, Date < DateAdd(from, 1, TimeUnit.Months)))
);
Set(varMrLoading, false)
```

**7.3 Properti control** — pilih control di layar ini, isi properti berikut satu per satu (panel kanan → *Advanced*, atau formula bar):

1. **`Context`**

```powerfx
varHostCtx
```

2. **`Period`** — bulan yang tampil, `yyyy-mm`; kosong = bulan ini. Pemilih bulan mengirim `PERIOD_CHANGED`, OnChange mengisi variabel ini dan memuat ulang

```powerfx
varMrPeriod
```

3. **`DefaultFilter`** — `All`, `Revision`, `Waiting`, `Done`, `Auto`, `LiveBreak`; chip filter mengirim `FILTER_CHANGED`

```powerfx
varMrFilter
```

4. **`ReportsJson`**

```powerfx
JSON(ForAll(colMrRep, {ID: ID, Title: Title, ScheduleID: ScheduleID, HostID: HostID, BrandID: BrandID, AccountID: AccountID,
    Account: Account.Value, Platform: Platform.Value, LiveDate: Text(LiveDate, "yyyy-mm-dd"), LiveID: LiveID,
    Playbook: Playbook.Value, Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual,
    JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)',
    AddToCart: AddToCart, TotalViewer: TotalViewer, Comment: Comment, ApprovalStatus: ApprovalStatus.Value,
    ApprovalComment: ApprovalComment, Approver: Approver.DisplayName, ApproverEmail: ApproverEmail,
    Attachment: Attachment, Created: Created, Modified: Modified}), JSONFormat.Compact)
```

5. **`SchedulesJson`** — untuk jam sesi dan kartu *Belum dikirim*

```powerfx
JSON(ForAll(colMrSch, {ID: ID, Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime,
    BrandID: BrandID, StudioID: StudioID, HostID: HostID, Platform: Platform.Value,
    AccountID: Account, AccountName: With({a: Account}, LookUp(colAccounts, Title = a).AccountName),
    LiveBreak: Coalesce(LiveBreak.Value, "No"), Position: Position.Value, Status: Status.Value}), JSONFormat.Compact)
```

6. **`ClockInJson`** — tidak dipakai

```powerfx
"[]"
```

7. **`AbsenceJson`** — tidak dipakai

```powerfx
"[]"
```

8. **`BrandsJson`**

```powerfx
JSON(ForAll(colBrands, {Title: Title, NamaBrand: NamaBrand}), JSONFormat.Compact)
```

9. **`HasMore`**

```powerfx
false
```

10. **`IsLoading`**

```powerfx
varMrLoading
```

11. **`ReferenceDate`** — kosong

```powerfx
""
```

12. **`ActionResult`** — layar ini tidak punya aksi yang mengunci

```powerfx
""
```

**7.4 `OnChange` control** — properti **OnChange** control yang sama, tempel utuh:

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

**7.5 Cek cepat.** Ganti bulan di control → daftar berganti (OnChange mengisi `varMrPeriod` lalu memuat ulang). Klik report → `scrMyReportDetail` terbuka.

## Langkah 8 — Layar Kirim / revisi report (`scrMyReportDetail`)

Dibuka oleh `NEW_REPORT` (mengisi `varRptSchedule`, `varRptId` kosong) atau `OPEN_REPORT` (mengisi `varRptId`).

**8.1 Buat layar dan control.** Buat layar baru bernama `scrMyReportDetail`. Insert → *Get more components* → tab **Code** → pilih **PBS Host App My Report Detail** → Import, lalu tarik control itu ke layar. Atur X = 0, Y = 0, Width = `Parent.Width`, Height = `Parent.Height` (atau area konten kalau ada header/tab bar).

**8.2 `scrMyReportDetail.OnVisible`** — pilih layar (bukan control), properti **OnVisible**:

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
ClearCollect(colMrdHist, FirstN(Sort(Filter('Report - PBS Hub', HostID = varMe.Title), ID, SortOrder.Descending), 10));
Set(varMrdLoading, false)
```

**8.3 Properti control** — pilih control di layar ini, isi properti berikut satu per satu (panel kanan → *Advanced*, atau formula bar):

1. **`Context`**

```powerfx
varHostCtx
```

2. **`HostJson`**

```powerfx
JSON(ForAll(Table(varMe), {Title: Title, HostCode: HostCode, NamaHost: NamaHost, Email: Email.Email,
    Package: Package.Value, CurrentScore: CurrentScore, InitialScore: InitialScore}), JSONFormat.Compact)
```

3. **`ReportJson`** — kosong = form Send Report; `Need Revision` = form revisi; lainnya = baca saja

```powerfx
If(IsBlank(varMrdRep), "[]", JSON(ForAll(Table(varMrdRep), {ID: ID, Title: Title, ScheduleID: ScheduleID, HostID: HostID, BrandID: BrandID, AccountID: AccountID,
    Account: Account.Value, Platform: Platform.Value, LiveDate: Text(LiveDate, "yyyy-mm-dd"), LiveID: LiveID,
    Playbook: Playbook.Value, Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual,
    JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)',
    AddToCart: AddToCart, TotalViewer: TotalViewer, Comment: Comment, ApprovalStatus: ApprovalStatus.Value,
    ApprovalComment: ApprovalComment, Approver: Approver.DisplayName, ApproverEmail: ApproverEmail,
    Attachment: Attachment, Created: Created, Modified: Modified}), JSONFormat.Compact))
```

4. **`ScheduleJson`**

```powerfx
If(IsBlank(varMrdSch), "[]", JSON(ForAll(Table(varMrdSch), {ID: ID, Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime,
    BrandID: BrandID, StudioID: StudioID, HostID: HostID, Platform: Platform.Value,
    AccountID: Account, AccountName: With({a: Account}, LookUp(colAccounts, Title = a).AccountName),
    LiveBreak: Coalesce(LiveBreak.Value, "No"), Position: Position.Value, Status: Status.Value}), JSONFormat.Compact))
```

5. **`EvidenceJson`**

```powerfx
JSON(ForAll(colMrdEvi, {ID: ID, Title: Title, HostID: HostID, ScheduleID: ScheduleID, AccountID: AccountID, Platform: Platform.Value,
    Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual, JumlahPembeli: JumlahPembeli, CTR: CTR,
    CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)', AddToCart: AddToCart, TotalViewer: TotalViewer,
    Comment: Comment, Status: Status.Value, Attachment: Attachment, Created: Created}), JSONFormat.Compact)
```

6. **`ClockInJson`**

```powerfx
JSON(ForAll(colMrdClk, {ID: ID, ClockInDate: Text(ClockInDate, "yyyy-mm-dd"), CheckInTime: CheckInTime, CheckOutTime: CheckOutTime,
    ClockInTime: ClockInTime, ClockOutTime: ClockOutTime, CheckInOffice: CheckInOffice, IsInsideGeofence: IsInsideGeofence}), JSONFormat.Compact)
```

7. **`AbsenceJson`**

```powerfx
JSON(ForAll(colMrdAbs, {Title: Title, ScheduleID: ScheduleID, LiveDate: Text(LiveDate, "yyyy-mm-dd"), Created: Created}), JSONFormat.Compact)
```

8. **`HistoryJson`** — boleh `"[]"`

```powerfx
JSON(ForAll(colMrdHist, {ID: ID, Title: Title, ScheduleID: ScheduleID, HostID: HostID, BrandID: BrandID, AccountID: AccountID,
    Account: Account.Value, Platform: Platform.Value, LiveDate: Text(LiveDate, "yyyy-mm-dd"), LiveID: LiveID,
    Playbook: Playbook.Value, Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual,
    JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)',
    AddToCart: AddToCart, TotalViewer: TotalViewer, Comment: Comment, ApprovalStatus: ApprovalStatus.Value,
    ApprovalComment: ApprovalComment, Approver: Approver.DisplayName, ApproverEmail: ApproverEmail,
    Attachment: Attachment, Created: Created, Modified: Modified}), JSONFormat.Compact)
```

9. **`BrandsJson`**

```powerfx
JSON(ForAll(colBrands, {Title: Title, NamaBrand: NamaBrand}), JSONFormat.Compact)
```

10. **`StudiosJson`**

```powerfx
JSON(ForAll(colStudios, {Title: Title, NamaStudio: NamaStudio}), JSONFormat.Compact)
```

11. **`SessionReportsJson`** — semua bagian report sesi ini, untuk menjumlah durasi

```powerfx
JSON(ForAll(colMrdSesRep, {ID: ID, Title: Title, ScheduleID: ScheduleID, HostID: HostID, BrandID: BrandID, AccountID: AccountID,
    Account: Account.Value, Platform: Platform.Value, LiveDate: Text(LiveDate, "yyyy-mm-dd"), LiveID: LiveID,
    Playbook: Playbook.Value, Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual,
    JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)',
    AddToCart: AddToCart, TotalViewer: TotalViewer, Comment: Comment, ApprovalStatus: ApprovalStatus.Value,
    ApprovalComment: ApprovalComment, Approver: Approver.DisplayName, ApproverEmail: ApproverEmail,
    Attachment: Attachment, Created: Created, Modified: Modified}), JSONFormat.Compact)
```

12. **`PlaybooksJson`**

```powerfx
JSON(Choices([@'Report - PBS Hub'].Playbook), JSONFormat.Compact)
```

13. **`IsLoading`**

```powerfx
varMrdLoading
```

14. **`ReferenceDate`** — kosong

```powerfx
""
```

15. **`ActionResult`**

```powerfx
varMrdResult
```

**8.4 `OnChange` control** — properti **OnChange** control yang sama, tempel utuh:

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
                                                With({{tDate: s.Date}},
                                                With({{clk: LookUp('Clock In - PBS Hub', HostID = varMe.Title && ClockInDate = tDate),
                                                      schDay: Filter('Schedule - PBS Hub', HostID = varMe.Title && Date = tDate),
                                                      repDay: Filter('Report - PBS Hub', HostID = varMe.Title && LiveDate = tDate),
                                                      t1: LookUp(colTierConfig, Title = "Tier 1"), t2: LookUp(colTierConfig, Title = "Tier 2"),
                                                      t3: LookUp(colTierConfig, Title = "Tier 3")}},
                                                If(!IsBlank(clk),
                                                // Segmen jadwal aktif (bukan Cancelled, jam lengkap). Lewat tengah malam: EndMin + 1440.
                                                With({{seg: ForAll(Filter(schDay, !IsBlank(StartTime) && !IsBlank(EndTime) && Status.Value <> "Cancelled") As S,
                                                            With({{sm: Hour(TimeValue(S.StartTime)) * 60 + Minute(TimeValue(S.StartTime)),
                                                                  em: Hour(TimeValue(S.EndTime)) * 60 + Minute(TimeValue(S.EndTime))}},
                                                                {{Title: S.Title, BrandID: S.BrandID, StartTime: S.StartTime, EndTime: S.EndTime,
                                                                 Co: S.Position.Value = "Co-Host",          // "Host" / "Main Host" = main host
                                                                 StartMin: sm, EndMin: If(em >= sm, em, em + 1440)}}))}},
                                                With({{mainSeg: Filter(seg, !Co), mainMin: Sum(Filter(seg, !Co), EndMin - StartMin), coMin: Sum(Filter(seg, Co), EndMin - StartMin)}},
                                                // Grid 15 menit selama 2 hari (0–2880): slot yang tertutup jadwal main host.
                                                With({{slots: ForAll(Sequence(2880 / varSlotMin, 0, 1) As Sl,
                                                            With({{ms: Sl.Value * varSlotMin}}, {{SlotStart: ms, Covered: !IsEmpty(Filter(mainSeg, StartMin <= ms && EndMin > ms))}}))}},
                                                With({{liveMin: CountRows(Filter(slots, Covered)) * varSlotMin,
                                                      t1Win: CountRows(Filter(slots, Covered && (SlotStart < 360 || (SlotStart >= 1440 && SlotStart < 1800)))) * varSlotMin,     // 00:00–06:00
                                                      t2Win: CountRows(Filter(slots, Covered && ((SlotStart >= 1260 && SlotStart < 1440) || SlotStart >= 2700))) * varSlotMin,  // 21:00–24:00
                                                      // Akun terbaik hari itu: TotalViewer dijumlah, Peak dan CTR diambil maksimum.
                                                      best: First(Sort(ForAll(Distinct(repDay, Account.Value) As D,
                                                                With({{r: Filter(repDay, Account.Value = D.Value)}},
                                                                    {{Account: D.Value, TotalViewer: Sum(r, TotalViewer), PeakViewer: Max(r, PeakViewer), CTR: Max(r, CTR)}})),
                                                            TotalViewer * PeakViewer * CTR, SortOrder.Descending))}},
                                                With({{m1: !IsBlank(best) && best.TotalViewer >= t1.MinViews && best.CTR >= t1.CTR && best.PeakViewer >= t1.AvgViewDur,
                                                      m2: !IsBlank(best) && best.TotalViewer >= t2.MinViews && best.CTR >= t2.CTR && best.PeakViewer >= t2.AvgViewDur,
                                                      m3: !IsBlank(best) && best.TotalViewer >= t3.MinViews && best.CTR >= t3.CTR && best.PeakViewer >= t3.AvgViewDur,
                                                      d1: liveMin >= t1.Duration * 60, d2: liveMin >= t2.Duration * 60, d3: liveMin >= t3.Duration * 60,
                                                      w1: t1Win >= varT1MinInWindow, w2: t2Win >= varT2MinInWindow,
                                                      jam: Round(liveMin / 60, 2), main: mainMin > coMin,
                                                      hol: tDate in varHolidays, wkd: Weekday(tDate) = 1 || Weekday(tDate) = 7}},
                                                With({{calc: If(m1 || d1 || w1, "Tier 1", m2 || d2 || w2, "Tier 2", m3 || d3, "Tier 3", "No")}},
                                                // Urutan: Co-Host mayoritas → No; tanggal merah → Tier 1; Sabtu/Minggu → minimal Tier 2.
                                                With({{tier: If(!main, "No", hol, "Tier 1", wkd && calc <> "Tier 1", "Tier 2", calc)}},
                                                    Patch('Clock In - PBS Hub', clk, {{
                                                        Tier: {{Value: tier}},
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
                                                            Concat(Sort(mainSeg, StartMin), With({{b: BrandID}},
                                                                Title & "_" & LookUp(colBrands, Title = b).NamaBrand & "_" & Substitute(StartTime, ":", ".") & "-" & Substitute(EndTime, ":", ".")), ", "),
                                                            "Not Eligible - Main Host " & Round(mainMin / 60, 2) & " jam vs Co-Host " & Round(coMin / 60, 2) & " jam"),
                                                        statusupdate: If(clk.Tier.Value = tier, "Tier tetap " & tier & " (tidak ada perubahan)",
                                                            "Berhasil update dari " & Coalesce(clk.Tier.Value, "-") & " → " & tier)
                                                    }})
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
                                                With({{tDate: s.Date}},
                                                With({{clk: LookUp('Clock In - PBS Hub', HostID = varMe.Title && ClockInDate = tDate),
                                                      schDay: Filter('Schedule - PBS Hub', HostID = varMe.Title && Date = tDate),
                                                      repDay: Filter('Report - PBS Hub', HostID = varMe.Title && LiveDate = tDate),
                                                      t1: LookUp(colTierConfig, Title = "Tier 1"), t2: LookUp(colTierConfig, Title = "Tier 2"),
                                                      t3: LookUp(colTierConfig, Title = "Tier 3")}},
                                                If(!IsBlank(clk),
                                                // Segmen jadwal aktif (bukan Cancelled, jam lengkap). Lewat tengah malam: EndMin + 1440.
                                                With({{seg: ForAll(Filter(schDay, !IsBlank(StartTime) && !IsBlank(EndTime) && Status.Value <> "Cancelled") As S,
                                                            With({{sm: Hour(TimeValue(S.StartTime)) * 60 + Minute(TimeValue(S.StartTime)),
                                                                  em: Hour(TimeValue(S.EndTime)) * 60 + Minute(TimeValue(S.EndTime))}},
                                                                {{Title: S.Title, BrandID: S.BrandID, StartTime: S.StartTime, EndTime: S.EndTime,
                                                                 Co: S.Position.Value = "Co-Host",          // "Host" / "Main Host" = main host
                                                                 StartMin: sm, EndMin: If(em >= sm, em, em + 1440)}}))}},
                                                With({{mainSeg: Filter(seg, !Co), mainMin: Sum(Filter(seg, !Co), EndMin - StartMin), coMin: Sum(Filter(seg, Co), EndMin - StartMin)}},
                                                // Grid 15 menit selama 2 hari (0–2880): slot yang tertutup jadwal main host.
                                                With({{slots: ForAll(Sequence(2880 / varSlotMin, 0, 1) As Sl,
                                                            With({{ms: Sl.Value * varSlotMin}}, {{SlotStart: ms, Covered: !IsEmpty(Filter(mainSeg, StartMin <= ms && EndMin > ms))}}))}},
                                                With({{liveMin: CountRows(Filter(slots, Covered)) * varSlotMin,
                                                      t1Win: CountRows(Filter(slots, Covered && (SlotStart < 360 || (SlotStart >= 1440 && SlotStart < 1800)))) * varSlotMin,     // 00:00–06:00
                                                      t2Win: CountRows(Filter(slots, Covered && ((SlotStart >= 1260 && SlotStart < 1440) || SlotStart >= 2700))) * varSlotMin,  // 21:00–24:00
                                                      // Akun terbaik hari itu: TotalViewer dijumlah, Peak dan CTR diambil maksimum.
                                                      best: First(Sort(ForAll(Distinct(repDay, Account.Value) As D,
                                                                With({{r: Filter(repDay, Account.Value = D.Value)}},
                                                                    {{Account: D.Value, TotalViewer: Sum(r, TotalViewer), PeakViewer: Max(r, PeakViewer), CTR: Max(r, CTR)}})),
                                                            TotalViewer * PeakViewer * CTR, SortOrder.Descending))}},
                                                With({{m1: !IsBlank(best) && best.TotalViewer >= t1.MinViews && best.CTR >= t1.CTR && best.PeakViewer >= t1.AvgViewDur,
                                                      m2: !IsBlank(best) && best.TotalViewer >= t2.MinViews && best.CTR >= t2.CTR && best.PeakViewer >= t2.AvgViewDur,
                                                      m3: !IsBlank(best) && best.TotalViewer >= t3.MinViews && best.CTR >= t3.CTR && best.PeakViewer >= t3.AvgViewDur,
                                                      d1: liveMin >= t1.Duration * 60, d2: liveMin >= t2.Duration * 60, d3: liveMin >= t3.Duration * 60,
                                                      w1: t1Win >= varT1MinInWindow, w2: t2Win >= varT2MinInWindow,
                                                      jam: Round(liveMin / 60, 2), main: mainMin > coMin,
                                                      hol: tDate in varHolidays, wkd: Weekday(tDate) = 1 || Weekday(tDate) = 7}},
                                                With({{calc: If(m1 || d1 || w1, "Tier 1", m2 || d2 || w2, "Tier 2", m3 || d3, "Tier 3", "No")}},
                                                // Urutan: Co-Host mayoritas → No; tanggal merah → Tier 1; Sabtu/Minggu → minimal Tier 2.
                                                With({{tier: If(!main, "No", hol, "Tier 1", wkd && calc <> "Tier 1", "Tier 2", calc)}},
                                                    Patch('Clock In - PBS Hub', clk, {{
                                                        Tier: {{Value: tier}},
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
                                                            Concat(Sort(mainSeg, StartMin), With({{b: BrandID}},
                                                                Title & "_" & LookUp(colBrands, Title = b).NamaBrand & "_" & Substitute(StartTime, ":", ".") & "-" & Substitute(EndTime, ":", ".")), ", "),
                                                            "Not Eligible - Main Host " & Round(mainMin / 60, 2) & " jam vs Co-Host " & Round(coMin / 60, 2) & " jam"),
                                                        statusupdate: If(clk.Tier.Value = tier, "Tier tetap " & tier & " (tidak ada perubahan)",
                                                            "Berhasil update dari " & Coalesce(clk.Tier.Value, "-") & " → " & tier)
                                                    }})
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
                                        With({{tDate: cur.LiveDate}},
                                        With({{clk: LookUp('Clock In - PBS Hub', HostID = varMe.Title && ClockInDate = tDate),
                                              schDay: Filter('Schedule - PBS Hub', HostID = varMe.Title && Date = tDate),
                                              repDay: Filter('Report - PBS Hub', HostID = varMe.Title && LiveDate = tDate),
                                              t1: LookUp(colTierConfig, Title = "Tier 1"), t2: LookUp(colTierConfig, Title = "Tier 2"),
                                              t3: LookUp(colTierConfig, Title = "Tier 3")}},
                                        If(!IsBlank(clk),
                                        // Segmen jadwal aktif (bukan Cancelled, jam lengkap). Lewat tengah malam: EndMin + 1440.
                                        With({{seg: ForAll(Filter(schDay, !IsBlank(StartTime) && !IsBlank(EndTime) && Status.Value <> "Cancelled") As S,
                                                    With({{sm: Hour(TimeValue(S.StartTime)) * 60 + Minute(TimeValue(S.StartTime)),
                                                          em: Hour(TimeValue(S.EndTime)) * 60 + Minute(TimeValue(S.EndTime))}},
                                                        {{Title: S.Title, BrandID: S.BrandID, StartTime: S.StartTime, EndTime: S.EndTime,
                                                         Co: S.Position.Value = "Co-Host",          // "Host" / "Main Host" = main host
                                                         StartMin: sm, EndMin: If(em >= sm, em, em + 1440)}}))}},
                                        With({{mainSeg: Filter(seg, !Co), mainMin: Sum(Filter(seg, !Co), EndMin - StartMin), coMin: Sum(Filter(seg, Co), EndMin - StartMin)}},
                                        // Grid 15 menit selama 2 hari (0–2880): slot yang tertutup jadwal main host.
                                        With({{slots: ForAll(Sequence(2880 / varSlotMin, 0, 1) As Sl,
                                                    With({{ms: Sl.Value * varSlotMin}}, {{SlotStart: ms, Covered: !IsEmpty(Filter(mainSeg, StartMin <= ms && EndMin > ms))}}))}},
                                        With({{liveMin: CountRows(Filter(slots, Covered)) * varSlotMin,
                                              t1Win: CountRows(Filter(slots, Covered && (SlotStart < 360 || (SlotStart >= 1440 && SlotStart < 1800)))) * varSlotMin,     // 00:00–06:00
                                              t2Win: CountRows(Filter(slots, Covered && ((SlotStart >= 1260 && SlotStart < 1440) || SlotStart >= 2700))) * varSlotMin,  // 21:00–24:00
                                              // Akun terbaik hari itu: TotalViewer dijumlah, Peak dan CTR diambil maksimum.
                                              best: First(Sort(ForAll(Distinct(repDay, Account.Value) As D,
                                                        With({{r: Filter(repDay, Account.Value = D.Value)}},
                                                            {{Account: D.Value, TotalViewer: Sum(r, TotalViewer), PeakViewer: Max(r, PeakViewer), CTR: Max(r, CTR)}})),
                                                    TotalViewer * PeakViewer * CTR, SortOrder.Descending))}},
                                        With({{m1: !IsBlank(best) && best.TotalViewer >= t1.MinViews && best.CTR >= t1.CTR && best.PeakViewer >= t1.AvgViewDur,
                                              m2: !IsBlank(best) && best.TotalViewer >= t2.MinViews && best.CTR >= t2.CTR && best.PeakViewer >= t2.AvgViewDur,
                                              m3: !IsBlank(best) && best.TotalViewer >= t3.MinViews && best.CTR >= t3.CTR && best.PeakViewer >= t3.AvgViewDur,
                                              d1: liveMin >= t1.Duration * 60, d2: liveMin >= t2.Duration * 60, d3: liveMin >= t3.Duration * 60,
                                              w1: t1Win >= varT1MinInWindow, w2: t2Win >= varT2MinInWindow,
                                              jam: Round(liveMin / 60, 2), main: mainMin > coMin,
                                              hol: tDate in varHolidays, wkd: Weekday(tDate) = 1 || Weekday(tDate) = 7}},
                                        With({{calc: If(m1 || d1 || w1, "Tier 1", m2 || d2 || w2, "Tier 2", m3 || d3, "Tier 3", "No")}},
                                        // Urutan: Co-Host mayoritas → No; tanggal merah → Tier 1; Sabtu/Minggu → minimal Tier 2.
                                        With({{tier: If(!main, "No", hol, "Tier 1", wkd && calc <> "Tier 1", "Tier 2", calc)}},
                                            Patch('Clock In - PBS Hub', clk, {{
                                                Tier: {{Value: tier}},
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
                                                    Concat(Sort(mainSeg, StartMin), With({{b: BrandID}},
                                                        Title & "_" & LookUp(colBrands, Title = b).NamaBrand & "_" & Substitute(StartTime, ":", ".") & "-" & Substitute(EndTime, ":", ".")), ", "),
                                                    "Not Eligible - Main Host " & Round(mainMin / 60, 2) & " jam vs Co-Host " & Round(coMin / 60, 2) & " jam"),
                                                statusupdate: If(clk.Tier.Value = tier, "Tier tetap " & tier & " (tidak ada perubahan)",
                                                    "Berhasil update dari " & Coalesce(clk.Tier.Value, "-") & " → " & tier)
                                            }})
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

**8.5 Cek cepat.** Dari Report saya klik report yang *Perlu revisi* → form revisi muncul dengan angka lama.

## Langkah 9 — Layar Jadwal saya (`scrMySchedule`)

Tabel / kalender sesi sebulan, KPI, strip Hari ini (clock in, absen), filter.

**9.1 Buat layar dan control.** Buat layar baru bernama `scrMySchedule`. Insert → *Get more components* → tab **Code** → pilih **PBS Host App My Schedule** → Import, lalu tarik control itu ke layar. Atur X = 0, Y = 0, Width = `Parent.Width`, Height = `Parent.Height` (atau area konten kalau ada header/tab bar).

**9.2 `scrMySchedule.OnVisible`** — pilih layar (bukan control), properti **OnVisible**:

```powerfx
Set(varMsLoading, true);
With({from: If(IsBlank(varMsPeriod), Date(Year(Today()), Month(Today()), 1), DateValue(varMsPeriod & "-01"))},
    With({to: DateAdd(from, 1, TimeUnit.Months)},
        ClearCollect(colMsSch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date >= from, Date < to));
        ClearCollect(colMsClk, Filter('Clock In - PBS Hub', HostID = varMe.Title, ClockInDate >= from, ClockInDate < to));
        ClearCollect(colMsAbs, Filter('Host Absence - PBS Hub', HostID = varMe.Title, LiveDate >= from, LiveDate < to));
        ClearCollect(colMsRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate >= from, LiveDate < to))
    )
);
Set(varMsLoading, false)
```

**9.3 Properti control** — pilih control di layar ini, isi properti berikut satu per satu (panel kanan → *Advanced*, atau formula bar):

1. **`Context`**

```powerfx
varHostCtx
```

2. **`Period`** — `yyyy-mm`; kosong = bulan ini

```powerfx
varMsPeriod
```

3. **`DefaultFilter`** — kosong, `ACTION`, `PLANNED`, `FINISHED`, `CANCELLED`

```powerfx
varMsFilter
```

4. **`DefaultView`** — `List` atau `Calendar`

```powerfx
Coalesce(varMsView, "List")
```

5. **`HostJson`**

```powerfx
JSON(ForAll(Table(varMe), {Title: Title, HostCode: HostCode, NamaHost: NamaHost, Email: Email.Email,
    Package: Package.Value, CurrentScore: CurrentScore, InitialScore: InitialScore}), JSONFormat.Compact)
```

6. **`SchedulesJson`**

```powerfx
JSON(ForAll(colMsSch, {ID: ID, Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime,
    BrandID: BrandID, StudioID: StudioID, HostID: HostID, Platform: Platform.Value,
    AccountID: Account, AccountName: With({a: Account}, LookUp(colAccounts, Title = a).AccountName),
    LiveBreak: Coalesce(LiveBreak.Value, "No"), Position: Position.Value, Status: Status.Value}), JSONFormat.Compact)
```

7. **`ClockInJson`**

```powerfx
JSON(ForAll(colMsClk, {ID: ID, ClockInDate: Text(ClockInDate, "yyyy-mm-dd"), CheckInTime: CheckInTime, CheckOutTime: CheckOutTime,
    ClockInTime: ClockInTime, ClockOutTime: ClockOutTime, CheckInOffice: CheckInOffice, IsInsideGeofence: IsInsideGeofence}), JSONFormat.Compact)
```

8. **`AbsenceJson`**

```powerfx
JSON(ForAll(colMsAbs, {Title: Title, ScheduleID: ScheduleID, LiveDate: Text(LiveDate, "yyyy-mm-dd"), Created: Created}), JSONFormat.Compact)
```

9. **`ReportsJson`**

```powerfx
JSON(ForAll(colMsRep, {ID: ID, Title: Title, ScheduleID: ScheduleID, HostID: HostID, BrandID: BrandID, AccountID: AccountID,
    Account: Account.Value, Platform: Platform.Value, LiveDate: Text(LiveDate, "yyyy-mm-dd"), LiveID: LiveID,
    Playbook: Playbook.Value, Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual,
    JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)',
    AddToCart: AddToCart, TotalViewer: TotalViewer, Comment: Comment, ApprovalStatus: ApprovalStatus.Value,
    ApprovalComment: ApprovalComment, Approver: Approver.DisplayName, ApproverEmail: ApproverEmail,
    Attachment: Attachment, Created: Created, Modified: Modified}), JSONFormat.Compact)
```

10. **`BrandsJson`**

```powerfx
JSON(ForAll(colBrands, {Title: Title, NamaBrand: NamaBrand}), JSONFormat.Compact)
```

11. **`StudiosJson`**

```powerfx
JSON(ForAll(colStudios, {Title: Title, NamaStudio: NamaStudio}), JSONFormat.Compact)
```

12. **`HasMore`**

```powerfx
false
```

13. **`IsLoading`**

```powerfx
varMsLoading
```

14. **`ReferenceDate`** — kosong

```powerfx
""
```

15. **`ActionResult`**

```powerfx
varMsResult
```

**9.4 `OnChange` control** — properti **OnChange** control yang sama, tempel utuh:

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
                                                With({{tDate: s.Date}},
                                                With({{clk: LookUp('Clock In - PBS Hub', HostID = varMe.Title && ClockInDate = tDate),
                                                      schDay: Filter('Schedule - PBS Hub', HostID = varMe.Title && Date = tDate),
                                                      repDay: Filter('Report - PBS Hub', HostID = varMe.Title && LiveDate = tDate),
                                                      t1: LookUp(colTierConfig, Title = "Tier 1"), t2: LookUp(colTierConfig, Title = "Tier 2"),
                                                      t3: LookUp(colTierConfig, Title = "Tier 3")}},
                                                If(!IsBlank(clk),
                                                // Segmen jadwal aktif (bukan Cancelled, jam lengkap). Lewat tengah malam: EndMin + 1440.
                                                With({{seg: ForAll(Filter(schDay, !IsBlank(StartTime) && !IsBlank(EndTime) && Status.Value <> "Cancelled") As S,
                                                            With({{sm: Hour(TimeValue(S.StartTime)) * 60 + Minute(TimeValue(S.StartTime)),
                                                                  em: Hour(TimeValue(S.EndTime)) * 60 + Minute(TimeValue(S.EndTime))}},
                                                                {{Title: S.Title, BrandID: S.BrandID, StartTime: S.StartTime, EndTime: S.EndTime,
                                                                 Co: S.Position.Value = "Co-Host",          // "Host" / "Main Host" = main host
                                                                 StartMin: sm, EndMin: If(em >= sm, em, em + 1440)}}))}},
                                                With({{mainSeg: Filter(seg, !Co), mainMin: Sum(Filter(seg, !Co), EndMin - StartMin), coMin: Sum(Filter(seg, Co), EndMin - StartMin)}},
                                                // Grid 15 menit selama 2 hari (0–2880): slot yang tertutup jadwal main host.
                                                With({{slots: ForAll(Sequence(2880 / varSlotMin, 0, 1) As Sl,
                                                            With({{ms: Sl.Value * varSlotMin}}, {{SlotStart: ms, Covered: !IsEmpty(Filter(mainSeg, StartMin <= ms && EndMin > ms))}}))}},
                                                With({{liveMin: CountRows(Filter(slots, Covered)) * varSlotMin,
                                                      t1Win: CountRows(Filter(slots, Covered && (SlotStart < 360 || (SlotStart >= 1440 && SlotStart < 1800)))) * varSlotMin,     // 00:00–06:00
                                                      t2Win: CountRows(Filter(slots, Covered && ((SlotStart >= 1260 && SlotStart < 1440) || SlotStart >= 2700))) * varSlotMin,  // 21:00–24:00
                                                      // Akun terbaik hari itu: TotalViewer dijumlah, Peak dan CTR diambil maksimum.
                                                      best: First(Sort(ForAll(Distinct(repDay, Account.Value) As D,
                                                                With({{r: Filter(repDay, Account.Value = D.Value)}},
                                                                    {{Account: D.Value, TotalViewer: Sum(r, TotalViewer), PeakViewer: Max(r, PeakViewer), CTR: Max(r, CTR)}})),
                                                            TotalViewer * PeakViewer * CTR, SortOrder.Descending))}},
                                                With({{m1: !IsBlank(best) && best.TotalViewer >= t1.MinViews && best.CTR >= t1.CTR && best.PeakViewer >= t1.AvgViewDur,
                                                      m2: !IsBlank(best) && best.TotalViewer >= t2.MinViews && best.CTR >= t2.CTR && best.PeakViewer >= t2.AvgViewDur,
                                                      m3: !IsBlank(best) && best.TotalViewer >= t3.MinViews && best.CTR >= t3.CTR && best.PeakViewer >= t3.AvgViewDur,
                                                      d1: liveMin >= t1.Duration * 60, d2: liveMin >= t2.Duration * 60, d3: liveMin >= t3.Duration * 60,
                                                      w1: t1Win >= varT1MinInWindow, w2: t2Win >= varT2MinInWindow,
                                                      jam: Round(liveMin / 60, 2), main: mainMin > coMin,
                                                      hol: tDate in varHolidays, wkd: Weekday(tDate) = 1 || Weekday(tDate) = 7}},
                                                With({{calc: If(m1 || d1 || w1, "Tier 1", m2 || d2 || w2, "Tier 2", m3 || d3, "Tier 3", "No")}},
                                                // Urutan: Co-Host mayoritas → No; tanggal merah → Tier 1; Sabtu/Minggu → minimal Tier 2.
                                                With({{tier: If(!main, "No", hol, "Tier 1", wkd && calc <> "Tier 1", "Tier 2", calc)}},
                                                    Patch('Clock In - PBS Hub', clk, {{
                                                        Tier: {{Value: tier}},
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
                                                            Concat(Sort(mainSeg, StartMin), With({{b: BrandID}},
                                                                Title & "_" & LookUp(colBrands, Title = b).NamaBrand & "_" & Substitute(StartTime, ":", ".") & "-" & Substitute(EndTime, ":", ".")), ", "),
                                                            "Not Eligible - Main Host " & Round(mainMin / 60, 2) & " jam vs Co-Host " & Round(coMin / 60, 2) & " jam"),
                                                        statusupdate: If(clk.Tier.Value = tier, "Tier tetap " & tier & " (tidak ada perubahan)",
                                                            "Berhasil update dari " & Coalesce(clk.Tier.Value, "-") & " → " & tier)
                                                    }})
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

**9.5 Cek cepat.** Ganti bulan → jadwal berganti. Toggle Kalender → tetap Kalender saat kembali ke layar.

## Langkah 10 — Layar Clock in (`scrClockIn`)

Clock in dan clock out: GPS terhadap radius `Studio Location - PBS`, selfie, alasan kalau di luar radius. Kolom `Clock In - PBS Hub` yang ditulis: `HostID, HostName, EmployeeName, EmployeeEmail, ClockInDate, CheckInTime, ClockInTime, Status, HKTugas, ScheduleCount, CheckInLatitude/Longitude/Accuracy/Distance, CheckInOffice, IsInsideGeofence, Reason, SelfieSource, SelfiePhotoUrl`, dan saat clock out `CheckOutTime, ClockOutDate, CheckOut…, WorkingDuration, TotalReports, SelfieOutPhotoUrl`. Hapus dari formula kolom yang tidak ada di list kamu.

**10.1 Buat layar dan control.** Buat layar baru bernama `scrClockIn`. Insert → *Get more components* → tab **Code** → pilih **PBS Host App Clock In** → Import, lalu tarik control itu ke layar. Atur X = 0, Y = 0, Width = `Parent.Width`, Height = `Parent.Height` (atau area konten kalau ada header/tab bar).

**10.2 `scrClockIn.OnVisible`** — pilih layar (bukan control), properti **OnVisible**:

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

**10.3 Properti control** — pilih control di layar ini, isi properti berikut satu per satu (panel kanan → *Advanced*, atau formula bar):

1. **`Context`**

```powerfx
varHostCtx
```

2. **`HostJson`**

```powerfx
JSON(ForAll(Table(varMe), {Title: Title, HostCode: HostCode, NamaHost: NamaHost, Email: Email.Email,
    Package: Package.Value, CurrentScore: CurrentScore, InitialScore: InitialScore}), JSONFormat.Compact)
```

3. **`LocationsJson`**

```powerfx
JSON(ForAll(colCkLoc, {Title: Title, LocationID: LocationID, Latitude: Latitude, Longitude: Longitude, RadiusMeter: RadiusMeter, IsActive: IsActive}), JSONFormat.Compact)
```

4. **`ClockInJson`**

```powerfx
JSON(ForAll(colCkClk, {ID: ID, Title: Title, HostID: HostID, ClockInDate: Text(ClockInDate, "yyyy-mm-dd"), CheckInTime: CheckInTime, CheckOutTime: CheckOutTime, ClockInTime: ClockInTime, CheckInOffice: CheckInOffice, Reason: Reason}), JSONFormat.Compact)
```

5. **`SchedulesJson`**

```powerfx
JSON(ForAll(colCkSch, {Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime, HostID: HostID, Status: Status.Value}), JSONFormat.Compact)
```

6. **`ReportsJson`**

```powerfx
JSON(ForAll(colCkRep, {Title: Title, ScheduleID: ScheduleID, HostID: HostID, LiveDate: Text(LiveDate, "yyyy-mm-dd")}), JSONFormat.Compact)
```

7. **`DeviceLocationJson`** — cadangan kalau GPS browser ditolak

```powerfx
JSON({Latitude: Location.Latitude, Longitude: Location.Longitude}, JSONFormat.Compact)
```

8. **`IsLoading`**

```powerfx
varCkLoading
```

9. **`ReferenceDate`** — kosong

```powerfx
""
```

10. **`ActionResult`**

```powerfx
varCkResult
```

**10.4 `OnChange` control** — properti **OnChange** control yang sama, tempel utuh:

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

**10.5 Cek cepat.** Clock in → baris `CLK-…` baru dengan `SelfiePhotoUrl`; kembali ke Hari ini kartu shift berubah jadi *Sedang shift*.

## Langkah 11 — Tes alur report dari awal sampai akhir

Pakai satu jadwal milik akunmu (`HostID = varMe.Title`), hari ini, **sudah mulai**, durasi 120 menit, platform Shopee,
`Status = Planned`, `Position = Host`.

| # | Langkah | Yang terlihat di control | Yang ada di SharePoint |
|---|---|---|---|
| 1 | Clock in di `scrClockIn` | *Clock in tersimpan* | Clock In `CLK-…` |
| 2 | Buka sesi di `scrScheduleDetail` | Send Report nonaktif: *Absen sesi ini belum tercatat* | — |
| 3 | **Absen** → *Tidak* → Absen | *Absen tercatat*, Send Report aktif | Host Absence `ABS-…`; Schedule `Status = Waiting Report` |
| 4 | **Send Report**: Live ID `111`, Durasi `60`, semua angka, screenshot | *Kurang 60 menit*, tombol jadi **Send Report berikutnya** | Report `REP-…` (`Waiting Approval`, LiveID 111, Attachment); Schedule tetap `Waiting Report` |
| 5 | Report berikutnya dengan Live ID `111` | ditolak: *Live ID sudah dipakai* | — |
| 6 | Live ID `222`, Durasi `60` | *Durasi sesi terpenuhi*, tombol hilang | Report kedua; Schedule `Status = Done` |
| 7 | Jadwal TikTok | tidak ada kolom AddToCart | `AddToCart` kosong |
| 8 | Jadwal lain → Absen → *Ya, Live Break* | *Live Break · tanpa report* | Schedule `Done`, `LiveBreak = Yes`; Report semua 0, `ApprovalStatus = LiveBreak` |
| 9 | Jadwal `Position = Co-Host` → Absen | tanpa pop-up, tanpa Send Report | Schedule `Done`, tidak ada Report |
| 10 | Ops set report #4 ke `Need Revision` → buka sesi | form revisi (angka, Live ID, Playbook, Durasi) | — |
| 11 | Durasi jadi `50` → Kirim revisi | *Revisi terkirim* | Report `Waiting Approval Revision`; Schedule kembali `Waiting Report` (110 < 120) |
| 12 | Setelah langkah 4 buka baris Clock In hari ini | — | `Tier`, `Insentif`, `Reason`, `Total_Jam_Live`, `Schedule`, `LastTierUpdate` terisi |
| 13 | Buka folder `Report Automation/<Brand>/<tahun>/<bulan>/REP-…` | — | file `REP-…_Shopee_<Account>_Report.png` bisa dibuka sebagai gambar |

## Langkah 12 — Kalau ada yang tidak jalan

| Gejala | Penyebab | Perbaikan |
|---|---|---|
| *Name isn't valid. 'varXxx' isn't recognized* | variabel belum pernah di-Set | pastikan blok 4 di Langkah 3 ada, lalu **Run OnStart** |
| *No type found for variable 'varMrdRep'* | variabel record hanya di-Set ke `Blank()` | pakai `LookUp('Report - PBS Hub', ID = -1)` seperti Langkah 3 |
| *The type of this argument 'Account' does not match the expected type 'Record'* | `Account` di Report / Host Absence adalah Lookup/Choice | formula OnChange sudah memakai `LookUp(Choices([@'…'].Account), …)`; kalau kolomnya ternyata teks, ganti jadi `LookUp(colAccounts, Title = s.Account).AccountName` |
| Nama akun kosong | `colAccounts` belum dimuat / `Schedule.Account` ≠ `Title` di list Account | Run OnStart; cek isi kedua kolom |
| Klik tombol, spinner berputar terus | OnChange belum ditempel, atau `ActionResult` bukan variabel layar itu | tempel OnChange langkah layar itu; cek `ActionResult` |
| Klik tombol, tidak terjadi apa-apa | `colPbsProcessed` belum ada | Run OnStart |
| Send Report nonaktif *Status jadwal masih Planned* | absen dicatat sebelum OnChange baru terpasang | ubah Status jadwal itu ke `Waiting Report` sekali secara manual |
| *Status jadwal Done, report tidak bisa dikirim* | durasi sudah terpenuhi, atau ejaan Choice beda | cek ejaan Choice = `scheduleWaitingStatus` di Langkah 3 dan teks `"Waiting Report"` di OnChange |
| Error di `Playbook` | pilihan dropdown tidak ada di Choice | `PlaybooksJson` = `JSON(Choices([@'Report - PBS Hub'].Playbook), …)` |
| Report terbuat tapi `Attachment` kosong / error *HttpRequest* | `varSiteID` / `varDriveID` salah, Office 365 Groups belum ditambahkan, atau folder brand belum ada | salin ID dari app upload jadwal; cek `NamaBrand` di list Brand |
| File screenshot ada tapi tidak bisa dibuka (isinya teks) | body data URI tidak diubah jadi binary oleh connector | ganti body jadi hasil flow: buat flow Create file (seperti flow selfie) dengan path yang sama, lalu panggil flow itu sebagai pengganti `HttpRequest` |
| `up.webUrl` error (*untyped / record*) | respons HttpRequest bertipe lain di versi kamu | pakai `Attachment: "Report Automation/…/" & title & "_Report.png"` (path yang sama) |
| Tier tidak berubah setelah report | belum clock in hari itu, atau `ClockInDate` ≠ tanggal live | clock in dulu; jalankan hitung ulang bulanan |
| Notifikasi *Tier belum terhitung* | kolom Tier di Clock In / list `Performance Tier - PBS Hub` belum ada, atau Choice `Tier` tidak punya pilihannya | lihat Langkah 0; report tetap tersimpan |
| *Report ini sudah berubah. Muat ulang dulu* saat revisi | data di layar lama | keluar-masuk layar (OnVisible memuat ulang) |
| Form revisi tidak muncul | `ApprovalStatus` bukan persis `Need Revision` | cek ejaan Choice |
| Kolom tidak ditemukan di sebuah formula | nama kolom di list kamu berbeda / tidak ada | ganti nama, atau hapus field itu dari record (control mengabaikan field yang kosong) |

---

Dibuat dari `scripts/docs/gen_host_setup.py` (jalankan ulang setelah mengubah formula). Rujukan per aksi (payload, arti tiap field): [`HOST-CANVAS-INTEGRATION.md`](HOST-CANVAS-INTEGRATION.md).
