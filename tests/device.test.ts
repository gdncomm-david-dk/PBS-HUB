import { deviceLabel, detectDevice } from "../shared/device";

const ua = {
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  tab: "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  win: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

describe("detectDevice", () => {
  it("phone, tablet and laptop", () => {
    expect(detectDevice({ userAgent: ua.android, maxTouchPoints: 5 }, { width: 412, height: 915 })).toEqual({
      type: "Mobile",
      info: "Android 14 · Chrome 126 · 412x915",
    });
    expect(detectDevice({ userAgent: ua.iphone, maxTouchPoints: 5 }).type).toBe("Mobile");
    expect(detectDevice({ userAgent: ua.tab, maxTouchPoints: 5 }).type).toBe("Tablet");
    expect(detectDevice({ userAgent: ua.ipad, maxTouchPoints: 5 }).type).toBe("Tablet");
    expect(detectDevice({ userAgent: ua.win, maxTouchPoints: 0 }, { width: 1920, height: 1080 })).toEqual({
      type: "Desktop",
      info: "Windows · Edge 126 · 1920x1080",
    });
    expect(detectDevice({ userAgent: ua.mac, maxTouchPoints: 0 }).type).toBe("Desktop");
  });
  it("labels for tables", () => {
    expect(deviceLabel("Mobile")).toBe("HP");
    expect(deviceLabel("Desktop")).toBe("Laptop");
    expect(deviceLabel("Tablet")).toBe("Tablet");
  });
});
