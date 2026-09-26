// Sample rows shaped exactly like the v1 SharePoint lists in DESIGN.md (Database Schema).
// Reference "now": Monday 14 September 2026 11:42 (same as the Ops Console design artboards).
// Names and IDs are dummy data from the design handoff.
(function () {
  const REF = "2026-09-14T11:42:00";
  const d = (day, time) => `2026-09-${String(day).padStart(2, "0")}${time ? "T" + time + ":00" : ""}`;

  const brands = [
    ["BRD-001", "Hanasui"], ["BRD-002", "Somethinc"], ["BRD-003", "Scarlett Whitening"], ["BRD-004", "Kahf"],
    ["BRD-005", "Y.O.U Beauty"], ["BRD-006", "Emina"], ["BRD-007", "SIDOMUNCUL"], ["BRD-008", "WINGS"],
  ].map(([Title, NamaBrand]) => ({ Title, NamaBrand, Status: { Value: "Active" } }));

  const hostNames = ["Dinda Maharani", "Rani Salsabila", "Bagus Nugroho", "Sari Puspita", "Vina Anggraini", "Putri Ayu", "Kevin Pratama", "Nadia Kusuma", "Fajar Ramadhan", "Laras Wening", "Tegar Saputra", "Mega Lestari"];
  const PACKAGES = ["Reguler", "Premium", "Part-time"];
  const SCORES = [104, 118, 92, 71, 96, 88, 55, 101, 84, 99, 112, 63];
  const hosts = hostNames.map((NamaHost, i) => ({
    Title: `HST-${String(i + 1).padStart(3, "0")}`,
    HostCode: `PBSH-${String(i + 1).padStart(3, "0")}`,
    NamaHost,
    Status: { Value: i === 11 ? "Inactive" : "Active" },
    Package: { Value: PACKAGES[i % 3] },
    Email: { DisplayName: NamaHost, Email: NamaHost.toLowerCase().replace(/[^a-z]+/g, ".") + "@example.com" },
    JoinDate: `202${i < 5 ? 5 : 6}-${String(((i * 5) % (i < 5 ? 12 : 8)) + 1).padStart(2, "0")}-${String(((i * 7) % 27) + 1).padStart(2, "0")}`,
    RegistrationDate: `202${i < 5 ? 5 : 6}-${String(((i * 5) % (i < 5 ? 12 : 8)) + 1).padStart(2, "0")}-${String(((i * 7) % 27) + 1).padStart(2, "0")}`,
    RegisteredBy: "Bayu Prasetyo",
    InitialScore: 100, CurrentScore: SCORES[i], MinimumScore: 0, MaximumScore: 200,
    HasRekening: !(i === 7 || i === 9),
    // Masking hints computed in canvas: never the raw KTP / NoRekening / Alamat / PhoneNumber.
    KtpLast4: String(1234 + i * 311).slice(-4), PhoneLast4: String(5678 + i * 97).slice(-4),
    NorekLast4: i === 7 || i === 9 ? "" : String(4821 + i * 137).slice(-4), Bank: i === 7 || i === 9 ? "" : ["BCA", "Mandiri", "BNI", "BRI"][i % 4],
    HasAlamat: i !== 9, HasNamaRekening: !(i === 7 || i === 9), HasPersonalEmail: i % 3 !== 2,
  }));
  hosts[11].DeactivatedDate = "2026-09-05";

  const studios = [
    ["STD-01", "CWG-03", 2], ["STD-02", "CWG-05", 1], ["STD-03", "BSD-02", 1], ["STD-04", "Studio Kemang A", 1], ["STD-05", "Studio Kemang B", 1],
  ].map(([Title, NamaStudio, KapasitasHost]) => ({ Title, NamaStudio, KapasitasHost, Status: { Value: "Active" } }));

  let sid = 3200;
  const sch = (day, start, end, brand, host, studio, status, platform) => ({
    ID: ++sid, Title: `SCD-${sid}`, Date: d(day), StartTime: start, EndTime: end, BrandID: brand, HostID: host, StudioID: studio,
    Status: { Value: status || "Planned" }, Platform: { Value: platform || "TikTok" }, JamLive: 2,
    AccountID: `ACC-${brand.slice(-3)}`, AccountName: brand === "BRD-008" ? "wingsofficialstore" : brand.toLowerCase().replace("brd-", "brand") + ".official",
    LiveBreak: { Value: "No" }, Position: { Value: "Host" },
  });
  const schedules = [
    // today
    sch(14, "10:00", "12:00", "BRD-001", "HST-001", "STD-02"),
    sch(14, "09:00", "11:00", "BRD-004", "HST-002", "STD-01"),
    sch(14, "16:00", "18:00", "BRD-002", "HST-001", "STD-02"),
    sch(14, "19:00", "21:00", "BRD-003", "HST-002", "STD-03", "Planned", "Shopee"),
    // this week: host double booked + studio over capacity
    sch(17, "14:00", "16:00", "BRD-002", "HST-001", "STD-02"),
    sch(17, "15:00", "17:00", "BRD-006", "HST-001", "STD-03"),
    sch(18, "10:00", "12:00", "BRD-001", "HST-003", "STD-01"),
    sch(18, "10:30", "12:30", "BRD-004", "HST-004", "STD-01"),
    sch(18, "11:00", "13:00", "BRD-008", "HST-005", "STD-01"),
    // past sessions (some without reports)
    sch(10, "10:00", "12:00", "BRD-001", "HST-003", "STD-01", "Finished"),
    sch(11, "13:00", "15:00", "BRD-005", "HST-004", "STD-04", "Finished", "Lazada"),
    sch(12, "19:00", "21:00", "BRD-008", "HST-002", "STD-01", "Finished"),
    sch(13, "10:00", "12:00", "BRD-002", "HST-001", "STD-02", "Finished"),
    sch(13, "13:00", "15:00", "BRD-006", "HST-005", "STD-05", "Finished", "Shopee"),
    sch(14, "07:00", "09:00", "BRD-007", "HST-001", "STD-02", "Finished"),
    sch(14, "07:00", "09:00", "BRD-003", "HST-002", "STD-04", "Finished", "Shopee"),
    sch(9, "10:00", "12:00", "BRD-004", "HST-006", "STD-04", "Finished"),
    sch(10, "15:00", "17:00", "BRD-002", "HST-007", "STD-05", "Finished"),
    sch(11, "15:00", "17:00", "BRD-001", "HST-008", "STD-03", "Finished"),
    sch(12, "09:00", "11:00", "BRD-006", "HST-009", "STD-04", "Finished", "Shopee"),
    sch(12, "13:00", "15:00", "BRD-003", "HST-010", "STD-05", "Cancelled", "Shopee"),
    // past sessions with no report at all -> "Report belum masuk"
    sch(10, "19:00", "21:00", "BRD-005", "HST-006", "STD-04", "Finished"),
    sch(11, "19:00", "21:00", "BRD-007", "HST-007", "STD-05", "Finished"),
    sch(12, "16:00", "18:00", "BRD-004", "HST-008", "STD-03", "Waiting Report"),
    // corrected after Need Revision -> Waiting Approval Revision
    sch(11, "10:00", "12:00", "BRD-007", "HST-003", "STD-02", "Finished"),
    // report with a blank ApprovalStatus -> not in the waiting queue
    sch(9, "13:00", "15:00", "BRD-005", "HST-003", "STD-03", "Finished"),
    // no report owed although the flow left "Waiting Report": live break, and Co-Host with LiveBreak No
    Object.assign(sch(14, "05:00", "07:00", "BRD-002", "HST-011", "STD-02", "Waiting Report"), { LiveBreak: { Value: "Yes" } }),
    Object.assign(sch(13, "19:00", "21:00", "BRD-001", "HST-011", "STD-01", "Waiting Report"), { Position: { Value: "Co-Host" } }),
  ];

  const M = (Penjualan, Pesanan, ProdukTerjual, JumlahPembeli, CTR, CTOR, PeakViewer, extra) =>
    Object.assign({ Penjualan, Pesanan, ProdukTerjual, JumlahPembeli, CTR, CTOR, PeakViewer, "Durasi(Min)": 120, AddToCart: 610, TotalViewer: 18400, Comment: 930, Share: 112 }, extra || {});

  const byTitle = Object.fromEntries(schedules.map((s) => [s.Title, s]));
  let rid = 20859;
  const reports = [];
  const evidence = [];
  const PLAYBOOKS = ["Flash Sale", "", "Payday", "Launching Produk"]; // Report.Playbook is a Choice column
  const rep = (scd, status, metrics, created, extra) => {
    const s = byTitle[scd];
    const id = ++rid;
    const r = Object.assign({
      ID: id, Title: `REP-${id}`, ScheduleID: scd, HostID: s.HostID, BrandID: s.BrandID, AccountID: `ACC-${s.BrandID.slice(-3)}`,
      Account: s.BrandID === "BRD-008" ? "wingsofficialstore" : s.BrandID.toLowerCase().replace("brd-", "brand") + ".official",
      Platform: s.Platform, LiveDate: s.Date, ApprovalStatus: { Value: status }, Match: { Value: "" }, Created: created, Modified: created,
      Attachment: "", Playbook: PLAYBOOKS[id % PLAYBOOKS.length] ? { Value: PLAYBOOKS[id % PLAYBOOKS.length] } : null,
    }, metrics, extra || {});
    reports.push(r);
    return r;
  };
  const evi = (r, metrics, created, extra) => {
    evidence.push(Object.assign({ ID: 900 + evidence.length, Title: r.Title, HostID: r.HostID, ScheduleID: r.ScheduleID, AccountID: r.AccountID, Platform: r.Platform, Status: { Value: "Unmatch" }, Created: created, Attachment: `https://gdncomm.sharepoint.com/sites/StudioTeamBlibli/PBS%20Power%20Apps/Report%20Automation/${r.Title}_${r.Platform.Value}_${r.Account}.png` }, metrics, extra || {}));
  };

  // Waiting — one per reason, matching artboard 4a.
  const z = M(0, 0, 0, 0, 0, 0, 0);
  let r = rep("SCD-3210", "Waiting Approval", z, d(10, "13:10")); evi(r, z, d(10, "13:20"));
  r = rep("SCD-3211", "Waiting Approval", M(5120000, 168, 201, 150, 3.9, 8.2, 1400), d(11, "16:05")); evi(r, M(5100000, 167, 200, 150, 3.9, 8.2, 1390), d(11, "16:20"), { HostID: "HST-009" });
  r = rep("SCD-3212", "Waiting Approval", M(12400000, 340, 512, 288, 4.8, 11.4, 3120), d(12, "21:02")); evi(r, M(10980000, 331, 498, 284, 4.62, 9.85, 3080), d(12, "21:04"), { Confidence: 0.91 });
  r = rep("SCD-3213", "Waiting Approval", M(8450000, 212, 260, 190, 5.1, 10.2, 2210), d(13, "12:30")); evi(r, M(8450000, 212, 259, 190, 5.1, 10.2, 2200), d(13, "12:40"), { Confidence: 0.62 });
  r = rep("SCD-3214", "Waiting Approval", M(3900000, 98, 120, 90, 2.8, 7.4, 870), d(13, "15:20")); evi(r, M(3890000, 98, 120, 90, 2.8, 7.4, 870), d(13, "15:25"), { Confidence: 0.71 });
  r = rep("SCD-3215", "Waiting Approval", M(5120000, 168, 201, 150, 3.9, 8.2, 1400), d(14, "09:10"));
  r = rep("SCD-3216", "Waiting Approval", M(2750000, 70, 85, 66, 2.1, 6.3, 640), d(14, "09:40")); evi(r, M(2750000, 70, 85, null, 2.1, 6.3, 640), d(14, "09:45"));

  // Decided today by the flow.
  const autos = ["SCD-3217", "SCD-3218", "SCD-3219"];
  autos.forEach((scd, i) => {
    const rr = rep(scd, "Done", M(4000000 + i * 1e6, 100, 120, 90, 3, 7, 900), d(14, "08:0" + i), { ApprovalComment: "Automated Match by AI", ApproverEmail: "studio.blibli@example.com", Match: { Value: "Match" }, Modified: d(14, "08:1" + i) });
    evi(rr, M(4000000 + i * 1e6, 100, 120, 90, 3, 7, 900), d(14, "08:0" + i), { Status: { Value: "Match" } });
  });
  // Need revision + manual decisions.
  rep("SCD-3220", "Need Revision", M(6100000, 150, 170, 130, 4, 9, 1500), d(12, "11:00"), { Approver: { DisplayName: "Bayu Prasetyo", Email: "bayu@example.com" }, ApproverEmail: "bayu@example.com", ApprovalComment: "Penjualan tidak sesuai screenshot", Modified: "2026-09-14T11:37:00" });
  r = rep("SCD-3225", "Waiting Approval Revision", M(4480000, 120, 150, 104, 3.4, 8.1, 1250), d(14, "10:30"), { Approver: { DisplayName: "Bayu Prasetyo", Email: "bayu@example.com" }, ApproverEmail: "bayu@example.com", ApprovalComment: "Pesanan tidak sesuai screenshot\n[Revisi host] Sudah dicek ulang dari dashboard seller.", Match: { Value: "Unmatch" } });
  evi(r, M(4480000, 118, 150, 104, 3.4, 8.1, 1250), d(11, "12:20"));
  rep("SCD-3226", "", M(3300000, 90, 110, 80, 2.9, 7.2, 900), d(9, "15:30"));

  const clockIns = [];
  let cid = 1;
  hosts.slice(0, 10).forEach((h, i) => {
    for (let day = 1; day <= 13; day++) {
      if ((day + i) % 7 === 0) continue;
      const inside = !(i === 3 && day === 11) && !(i === 5 && day === 12);
      clockIns.push({ ID: cid++, HostID: h.Title, EmployeeName: h.NamaHost, ClockInDate: d(day), CheckInTime: d(day, "08:0" + (i % 10)), CheckOutTime: d(day, "17:1" + (i % 10)), IsInsideGeofence: inside, HKTugas: 180000, Streak: day === 13 && i < 8 ? 75000 : 0 });
    }
  });
  clockIns.push({ ID: cid++, HostID: "HST-001", ClockInDate: d(14), CheckInTime: d(14, "06:55"), IsInsideGeofence: false });
  clockIns.push({ ID: cid++, HostID: "HST-007", ClockInDate: d(13), CheckInTime: d(13, "08:10"), IsInsideGeofence: true });
  // Tenant rows that only fill ClockInTime / ClockOutTime (Date and Time), no CheckInTime.
  clockIns.push({ ID: cid++, HostID: "HST-011", ClockInDate: d(7), ClockInTime: new Date(2026, 8, 7, 8, 5).toISOString(), ClockOutTime: new Date(2026, 8, 7, 17, 20).toISOString(), IsInsideGeofence: true, HKTugas: 180000 });

  // ---- payroll (Payroll - PBS Hub, Payroll Data) -------------------------------------------------
  // Periode is the RUN month (P8): "Sep 2026" holds August attendance.
  const a = (day, time) => `2026-08-${String(day).padStart(2, "0")}${time ? "T" + time + ":00" : ""}`;
  const clockInsAug = [];
  const TIER_RATE = { 1: 75000, 2: 65000, 3: 55000 };
  hosts.forEach((h, i) => {
    if (i === 7 || i === 9) return; // no August attendance (and no bank details)
    const days = i === 11 ? [3, 4, 5] : Array.from({ length: 31 }, (_, k) => k + 1).filter((day) => new Date(2026, 7, day).getDay() !== 0 && (day + i) % 6 !== 0);
    days.forEach((day) => {
      const tier = (i % 3) + 1;
      const openShift = i === 3 && day === 20;
      clockInsAug.push({
        ID: cid++, HostID: h.Title, EmployeeName: h.NamaHost, ClockInDate: a(day), CheckInTime: a(day, "08:0" + (i % 10)), CheckOutTime: openShift ? "" : a(day, "17:1" + (i % 10)),
        IsInsideGeofence: !(i === 5 && day === 12), HKTugas: 180000, Tier: day % 3 === 0 ? `Tier ${tier}` : "", Insentif: day % 3 === 0 ? TIER_RATE[tier] : 0, Streak: new Date(2026, 7, day).getDay() === 6 && i < 6 ? 75000 : 0,
      });
    });
  });
  const clockInsAugBlocked = clockInsAug.concat([3, 4, 5].map((day) => ({ ID: cid++, HostID: "HST-008", ClockInDate: a(day), CheckInTime: a(day, "08:00"), CheckOutTime: a(day, "17:00"), IsInsideGeofence: true, HKTugas: 180000, Tier: "Tier 1", Insentif: 0, Streak: 0 })));

  const BANKS = ["BCA", "Mandiri", "BNI", "BRI"];
  const linesFor = (payrollId, periodeLiteral, rows, extra) =>
    hosts.filter((h) => h.Status.Value === "Active").map((h, i) => {
      const mine = rows.filter((c) => c.HostID === h.Title);
      const sum = (f) => mine.reduce((t, c) => t + (c[f] || 0), 0);
      const tierSum = (t) => mine.filter((c) => c.Tier === `Tier ${t}`).reduce((x, c) => x + (c.Insentif || 0), 0);
      let total = sum("HKTugas") + sum("Insentif") + sum("Streak");
      if (extra && extra.bump === h.Title) total += 180000; // counted one day twice
      return {
        ID: 5000 + Number(payrollId.slice(4)) * 20 + i, Title: `${payrollId}-${h.Title}`, payroll_id: payrollId, HostID: h.Title, Employee_Name: h.NamaHost,
        Employee_Email: h.NamaHost.toLowerCase().replace(/[^a-z]+/g, ".") + "@example.com", Periode: periodeLiteral,
        JumlahHari: mine.length, UangKehadiran: sum("HKTugas"), Mingguan: sum("Streak"), Tier1: tierSum(1), Tier2: tierSum(2), Tier3: tierSum(3),
        PPh21: 0, TotalGaji: total, NetTHP: total, Bank: h.HasRekening ? BANKS[i % 4] : "", NorekLast4: h.HasRekening ? String(4821 + i * 137).slice(-4) : "",
      };
    });
  // Earlier months: synthetic rows (no Clock In sent for them).
  const synth = (month, seed) => hosts.slice(0, 11).flatMap((h, i) => Array.from({ length: 18 + ((i + seed) % 6) }, (_, k) => ({ HostID: h.Title, HKTugas: 180000, Tier: `Tier ${(i % 3) + 1}`, Insentif: k % 3 === 0 ? TIER_RATE[(i % 3) + 1] : 0, Streak: k % 6 === 0 && i < 6 ? 75000 : 0 }))).filter((c) => !(month === 6 && (c.HostID === "HST-008" || c.HostID === "HST-010")));
  const run = (ID, Periode, Status, Created, extra) => Object.assign({ ID, Title: `PAY-${ID}`, PayrollName: `Pembayaran Mitra - Host (${Periode})`, Periode, Status: { Value: Status }, Trigger: { Value: "Automated" }, Created, Modified: Created }, extra || {});
  const payrollRuns = {
    open: run(118, "Sep 2026", "Approved by PBS", "2026-09-01T12:05:00", { HCApproval: "Approved by Asih Wulandari", PBSApproval: "Approved by George Hartono", PBSComment: "Oke, sesuai rekap kehadiran.", Modified: "2026-09-03T09:12:00" }),
    done: run(118, "Sep 2026", "Done", "2026-09-01T12:05:00", { HCApproval: "Approved by Asih Wulandari", PBSApproval: "Approved by George Hartono", FASApproval: "Approved by Aliya Rahma", Modified: "2026-09-04T15:40:00" }),
    assembling: run(119, "Sep 2026", "Waiting PBS Approval", "2026-09-14T11:31:00"),
  };
  const payrollHistory = [
    run(117, "Aug 2026", "Done", "2026-08-01T12:04:00", { HCApproval: "Approved by Asih Wulandari", PBSApproval: "Approved by George Hartono", FASApproval: "Approved by Aliya Rahma", Modified: "2026-08-05T10:02:00" }),
    run(116, "Jul 2026", "Done", "2026-07-03T09:30:00", { PayrollName: "[Manual Trigger] Pembayaran Mitra - Host (Jul 2026)", Trigger: { Value: "Automated" }, HCApproval: "Approved by Asih Wulandari", PBSApproval: "Approved by George Hartono", FASApproval: "Approved by Aliya Rahma", Modified: "2026-07-06T16:20:00" }),
    run(115, "Jul 2026", "Rejected by FAS", "2026-07-01T12:03:00", { HCApproval: "Approved by Asih Wulandari", FASApproval: "Rejected by Aliya Rahma", FASComment: "Tier 2 bulan Juni belum sesuai rate card, mohon hitung ulang.", Modified: "2026-07-02T14:05:00" }),
    run(114, "Jun 2026", "Done", "2026-06-01T12:02:00", { HCApproval: "Approved by Asih Wulandari", PBSApproval: "Approved by George Hartono", FASApproval: "Approved by Aliya Rahma", Modified: "2026-06-04T11:00:00" }),
  ];
  const payrollLines = {
    118: linesFor("PAY-118", "August-2026", clockInsAug, { bump: "HST-005" }),
    117: linesFor("PAY-117", "August-2026", synth(6, 1)),
    115: linesFor("PAY-115", "August-2026", synth(5, 2)),
    114: linesFor("PAY-114", "August-2026", synth(4, 3)),
  };
  // Optional payslip log (v1 has none) — used with ?slips=1.
  const payslips = payrollLines[117].map((l, i) => ({
    payroll_id: "PAY-117", LineID: l.Title, Employee_Email: l.Employee_Email,
    Status: i === 7 ? "Gagal" : i === 9 ? "Bounce" : "Terkirim", SentAt: `2026-08-05T10:${String(10 + i).padStart(2, "0")}:00`,
    Error: i === 7 ? "Alamat email host kosong" : i === 9 ? "Mailbox tidak ditemukan (550)" : "",
  }));
  const payrolls = [payrollRuns.open, payrollHistory[0]];

  const context = {
    userEmail: "annisa@example.com", userName: "Annisa Hanifah", roles: "PBS_Team", permissions: "",
    config: { tolerancePct: 5, confidenceThreshold: 0.85, maxShiftHours: 12, missingReportDays: 2, tierRates: { tier1: 75000, tier2: 65000, tier3: 55000 }, weeklyBonus: 75000 },
  };

  // ---- host detail & credit score ([FAS STUDIO] HostScoreThreshold / HostScoreTransactions) ------
  const thresholds = [
    { ThresholdID: "BAND-1", Label: "Kritis", Description: "Di bawah batas minimum: dievaluasi bersama PIC studio.", MinimumScore: 0, MaximumScore: 59, Tone: { Value: "Danger" }, Active: true, SortOrder: 1 },
    { ThresholdID: "BAND-2", Label: "Perlu perhatian", Description: "Beberapa penalty terakhir menurunkan skor.", MinimumScore: 60, MaximumScore: 84, Tone: { Value: "Warning" }, Active: true, SortOrder: 2 },
    { ThresholdID: "BAND-3", Label: "Baik", Description: "Performa sesuai standar studio.", MinimumScore: 85, MaximumScore: 114, Tone: { Value: "Info" }, Active: true, SortOrder: 3 },
    { ThresholdID: "BAND-4", Label: "Sangat baik", Description: "Konsisten tepat waktu dan target GMV tercapai.", MinimumScore: 115, MaximumScore: 200, Tone: { Value: "Success" }, Active: true, SortOrder: 4 },
  ];
  const RULES = [
    ["RULE-01", "Live tepat waktu", "Reward", 2], ["RULE-02", "Report terlambat lebih dari 2 hari", "Penalty", -5], ["RULE-03", "Target GMV tercapai", "Reward", 5],
    ["RULE-04", "Tidak hadir tanpa kabar", "Penalty", -10], ["RULE-05", "Feedback brand positif", "Reward", 3],
  ];
  // [rule index, day in Aug/Sep, voided]
  const txPlan = {
    "HST-001": [[0, "08-04"], [2, "08-09"], [1, "08-15"], [4, "08-21"], [0, "08-28"], [2, "09-02", true], [0, "09-05"], [4, "09-11"]],
    "HST-003": [[1, "08-06"], [3, "08-19"], [2, "09-01"], [0, "09-08", true]],
    "HST-012": [[3, "08-12"], [3, "08-26"], [1, "09-03"]],
  };
  const scoreTx = {};
  Object.entries(txPlan).forEach(([hostId, plan]) => {
    let score = 100; let n = 0;
    scoreTx[hostId] = plan.map(([ri, md, voided]) => {
      const [RuleID, Reason, TransactionType, Point] = RULES[ri];
      const before = score; score = Math.max(0, Math.min(200, score + Point)); n++;
      const row = { ID: 7000 + Object.keys(scoreTx).length * 20 + n, TransactionID: `TX-2026${md.replace("-", "")}-10${String(n).padStart(2, "0")}00`, HostID: hostId, RuleID, TransactionType: { Value: TransactionType }, Point,
        ScoreBefore: before, ScoreAfter: score, Reason, Notes: voided ? "Salah host, dibatalkan" : Point < 0 ? "Dicatat dari laporan PIC studio" : "", Status: { Value: voided ? "Void" : "Active" },
        CreatedDate: `2026-${md}T10:${String(n * 3).padStart(2, "0")}:00`, CreatedBy: { DisplayName: "Bayu Prasetyo", Email: "bayu@example.com" } };
      if (voided) score = before; // the void is recorded on the row; CurrentScore is not recomputed in v1
      return row;
    });
  });
  // HST-001 stored score matches its ledger; HST-003 still carries the voided +2 (drift).
  const sumActive = (id) => scoreTx[id].filter((t) => t.Status.Value === "Active").reduce((s, t) => s + t.Point, 100);
  hosts[0].CurrentScore = sumActive("HST-001");
  hosts[2].CurrentScore = sumActive("HST-003") + 2;
  hosts[2].LedgerScore = sumActive("HST-003");
  hosts[11].CurrentScore = sumActive("HST-012");
  // HST-012: deactivated on 5 Sep, still clocked in afterwards and still on a future session.
  const hostExtraClockIns = [8, 9].map((day) => ({ ID: 9900 + day, HostID: "HST-012", ClockInDate: d(day), CheckInTime: d(day, "08:04"), CheckOutTime: d(day, "17:02"), IsInsideGeofence: true, HKTugas: 180000, Insentif: 0, Streak: 0 }));
  const hostExtraSchedules = [
    { ID: 3290, Title: "SCD-3290", Date: d(18), StartTime: "19:00", EndTime: "21:00", BrandID: "BRD-006", HostID: "HST-012", StudioID: "STD-04", Status: { Value: "Planned" }, Platform: { Value: "Shopee" } },
    { ID: 3291, Title: "SCD-3291", Date: d(4), StartTime: "10:00", EndTime: "12:00", BrandID: "BRD-002", HostID: "HST-012", StudioID: "STD-05", Status: { Value: "Finished" }, Platform: { Value: "TikTok" } },
  ];
  // What canvas hands back after it logged a REVEAL_PII (dummy values).
  const piiValues = (h, i) => ({
    KTP: `317405${String(120390 + i).padStart(6, "0")}${h.KtpLast4}`, NoRekening: `${h.Bank} 0${String(88123 + i * 71)}${h.NorekLast4}`, NamaRekening: h.NamaHost.toUpperCase(),
    Alamat: `Jl. Kemang Raya No. ${10 + i}, Jakarta Selatan`, PhoneNumber: `+62 812 ${String(3000 + i * 13).slice(-4)} ${h.PhoneLast4}`, PersonalEmail: h.NamaHost.split(" ")[0].toLowerCase() + ".personal@example.com",
  });


  // ---- host app (pbs_Host.*): Dinda Maharani (HST-001) sees only her own rows -------------------
  // Today (14 Sep): 07:00 session reported, 10:00 session live now (no absen yet), 16:00 upcoming.
  // Past: a revision with flagged metrics, one unsent (on time), one unsent (late), one without clock-in.
  const hs = (id, day, start, end, brand, studio, status, platform) => ({
    ID: id, Title: `SCD-${id}`, Date: d(day), StartTime: start, EndTime: end, BrandID: brand, HostID: "HST-001", StudioID: studio,
    Status: { Value: status || "Finished" }, Platform: { Value: platform || "TikTok" }, AccountID: `ACC-${brand.slice(-3)}`, JamLive: 2,
  });
  const hostSchedules = [
    hs(3301, 11, "13:00", "15:00", "BRD-003", "STD-03", "Finished", "Shopee"),
    hs(3302, 12, "19:00", "21:00", "BRD-005", "STD-04", "Waiting Report"),
    hs(3303, 9, "10:00", "12:00", "BRD-008", "STD-01", "Waiting Report"),
    hs(3304, 7, "13:00", "15:00", "BRD-002", "STD-02", "Waiting Report"),
    hs(3305, 8, "10:00", "12:00", "BRD-001", "STD-02"),
    hs(3306, 5, "15:00", "17:00", "BRD-006", "STD-05", "Finished", "Shopee"),
    hs(3307, 3, "10:00", "12:00", "BRD-004", "STD-01", "Cancelled"),
    // Ahead: My schedule shows the rest of the month (Co Host on one of them).
    hs(3308, 16, "08:00", "13:00", "BRD-008", "STD-01", "Planned"),
    hs(3309, 21, "08:00", "13:00", "BRD-008", "STD-01", "Planned"),
    hs(3310, 24, "19:00", "21:00", "BRD-003", "STD-03", "Planned", "Shopee"),
    // Reported: one live that broke off, one corrected after a revision (waiting for the second review).
    hs(3311, 6, "19:00", "21:00", "BRD-004", "STD-04"),
    hs(3312, 10, "13:00", "15:00", "BRD-002", "STD-02"),
    // Split live: 4 hours on Shopee, the live dropped after 2 hours — one report of 120 minutes is in, 120 still owed.
    hs(3313, 13, "19:00", "23:00", "BRD-006", "STD-05", "Waiting Report", "Shopee"),
    // Absen done but the flow has not moved the schedule to Waiting Report yet.
    hs(3314, 13, "10:00", "12:00", "BRD-001", "STD-02", "Planned"),
  ].map((x) => Object.assign(x, { Position: x.Title === "SCD-3309" ? "Co Host" : "Main Host" }));
  const abs = (n, scd, day, time) => ({ ID: 8800 + n, Title: `ABS-${8800 + n}`, HostID: "HST-001", ScheduleID: scd, AbsenceDate: d(day), CheckInTime: d(day, time), Created: d(day, time) });
  const hostAbsences = [abs(8, "SCD-3311", 6, "18:40"), abs(9, "SCD-3312", 10, "12:40"), abs(1, "SCD-3215", 14, "06:40"), abs(2, "SCD-3213", 13, "09:40"), abs(3, "SCD-3301", 11, "12:45"), abs(4, "SCD-3302", 12, "18:40"), abs(5, "SCD-3303", 9, "09:40"), abs(6, "SCD-3305", 8, "09:35"), abs(7, "SCD-3306", 5, "14:40"), abs(10, "SCD-3313", 13, "18:40"), abs(11, "SCD-3314", 13, "09:40")];
  const hr = (id, scd, day, status, metrics, created, extra) => Object.assign({
    ID: id, Title: `REP-${id}`, ScheduleID: scd, HostID: "HST-001", BrandID: hostSchedules.find((x) => x.Title === scd).BrandID,
    AccountID: `ACC-${hostSchedules.find((x) => x.Title === scd).BrandID.slice(-3)}`, Platform: hostSchedules.find((x) => x.Title === scd).Platform, LiveDate: d(day),
    ApprovalStatus: { Value: status }, Match: { Value: "" }, Created: created, Modified: created, Attachment: "", Playbook: PLAYBOOKS[id % PLAYBOOKS.length] ? { Value: PLAYBOOKS[id % PLAYBOOKS.length] } : null,
  }, metrics, extra || {});
  const hostReports = [
    hr(20901, "SCD-3301", 11, "Need Revision", M(7350000, 188, 240, 171, 4.4, 12.8, 1980), d(11, "15:30"), {
      Approver: { DisplayName: "Bayu Prasetyo", Email: "bayu@example.com" }, ApproverEmail: "bayu@example.com", Modified: d(12, "10:05"),
      ApprovalComment: "Angka penjualan dan CTOR beda dengan screenshot. Tolong cek lagi di seller center.\nMetrik yang perlu dibetulkan: Penjualan, CTOR",
    }),
    hr(20902, "SCD-3305", 8, "Done", M(5200000, 140, 162, 120, 3.8, 9.1, 1320), d(8, "12:40"), { ApprovalComment: "Oke, sesuai.", ApproverEmail: "bayu@example.com", Approver: { DisplayName: "Bayu Prasetyo" }, Match: { Value: "Unmatch" }, Modified: d(9, "09:00") }),
    hr(20904, "SCD-3311", 6, "LiveBreak", M(900000, 20, 24, 18, 1.2, 3.1, 240), d(6, "21:30"), { ApprovalComment: "Live terputus 19:40, koneksi studio.", ApproverEmail: "bayu@example.com", Approver: { DisplayName: "Bayu Prasetyo" }, Modified: d(7, "09:00") }),
    hr(20905, "SCD-3312", 10, "Waiting Approval Revision", M(3900000, 96, 120, 88, 3.1, 8.4, 1100), d(10, "15:40"), { ApprovalComment: "Pesanan beda dengan screenshot.\nMetrik yang perlu dibetulkan: Pesanan\n[Revisi host] angka diperbaiki: Pesanan", Match: { Value: "Unmatch" }, Modified: d(11, "08:10") }),
    hr(20906, "SCD-3313", 13, "Waiting Approval", M(6100000, 150, 188, 140, 3.6, 8.8, 1510), d(13, "21:40"), { LiveID: "7412093385", Modified: d(13, "21:40") }),
    hr(20903, "SCD-3306", 5, "Done", M(3100000, 81, 95, 70, 2.9, 7.2, 820), d(5, "17:20"), { ApprovalComment: "Automated Match by AI", Match: { Value: "Match" }, Modified: d(5, "17:30") }),
  ];
  const hostEvidence = [
    { ID: 990, Title: "REP-20901", HostID: "HST-001", ScheduleID: "SCD-3301", Platform: { Value: "Shopee" }, Status: { Value: "Unmatch" }, Created: d(11, "15:34"), Confidence: 0.93,
      Attachment: "https://gdncomm.sharepoint.com/sites/StudioTeamBlibli/PBS%20Power%20Apps/Report%20Automation/REP-20901_Shopee_ACC-003.jpg", ...M(6980000, 188, 240, 171, 4.4, 11.6, 1980) },
    { ID: 991, Title: "REP-20902", HostID: "HST-001", ScheduleID: "SCD-3305", Platform: { Value: "TikTok" }, Status: { Value: "Unmatch" }, Created: d(8, "12:44"), ...M(5200000, 140, 162, 120, 3.8, 9.3, 1320) },
  ];
  const hostApp = { hostId: "HST-001", schedules: hostSchedules, absences: hostAbsences, reports: hostReports, evidence: hostEvidence };
  const studioLocations = [
    { Title: "Studio CWG Jakarta", LocationID: "LOC-01", Latitude: -6.2244, Longitude: 106.8031, RadiusMeter: 150, IsActive: true },
    { Title: "Studio BSD", LocationID: "LOC-02", Latitude: -6.3015, Longitude: 106.6527, RadiusMeter: 100, IsActive: true },
    { Title: "Studio Kemang (tutup)", LocationID: "LOC-03", Latitude: -6.2607, Longitude: 106.8132, RadiusMeter: 100, IsActive: false },
  ];
  window.PBS_SAMPLE = { REF, hostApp, studioLocations, thresholds, scoreTx, hostExtraClockIns, hostExtraSchedules, piiValues, brands, hosts, studios, schedules, reports, evidence, clockIns, payrolls, context, clockInsAug, clockInsAugBlocked, payrollRuns, payrollHistory, payrollLines, payslips };
})();
