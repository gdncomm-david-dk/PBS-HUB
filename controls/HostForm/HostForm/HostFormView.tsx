import * as React from "react";
import { ModuleContext, UseActionResult, hasPermission, permissionHint } from "../../../shared/contract";
import { Row } from "../../../shared/data";
import { PII_LABEL, PII_ORDER, PiiField } from "../../../shared/host";
import {
  HostDraft,
  HostFormModel,
  HostRef,
  buildHostForm,
  changedFields,
  hostIssues,
  packageOptions,
  parseHostRefs,
  piiIssue,
  saveHostPayload,
} from "../../../shared/hostForm";
import { BackButton, Button, InfoBanner, ModuleHeader, ResultBanner, SkeletonRows, Spinner } from "../../../shared/ui";

export interface HostFormProps {
  ctx: ModuleContext;
  host: Row[];
  hosts: Row[];
  packages: Row[];
  loading: boolean;
  action: UseActionResult;
}

export function HostFormView(props: HostFormProps): React.ReactElement {
  const hosts = React.useMemo(() => parseHostRefs(props.hosts), [props.hosts]);
  const model = React.useMemo(() => buildHostForm(props.host, hosts, new Date()), [props.host, hosts]);
  if (props.loading && props.host.length === 0 && props.hosts.length === 0) {
    return (
      <div className="pbs-page pbs-hf">
        <ModuleHeader crumb="Host" title="Host" subtitle="Memuat…" />
        <div className="pbs-card pbs-card-pad">
          <SkeletonRows rows={6} cols={2} />
        </div>
      </div>
    );
  }
  // A different host (or add after edit) starts a fresh draft.
  return <HostFormBody key={model.edit ? `e:${model.edit.id || model.edit.hostId}` : "new"} {...props} hosts={props.hosts} refs={hosts} model={model} />;
}

const PII_HINT: Record<PiiField, string> = {
  KTP: "16 angka",
  NoRekening: "angka saja",
  NamaRekening: "sesuai buku tabungan",
  Alamat: "alamat lengkap",
  PhoneNumber: "mis. 0812… atau +62812…",
  PersonalEmail: "email pribadi (bukan email kerja)",
};

function HostFormBody(props: HostFormProps & { refs: HostRef[]; model: HostFormModel }): React.ReactElement {
  const { ctx, action, model } = props;
  const canEdit = hasPermission(ctx, "HOST_EDIT");
  const canPii = hasPermission(ctx, "HOST_PII_VIEW");
  const [d, setD] = React.useState<HostDraft>(model.draft);
  const [touched, setTouched] = React.useState(false);
  const set = (patch: Partial<HostDraft>) => setD((x) => ({ ...x, ...patch }));
  const setPii = (f: PiiField, v: string | undefined) =>
    setD((x) => {
      const pii = { ...x.pii };
      if (v === undefined) delete pii[f];
      else pii[f] = v;
      return { ...x, pii };
    });
  const packages = packageOptions(props.packages, ctx.config, d.pkg);
  const issues = hostIssues(d, props.refs, model, packages);
  const changed = model.edit ? changedFields(d, model) : ["new"];
  const pending = action.pending?.action === "SAVE_HOST";
  const locked = pending || !canEdit;
  const edit = model.edit;

  const submit = () => {
    setTouched(true);
    if (issues.length || pending || !canEdit || changed.length === 0) return;
    action.dispatch("SAVE_HOST", saveHostPayload(d, model, canPii));
  };
  const cancel = () => action.fire("CANCEL", { hostId: edit?.hostId ?? "" });

  const field = (
    id: string,
    label: string,
    input: React.ReactNode,
    hint?: React.ReactNode,
  ): React.ReactElement => (
    <div className="pbs-field">
      <label className="pbs-label" htmlFor={id}>
        {label}
      </label>
      {input}
      {hint ? <div className="pbs-sc-hint">{hint}</div> : null}
    </div>
  );
  const text = (id: string, value: string, onChange: (v: string) => void, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      id={id}
      className="pbs-sc-input"
      value={value}
      disabled={locked || extra.disabled}
      onChange={(e) => onChange(e.target.value)}
      autoComplete="off"
      {...extra}
    />
  );

  const saveError =
    action.lastResult && action.lastResult.action === "SAVE_HOST" && action.lastResult.status !== "ok" ? action.lastResult : null;

  return (
    <div className="pbs-page pbs-hf">
      <BackButton onClick={cancel} crumb={edit ? `Host / ${edit.hostId}` : "Host / Tambah host"} />
      <ModuleHeader
        title={edit ? `Edit ${edit.name || edit.hostId}` : "Tambah Host"}
        subtitle={edit ? `${edit.hostId} · Host ID tidak bisa diubah` : "Host baru langsung berstatus Active."}
      />
      <ResultBanner result={saveError ? null : action.lastResult} onClose={action.clearResult} />
      {!canEdit ? (
        <InfoBanner>
          Kamu hanya bisa melihat. Menyimpan host butuh izin HOST_EDIT. {permissionHint(ctx, "HOST_EDIT")}
        </InfoBanner>
      ) : null}

      <div className="pbs-hf-grid">
        <section className="pbs-card pbs-card-pad pbs-hf-sec">
          <h2 className="pbs-hf-h">Identitas</h2>
          <div className="pbs-hf-row">
            {field(
              "hf-id",
              "Host ID",
              text("hf-id", d.hostId, (v) => set({ hostId: v }), { disabled: !!edit }),
              edit ? "Dipakai jadwal, report dan clock in." : "Otomatis dari Host ID terakhir; boleh diganti.",
            )}
            {field("hf-code", "Host code", text("hf-code", d.code, (v) => set({ code: v }), { placeholder: "opsional" }))}
          </div>
          {field("hf-name", "Nama host", text("hf-name", d.name, (v) => set({ name: v }), { placeholder: "nama lengkap" }))}
          {field(
            "hf-email",
            "Email kerja",
            text("hf-email", d.email, (v) => set({ email: v }), { type: "email", inputMode: "email", placeholder: "nama@perusahaan.com" }),
            "Dipakai host untuk login ke app host.",
          )}
          <div className="pbs-hf-row">
            {field(
              "hf-pkg",
              "Package",
              packages.length ? (
                <select id="hf-pkg" className="pbs-sc-input" value={d.pkg} disabled={locked} onChange={(e) => set({ pkg: e.target.value })}>
                  <option value="">Pilih package</option>
                  {packages.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              ) : (
                text("hf-pkg", d.pkg, (v) => set({ pkg: v }), { placeholder: "opsional" })
              ),
            )}
            {field("hf-join", "Tanggal join", text("hf-join", d.joinDate, (v) => set({ joinDate: v }), { type: "date" }))}
          </div>
        </section>

        <section className="pbs-card pbs-card-pad pbs-hf-sec">
          <h2 className="pbs-hf-h">Skor</h2>
          {field(
            "hf-ini",
            "Skor awal",
            text("hf-ini", d.initialScore, (v) => set({ initialScore: v }), { inputMode: "numeric", disabled: !!edit, placeholder: "kosong = ScoreConfig" }),
            edit ? "Skor berjalan hanya berubah lewat ledger (Tambah / Kurangi poin)." : "Skor berjalan host baru dimulai dari angka ini.",
          )}
          <div className="pbs-hf-row">
            {field("hf-min", "Skor minimum", text("hf-min", d.minScore, (v) => set({ minScore: v }), { inputMode: "numeric", placeholder: "kosong = ScoreConfig" }))}
            {field("hf-max", "Skor maksimum", text("hf-max", d.maxScore, (v) => set({ maxScore: v }), { inputMode: "numeric", placeholder: "kosong = tanpa batas" }))}
          </div>
          {field("hf-bank", "Bank", text("hf-bank", d.bank, (v) => set({ bank: v }), { placeholder: "mis. BCA" }))}
        </section>

        <section className="pbs-card pbs-card-pad pbs-hf-sec pbs-hf-pii">
          <h2 className="pbs-hf-h">Data pribadi</h2>
          {!canPii ? (
            <InfoBanner>Data pribadi hanya untuk izin HOST_PII_VIEW. {permissionHint(ctx, "HOST_PII_VIEW")}</InfoBanner>
          ) : (
            <>
              {edit ? (
                <p className="pbs-muted pbs-hf-note">
                  Nilai lama tidak dimuat ke form. Klik <b>Ganti</b> untuk mengisi nilai baru; yang tidak diganti tetap.
                </p>
              ) : null}
              {PII_ORDER.map((f) => {
                const id = `hf-pii-${f}`;
                const v = d.pii[f];
                const issue = v !== undefined && v.trim() ? piiIssue(f, v) : null;
                if (edit && v === undefined) {
                  const m = model.masked[f];
                  return (
                    <div className="pbs-field" key={f}>
                      <span className="pbs-label">{PII_LABEL[f]}</span>
                      <div className="pbs-hf-mask">
                        <span className="pbs-mono">{m === null ? "— belum diisi" : (m ?? "••••••")}</span>
                        <Button variant="secondary" size="sm" disabled={locked} onClick={() => setPii(f, "")}>
                          Ganti
                        </Button>
                      </div>
                    </div>
                  );
                }
                const input =
                  f === "Alamat" ? (
                    <textarea
                      id={id}
                      className="pbs-sc-input pbs-hf-area"
                      value={v ?? ""}
                      disabled={locked}
                      onChange={(e) => setPii(f, e.target.value)}
                      rows={3}
                    />
                  ) : (
                    text(id, v ?? "", (x) => setPii(f, x), {
                      inputMode: f === "KTP" || f === "NoRekening" ? "numeric" : f === "PhoneNumber" ? "tel" : f === "PersonalEmail" ? "email" : undefined,
                      placeholder: PII_HINT[f],
                    })
                  );
                return (
                  <div className="pbs-field" key={f}>
                    <label className="pbs-label" htmlFor={id}>
                      {PII_LABEL[f]}
                    </label>
                    <div className="pbs-hf-mask">
                      {input}
                      {edit ? (
                        <Button variant="ghost" size="sm" disabled={locked} onClick={() => setPii(f, undefined)}>
                          Batal
                        </Button>
                      ) : null}
                    </div>
                    {issue ? <div className="pbs-sc-hint pbs-t-bad">{issue}</div> : null}
                  </div>
                );
              })}
            </>
          )}
        </section>
      </div>

      {touched && issues.length ? <InfoBanner tone="warn">{issues.join(" · ")}</InfoBanner> : null}
      {touched && !issues.length && changed.length === 0 ? <InfoBanner>Belum ada yang diubah.</InfoBanner> : null}
      {saveError ? (
        <InfoBanner tone="err">
          {saveError.status === "conflict"
            ? saveError.message || "Data host sudah diubah orang lain. Kembali, buka lagi, lalu ulangi."
            : saveError.message || "Gagal menyimpan. Coba lagi."}
        </InfoBanner>
      ) : null}

      <div className="pbs-hf-foot">
        <Button variant="ghost" onClick={cancel} disabled={pending}>
          Batal
        </Button>
        {canEdit ? (
          <Button onClick={submit} disabled={pending || (touched && (issues.length > 0 || changed.length === 0))}>
            {pending ? (
              <>
                <Spinner small /> Menyimpan…
              </>
            ) : edit ? (
              "Simpan perubahan"
            ) : (
              "Tambah host"
            )}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
