import { debugError } from '../utils/debugLog';

export async function getVoiceAppCheckHeader(
  forceRefresh = false,
  getToken = getDefaultVoiceAppCheckToken,
): Promise<Record<string, string>> {
  try {
    const token = await getToken(forceRefresh);
    return token ? { 'X-Firebase-AppCheck': token } : {};
  } catch (error) {
    debugError('voice.app-check', 'token:error', error);
    if (process.env.EXPO_PUBLIC_APP_ENV === 'production') {
      throw new Error('Voice application verification failed.');
    }
    return {};
  }
}

async function getDefaultVoiceAppCheckToken(forceRefresh: boolean) {
  const { getFirebaseAppCheckToken } = await import('../auth/appCheck');
  return getFirebaseAppCheckToken(forceRefresh);
}
