import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { requestPushDeviceRegistration, requestPushDeviceUnregistration } from '../social/requestSocialCommand';

export type PushRegistrationOutcome =
  | { ok: true; token: string }
  | { ok: false; code: 'DENIED' | 'DEVELOPMENT_BUILD_REQUIRED' | 'NO_PROJECT_ID' | 'UNSUPPORTED' | 'REGISTRATION_FAILED'; messageAr: string };

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerCurrentDevice(requestPermission: boolean): Promise<PushRegistrationOutcome> {
  const tokenResult = await getCurrentDeviceToken(requestPermission);
  if (!tokenResult.ok) return tokenResult;
  const response = await requestPushDeviceRegistration({
    deviceName: Device.deviceName || Device.modelName || '',
    platform: Platform.OS as 'android' | 'ios',
    token: tokenResult.token,
  });
  if (!response.ok) return { ok: false, code: 'REGISTRATION_FAILED', messageAr: response.error.messageAr };
  return tokenResult;
}

export async function unregisterCurrentDevice(): Promise<PushRegistrationOutcome> {
  const tokenResult = await getCurrentDeviceToken(false);
  if (!tokenResult.ok) return tokenResult;
  const response = await requestPushDeviceUnregistration(tokenResult.token);
  if (!response.ok) return { ok: false, code: 'REGISTRATION_FAILED', messageAr: response.error.messageAr };
  return tokenResult;
}

async function getCurrentDeviceToken(requestPermission: boolean): Promise<PushRegistrationOutcome> {
  if (!['android', 'ios'].includes(Platform.OS)) {
    return { ok: false, code: 'UNSUPPORTED', messageAr: 'الإشعارات الفورية متاحة على أندرويد وiOS فقط.' };
  }
  if (Platform.OS === 'android' && Constants.appOwnership === 'expo') {
    return { ok: false, code: 'DEVELOPMENT_BUILD_REQUIRED', messageAr: 'الإشعارات الفورية على أندرويد تحتاج نسخة تطوير أو نسخة إصدار، ولا تعمل داخل Expo Go.' };
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('social', {
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#B31224',
      name: 'التحديثات الاجتماعية',
      sound: 'default',
      vibrationPattern: [0, 250, 180, 250],
    });
  }

  let permission = await Notifications.getPermissionsAsync();
  if (!hasNotificationPermission(permission) && requestPermission) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!hasNotificationPermission(permission)) {
    return { ok: false, code: 'DENIED', messageAr: 'لم يتم السماح للتطبيق بإرسال الإشعارات.' };
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (typeof projectId !== 'string' || !projectId) {
    return { ok: false, code: 'NO_PROJECT_ID', messageAr: 'تعذر تحديد مشروع الإشعارات لهذه النسخة.' };
  }

  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    return { ok: true, token };
  } catch {
    return { ok: false, code: 'REGISTRATION_FAILED', messageAr: 'تعذر تسجيل هذا الجهاز للإشعارات. تحقق من الاتصال وحاول مجدداً.' };
  }
}

export function subscribeNotificationResponses(listener: (data: Record<string, unknown>, identifier: string) => void) {
  const lastResponse = Notifications.getLastNotificationResponse();
  if (lastResponse) listener(lastResponse.notification.request.content.data || {}, lastResponse.notification.request.identifier);
  const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
    listener(response.notification.request.content.data || {}, response.notification.request.identifier);
  });
  const tokenSubscription = Notifications.addPushTokenListener(() => {
    void registerCurrentDevice(false);
  });
  return () => {
    responseSubscription.remove();
    tokenSubscription.remove();
  };
}

function hasNotificationPermission(permission: Notifications.NotificationPermissionsStatus) {
  if (permission.granted) return true;
  if (Platform.OS !== 'ios') return false;
  return permission.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED
    || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
    || permission.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL;
}
