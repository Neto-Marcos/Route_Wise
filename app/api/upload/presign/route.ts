import { NextRequest, NextResponse } from "next/server";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { query } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

function getS3Client() {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const endpoint = process.env.AWS_ENDPOINT_URL;

  if (!accessKeyId || !secretAccessKey) {
    return null;
  }

  return new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });
}

/**
 * POST /api/upload/presign
 * Body: { filename: string, contentType: string, kind: 'pod_photo' | 'odometer' | 'report' }
 * Retorna presigned URL do S3 e a chave final do objeto.
 * Se credenciais S3 não existirem, retorna fallback para salvar via banco/API interna.
 */
export async function POST(req: NextRequest) {
  try {
    const session = (await getSession("dispatcher")) || (await getSession("driver"));
    if (!session) {
      return NextResponse.json({ error: "Sessão necessária" }, { status: 401 });
    }

    const body = await req.json();
    const { filename, contentType, kind = "pod_photo" } = body;

    if (!contentType) {
      return NextResponse.json({ error: "contentType é obrigatório" }, { status: 400 });
    }

    const s3 = getS3Client();
    const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME || "routewise-proofs";
    const dateStr = new Date().toISOString().slice(0, 10);
    const uniqueId = crypto.randomUUID();
    const safeKind = typeof kind === "string" && /^[a-zA-Z0-9_-]{1,32}$/.test(kind) ? kind : "pod_photo";
    const rawExt = filename?.split(".").pop() || "webp";
    const ext = rawExt.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "webp";
    const objectKey = `${safeKind}/${dateStr}/${uniqueId}.${ext}`;

    // Se S3 estiver configurado, gera a Presigned URL de PUT
    if (s3) {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        ContentType: contentType,
      });

      const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 }); // 15 minutos

      // Grava no banco de dados para rastreio (resiliente a falhas transitórias de conexão)
      try {
        await query(
          "INSERT INTO upload_objects (object_key, kind, content_type) VALUES ($1, $2, $3)",
          [objectKey, safeKind, contentType]
        );
      } catch (dbErr) {
        console.warn("[upload/presign] DB tracking insert notice:", dbErr);
      }

      const s3Endpoint = process.env.AWS_ENDPOINT_URL;
      const s3Region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
      const publicUrl = process.env.AWS_CLOUDFRONT_URL
        ? `${process.env.AWS_CLOUDFRONT_URL.replace(/\/$/, "")}/${objectKey}`
        : s3Endpoint
        ? `${s3Endpoint.replace(/\/$/, "")}/${bucket}/${objectKey}`
        : s3Region === "us-east-1"
        ? `https://${bucket}.s3.amazonaws.com/${objectKey}`
        : `https://${bucket}.s3.${s3Region}.amazonaws.com/${objectKey}`;

      return NextResponse.json({
        directS3: true,
        uploadUrl,
        url: uploadUrl, // compatibility alias
        objectKey,
        key: objectKey, // compatibility alias
        publicUrl,
      });
    }

    // Fallback interno (sem S3 configurado)
    try {
      await query(
        "INSERT INTO upload_objects (object_key, kind, content_type) VALUES ($1, $2, $3)",
        [objectKey, safeKind, contentType]
      );
    } catch (dbErr) {
      console.warn("[upload/presign] DB fallback insert notice:", dbErr);
    }

    return NextResponse.json({
      directS3: false,
      objectKey,
      key: objectKey, // compatibility alias
      uploadUrl: `/api/upload/file?key=${encodeURIComponent(objectKey)}`,
      url: `/api/upload/file?key=${encodeURIComponent(objectKey)}`, // compatibility alias
      publicUrl: `/api/uploads/local/${encodeURIComponent(objectKey)}`,
    });
  } catch (err) {
    console.error("[upload/presign]", err);
    return NextResponse.json({ error: "Erro ao gerar URL de upload" }, { status: 500 });
  }
}
