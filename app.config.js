const fs = require('node:fs');
const path = require('node:path');

const firebasePublicKeys = [
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
];

module.exports = ({ config }) => {
  const productionBuild = process.env.EAS_BUILD_PROFILE === 'production'
    || process.env.EXPO_PUBLIC_APP_ENV === 'production';
  const androidGoogleServicesFile = process.env.GOOGLE_SERVICES_JSON || './google-services.json';
  const iosGoogleServicesFile = process.env.GOOGLE_SERVICES_INFO_PLIST || './GoogleService-Info.plist';
  if (productionBuild) {
    const requiredValues = [
      ...firebasePublicKeys,
      'EXPO_PUBLIC_DIRECT_CHAT_COMMAND_ENDPOINT',
      'EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT',
      'EXPO_PUBLIC_SENTRY_DSN',
      'SENTRY_AUTH_TOKEN',
      'SENTRY_ORG',
      'SENTRY_PROJECT',
    ];
    const missingValues = requiredValues.filter((key) => !process.env[key]);
    if (missingValues.length) {
      throw new Error(`Production builds require: ${missingValues.join(', ')}.`);
    }
    const missingFiles = [androidGoogleServicesFile, iosGoogleServicesFile]
      .filter((file) => !fs.existsSync(path.resolve(file)));
    if (missingFiles.length) {
      throw new Error(`Production Firebase files are missing: ${missingFiles.join(', ')}.`);
    }
  }
  if (
    productionBuild
    && (
      process.env.EXPO_PUBLIC_VOICE_ALLOW_MOCK_PROVIDER === 'true'
      || process.env.EXPO_PUBLIC_VOICE_ALLOW_MOCK_ROOMS === 'true'
      || process.env.EXPO_PUBLIC_VOICE_DEBUG === 'true'
      || process.env.EXPO_PUBLIC_PERSONAL_CHAT_VISUAL_FIXTURE === '1'
      || Boolean(process.env.EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN)
    )
  ) {
    throw new Error('Production builds cannot enable mocks, fixture routes, debug panels, or App Check debug tokens.');
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
  if (productionBuild && process.env.EXPO_PUBLIC_STORE_FIXTURES === '1') {
    throw new Error('Production builds cannot include store fixtures.');
  }
  const requiredHttpsUrls = [
    'EXPO_PUBLIC_PRIVACY_POLICY_URL',
    'EXPO_PUBLIC_TERMS_URL',
    'EXPO_PUBLIC_COMMUNITY_GUIDELINES_URL',
    'EXPO_PUBLIC_SUPPORT_URL',
  ];
  if (productionBuild) {
    for (const key of requiredHttpsUrls) {
      try {
        const url = new URL(process.env[key]);
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('unsafe');
      } catch {
        throw new Error(`Production builds require a valid HTTPS ${key}.`);
      }
    }
  }
  const plugins = [...(config.plugins || [])];
  for (const plugin of ['@react-native-firebase/app', '@react-native-firebase/app-check']) {
    if (!plugins.some((entry) => (Array.isArray(entry) ? entry[0] : entry) === plugin)) plugins.push(plugin);
  }
  if (!plugins.some((entry) => (Array.isArray(entry) ? entry[0] : entry) === '@sentry/react-native/expo')) {
    plugins.push(['@sentry/react-native/expo', {
      organization: process.env.SENTRY_ORG || '',
      project: process.env.SENTRY_PROJECT || '',
      url: process.env.SENTRY_URL || 'https://sentry.io/',
    }]);
  }
  return {
    ...config,
    android: { ...config.android, googleServicesFile: androidGoogleServicesFile },
    ios: { ...config.ios, googleServicesFile: iosGoogleServicesFile },
    plugins,
  };
};
