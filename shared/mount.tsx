import * as React from "react";
import { createRoot, Root } from "react-dom/client";
import { injectStyles } from "./styles";

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
  private notify: (() => void) | null = null;

  init(container: HTMLDivElement, notifyOutputChanged: () => void, trackResize: (v: boolean) => void): void {
    injectStyles();
    this.container = container;
    this.notify = notifyOutputChanged;
    trackResize(true);
    container.style.width = "100%";
    container.style.height = "100%";
    this.root = createRoot(container);
  }

  readonly emit = (json: string): void => {
    this.payload = json;
    this.notify?.();
  };

  render(element: React.ReactElement, width: number, height: number): void {
    if (!this.root) return;
    const style: React.CSSProperties = {};
    if (width > 0) style.width = width;
    if (height > 0) style.height = height;
    this.root.render(
      <div className="pbs-root" style={style}>
        <ErrorBoundary>{element}</ErrorBoundary>
      </div>,
    );
  }

  get output(): string {
    return this.payload;
  }

  destroy(): void {
    this.root?.unmount();
    this.root = null;
    this.container = null;
  }
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
