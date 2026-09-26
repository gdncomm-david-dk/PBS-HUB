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
        });
        true   // IfError butuh tipe yang sama dengan Notify (Boolean), bukan record hasil Patch
    )))))))))),
    // Report tetap tersimpan kalau hitung Tier gagal; hitung ulang bulanan akan membetulkannya.
    Notify("Report tersimpan, tapi Tier belum terhitung: " & FirstError.Message, NotificationType.Warning)
);'''

def tier(date_expr):
    return TIER_TPL.replace('@DATE@', date_expr)

def absen(R, col, after=''):
    return f'''"ABSEN",
    If(!IsBlank(LookUp('Host Absence - PBS Hub', ScheduleID = Text(p.scheduleId) && HostID = varMe.Title)),
        {res(R, "conflict", '"Absen sesi ini sudah tercatat."')},
        IfError(
            With({{s: LookUp('Schedule - PBS Hub', Title = Text(p.scheduleId) && HostID = varMe.Title), lb: Boolean(p.liveBreak)}},
                With({{row: Patch('Host Absence - PBS Hub', Defaults('Host Absence - PBS Hub'), {{
                        ScheduleID: s.Title, HostID: varMe.Title, HostName: Text(p.hostName), LiveDate: s.Date,
                        BrandID: s.BrandID, Platform: {{Value: s.Platform.Value}}, Account: LookUp(Choices([@'Host Absence - PBS Hub'].Account), Value = s.Account || Value = LookUp(colAccounts, Title = s.Account).AccountName)
                        // , Status: {{Value: "Present"}}   ← nilai Choice Status di Host Absence, kalau kolomnya ada
                    }})}},
                    Patch('Host Absence - PBS Hub', row, {{Title: "ABS-" & row.ID}});
                    Collect({col}, LookUp('Host Absence - PBS Hub', ID = row.ID));
                    // Status jadwal dari control: "Waiting Report" (report dibuka) atau "Done" (Live Break / Co-Host).
                    Patch('Schedule - PBS Hub', s, {{Status: {{Value: Text(p.scheduleStatus)}}}});
                    // Live Break: host tidak perlu report, tapi baris Report tetap dibuat, semua angka 0.
                    If(lb,
                        Patch('Schedule - PBS Hub', LookUp('Schedule - PBS Hub', ID = s.ID), {{LiveBreak: {{Value: "Yes"}}}});   // Choice Yes/No
                        With({{rep: Patch('Report - PBS Hub', Defaults('Report - PBS Hub'), {{
                                ScheduleID: s.Title, HostID: varMe.Title, BrandID: s.BrandID, Platform: {{Value: s.Platform.Value}},
                                AccountID: s.Account, Account: LookUp(Choices([@'Report - PBS Hub'].Account), Value = s.Account || Value = LookUp(colAccounts, Title = s.Account).AccountName), LiveDate: s.Date, AbsID: "ABS-" & row.ID,
{ind(ZERO, 32)},
                                ApprovalStatus: {{Value: "LiveBreak"}}
                            }})}},
                            Patch('Report - PBS Hub', rep, {{Title: "REP-" & rep.ID}})
                        );
{ind(tier("s.Date").rstrip(';'), 24)}
                    )
                )
            );
{ind(after, 12) + chr(10) if after else ''}            {res(R, "ok", 'If(Boolean(p.liveBreak), "Absen tercatat. Live Break: report 0 dibuat otomatis.", "Absen tercatat untuk " & Text(p.scheduleId) & ".")')},
            {res(R, "error", '"Gagal absen: " & FirstError.Message')}
        )
    ),'''

METRICS = """Penjualan: Value(m.Penjualan), Pesanan: Value(m.Pesanan), ProdukTerjual: Value(m.ProdukTerjual),
JumlahPembeli: Value(m.JumlahPembeli), CTR: Value(m.CTR), CTOR: Value(m.CTOR), PeakViewer: Value(m.PeakViewer),
'Durasi(Min)': Value(m.'Durasi(Min)'), AddToCart: Value(m.AddToCart), TotalViewer: Value(m.TotalViewer),
Comment: Value(m.Comment),
LiveID: Text(p.liveId), Playbook: {Value: Text(p.playbook)},"""

def submit(R, after):
    return f'''"SUBMIT_REPORT",
    With({{m: p.metrics, s: LookUp('Schedule - PBS Hub', Title = Text(p.scheduleId) && HostID = varMe.Title)}},
        // Hapus cabang ini kalau config.requireAbsen = false.
        If(IsBlank(LookUp('Host Absence - PBS Hub', ScheduleID = Text(p.scheduleId) && HostID = varMe.Title)),
            {res(R, "error", '"Absen sesi ini belum tercatat."')},
        // Report hanya dibuka saat jadwal Waiting Report (hapus kalau config.requireWaitingStatus = false).
        // Setelah durasi terpenuhi statusnya Done, jadi report tambahan ditolak di sini.
        s.Status.Value <> "Waiting Report",
            {res(R, "conflict", '"Status jadwal " & s.Status.Value & ", report tidak bisa dikirim. Muat ulang dulu."')},
        // Live terputus boleh punya beberapa report, tapi satu Live ID hanya sekali.
        !IsBlank(LookUp('Report - PBS Hub', ScheduleID = s.Title && HostID = varMe.Title && LiveID = Text(p.liveId))),
            {res(R, "conflict", '"Live ID " & Text(p.liveId) & " sudah dilaporkan untuk sesi ini."')},
            IfError(
                With({{row: Patch('Report - PBS Hub', Defaults('Report - PBS Hub'), {{
                        ScheduleID: s.Title, HostID: varMe.Title, BrandID: s.BrandID, Platform: {{Value: s.Platform.Value}},
                        AccountID: s.Account, Account: LookUp(Choices([@'Report - PBS Hub'].Account), Value = s.Account || Value = LookUp(colAccounts, Title = s.Account).AccountName), LiveDate: s.Date, AbsID: Text(p.absId),
{ind(METRICS, 24)}
                        ApprovalStatus: {{Value: "Waiting Approval"}}
                    }})}},
                    With({{title: "REP-" & row.ID}},
                        Patch('Report - PBS Hub', row, {{Title: title}});
                        // Screenshot → Report Automation/<Brand>/<yyyy>/<mmmm>/REP-<ID>/REP-<ID>_<Platform>_<Account>_Report.png
                        // (Graph PUT, sama dengan app upload jadwal bulk/AI). webUrl dari respons Graph → Attachment.
                        If(!IsBlank(data),
                            With({{up: {ind(graph_put("s.BrandID", "Today()", "title", "s.Platform.Value", "s.Account"), 32).strip()}}},
                                Patch('Report - PBS Hub', row, {{Attachment: Text(up.webUrl)}})
                            )
                        );
                        // Total Durasi(Min) semua report sesi ini ≥ durasi jadwal → "Done", kalau belum tetap "Waiting Report".
                        Patch('Schedule - PBS Hub', s, {{Status: {{Value: Text(p.scheduleStatus)}}}});
{ind(tier("s.Date"), 24)}
{ind(after, 24)}
                        {res(R, "ok", 'If(Boolean(p.complete), "Report " & title & " terkirim. Durasi sesi terpenuhi.", "Report " & title & " terkirim. Kurang " & Text(p.remainingMin) & " menit, kirim report berikutnya.")')}
                    )
                ),
                {res(R, "error", '"Gagal mengirim report: " & FirstError.Message')}
            )
        )
    ),'''

def resubmit(R, after):
    return f'''"RESUBMIT_REPORT",
    With({{cur: LookUp('Report - PBS Hub', ID = Value(p.reportId) && HostID = varMe.Title), m: p.metrics}},
        // Modified dari JSON berformat UTC ("…Z"); DateTimeValue mengubahnya ke jam lokal sebelum dibandingkan.
        If(IsBlank(cur) || cur.ApprovalStatus.Value <> "Need Revision" ||
           Abs(DateDiff(cur.Modified, DateTimeValue(Text(p.expectedModified)), TimeUnit.Seconds)) > 1,
            {res(R, "conflict", '"Report ini sudah berubah. Muat ulang dulu."')},
            IfError(
                Patch('Report - PBS Hub', cur, {{
                    Penjualan: Value(m.Penjualan), Pesanan: Value(m.Pesanan), ProdukTerjual: Value(m.ProdukTerjual),
                    JumlahPembeli: Value(m.JumlahPembeli), CTR: Value(m.CTR), CTOR: Value(m.CTOR), PeakViewer: Value(m.PeakViewer),
                    'Durasi(Min)': Value(m.'Durasi(Min)'), AddToCart: Value(m.AddToCart), TotalViewer: Value(m.TotalViewer),
                    Comment: Value(m.Comment),
                    LiveID: Text(p.liveId), Playbook: {{Value: Text(p.playbook)}},
                    ApprovalStatus: {{Value: Text(p.approvalStatus)}},   // "Waiting Approval Revision"
                    ApprovalComment: cur.ApprovalComment & Char(10) & "[Revisi host] " &
                        If(IsBlank(Text(p.note)), "angka diperbaiki: " & Concat(Table(p.changed), Text(ThisRecord.Value), ", "), Text(p.note))
                }});
                // Report Automation dengan Title yang sama: hanya Status yang diubah (Unmatch → dibaca ulang).
                With({{ev: LookUp('Report Automation - PBS Hub', Title = cur.Title)}},
                    If(!IsBlank(ev), Patch('Report Automation - PBS Hub', ev, {{Status: {{Value: Text(p.evidenceStatus)}}}}))
                );
                // Screenshot baru (opsional): path dan nama file sama dengan upload pertama (folder bulan dari Created)
                // → file lama ditimpa, flow AI membaca ulang.
                If(!IsBlank(p.file) && !IsBlank(data),
                    With({{up: {ind(graph_put("cur.BrandID", "cur.Created", "cur.Title", "cur.Platform.Value", "cur.AccountID"), 24).strip()}}},
                        Patch('Report - PBS Hub', LookUp('Report - PBS Hub', ID = cur.ID), {{Attachment: Text(up.webUrl)}}))
                );
                // Durasi bisa ikut direvisi: status jadwal dihitung ulang oleh control (Waiting Report / Done).
                If(!IsBlank(Text(p.scheduleStatus)),
                    Patch('Schedule - PBS Hub', LookUp('Schedule - PBS Hub', Title = cur.ScheduleID && HostID = varMe.Title), {{Status: {{Value: Text(p.scheduleStatus)}}}}));
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
    With({{cur: LookUp('Report - PBS Hub', ID = Value(p.reportId) && HostID = varMe.Title)}},
        If(IsBlank(cur) || cur.ApprovalStatus.Value <> "Need Revision",
            {res(R, "conflict", '"Report ini sudah tidak menunggu revisi. Muat ulang dulu."')},
            IfError(
                // Status tetap Need Revision; reviewer membaca sanggahan di ApprovalComment.
                Patch('Report - PBS Hub', cur, {{ApprovalComment: cur.ApprovalComment & Char(10) & "[Sanggahan host] " & Text(p.reason)}});
{ind(after, 16)}
                {res(R, "ok", '"Sanggahan terkirim ke reviewer."')},
                {res(R, "error", '"Gagal mengirim sanggahan: " & FirstError.Message')}
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
 absen('varHdResult','colMyAbs', "ClearCollect(colMySch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date >= Today() - 7, Date <= Today() + 7));\nClearCollect(colMyRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate >= Today() - 30));"),
 NAV_REPORT, OPEN_SCH,
 '''"NAV",
    // "SCORE": tambahkan Navigate(layar skor) kalau app punya layar skor sendiri.
    Switch(Text(p.target), "REPORTS", Navigate(scrMyReports), "SCHEDULE", Navigate(scrMySchedule)),''',
]))

mr_reload = '''Set(varMrLoading, true);
With({from: If(IsBlank(varMrPeriod), Date(Year(Today()), Month(Today()), 1), DateValue(varMrPeriod & "-01"))},
    ClearCollect(colMrRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate >= from, LiveDate < DateAdd(from, 1, TimeUnit.Months)));
    ClearCollect(colMrSch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date >= from, Date < DateAdd(from, 1, TimeUnit.Months)))
);
Set(varMrLoading, false),'''
mr = shell('\n'.join([
 '"PERIOD_CHANGED",\n    Set(varMrPeriod, Text(p.period));\n'+ind(mr_reload,4),
 '"FILTER_CHANGED", Set(varMrFilter, Text(p.filter)),',
 NAV_REPORT,
]))

mrd_sch = """Set(varMrdSch, LookUp('Schedule - PBS Hub', ID = varMrdSch.ID));
ClearCollect(colMrdSesRep, Filter('Report - PBS Hub', HostID = varMe.Title, ScheduleID = varMrdSch.Title));"""
# Belum lengkap: ReportJson tetap kosong supaya form "Send Report berikutnya" tetap di layar.
mrd_after_submit = mrd_sch + """
If(Boolean(p.complete), Set(varRptId, row.ID); Set(varMrdRep, LookUp('Report - PBS Hub', ID = row.ID)));"""
mrd_after = "Set(varMrdRep, LookUp('Report - PBS Hub', ID = cur.ID));\n" + mrd_sch
mrd = shell('\n'.join([
 absen('varMrdResult','colMrdAbs', mrd_sch),
 submit('varMrdResult', mrd_after_submit),
 resubmit('varMrdResult', mrd_after),
 dispute('varMrdResult', mrd_after),
 '"OPEN_EVIDENCE", Launch(Text(p.url)),',
 '"BACK", Back(),',
]), upload=True)

MS_AFTER = '''With({from: If(IsBlank(varMsPeriod), Date(Year(Today()), Month(Today()), 1), DateValue(varMsPeriod & "-01"))},
    ClearCollect(colMsSch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date >= from, Date < DateAdd(from, 1, TimeUnit.Months)));
    ClearCollect(colMsRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate >= from, LiveDate < DateAdd(from, 1, TimeUnit.Months)))
);'''
ms_reload = '''Set(varMsLoading, true);
With({from: If(IsBlank(varMsPeriod), Date(Year(Today()), Month(Today()), 1), DateValue(varMsPeriod & "-01"))},
    With({to: DateAdd(from, 1, TimeUnit.Months)},
        ClearCollect(colMsSch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date >= from, Date < to));
        ClearCollect(colMsClk, Filter('Clock In - PBS Hub', HostID = varMe.Title, ClockInDate >= from, ClockInDate < to));
        ClearCollect(colMsAbs, Filter('Host Absence - PBS Hub', HostID = varMe.Title, LiveDate >= from, LiveDate < to));
        ClearCollect(colMsRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate >= from, LiveDate < to))
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
]))

sd_sch = "ClearCollect(colSdSch, Filter('Schedule - PBS Hub', HostID = varMe.Title, Date = varSchDate));"
sd_after = "ClearCollect(colSdRep, Filter('Report - PBS Hub', HostID = varMe.Title, LiveDate = varSchDate));"
sd_after_submit = sd_sch + chr(10) + sd_after
sd_after = sd_after_submit
sd = shell('\n'.join([
 absen('varSdResult','colSdAbs', sd_after_submit),
 submit('varSdResult', sd_after_submit),
 resubmit('varSdResult', sd_after),
 dispute('varSdResult', sd_after),
 '"CLOCK_IN", Navigate(scrClockIn),',
 NAV_REPORT,
 '"OPEN_EVIDENCE", Launch(Text(p.url)),',
 '"OPEN_SCHEDULE", Set(varSchId, Text(p.scheduleId)),   // sesi lain di hari yang sama: data sudah ada',
 '"BACK", Back(),',
]), upload=True)
