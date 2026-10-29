/** TMDB supplies localized work names, rather than a literal machine translation. */
export async function lookupAniListOriginalNames(query: string): Promise<string[]> {
  const { createTmdbSearchProvider } = await import("@media-track/workflow");
  const runtime = await import("../workflow-runtime");
  const settings = runtime.getAccountScopedSettings(await runtime.getCurrentAccountId());
  // Only names are needed. Avoid fetching a TV detail page for every candidate.
  const provider = createTmdbSearchProvider(await runtime.getTmdbAccesses(settings), { tvDetailsLimit: 0 });
  const candidates = await provider.searchMedia({ query });
  return [...new Set(candidates.map((candidate) => candidate.originalTitle.trim())
    .filter((name) => name && name !== query && /[\p{Script=Hiragana}\p{Script=Katakana}a-zA-Z]/u.test(name)))].slice(0, 3);
}
