export type CosmeticsFeasibilityConfig = {
  audioUrl?: string;
  videoUrl?: string;
};

export function readCosmeticsFeasibilityConfig(
  env: Record<string, string | undefined> = {
    EXPO_PUBLIC_COSMETICS_LAB_AUDIO_URL:
      process.env.EXPO_PUBLIC_COSMETICS_LAB_AUDIO_URL,
    EXPO_PUBLIC_COSMETICS_LAB_VIDEO_URL:
      process.env.EXPO_PUBLIC_COSMETICS_LAB_VIDEO_URL,
  },
): CosmeticsFeasibilityConfig {
  return {
    audioUrl: readOptionalHttpsUrl(env.EXPO_PUBLIC_COSMETICS_LAB_AUDIO_URL),
    videoUrl: readOptionalHttpsUrl(env.EXPO_PUBLIC_COSMETICS_LAB_VIDEO_URL),
  };
}

function readOptionalHttpsUrl(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  try {
    const url = new URL(normalized);
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
