// Row shapes follow DESIGN.md "Database Schema". Field comments name the SharePoint column.

export interface BrandRow {
    key: string;
    itemId: number | null;
    brandId: string;           // BrandID column, else Title
    title: string;             // Title
    namaBrand: string;         // NamaBrand (else Title when BrandID is the key); falls back to brandId
    hasName: boolean;          // a real name was found, not just the ID
    status: string;
    isActive: boolean;
}

export interface AccountRow {
    key: string;
    itemId: number | null;
    accountId: string;         // Title — referenced by Schedule.Account and Report.AccountID
    accountName: string;       // AccountName — seller handle on the platform
    brandId: string;           // BrandID (or Brand)
    platform: string;          // Platform (Choice)
}

export interface StudioRow {
    key: string;
    itemId: number | null;
    studioId: string;          // Title
    namaStudio: string;        // NamaStudio
    kapasitasHost: number;     // KapasitasHost — concurrent host capacity
    status: string;
    isActive: boolean;
}

export interface HostRow {
    key: string;
    itemId: number | null;
    hostId: string;            // HostID column, else Title
    title: string;             // Title
    name: string;              // NamaHost / HostName (else Title when HostID is the key); falls back to hostId
    hasName: boolean;
    status: string;
    isActive: boolean;
}

export interface ScheduleRow {
    key: string;
    itemId: number | null;     // SharePoint ID
    scheduleId: string;        // Title, "SCD-<ID>" — blank for a moment after a single create (race R5)
    dateKey: string;           // Date, local yyyy-mm-dd
    brandId: string;           // BrandID
    brandName: string;         // resolved from Brand - PBS Hub
    brandKnown: boolean;       // false when only the ID could be shown
    studioId: string;          // StudioID
    hostId: string;            // HostID
    hostName: string;          // resolved from Host - PBS Hub
    hostKnown: boolean;
    accountId: string;         // Account (text, the AccountID)
    accountName: string;       // resolved from Account - PBS Hub
    platform: string;          // Platform (Choice)
    shift: string;             // Shift
    sesi: string;              // Sesi
    position: string;          // Position (Choice)
    liveBreak: string;         // LiveBreak (Choice)
    isLiveBreak: boolean;      // LiveBreak = Yes: no report is expected
    isCoHost: boolean;         // Position = Co-Host: the main host files the report
    campaignName: string;      // CampaignName
    totalAccount: number | null;
    status: string;            // Status: Planned, Waiting Report, Finished (final), Cancelled, Leave. Legacy "Done" is read as Finished
    startMin: number | null;   // StartTime (text) → minutes after midnight
    endMin: number | null;     // EndTime (text) → minutes, > startMin (overnight adds 1440)
    jamLive: number;           // JamLive — planned hours
    startText: string;
    endText: string;
}

export interface ReportRow {
    key: string;
    itemId: number | null;     // SharePoint ID
    reportId: string;          // Title
    scheduleId: string;        // ScheduleID — join to Schedule.Title
    hostId: string;
    accountId: string;
    platform: string;
    dateKey: string;           // LiveDate
    penjualan: number | null;  // Penjualan — claimed GMV, IDR
    pesanan: number | null;
    totalViewer: number | null;
    durasiMin: number | null;
    approvalStatus: string;    // Waiting Approval / Waiting Approval Revision / Need Revision / Done / LiveBreak
    match: string;             // Match / Unmatch
    approvalComment: string;
    approverEmail: string;
    createdText: string;
}

export interface AbsenceRow {
    key: string;
    absId: string;             // Title
    scheduleId: string;
    hostId: string;
    status: string;            // Present / absent / leave (owner to confirm values)
    keterangan: string;
    dateKey: string;
}

export interface ClockRow {
    key: string;
    title: string;
    hostId: string;
    email: string;             // EmployeeEmail
    dateKey: string;           // ClockInDate
    checkIn: Date | null;      // CheckInTime (authoritative), else ClockInTime text
    checkInText: string;
    checkOut: Date | null;
    checkOutText: string;
    inside: boolean | null;    // IsInsideGeofence — client-asserted
    office: string;
    status: string;
}

export interface EvidenceRow {
    key: string;
    itemId: number | null;
    title: string;             // Report Automation.Title = Report.Title (REP-120)
    scheduleId: string;
    status: string;            // Match / Unmatch
    penjualan: number | null;
    pesanan: number | null;
    totalViewer: number | null;
    durasiMin: number | null;
    startHour: string;
    endHour: string;
}

export interface ModuleContext {
    userEmail: string;
    userName: string;
    roles: string[];
    permissions: string[];
    config: Record<string, unknown>;
}

export type ActionName =
    | "SET_FILTER"
    | "CREATE_SCHEDULE"
    | "EDIT_SCHEDULE"
    | "DELETE_SCHEDULE"
    | "UPLOAD_SCHEDULE_FILE"
    | "OPEN_UPLOAD"
    | "REMIND_HOST"
    | "REVIEW_REPORT"
    | "REFRESH"
    | "NAV_SESSION_DETAIL";

export interface ActionResult {
    requestId: string;
    status: "ok" | "error";
    message: string;
    data: Record<string, unknown>;
}

export type UploadKind = "BULK" | "AI";
