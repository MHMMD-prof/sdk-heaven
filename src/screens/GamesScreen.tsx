import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { GamePreviewCard } from '../components/GamePreviewCard';
import { GlassCard } from '../components/GlassCard';
import { ScreenContainer } from '../components/ScreenContainer';
import { SectionHeader } from '../components/SectionHeader';
import { featuredGames } from '../data/featuredGames';
import { useGrowthFeatureFlags } from '../growth/featureFlags';
import { setGrowthMatchMask } from '../growth/matchSession';
import {
  requestQuickMatch,
  requestSoftMatchCancel,
  requestSoftMatchEnqueue,
  requestSoftMatchStatus,
} from '../social/requestSocialCommand';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types/navigation';
import { createFutureWebViewBridgeNote } from '../utils/webViewBridge';

type GamesScreenProps = {
  bottomNavigation: ReactNode;
  navigation: NativeStackNavigationProp<RootStackParamList, 'Main'>;
  onBrowseRooms: () => void;
};

export function GamesScreen({ bottomNavigation, navigation, onBrowseRooms }: GamesScreenProps) {
  // Future wave: this placeholder marks where WebView game bridge setup will be invoked.
  createFutureWebViewBridgeNote();
  const growthFlags = useGrowthFeatureFlags();
  const [matching, setMatching] = useState(false);
  const [softMatching, setSoftMatching] = useState(false);
  const [notice, setNotice] = useState('');
  const softMatchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const softMatchWaitingRef = useRef(false);
  const softMatchJoiningRef = useRef(false);

  const clearSoftMatchPoll = () => {
    if (softMatchPollRef.current) {
      clearInterval(softMatchPollRef.current);
      softMatchPollRef.current = null;
    }
  };

  const stopSoftMatch = (message = '') => {
    clearSoftMatchPoll();
    softMatchWaitingRef.current = false;
    softMatchJoiningRef.current = false;
    setSoftMatching(false);
    if (message) setNotice(message);
  };

  useEffect(() => () => {
    clearSoftMatchPoll();
    if (softMatchWaitingRef.current) {
      softMatchWaitingRef.current = false;
      void requestSoftMatchCancel();
    }
  }, []);

  useEffect(() => {
    if (growthFlags.softOneToOneMatch || !softMatching) return;
    stopSoftMatch('تم إيقاف المحادثة الصوتية السريعة مؤقتاً.');
    void requestSoftMatchCancel();
  }, [growthFlags.softOneToOneMatch, softMatching]);

  const openSoftMatchRoom = async (roomId: string) => {
    if (softMatchJoiningRef.current) return;
    softMatchJoiningRef.current = true;
    softMatchWaitingRef.current = false;
    try {
      navigation.navigate('VoiceRoom', { roomId });
    } finally {
      softMatchJoiningRef.current = false;
      setSoftMatching(false);
    }
  };

  const applySoftMatchStatus = async () => {
    if (softMatchJoiningRef.current) return;
    const status = await requestSoftMatchStatus();
    if (!status.ok) {
      if (status.error.code === 'FEATURE_DISABLED') {
        stopSoftMatch(status.error.messageAr || 'تم إيقاف المحادثة الصوتية السريعة مؤقتاً.');
      }
      return;
    }
    if (status.result.status === 'matched') {
      clearSoftMatchPoll();
      softMatchWaitingRef.current = false;
      try {
        await openSoftMatchRoom(status.result.roomId);
      } catch {
        setNotice('تعذر فتح المحادثة الصوتية. حاول مرة أخرى.');
        setSoftMatching(false);
      }
      return;
    }
    if (status.result.status === 'idle') {
      stopSoftMatch('انتهى وقت الانتظار. حاول مرة أخرى.');
    }
  };

  const playInRoom = async () => {
    setNotice('');
    if (!growthFlags.quickMatch) {
      onBrowseRooms();
      return;
    }
    if (matching || softMatching) return;
    setMatching(true);
    try {
      const response = await requestQuickMatch();
      if (!response.ok) {
        setNotice(response.error.messageAr || 'تعذر إيجاد غرفة مناسبة الآن.');
        return;
      }
      if (response.result.masked && response.result.mask) {
        setGrowthMatchMask({
          expiresAtMs: response.result.mask.expiresAtMs,
          labelAr: response.result.mask.labelAr,
          roomId: response.result.roomId,
        });
      }
      navigation.navigate('VoiceRoom', { roomId: response.result.roomId });
    } catch {
      setNotice('تعذر الانضمام بعد المطابقة. حاول مرة أخرى.');
    } finally {
      setMatching(false);
    }
  };

  const startSoftMatch = async () => {
    if (!growthFlags.softOneToOneMatch || softMatching || matching || softMatchJoiningRef.current) return;
    setNotice('');
    setSoftMatching(true);
    clearSoftMatchPoll();
    try {
      const response = await requestSoftMatchEnqueue();
      if (!response.ok) {
        stopSoftMatch(response.error.messageAr || 'تعذر بدء المحادثة الصوتية الآن.');
        return;
      }
      if (response.result.status === 'matched') {
        softMatchWaitingRef.current = false;
        await openSoftMatchRoom(response.result.roomId);
        return;
      }
      if (response.result.status !== 'waiting') {
        stopSoftMatch();
        return;
      }
      softMatchWaitingRef.current = true;
      setNotice('جارٍ البحث عن محادثة صوتية قصيرة… اضغط إلغاء للتوقف.');
      softMatchPollRef.current = setInterval(() => {
        void applySoftMatchStatus();
      }, 2000);
    } catch {
      stopSoftMatch('تعذر بدء المحادثة الصوتية. تحقق من الاتصال وحاول مرة أخرى.');
    }
  };

  return (
    <ScreenContainer bottomInset fixedBottom={bottomNavigation}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>مركز الألعاب</Text>
        <Text style={styles.title}>الألعاب</Text>
        <Text style={styles.subtitle}>
          العب محلياً للمتعة، أو ادخل غرفة صوتية لطاولة جماعية مثل خمن الرسم. رسوم الدخول اختيارية وترفيهية وليست مراهنة.
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={matching || softMatching}
        onPress={() => { void playInRoom(); }}
        style={({ pressed }) => [styles.roomCta, pressed && styles.pressed, (matching || softMatching) && styles.disabled]}
      >
        {matching ? (
          <ActivityIndicator color="#FFF1D4" />
        ) : (
          <>
            <Text style={styles.roomCtaTitle}>العب في غرفة</Text>
            <Text style={styles.roomCtaBody}>
              {growthFlags.quickMatch
                ? 'مطابقة سريعة ثم افتح ألعاب الغرفة من الشريط السفلي'
                : 'انتقل إلى الغرف وادعُ أصدقاءك لطاولة جماعية'}
            </Text>
          </>
        )}
      </Pressable>

      {growthFlags.softOneToOneMatch || softMatching ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={softMatching ? 'إلغاء المحادثة الصوتية السريعة' : 'محادثة صوتية سريعة'}
          onPress={() => {
            if (softMatching) {
              stopSoftMatch();
              void requestSoftMatchCancel();
              return;
            }
            void startSoftMatch();
          }}
          style={({ pressed }) => [styles.softCta, pressed && styles.pressed]}
        >
          {softMatching ? (
            <ActivityIndicator color="#F7D67C" />
          ) : (
            <>
              <Text style={styles.softCtaTitle}>صوت سريع</Text>
              <Text style={styles.softCtaBody}>محادثة صوتية قصيرة مع شخص آخر — ليست مواعدة</Text>
            </>
          )}
        </Pressable>
      ) : null}

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <View style={styles.summaryRow}>
        <InfoPill label="نشطة" value="2" />
        <InfoPill label="قريبا" value="2" />
        <InfoPill label="النمط" value="اجتماعي" />
      </View>

      <SectionHeader actionLabel="هذا الشهر" title="كتالوج الألعاب" />
      <View style={styles.gamesGrid}>
        {featuredGames.map((game, index) => (
          <GamePreviewCard
            featured={index === 0}
            game={game}
            key={game.id}
            onPress={
              game.id === 'carrom-royal'
                ? () => navigation.navigate('Carrom', {})
                : game.id === 'royal-majlis'
                  ? () => navigation.navigate('MiniGame', { initialMode: 'naval' })
                  : game.id === 'drawing-guess'
                    ? () =>
                        navigation.navigate('DrawingGuess', {
                          mode: 'local-simulated',
                          source: 'games',
                        })
                  : undefined
            }
          />
        ))}
      </View>

      <GlassCard style={styles.sdkCard}>
        <Text style={styles.sdkTitle}>بوابة الألعاب الخارجية</Text>
        <Text style={styles.sdkBody}>
          مساحة جاهزة لربط ألعاب WebView لاحقا عبر طبقة منظمة بين اللعبة والتطبيق.
        </Text>
      </GlassCard>
    </ScreenContainer>
  );
}

type InfoPillProps = {
  label: string;
  value: string;
};

function InfoPill({ label, value }: InfoPillProps) {
  return (
    <View style={styles.infoPill}>
      <Text style={styles.infoValue}>{value}</Text>
      <Text style={styles.infoLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.lg,
  },
  eyebrow: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  title: {
    color: colors.text,
    fontSize: typography.sizes.headline,
    fontWeight: typography.weights.black,
    marginTop: spacing.xs,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    lineHeight: 23,
    marginTop: spacing.sm,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  roomCta: {
    backgroundColor: '#2A1A0F',
    borderColor: 'rgba(247, 214, 124, 0.35)',
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.xs,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  softCta: {
    backgroundColor: 'rgba(42, 26, 15, 0.72)',
    borderColor: 'rgba(247, 214, 124, 0.22)',
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.xs,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  roomCtaTitle: {
    color: '#FFF1D4',
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  softCtaTitle: {
    color: '#F7D67C',
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  roomCtaBody: {
    color: 'rgba(255, 241, 212, 0.72)',
    fontSize: typography.sizes.caption,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  softCtaBody: {
    color: 'rgba(247, 214, 124, 0.7)',
    fontSize: typography.sizes.caption,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  notice: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    marginBottom: spacing.md,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  pressed: {
    opacity: 0.86,
  },
  disabled: {
    opacity: 0.6,
  },
  summaryRow: {
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  infoPill: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: radius.md,
    flex: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  infoValue: {
    color: colors.text,
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
  },
  infoLabel: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    marginTop: 2,
    textAlign: 'center',
  },
  gamesGrid: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  sdkCard: {
    marginBottom: spacing.xl,
    padding: spacing.lg,
  },
  sdkTitle: {
    color: colors.text,
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  sdkBody: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    lineHeight: 22,
    marginTop: spacing.sm,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
