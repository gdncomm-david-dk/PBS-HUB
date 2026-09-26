"""Power Fx OnChange handlers for the host controls (hd, mr, mrd, ms, sd), shared by the docs generators."""

def res(R, status, msg):
    return f'Set({R}, JSON({{requestId: rid, status: "{status}", message: {msg}}}, JSONFormat.Compact))'

def ind(block, n):
    pad=' '*n
    return '\n'.join((pad+l if l.strip() else l) for l in block.strip('\n').split('\n'))

ZERO = """Penjualan: 0, Pesanan: 0, ProdukTerjual: 0, JumlahPembeli: 0, CTR: 0, CTOR: 0, PeakViewer: 0,
'Durasi(Min)': 0, AddToCart: 0, TotalViewer: 0, Comment: 0"""

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
                        )
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
                        // Nama file dari control: "REP-{{ID}}_Platform_AccountID.jpg" → {{ID}} diganti ID baris baru.
                        With({{up: 'PBSHost-Uploadreportscreenshot'.Run(Substitute(Text(p.file.name), "REP-{{ID}}", title), data)}},
                            Patch('Report - PBS Hub', row, {{Title: title, Attachment: up.url}})
                        );
                        // Total Durasi(Min) semua report sesi ini ≥ durasi jadwal → "Done", kalau belum tetap "Waiting Report".
                        Patch('Schedule - PBS Hub', s, {{Status: {{Value: Text(p.scheduleStatus)}}}});
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
                // Screenshot baru (opsional): nama file sama (Title_Platform_AccountID.jpg) → flow AI membaca ulang.
                If(!IsBlank(p.file) && !IsBlank(data),
                    With({{up: 'PBSHost-Uploadreportscreenshot'.Run(Text(p.file.name), data)}},
                        Patch('Report - PBS Hub', LookUp('Report - PBS Hub', ID = cur.ID), {{Attachment: up.url}}))
                );
                // Durasi bisa ikut direvisi: status jadwal dihitung ulang oleh control (Waiting Report / Done).
                If(!IsBlank(Text(p.scheduleStatus)),
                    Patch('Schedule - PBS Hub', LookUp('Schedule - PBS Hub', Title = cur.ScheduleID && HostID = varMe.Title), {{Status: {{Value: Text(p.scheduleStatus)}}}}));
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
