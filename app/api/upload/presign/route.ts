import { NextRequest, NextResponse } from "next/server";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { query } from "@/lib/db";

export const runtime = "nodejs";

function getS3Client() {
  const region = process.env.AWS_REGION || "us-east-1";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    return null;
  }

  return new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
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
    const body = await req.json();
    const { filename, contentType, kind = "pod_photo" } = body;

    if (!contentType) {
      return NextResponse.json({ error: "contentType é obrigatório" }, { status: 400 });
    }

    const s3 = getS3Client();
    const bucket = process.env.AWS_S3_BUCKET || "routewise-proofs";
    const dateStr = new Date().toISOString().slice(0, 10);
    const uniqueId = crypto.randomUUID();
    const ext = filename?.split(".").pop() || "webp";
    const objectKey = `${kind}/${dateStr}/${uniqueId}.${ext}`;

    // Se S3 estiver configurado, gera a Presigned URL de PUT
    if (s3) {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        ContentType: contentType,
      });

      const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 }); // 15 minutos

      // Grava no banco de dados para rastreio
      await query(
        "INSERT INTO upload_objects (object_key, kind, content_type) VALUES ($1, $2, $3)",
        [objectKey, kind, contentType]
      );

      return NextResponse.json({
        directS3: true,
        uploadUrl,
        objectKey,
        publicUrl: process.env.AWS_CLOUDFRONT_URL
          ? `${process.env.AWS_CLOUDFRONT_URL}/${objectKey}`
          : `https://${bucket}.s3.amazonaws.com/${objectKey}`,
      });
    }

    // Fallback interno (sem S3 configurado)
    await query(
      "INSERT INTO upload_objects (object_key, kind, content_type) VALUES ($1, $2, $3)",
      [objectKey, kind, contentType]
    );

    return NextResponse.json({
      directS3: false,
      objectKey,
      uploadUrl: `/api/upload/file?key=${encodeURIComponent(objectKey)}`,
    });
  } catch (err) {
    console.error("[upload/presign]", err);
    return NextResponse.json({ error: "Erro ao gerar URL de upload" }, { status: 500 });
  }
}
