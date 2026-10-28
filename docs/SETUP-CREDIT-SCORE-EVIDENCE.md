# Setup bukti Credit Score (Ops 1.6.16.0 · Host 1.0.18.0)

Isi dokumen ini hanya yang **berubah** untuk fitur bukti (evidence) di *Tambah/Kurangi poin*. Urutan kerja:
SharePoint → import solution → App Ops → App Host. Semua rumus bisa ditempel utuh.

## Ringkasan

| # | Di mana | Apa | Jenis |
|---|---|---|---|
| 1 | SharePoint `[FAS STUDIO] HostScoreTransactions` | Kolom baru `Evidence` | Baru |
| 2 | SharePoint library *PBS Power Apps* | Folder `Credit Score` + izin baca untuk host | Baru |
| 3 | Power Apps | Import `PBSHubOpsPCF_1_6_22_0_managed.zip` dan `PBSHubHostApp_1_0_23_0_managed.zip` | Upgrade |
| 4 | App Ops · App.OnStart | `varSiteID`, `varDriveID` (+ opsional config) | Baru |
| 5 | App Ops · `scrCreditScore` · control HostScore | `LedgerJson` | Diubah |
| 6 | App Ops · `scrCreditScore` · control HostScore | `OnChange` (upload bukti + `OPEN_EVIDENCE`) | Diubah |
| 7 | App Ops · `scrHostDetail` · control HostDetail | `ScoreTxJson` + 1 baris `OnChange` | Diubah |
| 8 | App Host · `scrCreditScore` · control CreditScore | `ScoreTxJson` + 1 baris `OnChange` | Diubah |

Properti lain tidak berubah.

---

## 1. Kolom SharePoint `Evidence`

List **`[FAS STUDIO] HostScoreTransactions`** → *Add column* → **Multiple lines of text**

- Name: `Evidence` (persis, internal name juga `Evidence`)
- Type of text: **Plain text**
- Isi: link file bukti, satu per baris. Ditulis otomatis oleh app Ops.

## 2. Folder & izin

Library **PBS Power Apps** di site *StudioTeamBlibli*:

- Folder `Credit Score` tidak wajib dibuat dulu (Graph membuat folder otomatis), tapi buat sekarang supaya izinnya bisa diatur.
- Struktur yang terbentuk: `Credit Score/<Nama host>/<2026-10 Oktober>/<Nama pelanggaran> - <TX-ID>.jpg`
  (file ke-2 dst. `… (2).jpg`; PDF tetap `.pdf`).
- **Izin:** folder `Credit Score` → *Manage access* → beri grup host izin **Can view**. Tanpa ini host akan
  melihat *access denied* saat klik *Lihat bukti*. Admin PBS/FAS yang mengisi poin butuh **Can edit**.

## 3. Import solution

Import kedua zip (managed, upgrade). Setelah itu buka masing-masing canvas app → muncul banner
**"Update code components"** → *Update*. Langkah ini wajib: HostScore punya output baru `UploadData`
yang dipakai rumus OnChange di bawah.

## 4. App Ops · App.OnStart

Tambahkan data source **Office 365 Groups** (Data → Add data → *Office 365 Groups*), lalu tambahkan di App.OnStart:

```powerfx
// Sama dengan nilai di app host (upload screenshot report): site StudioTeamBlibli, library PBS Power Apps.
Set(varSiteID, "<site-id>");
Set(varDriveID, "<drive-id>");
```

Opsional — di `varPbsCtx` → `config` (App.OnStart), tambahkan sesuai kebutuhan:

```powerfx
scoreEvidenceRequired: "penalty",   // "penalty" = wajib untuk Kurangi poin · "all" = wajib semua · "" = opsional (default)
scoreEvidenceFolder: "Credit Score" // default; ganti kalau mau folder lain di library PBS Power Apps
```

## 5. App Ops · HostScore · `LedgerJson`

Layar `scrCreditScore`, pilih control HostScore → properti **LedgerJson** (yang baru: `Evidence: Evidence` di akhir):

```powerfx
JSON(ForAll(colScLedger, {ID: ID, TransactionID: TransactionID, HostID: HostID, RuleID: RuleID, TransactionType: TransactionType.Value, Point: Point, ScoreBefore: ScoreBefore, ScoreAfter: ScoreAfter, Reason: Reason, Notes: Notes, Status: Status.Value, CreatedDate: CreatedDate, CreatedBy: CreatedBy.DisplayName, Evidence: Evidence}), JSONFormat.Compact)
```

## 6. App Ops · HostScore · `OnChange`

Properti **OnChange** control yang sama — ganti seluruhnya. Yang berubah: `up: Self.UploadData` di `ADD_SCORE`,
blok upload Graph sebelum Patch, `Evidence: varScUrls` di Patch, dan aksi baru `OPEN_EVIDENCE`.

```powerfx
If(!IsBlank(Self.ActionPayload),
    With({req: ParseJSON(Self.ActionPayload)},
        With({act: Text(req.action), rid: Text(req.requestId), p: req.payload},
            If(!(rid in colPbsProcessed.Id),
                Collect(colPbsProcessed, {Id: rid});
                Switch(act,
                    "OPEN_LEDGER",
                        Set(varScHostId, Text(p.hostId));
                        Set(varScLoading, true);
                        ClearCollect(colScLedger, Filter('[FAS STUDIO] HostScoreTransactions', HostID = varScHostId));
                        Set(varScLoading, false),
                    "BACK", Set(varScHostId, ""); Clear(colScLedger),
                    "NAV", If(Text(p.target) = "RULES", Launch("https://<tenant>.sharepoint.com/sites/<site>/Lists/HostScoreRule")),
                    "OPEN_EVIDENCE", Launch(Text(p.url)),
                    "ADD_SCORE",
                        With({h: LookUp('Host - PBS Hub', Title = Text(p.hostId)), up: Self.UploadData},
                        With({cur: Coalesce(h.CurrentScore, h.InitialScore, varScCfg.InitialScore),
                              lo: Coalesce(h.MinimumScore, varScCfg.MinimumScore, 0),
                              hi: Coalesce(h.MaximumScore, varScCfg.MaximumScore, 100)},
                            If(!(userRole.Value in ["PBS_Team", "FAS_Team"]),
                                Set(varScResult, JSON({requestId: rid, status: "error", message: "Tidak punya izin mengubah skor."}, JSONFormat.Compact)),
                            // Skor berubah sejak halaman dibuka (admin lain / flow): jangan tulis dari angka lama.
                            If(IsBlank(h) || cur <> Value(p.expectedScore),
                                Set(varScResult, JSON({requestId: rid, status: "conflict", message: "Skor host sudah berubah jadi " & cur & " sejak halaman dibuka. Tutup, muat ulang, lalu coba lagi."}, JSONFormat.Compact)),
                            With({after: Min(Max(cur + Value(p.point), lo), hi)},
                                // Bukti dulu: unggah semua file ke SharePoint (Graph), kumpulkan webUrl satu per baris.
                                Set(varScUploadErr, ""); Set(varScUrls, "");
                                If(!IsBlank(up) && up <> "",
                                    IfError(
                                        Set(varScUrls, Concat(
                                            ForAll(Table(ParseJSON(up)) As f,
                                                {u: Text(Office365Groups.HttpRequest(
                                                    "https://graph.microsoft.com/v1.0/sites/" & varSiteID & "/drives/" & varDriveID & "/root:/" & Text(f.Value.path) & ":/content",
                                                    "PUT",
                                                    "data:" & Text(f.Value.mimeType) & ";base64," & Text(f.Value.base64)).webUrl)}),
                                            u, Char(10))),
                                        Set(varScUploadErr, FirstError.Message)));
                                If(varScUploadErr <> "",
                                    Set(varScResult, JSON({requestId: rid, status: "error", message: "Bukti gagal diunggah (" & varScUploadErr & "). Transaksi belum disimpan, coba lagi."}, JSONFormat.Compact)),
                                IfError(
                                    Set(varScNew, Patch('[FAS STUDIO] HostScoreTransactions', Defaults('[FAS STUDIO] HostScoreTransactions'), {
                                        Title: Text(p.transactionId),
                                        TransactionID: Text(p.transactionId),
                                        HostID: h.Title,
                                        RuleID: Text(p.ruleId),
                                        TransactionType: {Value: Text(p.transactionType)},   // "Reward" | "Penalty"
                                        Point: Value(p.point),                               // bertanda: penalty negatif
                                        ScoreBefore: cur,
                                        ScoreAfter: after,
                                        Reason: Text(p.ruleName),
                                        Notes: Text(p.notesText),                            // catatan + alasan override + konfirmasi
                                        Evidence: varScUrls,                                 // link bukti, satu per baris (kosong kalau tanpa bukti)
                                        Status: {Value: "Active"},
                                        CreatedDate: Now(),
                                        // Hapus kalau CreatedBy bukan kolom Person sendiri (pakai 'Created By' bawaan).
                                        CreatedBy: {Claims: "i:0#.f|membership|" & Lower(User().Email), DisplayName: User().FullName, Email: User().Email, Department: "", JobTitle: "", Picture: ""}
                                    }));
                                    IfError(
                                        Patch('Host - PBS Hub', h, {CurrentScore: after});
                                        Patch(colScHost, LookUp(colScHost, Title = h.Title), {CurrentScore: after});
                                        Collect(colScRecent, varScNew);
                                        If(varScHostId = h.Title, Collect(colScLedger, varScNew));
                                        Set(varScResult, JSON({requestId: rid, status: "ok", message: Text(p.transactionId) & " tersimpan · skor " & cur & " → " & after}, JSONFormat.Compact)),
                                        // Transaksi sudah masuk, CurrentScore belum: host akan tampil tidak sinkron.
                                        Set(varScResult, JSON({requestId: rid, status: "error", message: "Transaksi " & Text(p.transactionId) & " tersimpan, tapi CurrentScore gagal diperbarui (" & FirstError.Message & "). Isi CurrentScore " & after & " secara manual."}, JSONFormat.Compact))
                                    ),
                                    Set(varScResult, JSON({requestId: rid, status: "error", message: "Gagal menyimpan transaksi: " & FirstError.Message}, JSONFormat.Compact))
                                ));
                                Set(varScNew, Blank())
                            )))
                        )),
                    "VOID_SCORE",
                        With({o: LookUp('[FAS STUDIO] HostScoreTransactions', ID = Value(p.txItemId)), h: LookUp('Host - PBS Hub', Title = Text(p.hostId))},
                        With({cur: Coalesce(h.CurrentScore, h.InitialScore, varScCfg.InitialScore),
                              lo: Coalesce(h.MinimumScore, varScCfg.MinimumScore, 0),
                              hi: Coalesce(h.MaximumScore, varScCfg.MaximumScore, 100)},
                            If(!(userRole.Value in ["PBS_Team", "FAS_Team"]),
                                Set(varScResult, JSON({requestId: rid, status: "error", message: "Tidak punya izin mengubah skor."}, JSONFormat.Compact)),
                            If(IsBlank(o) || !(IsBlank(o.Status.Value) || o.Status.Value = "Active"),
                                Set(varScResult, JSON({requestId: rid, status: "conflict", message: "Transaksi " & Text(p.transactionId) & " sudah dibatalkan orang lain."}, JSONFormat.Compact)),
                            If(IsBlank(h) || cur <> Value(p.expectedScore),
                                Set(varScResult, JSON({requestId: rid, status: "conflict", message: "Skor host sudah berubah jadi " & cur & " sejak halaman dibuka. Tutup, muat ulang, lalu coba lagi."}, JSONFormat.Compact)),
                            With({after: Min(Max(cur - o.Point, lo), hi)},
                                IfError(
                                    // 1) baris koreksi dulu: kalau langkah berikutnya gagal, baris asli masih Active dan jumlah tetap benar.
                                    Patch('[FAS STUDIO] HostScoreTransactions', Defaults('[FAS STUDIO] HostScoreTransactions'), {
                                        Title: Text(p.reversalId),
                                        TransactionID: Text(p.reversalId),
                                        HostID: h.Title,
                                        RuleID: "VOID",
                                        TransactionType: {Value: If(o.Point > 0, "Penalty", "Reward")},
                                        Point: -o.Point,
                                        ScoreBefore: cur,
                                        ScoreAfter: after,
                                        Reason: "Pembatalan transaksi",
                                        Notes: Text(p.notesText),                            // "Membatalkan TX-…: alasan"
                                        Status: {Value: "Reversal"},
                                        CreatedDate: Now(),
                                        CreatedBy: {Claims: "i:0#.f|membership|" & Lower(User().Email), DisplayName: User().FullName, Email: User().Email, Department: "", JobTitle: "", Picture: ""}
                                    });
                                    // 2) baris asli → Void.
                                    Patch('[FAS STUDIO] HostScoreTransactions', o, {Status: {Value: "Void"}});
                                    IfError(
                                        // 3) skor host.
                                        Patch('Host - PBS Hub', h, {CurrentScore: after});
                                        Patch(colScHost, LookUp(colScHost, Title = h.Title), {CurrentScore: after});
                                        ClearCollect(colScLedger, Filter('[FAS STUDIO] HostScoreTransactions', HostID = h.Title));
                                        ClearCollect(colScRecent, Filter('[FAS STUDIO] HostScoreTransactions', CreatedDate >= DateAdd(Today(), -60, TimeUnit.Days)));
                                        Set(varScResult, JSON({requestId: rid, status: "ok", message: Text(p.transactionId) & " dibatalkan · skor " & cur & " → " & after}, JSONFormat.Compact)),
                                        Set(varScResult, JSON({requestId: rid, status: "error", message: "Transaksi dibatalkan, tapi CurrentScore gagal diperbarui (" & FirstError.Message & "). Isi CurrentScore " & after & " secara manual."}, JSONFormat.Compact))
                                    ),
                                    ClearCollect(colScLedger, Filter('[FAS STUDIO] HostScoreTransactions', HostID = h.Title));
                                    Set(varScResult, JSON({requestId: rid, status: "error", message: "Gagal membatalkan: " & FirstError.Message & ". Cek ledger: baris koreksi mungkin sudah tertulis."}, JSONFormat.Compact))
                                )
                            ))))
                        ))
                )
            )
        )
    )
)
```

Catatan:
- Upload dilakukan **setelah** cek izin & konflik skor dan **sebelum** transaksi ditulis. Upload gagal → transaksi
  tidak ditulis, dialog tetap terbuka dengan pesan error.
- Tanpa lampiran, `UploadData` kosong dan `Evidence` ditulis kosong (sama seperti sebelumnya).

## 7. App Ops · HostDetail

Layar `scrHostDetail`, control HostDetail → properti **ScoreTxJson**:

```powerfx
JSON(ForAll(colHdTx, {ID: ID, TransactionID: TransactionID, RuleID: RuleID, TransactionType: TransactionType.Value, Point: Point, ScoreBefore: ScoreBefore, ScoreAfter: ScoreAfter, Reason: Reason, Notes: Notes, Status: Status.Value, CreatedDate: CreatedDate, CreatedBy: CreatedBy.DisplayName, Evidence: Evidence}), JSONFormat.Compact)
```

Properti **OnChange** — tambahkan satu baris di dalam `Switch(act, …)`, mis. setelah `"HIDE_PII", …,`:

```powerfx
                    "OPEN_EVIDENCE", Launch(Text(p.url)),
```

## 8. App Host · Skor saya (CreditScore)

Layar `scrCreditScore` di app host, control CreditScore → properti **ScoreTxJson**:

```powerfx
JSON(ForAll(colCsTx, {ID: ID, TransactionID: TransactionID, RuleID: RuleID, TransactionType: TransactionType.Value, Point: Point,
    ScoreBefore: ScoreBefore, ScoreAfter: ScoreAfter, Reason: Reason, Notes: Notes, Status: Status.Value,
    CreatedDate: CreatedDate, CreatedBy: CreatedBy.DisplayName, Evidence: Evidence}), JSONFormat.Compact)
```

Properti **OnChange** — ganti seluruhnya (baris baru: `"OPEN_EVIDENCE", Launch(Text(p.url)),`):

```powerfx
If(!IsBlank(Self.ActionPayload),
    With({req: ParseJSON(Self.ActionPayload)},
        With({act: Text(req.action), rid: Text(req.requestId), p: req.payload},
            If(!(rid in colPbsProcessed.Id),
                Collect(colPbsProcessed, {Id: rid});
                Switch(act,
                    "PERIOD_CHANGED", Set(varCsPeriod, Text(p.period)),
                    "FILTER_CHANGED", Set(varCsFilter, Text(p.filter)),
                    "OPEN_EVIDENCE", Launch(Text(p.url)),
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

---

## Cek cepat

1. Ops → Skor host → pilih host → **Kurangi poin** → pilih rule → *Pilih file* → lampirkan foto → Simpan.
2. Banner hijau `TX-… tersimpan`. Di SharePoint muncul file di `Credit Score/<host>/<bulan>/`.
3. Baris transaksi di ledger punya tombol **Lihat bukti** → membuka file.
4. Kolom `Evidence` di list berisi link file.
5. Login sebagai host → Skor saya → transaksi itu punya **Lihat bukti** dan file bisa dibuka (cek izin langkah 2 kalau ditolak).

| Gejala | Penyebab |
|---|---|
| `Bukti gagal diunggah (…)` | `varSiteID`/`varDriveID` kosong/salah, atau Office 365 Groups belum ditambahkan |
| Error rumus `UploadData` tidak dikenal | Code component belum di-*Update* (langkah 3) |
| Tombol *Lihat bukti* tidak muncul | `Evidence: Evidence` belum ada di `LedgerJson`/`ScoreTxJson` |
| Host: *access denied* | Grup host belum diberi *Can view* di folder `Credit Score` |
