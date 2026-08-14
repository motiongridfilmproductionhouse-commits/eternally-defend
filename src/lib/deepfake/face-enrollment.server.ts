import {CreateCollectionCommand,DescribeCollectionCommand,IndexFacesCommand} from "@aws-sdk/client-rekognition";
import { getRekognitionClient } from "@/lib/aws/rekognition-client.server";

const rekognition = { send: (cmd: any) => getRekognitionClient().send(cmd) };

function cleanExternalImageId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 255);
}

export async function ensureDeepfakeFaceCollection(): Promise<string> {
  try {
    await rekognition.send(
      new DescribeCollectionCommand({
        CollectionId: collectionId,
      }),
    );

    return collectionId;
  } catch (error: any) {
    if (error?.name !== "ResourceNotFoundException") {
      throw error;
    }
  }

  try {
    await rekognition.send(
      new CreateCollectionCommand({
        CollectionId: collectionId,
      }),
    );

    return collectionId;
  } catch (error: any) {
    /*
     * Two simultaneous requests may both try to create it.
     * Treat "already exists" as success.
     */
    if (error?.name === "ResourceAlreadyExistsException") {
      return collectionId;
    }

    throw error;
  }
}

export type IndexedReferenceFace = {
  faceId: string;
  externalImageId: string;
  confidence: number;
  collectionId: string;
  boundingBox?: {
    width?: number;
    height?: number;
    left?: number;
    top?: number;
  };
};

export async function indexDeepfakeReferenceFace(input: {
  imageBytes: Uint8Array;
  targetProfileId: string;
  referenceFaceId: string;
}): Promise<IndexedReferenceFace> {
  if (!input.imageBytes.byteLength) {
    throw new Error("Reference image is empty.");
  }

  if (input.imageBytes.byteLength > 10 * 1024 * 1024) {
    throw new Error("Reference image exceeds the 10 MB limit.");
  }

  await ensureDeepfakeFaceCollection();

  const externalImageId = cleanExternalImageId(
    `target_${input.targetProfileId}_${input.referenceFaceId}`,
  );

  const response = await rekognition.send(
    new IndexFacesCommand({
      CollectionId: collectionId,
      Image: {
        Bytes: input.imageBytes,
      },
      ExternalImageId: externalImageId,
      MaxFaces: 1,
      QualityFilter: "HIGH",
      DetectionAttributes: ["DEFAULT"],
    }),
  );

  const faceRecord = response.FaceRecords?.[0];
  const unindexed = response.UnindexedFaces ?? [];

  if (!faceRecord?.Face?.FaceId) {
    const reasons = unindexed
      .flatMap((item) => item.Reasons ?? [])
      .filter(Boolean)
      .join(", ");

    throw new Error(
      reasons
        ? `Reference face could not be indexed: ${reasons}`
        : "No usable face was detected. Upload a clear, front-facing photograph with one person.",
    );
  }

  return {
    faceId: faceRecord.Face.FaceId,
    externalImageId: faceRecord.Face.ExternalImageId ?? externalImageId,
    confidence: faceRecord.Face.Confidence ?? 0,
    collectionId,
    boundingBox: faceRecord.Face.BoundingBox
      ? {
          width: faceRecord.Face.BoundingBox.Width,
          height: faceRecord.Face.BoundingBox.Height,
          left: faceRecord.Face.BoundingBox.Left,
          top: faceRecord.Face.BoundingBox.Top,
        }
      : undefined,
  };
}

export function getDeepfakeFaceCollectionId(): string {
  return collectionId;
}

export function isDeepfakeFaceEnrollmentConfigured(): boolean {
  return Boolean(
    process.env.AWS_ACCESS_KEY_ID?.trim() && process.env.AWS_SECRET_ACCESS_KEY?.trim(),
  );
}
