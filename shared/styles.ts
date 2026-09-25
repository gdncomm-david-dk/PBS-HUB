import { FONT_BOLD, FONT_MEDIUM, FONT_REGULAR } from "./assets.generated";

/**
 * Blu Basic — internal-app tokens (design handoff README → Design Tokens). Every rule is scoped
 * under `.pbs-root` so nothing leaks into the canvas app or another control on the same screen.
 * Light mode is enforced: the Power Apps player must not push a dark theme into the control.
 */
/** Fonts must be declared in the document: @font-face inside a shadow root is ignored by Chromium. */
export const FONT_CSS = `
@font-face{font-family:"Blibli";src:url(${FONT_REGULAR}) format("woff2");font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:"Blibli";src:url(${FONT_MEDIUM}) format("woff2");font-weight:500;font-style:normal;font-display:swap}
@font-face{font-family:"Blibli";src:url(${FONT_BOLD}) format("woff2");font-weight:600 800;font-style:normal;font-display:swap}
`;

/**
 * Rendered inside each control's shadow root, so the Power Apps player's own CSS (table, button,
 * input and dl rules) cannot reach it. Inherited properties are reset at :host.
 */
export const CSS = `
:host{all:initial;display:block;width:100%;height:100%}
.pbs-root{--p:#0072FF;--p-dk:#0050BD;--p-dkr:#002E7A;--p-tint:#E1F1FF;--p-tint2:#F4F9FF;--info-bg:#E8F4FF;--info-bd:#B3D9FF;
--ok:#02C82B;--ok-tx:#0A7A24;--ok-bg:#E9FAEE;--warn:#FFCD00;--warn-tx:#7A5B00;--warn-ic:#8A6A00;--warn-bg:#FFF4D6;--warn-bg2:#FFF9E0;--warn-bd:#FFE0B3;
--bad:#FF4646;--bad-tx:#C0292A;--bad-bg:#FFE8E8;--bad-bg2:#FFF9F9;--bad-bd:#FFC9C9;--tx:#000;--tx2:#60686E;--dis:#9AA1A6;--bd:#E8E8E8;--row:#F5F5F5;--sf:#F5F5F5;--sf2:#FAFAF9;
color-scheme:light;box-sizing:border-box;position:relative;width:100%;height:100%;overflow:auto;background:#fff;color:var(--tx);
font-family:"Blibli","Helvetica Neue",Arial,sans-serif;font-size:13px;line-height:1.45;-webkit-font-smoothing:antialiased;text-align:left}
.pbs-root *,.pbs-root *::before,.pbs-root *::after{box-sizing:border-box}
:where(.pbs-root) :where(button,input,select,textarea){font-family:inherit;color:inherit}
.pbs-page{padding:24px 28px 32px;min-width:0}
.pbs-num{font-variant-numeric:tabular-nums}
.pbs-mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em}
.pbs-muted{color:var(--tx2)}
.pbs-crumb{font-size:12px;color:var(--tx2);margin:0 0 4px}
.pbs-crumb button{border:0;background:none;padding:0;color:var(--p-dk);font:inherit;cursor:pointer}
.pbs-mh{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin:0 0 20px;flex-wrap:wrap}
.pbs-h1{font-size:22px;font-weight:700;letter-spacing:-.02em;margin:0;line-height:1.25}
.pbs-sub{font-size:13px;color:var(--tx2);margin:4px 0 0}
.pbs-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.pbs-card{background:#fff;border:1px solid var(--bd);border-radius:8px}
.pbs-card-pad{padding:18px 18px}
.pbs-sec{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 0 10px;margin:0 0 14px;border-bottom:1px solid var(--p-tint)}
.pbs-sec-l{font-size:11px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:var(--p-dk)}
.pbs-sec-r{font-size:12px;color:var(--tx2)}
.pbs-link{border:0;background:none;padding:0;color:var(--p-dk);font-weight:600;font-size:12px;cursor:pointer}
.pbs-link:hover{color:var(--p-dkr);text-decoration:underline}
.pbs-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border-radius:20px;height:40px;padding:0 20px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid transparent;white-space:nowrap;transition:background .12s,border-color .12s,color .12s}
.pbs-btn.sm{height:32px;padding:0 14px;font-size:12px}
.pbs-btn.primary{background:var(--p);color:#fff}
.pbs-btn.primary:hover:not(:disabled){background:var(--p-dk)}
.pbs-btn.secondary{background:#fff;color:var(--p-dk);border-color:var(--p)}
.pbs-btn.secondary:hover:not(:disabled){background:var(--p-tint2)}
.pbs-btn.ghost{background:transparent;color:var(--p-dk)}
.pbs-btn.ghost:hover:not(:disabled){background:var(--p-tint2)}
.pbs-btn.danger{background:#fff;color:var(--bad-tx);border-color:var(--bad-bd)}
.pbs-btn:disabled{cursor:not-allowed;opacity:.45}
.pbs-btn.wide{width:100%}
.pbs-badge{display:inline-flex;align-items:center;gap:5px;border-radius:6px;padding:4px 8px;font-size:11px;font-weight:600;line-height:1.2;white-space:nowrap}
.pbs-badge.sm{font-size:10.5px;padding:3px 6px}
.pbs-badge.success{background:var(--ok-bg);color:var(--ok-tx)}
.pbs-badge.info{background:var(--p-tint);color:var(--p-dk)}
.pbs-badge.warning{background:var(--warn-bg);color:var(--warn-tx)}
.pbs-badge.danger{background:var(--bad-bg);color:var(--bad-tx)}
.pbs-badge.neutral{background:var(--sf);color:var(--tx2)}
.pbs-pill{display:inline-flex;align-items:center;gap:6px;border-radius:20px;padding:7px 14px;font-size:12px;font-weight:600;white-space:nowrap}
.pbs-pill.success{background:var(--ok);color:#fff}.pbs-pill.info{background:var(--p);color:#fff}
.pbs-pill.warning{background:var(--warn);color:#000}.pbs-pill.danger{background:var(--bad);color:#fff}.pbs-pill.neutral{background:var(--sf);color:var(--tx2)}
.pbs-dot{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block}
.pbs-banner{display:flex;align-items:center;gap:12px;border-radius:8px;padding:12px 16px;margin:0 0 16px;font-size:13px}
.pbs-banner.info{background:var(--info-bg);border:1px solid var(--info-bd);border-left:4px solid var(--p)}
.pbs-banner.ok{background:var(--ok-bg);border-left:4px solid var(--ok);color:var(--ok-tx)}
.pbs-banner.err{background:var(--bad-bg2);border:1px solid var(--bad-bd);border-left:4px solid var(--bad);color:var(--bad-tx)}
.pbs-banner.warn{background:var(--warn-bg2);border:1px solid var(--warn-bd);border-left:4px solid var(--warn);color:var(--warn-tx)}
.pbs-banner .grow{flex:1;min-width:0}
.pbs-x{border:0;background:none;cursor:pointer;color:inherit;padding:4px;display:inline-flex;border-radius:6px}
.pbs-filters{display:flex;gap:9px;flex-wrap:wrap;align-items:center;margin:0 0 16px}
.pbs-chip{position:relative;display:inline-flex;align-items:center}
.pbs-chip select,.pbs-chip input{appearance:none;-webkit-appearance:none;height:34px;border:1px solid var(--bd);border-radius:20px;background:#fff;padding:0 30px 0 14px;font-size:12.5px;cursor:pointer;color:var(--tx)}
.pbs-chip input{padding:0 12px;cursor:text;width:138px}
.pbs-chip.on select,.pbs-chip.on input{border-color:var(--p);background:var(--p-tint2);color:var(--p-dk);font-weight:600}
.pbs-chip svg{position:absolute;right:11px;pointer-events:none;color:var(--tx2)}
.pbs-tabs{display:flex;gap:4px;border-bottom:1px solid var(--bd);margin:0 0 16px;flex-wrap:wrap}
.pbs-tab{border:0;background:none;padding:10px 14px;font-size:13px;font-weight:600;color:var(--tx2);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;display:inline-flex;gap:7px;align-items:center}
.pbs-tab.on{color:var(--p-dk);border-bottom-color:var(--p)}
.pbs-count{min-width:20px;height:18px;padding:0 6px;border-radius:9px;background:var(--sf);color:var(--tx2);font-size:10.5px;font-weight:600;display:inline-flex;align-items:center;justify-content:center}
.pbs-tab.on .pbs-count{background:var(--p-tint);color:var(--p-dk)}
.pbs-table{width:100%;border-collapse:separate;border-spacing:0}
.pbs-table th{background:var(--sf);color:var(--tx2);font-size:12px;font-weight:500;text-align:left;padding:11px 16px;white-space:nowrap;border-bottom:1px solid var(--bd)}
.pbs-table th.r,.pbs-table td.r{text-align:right}
.pbs-table td{padding:12px 16px;border-top:1px solid var(--row);font-size:13px;vertical-align:middle}
.pbs-table tbody tr:first-child td{border-top:0}
.pbs-table tbody tr:hover td{background:var(--sf)}
.pbs-table tbody tr.sel td{background:var(--p-tint2)}
.pbs-table-wrap{border:1px solid var(--bd);border-radius:8px;overflow:hidden;background:#fff}
.pbs-table-scroll{overflow-x:auto}
.pbs-foot{display:flex;align-items:center;gap:14px;padding:14px 16px;border-top:1px solid var(--row);font-size:12px;color:var(--tx2)}
.pbs-foot .line{flex:1;height:1px;background:var(--bd)}
.pbs-sk{background:linear-gradient(90deg,#F0F0F0 0%,#F7F7F7 50%,#F0F0F0 100%);background-size:200% 100%;animation:pbs-sh 1.3s linear infinite;border-radius:6px}
@keyframes pbs-sh{from{background-position:200% 0}to{background-position:-200% 0}}
.pbs-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:36px 24px;gap:6px}
.pbs-empty img{width:120px;height:120px;object-fit:contain;margin-bottom:6px}
.pbs-empty h3{margin:4px 0 0;font-size:16px;font-weight:700}
.pbs-empty p{margin:0;color:var(--tx2);max-width:440px}
.pbs-empty .ic{width:44px;height:44px;border-radius:12px;background:var(--sf);display:flex;align-items:center;justify-content:center;color:var(--tx2);margin-bottom:6px}
.pbs-check{width:16px;height:16px;accent-color:var(--p);cursor:pointer;margin:0}
.pbs-textarea{width:100%;min-height:84px;border:1px solid var(--bd);border-radius:8px;padding:10px 12px;font-size:13px;resize:vertical;outline:none;background:#fff}
.pbs-textarea:focus,.pbs-chip select:focus,.pbs-chip input:focus{border-color:var(--p);box-shadow:0 0 0 3px var(--p-tint)}
.pbs-label{font-size:12px;color:var(--tx2);margin:0 0 6px;display:block}
.pbs-spin{width:26px;height:26px;border-radius:50%;border:3px solid var(--p-tint);border-top-color:var(--p);animation:pbs-rot .8s linear infinite;flex:none}
.pbs-spin.sm{width:14px;height:14px;border-width:2px}
@keyframes pbs-rot{to{transform:rotate(360deg)}}
.pbs-grid{display:grid;gap:12px}
.pbs-kv{display:grid;grid-template-columns:140px 1fr;gap:10px 12px;font-size:13px}
.pbs-kv dt{color:var(--tx2)}.pbs-kv dd{margin:0;font-weight:500}
.pbs-strip{font-size:12px;color:var(--tx2);margin:10px 0 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pbs-gdots{display:inline-flex;gap:5px;align-items:center}
.pbs-gdot{width:10px;height:10px;border-radius:50%;background:#E8E8E8;flex:none}
.pbs-gdot.done{background:var(--ok)}.pbs-gdot.active{background:var(--p);box-shadow:0 0 0 3px var(--p-tint)}
.pbs-gdot.rejected{background:var(--bad)}.pbs-gdot.skipped{background:#fff;border:1.5px dashed #C8CDD1}
.pbs-pulse{animation:pbs-pulse 1.2s ease-in-out infinite}
@keyframes pbs-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.pbs-host{position:relative;min-height:100%}
.pbs-overlay{position:absolute;left:0;right:0;top:0;bottom:0;background:rgba(0,0,0,.36);display:flex;justify-content:center;align-items:center;padding:24px 16px;z-index:20}
.pbs-modal{width:640px;max-width:100%;max-height:100%;container-type:inline-size;background:#fff;border-radius:12px;display:flex;flex-direction:column;box-shadow:0 12px 40px rgba(0,0,0,.18)}
.pbs-modal-b{overflow:auto;min-height:0}
.pbs-modal-h{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 22px;border-bottom:1px solid var(--bd)}
.pbs-modal-h h2{margin:0;font-size:18px;font-weight:700}
.pbs-modal-b{padding:18px 22px;display:grid;gap:16px}
.pbs-modal-f{display:flex;justify-content:flex-end;gap:10px;padding:14px 22px;border-top:1px solid var(--bd);flex-wrap:wrap;align-items:center}
.pbs-field select{height:40px;border:1px solid var(--bd);border-radius:8px;padding:0 12px;width:100%;background:#fff;font-size:13px;cursor:pointer}
.pbs-field select:focus{border-color:var(--p);box-shadow:0 0 0 3px var(--p-tint);outline:none}
.pbs-field input[type=time],.pbs-field input[type=text],.pbs-field input[inputmode]{height:40px;border:1px solid var(--bd);border-radius:8px;padding:0 12px;width:100%;background:#fff;font-size:13px;font-variant-numeric:tabular-nums;outline:none}
.pbs-field input:focus{border-color:var(--p);box-shadow:0 0 0 3px var(--p-tint)}
.pbs-field input:disabled{background:var(--sf);color:var(--tx2)}
.pbs-inline{display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer}
.pbs-diff{list-style:none;margin:0;padding:10px 12px;border:1px solid var(--bd);border-radius:8px;background:var(--sf);display:grid;gap:4px;font-size:12.5px}
.pbs-diff b{font-weight:600}
.pbs-hint{font-size:12px;color:var(--tx2);margin:6px 0 0}
.pbs-checks{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.pbs-checks li{display:flex;gap:10px;align-items:flex-start;padding:9px 10px;border-radius:8px;font-size:13px}
.pbs-checks li.block{background:var(--bad-bg2)}.pbs-checks li.warn{background:var(--warn-bg2)}
.pbs-checks li .grow{flex:1;min-width:0}
.pbs-ci{width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#fff;flex:none;margin-top:-1px}
.pbs-ci.pass{background:var(--ok)}.pbs-ci.warn{background:var(--warn);color:#000}.pbs-ci.block{background:var(--bad)}
.pbs-ack{display:flex;gap:10px;align-items:flex-start;font-size:13px;cursor:pointer}
.pbs-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:0 0 20px}
.pbs-kpi{border:1px solid var(--bd);border-radius:8px;padding:14px 16px;background:#fff}
.pbs-kpi .l{font-size:12px;color:var(--tx2)}.pbs-kpi .v{font-size:22px;font-weight:700;margin-top:4px;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.pbs-kpi .n{font-size:12px;color:var(--tx2);margin-top:2px}
.pbs-bar{height:8px;border-radius:4px;background:var(--sf);overflow:hidden;display:flex;min-width:120px;flex:1}
.pbs-bar span{display:block;height:100%}
.pbs-table.dense th,.pbs-table.dense td{padding-left:10px;padding-right:10px;white-space:nowrap}
.pbs-table.dense td{font-size:12.5px}
.pbs-table tfoot td{font-weight:700;border-top:1px solid var(--bd);background:var(--sf2);padding:12px 16px;font-size:13px}
.pbs-table tbody tr.bad td{background:var(--bad-bg2)}
.pbs-table tbody tr.open td{background:var(--p-tint2)}
.pbs-table tbody tr.sub td{background:var(--sf2);padding:0 16px 14px}
.pbs-table tbody tr.sub:hover td{background:var(--sf2)}
.pbs-sub-t{width:auto;min-width:640px;border-collapse:collapse;font-size:12px;background:#fff;border:1px solid var(--bd);border-radius:8px}
.pbs-sub-t th{font-weight:500;color:var(--tx2);text-align:left;padding:7px 10px;border-bottom:1px solid var(--bd);background:#fff;font-size:11.5px}
.pbs-sub-t td{padding:7px 10px;border-top:1px solid var(--row)}
.pbs-sub-t .r{text-align:right}
.pbs-exp{border:0;background:none;cursor:pointer;padding:4px;border-radius:6px;display:inline-flex;color:var(--tx2)}
.pbs-exp:hover{background:var(--sf)}.pbs-exp svg{transition:transform .15s}.pbs-exp.on svg{transform:rotate(180deg)}
.pbs-tl{list-style:none;margin:0;padding:0;max-width:760px}
.pbs-tl>li{position:relative;padding:0 0 24px 44px;min-height:28px}
.pbs-tl>li::before{content:"";position:absolute;left:13px;top:30px;bottom:2px;width:2px;background:var(--bd)}
.pbs-tl>li:last-child::before{display:none}
.pbs-tl>li.done::before{background:var(--ok)}
.pbs-tl-c{position:absolute;left:0;top:0;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#E8E8E8;color:#60686E;font-size:12px;font-weight:700}
.pbs-tl-c.inl{position:static;flex:none}
.pbs-tl-c.done{background:var(--ok);color:#fff}.pbs-tl-c.active{background:var(--p);color:#fff;box-shadow:0 0 0 4px var(--p-tint)}
.pbs-tl-c.rejected{background:var(--bad);color:#fff}.pbs-tl-c.skipped{background:#fff;border:2px dashed #C8CDD1;color:#9AA1A6}
.pbs-tl-t{font-size:14px;font-weight:600;line-height:28px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pbs-tl-m{font-size:12px;color:var(--tx2)}
.pbs-tl .skipped-row{opacity:.55}
.pbs-tl-par{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:4px}
.pbs-tl-card{border:1px solid var(--bd);border-radius:8px;padding:12px 14px;display:flex;gap:12px;align-items:flex-start;background:#fff}
.pbs-tl-card .pbs-tl-t{line-height:1.4}
.pbs-quote{margin:8px 0 0;padding:8px 12px;border-left:3px solid var(--bd);background:var(--sf2);font-size:12.5px;border-radius:0 6px 6px 0}
.pbs-search{position:relative;display:inline-flex;align-items:center}
.pbs-search input{height:34px;border:1px solid var(--bd);border-radius:20px;background:#fff;padding:0 14px 0 34px;font-size:12.5px;width:230px;outline:none}
.pbs-search input:focus{border-color:var(--p);box-shadow:0 0 0 3px var(--p-tint)}
.pbs-search svg{position:absolute;left:12px;color:var(--tx2);pointer-events:none}
.pbs-rec{display:flex;align-items:center;gap:20px;padding:18px 22px;flex-wrap:wrap;margin:0 0 16px}
.pbs-rec-code{font-size:18px;font-weight:700;letter-spacing:-.01em;white-space:nowrap}
.pbs-rec-g{display:flex;align-items:center;gap:20px;flex-wrap:wrap;flex:1;min-width:0}
.pbs-rec-m{display:flex;flex-direction:column;justify-content:center;gap:2px;padding-left:20px;border-left:1px solid var(--bd);min-height:40px}
.pbs-rec-m .l{font-size:12px;color:var(--tx2)}.pbs-rec-m .v{font-size:14px;font-weight:600;white-space:nowrap}
.pbs-kvr{display:flex;align-items:center;gap:16px;padding:13px 18px;border-top:1px solid var(--row);font-size:14px;min-height:52px}
.pbs-kvr:first-child{border-top:0}
.pbs-kvr .k{min-width:160px;color:var(--tx2)}.pbs-kvr .v{flex:1;min-width:0;word-break:break-word;color:var(--tx)}
.pbs-kvr .v.masked{letter-spacing:.08em;font-variant-numeric:tabular-nums}
.pbs-kvr.on{background:var(--warn-bg2)}
.pbs-score{font-size:40px;font-weight:700;line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.pbs-bands{position:relative;height:8px;display:flex;gap:2px;margin:22px 0 6px}
.pbs-bands span{height:100%;border-radius:2px;min-width:4px}
.pbs-bands i{position:absolute;top:-6px;width:4px;height:20px;background:#000;border:1px solid #fff;border-radius:2px;transform:translateX(-50%)}
.pbs-bands-l{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--tx2)}
.pbs-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start}
@media (max-width:860px){.pbs-two{grid-template-columns:minmax(0,1fr)}}
.pbs-table tbody tr.void td{color:var(--dis);text-decoration:line-through}
.pbs-table tbody tr.muted td{color:var(--tx2)}
.pbs-t-ok{color:var(--ok-tx)}.pbs-t-bad{color:var(--bad-tx)}.pbs-t-warn{color:var(--warn-ic)}.pbs-t-info{color:var(--p-dk)}
.pbs-ic-btn{border:0;background:none;padding:0;display:inline-flex;color:var(--warn-ic);cursor:help;vertical-align:middle}
.pbs-periods{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:6px}
.pbs-periods li{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;font-size:13px}
.pbs-modal.wide{width:1080px}
.pbs-rv{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:16px;align-items:start}
@media (max-width:900px){.pbs-rv{grid-template-columns:minmax(0,1fr)}}
@container (max-width:900px){.pbs-rv{grid-template-columns:minmax(0,1fr)}}
.pbs-rowact{display:inline-flex;gap:8px;justify-content:flex-end;white-space:nowrap}
.pbs-rev-row{display:flex;align-items:center;gap:12px;padding:10px;border-top:1px solid var(--row);cursor:pointer}
.pbs-rev-row.off{cursor:default;color:var(--dis)}
.pbs-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
/* ---- Host app (pbs_Host.*): one centred column, mobile first; layout follows the control width ---- */
.pbs-root.hc{container-type:inline-size;background:#fff}
.hc-col{max-width:720px;margin:0 auto;padding:24px 20px 40px}
.hc-hi{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin:0 0 20px}
.hc-hi h1{font-size:24px;font-weight:700;letter-spacing:-.02em;margin:0;line-height:1.25}
.hc-hi p{margin:6px 0 0;color:var(--tx2);font-size:13px}
.hc-hi img{width:56px;height:auto;flex:none}
.hc-card{background:#fff;border:1px solid var(--bd);border-radius:8px;padding:18px}
.hc-stack{display:grid;gap:12px}
.hc-shift{display:grid;gap:14px}
.hc-shift-h{display:flex;align-items:center;gap:12px}
.hc-ic{width:40px;height:40px;border-radius:8px;background:var(--p-tint);color:var(--p-dk);display:inline-flex;align-items:center;justify-content:center;flex:none}
.hc-ic.warn{background:var(--warn-bg);color:var(--warn-ic)}.hc-ic.bad{background:var(--bad-bg);color:var(--bad-tx)}.hc-ic.ok{background:var(--ok-bg);color:var(--ok-tx)}
.hc-big{height:52px;font-size:16px;border-radius:26px;width:100%}
.hc-note{font-size:12px;color:var(--tx2);text-align:center;margin:0}
.hc-sess{display:grid;grid-template-columns:118px minmax(0,1fr) auto;gap:14px;align-items:center;padding:14px 16px;border:1px solid var(--bd);border-radius:8px;background:#fff}
.hc-sess.now{border-color:var(--p);box-shadow:inset 3px 0 0 var(--p)}
.hc-sess.bad{border-color:var(--bad-bd);background:var(--bad-bg2)}
.hc-sess.off{color:var(--tx2)}
.hc-time{font-weight:700;font-size:14px;font-variant-numeric:tabular-nums;white-space:nowrap}
.hc-time small{display:block;font-weight:400;font-size:11.5px;color:var(--tx2);margin-top:2px}
.hc-sess-t{font-weight:700;font-size:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.hc-sess-m{font-size:12px;color:var(--tx2);margin-top:3px}
.hc-sess-a{display:flex;align-items:center;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.hc-plat{font-size:10.5px;font-weight:600;color:var(--tx2);background:var(--sf);border-radius:4px;padding:2px 6px}
.hc-todo{display:flex;gap:14px;align-items:flex-start;padding:16px;border:1px solid var(--bd);border-radius:8px;background:#fff}
.hc-todo.bad{border-color:var(--bad-bd);background:var(--bad-bg2)}
.hc-todo.warn{border-color:var(--warn-bd);background:var(--warn-bg2)}
.hc-todo-b{flex:1;min-width:0}
.hc-todo-t{font-weight:700;font-size:14px;margin:0}
.hc-todo-x{font-size:12.5px;color:var(--tx2);margin:4px 0 0}
.hc-score{display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.hc-score-n{font-size:30px;font-weight:700;letter-spacing:-.02em;line-height:1}
.hc-score-d{font-size:11.5px;font-weight:600}
.hc-score-x{flex:1;min-width:180px;font-size:12.5px;color:var(--tx2);border-left:1px solid var(--bd);padding-left:18px}
.hc-chips{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}
.hc-chip{height:34px;border-radius:17px;border:1px solid var(--bd);background:#fff;padding:0 14px;font-size:12.5px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.hc-chip.on{background:var(--p);border-color:var(--p);color:#fff}
.hc-chip .n{font-weight:400;opacity:.8}
.hc-list{border:1px solid var(--bd);border-radius:8px;overflow:hidden}
.hc-row{display:grid;grid-template-columns:72px minmax(0,1fr) 130px 150px 64px;gap:12px;align-items:center;padding:13px 16px;border-top:1px solid var(--bd);background:#fff;font-size:13px}
.hc-row.head{border-top:0;background:var(--sf);color:var(--tx2);font-size:12px;font-weight:500;padding:10px 16px}
.hc-row.bad{background:var(--bad-bg2)}
.hc-row .r{text-align:right}
.hc-row.cmp{grid-template-columns:minmax(0,1fr) 120px 120px 90px}
.hc-row.cmp1{grid-template-columns:minmax(0,1fr) 140px}
.hc-field{display:grid;gap:6px;min-width:0}
.hc-field label{font-size:12.5px;font-weight:600}
.hc-field input{height:44px;border:1px solid var(--bd);border-radius:8px;padding:0 14px;font-size:14px;text-align:right;font-variant-numeric:tabular-nums;width:100%;background:#fff}
.hc-field input:focus{outline:none;border-color:var(--p);box-shadow:0 0 0 3px var(--p-tint)}
.hc-field input:disabled{background:var(--sf);color:var(--tx2)}
.hc-field.flag label{color:var(--bad-tx)}
.hc-field.flag input{border-color:var(--bad);background:var(--bad-bg2)}
.hc-field.warn input{border-color:var(--warn)}
.hc-field .h{font-size:11.5px;color:var(--tx2)}
.hc-field .h.w{color:var(--warn-ic)}
.hc-grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px 16px}
.hc-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px 16px}
.hc-drop{display:flex;align-items:center;gap:14px;padding:14px;border:1px dashed var(--info-bd);border-radius:8px;background:var(--p-tint2)}
.hc-drop.has{border-style:solid;border-color:var(--bd);background:#fff}
.hc-thumb{width:84px;height:64px;border-radius:6px;background:var(--sf);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none;color:var(--tx2)}
.hc-thumb img{width:100%;height:100%;object-fit:cover}
.hc-foot{display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap;border-top:1px solid var(--bd);padding-top:16px;margin-top:4px}
.hc-foot p{margin:0;font-size:12px;color:var(--tx2);flex:1;min-width:220px}
.hc-flag{border:1px solid var(--warn-bd);background:var(--warn-bg2);border-radius:8px;padding:14px 16px}
.hc-flag-h{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-weight:700}
.hc-flag-v{display:flex;gap:20px;flex-wrap:wrap;margin-top:6px;font-size:12.5px;color:var(--tx2)}
.hc-flag-v b{color:var(--tx)}
.hc-quote{border:1px solid var(--info-bd);background:var(--info-bg);border-radius:8px;padding:12px 14px;display:flex;gap:10px;font-size:13px}
.hc-prog{height:6px;border-radius:3px;background:var(--p-tint);overflow:hidden}
.hc-prog i{display:block;height:100%;background:var(--p);transition:width .2s}
.hc-col.wide{max-width:1160px}
.hc-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 16px}
.hc-kpi{display:flex;gap:12px;align-items:center;border:1px solid var(--bd);border-radius:8px;padding:14px 16px;background:#fff;min-width:0}
.hc-kpi .l{font-size:12px;font-weight:600;color:var(--tx2)}
.hc-kpi .v{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;margin-top:2px;white-space:nowrap}
.hc-kpi .v small{font-size:12px;font-weight:400;color:var(--tx2);margin-left:5px}
.hc-today{display:flex;align-items:center;gap:14px;flex-wrap:wrap;border:1px solid var(--info-bd);background:var(--info-bg);border-radius:8px;padding:14px 16px;margin:0 0 16px}
.hc-today.bad{border-color:var(--bad-bd);background:var(--bad-bg2)}
.hc-today .b{flex:1;min-width:240px}
.hc-today-t{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.hc-today-n{border:0;background:none;padding:0;font:inherit;font-weight:700;font-size:14.5px;color:var(--tx);cursor:pointer;text-align:left}
.hc-today-n:hover{color:var(--p-dk);text-decoration:underline}
.hc-today-a{display:flex;gap:8px;flex-wrap:wrap}
.hc-tag{font-size:10px;font-weight:700;letter-spacing:.05em;color:var(--p-dk);background:#fff;border:1px solid var(--info-bd);border-radius:4px;padding:2px 6px}
.hc-grow{flex:1;min-width:200px}.hc-grow input{width:100%}
.hc-row.sch{grid-template-columns:var(--gt)}
.hc-row.click{cursor:pointer}.hc-row.click:hover{background:var(--sf)}
.hc-row.today{background:var(--p-tint2)}
.hc-row.off{color:var(--tx2)}.hc-row.off .hc-brand{text-decoration:line-through;font-weight:600}
.hc-row .only-s,.hc-row .only-m{display:none;font-size:11.5px;margin-top:2px}
.hc-brand{font-weight:700;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hc-ell{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hc-b{font-weight:700}
.hc-id{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}
.hc-crumb{display:inline-flex;align-items:center;gap:6px;margin:0 0 12px}
.hc-steps{list-style:none;margin:0;padding:0}
.hc-step{display:grid;grid-template-columns:28px minmax(0,1fr);gap:12px;align-items:start;padding:12px 0;border-top:1px solid var(--bd);position:relative}
.hc-step:first-child{border-top:0}
.hc-step-t{font-weight:700;font-size:13.5px}
.hc-step-x{font-size:12.5px;color:var(--tx2);margin-top:2px}
.hc-step.skip .hc-step-t{color:var(--tx2)}
.hc-dot{width:28px;height:28px;border-radius:14px;display:inline-flex;align-items:center;justify-content:center;background:var(--sf);color:var(--tx2);font-size:12px;font-weight:700}
.hc-dot.done{background:var(--ok-bg);color:var(--ok-tx)}.hc-dot.now{background:var(--p);color:#fff}
.hc-dot.bad{background:var(--bad-bg);color:var(--bad-tx)}.hc-dot.missing{background:var(--warn-bg);color:var(--warn-ic)}
.hc-dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px 16px;margin:0}
.hc-dl dt{font-size:11.5px;color:var(--tx2)}
.hc-dl dd{margin:2px 0 0;font-weight:600;font-size:13.5px;overflow-wrap:anywhere}
.hc-dl .flag dt,.hc-dl .flag dd{color:var(--bad-tx)}
.hc-card.hc-bad{border-color:var(--bad-bd)}
.hc-todo.now{border-color:var(--p);box-shadow:inset 3px 0 0 var(--p)}
.hc-todo.ok{border-color:var(--ok-bd,var(--bd))}
.hc-other{display:grid;grid-template-columns:96px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 0;border:0;border-top:1px solid var(--bd);background:none;font:inherit;font-size:13px;text-align:left;cursor:pointer;color:var(--tx)}
.hc-other:first-child{border-top:0}.hc-other:hover .hc-ell{color:var(--p-dk)}
@container (max-width:900px){
  .hc-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
  .hc-row.sch{grid-template-columns:var(--gt-m)}
  .hc-row .hide-m{display:none}
  .hc-row .only-m{display:block}
}
@container (max-width:560px){
  .hc-col{padding:16px 16px 32px}
  .hc-row.sch{grid-template-columns:var(--gt-s)}
  .hc-row .only-m{display:none}
  .hc-row .only-s{display:block}
  .hc-kpi{padding:12px}
  .hc-kpi .hc-ic{display:none}
  .hc-kpi .v small{display:block;margin:0}
  .hc-dl{grid-template-columns:repeat(2,minmax(0,1fr))}
  .hc-other{grid-template-columns:80px minmax(0,1fr)}
  .hc-other .pbs-badge{grid-column:2}
  .hc-sess{grid-template-columns:minmax(0,1fr);gap:8px}
  .hc-sess-a{justify-content:flex-start}
  .hc-row{grid-template-columns:48px minmax(0,1fr) auto auto;padding:12px}
  .hc-row .hide-s{display:none}
  .hc-row.cmp{grid-template-columns:minmax(0,1fr) auto auto auto;gap:10px;font-size:12.5px}
  .hc-row.cmp1{grid-template-columns:minmax(0,1fr) auto}
  .hc-grid2,.hc-grid3{grid-template-columns:minmax(0,1fr)}
  .hc-score-x{border-left:0;padding-left:0}
  .hc-todo{flex-wrap:wrap;row-gap:10px}
  .hc-todo-b{flex-basis:calc(100% - 54px)}
  .hc-todo>button{margin-left:54px}
}
`;

let fontsInjected = false;
export function injectFonts(): void {
  if (fontsInjected || typeof document === "undefined") return;
  fontsInjected = true;
  if (document.getElementById("pbs-ops-fonts")) return;
  const el = document.createElement("style");
  el.id = "pbs-ops-fonts";
  el.textContent = FONT_CSS;
  document.head.appendChild(el);
}
