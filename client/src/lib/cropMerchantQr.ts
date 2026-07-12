import jsQR from 'jsqr';

/** Load a File / data-URL into an ImageBitmap-compatible HTMLImageElement. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read image'));
    img.src = src;
  });
}

function canvasFromImage(img: HTMLImageElement, maxSide = 1600): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

type Point = { x: number; y: number };

function boundsFromPoints(points: Point[], padRatio: number, w: number, h: number) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const side = Math.max(maxX - minX, maxY - minY);
  const pad = side * padRatio;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const half = side / 2 + pad;
  const left = Math.max(0, Math.floor(cx - half));
  const top = Math.max(0, Math.floor(cy - half));
  const right = Math.min(w, Math.ceil(cx + half));
  const bottom = Math.min(h, Math.ceil(cy + half));
  const size = Math.min(right - left, bottom - top);
  return { left, top, size };
}

/**
 * Crop a merchant wallet screenshot down to the QR code (InstaPay / QR Ph).
 * Falls back to the original image if no QR is detected.
 */
export async function cropMerchantQr(fileOrDataUrl: File | string): Promise<{
  dataUrl: string;
  cropped: boolean;
}> {
  const dataUrl =
    typeof fileOrDataUrl === 'string'
      ? fileOrDataUrl
      : await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Could not read file'));
          reader.readAsDataURL(fileOrDataUrl);
        });

  const img = await loadImage(dataUrl);
  const canvas = canvasFromImage(img);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { dataUrl, cropped: false };

  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const code = jsQR(imageData.data, width, height, { inversionAttempts: 'attemptBoth' });

  if (!code?.location) {
    return { dataUrl, cropped: false };
  }

  const { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner } = code.location;
  const { left, top, size } = boundsFromPoints(
    [topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner],
    0.08,
    width,
    height,
  );

  if (size < 40) return { dataUrl, cropped: false };

  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const octx = out.getContext('2d');
  if (!octx) return { dataUrl, cropped: false };
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, size, size);
  octx.drawImage(canvas, left, top, size, size, 0, 0, size, size);

  return { dataUrl: out.toDataURL('image/png'), cropped: true };
}
