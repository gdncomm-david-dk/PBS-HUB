import * as React from "react";
import { createRoot, Root } from "react-dom/client";
import { landscapeLocked } from "./device";
import { CSS, injectFonts } from "./styles";

/**
 * Shared plumbing for the three standard (non-virtual) React controls. React is bundled into each
 * control instead of using the platform library, because virtual React controls are not guaranteed
 * in canvas apps on this tenant (pbs-pcf-core plan, Task 1 spike).
 *
 * Every control has the same output: `ActionPayload`, a JSON string. Each emit carries a fresh
 * requestId, so the string always changes and canvas `OnChange` always fires.
 */
export class ReactHost {
  private root: Root | null = null;
  private container: HTMLDivElement | null = null;
  private payload = "";
  private upload = "";
  private notify: (() => void) | null = null;
  private last: [React.ReactElement, number, number] | null = null;
  private hintClosed = false;
  private readonly onViewport = (): void => {
    if (this.last) this.render(...this.last);
  };

  /** `rootClass` "hc" switches on the host-app layout (container queries on the control width). */
  constructor(private readonly rootClass = "") {}

  init(container: HTMLDivElement, notifyOutputChanged: () => void, trackResize: (v: boolean) => void): void {
    injectFonts();
    this.container = container;
    this.notify = notifyOutputChanged;
    trackResize(true);
    container.style.width = "100%";
    container.style.height = "100%";
    // Shadow DOM isolates the control from the player's global CSS (it overrode table width,
    // button borders, checkboxes and dl grids in canvas apps).
    let mount: HTMLElement = container;
    if (typeof container.attachShadow === "function") {
      const shadow = container.shadowRoot ?? container.attachShadow({ mode: "open" });
      shadow.innerHTML = "";
      const style = document.createElement("style");
      style.textContent = CSS;
      mount = document.createElement("div");
      mount.style.width = "100%";
      mount.style.height = "100%";
      shadow.append(style, mount);
    }
    this.root = createRoot(mount);
    // Rotating a phone does not always resize a canvas app (orientation locked), so the
    // landscape hint follows the browser viewport too.
    if (this.rootClass === "hc" && typeof window !== "undefined") {
      window.addEventListener("resize", this.onViewport);
      window.addEventListener("orientationchange", this.onViewport);
    }
  }

  readonly emit = (json: string): void => {
    this.payload = json;
    this.notify?.();
  };

  /**
   * A file travels on its own `Multiple` output (UploadData) next to the ActionPayload that names it,
   * so the action JSON stays small. Both change in the same notifyOutputChanged.
   */
  readonly emitWithUpload = (json: string, data: string): void => {
    this.upload = data;
    this.emit(json);
  };

  render(element: React.ReactElement, width: number, height: number): void {
    if (!this.root) return;
    this.last = [element, width, height];
    const style: React.CSSProperties = {};
    if (width > 0) style.width = width;
    if (height > 0) style.height = height;
    this.root.render(
      <div className={this.rootClass ? `pbs-root ${this.rootClass}` : "pbs-root"} style={style}>
        {this.showHint(width, height) && <LandscapeHint onClose={this.closeHint} />}
        <ErrorBoundary>{element}</ErrorBoundary>
      </div>,
    );
  }

  private showHint(width: number, height: number): boolean {
    if (this.rootClass !== "hc" || this.hintClosed || typeof window === "undefined") return false;
    const touch = typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints ?? 0;
    // The physical screen, not innerWidth: a page without a viewport meta reports a wide layout viewport.
    const sw = window.screen?.width ?? window.innerWidth;
    const sh = window.screen?.height ?? window.innerHeight;
    const type = window.screen?.orientation?.type ?? "";
    const upright = type ? type.startsWith("portrait") : sh > sw;
    const short = Math.min(sw, sh);
    const view = upright ? { width: short, height: Math.max(sw, sh) } : { width: Math.max(sw, sh), height: short };
    return landscapeLocked({ width, height }, view, touch);
  }

  private readonly closeHint = (): void => {
    this.hintClosed = true;
    this.onViewport();
  };

  get output(): string {
    return this.payload;
  }

  get uploadData(): string {
    return this.upload;
  }

  destroy(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this.onViewport);
      window.removeEventListener("orientationchange", this.onViewport);
    }
    this.root?.unmount();
    this.root = null;
    this.container = null;
  }
}

/** Shown on a phone held upright while the canvas app is still landscape (see `landscapeLocked`). */
function LandscapeHint({ onClose }: { onClose: () => void }) {
  return (
    <div className="pbs-banner warn hc-orient" role="status">
      <div className="grow">
        <b>Tampilan masih landscape.</b> Supaya otomatis portrait di HP, admin app perlu ubah di Power Apps Studio:
        Settings → Display → <b>Scale to fit</b> Off, <b>Lock aspect ratio</b> Off, <b>Lock orientation</b> Off, lalu
        Save &amp; Publish.
      </div>
      <button type="button" className="pbs-btn ghost sm" onClick={onClose}>
        Tutup
      </button>
    </div>
  );
}

/** A rendering bug must show a readable message in Studio, not a blank rectangle. */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="pbs-page">
          <div className="pbs-banner err" role="alert">
            <div className="grow">
              Komponen gagal ditampilkan: <span className="pbs-mono">{this.state.error}</span>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Reads a TwoOptions property that canvas may leave unset. */
export function flag(p: { raw: boolean | null } | undefined): boolean {
  return !!p?.raw;
}

/** "Admin" unless canvas explicitly asked for read-only. */
export function modeOf(p: { raw: string | null } | undefined): "Admin" | "ReadOnly" {
  return p?.raw === "ReadOnly" ? "ReadOnly" : "Admin";
}

export function referenceNow(raw: string | null | undefined): Date {
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}
