import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function client(){return new S3Client({region:process.env.AWS_DEFAULT_REGION||"auto",endpoint:process.env.AWS_ENDPOINT_URL,credentials:{accessKeyId:process.env.AWS_ACCESS_KEY_ID||"",secretAccessKey:process.env.AWS_SECRET_ACCESS_KEY||""},forcePathStyle:false})}
export async function uploadUrl(key:string,contentType:string){if(!process.env.AWS_S3_BUCKET_NAME)return `/api/uploads/local/${encodeURIComponent(key)}`;return getSignedUrl(client(),new PutObjectCommand({Bucket:process.env.AWS_S3_BUCKET_NAME,Key:key,ContentType:contentType}),{expiresIn:600})}
export async function viewUrl(key:string){if(!process.env.AWS_S3_BUCKET_NAME)return `/api/uploads/local/${encodeURIComponent(key)}`;return getSignedUrl(client(),new GetObjectCommand({Bucket:process.env.AWS_S3_BUCKET_NAME,Key:key}),{expiresIn:300})}
