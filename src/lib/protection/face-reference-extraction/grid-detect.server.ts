/**
 * Heuristic Instagram-grid detector. No ML/vision API involved — this is a
 * deliberately transparent pixel-variance analysis, not a trained grid
 * detector, and it says so honestly via the returned `confidence`:
 *
 *  1. Downsample to grayscale and row-variance-scan top-to-bottom to find
 *     the largest contiguous, width-spanning high-variance band. Instagram's
 *     actual post grid is photographic (high local variance); the header,
 *     profile info, bio, and caption/nav chrome around it tends to be flatter
 *     (solid backgrounds, large uniform text blocks) — so the grid stands out
 *     as the dominant photographic band.
 *  2. Within that band, column/row-variance-scan for thin low-variance
 *     "gutter" lines (Instagram's grid gaps are near-uniform, usually white
 *     or the app's background color) to recover the actual tile boundaries.
 *  3. Reject the result unless recovered tiles are roughly square (±20%,
 *     Instagram's own aspect ratio) — anything else means the gutter
 *     detection found noise, not a real grid.
 *
 * Never blindly slices the whole screenshot into equal rectangles: with no
 * band, or a band with no plausible tile structure, this returns
 * `confidence: 'NONE'` and zero tiles, and the caller must skip the asset
 * rather than guess.
 */
import { cropToJpeg, decodeToRgba, resizeToGray } from "@/lib/media/image-raster.server";

export interface DetectedTile {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type GridDetectionConfidence = "HIGH" | "LOW" | "NONE";

export interface GridDetectionResult {
  tiles: DetectedTile[];
  confidence: GridDetectionConfidence;
  imageWidth: number;
  imageHeight: number;
}

const ANALYSIS_MAX_WIDTH = 600;
/** Minimum band height as a fraction of image height to count as "the grid", not a stray photo. */
const MIN_BAND_HEIGHT_FRACTION = 0.35;
/** A row/column counts as high-variance (photographic content) above this. */
const CONTENT_VARIANCE_THRESHOLD = 180;
/** A row/column counts as a gutter (near-uniform) below this. */
const GUTTER_VARIANCE_THRESHOLD = 40;
const MIN_GUTTER_RUN_PX = 1;
/** Low-variance row gaps up to this wide (at analysis scale) are treated as an in-grid gutter, not a band break. */
const MAX_GUTTER_GAP_PX = 12;
const MAX_TILES = 30;
const SQUARE_TOLERANCE = 0.2;

function rowVariance(pixels: Uint8Array, width: number, y: number): number {
  const rowStart = y * width;
  let mean = 0;
  for (let x = 0; x < width; x++) mean += pixels[rowStart + x];
  mean /= width;
  let variance = 0;
  for (let x = 0; x < width; x++) {
    const d = pixels[rowStart + x] - mean;
    variance += d * d;
  }
  return variance / width;
}

function colVariance(pixels: Uint8Array, width: number, height: number, x: number): number {
  let mean = 0;
  for (let y = 0; y < height; y++) mean += pixels[y * width + x];
  mean /= height;
  let variance = 0;
  for (let y = 0; y < height; y++) {
    const d = pixels[y * width + x] - mean;
    variance += d * d;
  }
  return variance / height;
}

/** Largest contiguous run of rows whose variance clears the content threshold. */
function findContentBand(
  pixels: Uint8Array,
  width: number,
  height: number,
): { top: number; bottom: number } | null {
  const variances = new Array<number>(height);
  for (let y = 0; y < height; y++) variances[y] = rowVariance(pixels, width, y);

  // Raw runs of high-variance rows. A real grid's gutter rows (near-uniform
  // background between tile rows) are themselves low-variance, so they
  // fragment the grid into many short runs — this is expected, not a sign
  // there's no grid. Runs separated by a short enough gap (bounded by
  // MAX_GUTTER_GAP_PX, matching a plausible gutter thickness) are merged
  // into one band below, so a periodic grid still reads as one contiguous
  // photographic region while a single flat gap that's too wide to be a
  // gutter (real chrome/whitespace) still breaks the band correctly.
  const rawRuns: Array<{ top: number; bottom: number }> = [];
  let curTop = -1;
  for (let y = 0; y < height; y++) {
    const isContent = variances[y] >= CONTENT_VARIANCE_THRESHOLD;
    if (isContent && curTop === -1) curTop = y;
    const runEnds = !isContent || y === height - 1;
    if (runEnds && curTop !== -1) {
      rawRuns.push({ top: curTop, bottom: isContent ? y : y - 1 });
      curTop = -1;
    }
  }
  if (rawRuns.length === 0) return null;

  const merged: Array<{ top: number; bottom: number }> = [{ ...rawRuns[0] }];
  for (let i = 1; i < rawRuns.length; i++) {
    const last = merged[merged.length - 1];
    const gap = rawRuns[i].top - last.bottom - 1;
    if (gap <= MAX_GUTTER_GAP_PX) {
      last.bottom = rawRuns[i].bottom;
    } else {
      merged.push({ ...rawRuns[i] });
    }
  }

  let best = merged[0];
  for (const run of merged) {
    if (run.bottom - run.top > best.bottom - best.top) best = run;
  }
  if (best.bottom - best.top + 1 < height * MIN_BAND_HEIGHT_FRACTION) return null;
  return { top: best.top, bottom: best.bottom };
}

/** Boundaries (start indices) of low-variance gutter runs within [0, length). */
function findGutterBoundaries(variances: number[]): number[] {
  const bounds: number[] = [0];
  let runStart = -1;
  for (let i = 0; i < variances.length; i++) {
    const isGutter = variances[i] <= GUTTER_VARIANCE_THRESHOLD;
    if (isGutter && runStart === -1) runStart = i;
    const runEnds = !isGutter || i === variances.length - 1;
    if (runEnds && runStart !== -1) {
      const runLen = (isGutter ? i : i - 1) - runStart + 1;
      if (runLen >= MIN_GUTTER_RUN_PX) {
        const mid = Math.round(runStart + runLen / 2);
        if (mid > 0 && mid < variances.length - 1) bounds.push(mid);
      }
      runStart = -1;
    }
  }
  bounds.push(variances.length);
  return Array.from(new Set(bounds)).sort((a, b) => a - b);
}

function segmentsFromBoundaries(bounds: number[], minSegment: number): number[][] {
  const segments: number[][] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    if (end - start >= minSegment) segments.push([start, end]);
  }
  return segments;
}

function isRoughlySquare(w: number, h: number): boolean {
  const ratio = w / h;
  return ratio >= 1 - SQUARE_TOLERANCE && ratio <= 1 + SQUARE_TOLERANCE;
}

export async function detectGridTiles(imageBytes: Uint8Array): Promise<GridDetectionResult> {
  const image = decodeToRgba(imageBytes);
  const fullWidth = image?.width ?? 0;
  const fullHeight = image?.height ?? 0;
  if (!fullWidth || !fullHeight) {
    return { tiles: [], confidence: "NONE", imageWidth: 0, imageHeight: 0 };
  }

  const scale = fullWidth > ANALYSIS_MAX_WIDTH ? ANALYSIS_MAX_WIDTH / fullWidth : 1;
  const analysisWidth = Math.max(1, Math.round(fullWidth * scale));
  const analysisHeight = Math.max(1, Math.round(fullHeight * scale));

  const data = resizeToGray(image!, analysisWidth, analysisHeight);

  const band = findContentBand(data, analysisWidth, analysisHeight);
  if (!band)
    return { tiles: [], confidence: "NONE", imageWidth: fullWidth, imageHeight: fullHeight };

  const bandHeight = band.bottom - band.top + 1;
  const rowVariances: number[] = [];
  for (let y = band.top; y <= band.bottom; y++)
    rowVariances.push(rowVariance(data, analysisWidth, y));

  // colVariance needs a sub-buffer scoped to the band, not the full image.
  const bandPixels = data.subarray(band.top * analysisWidth, (band.bottom + 1) * analysisWidth);
  const colVariances: number[] = [];
  for (let x = 0; x < analysisWidth; x++) {
    colVariances.push(colVariance(bandPixels, analysisWidth, bandHeight, x));
  }

  const colBounds = findGutterBoundaries(colVariances);
  const rowBounds = findGutterBoundaries(rowVariances);
  const minColSegment = analysisWidth * 0.15;
  const minRowSegment = bandHeight * 0.15;
  const colSegments = segmentsFromBoundaries(colBounds, minColSegment);
  const rowSegments = segmentsFromBoundaries(rowBounds, minRowSegment);

  const toFullScale = (v: number) => Math.round(v / scale);

  const buildTiles = (cols: number[][], rows: number[][]): DetectedTile[] => {
    const tiles: DetectedTile[] = [];
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < cols.length; c++) {
        const [cx0, cx1] = cols[c];
        const [ry0, ry1] = rows[r];
        tiles.push({
          x: toFullScale(cx0),
          y: toFullScale(ry0 + band.top),
          width: toFullScale(cx1 - cx0),
          height: toFullScale(ry1 - ry0),
        });
      }
    }
    return tiles;
  };

  if (
    colSegments.length >= 2 &&
    rowSegments.length >= 1 &&
    colSegments.length * rowSegments.length <= MAX_TILES
  ) {
    const sample = buildTiles(colSegments.slice(0, 1), rowSegments.slice(0, 1))[0];
    if (sample && isRoughlySquare(sample.width, sample.height)) {
      return {
        tiles: buildTiles(colSegments, rowSegments),
        confidence: "HIGH",
        imageWidth: fullWidth,
        imageHeight: fullHeight,
      };
    }
  }

  // Fallback: gutters weren't cleanly detectable by the strict absolute
  // threshold above. Before assuming a grid at all, require weak evidence of
  // 3-column periodicity — the variance at the two expected gutter columns
  // must sag well below the band's typical (median) column variance. A
  // single uniform photo (no grid) has roughly flat variance everywhere and
  // fails this check, so it's correctly reported as NONE instead of being
  // sliced into a fabricated grid.
  const sortedColVariances = [...colVariances].sort((a, b) => a - b);
  const medianColVariance = sortedColVariances[Math.floor(sortedColVariances.length / 2)] || 1;
  const gutterIdxA = Math.round(analysisWidth / 3);
  const gutterIdxB = Math.round((2 * analysisWidth) / 3);
  const looksPeriodic =
    colVariances[gutterIdxA] <= medianColVariance * 0.7 &&
    colVariances[gutterIdxB] <= medianColVariance * 0.7;
  if (!looksPeriodic) {
    return { tiles: [], confidence: "NONE", imageWidth: fullWidth, imageHeight: fullHeight };
  }

  // A clear photographic band with weak 3-column periodicity exists. Split
  // ONLY that band into a uniform 3-column layout (Instagram's near-universal
  // grid column count) — still never touches header/nav/caption chrome
  // outside the band — and mark it low-confidence.
  const columns = 3;
  const colWidth = analysisWidth / columns;
  const approxTileHeight = colWidth; // assume square tiles
  const rows = Math.max(1, Math.round(bandHeight / approxTileHeight));
  if (rows * columns > MAX_TILES || bandHeight < colWidth * 0.5) {
    return { tiles: [], confidence: "NONE", imageWidth: fullWidth, imageHeight: fullHeight };
  }
  const rowHeight = bandHeight / rows;
  const fallbackTiles: DetectedTile[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      fallbackTiles.push({
        x: toFullScale(c * colWidth),
        y: toFullScale(band.top + r * rowHeight),
        width: toFullScale(colWidth),
        height: toFullScale(rowHeight),
      });
    }
  }
  return {
    tiles: fallbackTiles,
    confidence: "LOW",
    imageWidth: fullWidth,
    imageHeight: fullHeight,
  };
}

export async function cropTile(imageBytes: Uint8Array, tile: DetectedTile): Promise<Buffer> {
  return cropToJpeg(
    imageBytes,
    { x: tile.x, y: tile.y, width: tile.width, height: tile.height },
    90,
  );
}
