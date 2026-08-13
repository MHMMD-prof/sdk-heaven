import type { FirebaseApp } from 'firebase/app';
import {
  CustomProvider,
  getToken as getWebAppCheckToken,
  initializeAppCheck as initializeWebAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from 'firebase/app-check';
import { Platform } from 'react-native';

import { resolveNativeAppCheckProviders } from './appCheckPolicy';

export { resolveNativeAppCheckProviders } from './appCheckPolicy';

let webAppCheck: AppCheck | undefined;
let nativeAppCheckPromise: Promise<import('@react-native-firebase/app-check').AppCheck> | undefined;

export function initializeFirebaseAppCheck(app: FirebaseApp) {
  if (webAppCheck) return webAppCheck;
  if (Platform.OS === 'web') {
    const siteKey = process.env.EXPO_PUBLIC_APP_CHECK_WEB_SITE_KEY;
    if (!siteKey) return undefined;
    webAppCheck = initializeWebAppCheck(app, {
      isTokenAutoRefreshEnabled: true,
      provider: new ReCaptchaEnterpriseProvider(siteKey),
    });
    return webAppCheck;
  }

  webAppCheck = initializeWebAppCheck(app, {
    isTokenAutoRefreshEnabled: true,
    provider: new CustomProvider({
      getToken: async () => {
        const token = await getNativeFirebaseAppCheckToken();
        return { expireTimeMillis: readJwtExpiry(token), token };
      },
    }),
  });
  return webAppCheck;
}

export async function getFirebaseAppCheckToken(forceRefresh = false) {
  if (Platform.OS === 'web') {
    if (!webAppCheck) return '';
    return (await getWebAppCheckToken(webAppCheck, forceRefresh)).token;
  }
  return getNativeFirebaseAppCheckToken(forceRefresh);
}

async function getNativeFirebaseAppCheckToken(forceRefresh = false) {
  const appCheck = await getNativeFirebaseAppCheck();
  const { getToken } = await import('@react-native-firebase/app-check');
  return (await getToken(appCheck, forceRefresh)).token;
}

function getNativeFirebaseAppCheck() {
  nativeAppCheckPromise ??= initializeNativeFirebaseAppCheck();
  return nativeAppCheckPromise;
}

async function initializeNativeFirebaseAppCheck() {
  const [{ getApp }, appCheckModule] = await Promise.all([
    import('@react-native-firebase/app'),
    import('@react-native-firebase/app-check'),
  ]);
  const production = process.env.EXPO_PUBLIC_APP_ENV === 'production';
  const providers = resolveNativeAppCheckProviders(production);
  const debugToken = production ? undefined : process.env.EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN;
  const provider = new appCheckModule.ReactNativeFirebaseAppCheckProvider();
  provider.configure({
    android: { debugToken, provider: providers.android },
    apple: { debugToken, provider: providers.apple },
    isTokenAutoRefreshEnabled: true,
  });
  return appCheckModule.initializeAppCheck(getApp(), {
    isTokenAutoRefreshEnabled: true,
    provider,
  });
}

function readJwtExpiry(token: string) {
  try {
    const encoded = token.split('.')[1];
    if (!encoded) throw new Error('missing payload');
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = globalThis.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    const expirySeconds = Number(JSON.parse(decoded).exp);
    if (Number.isFinite(expirySeconds) && expirySeconds > Date.now() / 1_000) return expirySeconds * 1_000;
  } catch {
    // Firebase tokens normally carry exp; use a short cache window if parsing fails.
  }
  return Date.now() + 5 * 60 * 1_000;
}
