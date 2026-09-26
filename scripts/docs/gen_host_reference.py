"""Rewrites section 10 (OnChange) of docs/HOST-CANVAS-INTEGRATION.md from host_onchange.py."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from host_onchange import *  # noqa: F401,F403

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "docs", "HOST-CANVAS-INTEGRATION.md")
s = open(P).read()
sec = '''
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
%HD%
```

### 10.2 MyReports — `OnChange`

```powerfx
%MR%
```

### 10.3 MyReportDetail — `OnChange`

`data: Self.UploadData` dibaca sekali di awal: control mengisi `UploadData` (screenshot) bersamaan dengan
`ActionPayload` dan mengosongkannya di aksi berikutnya. Selama durasi sesi belum terpenuhi (`p.complete = false`)
`varMrdRep` sengaja tidak diisi, jadi form tetap di layar dengan tombol *Send Report berikutnya*.

```powerfx
%MRD%
```

### 10.4 MySchedule — `OnChange`

```powerfx
%MS%
```

### 10.5 ScheduleDetail — `OnChange`

Handler report sama dengan MyReportDetail; bedanya hanya variabel balasan (`varSdResult`) dan koleksi yang
dimuat ulang (`colSdSch`, `colSdRep`), supaya status jadwal, daftar report dan sisa durasi langsung terbarui di layar yang sama.

```powerfx
%SD%
```

Catatan:
- `Switch(act, …, false)`: nilai terakhir hanya default supaya Switch valid; aksi yang tidak dikenal tidak melakukan apa-apa.
- `RESUBMIT_REPORT` membandingkan `Modified` dengan selisih detik, bukan teks: `Modified` di JSON berformat UTC
  (`…Z`), sedangkan `Text(cur.Modified, …)` memakai jam lokal, jadi perbandingan teks selalu dianggap *conflict*
  di zona WIB.
- `Boolean(p.liveBreak)` / `Boolean(p.complete)`: `p` hasil `ParseJSON`, jadi nilai true/false perlu dikonversi.
- Kolom `LiveBreak` di Schedule adalah Choice Yes/No: ditulis `{Value: "Yes"}`; kosong dibaca sebagai `No`.
- `LOAD_MORE` tidak ditangani karena `HasMore = false` (data per host per bulan kecil).
'''
sec = sec.replace('%HD%', hd).replace('%MR%', mr).replace('%MRD%', mrd).replace('%MS%', ms).replace('%SD%', sd)
if '## 10. OnChange lengkap' in s:
    s = s[:s.index('\n## 10. OnChange lengkap')]
s = s.rstrip('\n') + '\n' + sec
# point existing sections to §10, and fix the stale Modified comparison in §5
s = s.replace("Kerangka `OnChange` sama dengan Ops: `ParseJSON(Self.ActionPayload)` → cek `rid in colPbsProcessed.Id` →\n`Collect(colPbsProcessed, {Id: rid})` → `Switch(act, …)`. Di MyReportDetail ganti `varHdResult` dengan\n`varMrdResult`.",
 "`OnChange` lengkap untuk layar ini (dan semua layar host lain) ada di **bagian 10**, siap salin.")
s = s.replace('''        If(cur.ApprovalStatus.Value <> "Need Revision" || Text(cur.Modified, "yyyy-mm-ddThh:mm:ss") <> Left(Text(p.expectedModified), 19),''','''        If(IsBlank(cur) || cur.ApprovalStatus.Value <> "Need Revision" ||
           Abs(DateDiff(cur.Modified, DateTimeValue(Text(p.expectedModified)), TimeUnit.Seconds)) > 1,''')
for hdr in ["## 4. MyReports (layar *Report saya*)\n", "## 6. MySchedule (layar *Jadwal saya*)\n", "## 7. ScheduleDetail (layar *Detail sesi*)\n"]:
    assert hdr in s, hdr
    s = s.replace(hdr, hdr + "\n`OnChange` lengkap: bagian 10.\n", 1) if "`OnChange` lengkap: bagian 10." not in s.split(hdr,1)[1][:80] else s
open(P,'w').write(s)
print("ok", s.count("```powerfx"))
