# PBS Hub — Ops Console PCF (Dashboard, Report, Report Detail, Payroll)

Power Apps code components (PCF) untuk canvas app PBS Hub, dibuat dari design handoff
*PBS Ops Console* (artboard 3a/3b, 4a, 4b–4d, Payroll P-1–P-5) dengan data mapping mengikuti `DESIGN.md`
(list SharePoint v1: `Report - PBS Hub`, `Report Automation - PBS Hub`, `Schedule - PBS Hub`,
`Clock In - PBS Hub`, `Host`, `Studio`, `Brand`, `Payroll`, `Payroll Data`).

| Control | Layar | Folder |
|---|---|---|
| `pbs_Ops.Dashboard` | Dashboard — antrean yang menunggu tim hari ini | `controls/Dashboard` |
| `pbs_Ops.ReportReview` | Report — antrean rekonsiliasi / daftar report | `controls/ReportReview` |
| `pbs_Ops.ReportDetail` | Report detail — adjudikasi klaim host vs bukti AI | `controls/ReportDetail` |
| `pbs_Ops.PayrollRuns` | Payroll — daftar run + preflight Jalankan payroll (P-1, P-2) | `controls/PayrollRuns` |
| `pbs_Ops.PayrollRunDetail` | Detail run — baris per host, tracker approval, status slip (P-3–P-5) | `controls/PayrollRunDetail` |

**Output:** `dist/PBSHubOpsPCF_1_1_0_0_managed.zip` — managed solution, dibangun dengan target MSBuild
resmi Power Platform (`Microsoft.PowerApps.MSBuild.Solution`).

Cara pasang dan formula Power Fx lengkap (properti, `OnChange`, Patch ke SharePoint):
[`docs/CANVAS-INTEGRATION.md`](docs/CANVAS-INTEGRATION.md).

## Struktur

```
shared/            logika + UI bersama (dipakai semua control)
  data.ts          pembaca baris JSON canvas yang defensif (Choice {Value}, Person, nama internal SP)
  reconcile.ts     join Report ↔ Report Automation, aturan ±5 % PBS0005A, enam Alasan
  dashboard.ts     agregasi kartu dashboard
  payroll.ts       periode (P8), gate approval dari Status + kolom audit, preflight, baris per host
  contract.ts      Context, ActionPayload/ActionResult, useAction (requestId lock)
  ui.tsx styles.ts token Blu Basic internal-app, badge, tombol pill, 4 state tabel
controls/<Name>/   project PCF (ControlManifest.Input.xml, index.ts, *View.tsx, .pcfproj)
solution/          project solusi Dataverse (cdsproj, SolutionPackageType = Managed)
harness/           halaman uji lokal + data contoh v1 + skrip Playwright
tests/             unit test Jest untuk logika data
```

## Build

```bash
npm install
npm test                 # unit test logika (Jest)
npm run build            # build 5 control (pcf-scripts, production)
npm run typecheck
npm run solution         # managed zip → dist/  (butuh .NET SDK 8+)
```

Uji tampilan tanpa Power Apps: `npm run build`, lalu buka `harness/index.html` di browser
(`?c=Dashboard`, `?c=ReportReview`, `?c=ReportDetail&r=RPT-20862`, `?c=PayrollRuns&pay=none`, `?c=PayrollRunDetail&run=118`).
`node harness/flows.js <dir>` menjalankan cek interaksi (approve → mengirim → hasil, konflik, revisi, bulk approve,
filter, paging, preflight payroll, expand baris, kirim ulang slip).

## Keputusan desain

- **PCF tidak menulis.** Semua tulis lewat `ActionPayload` → `OnChange` canvas → `ActionResult`. Tombol
  terkunci sampai `requestId` kembali; sukses tidak diklaim sebelum canvas membalas.
- **Standard control dengan React di-bundle** (bukan virtual control), karena dukungan virtual React control
  di canvas belum terverifikasi di tenant ini.
- **Data lewat JSON teks**, di-shape di canvas dengan `ForAll(…)`. Tidak ada `KTP`/`NoRekening`/GPS/selfie
  yang masuk control; dashboard cukup `HasRekening`.
- **Kosakata status v1 dipertahankan** (`Waiting Approval`, `Need Revision`, `Done`, `Match`/`Unmatch`) supaya
  PBS0005A dan layar v1 tetap konsisten.
- **Payroll dibaca apa adanya dari v1.** Periode data = label − 1 bulan (P8), total dari `Payroll Data` (P9),
  gate dari `Status` + kolom `…Approval`. Preflight memblokir periode ganda (P11) dan host tanpa rekening.
- **Font Blibli** di-subset (Latin) dan di-embed sebagai woff2 (~14 KB per weight).

## Tampilan (harness, data contoh)

| Dashboard | Report | Report detail |
|---|---|---|
| ![](docs/screenshots/dashboard.png) | ![](docs/screenshots/report-review.png) | ![](docs/screenshots/report-detail.png) |

| Payroll | Preflight | Detail run | Approval |
|---|---|---|---|
| ![](docs/screenshots/payroll-runs.png) | ![](docs/screenshots/payroll-preflight.png) | ![](docs/screenshots/payroll-detail.png) | ![](docs/screenshots/payroll-approval.png) |
