/**
 * Session LRU for Say-mode translations: re-speaking unchanged text, or
 * flipping back to a previously used language, never re-hits the API.
 * Keyed by target language + exact (trimmed) source text. In-memory only —
 * translations are cheap to refetch and the cache stays tiny (≤50 entries).
 */

const MAX_ENTRIES = 50;

const cache = new Map<string, string>();

const keyOf = (text: string, targetLang: string): string => `${targetLang}::${text}`;

/** Hit refreshes recency; miss returns undefined (failed lookups are never cached). */
export function getCachedTranslation(text: string, targetLang: string): string | undefined {
  const key = keyOf(text, targetLang);
  const hit = cache.get(key);
  if (hit === undefined) return undefined;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

export function setCachedTranslation(text: string, targetLang: string, translated: string): void {
  const key = keyOf(text, targetLang);
  if (cache.has(key)) cache.delete(key);
  cache.set(key, translated);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}
