import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Final onboarding downloads.
 *
 * Both artifacts are streamed through the server as base64 instead of handing the
 * browser a presigned S3 URL: the bucket has no CORS rule for the app origin, so
 * `window.open` / `<a download>` on that URL silently failed — which was the actual
 * cause of the broken "Download Certificate" and "Download Bundle" buttons.
 */

export const getFinalDownloadStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: cert }, { data: auth }] = await Promise.all([
      supabase
        .from("verification_certificates")
        .select("id,certificate_number,status")
        .eq("user_id", userId)
        .order("issued_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("client_authorizations")
        .select("id,status,auth_number")
        .eq("user_id", userId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const ready = !!cert && cert.status === "ACTIVE" && !!auth && auth.status === "ACTIVE";
    return {
      ready,
      certificate_number: cert?.certificate_number ?? null,
      authorization_id: auth?.auth_number ?? null,
    };
  });

export const downloadProtectionCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    try {
      const { buildProtectionCertificateModel, CERTIFICATE_FILENAME } = await import(
        "./final-package"
      );
      const { loadFinalPackageData } = await import("./final-package.server");
      const data = await loadFinalPackageData(supabase, userId);
      const model = buildProtectionCertificateModel({
        snapshot: data.snapshot,
        certificate: data.certificate,
        authorization: data.authorization,
        protectedFaceCount: data.faces.length,
        publicBaseUrl: process.env["PUBLIC_APP_URL"] ?? "https://eternally-defend.lovable.app",
      });
      const { renderProtectionCertificatePdf } = await import("./final-certificate.server");
      const bytes = await renderProtectionCertificatePdf(model);
      return {
        base64: Buffer.from(bytes).toString("base64"),
        filename: CERTIFICATE_FILENAME(model.certificateNumber),
        contentType: "application/pdf",
      };
    } catch (err) {
      console.error("[downloadProtectionCertificate] failed", err);
      const raw = String((err as Error)?.message ?? "");
      if (raw === "NOT_READY") {
        throw new Error("Your certificate is not ready yet. Please finish onboarding first.");
      }
      throw new Error("We couldn't generate your Protection Certificate. Please try again.");
    }
  });

export const downloadProtectionBundle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    try {
      const {
        buildProtectionCertificateModel,
        buildFaceProtectionSummary,
        buildDigitalAssetSummary,
        BUNDLE_FILENAME,
      } = await import("./final-package");
      const { loadFinalPackageData } = await import("./final-package.server");
      const data = await loadFinalPackageData(supabase, userId);
      const model = buildProtectionCertificateModel({
        snapshot: data.snapshot,
        certificate: data.certificate,
        authorization: data.authorization,
        protectedFaceCount: data.faces.length,
        publicBaseUrl: process.env["PUBLIC_APP_URL"] ?? "https://eternally-defend.lovable.app",
      });

      const { renderProtectionCertificatePdf } = await import("./final-certificate.server");
      const files: Record<string, Uint8Array> = {};
      const enc = new TextEncoder();

      files["01_Protection_Certificate.pdf"] = await renderProtectionCertificatePdf(model);

      const { getObjectBytes } = await import("@/lib/aws/s3.server");
      const signedDoc = data.documents.find((d) => d.kind === "signed");
      if (signedDoc) {
        const bytes = await getObjectBytes(signedDoc.s3_key);
        if (bytes) files["02_Signed_Authorization_Letter.pdf"] = bytes;
      }
      const sigCert = data.documents.find((d) => d.kind === "signature_certificate");
      if (sigCert) {
        const bytes = await getObjectBytes(sigCert.s3_key);
        if (bytes) files["03_Electronic_Signature_Certificate.pdf"] = bytes;
      }

      files["04_Face_Protection_Summary.txt"] = enc.encode(
        buildFaceProtectionSummary({ model, faces: data.faces }),
      );
      files["05_Digital_Asset_Summary.txt"] = enc.encode(
        buildDigitalAssetSummary({ model, assets: data.assets }),
      );

      const { zipSync } = await import("fflate");
      const zipped = zipSync(files, { level: 6 });
      return {
        base64: Buffer.from(zipped).toString("base64"),
        filename: BUNDLE_FILENAME(model.certificateNumber),
        contentType: "application/zip",
        included: Object.keys(files),
      };
    } catch (err) {
      console.error("[downloadProtectionBundle] failed", err);
      const raw = String((err as Error)?.message ?? "");
      if (raw === "NOT_READY") {
        throw new Error("Your documents are not ready yet. Please finish onboarding first.");
      }
      throw new Error("We couldn't build your protection bundle. Please try again.");
    }
  });
