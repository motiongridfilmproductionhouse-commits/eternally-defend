/**
 * Unicode font stack for PDF generation.
 *
 * pdf-lib's StandardFonts (Helvetica, etc.) use WinAnsi encoding which cannot
 * render any character outside the Windows-1252 range — including U+2713 ("✓"),
 * Malayalam, Arabic, CJK, emoji, etc. Attempts to draw such characters throw
 * `WinAnsi cannot encode "…"`.
 *
 * This helper fetches Noto Sans (Latin + symbols, covers ✓) plus Noto Sans
 * Arabic and Noto Sans Malayalam from a public CDN, registers @pdf-lib/fontkit
 * on the target PDFDocument, embeds them as subsets, and exposes a
 * `drawUnicodeText` helper that picks the correct font per character.
 *
 * Fonts are cached at module scope so subsequent renders inside the same
 * worker instance skip the network fetch.
 */
import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont, PDFPage, RGB } from "pdf-lib";

const CDN = "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io@main/fonts";

const SOURCES = {
  latinRegular: `${CDN}/NotoSans/hinted/ttf/NotoSans-Regular.ttf`,
  latinBold: `${CDN}/NotoSans/hinted/ttf/NotoSans-Bold.ttf`,
  arabicRegular: `${CDN}/NotoSansArabic/hinted/ttf/NotoSansArabic-Regular.ttf`,
  arabicBold: `${CDN}/NotoSansArabic/hinted/ttf/NotoSansArabic-Bold.ttf`,
  malayalamRegular: `${CDN}/NotoSerifMalayalam/unhinted/ttf/NotoSerifMalayalam-Regular.ttf`,
  malayalamBold: `${CDN}/NotoSerifMalayalam/unhinted/ttf/NotoSerifMalayalam-Bold.ttf`,
} as const;

const bufferCache = new Map<string, Uint8Array>();

async function loadTTF(url: string): Promise<Uint8Array> {
  const cached = bufferCache.get(url);
  if (cached) return cached;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Font fetch failed (${res.status}) for ${url}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  bufferCache.set(url, bytes);
  return bytes;
}

export interface UnicodeFontStack {
  regular: PDFFont[]; // ordered by preference; [latin, arabic, malayalam]
  bold: PDFFont[];
  coverage: {
    /** returns true iff any font in the stack has a glyph for this codepoint */
    supports: (font: PDFFont, cp: number) => boolean;
  };
}

// Per-PDFFont coverage cache. Keyed by identity.
const fontCoverageCache = new WeakMap<PDFFont, Set<number>>();

function collectCoverage(font: PDFFont): Set<number> {
  const cached = fontCoverageCache.get(font);
  if (cached) return cached;
  // pdf-lib exposes the underlying fontkit font on the embedder for custom fonts.
  // Use hasGlyphForCodePoint via that instance.
  const anyFont = font as unknown as {
    embedder?: { font?: { hasGlyphForCodePoint?: (cp: number) => boolean } };
  };
  const fk = anyFont.embedder?.font;
  // We cannot enumerate the full coverage cheaply; instead we lazily populate
  // the set as characters are checked and store fk on the sentinel below.
  const set = new Set<number>();
  (set as unknown as { __fk?: unknown }).__fk = fk;
  fontCoverageCache.set(font, set);
  return set;
}

function fontSupports(font: PDFFont, cp: number): boolean {
  const set = collectCoverage(font);
  if (set.has(cp)) return true;
  const fk = (
    set as unknown as {
      __fk?: { hasGlyphForCodePoint?: (cp: number) => boolean };
    }
  ).__fk;
  const ok = fk?.hasGlyphForCodePoint?.(cp) ?? false;
  if (ok) set.add(cp);
  return ok;
}

/**
 * Register fontkit on the PDFDocument and embed the full Unicode font stack.
 * Safe to call once per PDFDocument. Fonts are subset by default so unused
 * glyphs do not bloat the resulting PDF.
 */
export async function embedUnicodeFontStack(doc: PDFDocument): Promise<UnicodeFontStack> {
  doc.registerFontkit(fontkit);
  const [rL, bL, rA, bA, rM, bM] = await Promise.all([
    loadTTF(SOURCES.latinRegular),
    loadTTF(SOURCES.latinBold),
    loadTTF(SOURCES.arabicRegular),
    loadTTF(SOURCES.arabicBold),
    loadTTF(SOURCES.malayalamRegular),
    loadTTF(SOURCES.malayalamBold),
  ]);
  const regular = [
    await doc.embedFont(rL, { subset: true }),
    await doc.embedFont(rA, { subset: true }),
    // Malayalam shaping can reference contextual glyphs outside a naïve subset.
    await doc.embedFont(rM, { subset: false }),
  ];
  const bold = [
    await doc.embedFont(bL, { subset: true }),
    await doc.embedFont(bA, { subset: true }),
    await doc.embedFont(bM, { subset: false }),
  ];
  return { regular, bold, coverage: { supports: fontSupports } };
}

function pickFont(stack: PDFFont[], cp: number): PDFFont {
  if (cp >= 0x0d00 && cp <= 0x0d7f && stack[2]) return stack[2];
  if (((cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0750 && cp <= 0x077f)) && stack[1])
    return stack[1];
  for (const f of stack) if (fontSupports(f, cp)) return f;
  return stack[0];
}

function graphemes(text: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
      (part) => part.segment,
    );
  }
  return Array.from(text);
}

function pickFontForGrapheme(stack: PDFFont[], value: string): PDFFont {
  const points = Array.from(value, (character) => character.codePointAt(0) ?? 0);
  if (points.some((cp) => cp >= 0x0d00 && cp <= 0x0d7f) && stack[2]) return stack[2];
  if (
    points.some((cp) => (cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0750 && cp <= 0x077f)) &&
    stack[1]
  )
    return stack[1];
  return pickFont(stack, points.find((cp) => cp > 32) ?? points[0] ?? 0);
}

function drawGlyphOutlineFallback(
  page: PDFPage,
  font: PDFFont,
  value: string,
  opts: { x: number; y: number; size: number; color?: RGB },
): number | null {
  const embedded = font as unknown as {
    embedder?: {
      font?: {
        unitsPerEm?: number;
        glyphForCodePoint?: (cp: number) => {
          advanceWidth?: number;
          path?: { toSVG?: () => string };
        };
      };
    };
  };
  const source = embedded.embedder?.font;
  if (!source?.glyphForCodePoint) return null;
  const units = source.unitsPerEm || 1000;
  const scale = opts.size / units;
  let cursor = opts.x;
  for (const character of Array.from(value)) {
    const glyph = source.glyphForCodePoint(character.codePointAt(0) ?? 0);
    const path = glyph.path?.toSVG?.();
    if (path) page.drawSvgPath(path, { x: cursor, y: opts.y, scale, color: opts.color });
    const isCombiningMark = /\p{Mark}/u.test(character);
    cursor += (isCombiningMark ? 0 : (glyph.advanceWidth ?? units * 0.5)) * scale;
  }
  return cursor;
}

/**
 * Draw a possibly-mixed-script string on a page, transparently splitting into
 * runs so each character is drawn with a font that has a glyph for it.
 * Characters with no glyph in any font fall back to the primary font — pdf-lib
 * will emit the .notdef glyph rather than throw, since these are custom fonts.
 */
export function drawUnicodeText(
  page: PDFPage,
  text: string,
  opts: {
    x: number;
    y: number;
    size: number;
    stack: PDFFont[];
    color?: RGB;
  },
): number {
  const chars = graphemes(text);
  let x = opts.x;
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    const font = pickFontForGrapheme(opts.stack, ch);
    let run = ch;
    i++;
    while (i < chars.length) {
      if (pickFontForGrapheme(opts.stack, chars[i]) !== font) break;
      run += chars[i];
      i++;
    }
    try {
      page.drawText(run, {
        x,
        y: opts.y,
        size: opts.size,
        font,
        color: opts.color,
      });
    } catch {
      const outlined = drawGlyphOutlineFallback(page, font, run, {
        x,
        y: opts.y,
        size: opts.size,
        color: opts.color,
      });
      if (outlined != null) {
        x = outlined;
        continue;
      }
      // Preserve evidence text semantics: never replace unsupported source text with question marks.
      const replacement = "\uFFFD".repeat(Math.max(1, graphemes(run).length));
      page.drawText(replacement, {
        x,
        y: opts.y,
        size: opts.size,
        font: opts.stack[0],
        color: opts.color,
      });
      x += opts.stack[0].widthOfTextAtSize(replacement, opts.size);
      continue;
    }
    try {
      x += font.widthOfTextAtSize(run, opts.size);
    } catch {
      // Some complex-script fonts draw correctly but cannot expose advance
      // coordinates through fontkit. Use a conservative advance without
      // altering or overdrawing the source text.
      x += graphemes(run).length * opts.size * 0.65;
    }
  }
  return x;
}

/** Measure a mixed-script string using the per-character font from the stack. */
export function measureUnicodeText(text: string, size: number, stack: PDFFont[]): number {
  const chars = graphemes(text);
  let w = 0;
  let i = 0;
  while (i < chars.length) {
    const font = pickFontForGrapheme(stack, chars[i]);
    let run = chars[i];
    i++;
    while (i < chars.length) {
      if (pickFontForGrapheme(stack, chars[i]) !== font) break;
      run += chars[i];
      i++;
    }
    w += font.widthOfTextAtSize(run, size);
  }
  return w;
}
