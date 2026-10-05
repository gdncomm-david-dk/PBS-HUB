"""Power Fx OnChange handlers for the host controls (hd, mr, mrd, ms, sd), shared by the docs generators."""

def res(R, status, msg):
    return f'Set({R}, JSON({{requestId: rid, status: "{status}", message: {msg}}}, JSONFormat.Compact))'

def ind(block, n):
    pad=' '*n
    return '\n'.join((pad+l if l.strip() else l) for l in block.strip('\n').split('\n'))

ZERO = """Penjualan: 0, Pesanan: 0, ProdukTerjual: 0, JumlahPembeli: 0, CTR: 0, CTOR: 0, PeakViewer: 0,
'Durasi(Min)': 0, AddToCart: 0, TotalViewer: 0, Comment: 0"""

# ---- Screenshot upload (Graph PUT, sama dengan app upload jadwal bulk/AI) and daily tier -----------

def graph_put(brand, date, title, platform, account):
    """Office365Groups.HttpRequest PUT into Report Automation/<Brand>/<yyyy>/<mmmm>/<REP-ID>/.
    UploadData is bare base64 JPEG; the data URI turns it into a binary body."""
    return (f'''Office365Groups.HttpRequest(
    "https://graph.microsoft.com/v1.0/sites/" & varSiteID & "/drives/" & varDriveID & "/root:/Report Automation/" &
    LookUp(colBrands, Title = {brand}).NamaBrand & "/" & Text({date}, "yyyy") & "/" & Text({date}, "mmmm") & "/" &
    {title} & "/" & {title} & "_" & {platform} & "_" & {account} & "_Report.png:/content",
    "PUT",
    "data:image/jpeg;base64," & data
)''')

TIER_TPL = '''// ---- Tier harian di Clock In: host ini, tanggal @DATE@. Aturan sama dengan hitung ulang bulanan.
IfError(
    With({tDate: @DATE@},
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
);'''

def tier(date_expr):
    return TIER_TPL.replace('@DATE@', date_expr)

def absen(R, col, after=''):
    """ABSEN: Schedule.Status first (Planned → Waiting Report / Finished), then the Host Absence row with Status Hadir.
    Every Patch is checked on its own: in a `;` chain Power Fx keeps going after a failed Patch, so one IfError
    around the chain reported "ok" while nothing was written. An absence left behind by an earlier half-finished
    absen is repaired instead of rejected, so the host is never stuck."""
    dup_after = ind(after, 16) + chr(10) if after else ''
    new_after = ind(after, 32) + chr(10) if after else ''
    err = lambda msg: res(R, "error", msg)
    now = "LookUp(scheduleFiltered, ID = s.ID).Status.Value"
    dup = res(R, "conflict", '"Absen sesi ini sudah tercatat (" & ex.Title & "). Status jadwal " & ' + now + ' & "."')
    ok_new = res(R, "ok", '"Absen tercatat (ABS-" & row.ID & "). Status jadwal sekarang " & ' + now + ' & "."')
    return f'''"ABSEN",
    // Jadwal dicari lewat ID SharePoint (scheduleItemId), Title hanya dicocokkan.
    With({{s: LookUp(scheduleFiltered, ID = Value(p.scheduleItemId)),
          ex: LookUp(absenceFiltered, ScheduleID = Text(p.scheduleId) && HostID = varMe.Title),
          st: Coalesce(Text(p.scheduleStatus), "Waiting Report")}},   // dari control: Waiting Report, atau Finished (Co-Host)
        If(
            IsBlank(s) || s.Title <> Text(p.scheduleId) || s.HostID <> varMe.Title,
                {err('"Jadwal " & Text(p.scheduleId) & " tidak ditemukan untuk akunmu. Muat ulang dulu."')},
            // Satu ScheduleID = satu absen. Sudah ada → ditolak, tidak ada baris absen baru.
            // Absen lama yang gagal di tengah (jadwal masih Planned / Status belum Hadir) dilengkapi sekalian.
            !IsBlank(ex),
                If(s.Status.Value <> "Waiting Report" && s.Status.Value <> "Finished" && s.Status.Value <> "Done",
                    With({{_upd: Patch('Schedule - PBS Hub', s, {{Status: {{Value: st}}}})}}, RemoveIf(scheduleFiltered, ID = _upd.ID); Collect(scheduleFiltered, _upd); _upd));
                If(Coalesce(ex.Status.Value, "") <> "Hadir", With({{_upd: Patch('Host Absence - PBS Hub', ex, {{Status: {{Value: "Hadir"}}}})}}, RemoveIf(absenceFiltered, ID = _upd.ID); Collect(absenceFiltered, _upd); _upd));
                If(!(ex.ID in {col}.ID), Collect({col}, LookUp(absenceFiltered, ID = ex.ID)));
{dup_after}                {dup},
            // 1. Status jadwal. Gagal → pesan error asli, belum ada yang ditulis.
            With({{sp: IfError(With({{_upd: Patch('Schedule - PBS Hub', s, {{Status: {{Value: st}}}})}}, RemoveIf(scheduleFiltered, ID = _upd.ID); Collect(scheduleFiltered, _upd); _upd),
                        {err('"Gagal mengubah status jadwal ke " & st & ": " & FirstError.Message')}; Blank())}},
                If(!IsBlank(sp),
                        // 2. Baris absen baru, Status Hadir.
                        With({{row: IfError(With({{_new: Patch('Host Absence - PBS Hub', Defaults('Host Absence - PBS Hub'), {{
                                    ScheduleID: s.Title, HostID: varMe.Title, HostName: Coalesce(LookUp('Host - PBS Hub', Title = varMe.Title).NamaHost, Text(p.hostName)), LiveDate: s.Date,
                                    BrandID: s.BrandID, Platform: {{Value: s.Platform.Value}},
                                    Account: Coalesce(LookUp(colAccounts, Title = s.Account).AccountName, Text(p.accountName), s.Account),
                                    Status: {{Value: "Hadir"}}   // Choice Status di Host Absence; kalau kolomnya teks: Status: "Hadir"
                                }})}}, Collect(absenceFiltered, _new); _new),
                                {err('"Status jadwal sudah " & st & ", tapi absen gagal dicatat: " & FirstError.Message')}; Blank())}},
                            If(!IsBlank(row),
                                With({{_upd: Patch('Host Absence - PBS Hub', row, {{Title: "ABS-" & row.ID}})}}, RemoveIf(absenceFiltered, ID = _upd.ID); Collect(absenceFiltered, _upd); _upd);
                                Collect({col}, LookUp(absenceFiltered, ID = row.ID));
{new_after}                                // Pesan membaca ulang SharePoint, jadi yang tampil adalah status yang benar-benar tersimpan.
                                {ok_new}
                            )
                        )
                )
            )
        )
    ),'''

METRICS = """Penjualan: Value(m.Penjualan), Pesanan: Value(m.Pesanan), ProdukTerjual: Value(m.ProdukTerjual),
JumlahPembeli: Value(m.JumlahPembeli), CTR: Value(m.CTR), CTOR: Value(m.CTOR), PeakViewer: Value(m.PeakViewer),
'Durasi(Min)': Value(m.'Durasi(Min)'), AddToCart: Value(m.AddToCart), TotalViewer: Value(m.TotalViewer),
Comment: Value(m.Comment),
LiveID: Text(p.liveId), Playbook: {Value: Text(p.playbook)},"""

def submit(R, after):
    return f'''"SUBMIT_REPORT",
    With({{m: p.metrics, s: LookUp(scheduleFiltered, Title = Text(p.scheduleId) && HostID = varMe.Title)}},
        // Hapus cabang ini kalau config.requireAbsen = false.
        If(IsBlank(LookUp(absenceFiltered, ScheduleID = Text(p.scheduleId) && HostID = varMe.Title)),
            {res(R, "error", '"Absen sesi ini belum tercatat."')},
        // Report hanya dibuka saat jadwal Waiting Report (hapus kalau config.requireWaitingStatus = false).
        // Setelah durasi terpenuhi statusnya Finished, jadi report tambahan ditolak di sini.
        s.Status.Value <> "Waiting Report",
            {res(R, "conflict", '"Status jadwal " & s.Status.Value & ", report tidak bisa dikirim. Muat ulang dulu."')},
        // Live terputus boleh punya beberapa report, tapi satu Live ID hanya sekali.
        !IsBlank(LookUp(reportFiltered, ScheduleID = s.Title && HostID = varMe.Title && LiveID = Text(p.liveId))),
            {res(R, "conflict", '"Live ID " & Text(p.liveId) & " sudah dilaporkan untuk sesi ini."')},
            IfError(
                With({{row: With({{_new: Patch('Report - PBS Hub', Defaults('Report - PBS Hub'), {{
                        ScheduleID: s.Title, HostID: varMe.Title, BrandID: s.BrandID, Platform: {{Value: s.Platform.Value}},
                        AccountID: s.Account, HostName: Coalesce(LookUp('Host - PBS Hub', Title = varMe.Title).NamaHost, Text(p.hostName)),   // nama host dari list Host
                        Account: With({{nm: Trim(Coalesce(LookUp(colAccounts, Title = s.Account).AccountName, Text(p.accountName), s.Account)), cd: Trim(s.Account)}},
                            Coalesce(LookUp(Choices([@'Report - PBS Hub'].Account), Lower(Trim(Value)) = Lower(nm) || Lower(Trim(Value)) = Lower(cd) || (Len(nm) > 0 && Lower(nm) in Lower(Value)) || (Len(cd) > 0 && Lower(cd) in Lower(Value))), {{Value: nm}})),   // Choice: cocokkan nama akun, cadangan teks nama
                        LiveDate: s.Date, AbsID: Text(p.absId),
{ind(METRICS, 24)}
                        ApprovalStatus: {{Value: "Waiting Approval"}}
                    }})}}, Collect(reportFiltered, _new); _new)}},
                    With({{title: "REP-" & row.ID}},
                        With({{_upd: Patch('Report - PBS Hub', row, {{Title: title}})}}, RemoveIf(reportFiltered, ID = _upd.ID); Collect(reportFiltered, _upd); _upd);
                        // Screenshot → Report Automation/<Brand>/<yyyy>/<mmmm>/REP-<ID>/REP-<ID>_<Platform>_<Account>_Report.png
                        // (Graph PUT, sama dengan app upload jadwal bulk/AI). webUrl dari respons Graph → Attachment.
                        If(!IsBlank(data),
                            With({{up: {ind(graph_put("s.BrandID", "Today()", "title", "s.Platform.Value", "s.Account"), 32).strip()}}},
                                With({{_upd: Patch('Report - PBS Hub', row, {{Attachment: Text(up.webUrl)}})}}, RemoveIf(reportFiltered, ID = _upd.ID); Collect(reportFiltered, _upd); _upd)
                            )
                        );
                        // Total Durasi(Min) semua report sesi ini ≥ durasi jadwal → "Finished", kalau belum tetap "Waiting Report".
                        With({{_upd: Patch('Schedule - PBS Hub', s, {{Status: {{Value: Text(p.scheduleStatus)}}}})}}, RemoveIf(scheduleFiltered, ID = _upd.ID); Collect(scheduleFiltered, _upd); _upd);
{ind(tier("s.Date"), 24)}
{ind(after, 24)}
                        {res(R, "ok", 'If(Boolean(p.complete), "Report " & title & " terkirim. Durasi sesi terpenuhi.", "Report " & title & " terkirim. Kurang " & Text(p.remainingMin) & " menit, kirim report berikutnya.")')}
                    )
                ),
                {res(R, "error", '"Gagal mengirim report: " & FirstError.Message')}
            )
        )
    ),'''

def live_break(R, after):
    """LIVE_BREAK: asked when the host is about to report. No report is owed: Schedule.LiveBreak = Yes, status Finished,
    and a Report row of zeros with ApprovalStatus LiveBreak so the list stays complete."""
    return f'''"LIVE_BREAK",
    With({{s: LookUp(scheduleFiltered, Title = Text(p.scheduleId) && HostID = varMe.Title),
          ex: LookUp(absenceFiltered, ScheduleID = Text(p.scheduleId) && HostID = varMe.Title)}},
        If(IsBlank(s),
            {res(R, "error", '"Jadwal " & Text(p.scheduleId) & " tidak ditemukan untuk akunmu. Muat ulang dulu."')},
        // Sama dengan report: harus sudah absen dan jadwal Waiting Report.
        IsBlank(ex),
            {res(R, "error", '"Absen sesi ini belum tercatat."')},
        s.Status.Value <> "Waiting Report",
            {res(R, "conflict", '"Status jadwal " & s.Status.Value & ", Live Break tidak bisa ditandai. Muat ulang dulu."')},
        // Sudah ada report untuk sesi ini (live terputus sebagian): bukan Live Break lagi.
        !IsBlank(LookUp(reportFiltered, ScheduleID = s.Title && HostID = varMe.Title)),
            {res(R, "conflict", '"Sesi ini sudah punya report, jadi tidak bisa ditandai Live Break."')},
            IfError(
                With({{rep: With({{_new: Patch('Report - PBS Hub', Defaults('Report - PBS Hub'), {{
                        ScheduleID: s.Title, HostID: varMe.Title, BrandID: s.BrandID, Platform: {{Value: s.Platform.Value}},
                        AccountID: s.Account, HostName: Coalesce(LookUp('Host - PBS Hub', Title = varMe.Title).NamaHost, Text(p.hostName)),   // nama host dari list Host
                        Account: With({{nm: Trim(Coalesce(LookUp(colAccounts, Title = s.Account).AccountName, Text(p.accountName), s.Account)), cd: Trim(s.Account)}},
                            Coalesce(LookUp(Choices([@'Report - PBS Hub'].Account), Lower(Trim(Value)) = Lower(nm) || Lower(Trim(Value)) = Lower(cd) || (Len(nm) > 0 && Lower(nm) in Lower(Value)) || (Len(cd) > 0 && Lower(cd) in Lower(Value))), {{Value: nm}})),   // Choice: cocokkan nama akun, cadangan teks nama
                        LiveDate: s.Date, AbsID: ex.Title,
{ind(ZERO, 24)},
                        ApprovalStatus: {{Value: "LiveBreak"}}
                    }})}}, Collect(reportFiltered, _new); _new)}},
                    With({{_upd: Patch('Report - PBS Hub', rep, {{Title: "REP-" & rep.ID}})}}, RemoveIf(reportFiltered, ID = _upd.ID); Collect(reportFiltered, _upd); _upd);
                    // LiveBreak = Yes (Choice Yes/No) dan Status jadwal Finished.
                    With({{_upd: Patch('Schedule - PBS Hub', s, {{LiveBreak: {{Value: "Yes"}}, Status: {{Value: Text(p.scheduleStatus)}}}})}}, RemoveIf(scheduleFiltered, ID = _upd.ID); Collect(scheduleFiltered, _upd); _upd);
{ind(tier("s.Date"), 20)}
{ind(after, 20)}
                    {res(R, "ok", '"Sesi " & s.Title & " ditandai Live Break. Report 0 dibuat (REP-" & rep.ID & ")."')}
                ),
                {res(R, "error", '"Gagal menandai Live Break: " & FirstError.Message')}
            )
        )
    ),'''

def resubmit(R, after):
    return f'''"RESUBMIT_REPORT",
    With({{cur: LookUp(reportFiltered, ID = Value(p.reportId) && HostID = varMe.Title), m: p.metrics}},
        // Modified dari JSON berformat UTC ("…Z"); DateTimeValue mengubahnya ke jam lokal sebelum dibandingkan.
        If(IsBlank(cur) || cur.ApprovalStatus.Value <> "Need Revision" ||
           Abs(DateDiff(cur.Modified, DateTimeValue(Text(p.expectedModified)), TimeUnit.Seconds)) > 1,
            {res(R, "conflict", '"Report ini sudah berubah. Muat ulang dulu."')},
            IfError(
                With({{_upd: Patch('Report - PBS Hub', cur, {{
                    Penjualan: Value(m.Penjualan), Pesanan: Value(m.Pesanan), ProdukTerjual: Value(m.ProdukTerjual),
                    JumlahPembeli: Value(m.JumlahPembeli), CTR: Value(m.CTR), CTOR: Value(m.CTOR), PeakViewer: Value(m.PeakViewer),
                    'Durasi(Min)': Value(m.'Durasi(Min)'), AddToCart: Value(m.AddToCart), TotalViewer: Value(m.TotalViewer),
                    Comment: Value(m.Comment),
                    LiveID: Text(p.liveId), Playbook: {{Value: Text(p.playbook)}},
                    ApprovalStatus: {{Value: Text(p.approvalStatus)}},   // "Waiting Approval Revision"
                    ApprovalComment: cur.ApprovalComment & Char(10) & "[Revisi host] " &
                        If(IsBlank(Text(p.note)), "angka diperbaiki: " & Concat(Table(p.changed), Text(ThisRecord.Value), ", "), Text(p.note))
                }})}}, RemoveIf(reportFiltered, ID = _upd.ID); Collect(reportFiltered, _upd); _upd);
                // Report Automation dengan Title yang sama: hanya Status yang diubah (Unmatch → dibaca ulang).
                With({{ev: LookUp('Report Automation - PBS Hub', Title = cur.Title)}},
                    If(!IsBlank(ev), Patch('Report Automation - PBS Hub', ev, {{Status: {{Value: Text(p.evidenceStatus)}}}}))
                );
                // Screenshot baru (opsional): path dan nama file sama dengan upload pertama (folder bulan dari Created)
                // → file lama ditimpa, flow AI membaca ulang.
                If(!IsBlank(p.file) && !IsBlank(data),
                    With({{up: {ind(graph_put("cur.BrandID", "cur.Created", "cur.Title", "cur.Platform.Value", "cur.AccountID"), 24).strip()}}},
                        With({{_upd: Patch('Report - PBS Hub', LookUp(reportFiltered, ID = cur.ID), {{Attachment: Text(up.webUrl)}})}}, RemoveIf(reportFiltered, ID = _upd.ID); Collect(reportFiltered, _upd); _upd))
                );
                // Durasi bisa ikut direvisi: status jadwal dihitung ulang oleh control (Waiting Report / Finished).
                If(!IsBlank(Text(p.scheduleStatus)),
                    With({{_upd: Patch('Schedule - PBS Hub', LookUp(scheduleFiltered, Title = cur.ScheduleID && HostID = varMe.Title), {{Status: {{Value: Text(p.scheduleStatus)}}}})}}, RemoveIf(scheduleFiltered, ID = _upd.ID); Collect(scheduleFiltered, _upd); _upd));
                // Angka berubah → Tier hari itu dihitung ulang.
{ind(tier("cur.LiveDate"), 16)}
{ind(after, 16)}
                {res(R, "ok", '"Revisi terkirim, menunggu review ulang."')},
                {res(R, "error", '"Gagal mengirim revisi: " & FirstError.Message')}
            )
        )
    ),'''

def dispute(R, after):
    return f'''"DISPUTE_REVIEW",
    With({{cur: LookUp(reportFiltered, ID = Value(p.reportId) && HostID = varMe.Title)}},
        If(IsBlank(cur) || cur.ApprovalStatus.Value <> "Need Revision",
            {res(R, "conflict", '"Report ini sudah tidak menunggu revisi. Muat ulang dulu."')},
            IfError(
                // Status tetap Need Revision; reviewer membaca sanggahan di ApprovalComment.
                With({{_upd: Patch('Report - PBS Hub', cur, {{ApprovalComment: cur.ApprovalComment & Char(10) & "[Sanggahan host] " & Text(p.reason)}})}}, RemoveIf(reportFiltered, ID = _upd.ID); Collect(reportFiltered, _upd); _upd);
{ind(after, 16)}
                {res(R, "ok", '"Sanggahan terkirim ke reviewer."')},
                {res(R, "error", '"Gagal mengirim sanggahan: " & FirstError.Message')}
            )
        )
    ),'''

def delete(R, after):
    return f'''"DELETE_REPORT",
    With({{cur: LookUp(reportFiltered, ID = Value(p.reportId) && HostID = varMe.Title)}},
        If(IsBlank(cur),
            {res(R, "conflict", '"Report ini sudah tidak ada. Muat ulang dulu."')},
        // Sudah Match / Done / Live Break: host tidak boleh menghapus (sama dengan aturan di control).
        Coalesce(cur.Match.Value, "") = "Match" || cur.ApprovalStatus.Value in ["Done", "LiveBreak"],
            {res(R, "conflict", '"Report ini sudah Match atau disetujui, jadi tidak bisa dihapus. Hubungi tim PBS."')},
            IfError(
                // AI Report (Report Automation) dengan Title yang sama ikut dihapus.
                RemoveIf('Report Automation - PBS Hub', Title = cur.Title);
                Remove('Report - PBS Hub', LookUp('Report - PBS Hub', ID = cur.ID));
                RemoveIf(reportFiltered, ID = cur.ID);
                // Status jadwal dihitung control: kembali Waiting Report kalau report sisanya belum menutup durasi sesi.
                With({{s: LookUp(scheduleFiltered, Title = cur.ScheduleID && HostID = varMe.Title)}},
                    If(!IsBlank(s) && !IsBlank(Text(p.scheduleStatus)) && s.Status.Value <> Text(p.scheduleStatus),
                        With({{_upd: Patch('Schedule - PBS Hub', s, {{Status: {{Value: Text(p.scheduleStatus)}}}})}}, RemoveIf(scheduleFiltered, ID = _upd.ID); Collect(scheduleFiltered, _upd); _upd)));
{ind(after, 16)}
                {res(R, "ok", '"Report " & Text(p.title) & " dihapus."')};
                Back(),
                {res(R, "error", '"Gagal menghapus report: " & FirstError.Message')}
            )
        )
    ),'''

def shell(handlers, upload=False):
    data = ', data: Self.UploadData' if upload else ''
    return f'''If(!IsBlank(Self.ActionPayload),
    With({{req: ParseJSON(Self.ActionPayload)}},
        With({{act: Text(req.action), rid: Text(req.requestId), p: req.payload{data}}},
            If(!(rid in colPbsProcessed.Id),
                Collect(colPbsProcessed, {{Id: rid}});
                Switch(act,
{ind(handlers, 20)}
                    // aksi lain: tidak ada yang perlu dilakukan
                    false
                )
            )
        )
    )
)'''

NAV_REPORT = '''"NEW_REPORT",
    Set(varRptSchedule, Text(p.scheduleId)); Set(varRptId, Blank()); Navigate(scrMyReportDetail),
"OPEN_REPORT",
    Set(varRptId, Value(p.reportId)); Set(varRptSchedule, Text(p.scheduleId)); Navigate(scrMyReportDetail),'''
OPEN_SCH = '''"OPEN_SCHEDULE",
    Set(varSchId, Text(p.scheduleId)); Set(varSchDate, DateValue(Text(p.liveDate))); Navigate(scrScheduleDetail),'''

hd = shell('\n'.join([
 '"CLOCK_IN", Navigate(scrClockIn),',
 '"CLOCK_OUT", Navigate(scrClockIn),',
 absen('varHdResult','colMyAbs', "ClearCollect(colMySch, Filter(scheduleFiltered, HostID = varMe.Title, Date >= Today() - 7, Date <= Today() + 7));\nClearCollect(colMyRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate >= Today() - 30));"),
 NAV_REPORT, OPEN_SCH,
 '''"NAV",
    Switch(Text(p.target), "REPORTS", Navigate(scrMyReports), "SCHEDULE", Navigate(scrMySchedule), "SCORE", Navigate(scrCreditScore)),''',
]))

mr_reload = '''Set(varMrLoading, true);
With({from: If(IsBlank(varMrPeriod), Date(Year(Today()), Month(Today()), 1), DateValue(varMrPeriod & "-01"))},
    ClearCollect(colMrRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate >= from, LiveDate < DateAdd(from, 1, TimeUnit.Months)));
    ClearCollect(colMrSch, Filter(scheduleFiltered, HostID = varMe.Title, Date >= from, Date < DateAdd(from, 1, TimeUnit.Months)))
);
Set(varMrLoading, false),'''
mr = shell('\n'.join([
 '"PERIOD_CHANGED",\n    Set(varMrPeriod, Text(p.period));\n'+ind(mr_reload,4),
 '"FILTER_CHANGED", Set(varMrFilter, Text(p.filter)),',
 NAV_REPORT,
]))

mrd_sch = """Set(varMrdSch, LookUp(scheduleFiltered, ID = varMrdSch.ID));
ClearCollect(colMrdSesRep, Filter(reportFiltered, HostID = varMe.Title, ScheduleID = varMrdSch.Title));"""
# Belum lengkap: ReportJson tetap kosong supaya form "Send Next Report" tetap di layar.
mrd_after_submit = mrd_sch + """
If(Boolean(p.complete), Set(varRptId, row.ID); Set(varMrdRep, LookUp(reportFiltered, ID = row.ID)));"""
mrd_after = "Set(varMrdRep, LookUp(reportFiltered, ID = cur.ID));\n" + mrd_sch
mrd = shell('\n'.join([
 absen('varMrdResult','colMrdAbs', mrd_sch),
 submit('varMrdResult', mrd_after_submit),
 live_break('varMrdResult', mrd_sch),
 resubmit('varMrdResult', mrd_after),
 dispute('varMrdResult', mrd_after),
 delete('varMrdResult', "Set(varRptId, Blank()); Set(varMrdRep, LookUp(reportFiltered, ID = -1));\n" + mrd_sch),
 '"OPEN_EVIDENCE", Launch(Text(p.url)),',
 '"BACK", Back(),',
]), upload=True)

MS_AFTER = '''// bulan lalu ikut dimuat (panel "Bulan lalu", report tertunda), plus 7 hari bulan depan (papan minggu)
With({from: DateAdd(If(IsBlank(varMsPeriod), Date(Year(Today()), Month(Today()), 1), DateValue(varMsPeriod & "-01")), -1, TimeUnit.Months)},
    ClearCollect(colMsSch, Filter(scheduleFiltered, HostID = varMe.Title, Date >= from, Date < DateAdd(from, 2, TimeUnit.Months) + 7));
    ClearCollect(colMsRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate >= from, LiveDate < DateAdd(from, 2, TimeUnit.Months) + 7))
);'''
ms_reload = '''Set(varMsLoading, true);
// bulan lalu + bulan ini + 7 hari bulan depan: panel Bulan lalu, report tertunda, papan minggu
With({from: DateAdd(If(IsBlank(varMsPeriod), Date(Year(Today()), Month(Today()), 1), DateValue(varMsPeriod & "-01")), -1, TimeUnit.Months)},
    With({to: DateAdd(from, 2, TimeUnit.Months) + 7},
        ClearCollect(colMsSch, Filter(scheduleFiltered, HostID = varMe.Title, Date >= from, Date < to));
        ClearCollect(colMsClk, Filter(clockInFiltered, HostID = varMe.Title, ClockInDate >= from, ClockInDate < to));
        ClearCollect(colMsAbs, Filter(absenceFiltered, HostID = varMe.Title, LiveDate >= from, LiveDate < to));
        ClearCollect(colMsRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate >= from, LiveDate < to))
    )
);
Set(varMsLoading, false),'''
ms = shell('\n'.join([
 OPEN_SCH,
 absen('varMsResult','colMsAbs', MS_AFTER),
 '"CLOCK_IN", Navigate(scrClockIn),',
 NAV_REPORT,
 '"PERIOD_CHANGED",\n    Set(varMsPeriod, Text(p.period));\n'+ind(ms_reload,4),
 '"FILTER_CHANGED", Set(varMsFilter, Text(p.status)),',
 '"VIEW_CHANGED", Set(varMsView, Text(p.view)),',
 '"CONTACT_PIC", Launch(varPicUrl),   // mis. "mailto:pic@…" atau link chat Teams PIC jadwal',
]))

sd_sch = "ClearCollect(colSdSch, Filter(scheduleFiltered, HostID = varMe.Title, Date = varSchDate));"
sd_after = "ClearCollect(colSdRep, Filter(reportFiltered, HostID = varMe.Title, LiveDate = varSchDate));"
sd_after_submit = sd_sch + chr(10) + sd_after
sd_after = sd_after_submit
sd = shell('\n'.join([
 absen('varSdResult','colSdAbs', sd_after_submit),
 submit('varSdResult', sd_after_submit),
 live_break('varSdResult', sd_after_submit),
 resubmit('varSdResult', sd_after),
 dispute('varSdResult', sd_after),
 '"CLOCK_IN", Navigate(scrClockIn),',
 NAV_REPORT,
 '"OPEN_EVIDENCE", Launch(Text(p.url)),',
 '"OPEN_SCHEDULE", Set(varSchId, Text(p.scheduleId)),   // sesi lain di hari yang sama: data sudah ada',
 '"BACK", Back(),',
]), upload=True)

# Skor saya: read only. Month and filter work on the rows already loaded; LOAD_MORE loads older transactions.
cs_reload = '''Set(varCsLoading, true);
ClearCollect(colCsTx, FirstN(Sort(Filter('[FAS STUDIO] HostScoreTransactions', HostID = varMe.Title), CreatedDate, SortOrder.Descending), varCsTop));
Set(varCsLoading, false)'''
cs = shell('\n'.join([
 '"PERIOD_CHANGED", Set(varCsPeriod, Text(p.period)),',
 '"FILTER_CHANGED", Set(varCsFilter, Text(p.filter)),',
 '"LOAD_MORE",\n    Set(varCsTop, varCsTop + 200);\n'+ind(cs_reload,4)+',',
]))
