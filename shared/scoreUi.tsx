import * as React from "react";
import { fmtNumber } from "./format";
import { ScoreBand } from "./host";
import { Icon, TONE_DOT } from "./ui";

/** The score bands as one bar with a marker at the score (HostDetail summary, host app Skor saya). */
export function BandChart(props: { bands: ScoreBand[]; score: number | null; min: number | null; max: number | null }): React.ReactElement | null {
  const { bands, score } = props;
  const lo = Math.min(...bands.map((b) => b.min ?? Infinity), props.min ?? Infinity, score ?? Infinity);
  let hi = Math.max(...bands.map((b) => b.max ?? -Infinity), props.max ?? -Infinity, score ?? -Infinity);
  if (bands.length === 0 || !Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  // An open-ended top band ("1001+") has no upper bound: make sure the bar shows a visible stretch of it.
  const open = bands.find((b) => b.max === null && b.min !== null);
  if (open && open.min !== null && Number.isFinite(lo)) hi = Math.max(hi, open.min + Math.max(1, (open.min - lo) * 0.25));
  const pos = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const width = (b: ScoreBand) => Math.max(1, (b.max ?? hi) - (b.min ?? lo));
  return (
    <div aria-hidden="true">
      <div className="pbs-bands">
        {bands.map((b) => (
          <span key={b.id} title={`${b.label}: ${fmtNumber(b.min)}–${fmtNumber(b.max)}`} style={{ flex: `${width(b)} 1 0`, background: TONE_DOT[b.tone] }} />
        ))}
        {score !== null ? <i style={{ left: `${Math.min(100, Math.max(0, pos(score)))}%` }} /> : null}
      </div>
      <div className="pbs-bands-l">
        {bands.map((b) => (
          <span key={b.id} style={{ flex: `${width(b)} 1 0`, textAlign: "center" }}>
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The evidence files of a score transaction as small links ("Bukti", "Bukti 2", …); canvas opens them (OPEN_EVIDENCE → Launch). */
export function EvidenceLinks(props: { urls: string[]; onOpen: (url: string) => void }): React.ReactElement | null {
  if (props.urls.length === 0) return null;
  return (
    <span className="pbs-ev">
      {props.urls.map((u, i) => (
        <button
          key={u}
          type="button"
          className="pbs-link"
          title={decodeName(u)}
          onClick={(e) => {
            e.stopPropagation();
            props.onOpen(u);
          }}
        >
          <Icon name="file" size={12} /> {props.urls.length > 1 ? `Bukti ${i + 1}` : "Lihat bukti"}
        </button>
      ))}
    </span>
  );
}

function decodeName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? url);
  } catch {
    return url;
  }
}
