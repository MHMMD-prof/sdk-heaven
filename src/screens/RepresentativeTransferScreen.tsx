import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import WebView, {
  type WebViewMessageEvent,
  type WebViewNavigation,
} from 'react-native-webview';

import { ScreenContainer } from '../components/ScreenContainer';
import {
  requestRepresentativePortalTicket,
  requestRepresentativeStatus,
} from '../social/requestSocialCommand';
import {
  createRepresentativePortalLaunch,
  createRepresentativePortalRefreshMessage,
  isAllowedRepresentativePortalNavigation,
  parseRepresentativePortalBridgeMessage,
  type RepresentativePortalLaunch,
} from '../social/representativePortalWebView';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'RepresentativeTransfer'>;
type ScreenPhase = 'booting' | 'error' | 'ready' | 'unavailable';

const PORTAL_LOAD_EXPIRY_BUFFER_MILLISECONDS = 5_000;

export function RepresentativeTransferScreen({ navigation }: Props) {
  const webViewRef = useRef<WebView>(null);
  const requestGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const launchRef = useRef<RepresentativePortalLaunch | undefined>(undefined);
  const [launch, setLaunch] = useState<RepresentativePortalLaunch>();
  const [phase, setPhase] = useState<ScreenPhase>('booting');
  const [message, setMessage] = useState('');
  const [loadProgress, setLoadProgress] = useState(0);

  const stopWebView = useCallback(() => {
    webViewRef.current?.stopLoading();
    webViewRef.current?.clearHistory?.();
    launchRef.current = undefined;
  }, []);

  const disposeWebView = useCallback(() => {
    requestGenerationRef.current += 1;
    stopWebView();
    if (mountedRef.current) {
      setLaunch(undefined);
      setLoadProgress(0);
    }
  }, [stopWebView]);

  const showUnavailable = useCallback((reason: string) => {
    disposeWebView();
    if (mountedRef.current) {
      setMessage(reason);
      setPhase('unavailable');
    }
  }, [disposeWebView]);

  const showError = useCallback((reason: string) => {
    disposeWebView();
    if (mountedRef.current) {
      setMessage(reason);
      setPhase('error');
    }
  }, [disposeWebView]);

  const bootstrapPortal = useCallback(async () => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    stopWebView();
    setLaunch(undefined);
    setLoadProgress(0);
    setMessage('');
    setPhase('booting');

    const statusResponse = await requestRepresentativeStatus();
    if (!mountedRef.current || generation !== requestGenerationRef.current) return;
    if (!statusResponse.ok) {
      showError(statusResponse.error.messageAr);
      return;
    }
    if (!statusResponse.result.feature.available || !statusResponse.result.privilege.active) {
      showUnavailable(
        statusResponse.result.privilege.active
          ? 'بوابة الوكيل متوقفة حالياً.'
          : 'هذا الحساب لا يملك صلاحية وكيل نشطة.',
      );
      return;
    }

    const ticketResponse = await requestRepresentativePortalTicket();
    if (!mountedRef.current || generation !== requestGenerationRef.current) return;
    if (!ticketResponse.ok) {
      showError(ticketResponse.error.messageAr);
      return;
    }

    const nextLaunch = createRepresentativePortalLaunch(ticketResponse.result);
    if (!nextLaunch
      || nextLaunch.expiresAtMillis <= Date.now() + PORTAL_LOAD_EXPIRY_BUFFER_MILLISECONDS) {
      showError('تعذّر بدء جلسة آمنة. حاول مرة أخرى.');
      return;
    }

    launchRef.current = nextLaunch;
    setLaunch(nextLaunch);
    setPhase('ready');
  }, [showError, showUnavailable, stopWebView]);

  const leavePortal = useCallback(() => {
    disposeWebView();
    navigation.goBack();
  }, [disposeWebView, navigation]);

  const verifyAccessAndRefresh = useCallback(async () => {
    const activeLaunch = launchRef.current;
    if (!activeLaunch || phase !== 'ready') return;

    const response = await requestRepresentativeStatus();
    if (!mountedRef.current || launchRef.current !== activeLaunch) return;
    if (!response.ok) {
      showError(response.error.messageAr);
      return;
    }
    if (!response.result.feature.available || !response.result.privilege.active) {
      showUnavailable('تم إيقاف بوابة الوكيل أو سحب الصلاحية من هذا الحساب.');
      return;
    }
    webViewRef.current?.postMessage(createRepresentativePortalRefreshMessage());
  }, [phase, showError, showUnavailable]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void verifyAccessAndRefresh();
    });
    return () => subscription.remove();
  }, [verifyAccessAndRefresh]);

  useFocusEffect(useCallback(() => {
    void bootstrapPortal();
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      leavePortal();
      return true;
    });
    return () => {
      subscription.remove();
      requestGenerationRef.current += 1;
      stopWebView();
    };
  }, [bootstrapPortal, leavePortal, stopWebView]));

  useEffect(() => () => {
    mountedRef.current = false;
    requestGenerationRef.current += 1;
    stopWebView();
  }, [stopWebView]);

  const handlePortalMessage = useCallback((event: WebViewMessageEvent) => {
    const portalMessage = parseRepresentativePortalBridgeMessage(event.nativeEvent.data);
    if (!portalMessage) return;

    switch (portalMessage.type) {
      case 'close':
        leavePortal();
        return;
      case 'feature-disabled':
        showUnavailable('تم إيقاف بوابة الوكيل من الإدارة.');
        return;
      case 'session-expired':
        showUnavailable('انتهت جلسة بوابة الوكيل. ارجع إلى صفحة أنا وافتحها مجدداً.');
        return;
      case 'refresh-balance':
        void verifyAccessAndRefresh();
        return;
      case 'receipt-share':
        void Share.share({
          message: portalMessage.text,
          title: 'إيصال تسليم رصيد افتراضي',
          ...(Platform.OS === 'ios' && portalMessage.imageDataUrl
            ? { url: portalMessage.imageDataUrl }
            : null),
        });
        return;
    }
  }, [leavePortal, showUnavailable, verifyAccessAndRefresh]);

  const blockPopup = useCallback(() => {
    webViewRef.current?.stopLoading();
  }, []);

  const handleNavigationChange = useCallback((state: WebViewNavigation) => {
    const activeLaunch = launchRef.current;
    if (!activeLaunch || isAllowedRepresentativePortalNavigation(activeLaunch.origin, state.url)) {
      return;
    }
    webViewRef.current?.stopLoading();
  }, []);

  return (
    <ScreenContainer
      decorativeGlows={false}
      horizontalPadding={0}
      scroll={false}
      topPadding={0}
      variant="ruby"
    >
      <View style={styles.page}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="رجوع"
            accessibilityRole="button"
            hitSlop={10}
            onPress={leavePortal}
            style={styles.headerButton}
          >
            <SymbolView
              name={{ android: 'arrow_forward', ios: 'chevron.right', web: 'arrow_forward' }}
              size={21}
              tintColor={colors.goldSoft}
            />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>SDK HEAVEN</Text>
            <Text style={styles.title}>بوابة الوكيل</Text>
          </View>
          <View style={styles.headerButtonPlaceholder} />
        </View>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <View style={styles.dividerDiamond} />
          <View style={styles.dividerLine} />
        </View>

        {phase === 'ready' && launch ? (
          <View style={styles.webViewFrame}>
            <WebView
              ref={webViewRef}
              allowFileAccess={false}
              allowFileAccessFromFileURLs={false}
              allowUniversalAccessFromFileURLs={false}
              allowsBackForwardNavigationGestures={false}
              allowsFullscreenVideo={false}
              cacheEnabled={false}
              domStorageEnabled={false}
              incognito
              javaScriptCanOpenWindowsAutomatically={false}
              mediaPlaybackRequiresUserAction
              mixedContentMode="never"
              onContentProcessDidTerminate={() => showError('توقفت البوابة بشكل غير متوقع. حاول مرة أخرى.')}
              onError={() => showError('تعذّر الاتصال ببوابة الوكيل. تحقق من الإنترنت وحاول مرة أخرى.')}
              onFileDownload={blockPopup}
              onHttpError={(event) => {
                if (event.nativeEvent.statusCode < 500) return;
                try {
                  const failedUrl = new URL(event.nativeEvent.url);
                  if (failedUrl.origin === launch.origin && failedUrl.pathname === '/') {
                    showError('بوابة الوكيل غير متاحة مؤقتاً. حاول مرة أخرى.');
                  }
                } catch {
                  // Navigation policy handles malformed URLs.
                }
              }}
              onLoadProgress={(event) => setLoadProgress(event.nativeEvent.progress)}
              onLoadStart={() => setLoadProgress(0)}
              onMessage={handlePortalMessage}
              onNavigationStateChange={handleNavigationChange}
              onOpenWindow={blockPopup}
              onRenderProcessGone={() => showError('توقفت البوابة بشكل غير متوقع. حاول مرة أخرى.')}
              onShouldStartLoadWithRequest={(request) => (
                isAllowedRepresentativePortalNavigation(launch.origin, request.url)
              )}
              originWhitelist={[launch.origin]}
              pullToRefreshEnabled={false}
              setSupportMultipleWindows={false}
              sharedCookiesEnabled={false}
              source={{
                headers: {
                  'Cache-Control': 'no-store',
                  Pragma: 'no-cache',
                },
                uri: launch.uri,
              }}
              style={styles.webView}
              thirdPartyCookiesEnabled={false}
            />
            {loadProgress < 1 ? (
              <View pointerEvents="none" style={styles.loadingOverlay}>
                <ActivityIndicator color={colors.gold} size="large" />
                <Text style={styles.loadingText}>جارٍ فتح جلسة آمنة…</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.state}>
            {phase === 'booting' ? (
              <>
                <ActivityIndicator color={colors.gold} size="large" />
                <Text style={styles.stateTitle}>جارٍ التحقق من الصلاحية</Text>
                <Text style={styles.stateBody}>يتم تجهيز جلسة وكيل مؤقتة وآمنة.</Text>
              </>
            ) : (
              <>
                <View style={styles.stateIcon}>
                  <SymbolView
                    name={{
                      android: phase === 'unavailable' ? 'lock' : 'cloud_off',
                      ios: phase === 'unavailable' ? 'lock.shield' : 'wifi.slash',
                      web: phase === 'unavailable' ? 'lock' : 'cloud_off',
                    }}
                    size={30}
                    tintColor={colors.goldSoft}
                  />
                </View>
                <Text style={styles.stateTitle}>
                  {phase === 'unavailable' ? 'الخدمة غير متاحة' : 'تعذّر فتح البوابة'}
                </Text>
                <Text style={styles.stateBody}>{message}</Text>
                {phase === 'error' ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void bootstrapPortal()}
                    style={styles.retryButton}
                  >
                    <Text style={styles.retryText}>إعادة المحاولة</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={leavePortal}
                  style={styles.returnButton}
                >
                  <Text style={styles.returnText}>العودة إلى صفحة أنا</Text>
                </Pressable>
              </>
            )}
          </View>
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 58,
    paddingHorizontal: spacing.lg,
  },
  headerButton: {
    alignItems: 'center',
    borderColor: 'rgba(232,190,97,0.38)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  headerButtonPlaceholder: {
    height: 42,
    width: 42,
  },
  headerCopy: {
    alignItems: 'center',
    flex: 1,
  },
  eyebrow: {
    color: colors.goldDeep,
    fontSize: 9,
    fontWeight: typography.weights.black,
    letterSpacing: 2.2,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: typography.weights.black,
    marginTop: 1,
    writingDirection: 'rtl',
  },
  divider: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
  },
  dividerLine: {
    backgroundColor: 'rgba(232,190,97,0.42)',
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerDiamond: {
    borderColor: colors.goldDeep,
    borderWidth: 1,
    height: 10,
    marginHorizontal: spacing.sm,
    transform: [{ rotate: '45deg' }],
    width: 10,
  },
  webViewFrame: {
    backgroundColor: '#050202',
    flex: 1,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  webView: {
    backgroundColor: '#050202',
    flex: 1,
  },
  loadingOverlay: {
    alignItems: 'center',
    backgroundColor: '#050202',
    gap: spacing.md,
    inset: 0,
    justifyContent: 'center',
    position: 'absolute',
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 14,
    writingDirection: 'rtl',
  },
  state: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#130708',
    borderColor: 'rgba(232,190,97,0.26)',
    borderRadius: radius.xl,
    borderWidth: 1,
    gap: spacing.md,
    justifyContent: 'center',
    marginHorizontal: spacing.xl,
    marginTop: spacing.xxl,
    maxWidth: 460,
    minHeight: 290,
    padding: spacing.xl,
    width: '88%',
  },
  stateIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(184,41,75,0.16)',
    borderColor: 'rgba(232,190,97,0.28)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  stateTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  stateBody: {
    color: colors.textMuted,
    lineHeight: 22,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  retryButton: {
    alignItems: 'center',
    backgroundColor: colors.gold,
    borderRadius: radius.full,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    width: '100%',
  },
  retryText: {
    color: '#26090C',
    fontWeight: typography.weights.black,
  },
  returnButton: {
    alignItems: 'center',
    borderColor: 'rgba(232,190,97,0.32)',
    borderRadius: radius.full,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: spacing.xl,
    width: '100%',
  },
  returnText: {
    color: colors.goldSoft,
    fontWeight: typography.weights.bold,
  },
});
