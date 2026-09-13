// Client-side and server-side driver photo utilities
// Includes WebP compression (max 1600x1200, 0.70 quality) for delivery proof (POD)
// and avatar normalization for dispatcher records.

export interface CompressPhotoOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  maxSizeBytes?: number;
}

export interface CompressedPhotoResult {
  blob: Blob;
  base64: string;
  dataUrl: string;
  file: File;
  width: number;
  height: number;
  format: "image/webp";
  size: number;
}

/**
 * Calculates aspect-ratio preserving dimensions capped at maxWidth x maxHeight.
 */
export function calculateDimensions(
  origWidth: number,
  origHeight: number,
  maxWidth = 1600,
  maxHeight = 1200,
): { width: number; height: number } {
  const safeMaxW = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : 1600;
  const safeMaxH = Number.isFinite(maxHeight) && maxHeight > 0 ? maxHeight : 1200;
  const safeW = Number.isFinite(origWidth) && origWidth > 0 ? origWidth : safeMaxW;
  const safeH = Number.isFinite(origHeight) && origHeight > 0 ? origHeight : safeMaxH;
  let width = safeW;
  let height = safeH;
  if (width > safeMaxW || height > safeMaxH) {
    const ratio = Math.min(safeMaxW / width, safeMaxH / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

/**
 * Converts an ArrayBuffer to a base64 string safely in chunks to avoid stack overflow.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer | ArrayBufferView): string {
  const bytes = ArrayBuffer.isView(buffer)
    ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  if (typeof btoa === "function") {
    return btoa(binary);
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  }
  throw new Error("Base64 encoding not supported in this environment");
}

/**
 * Adaptive step-down parameters for guaranteed loop termination without freezing.
 * Returns null when lowest acceptable quality / dimension limit is reached.
 */
export function getNextStepDown(
  currentW: number,
  currentH: number,
  q: number,
): { nextW: number; nextH: number; nextQ: number } | null {
  if (q > 0.40) {
    return {
      nextW: currentW,
      nextH: currentH,
      nextQ: Math.max(0.30, +(q - 0.15).toFixed(2)),
    };
  }
  if (currentW > 640) {
    return {
      nextW: Math.max(480, Math.round(currentW * 0.80)),
      nextH: Math.max(360, Math.round(currentH * 0.80)),
      nextQ: q,
    };
  }
  if (q > 0.20) {
    return {
      nextW: currentW,
      nextH: currentH,
      nextQ: Math.max(0.15, +(q - 0.10).toFixed(2)),
    };
  }
  if (currentW > 320) {
    return {
      nextW: Math.max(320, Math.round(currentW * 0.80)),
      nextH: Math.max(240, Math.round(currentH * 0.80)),
      nextQ: q,
    };
  }
  return null;
}

/**
 * Client-Side WebP Compression:
 * Resizes heavy camera photos (max 1600x1200px) and encodes them as image/webp at 0.70 quality
 * before network transmission.
 */
export async function compressDriverPhoto(
  file: File | Blob,
  options: CompressPhotoOptions = {},
): Promise<CompressedPhotoResult> {
  const maxWidth = options.maxWidth ?? 1600;
  const maxHeight = options.maxHeight ?? 1200;
  const targetQuality = options.quality ?? 0.70;
  const maxSizeBytes = options.maxSizeBytes ?? 350 * 1024; // 350KB acceptance criteria

  // 1. Browser: Prefer OffscreenCanvas if available
  if (
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap === "function"
  ) {
    try {
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch {
        bitmap = await createImageBitmap(file);
      }
      try {
        const initialDims = calculateDimensions(
          bitmap.width,
          bitmap.height,
          maxWidth,
          maxHeight,
        );

        let currentW = initialDims.width;
        let currentH = initialDims.height;
        let q = targetQuality;

        let canvas = new OffscreenCanvas(currentW, currentH);
        let ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0, currentW, currentH);

          let blob = await canvas.convertToBlob({
            type: "image/webp",
            quality: q,
          });

          // Guaranteed terminating step-down (max 12 iterations)
          for (let step = 0; step < 12 && blob.size > maxSizeBytes; step++) {
            const next = getNextStepDown(currentW, currentH, q);
            if (!next) break;

            currentW = next.nextW;
            currentH = next.nextH;
            q = next.nextQ;

            canvas = new OffscreenCanvas(currentW, currentH);
            ctx = canvas.getContext("2d");
            if (!ctx) break;
            ctx.drawImage(bitmap, 0, 0, currentW, currentH);

            blob = await canvas.convertToBlob({
              type: "image/webp",
              quality: q,
            });
          }

          const arrayBuffer = await blob.arrayBuffer();
          const base64 = arrayBufferToBase64(arrayBuffer);
          const dataUrl = `data:image/webp;base64,${base64}`;
          const fileName = (file as File).name
            ? (file as File).name.replace(/\.[^/.]+$/, "") + ".webp"
            : "photo.webp";
          const webpFile = new File([blob], fileName, {
            type: "image/webp",
            lastModified: Date.now(),
          });

          return {
            blob,
            base64,
            dataUrl,
            file: webpFile,
            width: currentW,
            height: currentH,
            format: "image/webp",
            size: blob.size,
          };
        }
      } finally {
        try {
          bitmap.close();
        } catch {}
      }
    } catch (e) {
      console.warn("OffscreenCanvas compression fallback:", e);
    }
  }

  // 2. Browser: HTMLCanvasElement fallback
  if (typeof document !== "undefined") {
    return new Promise<CompressedPhotoResult>((resolve, reject) => {
      let objectUrl: string | null = null;
      try {
        if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
          objectUrl = URL.createObjectURL(file);
        }
      } catch {}

      const ImageConstructor =
        typeof window !== "undefined" && window.Image
          ? window.Image
          : typeof Image !== "undefined"
            ? Image
            : null;
      if (!ImageConstructor) {
        reject(new Error("Image constructor não disponível neste ambiente"));
        return;
      }
      const img = new ImageConstructor();
      const cleanup = () => {
        if (objectUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
          URL.revokeObjectURL(objectUrl);
        }
      };

      img.onerror = () => {
        cleanup();
        reject(new Error("Erro ao carregar imagem"));
      };

      img.onload = async () => {
        cleanup();
        try {
          const initialDims = calculateDimensions(
            img.width,
            img.height,
            maxWidth,
            maxHeight,
          );

          let currentW = initialDims.width;
          let currentH = initialDims.height;
          let q = targetQuality;

          let canvas = document.createElement("canvas");
          canvas.width = currentW;
          canvas.height = currentH;
          let ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Canvas context não disponível"));
            return;
          }

          ctx.drawImage(img, 0, 0, currentW, currentH);

          const encodeCanvasToBlob = (cvs: HTMLCanvasElement, quality: number) =>
            new Promise<Blob>((resBlob, rejBlob) => {
              cvs.toBlob(
                (b) => {
                  if (b) return resBlob(b);
                  try {
                    const dUrl = cvs.toDataURL("image/webp", quality);
                    const b64 = dUrl.replace(/^data:image\/[^;]+;base64,/, "");
                    const binaryStr = atob(b64);
                    const bytes = new Uint8Array(binaryStr.length);
                    for (let i = 0; i < binaryStr.length; i++) {
                      bytes[i] = binaryStr.charCodeAt(i);
                    }
                    resBlob(new Blob([bytes], { type: "image/webp" }));
                  } catch (err) {
                    rejBlob(err);
                  }
                },
                "image/webp",
                quality,
              );
            });

          let finalBlob = await encodeCanvasToBlob(canvas, q);

          // Guaranteed terminating iterative step-down (non-recursive, max 12 steps)
          for (let step = 0; step < 12 && finalBlob.size > maxSizeBytes; step++) {
            const next = getNextStepDown(currentW, currentH, q);
            if (!next) break;

            currentW = next.nextW;
            currentH = next.nextH;
            q = next.nextQ;

            const nextCanvas = document.createElement("canvas");
            nextCanvas.width = currentW;
            nextCanvas.height = currentH;
            const nextCtx = nextCanvas.getContext("2d");
            if (!nextCtx) break;
            nextCtx.drawImage(img, 0, 0, currentW, currentH);
            canvas = nextCanvas;

            finalBlob = await encodeCanvasToBlob(canvas, q);
          }

          const buf = await finalBlob.arrayBuffer();
          const base64 = arrayBufferToBase64(buf);
          const dataUrl = `data:image/webp;base64,${base64}`;

          const fileName = (file as File).name
            ? (file as File).name.replace(/\.[^/.]+$/, "") + ".webp"
            : "photo.webp";
          const webpFile = new File([finalBlob], fileName, {
            type: "image/webp",
            lastModified: Date.now(),
          });

          resolve({
            blob: finalBlob,
            base64,
            dataUrl,
            file: webpFile,
            width: currentW,
            height: currentH,
            format: "image/webp",
            size: finalBlob.size,
          });
        } catch (err) {
          reject(err);
        }
      };

      if (objectUrl) {
        img.src = objectUrl;
      } else {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Erro ao ler arquivo da foto"));
        reader.onload = (e) => {
          img.src = e.target?.result as string;
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // 3. Node.js environment (for unit testing and server tasks)
  if (typeof window === "undefined") {
    try {
      const sharpModuleName = "sharp";
      const sharp = (await import(/* webpackIgnore: true */ sharpModuleName)).default;
      const buffer = Buffer.from(await file.arrayBuffer());
      const meta = await sharp(buffer).metadata();
      const origW = meta.width || maxWidth;
      const origH = meta.height || maxHeight;
      const { width, height } = calculateDimensions(origW, origH, maxWidth, maxHeight);

      let currentW = width;
      let currentH = height;
      let q = targetQuality;
      let outBuf = await sharp(buffer)
        .rotate()
        .resize(currentW, currentH, { fit: "inside" })
        .webp({ quality: Math.round(q * 100) })
        .toBuffer();

      // Guaranteed terminating step-down (max 12 iterations)
      for (let step = 0; step < 12 && outBuf.byteLength > maxSizeBytes; step++) {
        const next = getNextStepDown(currentW, currentH, q);
        if (!next) break;

        currentW = next.nextW;
        currentH = next.nextH;
        q = next.nextQ;

        outBuf = await sharp(buffer)
          .rotate()
          .resize(currentW, currentH, { fit: "inside" })
          .webp({ quality: Math.round(q * 100) })
          .toBuffer();
      }

      const base64 = outBuf.toString("base64");
      const dataUrl = `data:image/webp;base64,${base64}`;
      const blob = new Blob([outBuf], { type: "image/webp" });
      const fileName = (file as File).name
        ? (file as File).name.replace(/\.[^/.]+$/, "") + ".webp"
        : "photo.webp";
      const webpFile = new File([blob], fileName, {
        type: "image/webp",
        lastModified: Date.now(),
      });

      return {
        blob,
        base64,
        dataUrl,
        file: webpFile,
        width: currentW,
        height: currentH,
        format: "image/webp",
        size: outBuf.byteLength,
      };
    } catch (nodeErr) {
      throw new Error(`Falha ao comprimir imagem no ambiente Node: ${(nodeErr as Error).message}`);
    }
  }

  throw new Error("Ambiente não suporta manipulação de imagem");
}

// Alias for backwards compatibility
export const compressImage = compressDriverPhoto;

// Small, persistent avatars live with the driver record, not ephemeral disk.
export async function normalizeDriverPhoto(value: unknown): Promise<string | null> {
  if (value === null || value === "" || value === undefined) return null;
  if (
    typeof value !== "string" ||
    value.length > 700_000 ||
    !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
  ) {
    throw new Error("Foto inválida. Selecione uma imagem JPG, PNG ou WebP.");
  }
  try {
    const sharpModuleName = "sharp";
    const sharp = (await import(/* webpackIgnore: true */ sharpModuleName)).default;
    const input = Buffer.from(value.split(",")[1], "base64");
    const image = sharp(input, { limitInputPixels: 16_000_000 });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format || "")) throw new Error();
    const result = await image
      .rotate()
      .resize(256, 256, { fit: "cover" })
      .jpeg({ quality: 80 })
      .toBuffer();
    return `data:image/jpeg;base64,${result.toString("base64")}`;
  } catch {
    throw new Error("Não foi possível ler a foto. Selecione outra imagem.");
  }
}

function resolveStorageUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (typeof window !== "undefined" && window.location?.origin) {
    return new URL(url, window.location.origin).toString();
  }
  const base = process.env.APP_URL || process.env.NEXTAUTH_URL || process.env.BASE_URL || "http://localhost:3000";
  return new URL(url, base).toString();
}

/**
 * Envia uma foto comprimida para o S3 via URL pré-assinada.
 * Se o S3 não estiver configurado, retorna a chave local com fallback automático.
 */
export async function uploadPhotoToStorage(
  photoInput: CompressedPhotoResult | File | Blob,
  kind: "pod_photo" | "odometer" | "report" = "pod_photo",
  options?: CompressPhotoOptions
): Promise<{ objectKey: string; directS3: boolean; photo: CompressedPhotoResult; publicUrl?: string }> {
  // Garante compressão WebP antes da transmissão pela rede
  const photo: CompressedPhotoResult =
    photoInput && typeof photoInput === "object" && "blob" in photoInput && "format" in photoInput && (photoInput as CompressedPhotoResult).format === "image/webp"
      ? (photoInput as CompressedPhotoResult)
      : await compressDriverPhoto(photoInput as File | Blob, options);

  const presignRes = await fetch(resolveStorageUrl("/api/upload/presign"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: photo.file?.name || "proof.webp",
      contentType: photo.format,
      kind,
    }),
  });

  if (!presignRes.ok) {
    throw new Error("Erro ao obter autorização de upload");
  }

  const { directS3, uploadUrl, objectKey, publicUrl } = await presignRes.json();

  if (uploadUrl) {
    // Upload direto (S3 Presigned PUT ou fallback local)
    const uploadRes = await fetch(resolveStorageUrl(uploadUrl), {
      method: "PUT",
      headers: { "Content-Type": photo.format },
      body: photo.blob,
    });

    if (!uploadRes.ok) {
      throw new Error(`Falha no upload para storage (${uploadRes.status})`);
    }
  }

  return { objectKey, directS3, photo, publicUrl };
}

