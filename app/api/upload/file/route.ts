import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const runtime = "nodejs";

/**
 * PUT/POST /api/upload/file?key=<objectKey>
 * Fallback local upload handler when AWS S3 is not configured.
 * Stores binary payload in upload_objects (PostgreSQL) and filesystem (.local-db/uploads).
 */
export async function PUT(req: NextRequest) {
  try {
    const session = (await getSession("dispatcher")) || (await getSession("driver"));
    if (!session) {
      return NextResponse.json({ error: "Sessão necessária para upload" }, { status: 401 });
    }

    const key = req.nextUrl.searchParams.get("key");
    if (!key) {
      return NextResponse.json({ error: "Chave do arquivo (key) é obrigatória" }, { status: 400 });
    }

    const contentType = req.headers.get("content-type") || "image/webp";
    const buffer = Buffer.from(await req.arrayBuffer());

    if (buffer.length === 0) {
      return NextResponse.json({ error: "Payload vazio" }, { status: 400 });
    }

    if (buffer.length > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "Tamanho do arquivo excede o limite de 10MB" }, { status: 400 });
    }

    await query(
      `INSERT INTO upload_objects (object_key, kind, content_type, size_bytes, file_data)
       VALUES ($1, 'pod_photo', $2, $3, $4)
       ON CONFLICT (object_key)
       DO UPDATE SET file_data = EXCLUDED.file_data, size_bytes = EXCLUDED.size_bytes, content_type = EXCLUDED.content_type`,
      [key, contentType, buffer.byteLength, buffer]
    );

    try {
      const uploadDir = resolve(process.cwd(), ".local-db", "uploads");
      await mkdir(uploadDir, { recursive: true });
      await writeFile(resolve(uploadDir, encodeURIComponent(key)), buffer);
    } catch {
      try {
        const tmpDir = resolve("/tmp", "uploads");
        await mkdir(tmpDir, { recursive: true });
        await writeFile(resolve(tmpDir, encodeURIComponent(key)), buffer);
      } catch {}
    }

    return NextResponse.json({
      ok: true,
      objectKey: key,
      sizeBytes: buffer.byteLength,
      url: `/api/uploads/local/${encodeURIComponent(key)}`,
    });
  } catch (err) {
    console.error("[upload/file]", err);
    return NextResponse.json({ error: "Erro ao salvar arquivo localmente" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return PUT(req);
}

export async function GET(req: NextRequest) {
  try {
    const key = req.nextUrl.searchParams.get("key");
    if (!key) {
      return NextResponse.json({ error: "Chave do arquivo (key) é obrigatória" }, { status: 400 });
    }

    try {
      const { rows } = await query(
        "SELECT content_type, file_data FROM upload_objects WHERE object_key=$1",
        [key]
      );
      if (rows[0]?.file_data) {
        const buf = Buffer.isBuffer(rows[0].file_data)
          ? rows[0].file_data
          : Buffer.from(rows[0].file_data);
        return new NextResponse(buf, {
          headers: {
            "Content-Type": rows[0].content_type || "image/webp",
            "Cache-Control": "public, max-age=86400",
          },
        });
      }
    } catch {}

    const { existsSync } = await import("node:fs");
    const { readFile } = await import("node:fs/promises");
    const safeName = encodeURIComponent(key);
    const candidates = [
      resolve(process.cwd(), ".local-db", "uploads", safeName),
      resolve("/tmp", "uploads", safeName),
    ];
    for (const filePath of candidates) {
      if (existsSync(filePath)) {
        const fileData = await readFile(filePath);
        return new NextResponse(fileData, {
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "public, max-age=86400",
          },
        });
      }
    }

    return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 });
  } catch (err) {
    console.error("[upload/file GET]", err);
    return NextResponse.json({ error: "Erro ao buscar arquivo localmente" }, { status: 500 });
  }
}
