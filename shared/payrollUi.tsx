import * as React from "react";
import { fmtDateTimeShort } from "./format";
import { Gate, GateState } from "./payroll";
import { Badge, Icon } from "./ui";

const GATE_WORD: Record<GateState, string> = {
  done: "disetujui",
  active: "menunggu",
  pending: "belum mulai",
  rejected: "ditolak",
  skipped: "dibatalkan",
};

/** The four approval dots on the runs list: PBS internal · HC · Head of PBS · FAS. */
export function GateDots(props: { gates: Gate[] }): React.ReactElement {
  const four = props.gates.filter((g) => g.key !== "FINANCE");
  const label = four.map((g) => `${g.label}: ${GATE_WORD[g.state]}`).join(", ");
  return (
    <span className="pbs-gdots" role="img" aria-label={label} title={label}>
      {four.map((g) => (
        <span key={g.key} className={`pbs-gdot ${g.state}`} />
      ))}
    </span>
  );
}

function Circle(props: { state: GateState; n: number; inline?: boolean }): React.ReactElement {
  const icon = props.state === "done" ? <Icon name="check" size={14} /> : props.state === "rejected" ? <Icon name="x" size={14} /> : props.n;
  return (
    <span className={`pbs-tl-c ${props.state}${props.inline ? " inl" : ""}`} aria-hidden="true">
      {icon}
    </span>
  );
}

function GateBody(props: { gate: Gate; financeNote?: boolean }): React.ReactElement {
  const g = props.gate;
  const tone = g.state === "done" ? "success" : g.state === "rejected" ? "danger" : g.state === "active" ? "info" : "neutral";
  const word = props.financeNote && g.state === "done" ? "terkirim ke Finance" : GATE_WORD[g.state];
  return (
    <div style={{ minWidth: 0 }}>
      <div className="pbs-tl-t">
        {g.label}
        <Badge tone={tone} small>
          {word}
        </Badge>
      </div>
      <div className="pbs-tl-m">
        {g.approver ? g.approver : g.state === "done" || g.state === "rejected" ? "Penyetuju tidak tercatat" : g.state === "active" ? "Kartu approval sudah dikirim" : "—"}
        {g.at ? ` · ${fmtDateTimeShort(g.at)}` : ""}
      </div>
      {g.comment ? <blockquote className="pbs-quote">“{g.comment}”</blockquote> : null}
    </div>
  );
}

/**
 * P-4 vertical timeline. Head of PBS and FAS are parallel gates: drawn as two cards on one step,
 * rejoining before Finance. After a rejection every open step is greyed (the flow terminated).
 */
export function ApprovalTimeline(props: { gates: Gate[] }): React.ReactElement {
  const by = Object.fromEntries(props.gates.map((g) => [g.key, g])) as Record<Gate["key"], Gate>;
  const head = by.HEAD_PBS;
  const fas = by.FAS;
  const parState: GateState =
    head.state === "rejected" || fas.state === "rejected"
      ? "rejected"
      : head.state === "done" && fas.state === "done"
        ? "done"
        : head.state === "active" || fas.state === "active" || head.state === "done" || fas.state === "done"
          ? "active"
          : head.state === "skipped" && fas.state === "skipped"
            ? "skipped"
            : "pending";
  const row = (g: Gate, n: number) => (
    <li key={g.key} className={`${g.state}${g.state === "skipped" || g.state === "pending" ? " skipped-row" : ""}`}>
      <Circle state={g.state} n={n} />
      <GateBody gate={g} financeNote={g.key === "FINANCE"} />
    </li>
  );
  return (
    <ol className="pbs-tl" aria-label="Tahapan approval payroll">
      {row(by.PBS_INTERNAL, 1)}
      {row(by.HC, 2)}
      <li className={`${parState}${parState === "skipped" || parState === "pending" ? " skipped-row" : ""}`}>
        <Circle state={parState} n={3} />
        <div className="pbs-tl-t">
          Head of PBS ∥ FAS <span className="pbs-tl-m">paralel: keduanya harus setuju</span>
        </div>
        <div className="pbs-tl-par">
          {[head, fas].map((g) => (
            <div key={g.key} className={`pbs-tl-card${g.state === "skipped" ? " skipped-row" : ""}`}>
              <Circle state={g.state} n={g.key === "HEAD_PBS" ? 3 : 4} inline />
              <GateBody gate={g} />
            </div>
          ))}
        </div>
      </li>
      {row(by.FINANCE, 5)}
    </ol>
  );
}
