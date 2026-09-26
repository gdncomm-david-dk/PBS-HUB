import * as React from "react";
import { ModuleContext, UseActionResult } from "../../../shared/contract";
import { Row, num, str } from "../../../shared/data";
import { fmtLongDate, fmtTime } from "../../../shared/format";
import { hostName, hostOptions, shiftToday } from "../../../shared/hostApp";
import { PreparedImage, prepareImage } from "../../../shared/hostImage";
import {
  GeoFix,
  StudioLocation,
  checkGeofence,
  clockBlockers,
  clockInOptions,
  clockInPayload,
  clockOutPayload,
  fmtDistance,
  parseLocations,
  selfieFileName,
  todayReports,
  todaySchedules,
} from "../../../shared/clockInApp";
import { Badge, Button, Icon, InfoBanner, ResultBanner, Skeleton, Spinner } from "../../../shared/ui";

export interface ClockInViewProps {
  ctx: ModuleContext;
  host: Row[];
  schedules: Row[];
  clockIns: Row[];
  reports: Row[];
  locations: Row[];
  /** Canvas Location signal, used only when the browser position is not available. */
  canvasLocation: Row[];
  loading: boolean;
  now: Date;
  /** The moment a button is pressed (ReferenceDate in tests, else the device clock). */
  clock: () => Date;
  action: UseActionResult;
  setUpload: (base64: string) => void;
}

const fmtDur = (min: number): string => (min >= 60 ? `${Math.floor(min / 60)}j ${min % 60}m` : `${min}m`);
/** A position older than this is read again before submit. */
const FIX_MAX_AGE_MS = 5 * 60000;

type GeoState = { kind: "idle" } | { kind: "busy" } | { kind: "ok"; fix: GeoFix } | { kind: "err"; text: string };

function geoError(code: number): string {
  if (code === 1) return "Izin lokasi ditolak. Aktifkan izin lokasi untuk Power Apps di pengaturan HP, lalu coba lagi.";
  if (code === 3) return "Lokasi tidak didapat dalam 20 detik. Pindah ke dekat jendela / area terbuka, lalu coba lagi.";
  return "Lokasi HP tidak tersedia. Nyalakan GPS / Location, lalu coba lagi.";
}

function canvasFix(rows: Row[], at: Date): GeoFix | null {
  const lat = num(rows[0], "Latitude", "lat");
  const lng = num(rows[0], "Longitude", "lng");
  if (lat === null || lng === null || (lat === 0 && lng === 0)) return null;
  return { lat, lng, accuracy: null, source: "canvas", at };
}

export function ClockInView(props: ClockInViewProps): React.ReactElement {
  const { ctx, now, action } = props;
  const host = props.host[0];
  const hostId = str(host, "Title", "HostCode");
  const opts = React.useMemo(() => clockInOptions(ctx.config), [ctx]);
  const hopts = React.useMemo(() => hostOptions(ctx.config), [ctx]);
  const locations = React.useMemo(() => parseLocations(props.locations, opts.defaultRadiusM), [props.locations, opts]);
  const shift = shiftToday(props.clockIns, now, hopts);
  const dir: "IN" | "OUT" | "DONE" = shift.state === "IN" ? "OUT" : shift.state === "OUT" ? "DONE" : "IN";

  const [geo, setGeo] = React.useState<GeoState>({ kind: "idle" });
  const [selfie, setSelfie] = React.useState<{ img: PreparedImage; source: string } | null>(null);
  const [selfieBusy, setSelfieBusy] = React.useState(false);
  const [selfieErr, setSelfieErr] = React.useState("");
  const [reason, setReason] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement>(null);

  // A finished action starts the next direction from scratch (new position, new selfie).
  const last = action.lastResult;
  React.useEffect(() => {
    if (last && last.status === "ok" && (last.action === "CLOCK_IN" || last.action === "CLOCK_OUT")) {
      setGeo({ kind: "idle" });
      setSelfie(null);
      setReason("");
    }
  }, [last]);

  const fix = geo.kind === "ok" && now.getTime() - geo.fix.at.getTime() <= FIX_MAX_AGE_MS ? geo.fix : null;
  const stale = geo.kind === "ok" && !fix;
  const geofence = fix ? checkGeofence(fix, locations) : null;
  const pending = action.pending?.action === "CLOCK_IN" || action.pending?.action === "CLOCK_OUT";

  const locate = () => {
    setGeo({ kind: "busy" });
    const fallback = (code: number) => {
      const c = canvasFix(props.canvasLocation, props.clock());
      setGeo(c ? { kind: "ok", fix: c } : { kind: "err", text: geoError(code) });
    };
    const g = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
    if (!g) return fallback(2);
    g.getCurrentPosition(
      (pos) =>
        setGeo({
          kind: "ok",
          fix: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null, source: "device", at: props.clock() },
        }),
      (e) => fallback(e.code),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setSelfieBusy(true);
    setSelfieErr("");
    try {
      const img = await prepareImage(file, opts.selfieMaxPx, opts.selfieMaxKb);
      // capture="user" opens the front camera on phones; a file older than a few minutes came from the gallery.
      const fresh = !file.lastModified || Math.abs(Date.now() - file.lastModified) < 10 * 60000;
      setSelfie({ img, source: fresh ? "Camera" : "Gallery" });
    } catch (e) {
      setSelfieErr(e instanceof Error ? e.message : "Foto tidak bisa dibaca.");
    } finally {
      setSelfieBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const blockers = clockBlockers({ fix, locations: locations.length, geofence, selfie: !!selfie, reason, minReasonChars: opts.minReasonChars });

  const submit = () => {
    if (!fix || !geofence || !selfie || blockers.length) return;
    const at = props.clock();
    const kind = dir === "OUT" ? "OUT" : "IN";
    const meta = { name: selfieFileName(hostId || str(shift.row, "HostID"), at, kind), bytes: selfie.img.bytes, width: selfie.img.width, height: selfie.img.height, source: selfie.source };
    const payload =
      dir === "OUT" && shift.row
        ? clockOutPayload({ host, clockIn: shift.row, since: shift.since, schedules: props.schedules, reports: props.reports, fix, geofence, reason, selfie: meta, now: at, opts })
        : clockInPayload({ host, ctxEmail: ctx.userEmail, ctxName: ctx.userName, schedules: props.schedules, fix, geofence, reason, selfie: meta, now: at, opts });
    props.setUpload(selfie.img.base64);
    action.dispatch(dir === "OUT" ? "CLOCK_OUT" : "CLOCK_IN", payload);
  };

  if (props.loading && !host && props.clockIns.length === 0) {
    return (
      <div className="hc-col">
        <Skeleton h={28} w={220} />
        <div style={{ height: 16 }} />
        <Skeleton h={140} />
        <div style={{ height: 12 }} />
        <Skeleton h={220} />
      </div>
    );
  }

  const sessions = todaySchedules(props.schedules, hostId, shift.since ?? now);
  const reportsToday = todayReports(props.reports, sessions, hostId, shift.since ?? now);
  const okText = last?.action === "CLOCK_IN" ? "Clock in tersimpan. Selamat bekerja!" : last?.action === "CLOCK_OUT" ? "Clock out tersimpan. Terima kasih!" : undefined;

  return (
    <div className="hc-col">
      <button type="button" className="pbs-link hc-crumb" onClick={() => action.fire("NAV", { target: "HOME" })}>
        <Icon name="arrowLeft" size={14} /> Hari ini
      </button>
      <div className="hc-hi" style={{ marginBottom: 16 }}>
        <div>
          <h1>{dir === "OUT" ? "Clock out" : dir === "DONE" ? "Shift selesai" : "Clock in"}</h1>
          <p>
            {fmtLongDate(now)} · {fmtTime(now)}
            {hostName(host, ctx.userName) ? ` · ${hostName(host, ctx.userName)}` : ""}
          </p>
        </div>
      </div>

      <ResultBanner result={last} okText={okText} onClose={action.clearResult} />

      {dir === "DONE" ? (
        <div className="hc-split">
          <div className="hc-main">
            <ShiftSummary
              dir={dir}
              since={shift.since}
              until={shift.until}
              minutes={shift.minutes}
              office={shift.office}
              overdue={shift.overdue}
              maxHours={hopts.maxShiftHours}
              sessions={sessions.length}
              reports={reportsToday.length}
            />
            <div>
              <Button variant="secondary" onClick={() => action.fire("NAV", { target: "HOME" })}>
                Kembali ke Hari ini
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="hc-split">
          <div className="hc-main">
            {locations.length === 0 ? <InfoBanner tone="err">Lokasi studio belum diatur (Studio Location - PBS kosong atau tidak aktif). Hubungi tim PBS.</InfoBanner> : null}

            <div className="hc-card hc-shift">
              <StepHead n={1} done={!!fix} title="Lokasi" text="Posisi HP dicek terhadap radius studio." />
              <LocationBlock geo={geo} stale={stale} fix={fix} geofence={geofence} weak={opts.weakAccuracyM} onLocate={locate} disabled={pending} />
            </div>

            <div className="hc-card hc-shift">
              <StepHead n={2} done={!!selfie} title="Selfie" text={dir === "OUT" ? "Foto wajah saat clock out." : "Foto wajah saat clock in."} />
              <input ref={fileRef} type="file" accept="image/*" capture="user" style={{ display: "none" }} aria-label="Ambil selfie" onChange={(e) => void pick(e.target.files?.[0])} />
              <div className="hc-drop" style={{ flexWrap: "wrap" }}>
                <div className="hc-thumb" style={{ width: 72, height: 72, borderRadius: 36 }}>
                  {selfie ? (
                    <img src={selfie.img.dataUrl} alt="Pratinjau selfie" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : selfieBusy ? (
                    <Spinner />
                  ) : (
                    <Icon name="camera" size={22} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <div style={{ fontWeight: 600 }}>{selfieBusy ? "Menyiapkan foto…" : selfie ? "Selfie siap" : "Belum ada selfie"}</div>
                  <div className="pbs-muted" style={{ fontSize: 12 }}>
                    {selfie ? `${selfie.img.width}×${selfie.img.height} · ${Math.round(selfie.img.bytes / 1024)} KB` : "Kamera depan terbuka saat tombol ditekan."}
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={pending || selfieBusy}>
                  <Icon name="camera" size={14} /> {selfie ? "Ulangi" : "Ambil selfie"}
                </Button>
              </div>
              {selfieErr ? <InfoBanner tone="err">{selfieErr}</InfoBanner> : null}
            </div>

            {fix && geofence && !geofence.inside ? (
              <div className="hc-card hc-shift">
                <StepHead n={3} done={reason.trim().length >= opts.minReasonChars} title="Alasan di luar radius" text="Wajib diisi. Tim PBS membaca alasan ini bersama lokasi dan selfie." />
                <div className="hc-field">
                  <label className="pbs-label" htmlFor="hc-ci-reason">
                    Alasan
                  </label>
                  <textarea
                    id="hc-ci-reason"
                    className="pbs-textarea"
                    value={reason}
                    maxLength={500}
                    placeholder={dir === "OUT" ? "Mis. live dari lokasi brand, clock out setelah sesi selesai." : "Mis. live di gudang brand hari ini (jadwal SCD-…)."}
                    onChange={(e) => setReason(e.target.value)}
                    disabled={pending}
                  />
                  <span className="pbs-muted" style={{ fontSize: 11.5 }}>
                    {reason.trim().length < opts.minReasonChars ? `${reason.trim().length}/${opts.minReasonChars} karakter minimum` : `${reason.trim().length} karakter`}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
          <aside className="hc-aside">
            <ShiftSummary
              dir={dir}
              since={shift.since}
              until={shift.until}
              minutes={shift.minutes}
              office={shift.office}
              overdue={shift.overdue}
              maxHours={hopts.maxShiftHours}
              sessions={sessions.length}
              reports={reportsToday.length}
            />
            {dir === "OUT" && sessions.length > reportsToday.length ? (
              <InfoBanner tone="warn">
                {sessions.length - reportsToday.length} dari {sessions.length} sesi hari ini belum ada report. Clock out tetap bisa; kirim report sebelum batas waktu.
              </InfoBanner>
            ) : null}

            <button type="button" className={`pbs-btn primary hc-big`} onClick={submit} disabled={pending || blockers.length > 0}>
              {pending ? <Spinner small /> : <Icon name="clock" size={18} />} {pending ? "Menyimpan…" : dir === "OUT" ? "Clock out sekarang" : "Clock in sekarang"}
            </button>
            <p className="hc-note">{blockers.length ? blockers.join(" · ") : "Waktu dicatat saat tombol ditekan."}</p>
            <div className="hc-card">
              <div className="pbs-sec">
                <span className="pbs-sec-l">Kalau lokasi bermasalah</span>
              </div>
              <dl className="hc-kv">
                <div>
                  <dt>Di luar radius</dt>
                  <dd>Tetap bisa, wajib alasan</dd>
                </div>
                <div>
                  <dt>GPS lemah</dt>
                  <dd>Cek ulang di area terbuka</dd>
                </div>
                <div>
                  <dt>Izin lokasi ditolak</dt>
                  <dd>Izinkan lokasi di browser</dd>
                </div>
              </dl>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function StepHead(props: { n: number; done: boolean; title: string; text: string }): React.ReactElement {
  return (
    <div className="hc-shift-h">
      <span className={`hc-ic${props.done ? " ok" : ""}`}>{props.done ? <Icon name="check" size={18} /> : <b>{props.n}</b>}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{props.title}</div>
        <div className="pbs-muted" style={{ fontSize: 12.5 }}>
          {props.text}
        </div>
      </div>
    </div>
  );
}

function LocationBlock(props: {
  geo: GeoState;
  stale: boolean;
  fix: GeoFix | null;
  geofence: ReturnType<typeof checkGeofence> | null;
  weak: number;
  onLocate: () => void;
  disabled: boolean;
}): React.ReactElement {
  const { geo, fix, geofence } = props;
  const loc: StudioLocation | null = geofence?.location ?? null;
  return (
    <>
      {geo.kind === "err" ? <InfoBanner tone="err">{geo.text}</InfoBanner> : null}
      {props.stale ? <InfoBanner tone="warn">Lokasi dicek lebih dari 5 menit lalu. Cek ulang sebelum menyimpan.</InfoBanner> : null}
      {fix && geofence ? (
        <div className={`hc-todo${geofence.inside ? "" : " warn"}`} style={{ padding: 14 }}>
          <span className={`hc-ic ${geofence.inside ? "ok" : "warn"}`}>
            <Icon name="mapPin" size={18} />
          </span>
          <div className="hc-todo-b">
            <p className="hc-todo-t">
              {loc ? loc.title : "Tidak ada studio"}{" "}
              <Badge tone={geofence.inside ? "success" : "warning"} small>
                {geofence.inside ? "Di dalam radius" : "Di luar radius"}
              </Badge>
            </p>
            <p className="hc-todo-x">
              Jarak {fmtDistance(geofence.distance)}
              {loc ? ` dari titik studio (radius ${fmtDistance(loc.radius)})` : ""}
              {fix.accuracy !== null ? ` · akurasi ±${fmtDistance(fix.accuracy)}` : " · lokasi dari Power Apps"}
            </p>
            {fix.accuracy !== null && fix.accuracy > props.weak ? <p className="hc-todo-x">Sinyal GPS lemah. Cek ulang di area terbuka supaya jarak lebih tepat.</p> : null}
          </div>
        </div>
      ) : null}
      <Button variant={fix ? "secondary" : "primary"} onClick={props.onLocate} disabled={props.disabled || geo.kind === "busy"}>
        {geo.kind === "busy" ? <Spinner small /> : <Icon name={fix ? "refresh" : "mapPin"} size={16} />} {geo.kind === "busy" ? "Mencari lokasi…" : fix ? "Cek ulang lokasi" : "Cek lokasi"}
      </Button>
    </>
  );
}

function ShiftSummary(props: {
  dir: "IN" | "OUT" | "DONE";
  since: Date | null;
  until: Date | null;
  minutes: number;
  office: string;
  overdue: boolean;
  maxHours: number;
  sessions: number;
  reports: number;
}): React.ReactElement {
  const { dir } = props;
  const tone = dir === "IN" ? "" : " ok";
  return (
    <div className="hc-card hc-shift">
      <div className="hc-shift-h">
        <span className={`hc-ic${tone}`}>
          <Icon name={dir === "DONE" ? "check" : "clock"} size={20} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {dir === "IN" ? "Belum clock in" : dir === "OUT" ? `Shift berjalan ${fmtDur(props.minutes)}` : `Shift selesai · ${fmtDur(props.minutes)}`}
          </div>
          <div className="pbs-muted" style={{ fontSize: 12.5 }}>
            {dir === "IN"
              ? props.sessions
                ? `${props.sessions} sesi hari ini. Clock in sebelum sesi pertama.`
                : "Tidak ada jadwal hari ini."
              : `${fmtTime(props.since)}${props.until ? `–${fmtTime(props.until)}` : ""}${props.office ? ` · ${props.office}` : ""} · ${props.reports}/${props.sessions} report`}
          </div>
        </div>
        {dir === "OUT" ? <Badge tone="success">Aktif</Badge> : null}
      </div>
      {dir === "OUT" && props.overdue ? <InfoBanner tone="warn">Shift sudah lebih dari {props.maxHours} jam. Clock out sekarang supaya jam kerjamu tercatat benar.</InfoBanner> : null}
    </div>
  );
}
