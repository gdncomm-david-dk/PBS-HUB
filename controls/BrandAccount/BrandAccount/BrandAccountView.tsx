import * as React from "react";
import {
  ModuleContext,
  UseActionResult,
  hasPermission,
  permissionHint,
} from "../../../shared/contract";
import { Row } from "../../../shared/data";
import {
  AccountDraft,
  AccountModel,
  BrandModel,
  accountIssues,
  addAccountPayload,
  addBrandPayload,
  brandIssues,
  nextCode,
  orphanAccounts,
  parseAccounts,
  parseBrands,
  platformOptions,
  updateAccountPayload,
} from "../../../shared/brandAccount";
import {
  Badge,
  Button,
  EmptyState,
  FilterSelect,
  Icon,
  InfoBanner,
  ModuleHeader,
  Overlay,
  Pager,
  ResultBanner,
  SkeletonRows,
  Spinner,
  usePaged,
} from "../../../shared/ui";

export interface BrandAccountProps {
  ctx: ModuleContext;
  brands: Row[];
  accounts: Row[];
  brandId: string;
  loading: boolean;
  action: UseActionResult;
}

type Dialog =
  | { kind: "brand" }
  | { kind: "account"; edit: AccountModel | null };

const ALL = "";
const NONE = "__none__";

const SAVE_ACTIONS = ["ADD_BRAND", "ADD_ACCOUNT", "UPDATE_ACCOUNT"];

export function BrandAccountView(props: BrandAccountProps): React.ReactElement {
  const { ctx, action } = props;
  const accounts = React.useMemo(() => parseAccounts(props.accounts), [props.accounts]);
  const brands = React.useMemo(() => parseBrands(props.brands, accounts), [props.brands, accounts]);
  const orphans = React.useMemo(() => orphanAccounts(brands, accounts), [brands, accounts]);
  const platforms = React.useMemo(() => platformOptions(accounts, ctx.config), [accounts, ctx.config]);
  const canEdit = hasPermission(ctx, "BRAND_EDIT");
  const firstLoad = props.loading && brands.length === 0 && accounts.length === 0;

  const [brand, setBrand] = React.useState(props.brandId || ALL);
  React.useEffect(() => {
    if (props.brandId) setBrand(props.brandId);
  }, [props.brandId]);
  const [q, setQ] = React.useState("");
  const [platform, setPlatform] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [dialog, setDialog] = React.useState<Dialog | null>(null);

  // A save that worked closes its dialog; one that failed stays there with its error.
  React.useEffect(() => {
    const r = action.lastResult;
    if (r && r.status === "ok" && SAVE_ACTIONS.includes(r.action)) setDialog(null);
  }, [action.lastResult]);
  const open = (d: Dialog) => {
    if (action.lastResult) action.clearResult();
    setDialog(d);
  };
  const bannerResult =
    dialog && action.lastResult && SAVE_ACTIONS.includes(action.lastResult.action) ? null : action.lastResult;

  const pick = (v: string) => {
    setBrand(v);
    action.fire("BRAND_SELECTED", { brandId: v === NONE ? "" : v });
  };

  const selected = brands.find((b) => b.code.toLowerCase() === brand.toLowerCase()) ?? null;
  const pool = brand === NONE ? orphans : selected ? selected.accounts : accounts;
  const needle = q.trim().toLowerCase();
  const rows = pool
    .filter((a) => {
      if (needle && ![a.code, a.name, a.brandId].some((s) => s.toLowerCase().includes(needle))) return false;
      if (platform && a.platform.toLowerCase() !== platform.toLowerCase()) return false;
      if (status === "active" && !a.active) return false;
      if (status === "inactive" && a.active) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const paged = usePaged(rows, JSON.stringify([brand, q, platform, status]));
  const filterActive = !!(q || platform || status);
  const brandName = (code: string) => brands.find((b) => b.code.toLowerCase() === code.toLowerCase())?.name ?? "";
  const heading = brand === NONE ? "Tanpa brand" : (selected?.name ?? "Semua account");

  return (
    <div className="pbs-page pbs-ba">
      <ModuleHeader
        crumb="Brand & Account"
        title="Brand & Account"
        subtitle={
          firstLoad
            ? "Memuat brand…"
            : `${brands.length} brand · ${accounts.length} account (${accounts.filter((a) => a.active).length} aktif)`
        }
        actions={
          canEdit ? (
            <>
              <Button variant="secondary" onClick={() => open({ kind: "brand" })} disabled={!!action.pending}>
                <Icon name="plus" size={15} /> Add Brand
              </Button>
              <Button
                onClick={() => open({ kind: "account", edit: null })}
                disabled={!!action.pending || brands.length === 0}
              >
                <Icon name="plus" size={15} /> Add Account
              </Button>
            </>
          ) : null
        }
      />

      <ResultBanner result={bannerResult} onClose={action.clearResult} />
      {!canEdit ? (
        <InfoBanner>
          Kamu hanya bisa melihat. Menambah brand atau account butuh izin BRAND_EDIT. {permissionHint(ctx, "BRAND_EDIT")}
        </InfoBanner>
      ) : null}
      {orphans.length > 0 && brand !== NONE ? (
        <InfoBanner
          tone="warn"
          action={
            <Button variant="secondary" size="sm" onClick={() => pick(NONE)}>
              Show
            </Button>
          }
        >
          <b>{orphans.length} account</b> punya BrandID yang tidak ada di list Brand. Perbaiki dengan Edit.
        </InfoBanner>
      ) : null}

      <div className="pbs-ba-grid">
        <nav className="pbs-ba-brands" aria-label="Brand">
          <button
            type="button"
            className={`pbs-ba-b${brand === ALL ? " on" : ""}`}
            aria-pressed={brand === ALL}
            onClick={() => pick(ALL)}
          >
            <span>Semua brand</span>
            <b className="pbs-num">{accounts.length}</b>
          </button>
          {firstLoad ? (
            <SkeletonRows rows={5} cols={1} />
          ) : (
            brands.map((b) => (
              <button
                key={b.code || b.id}
                type="button"
                className={`pbs-ba-b${selected?.code === b.code ? " on" : ""}`}
                aria-pressed={selected?.code === b.code}
                onClick={() => pick(b.code)}
              >
                <span>
                  {b.name}
                  <small className="pbs-muted">{b.code}</small>
                </span>
                <b className="pbs-num" title={`${b.active} aktif dari ${b.accounts.length}`}>
                  {b.accounts.length}
                </b>
              </button>
            ))
          )}
          {orphans.length > 0 ? (
            <button
              type="button"
              className={`pbs-ba-b${brand === NONE ? " on" : ""}`}
              aria-pressed={brand === NONE}
              onClick={() => pick(NONE)}
            >
              <span>Tanpa brand</span>
              <b className="pbs-num pbs-t-warn">{orphans.length}</b>
            </button>
          ) : null}
        </nav>

        <section className="pbs-ba-main" aria-label={`Account ${heading}`}>
          <div className="pbs-filters">
            <label className="pbs-search">
              <Icon name="search" size={14} />
              <input
                type="search"
                value={q}
                placeholder="Cari kode atau nama akun"
                aria-label="Cari account"
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <FilterSelect
              label="Platform"
              value={platform}
              options={platforms.map((p) => ({ value: p, label: p }))}
              onChange={setPlatform}
            />
            <FilterSelect
              label="Status"
              value={status}
              options={[
                { value: "active", label: "Aktif" },
                { value: "inactive", label: "Nonaktif" },
              ]}
              onChange={setStatus}
            />
            {filterActive ? (
              <button
                type="button"
                className="pbs-link"
                onClick={() => {
                  setQ("");
                  setPlatform("");
                  setStatus("");
                }}
                style={{ marginLeft: 4 }}
              >
                Clear Filters
              </button>
            ) : null}
            <span style={{ flex: 1 }} />
            <span className="pbs-muted" style={{ fontSize: 12.5 }}>
              {heading}
            </span>
          </div>

          <div className="pbs-table-wrap">
            <div className="pbs-table-scroll">
              <table className="pbs-table" aria-busy={props.loading}>
                <thead>
                  <tr>
                    <th>Kode</th>
                    <th>Nama akun</th>
                    <th>Brand</th>
                    <th>Platform</th>
                    <th>Status</th>
                    {canEdit ? <th aria-label="Aksi" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {firstLoad ? (
                    <SkeletonRows rows={8} cols={canEdit ? 6 : 5} />
                  ) : (
                    paged.rows.map((a) => (
                      <tr key={a.id || a.code} className={a.active ? undefined : "pbs-ba-off"}>
                        <td className="pbs-num" style={{ whiteSpace: "nowrap" }}>
                          {a.code}
                        </td>
                        <td style={{ fontWeight: 600 }}>{a.name || <span className="pbs-muted">—</span>}</td>
                        <td>
                          {brandName(a.brandId) || (
                            <span className="pbs-t-warn">{a.brandId || "Belum ada brand"}</span>
                          )}
                        </td>
                        <td>{a.platform || <span className="pbs-muted">—</span>}</td>
                        <td>
                          <Badge tone={a.active ? "success" : "neutral"} small>
                            {a.active ? "Aktif" : "Nonaktif"}
                          </Badge>
                        </td>
                        {canEdit ? (
                          <td className="r">
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={!!action.pending}
                              onClick={() => open({ kind: "account", edit: a })}
                            >
                              Edit
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {firstLoad ? null : rows.length === 0 ? (
              filterActive ? (
                <EmptyState
                  icon="filterX"
                  title="Tidak ada account yang cocok dengan filter"
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setQ("");
                        setPlatform("");
                        setStatus("");
                      }}
                    >
                      Clear Filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon="user"
                  title={selected ? `${selected.name} belum punya account` : "Belum ada account"}
                  text="Tambahkan account pertama dengan Add Account."
                />
              )
            ) : (
              <Pager paged={paged} unit="account" />
            )}
          </div>
        </section>
      </div>

      {dialog?.kind === "brand" ? (
        <BrandModal brands={brands} action={action} onClose={() => setDialog(null)} />
      ) : dialog?.kind === "account" ? (
        <AccountModal
          key={dialog.edit?.id ?? "new"}
          edit={dialog.edit}
          brands={brands}
          accounts={accounts}
          platforms={platforms}
          defaultBrand={selected?.code ?? ""}
          action={action}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

function SaveError(props: { action: UseActionResult; name: string }): React.ReactElement | null {
  const r = props.action.lastResult;
  if (!r || r.action !== props.name || r.status === "ok") return null;
  return (
    <InfoBanner tone="err">
      {r.status === "conflict"
        ? r.message || "Datanya sudah berubah. Tutup, muat ulang, lalu coba lagi."
        : r.message || "Gagal menyimpan. Coba lagi."}
    </InfoBanner>
  );
}

function ModalHead(props: { id: string; title: string; sub?: string; onClose: () => void; busy: boolean }): React.ReactElement {
  return (
    <div className="pbs-modal-h">
      <div>
        <h2 id={props.id}>{props.title}</h2>
        {props.sub ? (
          <div className="pbs-muted" style={{ fontSize: 12.5, marginTop: 2 }}>
            {props.sub}
          </div>
        ) : null}
      </div>
      <button type="button" className="pbs-x" onClick={props.onClose} disabled={props.busy} aria-label="Close">
        <Icon name="x" />
      </button>
    </div>
  );
}

function BrandModal(props: { brands: BrandModel[]; action: UseActionResult; onClose: () => void }): React.ReactElement {
  const { action } = props;
  const [code, setCode] = React.useState(() => nextCode(props.brands.map((b) => b.code), "BRD-"));
  const [name, setName] = React.useState("");
  const pending = action.pending?.action === "ADD_BRAND";
  const issues = brandIssues(code, name, props.brands);
  const [touched, setTouched] = React.useState(false);
  const submit = () => {
    setTouched(true);
    if (issues.length || pending) return;
    action.dispatch("ADD_BRAND", addBrandPayload(code, name));
  };
  return (
    <Overlay onClose={props.onClose} busy={pending} labelledBy="pbs-ba-brand">
      <ModalHead id="pbs-ba-brand" title="Add Brand" onClose={props.onClose} busy={pending} />
      <div className="pbs-modal-b">
        <div className="pbs-field">
          <label className="pbs-label" htmlFor="pbs-ba-bc">
            Kode brand
          </label>
          <input
            id="pbs-ba-bc"
            className="pbs-sc-input"
            value={code}
            disabled={pending}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="pbs-field">
          <label className="pbs-label" htmlFor="pbs-ba-bn">
            Nama brand
          </label>
          <input
            id="pbs-ba-bn"
            className="pbs-sc-input"
            value={name}
            disabled={pending}
            placeholder="mis. Y.O.U Beauty"
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </div>
        {touched && issues.length ? <InfoBanner tone="warn">{issues.join(" · ")}</InfoBanner> : null}
        <SaveError action={action} name="ADD_BRAND" />
      </div>
      <div className="pbs-modal-f">
        <Button variant="ghost" onClick={props.onClose} disabled={pending}>
          Close
        </Button>
        <Button onClick={submit} disabled={pending || (touched && issues.length > 0)}>
          {pending ? (
            <>
              <Spinner small /> Saving…
            </>
          ) : (
            "Save Brand"
          )}
        </Button>
      </div>
    </Overlay>
  );
}

function AccountModal(props: {
  edit: AccountModel | null;
  brands: BrandModel[];
  accounts: AccountModel[];
  platforms: string[];
  defaultBrand: string;
  action: UseActionResult;
  onClose: () => void;
}): React.ReactElement {
  const { action, edit } = props;
  const name = edit ? "UPDATE_ACCOUNT" : "ADD_ACCOUNT";
  const pending = action.pending?.action === name;
  const [d, setD] = React.useState<AccountDraft>(() =>
    edit
      ? { code: edit.code, name: edit.name, brandId: edit.brandId, platform: edit.platform, active: edit.active }
      : {
          code: nextCode(props.accounts.map((a) => a.code), "ACC-"),
          name: "",
          brandId: props.defaultBrand,
          platform: "",
          active: true,
        },
  );
  const [touched, setTouched] = React.useState(false);
  const set = (patch: Partial<AccountDraft>) => setD({ ...d, ...patch });
  const issues = accountIssues(d, props.accounts, props.brands, edit ?? undefined);
  const brand = props.brands.find((b) => b.code.toLowerCase() === d.brandId.toLowerCase());
  const platformList = d.platform && !props.platforms.some((p) => p.toLowerCase() === d.platform.toLowerCase())
    ? [...props.platforms, d.platform]
    : props.platforms;
  const renamed = !!edit && edit.name.trim().toLowerCase() !== d.name.trim().toLowerCase();
  const submit = () => {
    setTouched(true);
    if (issues.length || pending) return;
    action.dispatch(name, edit ? updateAccountPayload(d, edit, brand) : addAccountPayload(d, brand));
  };
  return (
    <Overlay onClose={props.onClose} busy={pending} labelledBy="pbs-ba-acc">
      <ModalHead
        id="pbs-ba-acc"
        title={edit ? "Edit Account" : "Add Account"}
        sub={edit ? `${edit.code} · kode tidak bisa diubah` : undefined}
        onClose={props.onClose}
        busy={pending}
      />
      <div className="pbs-modal-b">
        <div className="pbs-field">
          <label className="pbs-label" htmlFor="pbs-ba-brand">
            Brand
          </label>
          <select
            id="pbs-ba-brand"
            className="pbs-sc-input"
            value={d.brandId}
            disabled={pending}
            onChange={(e) => set({ brandId: e.target.value })}
          >
            <option value="">Pilih brand</option>
            {props.brands.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name} · {b.code}
              </option>
            ))}
          </select>
        </div>
        <div className="pbs-field">
          <label className="pbs-label" htmlFor="pbs-ba-code">
            Kode akun
          </label>
          <input
            id="pbs-ba-code"
            className="pbs-sc-input"
            value={d.code}
            disabled={pending || !!edit}
            onChange={(e) => set({ code: e.target.value })}
            autoComplete="off"
          />
          <div className="pbs-sc-hint">Dipakai jadwal (Schedule.Account), jadi tidak bisa diubah setelah dibuat.</div>
        </div>
        <div className="pbs-field">
          <label className="pbs-label" htmlFor="pbs-ba-name">
            Nama akun
          </label>
          <input
            id="pbs-ba-name"
            className="pbs-sc-input"
            value={d.name}
            disabled={pending}
            placeholder="mis. wingsofficialstore"
            onChange={(e) => set({ name: e.target.value })}
            autoComplete="off"
          />
        </div>
        <div className="pbs-field">
          <label className="pbs-label" htmlFor="pbs-ba-platform">
            Platform
          </label>
          <select
            id="pbs-ba-platform"
            className="pbs-sc-input"
            value={d.platform}
            disabled={pending}
            onChange={(e) => set({ platform: e.target.value })}
          >
            <option value="">Pilih platform</option>
            {platformList.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
          <input
            id="pbs-ba-active"
            type="checkbox"
            checked={d.active}
            disabled={pending}
            onChange={(e) => set({ active: e.target.checked })}
          />
          <span>
            <b>Aktif</b>
            <span className="pbs-muted" style={{ display: "block", fontSize: 12.5 }}>
              Account nonaktif tetap ada di jadwal dan report lama.
            </span>
          </span>
        </label>
        {renamed ? (
          <InfoBanner tone="warn">
            Mengganti nama tidak mengubah report dan absen lama (mereka menyimpan nama saat itu). Pilihan kolom Account di
            list Report dan Host Absence harus ditambah dengan nama baru.
          </InfoBanner>
        ) : null}
        {touched && issues.length ? <InfoBanner tone="warn">{issues.join(" · ")}</InfoBanner> : null}
        <SaveError action={action} name={name} />
      </div>
      <div className="pbs-modal-f">
        <Button variant="ghost" onClick={props.onClose} disabled={pending}>
          Close
        </Button>
        <Button onClick={submit} disabled={pending || (touched && issues.length > 0)}>
          {pending ? (
            <>
              <Spinner small /> Saving…
            </>
          ) : edit ? (
            "Save Changes"
          ) : (
            "Save Account"
          )}
        </Button>
      </div>
    </Overlay>
  );
}
