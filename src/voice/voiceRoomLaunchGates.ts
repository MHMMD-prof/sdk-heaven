/**
 * Production rooms must not fall back to mock catalog data unless explicitly allowed.
 * Wave 15 acceptance: no prototype/mock leakage on the public room path.
 */
export function isVoiceRoomMockFallbackAllowed(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): boolean {
  return env.EXPO_PUBLIC_VOICE_ALLOW_MOCK_ROOMS === 'true';
}
