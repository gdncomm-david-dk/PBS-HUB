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
    calendar: (s?: number) =>
        I(
            <>
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
            </>,
            s,
        ),
    list: (s?: number) =>
        I(
            <>
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
            </>,
            s,
        ),
    refresh: (s?: number) => I(<><polyline points="23 4 23 10 17 10" /><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10" /></>, s),
    upload: (s?: number) =>
        I(
            <>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
            </>,
            s,
        ),
    download: (s?: number) =>
        I(
            <>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
            </>,
            s,
        ),
    sparkle: (s?: number) => I(<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />, s),
    lock: (s?: number) =>
        I(
            <>
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </>,
            s,
        ),
    trash: (s?: number) =>
        I(
            <>
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </>,
            s,
        ),
    more: (s?: number) =>
        I(
            <>
                <circle cx="12" cy="5" r="1" />
                <circle cx="12" cy="12" r="1" />
                <circle cx="12" cy="19" r="1" />
            </>,
            s,
        ),
    file: (s?: number) =>
        I(
            <>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
            </>,
            s,
        ),
    bell: (s?: number) =>
        I(
            <>
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.7 21a2 2 0 0 1-3.4 0" />
            </>,
            s,
        ),
    eye: (s?: number) =>
        I(
            <>
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
            </>,
            s,
        ),
};

// ---------------------------------------------------------------------------------------------

export function Badge(props: { tone: Tone; children: React.ReactNode; title?: string }): React.ReactElement {
    return (
        <span className={cx("sc-badge", `sc-badge--${props.tone}`)} title={props.title}>
            {props.children}
        </span>
    );
}

export function Pill(props: { tone: Tone; children: React.ReactNode }): React.ReactElement {
    return <span className={cx("sc-pill", `sc-pill--${props.tone}`)}>{props.children}</span>;
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
        <button type="button" className={cx("sc-btn", `sc-btn--${variant}`, `sc-btn--${size}`, className)} {...rest}>
            {icon}
            {children !== undefined && <span>{children}</span>}
        </button>
    );
}

export function Card(props: { className?: string; children: React.ReactNode; title?: React.ReactNode; aside?: React.ReactNode }): React.ReactElement {
    return (
        <section className={cx("sc-card", props.className)}>
            {(props.title || props.aside) && (
                <header className="sc-card__head">
                    <h3 className="sc-card__title">{props.title}</h3>
                    {props.aside && <div className="sc-card__aside">{props.aside}</div>}
                </header>
            )}
            {props.children}
        </section>
    );
}


export function Bar(props: { ratio: number | null; tone?: Tone; height?: number }): React.ReactElement {
    const r = props.ratio ?? 0;
    const tone = props.tone ?? "primary";
    return (
        <div className="sc-bar" style={{ height: props.height ?? 5 }} role="presentation">
            <div className={cx("sc-bar__fill", `sc-bar__fill--${tone}`)} style={{ width: `${Math.min(100, Math.max(0, r * 100))}%` }} />
        </div>
    );
}

export function Banner(props: { tone: "warning" | "danger" | "info" | "success" | "neutral"; children: React.ReactNode; action?: React.ReactNode; onClose?: () => void }): React.ReactElement {
    const icon = props.tone === "danger" ? Icon.alert() : props.tone === "warning" ? Icon.warn() : props.tone === "success" ? Icon.check() : Icon.info();
    return (
        <div className={cx("sc-banner", `sc-banner--${props.tone}`)} role={props.tone === "danger" ? "alert" : "status"}>
            <span className="sc-banner__icon">{icon}</span>
            <div className="sc-banner__body">{props.children}</div>
            {props.action}
            {props.onClose && (
                <button type="button" className="sc-iconbtn" onClick={props.onClose} aria-label="Tutup">
                    {Icon.close(14)}
                </button>
            )}
        </div>
    );
}

export function Field(props: { label: string; hint?: React.ReactNode; hintTone?: "warning" | "danger"; children: React.ReactNode; htmlFor?: string }): React.ReactElement {
    return (
        <div className="sc-field">
            <label className="sc-field__label" htmlFor={props.htmlFor}>
                {props.label}
            </label>
            {props.children}
            {props.hint && <div className={cx("sc-field__hint", props.hintTone && `sc-field__hint--${props.hintTone}`)}>{props.hint}</div>}
        </div>
    );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; description?: string }): React.ReactElement {
    return (
        <label className={cx("sc-toggle", props.disabled && "is-disabled")}>
            <span className="sc-toggle__text">
                <span className="sc-toggle__label">{props.label}</span>
                {props.description && <span className="sc-toggle__desc">{props.description}</span>}
            </span>
            <input type="checkbox" role="switch" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
            <span className="sc-toggle__track" aria-hidden="true">
                <span className="sc-toggle__thumb" />
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
        <div className="sc-modal" role="dialog" aria-modal="true" aria-label={props.title}>
            <div className="sc-modal__scrim" onClick={props.onClose} />
            <div className="sc-modal__panel" style={{ width: props.width ?? 560 }}>
                <header className="sc-modal__head">
                    <h2>{props.title}</h2>
                    <button type="button" className="sc-iconbtn" onClick={props.onClose} aria-label="Tutup">
                        {Icon.close()}
                    </button>
                </header>
                <div className="sc-modal__body">{props.children}</div>
                <footer className="sc-modal__foot">{props.footer}</footer>
            </div>
        </div>
    );
}

export function SkeletonRows(props: { rows: number; cols: number }): React.ReactElement {
    return (
        <>
            {Array.from({ length: props.rows }).map((_, i) => (
                <tr key={i} className="sc-skel-row" aria-hidden="true">
                    {Array.from({ length: props.cols }).map((__, j) => (
                        <td key={j}>
                            <span className="sc-skel" style={{ width: `${40 + ((i * 7 + j * 13) % 50)}%` }} />
                        </td>
                    ))}
                </tr>
            ))}
        </>
    );
}

