import { SearchProvider } from "./provider";
import { SearchResult } from "../types";

export class BraveProvider implements SearchProvider {

  name = "brave";

  async search(query: string): Promise<SearchResult[]> {

    console.log(`[Brave] Searching: ${query}`);

    // TODO:
    // Connect to your existing Brave Search implementation
    // Don't rewrite it—we'll reuse the code already in scan.ts

    return [];

  }

}
