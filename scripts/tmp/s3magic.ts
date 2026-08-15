import { getObjectBytes } from "../../src/lib/aws/s3.server";
const keys = ["clients/606afa01-0767-4356-8459-7e7d8521c233/evidence/deepfake/2026-08-14/7d05d3ba3e3a010b2edcd82bfced535a","clients/606afa01-0767-4356-8459-7e7d8521c233/evidence/deepfake/2026-08-14/be4fab25841b38af72f781ff2cea8c36","clients/606afa01-0767-4356-8459-7e7d8521c233/evidence/deepfake/2026-08-14/0871300a89b69500e9e702f26a5cc203","clients/606afa01-0767-4356-8459-7e7d8521c233/evidence/deepfake/2026-08-14/61a56b5a90c06735f1280643ccb7cf41","clients/606afa01-0767-4356-8459-7e7d8521c233/evidence/deepfake/2026-08-14/03c798ae687f2f81dfbb17627fe38d30"];
for (const k of keys) {
  const b = await getObjectBytes(k);
  if (!b) { console.log(k, "MISSING"); continue; }
  console.log(k.slice(-8), b.byteLength, Array.from(b.slice(0,8)).map(x=>x.toString(16).padStart(2,'0')).join(' '), JSON.stringify(Buffer.from(b.slice(0,120)).toString('utf8').replace(/[^\x20-\x7e]/g,'.')));
}
