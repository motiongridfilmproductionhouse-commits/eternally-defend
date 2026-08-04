import { DiscoveryAsset } from "./types";

const templates = [
  "{title}",
  "{title} watch",
  "{title} watch online",
  "{title} stream",
  "{title} download",
  "{title} full movie",
  "{title} HD",
  "{title} 1080p",
  "{title} 720p",
  "{title} WEBRip",
  "{title} HDRip",
  "{title} CAM",
  "{title} BluRay",
];

export function generateQueries(asset: DiscoveryAsset): string[] {
  const names = new Set<string>();

  names.add(asset.title);

  for (const alias of asset.aliases ?? []) {
    names.add(alias);
  }

  const queries = new Set<string>();

  for (const name of names) {
    for (const template of templates) {
      queries.add(template.replace("{title}", name));
    }
  }

  return [...queries];
}
