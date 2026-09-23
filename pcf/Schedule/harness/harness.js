/* Local preview harness for pbs_Ops.Schedule.
 * Loads the real bundle.js, feeds it mock datasets shaped like the SharePoint lists in DESIGN.md
 * (fictional sample data), and plays the canvas role: applies ActionPayload to the mock data and
 * answers via ActionResult. Open harness/index.html after `npm run build`. Not shipped in the solution.
 */
(function () {
    "use strict";

    var captured = null;
    window.ComponentFramework = {
        registerControl: function (name, ctor) {
            captured = ctor;
        },
    };

    var params = new URLSearchParams(location.search);
    var pad = function (n) { return n < 10 ? "0" + n : String(n); };
    var dkey = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
    var hm = function (min) { return pad(Math.floor(min / 60) % 24) + ":" + pad(min % 60); };
    var now = new Date();
    var todayKey = dkey(now);
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var addDays = function (n) { var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n); return dkey(d); };

    // ------------------------------------------------------------------ master data (fictional)
    var brands = [
        ["BR-01", "Contoh Aruna"], ["BR-02", "Contoh Kirana"], ["BR-03", "Contoh Lestari"], ["BR-04", "Contoh Nirmala"], ["BR-05", "Contoh Sekar"], ["BR-06", "Contoh Tirta", "Inactive"],
    ].map(function (b, i) { return { ID: 10 + i, Title: b[0], NamaBrand: b[1], Status: { Value: b[2] || "Active" } }; });
    // Three seller accounts per brand, so parallel sessions of one brand use different accounts.
    var accounts = [];
    brands.forEach(function (b, bi) {
        ["official", "store", "id"].forEach(function (suffix, i) {
            accounts.push({ ID: 30 + bi * 3 + i, Title: "ACC-" + pad(bi * 3 + i + 1), AccountName: b.NamaBrand.replace("Contoh ", "").toLowerCase() + "." + suffix, BrandID: b.Title, Platform: { Value: i === 1 ? "Shopee" : "TikTok" } });
        });
    });
    var accSeq = 0;
    var accOf = function (brand, pick) {
        var own = accounts.filter(function (a) { return a.BrandID === brand; });
        return own[(pick === undefined ? accSeq++ : pick) % own.length].Title;
    };
    var studios = [
        ["CWG-05", "Studio Kemang B", 2], ["CWG-03", "Studio Kemang A", 2], ["BSD-02", "Studio BSD", 3], ["CWG-07", "Studio Tebet", 1], ["CWG-06", "Studio Pondok Indah", 2], ["CWG-01", "Studio Lama", 1, "Inactive"],
    ].map(function (s, i) { return { ID: 50 + i, Title: s[0], NamaStudio: s[1], KapasitasHost: s[2], Status: { Value: s[3] || "Active" } }; });
    var hosts = [
        ["HST-001", "Dinda Maharani"], ["HST-002", "Rani Salsabila"], ["HST-003", "Vina Anggraini"], ["HST-004", "Sari Puspita"],
        ["HST-005", "Bella Oktaviani"], ["HST-006", "Nadia Putri"], ["HST-007", "Ayu Lestari"], ["HST-008", "Citra Dewi"],
    ].map(function (h, i) { return { ID: 200 + i, Title: h[0], NamaHost: h[1], Status: { Value: "Active" } }; });
    var platOf = {}; accounts.forEach(function (a) { platOf[a.Title] = a.Platform.Value; });

    // ------------------------------------------------------------------ schedules
    var schedules = [];
    var nextId = 400;
    function add(date, studio, brand, host, start, end, status, extra) {
        var id = nextId++;
        var acc = extra && extra.Account ? extra.Account : accOf(brand, extra && extra.pick);
        if (extra) delete extra.pick;
        var row = {
            ID: id, Title: "SCD-" + id, Date: date, StudioID: studio, BrandID: brand, HostID: host, Account: acc, Platform: { Value: platOf[acc] },
            StartTime: hm(start), EndTime: hm(end), JamLive: (end - start) / 60, Status: { Value: status || "Planned" },
            Shift: start < 720 ? "Pagi" : start < 1080 ? "Siang" : "Malam", Sesi: "1", CampaignName: "", LiveBreak: { Value: "No" }, Position: { Value: "Main" },
        };
        if (extra) Object.keys(extra).forEach(function (k) { row[k] = extra[k]; });
        schedules.push(row);
        return row;
    }
    var clamp = function (m) { return Math.max(8 * 60, Math.min(22 * 60, m)); };
    var st = ["CWG-05", "CWG-03", "BSD-02", "CWG-07", "CWG-06"];
    var br = ["BR-01", "BR-02", "BR-03", "BR-04", "BR-05"];
    for (var d = -9; d <= 12; d++) {
        if (d === 0) continue;
        var date = addDays(d);
        for (var s = 0; s < st.length; s++) {
            var n = (d + 20 + s) % 3 === 0 ? 1 : 2;
            for (var k = 0; k < n; k++) {
                var start = 8 * 60 + ((s * 2 + k * 5 + d + 30) % 4) * 120;
                var h = "HST-00" + (1 + ((s * 3 + k * 2 + d + 40) % 8));
                var status = d < 0 ? ((s + k + d) % 7 === 0 ? "Waiting Report" : "Done") : "Planned";
                if ((s + k + d + 30) % 17 === 0) status = "Cancelled";
                add(date, st[s], br[(s + k + d + 30) % 5], h, start, start + 180, status);
            }
        }
    }
    // Today, relative to the current time.
    var live1 = add(todayKey, "CWG-05", "BR-01", "HST-001", clamp(nowMin - 100), clamp(nowMin + 40), "Planned", { pick: 0 });
    add(todayKey, "CWG-03", "BR-02", "HST-002", clamp(nowMin - 60), clamp(nowMin + 120));
    add(todayKey, "BSD-02", "BR-03", "HST-004", clamp(nowMin - 80), clamp(nowMin + 70));
    add(todayKey, "BSD-02", "BR-03", "HST-001", clamp(nowMin + 10), clamp(nowMin + 130)); // Dinda double-booked with live1
    add(todayKey, "CWG-06", "BR-05", "HST-006", 480, clamp(nowMin - 60), "Waiting Report");
    add(todayKey, "CWG-07", "BR-04", "HST-008", 480, 600, "Done");
    add(todayKey, "CWG-07", "BR-04", "HST-003", 540, 660, "Planned"); // CWG-07 holds 1 host: over capacity
    add(todayKey, "CWG-06", "BR-01", "HST-007", clamp(nowMin + 90), clamp(nowMin + 240));

    // ------------------------------------------------------------------ evidence
    var reports = [], absences = [], clockins = [], evidence = [];
    schedules.forEach(function (r, i) {
        var past = r.Date < todayKey || (r.Date === todayKey && r.Status.Value === "Done");
        if (!past || r.Status.Value === "Cancelled") return;
        var inTime = r.StartTime;
        clockins.push({ ID: 900 + i, Title: "CI-" + r.ID, HostID: r.HostID, ClockInDate: r.Date, ClockInTime: inTime, ClockOutTime: r.EndTime, IsInsideGeofence: i % 23 !== 0, CheckInOffice: r.StudioID, Status: { Value: "Clock Out" } });
        if (i % 9 === 4) return; // no absen, no report
        absences.push({ ID: 1500 + i, Title: "ABS-" + r.ID, ScheduleID: r.Title, HostID: r.HostID, Status: { Value: "Hadir" }, Keterangan: "", LiveDate: r.Date });
        if (r.Status.Value === "Waiting Report") return;
        var gmv = 4000000 + ((i * 7919) % 26) * 1000000;
        var appr = i % 6 === 0 ? "Waiting" : i % 11 === 0 ? "Need Revision" : "Done";
        reports.push({ ID: 2000 + i, Title: "RPT-" + r.ID, ScheduleID: r.Title, HostID: r.HostID, AccountID: r.Account, Platform: r.Platform, LiveDate: r.Date, Penjualan: gmv, Pesanan: Math.round(gmv / 95000), TotalViewer: 3000 + (i * 37) % 9000, Durasi_x0028_Min_x0029_0: r.JamLive * 60, ApprovalStatus: { Value: appr }, Match: { Value: i % 13 === 0 ? "Unmatch" : "Match" }, ApprovalComment: appr === "Need Revision" ? "Screenshot tidak terbaca" : "" });
        if (i % 5 !== 2) evidence.push({ ID: 3000 + i, Title: "RPT-" + r.ID, ScheduleID: r.Title, Status: { Value: i % 13 === 0 ? "Unmatch" : "Match" }, Penjualan: i % 13 === 0 ? gmv * 0.8 : gmv, StartHour: r.StartTime, EndHour: r.EndTime });
    });
    clockins.push({ ID: 999, Title: "CI-live", HostID: live1.HostID, ClockInDate: todayKey, ClockInTime: live1.StartTime, IsInsideGeofence: true, CheckInOffice: "CWG-05", Status: { Value: "Clock In" } });

    function makeDataset(rows, loading) {
        var records = {}, ids = [];
        var cols = {};
        rows.forEach(function (r, i) {
            var id = String(r.ID || i);
            ids.push(id);
            Object.keys(r).forEach(function (k) { cols[k] = 1; });
            records[id] = { getRecordId: function () { return id; }, getValue: function (c) { return r[c] === undefined ? null : r[c]; }, getFormattedValue: function (c) { var v = r[c]; return v && typeof v === "object" ? v.Value : v == null ? "" : String(v); } };
        });
        return {
            loading: !!loading, sortedRecordIds: loading ? [] : ids, records: loading ? {} : records,
            columns: Object.keys(cols).map(function (c, i) { return { name: c, displayName: c, alias: c, dataType: "SingleLine.Text", order: i }; }),
            paging: { hasNextPage: false, totalResultCount: ids.length, loadNextPage: function () {}, setPageSize: function () {} },
            sorting: [], filtering: {}, refresh: function () {},
        };
    }

    // ------------------------------------------------------------------ canvas emulation
    var state = {
        mode: params.get("mode") || "Admin",
        selected: params.get("schedule") || "",
        actionResult: "",
        loading: params.get("loading") === "1",
        empty: params.get("empty") === "1",
    };
    var control = null;
    var host = document.getElementById("host");
    var log = document.getElementById("log");
    var outputs = {};

    function context() {
        var e = state.empty, l = state.loading;
        var p = {
            schedules: makeDataset(e ? [] : schedules, l), brands: makeDataset(brands), accounts: makeDataset(accounts), studios: makeDataset(studios), hosts: makeDataset(hosts),
            reports: makeDataset(e ? [] : reports, l), absences: makeDataset(e ? [] : absences, l), clockins: makeDataset(e ? [] : clockins, l), evidence: makeDataset(e ? [] : evidence, l),
            Context: { raw: JSON.stringify({ userEmail: "ops.user@example.com", userName: "Contoh Ops", roles: "PBS_TEAM", permissions: "", config: { shifts: ["Pagi", "Siang", "Malam"], positions: ["Main", "Co-host"], templateUrl: "#template" } }) },
            Mode: { raw: state.mode },
            ActionResult: { raw: state.actionResult },
            SelectedScheduleId: { raw: state.selected },
        };
        ["Schedules", "Brands", "Accounts", "Studios", "Hosts", "Reports", "Absences", "ClockIns", "Evidence"].forEach(function (n) { p[n + "Json"] = { raw: "" }; });
        return { parameters: p, mode: { trackContainerResize: function () {}, allocatedHeight: host.clientHeight, allocatedWidth: host.clientWidth }, device: {} };
    }

    function render() { control.updateView(context()); }

    function reply(requestId, status, message, data) {
        state.actionResult = JSON.stringify({ requestId: requestId, status: status, message: message || "", data: data || {} });
        render();
    }

    function find(p) { return schedules.filter(function (s) { return s.Title === p.scheduleId; })[0]; }

    function handle(payloadJson) {
        var req;
        try { req = JSON.parse(payloadJson); } catch (e) { return; }
        var shown = JSON.parse(payloadJson);
        if (shown.payload && shown.payload.contentBase64) shown.payload.contentBase64 = shown.payload.contentBase64.slice(0, 24) + "…(" + shown.payload.contentBase64.length + " chars)";
        log.textContent = "ActionPayload → " + JSON.stringify(shown);
        var p = req.payload || {};
        var later = function (ms, fn) { setTimeout(fn, ms); };
        switch (req.action) {
            case "CREATE_SCHEDULE":
                later(700, function () {
                    var r = add(p.date, p.studioId, p.brandId, p.hostId, 0, 0, p.status, { Account: p.accountId, Platform: { Value: p.platform }, StartTime: p.startTime, EndTime: p.endTime, JamLive: p.jamLive, Shift: p.shift, Sesi: p.sesi, CampaignName: p.campaignName, LiveBreak: { Value: p.liveBreakValue }, Position: { Value: p.position } });
                    reply(req.requestId, "ok", "", { scheduleId: r.Title, itemId: r.ID });
                });
                return;
            case "EDIT_SCHEDULE":
                later(600, function () {
                    var r = find(p);
                    if (!r) return reply(req.requestId, "error", "Jadwal tidak ditemukan.");
                    Object.assign(r, { Date: p.date, StudioID: p.studioId, BrandID: p.brandId, HostID: p.hostId, Account: p.accountId, Platform: { Value: p.platform }, StartTime: p.startTime, EndTime: p.endTime, JamLive: p.jamLive, Shift: p.shift, Sesi: p.sesi, CampaignName: p.campaignName, LiveBreak: { Value: p.liveBreakValue }, Position: { Value: p.position }, Status: { Value: p.status } });
                    reply(req.requestId, "ok", "", { scheduleId: r.Title });
                });
                return;
            case "DELETE_SCHEDULE":
                later(500, function () {
                    if (reports.some(function (x) { return x.ScheduleID === p.scheduleId; })) return reply(req.requestId, "error", "Report sudah ada untuk jadwal ini.");
                    schedules = schedules.filter(function (s) { return s.Title !== p.scheduleId; });
                    reply(req.requestId, "ok", "", {});
                });
                return;
            case "UPLOAD_SCHEDULE_FILE":
                later(1200, function () {
                    if (/gagal/i.test(p.originalName)) return reply(req.requestId, "error", "Graph PUT gagal: 423 Locked (contoh).");
                    reply(req.requestId, "ok", p.kind === "AI" ? "Tersimpan di /" + p.folder : "", p.kind === "BULK" ? { created: p.rowCount, fileName: p.fileName } : { fileName: p.fileName });
                });
                return;
            case "REMIND_HOST":
                later(400, function () { reply(req.requestId, "ok", "Pengingat terkirim (contoh).", {}); });
                return;
            default:
                return; // SET_FILTER / NAV_SESSION_DETAIL are UI-only here: the mock holds every row
        }
    }

    function notify() {
        var out = control.getOutputs();
        if (out.SelectedScheduleId !== outputs.SelectedScheduleId) state.selected = out.SelectedScheduleId || "";
        if (out.ActionPayload && out.ActionPayload !== outputs.ActionPayload) handle(out.ActionPayload);
        outputs = out;
        setTimeout(render, 0);
    }

    document.getElementById("mode").value = state.mode;
    document.getElementById("mode").addEventListener("change", function (e) { state.mode = e.target.value; render(); });
    window.addEventListener("resize", function () { render(); });

    var s2 = document.createElement("script");
    s2.src = "../out/controls/Schedule/bundle.js";
    s2.onload = function () {
        control = new captured();
        control.init(context(), notify, {}, host);
        render();
    };
    document.body.appendChild(s2);
})();
