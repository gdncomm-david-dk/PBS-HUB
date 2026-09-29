import { DEFAULT_HOST_OPTIONS, HostSession, hostCanDelete, statusAfterDelete } from "../shared/hostApp";

const rep = (o: Record<string, unknown>) => ({ ID: 1, Title: "REP-1", HostID: "H1", ScheduleID: "SCD-1", ...o });

describe("delete report", () => {
  it("host may delete only while the report is not matched", () => {
    expect(hostCanDelete(rep({ ApprovalStatus: "Waiting Approval" }))).toBe(true);
    expect(hostCanDelete(rep({ ApprovalStatus: "Need Revision", Match: "Unmatch" }))).toBe(true);
    expect(hostCanDelete(rep({ ApprovalStatus: "" }))).toBe(true);
    expect(hostCanDelete(rep({ ApprovalStatus: "Waiting Approval", Match: "Match" }))).toBe(false);
    expect(hostCanDelete(rep({ ApprovalStatus: "Done" }))).toBe(false);
    expect(hostCanDelete(rep({ ApprovalStatus: "LiveBreak" }))).toBe(false);
    expect(hostCanDelete(undefined)).toBe(false);
  });

  it("schedule goes back to Waiting Report unless the other reports cover the session", () => {
    const a = rep({ ID: 1, "Durasi(Min)": 60 });
    const b = rep({ ID: 2, Title: "REP-2", "Durasi(Min)": 120 });
    const s = (reports: Record<string, unknown>[], requiredMin: number | null) =>
      ({ reports, requiredMin }) as unknown as HostSession;
    expect(statusAfterDelete(s([a], 120), a, DEFAULT_HOST_OPTIONS)).toBe("Waiting Report");
    expect(statusAfterDelete(s([a], null), a, DEFAULT_HOST_OPTIONS)).toBe("Waiting Report");
    expect(statusAfterDelete(s([a, b], 120), a, DEFAULT_HOST_OPTIONS)).toBe("Finished");
    expect(statusAfterDelete(s([a, b], 120), b, DEFAULT_HOST_OPTIONS)).toBe("Waiting Report");
  });
});
