/* Local preview harness for pbs_Ops.StudioHub.
 * Loads the real bundle.js, feeds it mock datasets shaped like the SharePoint lists in DESIGN.md,
 * and plays the canvas role: it applies ActionPayload to the mock data and answers via ActionResult.
 * Open harness/index.html after `npm run build`. Not shipped in the solution.
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
    var hm = function (min) { return pad(Math.floor(min / 60)) + ":" + pad(min % 60); };

    // ------------------------------------------------------------------ mock lists (DESIGN.md columns)
    // One Studio Location serves many studios: the Cawang building holds six. Studio.LocationID is a lookup
    // ({ Id, Value }) to Studio Location; BSD-02 points at a LocationID that no row carries (broken link), and
    // KMG-01 has no LocationID yet, so it only matches its location by name (legacy).
    var locations = [
        { ID: 11, Title: "Cawang", LocationID: "LOC-CWG", Latitude: -6.243311, Longitude: 106.872201, RadiusMeter: 100, IsActive: true },
        { ID: 12, Title: "Tebet", LocationID: "LOC-TBT", Latitude: -6.226291, Longitude: 106.853911, RadiusMeter: 20, IsActive: true },
        { ID: 13, Title: "Pondok Indah", LocationID: "LOC-PIK", Latitude: -6.265801, Longitude: 106.784302, RadiusMeter: 100, IsActive: true },
        { ID: 14, Title: "Studio Kemang", Latitude: -6.263991, Longitude: 106.813294, RadiusMeter: 120, IsActive: true },
    ];
    var lookup = function (locId) {
        var l = locations.filter(function (x) { return x.LocationID === locId; })[0];
        return locId ? { Id: l ? l.ID : 0, Value: locId } : null;
    };
    var studios = [
        { ID: 1, Title: "CWG-05", NamaStudio: "Studio Cawang 5", KapasitasHost: 2, LokasiStudio: "Jl. Dewi Sartika, Cawang, Jakarta Timur", LocationID: lookup("LOC-CWG"), Status: { Value: "Active" } },
        { ID: 2, Title: "CWG-03", NamaStudio: "Studio Cawang 3", KapasitasHost: 2, LokasiStudio: "Jl. Dewi Sartika, Cawang, Jakarta Timur", LocationID: lookup("LOC-CWG"), Status: { Value: "Active" } },
        { ID: 3, Title: "BSD-02", NamaStudio: "Studio BSD 2", KapasitasHost: 3, LokasiStudio: "BSD City, Tangerang Selatan", LocationID: { Id: 0, Value: "LOC-BSD" }, Status: { Value: "Active" } },
        { ID: 4, Title: "CWG-07", NamaStudio: "Studio Tebet", KapasitasHost: 1, LokasiStudio: "Tebet, Jakarta Selatan", LocationID: lookup("LOC-TBT"), Status: { Value: "Active" } },
        { ID: 5, Title: "CWG-01", NamaStudio: "Studio Cawang 1", KapasitasHost: 2, LokasiStudio: "Jl. Dewi Sartika, Cawang, Jakarta Timur", LocationID: lookup("LOC-CWG"), Status: { Value: "Inactive" } },
        { ID: 6, Title: "CWG-06", NamaStudio: "Studio Cawang 6", KapasitasHost: 2, LokasiStudio: "Jl. Dewi Sartika, Cawang, Jakarta Timur", LocationID: lookup("LOC-CWG"), Status: { Value: "Active" } },
        { ID: 7, Title: "CWG-02", NamaStudio: "Studio Cawang 2", KapasitasHost: 2, LokasiStudio: "Jl. Dewi Sartika, Cawang, Jakarta Timur", LocationID: lookup("LOC-CWG"), Status: { Value: "Active" } },
        { ID: 8, Title: "CWG-04", NamaStudio: "Studio Cawang 4", KapasitasHost: 1, LokasiStudio: "Jl. Dewi Sartika, Cawang, Jakarta Timur", LocationID: lookup("LOC-CWG"), Status: { Value: "Active" } },
        { ID: 9, Title: "KMG-01", NamaStudio: "Studio Kemang", KapasitasHost: 2, LokasiStudio: "Kemang, Jakarta Selatan", LocationID: null, Status: { Value: "Active" } },
    ];
    var brands = [
        ["BR-01", "Contoh Aruna"], ["BR-02", "Contoh Kirana"], ["BR-03", "Contoh Lestari"], ["BR-04", "Contoh Nirmala"], ["BR-05", "Contoh Sekar"], ["BR-06", "Contoh Tirta"],
    ].map(function (b, i) { return { ID: 100 + i, Title: b[0], NamaBrand: b[1] }; });
    var hosts = [
        ["HST-001", "Dinda Maharani"], ["HST-002", "Rani Salsabila"], ["HST-003", "Vina Anggraini"], ["HST-004", "Sari Puspita"],
        ["HST-005", "Bella Oktaviani"], ["HST-006", "Nadia Putri"], ["HST-007", "Ayu Lestari"], ["HST-008", "Citra Dewi"],
    ].map(function (h, i) { return { ID: 200 + i, Title: h[0], NamaHost: h[1] }; });

    // Deterministic pseudo-random schedule for the previous and the current month.
    var seed = 7;
    var rnd = function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var todayKey = dkey(now);
    var schedules = [];
    var sid = 400;
    var add = function (date, studio, brand, host, start, end, status) {
        sid++;
        schedules.push({
            ID: sid, Title: "SCD-" + sid, Date: date, StudioID: studio, BrandID: brand, HostID: host,
            StartTime: hm(start), EndTime: hm(end), JamLive: (end - start) / 60,
            Status: { Value: status }, Platform: { Value: rnd() > 0.5 ? "TikTok" : "Shopee" },
            Account: brand.replace("BR", "ACC"), Shift: start < 780 ? "Pagi" : start < 1080 ? "Siang" : "Malam",
            CampaignName: "",
        });
    };
    var busy = { "CWG-05": 0.55, "CWG-03": 0.85, "BSD-02": 0.45, "CWG-07": 0.2, "CWG-06": 0.5, "CWG-01": 0, "CWG-02": 0.4, "CWG-04": 0.3, "KMG-01": 0.35 };
    var cap = { "CWG-05": 2, "CWG-03": 2, "BSD-02": 3, "CWG-07": 1, "CWG-06": 2, "CWG-01": 2, "CWG-02": 2, "CWG-04": 1, "KMG-01": 2 };
    for (var m = -1; m <= 0; m++) {
        var first = new Date(now.getFullYear(), now.getMonth() + m, 1);
        var days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
        for (var d = 1; d <= days; d++) {
            var date = new Date(first.getFullYear(), first.getMonth(), d);
            var key = dkey(date);
            if (key === todayKey) continue;
            Object.keys(busy).forEach(function (st) {
                for (var slot = 0; slot < cap[st]; slot++) {
                    [480, 660, 840, 1020].forEach(function (start) {
                        if (rnd() < busy[st] * (m === -1 ? 0.9 : 1)) {
                            var len = [120, 150, 180][Math.floor(rnd() * 3)];
                            var status = key < todayKey ? (rnd() < 0.06 ? "Cancelled" : "Finished") : "Planned";
                            add(key, st, brands[Math.floor(rnd() * brands.length)].Title, hosts[Math.floor(rnd() * hosts.length)].Title, start, Math.min(start + len, 1320), status);
                        }
                    });
                }
            });
        }
    }
    // Today: sessions that are running right now, plus a few past and future ones.
    var clamp = function (v) { return Math.max(480, Math.min(1320, v)); };
    add(todayKey, "CWG-05", "BR-01", "HST-001", clamp(nowMin - 100), clamp(nowMin + 18), "Planned");
    add(todayKey, "CWG-03", "BR-02", "HST-002", clamp(nowMin - 200), clamp(nowMin + 160), "Planned");
    add(todayKey, "CWG-03", "BR-02", "HST-003", clamp(nowMin - 200), clamp(nowMin + 160), "Planned");
    add(todayKey, "BSD-02", "BR-03", "HST-004", clamp(nowMin - 80), clamp(nowMin + 70), "Planned");
    add(todayKey, "CWG-06", "BR-05", "HST-006", 480, clamp(nowMin - 60), "Waiting Report");
    add(todayKey, "CWG-06", "BR-04", "HST-007", clamp(nowMin + 90), clamp(nowMin + 240), "Planned");
    add(todayKey, "CWG-07", "BR-06", "HST-008", 480, 600, "Finished");
    add(todayKey, "CWG-05", "BR-04", "HST-005", 480, 660, "Finished");
    add(todayKey, "CWG-05", "BR-06", "HST-007", 480, 660, "Finished");
    add(todayKey, "CWG-05", "BR-06", "HST-008", 540, 630, "Finished"); // over capacity (3 hosts on a 2-host studio)

    // Reports (Report - PBS Hub): one per ended session, most verified, some waiting, a few missing.
    var reports = [];
    schedules.forEach(function (sc) {
        var st = sc.Status.Value;
        if (st === "Cancelled" || st === "Leave") return;
        var endMin = Number(sc.EndTime.slice(0, 2)) * 60 + Number(sc.EndTime.slice(3));
        var ended = sc.Date < todayKey || (sc.Date === todayKey && endMin <= nowMin);
        if (ended && rnd() < 0.08) {
            sc.ApprovalStatus = { Value: "LiveBreak" }; // live break: no report expected
            return;
        }
        if (!ended || rnd() < 0.07) return;
        var r = rnd();
        reports.push({
            ID: 5000 + reports.length, Title: "RPT-" + (5000 + reports.length), ScheduleID: sc.Title, LiveDate: sc.Date,
            BrandID: sc.BrandID, HostID: sc.HostID,
            Penjualan: Math.round((1500000 + rnd() * 23000000) * sc.JamLive / 2.5 / 1000) * 1000,
            ApprovalStatus: { Value: sc.Date >= dkey(new Date(now.getTime() - 3 * 86400000)) ? (r < 0.6 ? "Waiting Approval" : "Done") : r < 0.05 ? "Need Revision" : "Done" },
            Match: { Value: r < 0.1 ? "Unmatch" : "Match" },
        });
    });

    // ------------------------------------------------------------------ dataset mock
    // ?noapprovalcol=1 leaves ApprovalStatus out of the schedules dataset, as when it is not added under Fields.
    if (params.get("noapprovalcol") === "1") schedules.forEach(function (sc) { delete sc.ApprovalStatus; });

    // Canvas hands a PCF dataset lookups as an EntityReference; choices as their value.
    var flat = function (v) {
        if (v && typeof v === "object" && "Id" in v) return { id: { guid: String(v.Id) }, name: v.Value, etn: "lookup" };
        return v && typeof v === "object" && "Value" in v ? v.Value : v;
    };
    // ?nolocationcol=1 drops LocationID from the studios dataset, as when it is not added under Fields.
    var dropCol = params.get("nolocationcol") === "1" ? "LocationID" : "";
    function makeDataset(rows, loading) {
        var cols = {};
        rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (!(dropCol && k === dropCol && r.NamaStudio !== undefined)) cols[k] = 1; }); });
        var ids = rows.map(function (r) { return String(r.ID); });
        var records = {};
        rows.forEach(function (r) {
            records[String(r.ID)] = {
                getRecordId: function () { return String(r.ID); },
                getValue: function (c) {
                    if (dropCol && c === dropCol && r.NamaStudio !== undefined) return null;
                    var v = flat(r[c]);
                    if (c === "Date" && typeof v === "string") { var p = v.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
                    return v === undefined ? null : v;
                },
                getFormattedValue: function (c) { if (dropCol && c === dropCol && r.NamaStudio !== undefined) return ""; var v = flat(r[c]); if (v && v.name !== undefined) v = v.name; return v === undefined || v === null ? "" : String(v); },
            };
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
        selected: params.get("studio") || "",
        actionResult: "",
        loading: params.get("loading") === "1",
        empty: params.get("empty") === "1",
    };
    var control = null;
    var host = document.getElementById("host");
    var log = document.getElementById("log");
    var outputs = {};

    function context() {
        var e = state.empty;
        return {
            parameters: {
                studios: makeDataset(e ? [] : studios, state.loading),
                locations: makeDataset(e ? [] : locations, state.loading),
                schedules: makeDataset(e ? [] : schedules, state.loading),
                brands: makeDataset(brands),
                hosts: makeDataset(hosts),
                reports: makeDataset(e ? [] : reports, state.loading),
                ReportsJson: { raw: "" },
                StudiosJson: { raw: "" }, LocationsJson: { raw: "" }, SchedulesJson: { raw: "" }, BrandsJson: { raw: "" }, HostsJson: { raw: "" },
                Context: { raw: JSON.stringify({ userEmail: "ops.user@example.com", userName: "Bayu Prasetyo", roles: "PBS_TEAM", permissions: "", config: { maxAccuracyMeters: 100 } }) },
                Mode: { raw: state.mode },
                ActionResult: { raw: state.actionResult },
                OperatingHourStart: { raw: 8 },
                OperatingHourEnd: { raw: 22 },
                SelectedStudioId: { raw: state.selected },
            },
            mode: { trackContainerResize: function () {}, allocatedHeight: host.clientHeight, allocatedWidth: host.clientWidth },
            device: {},
        };
    }

    function render() { control.updateView(context()); }

    function reply(requestId, status, message, data) {
        state.actionResult = JSON.stringify({ requestId: requestId, status: status, message: message || "", data: data || {} });
        render();
    }

    function handle(payloadJson) {
        var req;
        try { req = JSON.parse(payloadJson); } catch (e) { return; }
        log.textContent = "ActionPayload → " + JSON.stringify(req, null, 1);
        var p = req.payload || {};
        var ok = function (data) { setTimeout(function () { reply(req.requestId, "ok", "", data); }, 700); };
        switch (req.action) {
            case "CREATE_STUDIO":
                if (studios.some(function (s) { return s.Title === p.studioId; })) { setTimeout(function () { reply(req.requestId, "error", "StudioID " + p.studioId + " sudah ada."); }, 500); return; }
                studios.push({ ID: 1000 + studios.length, Title: p.studioId, NamaStudio: p.namaStudio, KapasitasHost: p.kapasitasHost, LokasiStudio: p.lokasiStudio, LocationID: p.locationItemId ? { Id: p.locationItemId, Value: p.locationId } : null, Status: { Value: p.status } });
                ok({ studioId: p.studioId });
                return;
            case "EDIT_STUDIO":
                studios.forEach(function (s) { if (s.Title === p.studioId) { s.NamaStudio = p.namaStudio; s.KapasitasHost = p.kapasitasHost; s.LokasiStudio = p.lokasiStudio; s.LocationID = p.locationItemId ? { Id: p.locationItemId, Value: p.locationId } : null; s.Status = { Value: p.status }; } });
                ok({ studioId: p.studioId });
                return;
            case "SET_STUDIO_LOCATION":
                studios.forEach(function (s) { if (s.Title === p.studioId) s.LocationID = { Id: p.locationItemId, Value: p.locationId }; });
                ok({ studioId: p.studioId, locationId: p.locationId });
                return;
            case "SET_GEOFENCE":
                var loc = locations.filter(function (l) { return p.locationItemId && l.ID === p.locationItemId; })[0];
                if (p.isNew) {
                    if (locations.some(function (l) { return l.LocationID === p.locationId; })) { setTimeout(function () { reply(req.requestId, "error", "LocationID " + p.locationId + " sudah ada."); }, 500); return; }
                    loc = { ID: 2000 + locations.length, Title: p.title, LocationID: p.locationId }; locations.push(loc);
                }
                loc.Latitude = p.latitude; loc.Longitude = p.longitude; loc.RadiusMeter = p.radiusMeter; loc.IsActive = p.isActive;
                if (p.linkStudio) {
                    studios.forEach(function (s) { if (s.Title === p.studioId) s.LocationID = { Id: loc.ID, Value: loc.LocationID }; });
                }
                ok({ locationId: loc.LocationID, locationItemId: loc.ID });
                return;
            case "TOGGLE_GEOFENCE_ACTIVE":
                locations.forEach(function (l) { if (l.ID === p.locationItemId) l.IsActive = p.isActive; });
                ok({ locationId: p.locationId });
                return;
            default:
                return; // SET_FILTER / NAV_STUDIO_DETAIL are UI-only
        }
    }

    function notify() {
        var out = control.getOutputs();
        if (out.SelectedStudioId !== outputs.SelectedStudioId) state.selected = out.SelectedStudioId || "";
        if (out.ActionPayload && out.ActionPayload !== outputs.ActionPayload) handle(out.ActionPayload);
        outputs = out;
        setTimeout(render, 0);
    }

    document.getElementById("mode").value = state.mode;
    document.getElementById("mode").addEventListener("change", function (e) { state.mode = e.target.value; render(); });
    window.addEventListener("resize", function () { render(); });

    var s = document.createElement("script");
    s.src = "../out/controls/StudioDirectory/bundle.js";
    s.onload = function () {
        control = new captured();
        control.init(context(), notify, {}, host);
        render();
    };
    document.body.appendChild(s);
})();
