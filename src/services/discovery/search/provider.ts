import { SearchResult } from "../types";

export interface SearchProvider {
  /**
   * Provider name
   * Example:
   * brave
   * firecrawl
   * rss
   */
  name: string;

  /**
   * Search provider
   */
  search(query: string): Promise<SearchResult[]>;
}
