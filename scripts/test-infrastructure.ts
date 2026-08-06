import { lookupInfrastructure } from "../src/services/infrastructure";

async function main() {
  const report = await lookupInfrastructure("https://ogomovies1.com.pk");

  console.dir(report, { depth: null });
}

main().catch(console.error);
