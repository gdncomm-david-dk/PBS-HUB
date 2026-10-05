"""Generates docs/HOST-SETUP.md: the host canvas app set up from scratch, one step after another.

Every screen lists its OnVisible, every control property with the full formula (no "same as screen X")
and the full OnChange, so the page can be followed top to bottom. OnChange handlers come from
host_onchange.py (the same source as section 10 of HOST-CANVAS-INTEGRATION.md); ClockIn's OnChange is
read from section 9 of that document.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import host_onchange as oc  # noqa: E402

ROOT = os.path.join(HERE, "..", "..")
REF = os.path.join(ROOT, "docs", "HOST-CANVAS-INTEGRATION.md")
OUT = os.path.join(ROOT, "docs", "HOST-SETUP.md")

# ---- record shapes (one definition, used by every property) --------------------------------------

SCH = """{ID: ID, Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime,
    BrandID: BrandID, StudioID: StudioID, HostID: HostID, Platform: Platform.Value,
    AccountID: Account, AccountName: With({a: Account}, LookUp(colAccounts, Title = a).AccountName),
    LiveBreak: Coalesce(LiveBreak.Value, "No"), Position: Position.Value, Status: Status.Value}"""

REP = """{ID: ID, Title: Title, ScheduleID: ScheduleID, HostID: HostID, BrandID: BrandID, AccountID: AccountID,
    Account: Account.Value, Platform: Platform.Value, LiveDate: Text(LiveDate, "yyyy-mm-dd"), LiveID: LiveID,
    Playbook: Playbook.Value, Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual,
    JumlahPembeli: JumlahPembeli, CTR: CTR, CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)',
    AddToCart: AddToCart, TotalViewer: TotalViewer, Comment: Comment, ApprovalStatus: ApprovalStatus.Value,
    ApprovalComment: ApprovalComment, Approver: Approver.DisplayName, ApproverEmail: ApproverEmail,
    Attachment: Attachment, Created: Created, Modified: Modified}"""

EVI = """{ID: ID, Title: Title, HostID: HostID, ScheduleID: ScheduleID, AccountID: AccountID, Platform: Platform.Value,
    Penjualan: Penjualan, Pesanan: Pesanan, ProdukTerjual: ProdukTerjual, JumlahPembeli: JumlahPembeli, CTR: CTR,
    CTOR: CTOR, PeakViewer: PeakViewer, DurasiMin: 'Durasi(Min)', AddToCart: AddToCart, TotalViewer: TotalViewer,
    Comment: Comment, Status: Status.Value, Attachment: Attachment, Created: Created}"""

CLK = """{ID: ID, ClockInDate: Text(ClockInDate, "yyyy-mm-dd"), CheckInTime: CheckInTime, CheckOutTime: CheckOutTime, ClockOutDate: Text(ClockOutDate, "yyyy-mm-dd"),
    ClockInTime: ClockInTime, ClockOutTime: ClockOutTime, CheckInOffice: CheckInOffice, IsInsideGeofence: IsInsideGeofence}"""

ABS = """{Title: Title, ScheduleID: ScheduleID, LiveDate: Text(LiveDate, "yyyy-mm-dd"), Created: Created}"""

HOST = """JSON(ForAll(Table(varMe), {Title: Title, HostCode: HostCode, NamaHost: NamaHost, Email: Email.Email,
    Package: Package.Value, CurrentScore: CurrentScore, InitialScore: InitialScore}), JSONFormat.Compact)"""

BRANDS = "JSON(ForAll(colBrands, {Title: Title, NamaBrand: NamaBrand}), JSONFormat.Compact)"
STUDIOS = "JSON(ForAll(colStudios, {Title: Title, NamaStudio: NamaStudio}), JSONFormat.Compact)"
PLAYBOOKS = "JSON(Choices([@'Report - PBS Hub'].Playbook), JSONFormat.Compact)"

TX = """{ID: ID, TransactionID: TransactionID, RuleID: RuleID, TransactionType: TransactionType.Value, Point: Point,
    ScoreBefore: ScoreBefore, ScoreAfter: ScoreAfter, Reason: Reason, Notes: Notes, Status: Status.Value,
    CreatedDate: CreatedDate, CreatedBy: CreatedBy.DisplayName}"""

BANDS = """{ThresholdID: ThresholdID, Label: Label, Description: Description, MinimumScore: MinimumScore,
    MaximumScore: MaximumScore, Tone: Tone.Value, Active: Active, SortOrder: SortOrder}"""


def js(col, rec):
    return f"JSON(ForAll({col}, {rec}), JSONFormat.Compact)"


def code(body, lang="powerfx"):
    return f"```{lang}\n{body.strip()}\n```"


def props(rows):
    """rows: (name, formula, note). Each property gets its own copyable block."""
    out = []
    for i, (name, formula, note) in enumerate(rows, 1):
        head = f"{i}. **`{name}`**" + (f" — {note}" if note else "")
        out.append(head + "\n\n" + code(formula))
    return "\n\n".join(out)


def clockin_onchange():
    ref = open(REF).read()
    sec = ref[ref.index("## 9. ClockIn"): ref.index("## 10. OnChange")]
    blocks = re.findall(r"```powerfx\n(.*?)```", sec, re.S)
    return next(b for b in blocks if "Self.ActionPayload" in b)


def screen(num, title, scr, control, purpose, onvisible, rows, onchange, check):
    parts = [f"## Langkah {num} — {title}", purpose]
    parts.append(f"**{num}.1 Buat layar dan control.** Buat layar baru bernama `{scr}`. Insert → *Get more components* → "
                 f"tab **Code** → pilih **{control}** → Import, lalu tarik control itu ke layar. Atur X = 0, Y = 0, "
                 f"Width = `Parent.Width`, Height = `Parent.Height` (atau area konten kalau ada header/tab bar).")
    if onvisible:
        parts.append(f"**{num}.2 `{scr}.OnVisible`** — pilih layar (bukan control), properti **OnVisible**:\n\n" + code(onvisible))
    else:
        parts.append(f"**{num}.2 `{scr}.OnVisible`** — tidak perlu.")
    parts.append(f"**{num}.3 Properti control** — pilih control di layar ini, isi properti berikut satu per satu "
                 f"(panel kanan → *Advanced*, atau formula bar):\n\n" + props(rows))
    parts.append(f"**{num}.4 `OnChange` control** — properti **OnChange** control yang sama, tempel utuh:\n\n" + code(onchange))
    parts.append(f"**{num}.5 Cek cepat.** {check}")
    return "\n\n".join(parts)


def build():
    doc = []
    doc.append("""# Setup canvas app host — langkah demi langkah

Ikuti **berurutan dari Langkah 0 sampai 13**. Setiap layar ditulis lengkap: `OnVisible`, **semua** properti control
dengan formula utuh, dan `OnChange` utuh. Tidak ada "seperti layar lain" — cukup salin per blok.

**Cara kerja singkat.** Control tidak pernah menulis ke SharePoint. Tombol di control mengirim JSON lewat output
`ActionPayload`; formula **OnChange** control membaca JSON itu, melakukan `Patch`, lalu membalas lewat variabel yang
dipasang di properti `ActionResult`. Tombol yang mengunci (Absen, Send Report, Kirim revisi, Sanggah, Clock in,
Clock out) memutar spinner sampai balasan itu datang.

```text
Clock in
  └─ Absen (satu ketukan) → Kirim report → "Apakah sesi ini Live Break?"
       ├─ Tidak   → Schedule.Status = Waiting Report
       │             └─ Send Report (boleh beberapa kali, satu per Live ID)
       │                  ├─ total Durasi < durasi jadwal → tetap Waiting Report ("kurang X menit")
       │                  └─ total Durasi ≥ durasi jadwal → Status = Finished, tombol Send Report hilang
       ├─ Ya      → Status = Finished, LiveBreak = Yes, Report semua 0 (ApprovalStatus LiveBreak)
       └─ Co-Host → (tidak ditanya) Status = Finished, tanpa report
Ops review → Done / Need Revision → host revisi → Waiting Approval Revision
```""")

    doc.append("""## Langkah 0 — Cek list dan kolom SharePoint

Nama kolom di formula adalah **display name**. Kalau di list kamu berbeda, sesuaikan di formula. Tanda ⚠ = sering
belum ada di list lama, cek dulu.

**`Schedule - PBS Hub`**

- `Title` (SCD-…), `Date`, `StartTime`, `EndTime`, `BrandID`, `StudioID`, `HostID`
- `Platform` — Choice (Shopee, TikTok, …)
- `Account` — teks, isinya `Title` di list Account. **Tidak ada kolom nama akun**; nama diambil dari list Account
- `LiveBreak` — Choice `Yes` / `No` (kosong dianggap `No`)
- `Position` — Choice `Host` (atau `Main Host`) / `Co-Host`. Tier menghitung semua selain `Co-Host` sebagai main host
- `Status` — Choice. ⚠ harus punya pilihan **`Waiting Report`** dan **`Finished`**

**`Report - PBS Hub`**

- `Title` (REP-…), `ScheduleID`, `HostID`, `HostName` (teks, `NamaHost` dari list Host), `BrandID`, `AccountID` (teks), `LiveDate`, `AbsID`
- `Account` — Lookup ke list Account (atau Choice); diisi `AccountName` dari list Account
- `Platform` — Choice
- ⚠ `LiveID` — Single line of text (baru)
- `Playbook` — Choice (Flash Sale, Payday, …)
- Number: `Durasi(Min)`, `AddToCart`, `Pesanan`, `Penjualan`, `ProdukTerjual`, `JumlahPembeli`, `CTR`, `PeakViewer`,
  `TotalViewer`, `CTOR`, `Comment`. **`PeakViewer` berisi Avg View Duration dalam detik (s)** (nama kolom salah ketik
  waktu list dibuat); di layar tampil sebagai *Avg View Duration*, nama kolom di formula tetap `PeakViewer`.
- `ApprovalStatus` — Choice. ⚠ harus punya `Waiting Approval`, `Waiting Approval Revision`, `Need Revision`, `Done`,
  **`LiveBreak`**
- `ApprovalComment`, `Approver` (Person), `ApproverEmail`, `Attachment`

**`Host Absence - PBS Hub`** — `Title` (ABS-…), `ScheduleID`, `HostID`, `HostName`, `LiveDate`, `BrandID`,
`Platform`, `Account`, ⚠ `Status` — Choice dengan pilihan **`Hadir`** (diisi saat absen)

**`Report Automation - PBS Hub`** — bukti AI; `Title` sama dengan Title report; `Status` Choice (termasuk `Unmatch`)

**`Clock In - PBS Hub`** — kolom clock in/out ada di Langkah 10. Kolom Tier (ditulis setiap report terkirim):
`Tier` (Choice `Tier 1` / `Tier 2` / `Tier 3` / `No`), `Insentif` (Number), `TotalReports` (Number),
`LastTierUpdate` (Date and time), `Reason` (Multiple lines), `Total_Jam_Live` (Number), `Schedule` (Multiple lines),
`statusupdate` (teks)

**`Performance Tier - PBS Hub`** — tiga baris `Title` = `Tier 1`, `Tier 2`, `Tier 3`, masing-masing `MinViews`,
`CTR`, `AvgViewDur` (batas **Avg View Duration**, dibandingkan dengan kolom Report `PeakViewer`) dan `Duration` (jam live minimum, mis. 8 / 6 / 4)

**`Account - PBS Hub`** — `Title` (kode akun), `AccountName` (teks). Kalau nama list-nya lain, ganti di Langkah 3

**`Host - PBS Hub`** — `Title`, `HostCode`, `NamaHost`, `Email` (Person), `Package`, `CurrentScore`, `InitialScore`

**`Brand - PBS Hub`** — `Title`, `NamaBrand` · **`Studio - PBS Hub`** — `Title`, `NamaStudio` ·
**`Studio Location - PBS`** — `Title`, `LocationID`, `Latitude`, `Longitude`, `RadiusMeter`, `IsActive`

**Skor (kartu skor di Hari ini + layar Skor saya)** — `[FAS STUDIO] HostScoreTransactions` (`TransactionID, HostID, RuleID, TransactionType, Point, ScoreBefore, ScoreAfter, Reason, Notes, Status, CreatedDate`), `[FAS STUDIO] HostScoreThreshold` (`ThresholdID, Label, Description, MinimumScore, MaximumScore, Tone, Active, SortOrder`), `[FAS STUDIO] ScoreConfig` (`InitialScore, MinimumScore, MaximumScore`, dipakai kalau kolom skor di Host kosong). Host perlu izin **baca** ketiga list; tidak ada yang ditulis dari app host.""")

    doc.append("""## Langkah 1 — Import solusi dan tambahkan data source

1. Power Apps → **Solutions → Import solution** → pilih `dist/PBSHubHostApp_1_0_17_0_managed.zip` → Import.
2. Sekali per environment: Power Platform admin center → environment → **Settings → Product → Features** →
   *Allow publishing of canvas apps with code components* = **On**. Tanpa ini control tidak muncul di tab Code.
3. Panel **Data → Add data → SharePoint** → site PBS Hub → centang semua list di Langkah 0.
4. **Add data → Office 365 Groups** (connector yang sama dengan app upload jadwal bulk/AI). Dipakai untuk
   `Office365Groups.HttpRequest` yang mengunggah screenshot report dan selfie clock in ke Graph.""")

    doc.append("""## Langkah 2 — Upload screenshot dan selfie (Graph)

**Screenshot report — tanpa flow.** Caranya sama dengan app upload jadwal bulk/AI: `Office365Groups.HttpRequest`
PUT ke Graph. File masuk ke

```text
Report Automation/<NamaBrand>/<yyyy>/<mmmm>/REP-<ID>/REP-<ID>_<Platform>_<AccountID>_Report.png
```

Yang perlu disiapkan hanya `varSiteID` dan `varDriveID` di Langkah 3 blok 5 — salin nilainya dari app upload jadwal.
Control mengirim base64 JPEG tanpa prefix, jadi body-nya `"data:image/jpeg;base64," & data`. `webUrl` dari
respons Graph disimpan ke `Report.Attachment`. Revisi dengan screenshot baru menimpa file yang sama (folder bulan
diambil dari `Created` report), sehingga flow AI membacanya ulang.

**Selfie clock in — juga Graph, tanpa flow.** File masuk ke

```text
Absence/<yyyy>/<mmmm>/<dd-mm-yyyy>/HST-001_20260927_IN_0803.jpg   (mis. Absence/2026/September/27-09-2026/)
```

Tahun / bulan / tanggal otomatis dari hari clock in; selfie clock out masuk folder yang sama walaupun shift lewat
tengah malam. `varSiteID` / `varDriveID` sama dengan screenshot report (library `PBS Power Apps`).""")

    doc.append("""## Langkah 3 — App.OnStart

Pilih **App** di tree view → properti **OnStart** → tempel utuh → klik `…` di App → **Run OnStart**.

""" + code("""
// 0. Hari libur nasional: dipakai Tier (blok 5) dan kalender Jadwal saya (config.holidays di blok 1).
Set(varHolidays, [                                                  // tanggal merah → Tier 1 (perbarui tiap tahun)
    Date(2026,1,1), Date(2026,2,16), Date(2026,3,1), Date(2026,3,21), Date(2026,4,1), Date(2026,4,10),
    Date(2026,4,11), Date(2026,5,1), Date(2026,5,14), Date(2026,5,21), Date(2026,6,1), Date(2026,6,17),
    Date(2026,6,27), Date(2026,7,7), Date(2026,8,17), Date(2026,12,25)
]);

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
        scheduleDoneStatus: "Finished",
        absenLeadMin: 30,                        // absen dibuka 30 menit sebelum sesi
        reportDeadlineDays: 2,                   // report "Terlambat" setelah H+2
        maxShiftHours: 16,                       // shift maksimal; lewat dari ini clock out ditutup
        tolerancePct: 5,
        imageMaxPx: 2000, imageMaxKb: 1200,      // screenshot report
        clockInStatus: "Hadir - Tugas",          // Choice Status di Clock In
        defaultRadiusM: 100, weakAccuracyM: 100, minReasonChars: 10,
        selfieMaxPx: 960, selfieMaxKb: 350,
        weekMaxHours: 40,                        // Jadwal saya · Minggu: "Jam live … dari maks 40 jam" (0 = tanpa batas)
        picName: "Bayu Prasetyo",                // Jadwal saya · Bulan: nama PIC jadwal di kartu "Ada yang tidak sesuai?"
        holidays: Concat(varHolidays, Text(Value, "yyyy-mm-dd"), ","),   // hari libur nasional (blok 0)
        scoreInitial: First('[FAS STUDIO] ScoreConfig').InitialScore,   // Skor saya: kalau kolom skor di Host kosong
        scoreMin: First('[FAS STUDIO] ScoreConfig').MinimumScore,
        scoreMax: First('[FAS STUDIO] ScoreConfig').MaximumScore
    }
}, JSONFormat.Compact));

// 2. Host yang login.
Set(varMe, LookUp('Host - PBS Hub', Email.Email = User().Email));
// Koleksi *Filtered: SEMUA LookUp/Filter di OnVisible dan OnChange membaca dari sini, bukan langsung dari list.
// Tulis tetap ke list (Patch); setiap Patch di OnChange langsung menyalin baris hasilnya ke koleksi yang sama.
// Rentang: 3 bulan ke belakang, 2 bulan ke depan. Perlebar kalau host perlu buka bulan yang lebih lama.
Set(varFilterFrom, DateAdd(Today(), -90)); Set(varFilterTo, DateAdd(Today(), 60));
ClearCollect(scheduleFiltered, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date >= varFilterFrom, Date <= varFilterTo));
ClearCollect(clockInFiltered, Filter('Clock In - PBS Hub', HostID = varMe.Title, ClockInDate >= varFilterFrom));
ClearCollect(absenceFiltered, Filter('Host Absence - PBS Hub', HostID = varMe.Title, LiveDate >= varFilterFrom));
ClearCollect(reportFiltered, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate >= varFilterFrom));

// 3. Data referensi (sekali).
ClearCollect(colAccounts, ShowColumns('Account - PBS Hub', Title, AccountName));   // Schedule.Account -> AccountName
ClearCollect(colBrands, ShowColumns('Brand - PBS Hub', Title, NamaBrand));
ClearCollect(colStudios, ShowColumns('Studio - PBS Hub', Title, NamaStudio));
ClearCollect(colScoreBand, Filter('[FAS STUDIO] HostScoreThreshold', Active));      // hapus kalau list skor tidak dipakai
ClearCollect(colPbsProcessed, {Id: ""});                                           // requestId yang sudah diproses

// 4. Semua variabel layar. Power Apps menolak variabel yang tidak pernah di-Set ("Name isn't valid") atau
//    hanya di-Set ke Blank() ("No type found"), jadi semuanya dideklarasikan di sini dengan tipe yang benar.
Set(varMrPeriod, "");  Set(varMrFilter, "All");                          // Report saya
Set(varMsPeriod, "");  Set(varMsFilter, "");  Set(varMsView, "Week");    // Jadwal saya
Set(varPicUrl, "mailto:pic-jadwal@contoh.com");                          // tombol Hubungi PIC (mailto: atau link chat Teams)
Set(varSchId, "");     Set(varSchDate, Today());                         // Detail sesi
Set(varCsPeriod, "");  Set(varCsFilter, "All"); Set(varCsTop, 200);    // Skor saya
Set(varRptId, Value(Blank())); Set(varRptSchedule, "");                  // Kirim / revisi report
Set(varMrdRep, LookUp(reportFiltered, ID = -1));                     // record kosong yang bertipe
Set(varMrdSch, LookUp(scheduleFiltered, ID = -1));
Set(varHdLoading, false); Set(varMrLoading, false); Set(varMrdLoading, false);
Set(varMsLoading, false); Set(varSdLoading, false); Set(varCkLoading, false); Set(varCsLoading, false);
Set(varHdResult, ""); Set(varMrdResult, ""); Set(varMsResult, ""); Set(varSdResult, ""); Set(varCkResult, "");

// 5. Upload screenshot (Graph) dan Tier harian di Clock In.
Set(varSiteID, "<site-id>");     // sama dengan app upload jadwal bulk/AI
Set(varDriveID, "<drive-id>");
ClearCollect(colTierConfig, 'Performance Tier - PBS Hub');          // Tier 1/2/3: MinViews, CTR, AvgViewDur (Avg View Duration), Duration (jam)
Set(varSlotMin, 15);                                                // grid 15 menit
Set(varT1MinInWindow, 120);                                         // ≥ 2 jam live di 00:00–06:00 → Tier 1
Set(varT2MinInWindow, 120)                                          // ≥ 2 jam live di 21:00–24:00 → Tier 2

"""))

    doc.append("""### Aturan Tier (dihitung setiap report terkirim)

Setiap **Send Report**, **Kirim revisi** dan **Live Break**, OnChange menghitung Tier host itu untuk tanggal
live tersebut dan menulisnya ke baris `Clock In - PBS Hub` (`HostID` + `ClockInDate`). Belum clock in = belum ada
baris = dilewati; hitung ulang bulanan yang sudah kamu punya tetap bisa dijalankan dan hasilnya sama.

| Urutan | Syarat | Hasil |
|---|---|---|
| 1 | Menit Main Host ≤ menit Co-Host hari itu | **No**, insentif 0 |
| 2 | Tanggal ada di `varHolidays` | **Tier 1** |
| 3 | Metrik T1 (TotalViewer ≥ MinViews, CTR ≥ CTR, Avg View Duration ≥ AvgViewDur), **atau** live ≥ Duration T1 (8 jam), **atau** ≥ 2 jam di 00:00–06:00 | **Tier 1** |
| 4 | Metrik T2, **atau** live ≥ 6 jam, **atau** ≥ 2 jam di 21:00–24:00 | **Tier 2** |
| 5 | Metrik T3, **atau** live ≥ 4 jam | **Tier 3** |
| 6 | Sabtu / Minggu dan hasil 3–5 bukan Tier 1 | naik ke **Tier 2** |
| — | tidak ada yang cocok | **No** |

Jam live = gabungan jadwal Main Host (bukan Cancelled) di grid 15 menit, jadi jadwal yang tumpang tindih tidak
dihitung dua kali. Contoh: 4 jadwal total 8 jam → Tier 1; total 4 jam tapi live sampai 03:00 (≥ 2 jam setelah
00:00) → Tier 1. Metrik memakai akun terbaik hari itu (TotalViewer dijumlah, Avg View Duration dan CTR maksimum). Insentif:
Tier 1 = 75.000, Tier 2 = 65.000, Tier 3 = 55.000, No = 0.""")

    doc.append("""## Langkah 4 — Buat tujuh layar

Nama layar dipakai di formula `Navigate(...)`. Pakai nama persis ini (atau ganti di semua formula).

| Layar | Control | Dibuka dari |
|---|---|---|
| `scrHome` | PBS Host App Dashboard | layar awal app (**App.StartScreen** = `scrHome`) |
| `scrMySchedule` | PBS Host App My Schedule | tab / tombol *Jadwal saya* |
| `scrScheduleDetail` | PBS Host App Schedule Detail | klik sesi di Hari ini / Jadwal saya |
| `scrMyReports` | PBS Host App My Reports | tab / tombol *Report saya* |
| `scrMyReportDetail` | PBS Host App My Report Detail | klik report di Report saya / to-do Hari ini |
| `scrClockIn` | PBS Host App Clock In | tombol Clock in / Clock out di Hari ini |
| `scrCreditScore` | PBS Host App Credit Score | *Lihat rincian* di kartu skor Hari ini, atau tab *Skor saya* |

Navigasi utama (tab bar atau tombol di header, di luar control): `Navigate(scrHome)`, `Navigate(scrMySchedule)`,
`Navigate(scrMyReports)`, `Navigate(scrCreditScore)`. Sisanya dibuka oleh control lewat OnChange.""")

    # ---- screens ---------------------------------------------------------------------------------

    hd_vis = """
Set(varHdLoading, true);
ClearCollect(colMySch, Filter(scheduleFiltered, HostID = varMe.Title, Date >= Today() - 7, Date <= Today() + 7));
ClearCollect(colMyClk, Filter(clockInFiltered, HostID = varMe.Title, ClockInDate >= Today() - 14));
ClearCollect(colMyAbs, Filter(absenceFiltered, HostID = varMe.Title, LiveDate >= Today() - 14));
ClearCollect(colMyRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate >= Today() - 30));
ClearCollect(colMyTx, Filter('[FAS STUDIO] HostScoreTransactions', HostID = varMe.Title, CreatedDate >= Today() - 30));   // hapus kalau tanpa skor
Set(varHdLoading, false)"""
    hd_rows = [
        ("Context", "varHostCtx", ""),
        ("HostJson", HOST, ""),
        ("SchedulesJson", js("colMySch", SCH), ""),
        ("ClockInJson", js("colMyClk", CLK), ""),
        ("AbsenceJson", js("colMyAbs", ABS), ""),
        ("ReportsJson", js("colMyRep", REP), ""),
        ("ScoreTxJson", js("colMyTx", "{Point: Point, Status: Status.Value, CreatedDate: CreatedDate, Reason: Reason}"), "opsional; isi `\"[]\"` kalau tanpa skor"),
        ("ThresholdsJson", js("colScoreBand", BANDS), "opsional; isi `\"[]\"` kalau tanpa skor"),
        ("BrandsJson", BRANDS, ""),
        ("StudiosJson", STUDIOS, ""),
        ("IsLoading", "varHdLoading", ""),
        ("ReferenceDate", '""', "kosong (hanya untuk tes)"),
        ("ActionResult", "varHdResult", ""),
    ]
    doc.append(screen(5, "Layar Hari ini (`scrHome`)", "scrHome", "PBS Host App Dashboard",
                      "Sapaan, kartu shift (clock in / out), to-do, jadwal minggu ini, skor.",
                      hd_vis, hd_rows, oc.hd,
                      "Buka app: nama host tampil, sesi hari ini muncul. Klik nama brand sesi → pindah ke `scrScheduleDetail`."))

    sd_vis = """
Set(varSdLoading, true);
ClearCollect(colSdSch, Filter(scheduleFiltered, HostID = varMe.Title, Date = varSchDate));
// hari sebelumnya ikut: shift 22:00 → 03:00 kemarin juga menutup sesi 00:30 hari ini
ClearCollect(colSdClk, Filter(clockInFiltered, HostID = varMe.Title, ClockInDate >= DateAdd(varSchDate, -1), ClockInDate <= varSchDate));
ClearCollect(colSdAbs, Filter(absenceFiltered, HostID = varMe.Title, LiveDate = varSchDate));
ClearCollect(colSdRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate = varSchDate));
ClearCollect(colSdEvi, Filter('Report Automation - PBS Hub', HostID = varMe.Title, Title in colSdRep.Title));
ClearCollect(colSdHist, FirstN(Sort(Filter(reportFiltered, HostID = varMe.Title), ID, SortOrder.Descending), 10));
Set(varSdLoading, false)"""
    sd_rows = [
        ("Context", "varHostCtx", ""),
        ("ScheduleId", "varSchId", "Title jadwal yang dibuka (diisi aksi `OPEN_SCHEDULE`)"),
        ("HostJson", HOST, ""),
        ("SchedulesJson", js("colSdSch", SCH), "sesi itu + sesi lain host di hari yang sama"),
        ("ClockInJson", js("colSdClk", CLK), ""),
        ("AbsenceJson", js("colSdAbs", ABS), ""),
        ("ReportsJson", js("colSdRep", REP), "semua bagian report (live terputus) ikut terkirim"),
        ("EvidenceJson", js("colSdEvi", EVI), ""),
        ("HistoryJson", js("colSdHist", REP), "peringatan angka jauh dari rata-rata; boleh `\"[]\"`"),
        ("BrandsJson", BRANDS, ""),
        ("StudiosJson", STUDIOS, ""),
        ("PlaybooksJson", PLAYBOOKS, "isi dropdown Playbook = pilihan Choice di list"),
        ("IsLoading", "varSdLoading", ""),
        ("ReferenceDate", '""', "kosong"),
        ("ActionResult", "varSdResult", ""),
    ]
    doc.append(screen(6, "Layar Detail sesi (`scrScheduleDetail`) — Absen, Send Report, revisi", "scrScheduleDetail",
                      "PBS Host App Schedule Detail",
                      "Layar utama report. Dibuka oleh aksi `OPEN_SCHEDULE` (Hari ini, Jadwal saya) yang mengisi `varSchId` dan "
                      "`varSchDate`. Untuk tes langsung: tombol sementara dengan `Set(varSchId, \"SCD-3313\"); Set(varSchDate, "
                      "DateValue(\"2026-09-13\")); Navigate(scrScheduleDetail)`.",
                      sd_vis, sd_rows, oc.sd,
                      "Absen → pilih *Tidak* → di SharePoint ada baris Host Absence dan `Schedule.Status = Waiting Report`; "
                      "tombol **Send Report** aktif. Send Report → baris Report baru + `Attachment` terisi."))

    mr_vis = """
Set(varMrLoading, true);
With({from: If(IsBlank(varMrPeriod), Date(Year(Today()), Month(Today()), 1), DateValue(varMrPeriod & "-01"))},
    ClearCollect(colMrRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate >= from, LiveDate < DateAdd(from, 1, TimeUnit.Months)));
    ClearCollect(colMrSch, Filter(scheduleFiltered, HostID = varMe.Title, Date >= from, Date < DateAdd(from, 1, TimeUnit.Months)))
);
Set(varMrLoading, false)"""
    mr_rows = [
        ("Context", "varHostCtx", ""),
        ("Period", "varMrPeriod", "bulan yang tampil, `yyyy-mm`; kosong = bulan ini. Pemilih bulan mengirim `PERIOD_CHANGED`, OnChange mengisi variabel ini dan memuat ulang"),
        ("DefaultFilter", "varMrFilter", "`All`, `Revision`, `Waiting`, `Done`, `Auto`, `LiveBreak`; chip filter mengirim `FILTER_CHANGED`"),
        ("ReportsJson", js("colMrRep", REP), ""),
        ("SchedulesJson", js("colMrSch", SCH), "untuk jam sesi dan kartu *Belum dikirim*"),
        ("ClockInJson", '"[]"', "tidak dipakai"),
        ("AbsenceJson", '"[]"', "tidak dipakai"),
        ("BrandsJson", BRANDS, ""),
        ("HasMore", "false", ""),
        ("IsLoading", "varMrLoading", ""),
        ("ReferenceDate", '""', "kosong"),
        ("ActionResult", '""', "layar ini tidak punya aksi yang mengunci"),
    ]
    doc.append(screen(7, "Layar Report saya (`scrMyReports`)", "scrMyReports", "PBS Host App My Reports",
                      "Daftar report sebulan, KPI (Belum dikirim, Perlu revisi, Menunggu review, Disetujui), filter, pilih bulan.",
                      mr_vis, mr_rows, oc.mr,
                      "Ganti bulan di control → daftar berganti (OnChange mengisi `varMrPeriod` lalu memuat ulang). "
                      "Klik report → `scrMyReportDetail` terbuka."))

    mrd_vis = """
Set(varMrdLoading, true);
With({rep: If(IsBlank(varRptId), Blank(), LookUp(reportFiltered, ID = varRptId && HostID = varMe.Title))},
    Set(varMrdRep, rep);
    Set(varMrdSch, LookUp(scheduleFiltered, Title = Coalesce(rep.ScheduleID, varRptSchedule) && HostID = varMe.Title))
);
ClearCollect(colMrdClk, Filter(clockInFiltered, HostID = varMe.Title, ClockInDate >= DateAdd(varMrdSch.Date, -1), ClockInDate <= varMrdSch.Date));
ClearCollect(colMrdAbs, Filter(absenceFiltered, HostID = varMe.Title, ScheduleID = varMrdSch.Title));
ClearCollect(colMrdEvi, Filter('Report Automation - PBS Hub', Title = varMrdRep.Title));
ClearCollect(colMrdSesRep, Filter(reportFiltered, HostID = varMe.Title, ScheduleID = varMrdSch.Title));
ClearCollect(colMrdHist, FirstN(Sort(Filter(reportFiltered, HostID = varMe.Title), ID, SortOrder.Descending), 10));
Set(varMrdLoading, false)"""
    mrd_rows = [
        ("Context", "varHostCtx", ""),
        ("HostJson", HOST, ""),
        ("ReportJson", 'If(IsBlank(varMrdRep), "[]", ' + js("Table(varMrdRep)", REP) + ")", "kosong = form Send Report; `Need Revision` = form revisi; lainnya = baca saja"),
        ("ScheduleJson", 'If(IsBlank(varMrdSch), "[]", ' + js("Table(varMrdSch)", SCH) + ")", ""),
        ("EvidenceJson", js("colMrdEvi", EVI), ""),
        ("ClockInJson", js("colMrdClk", CLK), ""),
        ("AbsenceJson", js("colMrdAbs", ABS), ""),
        ("HistoryJson", js("colMrdHist", REP), "boleh `\"[]\"`"),
        ("BrandsJson", BRANDS, ""),
        ("StudiosJson", STUDIOS, ""),
        ("SessionReportsJson", js("colMrdSesRep", REP), "semua bagian report sesi ini, untuk menjumlah durasi"),
        ("PlaybooksJson", PLAYBOOKS, ""),
        ("IsLoading", "varMrdLoading", ""),
        ("ReferenceDate", '""', "kosong"),
        ("ActionResult", "varMrdResult", ""),
    ]
    doc.append(screen(8, "Layar Kirim / revisi report (`scrMyReportDetail`)", "scrMyReportDetail", "PBS Host App My Report Detail",
                      "Dibuka oleh `NEW_REPORT` (mengisi `varRptSchedule`, `varRptId` kosong) atau `OPEN_REPORT` (mengisi `varRptId`).",
                      mrd_vis, mrd_rows, oc.mrd,
                      "Dari Report saya klik report yang *Perlu revisi* → form revisi muncul dengan angka lama."))

    ms_vis = """
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
Set(varMsLoading, false)"""
    ms_rows = [
        ("Context", "varHostCtx", ""),
        ("Period", "varMsPeriod", "`yyyy-mm`; kosong = bulan ini"),
        ("DefaultFilter", "varMsFilter", "kosong, `ACTION`, `PLANNED`, `FINISHED`, `CANCELLED`"),
        ("DefaultView", 'Coalesce(varMsView, "Week")', "`Week` (papan Minggu, default), `List` (Daftar) atau `Calendar` (Bulan)"),
        ("HostJson", HOST, ""),
        ("SchedulesJson", js("colMsSch", SCH), ""),
        ("ClockInJson", js("colMsClk", CLK), ""),
        ("AbsenceJson", js("colMsAbs", ABS), ""),
        ("ReportsJson", js("colMsRep", REP), ""),
        ("BrandsJson", BRANDS, ""),
        ("StudiosJson", STUDIOS, ""),
        ("HasMore", "false", ""),
        ("IsLoading", "varMsLoading", ""),
        ("ReferenceDate", '""', "kosong"),
        ("ActionResult", "varMsResult", ""),
    ]
    doc.append(screen(9, "Layar Jadwal saya (`scrMySchedule`)", "scrMySchedule", "PBS Host App My Schedule",
                      "Tiga tampilan: **Daftar** (tabel sebulan), **Minggu** (papan 7 hari: kartu per sesi dengan brand, akun, studio, platform, "
                      "warna status, navigasi ‹ ›) dan **Bulan** (kalender + panel kanan: angka bulan ini, bulan lalu, hari libur nasional, "
                      "tombol Hubungi PIC; bulan tanpa jadwal tetap menampilkan kalender dengan *Jadwal … belum terbit*). KPI, strip Hari ini "
                      "(clock in, absen), filter. Data yang dimuat: bulan lalu + bulan ini + 7 hari bulan depan.",
                      ms_vis, ms_rows, oc.ms,
                      "Buka layar → langsung papan *Minggu* ini, hari ini disorot. Ganti bulan → jadwal berganti; ‹ › pindah minggu (masuk bulan lain → "
                      "canvas memuat bulan itu). Pilih *Bulan* → tetap Bulan saat kembali ke layar; panel *Bulan lalu* terisi."))

    ck_vis = """
Set(varCkLoading, true);
Concurrent(
    ClearCollect(colCkLoc, Filter('Studio Location - PBS', IsActive = true)),
    ClearCollect(colCkClk, Filter(clockInFiltered, HostID = varMe.Title, ClockInDate >= Today() - 1)),
    ClearCollect(colCkSch, Filter(scheduleFiltered, HostID = varMe.Title, Date >= Today() - 1, Date <= Today())),
    ClearCollect(colCkRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate >= Today() - 1))
);
Set(varCkLoading, false)"""
    ck_rows = [
        ("Context", "varHostCtx", ""),
        ("HostJson", HOST, ""),
        ("LocationsJson", js("colCkLoc", "{Title: Title, LocationID: LocationID, Latitude: Latitude, Longitude: Longitude, RadiusMeter: RadiusMeter, IsActive: IsActive}"), ""),
        ("ClockInJson", js("colCkClk", '{ID: ID, Title: Title, HostID: HostID, ClockInDate: Text(ClockInDate, "yyyy-mm-dd"), CheckInTime: CheckInTime, CheckOutTime: CheckOutTime, ClockOutDate: Text(ClockOutDate, "yyyy-mm-dd"), ClockInTime: ClockInTime, ClockOutTime: ClockOutTime, CheckInOffice: CheckInOffice, Reason: Reason}'), ""),
        ("SchedulesJson", js("colCkSch", '{Title: Title, Date: Text(Date, "yyyy-mm-dd"), StartTime: StartTime, EndTime: EndTime, HostID: HostID, Status: Status.Value}'), ""),
        ("ReportsJson", js("colCkRep", '{Title: Title, ScheduleID: ScheduleID, HostID: HostID, LiveDate: Text(LiveDate, "yyyy-mm-dd")}'), ""),
        ("DeviceLocationJson", "JSON({Latitude: Location.Latitude, Longitude: Location.Longitude}, JSONFormat.Compact)", "cadangan kalau GPS browser ditolak"),
        ("IsLoading", "varCkLoading", ""),
        ("ReferenceDate", '""', "kosong"),
        ("ActionResult", "varCkResult", ""),
    ]
    doc.append(screen(10, "Layar Clock in (`scrClockIn`)", "scrClockIn", "PBS Host App Clock In",
                      "Clock in dan clock out: GPS terhadap radius `Studio Location - PBS`, selfie, alasan kalau di luar radius. "
                      "Kolom `Clock In - PBS Hub` yang ditulis: `HostID, HostName, EmployeeName, EmployeeEmail, ClockInDate, "
                      "CheckInTime, ClockInTime, Status, HKTugas, ScheduleCount, CheckInLatitude/Longitude/Accuracy/Distance, "
                      "CheckInOffice, IsInsideGeofence, Reason, SelfieSource, CheckInDevice, CheckInDeviceInfo, SelfiePhotoUrl`, dan saat clock out `CheckOutTime, "
                      "ClockOutDate (Date only), ClockOutTime (teks \"HH:mm\"), CheckOut…, CheckOutDevice, CheckOutDeviceInfo, WorkingDuration, TotalReports, SelfieOutPhotoUrl` (kolom Device: Text, baru, buat dulu). Hapus dari formula kolom yang "
                      "tidak ada di list kamu.",
                      ck_vis, ck_rows, clockin_onchange(),
                      "Clock in → baris `CLK-…` baru dengan `SelfiePhotoUrl`; kembali ke Hari ini kartu shift berubah jadi *Sedang shift*."))

    cs_vis = """
Set(varCsLoading, true);
Set(varCsTop, 200);
Set(varMe, LookUp('Host - PBS Hub', Email.Email = User().Email));   // skor terbaru
ClearCollect(colCsTx, FirstN(Sort(Filter('[FAS STUDIO] HostScoreTransactions', HostID = varMe.Title), CreatedDate, SortOrder.Descending), varCsTop));
ClearCollect(colScoreBand, Filter('[FAS STUDIO] HostScoreThreshold', Active));
Set(varCsLoading, false)"""
    cs_rows = [
        ("Context", "varHostCtx", ""),
        ("HostJson", HOST, ""),
        ("ScoreTxJson", js("colCsTx", TX), "semua transaksi host (terbaru dulu); yang dibatalkan ikut, ditampilkan dicoret"),
        ("ThresholdsJson", js("colScoreBand", BANDS), ""),
        ("RulesJson", '"[]"', "opsional; kosong = daftar *Cara skor berubah* diambil dari transaksi. Kalau ada list rule: `JSON(ForAll(<list rule>, {RuleID: RuleID, RuleName: RuleName, RuleType: RuleType.Value, Point: Point, Description: Description, Active: Active}), JSONFormat.Compact)`"),
        ("Period", "varCsPeriod", "kosong = bulan ini; `All` = semua waktu"),
        ("DefaultFilter", "varCsFilter", ""),
        ("HasMore", "CountRows(colCsTx) >= varCsTop", "tombol *Muat lebih banyak*"),
        ("IsLoading", "varCsLoading", ""),
        ("ReferenceDate", '""', "kosong"),
        ("ActionResult", '""', "layar ini hanya membaca, tidak ada aksi terkunci"),
    ]
    doc.append(screen(11, "Layar Skor saya (`scrCreditScore`)", "scrCreditScore", "PBS Host App Credit Score",
                      "Skor kredit host: angka dan level sekarang, berapa poin lagi ke level berikutnya, tren, reward / penalty per bulan, "
                      "daftar level, cara skor berubah, dan semua transaksi (yang dibatalkan dicoret dan tidak dihitung). "
                      "Layar ini **hanya membaca**: tidak ada Patch. Ganti bulan dan filter dikerjakan control di data yang sudah dimuat.",
                      cs_vis, cs_rows, oc.cs,
                      "Dari Hari ini klik *Lihat rincian* di kartu skor → `scrCreditScore`: angka sama dengan kartu, level berlabel "
                      "*Kamu di sini*, transaksi bulan ini tampil; pilih *Semua waktu* di kanan atas → semua transaksi."))

    doc.append("""## Langkah 12 — Tes alur report dari awal sampai akhir

Pakai satu jadwal milik akunmu (`HostID = varMe.Title`), hari ini, **sudah mulai**, durasi 120 menit, platform Shopee,
`Status = Planned`, `Position = Host`.

| # | Langkah | Yang terlihat di control | Yang ada di SharePoint |
|---|---|---|---|
| 1 | Clock in di `scrClockIn` | *Clock in tersimpan* | Clock In `CLK-…` |
| 2 | Buka sesi di `scrScheduleDetail` | Send Report nonaktif: *Absen sesi ini belum tercatat* | — |
| 3 | **Absen** → *Tidak* → Absen | *Absen tercatat … Status jadwal: Waiting Report*, Send Report aktif | Host Absence `ABS-…` dengan `Status = Hadir`; Schedule `Planned` → `Waiting Report` |
| 4 | **Send Report**: Live ID `111`, Durasi `60`, semua angka, screenshot | *Kurang 60 menit*, tombol jadi **Send Next Report** | Report `REP-…` (`Waiting Approval`, LiveID 111, Attachment); Schedule tetap `Waiting Report` |
| 5 | Report berikutnya dengan Live ID `111` | ditolak: *Live ID sudah dipakai* | — |
| 6 | Live ID `222`, Durasi `60` | *Durasi sesi terpenuhi*, tombol hilang | Report kedua; Schedule `Status = Finished` |
| 7 | Jadwal TikTok | tidak ada kolom AddToCart | `AddToCart` kosong |
| 8 | Jadwal lain → Absen → Kirim report → *Ya, Live Break* | *Live Break · tanpa report* | Schedule `Finished`, `LiveBreak = Yes`; Report semua 0, `ApprovalStatus = LiveBreak` |
| 9 | Jadwal `Position = Co-Host` → Absen | tanpa pop-up, tanpa Send Report | Schedule `Finished`, tidak ada Report |
| 10 | Ops set report #4 ke `Need Revision` → buka sesi | form revisi (angka, Live ID, Playbook, Durasi) | — |
| 11 | Durasi jadi `50` → Kirim revisi | *Revisi terkirim* | Report `Waiting Approval Revision`; Schedule kembali `Waiting Report` (110 < 120) |
| 12 | Setelah langkah 4 buka baris Clock In hari ini | — | `Tier`, `Insentif`, `Reason`, `Total_Jam_Live`, `Schedule`, `LastTierUpdate` terisi |
| 13 | Buka folder `Report Automation/<Brand>/<tahun>/<bulan>/REP-…` | — | file `REP-…_Shopee_<Account>_Report.png` bisa dibuka sebagai gambar |""")

    doc.append("""## Langkah 13 — Kalau ada yang tidak jalan

| Gejala | Penyebab | Perbaikan |
|---|---|---|
| *Name isn't valid. 'varXxx' isn't recognized* | variabel belum pernah di-Set | pastikan blok 4 di Langkah 3 ada, lalu **Run OnStart** |
| *No type found for variable 'varMrdRep'* | variabel record hanya di-Set ke `Blank()` | pakai `LookUp(reportFiltered, ID = -1)` seperti Langkah 3 |
| *Name isn't valid* / *type does not match* pada `Account` | `Account` di Report / Host Absence harus kolom teks | formula OnChange mengisi teks: `Coalesce(LookUp(colAccounts, Title = s.Account).AccountName, Text(p.accountName), s.Account)` |
| Nama akun kosong | `colAccounts` belum dimuat / `Schedule.Account` ≠ `Title` di list Account | Run OnStart; cek isi kedua kolom |
| Klik tombol, spinner berputar terus | OnChange belum ditempel, atau `ActionResult` bukan variabel layar itu | tempel OnChange langkah layar itu; cek `ActionResult` |
| Tombol Absen masih bisa diklik setelah absen | `AbsenceJson` tidak dari koleksi yang di-`Collect` OnChange (mis. dari koleksi lain yang tidak dimuat ulang) | `AbsenceJson` harus dari `colSdAbs` / `colMsAbs` / `colMyAbs` / `colMrdAbs` sesuai layar. Control 1.0.2 juga menyembunyikan tombol begitu canvas membalas ok / sudah tercatat |
| Klik tombol, tidak terjadi apa-apa | `colPbsProcessed` belum ada | Run OnStart |
| Skor saya: *Skor belum tersedia* | `CurrentScore` dan `InitialScore` di Host kosong, dan `scoreInitial` di Context kosong | isi `InitialScore` host, atau cek `[FAS STUDIO] ScoreConfig` dan blok `config` di Langkah 3 |
| Skor saya: level tidak muncul / tidak ada *Kamu di sini* | `colScoreBand` kosong, `Active` tidak dicentang, atau skor di luar semua rentang | cek `[FAS STUDIO] HostScoreThreshold`; rentang tiap level tidak boleh bolong |
| Skor saya: transaksi kosong padahal ada di list | `HostID` transaksi ≠ `varMe.Title`, atau host tidak punya izin baca list | cek kolom `HostID`; beri izin baca |
| *Lihat rincian* di kartu skor Hari ini tidak pindah layar | OnChange Hari ini masih versi lama (tanpa `"SCORE"`) | tempel ulang OnChange Langkah 5 |
| Sudah absen tapi jadwal tetap `Planned` / diminta absen terus | absen lama gagal di tengah (baris absen ada, status jadwal belum pindah) | tempel OnChange terbaru, lalu tekan **Absen** sekali lagi: ditolak (*sudah tercatat*) karena satu ScheduleID hanya boleh satu absen, tapi Status jadwal dilengkapi ke `Waiting Report` dan `Status = Hadir` diisi |
| *Gagal mengubah status jadwal …* / *absen gagal dicatat: …* | Patch ditolak SharePoint; teks setelah `:` adalah error aslinya (mis. host tidak punya izin edit list Schedule / Host Absence, pilihan `Hadir` / `Waiting Report` tidak ada, kolom wajib kosong) | perbaiki sesuai pesan, lalu tekan **Absen** lagi |
| *Jadwal … tidak ditemukan untuk akunmu* | `HostID` jadwal ≠ `varMe.Title`, atau Title jadwal berubah | cek `HostID` di Schedule; muat ulang layar |
| *Gagal absen: … Status* | Choice `Status` di Host Absence tidak punya `Hadir` (atau kolomnya teks) | tambah pilihan `Hadir`; kalau teks ganti jadi `Status: "Hadir"` |
| *Status jadwal Finished, report tidak bisa dikirim* | durasi sudah terpenuhi, atau ejaan Choice beda | cek ejaan Choice = `scheduleWaitingStatus` di Langkah 3 dan teks `"Waiting Report"` di OnChange |
| Error di `Playbook` | pilihan dropdown tidak ada di Choice | `PlaybooksJson` = `JSON(Choices([@'Report - PBS Hub'].Playbook), …)` |
| Report terbuat tapi `Attachment` kosong / error *HttpRequest* | `varSiteID` / `varDriveID` salah, Office 365 Groups belum ditambahkan, atau folder brand belum ada | salin ID dari app upload jadwal; cek `NamaBrand` di list Brand |
| File screenshot ada tapi tidak bisa dibuka (isinya teks) | body data URI tidak diubah jadi binary oleh connector | ganti `HttpRequest` dengan flow Power Apps (V2) → SharePoint *Create file* (`base64ToBinary`) di path yang sama; berlaku juga untuk selfie |
| `up.webUrl` error (*untyped / record*) | respons HttpRequest bertipe lain di versi kamu | pakai `Attachment: "Report Automation/…/" & title & "_Report.png"` (path yang sama) |
| Tier tidak berubah setelah report | belum clock in hari itu, atau `ClockInDate` ≠ tanggal live | clock in dulu; jalankan hitung ulang bulanan |
| Notifikasi *Tier belum terhitung* | kolom Tier di Clock In / list `Performance Tier - PBS Hub` belum ada, atau Choice `Tier` tidak punya pilihannya | lihat Langkah 0; report tetap tersimpan |
| *Report ini sudah berubah. Muat ulang dulu* saat revisi | data di layar lama | keluar-masuk layar (OnVisible memuat ulang) |
| Form revisi tidak muncul | `ApprovalStatus` bukan persis `Need Revision` | cek ejaan Choice |
| Kolom tidak ditemukan di sebuah formula | nama kolom di list kamu berbeda / tidak ada | ganti nama, atau hapus field itu dari record (control mengabaikan field yang kosong) |""")

    doc.append("---\n\nDibuat dari `scripts/docs/gen_host_setup.py` (jalankan ulang setelah mengubah formula). Rujukan per aksi "
               "(payload, arti tiap field): [`HOST-CANVAS-INTEGRATION.md`](HOST-CANVAS-INTEGRATION.md).")
    open(OUT, "w").write("\n\n".join(doc) + "\n")
    print("wrote", OUT)


if __name__ == "__main__":
    build()
