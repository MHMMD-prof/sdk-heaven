import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import type { ComponentType } from 'react';
import { Platform } from 'react-native';

import {
  sanitizeChatAttributes,
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentrySpan,
} from './sentryPrivacy';
import { setPersonalChatTelemetryAdapter } from './personalChatTelemetry';

let initialized = false;

export function initializeObservability() {
  if (initialized) return;
  initialized = true;
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN || '';
  const production = process.env.EXPO_PUBLIC_APP_ENV === 'production';
  Sentry.init({
    attachScreenshot: false,
    attachViewHierarchy: false,
    beforeBreadcrumb: (breadcrumb) => sanitizeSentryBreadcrumb(breadcrumb as unknown as Record<string, unknown>) as typeof breadcrumb,
    beforeSend: (event) => sanitizeSentryEvent(event as unknown as Record<string, unknown>) as unknown as typeof event,
    beforeSendSpan: (span) => sanitizeSentrySpan(span as unknown as Record<string, unknown>) as unknown as typeof span,
    dist: Constants.nativeBuildVersion || undefined,
    dsn,
    enableAutoSessionTracking: true,
    enabled: Boolean(dsn),
    environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT || (production ? 'production' : 'development'),
    release: `${Constants.expoConfig?.slug || 'sdk-heaven'}@${Constants.expoConfig?.version || '0.0.0'}`,
    sendDefaultPii: false,
    tracesSampleRate: production ? 0.1 : 1,
  });
  Sentry.setTags({ feature: 'application', platform: Platform.OS });
  setPersonalChatTelemetryAdapter({
    breadcrumb: recordPersonalChatBreadcrumb,
    start: startPersonalChatOperation,
  });
}

export function wrapWithObservability<P extends Record<string, unknown>>(component: ComponentType<P>) {
  return Sentry.wrap(component);
}

export function startPersonalChatOperation(name: string, attributes: Record<string, unknown> = {}) {
  const span = Sentry.startInactiveSpan({
    attributes: sanitizeChatAttributes({ ...attributes, feature: 'personal-chat', platform: Platform.OS }) as Record<string, string | number | boolean | undefined>,
    name: `personal-chat.${name}`,
    op: 'personal-chat',
  });
  return {
    finish(outcome: 'failure' | 'success', errorCode = '') {
      span.setAttribute('outcome', outcome);
      if (errorCode) span.setAttribute('error_code', errorCode.slice(0, 64));
      span.end();
    },
  };
}

export function recordPersonalChatBreadcrumb(message: string, data: Record<string, unknown> = {}) {
  Sentry.addBreadcrumb({
    category: 'personal-chat',
    data: sanitizeChatAttributes({ ...data, feature: 'personal-chat', platform: Platform.OS }),
    level: 'info',
    message: message.slice(0, 64),
  });
}
