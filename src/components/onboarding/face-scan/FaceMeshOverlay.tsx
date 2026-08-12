import { buildLandmarkMesh, hasRealLandmarks, type AwsLandmark } from "@/lib/onboarding/face-scan-progress";

/**
 * Renders the REAL AWS Rekognition landmark coordinates over the captured
 * reference image. If AWS returned no landmarks, nothing biometric is drawn.
 */
export function FaceMeshOverlay({
  landmarks,
  pulse,
}: {
  landmarks: unknown;
  pulse?: boolean;
}) {
  if (!hasRealLandmarks(landmarks)) return null;
  const points = landmarks as AwsLandmark[];
  const edges = buildLandmarkMesh(points);

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="absolute inset-0 size-full"
      data-testid="face-mesh-overlay"
      aria-hidden="true"
    >
      {edges.map((e, i) => (
        <line
          key={`e${i}`}
          x1={e.x1 * 100}
          y1={e.y1 * 100}
          x2={e.x2 * 100}
          y2={e.y2 * 100}
          stroke="rgba(56,189,248,0.55)"
          strokeWidth={0.25}
          className="face-mesh-line"
          style={{ animationDelay: `${600 + i * 22}ms` }}
        />
      ))}
      {points.map((p, i) => (
        <circle
          key={`p${p.type}${i}`}
          cx={p.x * 100}
          cy={p.y * 100}
          r={0.7}
          fill="rgb(103 232 249)"
          className={`face-mesh-point${pulse ? " face-mesh-pulse" : ""}`}
          style={{ animationDelay: `${i * 26}ms` }}
        />
      ))}
    </svg>
  );
}
