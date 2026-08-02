// Server-only barrel: keeps Node-only infrastructure lookups (node:dns, whoiser)
// out of the browser bundle. Import only from *.functions.ts / server routes.
export { lookupInfrastructure } from "@/services/infrastructure";
