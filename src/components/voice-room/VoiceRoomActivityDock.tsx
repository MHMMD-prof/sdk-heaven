import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { CosmeticsFeatureFlags } from '../../cosmetics/featureFlags';
import { radius, typography } from '../../theme';
import {
  clampRoomActivityPageIndex,
  nextRoomActivityPageIndex,
  shouldRotateRoomActivity,
  type RoomActivityPage,
  type RoomLiveActivityKind,
} from '../../voice/roomSceneShellModel';
import {
  formatCompactIncentiveAmount,
  resolveRoomRocketRailSummary,
  resolveRoomTargetRailSummary,
} from '../../voice/roomIncentivePresentationModel';
import type { RoomChatMessage } from '../../voice/roomChat';
import type { RoomThemeManifest } from '../../voice/roomThemeContract';
import { resolveRoomThemeAssetSource } from '../../voice/roomThemeRuntime';
import type { RoomRocketData } from '../../voice/useRoomRocketData';
import type { RoomTargetData } from '../../voice/useRoomTargetData';
import { AvatarPresentation } from '../AvatarPresentation';
import { VoiceRoomActivityPreview } from './VoiceRoomActivityPreview';

const ROTATION_INTERVAL_MS = 6_000;

type VoiceRoomActivityDockProps = {
  chatEnabled: boolean;
  compact: boolean;
  cosmeticsFlags: CosmeticsFeatureFlags;
  detailSheetOpen: boolean;
  liveActivity?: RoomLiveActivityKind;
  liveContent?: ReactNode;
  manifest: RoomThemeManifest;
  messages: RoomChatMessage[];
  onOpenChat: () => void;
  onOpenRocket: () => void;
  onOpenSupporters: () => void;
  onOpenTarget: () => void;
  pages: RoomActivityPage[];
  rocket: RoomRocketData;
  target: RoomTargetData;
};

export function VoiceRoomActivityDock({
  chatEnabled,
  compact,
  cosmeticsFlags,
  detailSheetOpen,
  liveActivity,
  liveContent,
  manifest,
  messages,
  onOpenChat,
  onOpenRocket,
  onOpenSupporters,
  onOpenTarget,
  pages,
  rocket,
  target,
}: VoiceRoomActivityDockProps) {
  const scrollRef = useRef<ScrollView>(null);
  const previousPages = useRef<RoomActivityPage[]>(pages);
  const [pageWidth, setPageWidth] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [interacting, setInteracting] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const pagesKey = pages.join('|');

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReducedMotion(value);
    });
    void AccessibilityInfo.isScreenReaderEnabled().then((value) => {
      if (mounted) setScreenReaderEnabled(value);
    });
    const reduceMotionSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    const screenReaderSubscription = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReaderEnabled);
    const appStateSubscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => {
      mounted = false;
      reduceMotionSubscription.remove();
      screenReaderSubscription.remove();
      appStateSubscription.remove();
    };
  }, []);

  useEffect(() => {
    const selectedPage = previousPages.current[pageIndex];
    const preservedIndex = selectedPage ? pages.indexOf(selectedPage) : -1;
    const nextIndex = preservedIndex >= 0
      ? preservedIndex
      : clampRoomActivityPageIndex(pageIndex, pages.length);
    previousPages.current = pages;
    if (nextIndex !== pageIndex) {
      setPageIndex(nextIndex);
      if (pageWidth > 0) {
        scrollRef.current?.scrollTo({ animated: false, x: nextIndex * pageWidth, y: 0 });
      }
    }
  }, [pagesKey]);

  useEffect(() => {
    if (pageWidth > 0) {
      scrollRef.current?.scrollTo({ animated: false, x: pageIndex * pageWidth, y: 0 });
    }
  }, [pageWidth]);

  const rotationEnabled = shouldRotateRoomActivity({
    appActive,
    interacting,
    liveActivity: Boolean(liveActivity),
    pageCount: pages.length,
    reducedMotion,
    screenReaderEnabled,
    sheetOpen: detailSheetOpen,
  });

  useEffect(() => {
    if (!rotationEnabled || pageWidth <= 0) return undefined;
    const timer = setTimeout(() => {
      const nextIndex = nextRoomActivityPageIndex(pageIndex, pages.length);
      setPageIndex(nextIndex);
      scrollRef.current?.scrollTo({ animated: true, x: nextIndex * pageWidth, y: 0 });
    }, ROTATION_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [pageIndex, pageWidth, pages.length, rotationEnabled]);

  const onCarouselLayout = (event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    if (width > 0 && width !== pageWidth) setPageWidth(width);
  };

  const onMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (pageWidth > 0) {
      setPageIndex(clampRoomActivityPageIndex(
        Math.round(event.nativeEvent.contentOffset.x / pageWidth),
        pages.length,
      ));
    }
    setInteracting(false);
  };

  const dockArtwork = manifest.assets.dock;
  const dockHeight = compact ? 112 : 120;
  const hubHeight = compact ? 60 : 66;

  return (
    <LinearGradient
      accessibilityLabel="مركز نشاط الغرفة"
      colors={[`${manifest.colors.panel}D6`, `${manifest.colors.background}E8`]}
      style={[
        styles.dock,
        {
          borderColor: `${manifest.colors.gold}70`,
          height: dockHeight,
          shadowColor: manifest.colors.rubyBright,
        },
      ]}
    >
      {dockArtwork ? (
        <Image
          accessibilityIgnoresInvertColors
          contentFit="cover"
          pointerEvents="none"
          source={resolveRoomThemeAssetSource(dockArtwork.uri)}
          style={styles.artwork}
        />
      ) : null}
      <View pointerEvents="none" style={[styles.goldLine, { backgroundColor: manifest.colors.goldSoft }]} />
      {chatEnabled ? (
        <VoiceRoomActivityPreview
          cosmeticsFlags={cosmeticsFlags}
          manifest={manifest}
          messages={messages}
          onPress={onOpenChat}
        />
      ) : (
        <View style={styles.chatPlaceholder} />
      )}
      <View onLayout={onCarouselLayout} style={[styles.hub, { height: hubHeight }]}>
        {liveActivity && liveContent ? (
          <View key={liveActivity} style={styles.liveContent}>{liveContent}</View>
        ) : pages.length ? (
          <>
            <ScrollView
              bounces={false}
              contentContainerStyle={styles.carouselTrack}
              decelerationRate="fast"
              directionalLockEnabled
              disableIntervalMomentum
              horizontal
              onMomentumScrollBegin={() => setInteracting(true)}
              onMomentumScrollEnd={onMomentumScrollEnd}
              onScrollBeginDrag={() => setInteracting(true)}
              onScrollEndDrag={() => setInteracting(false)}
              onTouchEnd={() => setInteracting(false)}
              onTouchStart={() => setInteracting(true)}
              pagingEnabled
              ref={scrollRef}
              scrollEnabled={pages.length > 1}
              showsHorizontalScrollIndicator={false}
              style={styles.carousel}
            >
              {pages.map((page) => (
                <View key={page} style={[styles.page, { width: pageWidth || 1 }]}>
                  <SupportPage
                    cosmeticsFlags={cosmeticsFlags}
                    manifest={manifest}
                    onOpenRocket={onOpenRocket}
                    onOpenSupporters={onOpenSupporters}
                    onOpenTarget={onOpenTarget}
                    page={page}
                    rocket={rocket}
                    target={target}
                  />
                </View>
              ))}
            </ScrollView>
            {pages.length > 1 ? (
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.indicators}>
                {pages.map((page, index) => (
                  <View
                    key={page}
                    style={[
                      styles.indicator,
                      { backgroundColor: index === pageIndex ? manifest.colors.goldSoft : `${manifest.colors.textMuted}66` },
                      index === pageIndex && styles.indicatorActive,
                    ]}
                  />
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.supportEmpty}>
            <SymbolView name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }} size={17} tintColor={manifest.colors.goldSoft} />
            <Text style={[styles.supportEmptyText, { color: manifest.colors.textMuted }]}>مكافآت الغرفة ستظهر هنا</Text>
          </View>
        )}
      </View>
    </LinearGradient>
  );
}

function SupportPage({
  cosmeticsFlags,
  manifest,
  onOpenRocket,
  onOpenSupporters,
  onOpenTarget,
  page,
  rocket,
  target,
}: {
  cosmeticsFlags: CosmeticsFeatureFlags;
  manifest: RoomThemeManifest;
  onOpenRocket: () => void;
  onOpenSupporters: () => void;
  onOpenTarget: () => void;
  page: RoomActivityPage;
  rocket: RoomRocketData;
  target: RoomTargetData;
}) {
  const rocketSummary = resolveRoomRocketRailSummary(rocket);
  const targetSummary = resolveRoomTargetRailSummary(target);

  if (page === 'supporters') {
    return (
      <Pressable
        accessibilityHint="يفتح الترتيب اليومي والأسبوعي"
        accessibilityLabel={`أفضل داعمي الغرفة هذا الأسبوع، ${rocketSummary.supporters.length} في المراكز الثلاثة الأولى`}
        accessibilityRole="button"
        onPress={onOpenSupporters}
        style={({ pressed }) => [styles.supportPage, pressed && styles.pressed]}
      >
        <View style={[styles.pageIcon, { backgroundColor: `${manifest.colors.rubyBright}D8`, borderColor: manifest.colors.goldSoft }]}>
          <SymbolView name={{ ios: 'crown.fill', android: 'workspace_premium', web: 'workspace_premium' }} size={20} tintColor={manifest.colors.goldSoft} />
        </View>
        <View style={styles.pageCopy}>
          <Text style={[styles.eyebrow, { color: manifest.colors.goldSoft }]}>اليوم · هذا الأسبوع</Text>
          <Text numberOfLines={1} style={[styles.pageTitle, { color: manifest.colors.text }]}>أفضل 3 داعمين</Text>
        </View>
        <TopSupporters cosmeticsFlags={cosmeticsFlags} entries={rocketSummary.supporters} manifest={manifest} />
        <Chevron color={manifest.colors.textMuted} />
      </Pressable>
    );
  }

  if (page === 'rocket') {
    return (
      <Pressable
        accessibilityHint="يفتح تقدم وجوائز صاروخ الغرفة"
        accessibilityLabel={`صاروخ الغرفة، ${rocketSummary.progressPercent} بالمئة`}
        accessibilityRole="button"
        onPress={onOpenRocket}
        style={({ pressed }) => [styles.supportPage, pressed && styles.pressed]}
      >
        <View style={[styles.pageIcon, { backgroundColor: `${manifest.colors.rubyBright}D8`, borderColor: manifest.colors.goldSoft }]}>
          <SymbolView name={{ ios: 'paperplane.fill', android: 'rocket_launch', web: 'rocket_launch' }} size={21} tintColor={manifest.colors.goldSoft} />
        </View>
        <View style={styles.pageCopy}>
          <Text style={[styles.eyebrow, { color: manifest.colors.goldSoft }]}>صاروخ الغرفة</Text>
          <Text numberOfLines={1} style={[styles.pageTitle, { color: manifest.colors.text }]}>
            {rocketSummary.progressPercent}٪ · {formatCompactIncentiveAmount(rocketSummary.supportPoints)} نقطة
          </Text>
          <Progress manifest={manifest} value={rocketSummary.progress} />
        </View>
        <Chevron color={manifest.colors.textMuted} />
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityHint="يفتح الهدف الأسبوعي والعائد المتوقع"
      accessibilityLabel={`هدف الغرفة، ${targetSummary.progressPercent} بالمئة، العائد المتوقع ${targetSummary.projectedReturn}`}
      accessibilityRole="button"
      onPress={onOpenTarget}
      style={({ pressed }) => [styles.supportPage, pressed && styles.pressed]}
    >
      <View style={[styles.pageIcon, { backgroundColor: `${manifest.colors.rubyBright}D8`, borderColor: manifest.colors.goldSoft }]}>
        <SymbolView name={{ ios: 'scope', android: 'track_changes', web: 'track_changes' }} size={21} tintColor={manifest.colors.goldSoft} />
      </View>
      <View style={styles.pageCopy}>
        <Text style={[styles.eyebrow, { color: manifest.colors.goldSoft }]}>هدف الغرفة الأسبوعي</Text>
        <Text numberOfLines={1} style={[styles.pageTitle, { color: manifest.colors.text }]}>العائد المتوقع {targetSummary.projectedReturnLabel}</Text>
        <Progress manifest={manifest} value={targetSummary.progress} />
      </View>
      <Text style={[styles.percent, { color: manifest.colors.goldSoft }]}>{targetSummary.progressPercent}٪</Text>
      <Chevron color={manifest.colors.textMuted} />
    </Pressable>
  );
}

function TopSupporters({
  cosmeticsFlags,
  entries,
  manifest,
}: {
  cosmeticsFlags: CosmeticsFeatureFlags;
  entries: ReturnType<typeof resolveRoomRocketRailSummary>['supporters'];
  manifest: RoomThemeManifest;
}) {
  if (!entries.length) {
    return <Text style={[styles.noSupporters, { color: manifest.colors.textMuted }]}>بانتظار أول داعم</Text>;
  }
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.supporters}>
      {entries.map((entry, index) => (
        <View key={entry.uid} style={[styles.supporter, index > 0 && styles.supporterOverlap]}>
          <AvatarPresentation
            avatarUrl={entry.avatarUrl}
            flags={cosmeticsFlags}
            frame={entry.avatarFrame}
            label={entry.avatarLabel || entry.displayName}
            size={28}
            viewerMode="reduced"
          />
          <Text style={[styles.rank, { backgroundColor: manifest.colors.rubyBright, color: manifest.colors.text }]}>{entry.rank}</Text>
        </View>
      ))}
    </View>
  );
}

function Progress({ manifest, value }: { manifest: RoomThemeManifest; value: number }) {
  return (
    <View style={[styles.track, { backgroundColor: `${manifest.colors.panelRaised}F2` }]}>
      <LinearGradient
        colors={[manifest.colors.rubyBright, manifest.colors.gold, manifest.colors.goldSoft]}
        end={{ x: 1, y: 0 }}
        start={{ x: 0, y: 0 }}
        style={[styles.fill, { width: `${Math.max(2, value * 100)}%` }]}
      />
    </View>
  );
}

function Chevron({ color }: { color: string }) {
  return <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} size={15} tintColor={color} />;
}

const styles = StyleSheet.create({
  artwork: { ...StyleSheet.absoluteFill, opacity: 0.08 },
  carousel: { direction: 'ltr', flex: 1 },
  carouselTrack: { alignItems: 'stretch', flexDirection: 'row' },
  chatPlaceholder: { height: 40 },
  dock: {
    borderRadius: radius.xl,
    borderWidth: 1,
    elevation: 5,
    gap: 4,
    marginTop: 5,
    overflow: 'hidden',
    padding: 4,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    width: '100%',
  },
  eyebrow: { fontSize: 8, fontWeight: typography.weights.bold, textAlign: 'right', writingDirection: 'rtl' },
  fill: { borderRadius: radius.full, height: '100%' },
  goldLine: { height: 1, left: 22, opacity: 0.7, position: 'absolute', right: 22, top: 0 },
  hub: { minWidth: 0, overflow: 'hidden', width: '100%' },
  indicator: { borderRadius: radius.full, height: 3, width: 3 },
  indicatorActive: { width: 12 },
  indicators: { bottom: 2, flexDirection: 'row', gap: 4, justifyContent: 'center', left: 0, position: 'absolute', right: 0 },
  liveContent: { flex: 1, justifyContent: 'center' },
  noSupporters: { fontSize: 9, maxWidth: 82, textAlign: 'center', writingDirection: 'rtl' },
  page: { flex: 1 },
  pageCopy: { alignItems: 'flex-end', flex: 1, gap: 1, minWidth: 0 },
  pageIcon: { alignItems: 'center', borderRadius: radius.full, borderWidth: 1, height: 38, justifyContent: 'center', width: 38 },
  pageTitle: { fontSize: 11, fontWeight: typography.weights.black, textAlign: 'right', writingDirection: 'rtl' },
  percent: { fontSize: 12, fontWeight: typography.weights.black, minWidth: 35, textAlign: 'center' },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  rank: { borderRadius: radius.full, bottom: -1, fontSize: 6, fontWeight: typography.weights.black, height: 11, lineHeight: 11, position: 'absolute', right: -1, textAlign: 'center', width: 11 },
  supporter: { height: 30, width: 30 },
  supporterOverlap: { marginLeft: -7 },
  supporters: { alignItems: 'center', flexDirection: 'row', paddingLeft: 7 },
  supportEmpty: { alignItems: 'center', flex: 1, flexDirection: 'row-reverse', gap: 7, justifyContent: 'center' },
  supportEmptyText: { fontSize: 10, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  supportPage: { alignItems: 'center', flex: 1, flexDirection: 'row-reverse', gap: 8, paddingBottom: 7, paddingHorizontal: 9, paddingTop: 4 },
  track: { borderRadius: radius.full, height: 3, marginTop: 2, overflow: 'hidden', width: '88%' },
});
