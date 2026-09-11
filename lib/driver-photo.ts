import sharp from "sharp";

// Small, persistent avatars live with the driver record, not ephemeral disk.
export async function normalizeDriverPhoto(value: unknown): Promise<string | null> {
  if (value === null || value === "" || value === undefined) return null;
  if (typeof value !== "string" || value.length > 700_000 ||
      !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) {
    throw new Error("Foto inválida. Selecione uma imagem JPG, PNG ou WebP.");
  }
  try {
    const input = Buffer.from(value.split(",")[1], "base64");
    const image = sharp(input, { limitInputPixels: 16_000_000 });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format || "")) throw new Error();
    const result = await image.rotate().resize(256, 256, { fit: "cover" }).jpeg({ quality: 80 }).toBuffer();
    return `data:image/jpeg;base64,${result.toString("base64")}`;
  } catch {
    throw new Error("Não foi possível ler a foto. Selecione outra imagem.");
  }
}
