import * as React from "react";
import type { ActionResult } from "./contract";
import type { Tone } from "./reconcile";
import { MASCOT_CHEER } from "./assets.generated";

type IconName =
  | "checkSquare" | "mapPin" | "clock" | "file" | "calendar" | "upload" | "alert" | "check" | "info"
  | "image" | "zoom" | "refresh" | "x" | "chevronDown" | "arrowLeft" | "external" | "bell" | "sparkle" | "inbox" | "filterX";

const PATHS: Record<IconName, React.ReactNode> = {
  checkSquare: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  mapPin: <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5M12 3v12" /></>,
  alert: <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></>,
  check: <path d="M20 6L9 17l-5-5" />,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></>,
  zoom: <><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35M11 8v6M8 11h6" /></>,
  refresh: <><path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></>,
  x: <path d="M18 6L6 18M6 6l12 12" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  arrowLeft: <path d="M19 12H5M12 19l-7-7 7-7" />,
  external: <><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6M10 14L21 3" /></>,
  bell: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></>,
  sparkle: <path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z" />,
  inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>,
  filterX: <><path d="M22 3H2l8 9.46V19l4 2v-8.54z" /></>,
};

export function Icon(props: { name: IconName; size?: number; color?: string; style?: React.CSSProperties }): React.ReactElement {
  const s = props.size ?? 16;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={props.color ?? "currentColor"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", ...props.style }}>
      {PATHS[props.name]}
    </svg>
  );
}

export function Button(props: {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  disabled?: boolean;
  wide?: boolean;
  onClick?: () => void;
  title?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const cls = ["pbs-btn", props.variant ?? "primary", props.size === "sm" ? "sm" : "", props.wide ? "wide" : ""].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} disabled={props.disabled} onClick={props.onClick} title={props.title}>
      {props.children}
    </button>
  );
}

export function Badge(props: { tone: Tone; children: React.ReactNode; small?: boolean; title?: string }): React.ReactElement {
  return (
    <span className={`pbs-badge ${props.tone}${props.small ? " sm" : ""}`} title={props.title}>
      {props.children}
    </span>
  );
}

export function Pill(props: { tone: Tone; children: React.ReactNode }): React.ReactElement {
  return <span className={`pbs-pill ${props.tone}`}>{props.children}</span>;
}

export const TONE_DOT: Record<Tone, string> = {
  success: "#02C82B",
  info: "#0072FF",
  warning: "#FFCD00",
  danger: "#FF4646",
  neutral: "#B9BFC4",
};

export function Dot(props: { tone: Tone }): React.ReactElement {
  return <span className="pbs-dot" style={{ background: TONE_DOT[props.tone] }} aria-hidden="true" />;
}

export function SectionHeader(props: { label: string; right?: React.ReactNode }): React.ReactElement {
  return (
    <div className="pbs-sec">
      <span className="pbs-sec-l">{props.label}</span>
      {props.right !== undefined ? <span className="pbs-sec-r">{props.right}</span> : null}
    </div>
  );
}

export function ModuleHeader(props: { crumb?: React.ReactNode; title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }): React.ReactElement {
  return (
    <div className="pbs-mh">
      <div style={{ minWidth: 0 }}>
        {props.crumb ? <div className="pbs-crumb">{props.crumb}</div> : null}
        <h1 className="pbs-h1">{props.title}</h1>
        {props.subtitle ? <p className="pbs-sub">{props.subtitle}</p> : null}
      </div>
      {props.actions ? <div className="pbs-actions">{props.actions}</div> : null}
    </div>
  );
}

/**
 * Renders the canvas reply to the last action. Success disappears by itself after 4 s; an error
 * stays until dismissed and names the record, because a silent failure is how v1 lost writes
 * (ScreenPayroll.pa.yaml:4437 notified success unconditionally).
 */
export function ResultBanner(props: { result: (ActionResult & { action: string }) | null; onClose: () => void; okText?: string }): React.ReactElement | null {
  const { result, onClose } = props;
  React.useEffect(() => {
    if (result?.status === "ok") {
      const t = setTimeout(onClose, 4000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [result, onClose]);
  if (!result || result.status === "conflict") return null;
  const ok = result.status === "ok";
  return (
    <div className={`pbs-banner ${ok ? "ok" : "err"}`} role={ok ? "status" : "alert"}>
      <Icon name={ok ? "check" : "alert"} />
      <div className="grow">{result.message || (ok ? props.okText ?? "Tersimpan." : "Gagal menyimpan. Coba lagi.")}</div>
      <button type="button" className="pbs-x" onClick={onClose} aria-label="Tutup">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

export function InfoBanner(props: { tone?: "info" | "warn" | "err"; children: React.ReactNode; action?: React.ReactNode; icon?: IconName }): React.ReactElement {
  const tone = props.tone ?? "info";
  return (
    <div className={`pbs-banner ${tone}`} role={tone === "err" ? "alert" : "status"}>
      <Icon name={props.icon ?? (tone === "info" ? "info" : "alert")} color={tone === "info" ? "#0072FF" : undefined} />
      <div className="grow">{props.children}</div>
      {props.action}
    </div>
  );
}

export function Skeleton(props: { w?: number | string; h?: number; r?: number; style?: React.CSSProperties }): React.ReactElement {
  return <div className="pbs-sk" style={{ width: props.w ?? "100%", height: props.h ?? 12, borderRadius: props.r ?? 6, ...props.style }} />;
}

export function SkeletonRows(props: { rows: number; cols: number }): React.ReactElement {
  return (
    <>
      {Array.from({ length: props.rows }, (_, i) => (
        <tr key={i} aria-hidden="true">
          {Array.from({ length: props.cols }, (__, j) => (
            <td key={j}>
              <Skeleton w={j === 0 ? 56 : `${55 + ((i * 7 + j * 13) % 40)}%`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Empty state. `good` renders the mascot: an empty queue is good news, not an error. */
export function EmptyState(props: { good?: boolean; icon?: IconName; title: string; text?: React.ReactNode; action?: React.ReactNode }): React.ReactElement {
  return (
    <div className="pbs-empty">
      {props.good ? (
        <img src={MASCOT_CHEER} alt="" />
      ) : (
        <div className="ic">
          <Icon name={props.icon ?? "inbox"} size={22} />
        </div>
      )}
      <h3>{props.title}</h3>
      {props.text ? <p>{props.text}</p> : null}
      {props.action ? <div style={{ marginTop: 10 }}>{props.action}</div> : null}
    </div>
  );
}

export function EndOfData(props: { text: string }): React.ReactElement {
  return (
    <div className="pbs-foot" role="status">
      <span className="line" />
      <span>{props.text}</span>
      <span className="line" />
    </div>
  );
}

export function FilterSelect(props: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }): React.ReactElement {
  const on = props.value !== "";
  return (
    <label className={`pbs-chip${on ? " on" : ""}`}>
      <span className="pbs-sr">{props.label}</span>
      <select value={props.value} onChange={(e) => props.onChange(e.target.value)} aria-label={props.label}>
        <option value="">{props.label}</option>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={14} />
    </label>
  );
}

export function FilterDate(props: { label: string; value: string; onChange: (v: string) => void }): React.ReactElement {
  return (
    <label className={`pbs-chip${props.value ? " on" : ""}`} title={props.label}>
      <span className="pbs-sr">{props.label}</span>
      <input type="date" value={props.value} onChange={(e) => props.onChange(e.target.value)} aria-label={props.label} />
    </label>
  );
}

export function Spinner(props: { small?: boolean }): React.ReactElement {
  return <span className={`pbs-spin${props.small ? " sm" : ""}`} role="progressbar" aria-label="Memuat" />;
}
