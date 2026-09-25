import * as React from "react";
import { ModuleContext, UseActionResult, configNumber } from "../../../shared/contract";
import { Row, date, person, str } from "../../../shared/data";
import { fmtAgo } from "../../../shared/format";
import { REASONS, reviewBadge } from "../../../shared/reconcile";
import { ReportItem, buildReportItems, itemRef } from "../../../shared/reportItems";
import { DECISION_ACTIONS, DECISION_DONE_TEXT, DecisionPanel, EvidenceRail, MetricsTable, ReportHeader } from "../../../shared/reportUi";
import { Button, Icon, InfoBanner, Pill, ResultBanner, Skeleton } from "../../../shared/ui";

export interface ReportDetailProps {
  ctx: ModuleContext;
  reports: Row[];
  evidence: Row[];
  brands: Row[];
  hosts: Row[];
  schedules: Row[];
  readOnly: boolean;
  loading: boolean;
  now: Date;
  action: UseActionResult;
}

export function ReportDetailView(props: ReportDetailProps): React.ReactElement {
  const { ctx, action } = props;
  const tolerancePct = configNumber(ctx, "tolerancePct", 5);
  const confidenceThreshold = configNumber(ctx, "confidenceThreshold", 0.85);
  const opts = React.useMemo(() => ({ tolerancePct, confidenceThreshold }), [tolerancePct, confidenceThreshold]);
  const item: ReportItem | undefined = React.useMemo(
    () => buildReportItems(props.reports.slice(0, 1), props.evidence, props.brands, props.hosts, opts, props.schedules)[0],
    [props.reports, props.evidence, props.brands, props.hosts, opts, props.schedules],
  );

  if (props.loading && !item) return <LoadingDetail />;
  if (!item) {
    return (
      <div className="pbs-page">
        <BackLink onBack={() => action.fire("BACK", {})} />
        <InfoBanner tone="warn">Report tidak ditemukan. Mungkin sudah dihapus, atau properti ReportJson belum diisi.</InfoBanner>
      </div>
    );
  }
  return <Detail key={item.id || item.title} {...props} item={item} tolerancePct={tolerancePct} />;
}

function BackLink(props: { onBack: () => void }): React.ReactElement {
  return (
    <div className="pbs-crumb" style={{ marginBottom: 12 }}>
      <button type="button" onClick={props.onBack} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="arrowLeft" size={14} /> Antrean rekonsiliasi
      </button>
    </div>
  );
}

function Detail(props: ReportDetailProps & { item: ReportItem; tolerancePct: number }): React.ReactElement {
  const { ctx, now, action, item, tolerancePct } = props;
  const report = item.row;
  const last = action.lastResult;
  const decidedByMe = !!last && last.status === "ok" && DECISION_ACTIONS.includes(last.action);
  const conflict = last?.status === "conflict" ? last : null;

  const approver = person(report, "Approver");
  const approverEmail = str(report, "ApproverEmail") || approver.email;
  const approverName = approver.name || approverEmail;
  const modified = date(report, "Modified");
  const mine = !!approverEmail && !!ctx.userEmail && approverEmail.toLowerCase() === ctx.userEmail.toLowerCase();
  const decidedElsewhere = item.state !== "WAITING" && !decidedByMe && !mine;
  const reason = REASONS[item.rec.reason];

  const headerPill = decidedByMe ? (
    <Pill tone="success">Keputusan tersimpan</Pill>
  ) : item.state === "WAITING" ? (
    <Pill tone={reason.tone}>{reason.label}</Pill>
  ) : (
    <Pill tone={reviewBadge(item.row, item.state).tone}>{reviewBadge(item.row, item.state).label}</Pill>
  );

  return (
    <div className="pbs-page">
      <BackLink onBack={() => action.fire("BACK", {})} />

      {conflict || decidedElsewhere ? (
        <InfoBanner
          action={
            <Button variant="secondary" onClick={() => action.fire("RELOAD", itemRef(item))}>
              Muat ulang
            </Button>
          }
        >
          {conflict
            ? `Report ini sudah diputuskan oleh ${conflict.decidedBy || "orang lain"}${conflict.decidedAt ? ` ${fmtAgo(new Date(conflict.decidedAt), now)}` : ""}. Keputusanmu tidak disimpan.`
            : item.state === "DONE_AUTO"
              ? `Report ini sudah diputuskan otomatis oleh flow rekonsiliasi ${fmtAgo(modified, now)}.`
              : `Report ini sudah diputuskan oleh ${approverName || "orang lain"} ${fmtAgo(modified, now)}.`}
        </InfoBanner>
      ) : null}

      <ResultBanner result={conflict ? null : last} okText={last ? DECISION_DONE_TEXT[last.action] : undefined} onClose={action.clearResult} />

      <ReportHeader item={item} pill={headerPill} onOpenLink={(url) => action.fire("OPEN_EVIDENCE", { url, reportId: item.id, title: item.title })} />

      <div className="pbs-rv">
        <div style={{ minWidth: 0, display: "grid", gap: 16 }}>
          <MetricsTable item={item} tolerancePct={tolerancePct} />
          <DecisionPanel item={item} ctx={ctx} action={action} readOnly={props.readOnly} tolerancePct={tolerancePct} now={now} />
        </div>
        <EvidenceRail item={item} ctx={ctx} onOpen={(url) => action.fire("OPEN_EVIDENCE", { url, reportId: item.id, title: item.title })} />
      </div>
    </div>
  );
}

function LoadingDetail(): React.ReactElement {
  return (
    <div className="pbs-page" aria-busy="true">
      <div className="pbs-card" style={{ padding: 20, display: "flex", gap: 24, marginBottom: 16 }}>
        {[120, 90, 80, 110, 140].map((w, i) => (
          <div key={i}>
            <Skeleton w={w / 2} h={10} />
            <Skeleton w={w} h={16} style={{ marginTop: 8 }} />
          </div>
        ))}
      </div>
      <div className="pbs-rv">
        <div className="pbs-card pbs-card-pad">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} style={{ display: "flex", gap: 16, marginBottom: 16 }}>
              <Skeleton w="30%" />
              <Skeleton w="20%" />
              <Skeleton w="20%" />
              <Skeleton w="20%" />
            </div>
          ))}
        </div>
        <div className="pbs-card pbs-card-pad">
          <Skeleton h={200} r={8} />
          <Skeleton w="70%" style={{ marginTop: 14 }} />
          <Skeleton w="50%" style={{ marginTop: 10 }} />
        </div>
      </div>
    </div>
  );
}
