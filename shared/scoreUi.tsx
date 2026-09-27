import * as React from "react";
import { fmtNumber } from "./format";
import { ScoreBand } from "./host";
import { TONE_DOT } from "./ui";

/** The score bands as one bar with a marker at the score (HostDetail summary, host app Skor saya). */
export function BandChart(props: { bands: ScoreBand[]; score: number | null; min: number | null; max: number | null }): React.ReactElement | null {
  const { bands, score } = props;
  const lo = Math.min(...bands.map((b) => b.min ?? Infinity), props.min ?? Infinity, score ?? Infinity);
  const hi = Math.max(...bands.map((b) => b.max ?? -Infinity), props.max ?? -Infinity, score ?? -Infinity);
  if (bands.length === 0 || !Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  const pos = (v: number) => ((v - lo) / (hi - lo)) * 100;
  return (
    <div aria-hidden="true">
      <div className="pbs-bands">
        {bands.map((b) => (
          <span key={b.id} title={`${b.label}: ${fmtNumber(b.min)}–${fmtNumber(b.max)}`} style={{ flex: `${Math.max(1, (b.max ?? hi) - (b.min ?? lo))} 1 0`, background: TONE_DOT[b.tone] }} />
        ))}
        {score !== null ? <i style={{ left: `${Math.min(100, Math.max(0, pos(score)))}%` }} /> : null}
      </div>
      <div className="pbs-bands-l">
        {bands.map((b) => (
          <span key={b.id} style={{ flex: `${Math.max(1, (b.max ?? hi) - (b.min ?? lo))} 1 0`, textAlign: "center" }}>
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}
