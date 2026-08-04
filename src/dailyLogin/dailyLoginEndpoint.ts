export function deriveDailyLoginCommandEndpoint(endpoint?: string) {
  if (!endpoint) return undefined;
  return endpoint
    .replace(/livekitToken(?:\/)?$/, 'dailyLoginCommand')
    .replace(/livekittoken-/i, 'dailylogincommand-');
}

export function createDailyLoginRequestId(nowMillis = Date.now(), random = Math.random()) {
  return `daily_${nowMillis.toString(36)}_${Math.floor(random * 1_000_000_000).toString(36).padStart(6, '0')}`;
}
