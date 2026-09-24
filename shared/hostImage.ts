/**
 * The host picks a screenshot; the control shrinks it to a JPEG that fits the canvas → flow hop.
 * Seller-center screenshots are text, so the long edge stays large enough for the AI reader.
 */
export interface PreparedImage {
  base64: string; // no data: prefix
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  originalBytes: number;
  originalName: string;
}

export const base64Bytes = (b64: string): number => Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);

export function fitSize(w: number, h: number, maxPx: number): { width: number; height: number } {
  const long = Math.max(w, h);
  if (long <= maxPx) return { width: w, height: h };
  const k = maxPx / long;
  return { width: Math.round(w * k), height: Math.round(h * k) };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("File ini bukan gambar yang bisa dibaca. Pilih PNG atau JPG."));
    };
    img.src = url;
  });
}

export async function prepareImage(file: File, maxPx: number, maxKb: number): Promise<PreparedImage> {
  if (!/^image\//.test(file.type)) throw new Error("Pilih file gambar (PNG atau JPG).");
  const img = await loadImage(file);
  let { width, height } = fitSize(img.naturalWidth, img.naturalHeight, maxPx);
  const canvas = document.createElement("canvas");
  const draw = () => {
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("Browser tidak bisa memproses gambar.");
    g.fillStyle = "#fff"; // transparent PNG → white, not black, in JPEG
    g.fillRect(0, 0, width, height);
    g.drawImage(img, 0, 0, width, height);
  };
  draw();
  const limit = maxKb * 1024;
  let quality = 0.9;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  // Lower quality first, then size, until it fits.
  for (let i = 0; i < 8 && base64Bytes(dataUrl.slice(dataUrl.indexOf(",") + 1)) > limit; i++) {
    if (quality > 0.62) quality -= 0.1;
    else {
      width = Math.round(width * 0.85);
      height = Math.round(height * 0.85);
      draw();
    }
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return { base64, dataUrl, width, height, bytes: base64Bytes(base64), originalBytes: file.size, originalName: file.name };
}

export const fmtBytes = (n: number): string => (n >= 1048576 ? `${(n / 1048576).toLocaleString("id-ID", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
