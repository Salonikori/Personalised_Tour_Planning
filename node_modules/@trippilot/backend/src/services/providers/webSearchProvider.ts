// Web search fallback/enrichment layer (restaurants, "things to do", transfers, freshness checks)
// for whatever structured providers don't cover. Uses Tavily; requires TAVILY_API_KEY.
import type { WebSearchProvider, WebSearchResult } from './types.js'

export class TavilyWebSearchProvider implements WebSearchProvider {
  readonly name = 'Tavily Web Search'

  isConfigured() {
    return Boolean(process.env.TAVILY_API_KEY)
  }

  async search(query: string): Promise<WebSearchResult[]> {
    if (!this.isConfigured()) return []
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: 'basic',
        max_results: 6,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`Tavily search failed with ${response.status}`)
    const payload = (await response.json()) as { results?: Array<{ title: string; url: string; content: string }> }
    return (payload.results || []).map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.content,
      source: new URL(result.url).hostname,
    }))
  }
}

export const webSearchProvider = new TavilyWebSearchProvider()
