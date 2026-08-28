/**
 * Face-region tiling for protected assets that are NOT social grid
 * screenshots — i.e. ordinary single photos, which is what most customers
 * actually upload. The grid detector correctly reports NONE for these, and
 * treating the whole photo as one tile then mis-classifies any group photo as
 * MULTIPLE_FACES (and any wide shot as FACE_TOO_SMALL), so no candidate is
 * ever produced.
 *
 * This turns each detected face in the photo into its own padded square tile,
 * which the existing per-tile pipeline (classify -> identity match -> dedupe)
 * then handles unchanged. It makes NO identity claim whatsoever: a tile here
 * is only "there is a face in this region", and every downstream trust
 * decision (match against the customer's own trusted anchor, or admin
 * confirmation in bootstrap mode) is untouched.
 */
import { DetectFacesCommand } from "@aws-sdk/client-rekognition";
import { imageMetadata } from "@/lib/media/image-raster.server";
import { getRekognition } from "@/lib/aws/clients.server";
import type { DetectedTile } from "./grid-detect.server";

/** Padding around the raw Rekognition box, as a fraction of box size — keeps hair/chin/context so downstream quality checks behave like a normal reference photo. */
const PADDING_FRACTION = 0.6;
const MIN_TILE_PX = 48;
const MAX_FACE_TILES = 10;

export async function detectFaceRegionTiles(imageBytes: Uint8Array): Promise<{
  tiles: DetectedTile[];
  imageWidth: number;
  imageHeight: number;
}> {
  const meta = imageMetadata(imageBytes);
  const imageWidth = meta.width;
  const imageHeight = meta.height;
  if (!imageWidth || !imageHeight) return { tiles: [], imageWidth: 0, imageHeight: 0 };

  const out = await getRekognition().send(
    new DetectFacesCommand({ Image: { Bytes: imageBytes }, Attributes: ["DEFAULT"] }),
  );
  const faces = out.FaceDetails ?? [];

  const tiles: DetectedTile[] = [];
  for (const face of faces) {
    const box = face.BoundingBox;
    if (!box?.Width || !box?.Height) continue;

    const cx = ((box.Left ?? 0) + box.Width / 2) * imageWidth;
    const cy = ((box.Top ?? 0) + box.Height / 2) * imageHeight;
    // Square crop so the tile aspect matches a normal reference face upload.
    const side = Math.max(box.Width * imageWidth, box.Height * imageHeight) * (1 + PADDING_FRACTION);

    const half = side / 2;
    const x = Math.max(0, Math.round(cx - half));
    const y = Math.max(0, Math.round(cy - half));
    const width = Math.min(imageWidth - x, Math.round(side));
    const height = Math.min(imageHeight - y, Math.round(side));
    if (width < MIN_TILE_PX || height < MIN_TILE_PX) continue;

    tiles.push({ x, y, width, height });
  }

  // Largest (closest / most usable) faces first, capped.
  tiles.sort((a, b) => b.width * b.height - a.width * a.height);
  return { tiles: tiles.slice(0, MAX_FACE_TILES), imageWidth, imageHeight };
}
