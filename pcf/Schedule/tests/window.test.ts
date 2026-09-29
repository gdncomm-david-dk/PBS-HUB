import { fetchWindow } from "../Schedule/core/schedule";

describe("fetchWindow", () => {
    it("loads two weeks around the first range", () => {
        expect(fetchWindow("2026-09-28", "2026-10-04", null)).toEqual({ from: "2026-09-14", to: "2026-10-18" });
    });
    it("does not reload for the next or previous week", () => {
        const w = { from: "2026-09-14", to: "2026-10-18" };
        expect(fetchWindow("2026-10-05", "2026-10-11", w)).toBeNull();
        expect(fetchWindow("2026-09-21", "2026-09-27", w)).toBeNull();
    });
    it("reloads before the week after next runs out", () => {
        const w = { from: "2026-09-14", to: "2026-10-18" };
        expect(fetchWindow("2026-10-12", "2026-10-18", w)).toEqual({ from: "2026-09-28", to: "2026-11-01" });
    });
});
