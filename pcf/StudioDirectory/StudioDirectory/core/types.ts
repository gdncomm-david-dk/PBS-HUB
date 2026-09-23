// Row shapes follow DESIGN.md "Database Schema". Field comments name the SharePoint column.

export interface StudioRow {
    key: string;               // stable React key (dataset record id or StudioID)
    itemId: number | null;     // SharePoint ID
    studioId: string;          // Title
    namaStudio: string;        // NamaStudio
    kapasitasHost: number;     // KapasitasHost — concurrent host capacity
    lokasiStudio: string;      // LokasiStudio — free-text address, NOT the geofence
    status: string;            // Status (Choice)
    isActive: boolean;         // derived from Status
}

export interface LocationRow {
    key: string;
    itemId: number | null;     // SharePoint ID
    title: string;             // Title — office name, matched to the studio
    studioId: string;          // optional StudioID column, when the list has one
    latitude: number | null;
    longitude: number | null;
    radiusMeter: number | null;
    isActive: boolean;
}

export interface ScheduleRow {
    key: string;
    itemId: number | null;
    scheduleId: string;        // Title, "SCD-<ID>"
    dateKey: string;           // Date, as local yyyy-mm-dd
    studioId: string;          // StudioID
    brandId: string;           // BrandID
    brandName: string;         // resolved from Brand - PBS Hub, or a projected column
    hostId: string;            // HostID
    hostName: string;          // resolved from Host - PBS Hub, or a projected column
    platform: string;          // Platform
    account: string;           // Account
    shift: string;             // Shift
    campaignName: string;      // CampaignName
    status: string;            // Status (Choice)
    startMin: number | null;   // StartTime (text) → minutes after midnight
    endMin: number | null;     // EndTime (text) → minutes after midnight, > startMin (overnight adds 1440)
    jamLive: number;           // JamLive — planned hours, fallback when times are unparseable
    startText: string;
    endText: string;
}

export interface ReportRow {
    key: string;
    reportId: string;          // Title
    scheduleId: string;        // ScheduleID — the join to Schedule.Title, and through it to StudioID
    dateKey: string;           // LiveDate
    penjualan: number;         // Penjualan — GMV claimed by the host, IDR
    approvalStatus: string;    // ApprovalStatus: Waiting Approval / Need Revision / Done
    match: string;             // Match: Match / Unmatch
    brandId: string;
}

export interface ModuleContext {
    userEmail: string;
    userName: string;
    roles: string[];
    permissions: string[];
    config: Record<string, unknown>;
}

export type ActionName =
    | "CREATE_STUDIO"
    | "EDIT_STUDIO"
    | "SET_GEOFENCE"
    | "TOGGLE_GEOFENCE_ACTIVE"
    | "SET_FILTER"
    | "NAV_STUDIO_DETAIL";

export interface ActionPayload {
    action: ActionName;
    requestId: string;
    payload: Record<string, unknown>;
}

export interface ActionResult {
    requestId: string;
    status: "ok" | "error";
    message: string;
    data: Record<string, unknown>;
}

export interface OperatingHours {
    startMin: number;
    endMin: number;
}
