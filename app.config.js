module.exports = ({ config }) => {
  const productionBuild = process.env.EAS_BUILD_PROFILE === 'production'
    || process.env.EXPO_PUBLIC_APP_ENV === 'production';
  if (productionBuild && !process.env.EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT) {
    throw new Error('Production builds require EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT.');
  }
  if (
    productionBuild
    && (
      process.env.EXPO_PUBLIC_VOICE_ALLOW_MOCK_PROVIDER === 'true'
      || process.env.EXPO_PUBLIC_VOICE_ALLOW_MOCK_ROOMS === 'true'
      || process.env.EXPO_PUBLIC_VOICE_DEBUG === 'true'
    )
  ) {
    throw new Error('Production builds cannot enable voice mocks or the voice debug panel.');
  }
  if (
    productionBuild
    && (
      process.env.EXPO_PUBLIC_COSMETICS_LAB_VIDEO_URL
      || process.env.EXPO_PUBLIC_COSMETICS_LAB_AUDIO_URL
    )
  ) {
    throw new Error('Production builds cannot include cosmetics feasibility fixtures.');
  }
  return config;
};
