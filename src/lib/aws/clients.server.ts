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

  // An access key ID is always 20 chars beginning AKIA/ASIA. When the secret
  // access key value is pasted into AWS_ACCESS_KEY_ID (a common mix-up) AWS
  // rejects the signature with a message that mentions "region", which used to
  // be misreported as a region mismatch. Fail with the real cause instead.
  if (!/^(AKIA|ASIA)[A-Z0-9]{16}$/.test(accessKeyId!)) {
    throw new Error(
      "AWS_CREDENTIAL_FORMAT: AWS_ACCESS_KEY_ID is not a valid AWS access key ID " +
        `(length ${accessKeyId!.length}, expected 20 starting with AKIA/ASIA). ` +
        "It looks like a secret access key was stored in this variable.",
    );
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
  // Newer AWS SDK versions attach checksum headers/trailers to every PutObject by
  // default. Browsers uploading to a presigned URL never send those headers, and the
  // edge runtime cannot stream the aws-chunked trailer — both produce
  // "SignatureDoesNotMatch". Only compute checksums when the API actually requires it.
  if (!_s3)
    _s3 = new S3Client({
      ...creds(),
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  return _s3;
}


export function getBucket(): string {
  validateAndLog();
  return process.env.AWS_REKOGNITION_BUCKET!.trim();
}
