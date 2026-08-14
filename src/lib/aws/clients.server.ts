import { S3Client } from "@aws-sdk/client-s3";
import { getRekognitionClient } from "./rekognition-client.server";

let _s3: S3Client | null = null;
let _hasValidated = false;

function validateAndLog() {
  if (_hasValidated) return;
  const region = process.env.AWS_REGION?.trim();
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.AWS_REKOGNITION_BUCKET?.trim();

  const missing = [];
  if (!region) missing.push("AWS_REGION");
  if (!accessKeyId) missing.push("AWS_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("AWS_SECRET_ACCESS_KEY");
  if (!bucket) missing.push("AWS_REKOGNITION_BUCKET");

  if (missing.length > 0) {
    throw new Error(`AWS credentials not configured. Missing: ${missing.join(", ")}`);
  }

  console.log(`[AWS] Initialized successfully. Region: ${region} | Bucket: ${bucket}`);
  _hasValidated = true;
}

function creds() {
  validateAndLog();
  const region = process.env.AWS_REGION!.trim();
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID!.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY!.trim();
  return { region, credentials: { accessKeyId, secretAccessKey } };
}

export function getRekognition() {
  validateAndLog();
  return getRekognitionClient(process.env.AWS_REGION!.trim());
}

export function getS3(): S3Client {
  if (!_s3) _s3 = new S3Client(creds());
  return _s3;
}

export function getBucket(): string {
  validateAndLog();
  return process.env.AWS_REKOGNITION_BUCKET!.trim();
}
