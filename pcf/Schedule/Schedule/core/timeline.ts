// The evidence chain of one session (brief 05): what exists, what is missing, and what to do about it.

import { AbsenceRow, ClockRow, EvidenceRow, ReportRow, ScheduleRow } from "./types";
import { approvalKind, occupies } from "./data";
import { Evidence, phaseOf, sessionEnd, sessionStart } from "./schedule";
import { formatMinutes, minutesOfDay } from "./time";

export type StepState = "done" | "active" | "pending" | "failed" | "skipped";

export type StepId = "scheduled" | "clockin" | "absen" | "report" | "evidence" | "verdict" | "payroll";

export interface Step {
    id: StepId;
    label: string;
    state: StepState;
    when: string;          // short timestamp or status line
    detail: string;        // one line under the label
    todo?: string;         // for pending/active/failed: what is missing and what to do
    remind?: boolean;      // offer "Ingatkan host"
    record: { section: string; rows: [string, string][] }[];
}

const low = (s: string): string => s.toLowerCase();
const hm = (d: Date | null, fallback = ""): string => (d ? formatMinutes(minutesOfDay(d)) : fallback);
const rp = (n: number | null): string => (n === null ? "—" : "Rp " + Math.round(n).toLocaleString("id-ID"));
const num = (n: number | null): string => (n === null ? "—" : n.toLocaleString("id-ID"));
const daysSince = (d: Date, now: Date): number => Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86400000));

export function buildTimeline(s: ScheduleRow, ev: Evidence, now: Date): Step[] {
    const phase = phaseOf(s, now);
    const cancelled = !occupies(s.status);
    const start = sessionStart(s);
    const end = sessionEnd(s);
    const clock = ev.clockFor(s);
    const abs = ev.absencesFor(s);
    const reports = ev.realReportsFor(s);
    const evidence = ev.evidenceFor(s);
    const exempt = ev.noReportReason(s);

    const steps: Step[] = [];
    steps.push({
        id: "scheduled",
        label: "Dijadwalkan",
        state: "done",
        when: s.scheduleId || "ID belum terisi",
        detail: `${s.brandName} · ${s.hostName} · ${s.studioId}`,
        record: [
            {
                section: "Jadwal",
                rows: [
                    ["ScheduleID", s.scheduleId || "—"],
                    ["Tanggal", s.dateKey],
                    ["Jam", s.startMin !== null && s.endMin !== null ? `${formatMinutes(s.startMin)}–${formatMinutes(s.endMin)}` : `${s.startText}–${s.endText}`],
                    ["Status", s.status || "—"],
                ],
            },
            {
                section: "Sesi",
                rows: [
                    ["Brand", s.brandName || "—"],
                    ["Account", s.accountName || "—"],
                    ["Platform", s.platform || "—"],
                    ["Host", s.hostName || "—"],
                    ["Posisi", s.position || "—"],
                    ["Studio", s.studioId || "—"],
                ],
            },
        ],
    });

    if (cancelled) {
        const why = /leave|cuti/i.test(s.status) ? "Host cuti" : "Sesi dibatalkan";
        for (const [id, label] of STEP_LABELS) {
            steps.push({ id, label, state: "skipped", when: "", detail: `${why} — langkah ini tidak berlaku.`, record: [] });
        }
        return steps;
    }

    steps.push(clockStep(s, clock, phase, start, now));
    steps.push(absenStep(abs, phase));
    if (exempt) {
        const why = exempt === "livebreak" ? "Live Break — sesi ini tidak perlu report." : "Co-Host — report dibuat oleh Main Host sesi ini.";
        const tag = exempt === "livebreak" ? "Live Break" : "Co-Host";
        steps.push({ id: "report", label: "Report host", state: "skipped", when: tag, detail: why, record: [] });
        steps.push({ id: "evidence", label: "Bukti AI", state: "skipped", when: "", detail: why, record: [] });
        steps.push({ id: "verdict", label: "Verdict", state: "skipped", when: "", detail: why, record: [] });
        steps.push({ id: "payroll", label: "Baris payroll", state: "skipped", when: "", detail: "Dihitung saat payroll run bulanan dari Clock In (HKTugas, Insentif, Streak).", record: [] });
        return steps;
    }
    steps.push(reportStep(reports, phase, end, now));
    steps.push(evidenceStep(evidence, reports));
    steps.push(verdictStep(reports, evidence));
    steps.push({
        id: "payroll",
        label: "Baris payroll",
        state: reports.some((r) => approvalKind(r.approvalStatus) === "done") ? "pending" : "skipped",
        when: "",
        detail: "Dihitung saat payroll run bulanan dari Clock In (HKTugas, Insentif, Streak).",
        todo: reports.some((r) => approvalKind(r.approvalStatus) === "done") ? "Masuk ke payroll run berikutnya. Lihat modul Payroll." : undefined,
        record: [],
    });
    return steps;
}

const STEP_LABELS: [StepId, string][] = [
    ["clockin", "Clock in"],
    ["absen", "Absen"],
    ["report", "Report host"],
    ["evidence", "Bukti AI"],
    ["verdict", "Verdict"],
    ["payroll", "Baris payroll"],
];

function clockStep(s: ScheduleRow, c: ClockRow | null, phase: string, start: Date | null, now: Date): Step {
    const base = { id: "clockin" as const, label: "Clock in" };
    if (!c || (!c.checkIn && !c.checkInText)) {
        if (phase === "upcoming") return { ...base, state: "pending", when: "", detail: "Belum waktunya.", record: [] };
        const late = start ? Math.max(0, Math.round((now.getTime() - start.getTime()) / 60000)) : 0;
        return {
            ...base,
            state: phase === "live" ? "active" : "failed",
            when: "",
            detail: "Tidak ada Clock In untuk host ini di tanggal sesi.",
            todo: phase === "live" ? `Host belum clock in — sesi sudah mulai ${late} menit lalu.` : "Host tidak clock in. Cek dengan host atau tambahkan koreksi di Attendance.",
            remind: phase === "live",
            record: [],
        };
    }
    const outside = c.inside === false;
    return {
        ...base,
        state: outside ? "failed" : "done",
        when: hm(c.checkIn, c.checkInText),
        detail: outside ? "Clock in di luar geofence." : c.office ? `Di ${c.office}` : "Di dalam geofence",
        todo: outside ? "Clock in tercatat di luar radius studio. Tinjau di Geofence exceptions." : undefined,
        record: [
            {
                section: "Clock In",
                rows: [
                    ["Record", c.title || "—"],
                    ["Tanggal", c.dateKey],
                    ["Masuk", hm(c.checkIn, c.checkInText) || "—"],
                    ["Keluar", hm(c.checkOut, c.checkOutText) || "—"],
                    ["Kantor", c.office || "—"],
                    ["Di dalam geofence", c.inside === null ? "—" : c.inside ? "Ya" : "Tidak"],
                    ["Status", c.status || "—"],
                ],
            },
        ],
    };
}

function absenStep(abs: AbsenceRow[], phase: string): Step {
    const base = { id: "absen" as const, label: "Absen" };
    const a = abs[0];
    if (!a) {
        return {
            ...base,
            state: phase === "ended" ? "active" : "pending",
            when: "",
            detail: "Host Absence belum ada.",
            todo: phase === "ended" ? "Host belum absen untuk sesi ini — report tidak bisa disubmit sebelum absen." : undefined,
            remind: phase === "ended",
            record: [],
        };
    }
    const bad = /(absent|tidak|alpha|leave|cuti|izin)/i.test(a.status);
    return {
        ...base,
        state: bad ? "failed" : "done",
        when: a.status || "",
        detail: a.keterangan || a.absId,
        record: [{ section: "Host Absence", rows: [["AbsID", a.absId || "—"], ["Status", a.status || "—"], ["Keterangan", a.keterangan || "—"], ["Tanggal", a.dateKey || "—"]] }],
    };
}

function reportStep(reports: ReportRow[], phase: string, end: Date | null, now: Date): Step {
    const base = { id: "report" as const, label: "Report host" };
    if (!reports.length) {
        if (phase !== "ended") return { ...base, state: "pending", when: "", detail: "Report dibuat host setelah sesi selesai.", record: [] };
        const d = end ? daysSince(end, now) : 0;
        return {
            ...base,
            state: "active",
            when: "",
            detail: "Belum ada report.",
            todo: `Report belum masuk — host belum submit, ${d === 0 ? "hari ini" : `${d} hari setelah sesi`}.`,
            remind: true,
            record: [],
        };
    }
    const total = reports.reduce((t, r) => t + (r.penjualan ?? 0), 0);
    return {
        ...base,
        state: "done",
        when: reports.length > 1 ? `${reports.length} report` : reports[0].reportId,
        detail: `GMV ${rp(total)}`,
        record: reports.map((r) => ({
            section: `Report ${r.reportId || ""}`.trim(),
            rows: [
                ["Account", r.accountId || "—"],
                ["Platform", r.platform || "—"],
                ["Penjualan (GMV)", rp(r.penjualan)],
                ["Pesanan", num(r.pesanan)],
                ["Total viewer", num(r.totalViewer)],
                ["Durasi", r.durasiMin === null ? "—" : `${num(r.durasiMin)} menit`],
                ["Approval", r.approvalStatus || "—"],
            ],
        })),
    };
}

function evidenceStep(ev: EvidenceRow[], reports: ReportRow[]): Step {
    const base = { id: "evidence" as const, label: "Bukti AI" };
    if (!ev.length) {
        return {
            ...base,
            state: reports.length ? "active" : "pending",
            when: "",
            detail: "Belum ada hasil OCR (Report Automation).",
            todo: reports.length ? "Screenshot bukti belum diproses. Pastikan host mengunggah screenshot dengan nama ReportID_Platform_AccountID." : undefined,
            record: [],
        };
    }
    return {
        ...base,
        state: "done",
        when: ev.length > 1 ? `${ev.length} bukti` : ev[0].title,
        detail: ev.map((e) => rp(e.penjualan)).join(" · "),
        record: ev.map((e) => ({
            section: `Bukti ${e.title}`,
            rows: [
                ["Penjualan terbaca", rp(e.penjualan)],
                ["Jam", [e.startHour, e.endHour].filter(Boolean).join("–") || "—"],
                ["Status", e.status || "—"],
            ],
        })),
    };
}

function verdictStep(reports: ReportRow[], ev: EvidenceRow[]): Step {
    const base = { id: "verdict" as const, label: "Verdict" };
    if (!reports.length) return { ...base, state: "pending", when: "", detail: "Menunggu report.", record: [] };
    const st = reports.map((r) => approvalKind(r.approvalStatus));
    const record = [
        {
            section: "Verdict",
            rows: reports.flatMap((r) => [
                [r.reportId || "Report", `${r.approvalStatus || "—"} · ${r.match || ev[0]?.status || "belum dicocokkan"}`],
                ...(r.approvalComment ? [["Komentar", r.approvalComment]] : []),
                ...(r.approverEmail ? [["Approver", r.approverEmail]] : []),
            ]) as [string, string][],
        },
    ];
    if (st.includes("revision"))
        return { ...base, state: "failed", when: "Need Revision", detail: "Report diminta revisi.", todo: "Host perlu merevisi report. Setelah host submit ulang, status menjadi Waiting Approval Revision.", remind: true, record };
    if (st.every((x) => x === "done")) return { ...base, state: "done", when: "Done", detail: reports.some((r) => low(r.match) === "unmatch") ? "Disetujui walau Unmatch" : "Disetujui", record };
    if (st.includes("waitingRevision"))
        return { ...base, state: "active", when: "Waiting Approval Revision", detail: "Host sudah mengirim revisi.", todo: "Bandingkan lagi report host dengan hasil AI, lalu setujui atau minta revisi.", record };
    return { ...base, state: "active", when: "Waiting Approval", detail: "Menunggu review.", todo: "Bandingkan report host dengan hasil AI, lalu setujui atau minta revisi.", record };
}
