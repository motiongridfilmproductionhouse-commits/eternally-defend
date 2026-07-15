import { RekognitionClient } from "@aws-sdk/client-rekognition";
import { S3Client } from "@aws-sdk/client-s3";

let _rek: RekognitionClient | null = null;
let _s3: S3Client | null = null;

function creds() {
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error("AWS credentials not configured (AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)");
  }
  return { region, credentials: { accessKeyId, secretAccessKey } };
}

export function getRekognition(): RekognitionClient {
  if (!_rek) _rek = new RekognitionClient(creds());
  return _rek;
}

export function getS3(): S3Client {
  if (!_s3) _s3 = new S3Client(creds());
  return _s3;
}

export function getBucket(): string {
  const b = process.env.AWS_REKOGNITION_BUCKET;
  if (!b) throw new Error("AWS_REKOGNITION_BUCKET not configured");
  return b;
}
