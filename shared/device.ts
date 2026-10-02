/**
 * Which device a clock in / out was made on. Read from the browser the control runs in (Power Apps mobile
 * app, a phone browser or a laptop browser), so canvas can store it next to the GPS columns.
 */

export type DeviceType = "Mobile" | "Tablet" | "Desktop";

export interface DeviceInfo {
  type: DeviceType;
  /** Short readable line for the Device column, e.g. "Android 14 · Chrome 126 · 412x915". */
  info: string;
}

interface NavLike {
  userAgent?: string;
  maxTouchPoints?: number;
  userAgentData?: { mobile?: boolean; platform?: string };
}

const first = (re: RegExp, s: string): string => re.exec(s)?.[1] ?? "";

export function detectDevice(
  nav: NavLike | undefined = typeof navigator === "undefined"
    ? undefined
    : (navigator as NavLike),
  screen?: { width: number; height: number },
): DeviceInfo {
  const ua = nav?.userAgent ?? "";
  const touch = nav?.maxTouchPoints ?? 0;
  const iPad =
    /iPad/i.test(ua) || (/Macintosh/i.test(ua) && touch > 1); // iPadOS reports a Mac
  const androidTablet = /Android/i.test(ua) && !/Mobile/i.test(ua);
  const phone =
    /iPhone|iPod/i.test(ua) ||
    (/Android/i.test(ua) && /Mobile/i.test(ua)) ||
    /Windows Phone/i.test(ua) ||
    nav?.userAgentData?.mobile === true;
  const type: DeviceType = iPad || androidTablet ? "Tablet" : phone ? "Mobile" : "Desktop";

  const os = /Android/i.test(ua)
    ? `Android ${first(/Android\s([\d.]+)/i, ua)}`.trim()
    : iPad || /iPhone|iPod/i.test(ua)
      ? `iOS ${first(/OS\s(\d+)[_\d]*/i, ua)}`.trim()
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac OS X/i.test(ua)
          ? "macOS"
          : /CrOS/i.test(ua)
            ? "ChromeOS"
            : /Linux/i.test(ua)
              ? "Linux"
              : "";
  const browser = /PowerApps/i.test(ua)
    ? "Power Apps"
    : /Edg\//.test(ua)
      ? `Edge ${first(/Edg\/(\d+)/, ua)}`
      : /OPR\//.test(ua)
        ? `Opera ${first(/OPR\/(\d+)/, ua)}`
        : /(Chrome|CriOS)\//.test(ua)
          ? `Chrome ${first(/(?:Chrome|CriOS)\/(\d+)/, ua)}`
          : /Firefox\//.test(ua)
            ? `Firefox ${first(/Firefox\/(\d+)/, ua)}`
            : /Safari\//.test(ua)
              ? `Safari ${first(/Version\/(\d+)/, ua)}`
              : "";
  const size = screen ? `${Math.round(screen.width)}x${Math.round(screen.height)}` : "";
  const info = [os, browser, size].map((x) => x.trim()).filter(Boolean).join(" · ");
  return { type, info: info.slice(0, 200) };
}

/** Short label for tables: HP, Tablet or Laptop. */
export const deviceLabel = (type: string): string =>
  /^mobile$/i.test(type) ? "HP" : /^tablet$/i.test(type) ? "Tablet" : /^desktop$/i.test(type) ? "Laptop" : type;
