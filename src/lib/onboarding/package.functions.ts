import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHash } from "crypto";

export const buildAuthorizationPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: auth } = await supabase.from("client_authorizations").select("*").eq("user_id", userId).order("version", { ascending: false }).limit(1).maybeSingle();
    if (!auth) throw new Error("No authorization");
    const { data: docs } = await supabase.from("authorization_documents").select("*").eq("authorization_id", auth.id);

    const { PDFDocument } = await import("pdf-lib");
    const out = await PDFDocument.create();
    const { getS3, getBucket } = await import("@/lib/aws/clients.server");
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = getS3(); const bucket = getBucket();

    for (const d of (docs ?? []).filter((x) => x.kind === "certificate" || x.kind === "signed")) {
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: d.s3_key }));
      const buf = await res.Body!.transformToByteArray();
      const src = await PDFDocument.load(buf);
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const p of pages) out.addPage(p);
    }
    const bytes = await out.save();
    const sha = createHash("sha256").update(bytes).digest("hex");
    const key = `clients/${userId}/authorization/${auth.auth_number}-package.pdf`;
    const { putObject, getSignedGetUrl } = await import("@/lib/aws/s3.server");
    await putObject({ key, body: Buffer.from(bytes), contentType: "application/pdf" });
    await supabase.from("authorization_documents").insert({ authorization_id: auth.id, user_id: userId, kind: "package", version: auth.version, s3_key: key, sha256: sha });
    return { url: await getSignedGetUrl(key, 300), sha256: sha };
  });
