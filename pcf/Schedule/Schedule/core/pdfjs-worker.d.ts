// pdfjs-dist ships no types for the worker module; only its presence matters (main-thread "fake worker").
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
    export const WorkerMessageHandler: unknown;
}
