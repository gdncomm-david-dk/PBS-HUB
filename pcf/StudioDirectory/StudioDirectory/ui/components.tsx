import * as React from "react";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "primary";

export const cx = (...xs: (string | false | null | undefined)[]): string => xs.filter(Boolean).join(" ");

// ---------------------------------------------------------------------------------------------
// Icons — inline SVG, 16px, stroke currentColor.

const I = (d: React.ReactNode, size = 16): React.ReactElement => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {d}
    </svg>
);

export const Icon = {
    check: (s?: number) => I(<polyline points="20 6 9 17 4 12" />, s),
    warn: (s?: number) =>
        I(
            <>
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
            </>,
            s,
        ),
    alert: (s?: number) =>
        I(
            <>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
            </>,
            s,
        ),
    info: (s?: number) =>
        I(
            <>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
            </>,
            s,
        ),
    pin: (s?: number) =>
        I(
            <>
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
            </>,
            s,
        ),
    left: (s?: number) => I(<polyline points="15 18 9 12 15 6" />, s),
    right: (s?: number) => I(<polyline points="9 18 15 12 9 6" />, s),
    plus: (s?: number) =>
        I(
            <>
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
            </>,
            s,
        ),
    minus: (s?: number) => I(<line x1="5" y1="12" x2="19" y2="12" />, s),
    edit: (s?: number) =>
        I(
            <>
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
            </>,
            s,
        ),
    locate: (s?: number) =>
        I(
            <>
                <circle cx="12" cy="12" r="7" />
                <circle cx="12" cy="12" r="2" />
                <line x1="12" y1="1" x2="12" y2="4" />
                <line x1="12" y1="20" x2="12" y2="23" />
                <line x1="1" y1="12" x2="4" y2="12" />
                <line x1="20" y1="12" x2="23" y2="12" />
            </>,
            s,
        ),
    search: (s?: number) =>
        I(
            <>
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </>,
            s,
        ),
    close: (s?: number) =>
        I(
            <>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
            </>,
            s,
        ),
    studio: (s?: number) =>
        I(
            <>
                <rect x="2" y="6" width="14" height="12" rx="2" />
                <polygon points="22 8 16 12 22 16 22 8" />
            </>,
            s,
        ),
};

// ---------------------------------------------------------------------------------------------

export function Badge(props: { tone: Tone; children: React.ReactNode; title?: string }): React.ReactElement {
    return (
        <span className={cx("sd-badge", `sd-badge--${props.tone}`)} title={props.title}>
            {props.children}
        </span>
    );
}

export function Pill(props: { tone: Tone; children: React.ReactNode }): React.ReactElement {
    return <span className={cx("sd-pill", `sd-pill--${props.tone}`)}>{props.children}</span>;
}

export function Button(
    props: {
        variant?: "primary" | "secondary" | "ghost";
        size?: "sm" | "md";
        icon?: React.ReactNode;
        children?: React.ReactNode;
    } & React.ButtonHTMLAttributes<HTMLButtonElement>,
): React.ReactElement {
    const { variant = "secondary", size = "md", icon, children, className, ...rest } = props;
    return (
        <button type="button" className={cx("sd-btn", `sd-btn--${variant}`, `sd-btn--${size}`, className)} {...rest}>
            {icon}
            {children !== undefined && <span>{children}</span>}
        </button>
    );
}

export function Card(props: { className?: string; children: React.ReactNode; title?: React.ReactNode; aside?: React.ReactNode }): React.ReactElement {
    return (
        <section className={cx("sd-card", props.className)}>
            {(props.title || props.aside) && (
                <header className="sd-card__head">
                    <h3 className="sd-card__title">{props.title}</h3>
                    {props.aside && <div className="sd-card__aside">{props.aside}</div>}
                </header>
            )}
            {props.children}
        </section>
    );
}

/** Utilization tone: under-used amber, healthy green, near/over capacity red. */
export function utilTone(r: number | null): Tone {
    if (r === null) return "neutral";
    if (r >= 0.9) return "danger";
    if (r < 0.4) return "warning";
    return "success";
}

export function Bar(props: { ratio: number | null; tone?: Tone; height?: number }): React.ReactElement {
    const r = props.ratio ?? 0;
    const tone = props.tone ?? utilTone(props.ratio);
    return (
        <div className="sd-bar" style={{ height: props.height ?? 5 }} role="presentation">
            <div className={cx("sd-bar__fill", `sd-bar__fill--${tone}`)} style={{ width: `${Math.min(100, Math.max(0, r * 100))}%` }} />
        </div>
    );
}

export function Banner(props: { tone: "warning" | "danger" | "info" | "success" | "neutral"; children: React.ReactNode; action?: React.ReactNode; onClose?: () => void }): React.ReactElement {
    const icon = props.tone === "danger" ? Icon.alert() : props.tone === "warning" ? Icon.warn() : props.tone === "success" ? Icon.check() : Icon.info();
    return (
        <div className={cx("sd-banner", `sd-banner--${props.tone}`)} role={props.tone === "danger" ? "alert" : "status"}>
            <span className="sd-banner__icon">{icon}</span>
            <div className="sd-banner__body">{props.children}</div>
            {props.action}
            {props.onClose && (
                <button type="button" className="sd-iconbtn" onClick={props.onClose} aria-label="Tutup">
                    {Icon.close(14)}
                </button>
            )}
        </div>
    );
}

export function Field(props: { label: string; hint?: React.ReactNode; hintTone?: "warning" | "danger"; children: React.ReactNode; htmlFor?: string }): React.ReactElement {
    return (
        <div className="sd-field">
            <label className="sd-field__label" htmlFor={props.htmlFor}>
                {props.label}
            </label>
            {props.children}
            {props.hint && <div className={cx("sd-field__hint", props.hintTone && `sd-field__hint--${props.hintTone}`)}>{props.hint}</div>}
        </div>
    );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; description?: string }): React.ReactElement {
    return (
        <label className={cx("sd-toggle", props.disabled && "is-disabled")}>
            <span className="sd-toggle__text">
                <span className="sd-toggle__label">{props.label}</span>
                {props.description && <span className="sd-toggle__desc">{props.description}</span>}
            </span>
            <input type="checkbox" role="switch" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
            <span className="sd-toggle__track" aria-hidden="true">
                <span className="sd-toggle__thumb" />
            </span>
        </label>
    );
}

export function Modal(props: { title: string; width?: number; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }): React.ReactElement {
    React.useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === "Escape") props.onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [props.onClose]);
    return (
        <div className="sd-modal" role="dialog" aria-modal="true" aria-label={props.title}>
            <div className="sd-modal__scrim" onClick={props.onClose} />
            <div className="sd-modal__panel" style={{ width: props.width ?? 560 }}>
                <header className="sd-modal__head">
                    <h2>{props.title}</h2>
                    <button type="button" className="sd-iconbtn" onClick={props.onClose} aria-label="Tutup">
                        {Icon.close()}
                    </button>
                </header>
                <div className="sd-modal__body">{props.children}</div>
                <footer className="sd-modal__foot">{props.footer}</footer>
            </div>
        </div>
    );
}

export function SkeletonRows(props: { rows: number; cols: number }): React.ReactElement {
    return (
        <>
            {Array.from({ length: props.rows }).map((_, i) => (
                <tr key={i} className="sd-skel-row" aria-hidden="true">
                    {Array.from({ length: props.cols }).map((__, j) => (
                        <td key={j}>
                            <span className="sd-skel" style={{ width: `${40 + ((i * 7 + j * 13) % 50)}%` }} />
                        </td>
                    ))}
                </tr>
            ))}
        </>
    );
}

/** Daily utilization bar chart. Bars are buttons when `onPick` is given. */
export function DailyChart(props: {
    points: { dateKey: string; ratio: number | null; label: string }[];
    todayKey: string;
    selectedKey?: string;
    onPick?: (dateKey: string) => void;
}): React.ReactElement {
    const max = Math.max(1, ...props.points.map((p) => p.ratio ?? 0));
    return (
        <div className="sd-chart">
            <div className="sd-chart__plot">
                <div className="sd-chart__grid" aria-hidden="true">
                    <span style={{ bottom: `${(1 / max) * 100}%` }} data-label="100%" />
                    <span style={{ bottom: `${(0.5 / max) * 100}%` }} data-label="50%" />
                </div>
                {props.points.map((p) => {
                    const h = ((p.ratio ?? 0) / max) * 100;
                    const day = Number(p.dateKey.slice(8));
                    const cls = cx(
                        "sd-chart__col",
                        p.dateKey === props.todayKey && "is-today",
                        p.dateKey === props.selectedKey && "is-selected",
                        p.dateKey > props.todayKey && "is-future",
                    );
                    const inner = (
                        <>
                            <span className="sd-chart__bar-wrap">
                                <span className={cx("sd-chart__bar", `sd-chart__bar--${utilTone(p.ratio)}`)} style={{ height: `${h}%` }} />
                            </span>
                            <span className="sd-chart__x">{day === 1 || day % 5 === 0 || p.dateKey === props.todayKey ? day : ""}</span>
                        </>
                    );
                    return props.onPick ? (
                        <button type="button" key={p.dateKey} className={cls} title={p.label} onClick={() => props.onPick?.(p.dateKey)}>
                            {inner}
                        </button>
                    ) : (
                        <div key={p.dateKey} className={cls} title={p.label}>
                            {inner}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
