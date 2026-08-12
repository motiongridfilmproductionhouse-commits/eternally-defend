/**
 * Face enrollment progress is mapped to REAL backend milestones only.
 * There is no timer-driven progress: every value below is reached because a
 * real operation (session creation, AWS liveness analysis, AWS IndexFaces,
 * database enrollment) actually completed.
 */
export type FaceScanMilestone =
  | "idle" // nothing started
  | "camera_ready" // local camera preview granted (browser)
  | "session_created" // AWS CreateFaceLivenessSession succeeded
  | "liveness_capturing" // AWS liveness detector actively capturing
  | "liveness_analyzed" // AWS liveness analysis returned to the client
  | "indexing" // finalizeLiveness running (GetResults + IndexFaces + DB)
  | "enrolled" // backend confirmed FACE_VERIFIED
  | "failed"; // real backend/AWS failure

const PROGRESS: Record<FaceScanMilestone, number> = {
  idle: 0,
  camera_ready: 10,
  session_created: 20,
  liveness_capturing: 40,
  liveness_analyzed: 60,
  indexing: 80,
  enrolled: 100,
  failed: 0,
};

export function milestoneProgress(m: FaceScanMilestone): number {
  return PROGRESS[m] ?? 0;
}

export function isScanActive(m: FaceScanMilestone): boolean {
  return m === "liveness_capturing" || m === "liveness_analyzed" || m === "indexing";
}

/** Real AWS Rekognition FaceDetail.Landmark (normalized image coordinates). */
export type AwsLandmark = { type: string; x: number; y: number };

export function hasRealLandmarks(landmarks: unknown): landmarks is AwsLandmark[] {
  return (
    Array.isArray(landmarks) &&
    landmarks.length > 0 &&
    landmarks.every(
      (l) =>
        !!l &&
        typeof (l as AwsLandmark).type === "string" &&
        Number.isFinite((l as AwsLandmark).x) &&
        Number.isFinite((l as AwsLandmark).y),
    )
  );
}

/**
 * Mesh edges between AWS Rekognition landmark types. Only edges whose BOTH
 * endpoints exist in the real response are rendered — nothing is interpolated
 * or invented.
 */
const MESH_EDGES: [string, string][] = [
  ["upperJawlineLeft", "midJawlineLeft"],
  ["midJawlineLeft", "chinBottom"],
  ["chinBottom", "midJawlineRight"],
  ["midJawlineRight", "upperJawlineRight"],
  ["leftEyeBrowLeft", "leftEyeBrowUp"],
  ["leftEyeBrowUp", "leftEyeBrowRight"],
  ["rightEyeBrowLeft", "rightEyeBrowUp"],
  ["rightEyeBrowUp", "rightEyeBrowRight"],
  ["leftEyeLeft", "leftEyeUp"],
  ["leftEyeUp", "leftEyeRight"],
  ["leftEyeRight", "leftEyeDown"],
  ["leftEyeDown", "leftEyeLeft"],
  ["rightEyeLeft", "rightEyeUp"],
  ["rightEyeUp", "rightEyeRight"],
  ["rightEyeRight", "rightEyeDown"],
  ["rightEyeDown", "rightEyeLeft"],
  ["eyeLeft", "nose"],
  ["eyeRight", "nose"],
  ["noseLeft", "nose"],
  ["noseRight", "nose"],
  ["noseLeft", "mouthLeft"],
  ["noseRight", "mouthRight"],
  ["mouthLeft", "mouthUp"],
  ["mouthUp", "mouthRight"],
  ["mouthRight", "mouthDown"],
  ["mouthDown", "mouthLeft"],
  ["mouthLeft", "midJawlineLeft"],
  ["mouthRight", "midJawlineRight"],
  ["mouthDown", "chinBottom"],
  ["leftEyeBrowLeft", "upperJawlineLeft"],
  ["rightEyeBrowRight", "upperJawlineRight"],
];

export type MeshEdge = { x1: number; y1: number; x2: number; y2: number };

export function buildLandmarkMesh(landmarks: AwsLandmark[]): MeshEdge[] {
  const byType = new Map(landmarks.map((l) => [l.type, l]));
  const edges: MeshEdge[] = [];
  for (const [a, b] of MESH_EDGES) {
    const pa = byType.get(a);
    const pb = byType.get(b);
    if (!pa || !pb) continue;
    edges.push({ x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y });
  }
  return edges;
}

/** Real capture guidance strings surfaced during the AWS liveness sequence. */
export const SCAN_GUIDANCE: Record<FaceScanMilestone, string> = {
  idle: "Position your face inside the circle",
  camera_ready: "Position your face inside the circle",
  session_created: "Secure session established — starting capture",
  liveness_capturing: "Keep your face centered and follow the on-screen prompts",
  liveness_analyzed: "Analyzing capture quality",
  indexing: "Registering protected facial reference",
  enrolled: "Face protection registered",
  failed: "Enrollment could not be completed",
};
