import { headObject, getSignedGetUrl, getBucket } from "../../src/lib/aws/s3.server";
const keys = [
"clients/606afa01-0767-4356-8459-7e7d8521c233/evidence/deepfake/2026-08-14/7d05d3ba3e3a010b2edcd82bfced535a",
"clients/606afa01-0767-4356-8459-7e7d8521c233/evidence/deepfake/2026-08-14/be4fab25841b38af72f781ff2cea8c36",
];
console.log("bucket", getBucket());
for (const k of keys) {
  const h = await headObject(k);
  console.log(k, h ? {ct:h.ContentType, len:h.ContentLength} : "MISSING");
  const url = await getSignedGetUrl(k, 300, {disposition:"inline", contentType:"image/jpeg"});
  const r = await fetch(url);
  console.log("GET", r.status, r.headers.get("content-type"), r.headers.get("content-length"));
}
