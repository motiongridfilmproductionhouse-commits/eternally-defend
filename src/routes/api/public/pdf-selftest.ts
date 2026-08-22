import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/pdf-selftest")({
  server: {
    handlers: {
      GET: async () => {
        const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
        const doc = await PDFDocument.create();
        const page = doc.addPage([200, 100]);
        const font = await doc.embedFont(StandardFonts.Helvetica);
        page.drawText("ok", { x: 10, y: 40, size: 12, font, color: rgb(0, 0, 0) });
        const bytes = await doc.save();
        return Response.json({ ok: true, bytes: bytes.length });
      },
    },
  },
});
