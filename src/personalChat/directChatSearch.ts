/** Normalize Arabic/Latin search text for client-side inbox and friend filters. */
export function normalizeSearch(value: string) {
  return value
    .trim()
    .normalize('NFKC')
    .replace(/[\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .toLocaleLowerCase('ar');
}
