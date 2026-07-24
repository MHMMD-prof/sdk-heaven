import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { radius, spacing, typography } from '../theme';
import { CarromCoinKind, CarromPlayer } from '../types/carrom';
import { ShotHistoryItem, getHistoryToneStyle } from '../utils/carromPresentation';

const royalConceptImage = require('../../assets/carrom/concepts/gameplay-1-royal-majlis.jpg');
const ROYAL_CONCEPT_HEIGHT = 1280;
const CAPTURE_DOTS = [0, 1, 2, 3, 4];

const ROYAL = {
  gold: '#D7A03D',
  goldBright: '#F3D178',
  goldDeep: '#7A4B18',
  ivory: '#F5E8CE',
  muted: '#A89378',
  ruby: '#B11C28',
};

type CarromHeaderProps = {
  onBack: () => void;
  onReset: () => void;
  title: string;
};

type RoyalReferenceSliceProps = {
  sliceHeight: number;
  sourceY: number;
  style?: StyleProp<ViewStyle>;
};

function RoyalReferenceSlice({ sliceHeight, sourceY, style }: RoyalReferenceSliceProps) {
  const imageHeight = `${(ROYAL_CONCEPT_HEIGHT / sliceHeight) * 100}%` as `${number}%`;
  const imageTop = `${-(sourceY / sliceHeight) * 100}%` as `${number}%`;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.referenceSlice, { aspectRatio: 720 / sliceHeight }, style]}
    >
      <Image
        resizeMode="stretch"
        source={royalConceptImage}
        style={[styles.referenceSliceImage, { height: imageHeight, top: imageTop }]}
      />
    </View>
  );
}

export function CarromHeader({ onBack, onReset, title }: CarromHeaderProps) {
  return (
    <View style={styles.referenceHeader}>
      <RoyalReferenceSlice sliceHeight={145} sourceY={0} />
      <Text numberOfLines={1} style={styles.referenceHeaderTitle}>{title}</Text>
      <Pressable
        accessibilityLabel="رجوع"
        accessibilityRole="button"
        hitSlop={6}
        onPress={onBack}
        style={({ pressed }) => [styles.headerTap, styles.headerTapLeft, pressed && styles.pressed]}
      />
      <Pressable
        accessibilityLabel="إعادة الجولة"
        accessibilityRole="button"
        hitSlop={6}
        onPress={onReset}
        style={({ pressed }) => [styles.headerTap, styles.headerTapRight, pressed && styles.pressed]}
      />
    </View>
  );
}

type CarromPlayerRailProps = {
  compact: boolean;
  currentPlayer: CarromPlayer;
  playerCoins: Record<CarromPlayer, CarromCoinKind>;
  remaining: Record<CarromPlayer, number>;
  scores: Record<CarromPlayer, number>;
};

export function CarromPlayerRail({
  compact,
  currentPlayer,
  playerCoins,
  remaining,
  scores,
}: CarromPlayerRailProps) {
  return (
    <View style={[styles.playerRail, compact && styles.playerRailCompact]}>
      <PlayerBadge
        active={currentPlayer === 2}
        coinKind={playerCoins[2]}
        compact={compact}
        player={2}
        remaining={remaining[2]}
        score={scores[2]}
      />
      <LinearGradient
        colors={['#FFE28A', '#C18425', '#5B2B08']}
        style={[styles.turnMedallion, compact && styles.turnMedallionCompact]}
      >
        <View style={styles.turnMedallionInner}>
          <SymbolView
            name={{ ios: 'sun.max.fill', android: 'light_mode', web: 'light_mode' }}
            size={compact ? 23 : 27}
            style={styles.turnSymbol}
            tintColor="#171008"
          />
        </View>
      </LinearGradient>
      <PlayerBadge
        active={currentPlayer === 1}
        coinKind={playerCoins[1]}
        compact={compact}
        player={1}
        remaining={remaining[1]}
        score={scores[1]}
      />
    </View>
  );
}

type PlayerBadgeProps = {
  active: boolean;
  compact: boolean;
  coinKind: CarromCoinKind;
  player: CarromPlayer;
  remaining: number;
  score: number;
};

function PlayerBadge({ active, compact, coinKind, player, remaining, score }: PlayerBadgeProps) {
  const isBlack = coinKind === 'black';

  return (
    <LinearGradient
      accessibilityLabel={`اللاعب ${player}، النتيجة ${score}، متبقي ${remaining}`}
      accessible
      colors={isBlack ? ['#171515', '#030303'] : ['#FFF8E9', '#CCB78F']}
      style={[
        styles.playerBadge,
        !isBlack && styles.playerBadgeIvory,
        compact && styles.playerBadgeCompact,
        active && styles.playerBadgeActive,
      ]}
    >
      <View style={[styles.scoreCoin, isBlack ? styles.scoreCoinBlack : styles.scoreCoinIvory]}>
        <View style={[styles.scoreCoinRing, isBlack ? styles.scoreCoinRingBlack : styles.scoreCoinRingIvory]}>
          <View style={[styles.scoreCoinCore, isBlack ? styles.scoreCoinCoreBlack : styles.scoreCoinCoreIvory]} />
        </View>
      </View>
      <View style={styles.scoreCopy}>
        <Text style={[styles.scoreValue, !isBlack && styles.scoreValueDark]}>{score}</Text>
        <View style={styles.captureDots}>
          {CAPTURE_DOTS.map((dot) => (
            <View
              key={dot}
              style={[
                styles.captureDot,
                !isBlack && styles.captureDotLight,
                dot < score && (isBlack ? styles.captureDotBlackFilled : styles.captureDotIvoryFilled),
              ]}
            />
          ))}
        </View>
      </View>
    </LinearGradient>
  );
}

type CarromSettingsRailProps = {
  aimAssistEnabled: boolean;
  compact: boolean;
  effectsEnabled: boolean;
  onToggleAimAssist: () => void;
  onToggleEffects: () => void;
  onToggleSound: () => void;
  soundEnabled: boolean;
};

export function CarromSettingsRail({
  aimAssistEnabled,
  compact,
  effectsEnabled,
  onToggleAimAssist,
  onToggleEffects,
  onToggleSound,
  soundEnabled,
}: CarromSettingsRailProps) {
  return (
    <View style={[styles.settingsRail, compact && styles.settingsRailCompact]}>
      <SettingToggle
        active={soundEnabled}
        label="الصوت"
        name={{ ios: 'speaker.wave.2.fill', android: 'volume_up', web: 'volume_up' }}
        onPress={onToggleSound}
      />
      <SettingToggle
        active={aimAssistEnabled}
        label="مساعدة التصويب"
        name={{ ios: 'scope', android: 'my_location', web: 'my_location' }}
        onPress={onToggleAimAssist}
      />
      <SettingToggle
        active={effectsEnabled}
        label="المؤثرات"
        name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }}
        onPress={onToggleEffects}
      />
    </View>
  );
}

type SettingToggleProps = {
  active: boolean;
  label: string;
  name: SymbolViewProps['name'];
  onPress: () => void;
};

function SettingToggle({ active, label, name, onPress }: SettingToggleProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.settingTouch, pressed && styles.pressed]}
    >
      <View style={[styles.settingChrome, active && styles.settingChromeActive]}>
        <SymbolView
          name={name}
          size={18}
          style={styles.settingSymbol}
          tintColor={active ? ROYAL.ivory : ROYAL.muted}
        />
      </View>
      <View style={[styles.settingLight, active && styles.settingLightActive]} />
    </Pressable>
  );
}

type CarromControlDockProps = {
  blackRemaining: number;
  compact: boolean;
  queenPocketed: boolean;
  whiteRemaining: number;
};

export function CarromControlDock({
  blackRemaining,
  compact,
  queenPocketed,
  whiteRemaining,
}: CarromControlDockProps) {
  return (
    <View style={[styles.controlDock, compact && styles.controlDockCompact]}>
      <RoyalReferenceSlice sliceHeight={140} sourceY={985} />
      <LinearGradient
        colors={['#130908', '#2A080B', '#100706']}
        end={{ x: 1, y: 0.5 }}
        start={{ x: 0, y: 0.5 }}
        style={styles.controlDockLiveArea}
      >
        <View style={styles.pieceSummary}>
          <PieceCount count={blackRemaining} kind="black" />
          <PieceCount count={queenPocketed ? 0 : 1} kind="queen" />
          <PieceCount count={whiteRemaining} kind="white" />
        </View>
      </LinearGradient>
    </View>
  );
}

function PieceCount({ count, kind }: { count: number; kind: 'black' | 'queen' | 'white' }) {
  const coinStyle = kind === 'black'
    ? styles.miniCoinBlack
    : kind === 'queen'
      ? styles.miniCoinQueen
      : styles.miniCoinWhite;

  return (
    <View style={styles.pieceCount}>
      <View style={[styles.miniCoin, coinStyle]} />
      <Text style={styles.pieceCountText}>{count}</Text>
    </View>
  );
}

type CarromShotHistoryPanelProps = {
  compact: boolean;
  expanded: boolean;
  items: ShotHistoryItem[];
  notice?: string;
  onToggle: () => void;
};

export function CarromShotHistoryPanel({
  compact,
  expanded,
  items,
  notice,
  onToggle,
}: CarromShotHistoryPanelProps) {
  const tokenItems = items.slice(0, 5);

  return (
    <View style={styles.historySection}>
      <Pressable
        accessibilityLabel={expanded ? 'إخفاء سجل الضربات' : 'عرض سجل الضربات'}
        accessibilityRole="button"
        onPress={onToggle}
        style={({ pressed }) => [
          styles.royalHistoryPanel,
          compact && styles.royalHistoryPanelCompact,
          pressed && styles.pressed,
        ]}
      >
        <RoyalReferenceSlice sliceHeight={120} sourceY={1110} />
        {tokenItems.length > 0 ? (
          <View style={styles.historyLiveArea}>
            {tokenItems.map((item, index) => (
            <View key={item.id} style={styles.historyTokenGroup}>
              <HistoryToken tone={item.tone} />
              {index < tokenItems.length - 1 ? <View style={styles.historyTokenSeparator} /> : null}
            </View>
            ))}
          </View>
        ) : null}
      </Pressable>

      {notice ? (
        <View style={styles.royalHistoryDetails}>
          <Text numberOfLines={2} style={styles.historyNotice}>{notice}</Text>
        </View>
      ) : expanded ? (
        <View style={styles.royalHistoryDetails}>
          <Text style={styles.historyTitle}>سجل الضربات</Text>
          {items.length > 0 ? (
            <View style={styles.historyList}>
              {items.slice(0, 3).map((item) => (
                <View key={item.id} style={styles.historyItem}>
                  <View style={[styles.historyDot, styles[getHistoryToneStyle(item.tone)]]} />
                  <Text numberOfLines={2} style={styles.historyText}>{item.message}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.historyEmpty}>ستظهر نتيجة كل ضربة هنا</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

function HistoryToken({ tone }: Pick<ShotHistoryItem, 'tone'>) {
  const toneStyle = tone === 'queen'
    ? styles.historyTokenQueen
    : tone === 'success'
      ? styles.historyTokenWhite
      : tone === 'foul'
        ? styles.historyTokenRuby
        : styles.historyTokenBlack;

  return (
    <View style={[styles.historyToken, toneStyle]}>
      <View style={styles.historyTokenRing}>
        <View style={styles.historyTokenCore} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  captureDot: {
    borderColor: '#675642',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 6,
    width: 6,
  },
  captureDotBlackFilled: { backgroundColor: ROYAL.gold, borderColor: ROYAL.goldBright },
  captureDotIvoryFilled: { backgroundColor: '#6B3C17', borderColor: '#6B3C17' },
  captureDotLight: { borderColor: '#A99470' },
  captureDots: { flexDirection: 'row', gap: 3 },
  controlDock: {
    alignSelf: 'center',
    maxWidth: 720,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  controlDockCompact: {},
  controlDockLiveArea: {
    alignItems: 'center',
    borderColor: 'rgba(232,184,90,0.58)',
    borderRadius: 13,
    borderWidth: 1,
    bottom: '22%',
    justifyContent: 'center',
    left: '20%',
    overflow: 'hidden',
    position: 'absolute',
    right: '20%',
    top: '25%',
  },
  headerTap: { height: 44, position: 'absolute', top: '25%', width: 44 },
  headerTapLeft: { left: '7.5%' },
  headerTapRight: { right: '7.5%' },
  historyDot: { borderRadius: radius.full, height: 7, width: 7 },
  historyDotFoul: { backgroundColor: '#EF7B82' },
  historyDotNeutral: { backgroundColor: ROYAL.muted },
  historyDotQueen: { backgroundColor: ROYAL.goldBright },
  historyDotSuccess: { backgroundColor: ROYAL.gold },
  historyEmpty: { color: ROYAL.muted, fontSize: 9, textAlign: 'right', writingDirection: 'rtl' },
  historyItem: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.xs, minHeight: 18 },
  historyList: { gap: 3, marginTop: 3 },
  historyNotice: { color: '#EE9397', fontSize: 9, marginTop: 3, textAlign: 'right', writingDirection: 'rtl' },
  historySection: { alignItems: 'center', marginTop: -2, width: '100%' },
  royalHistoryPanel: {
    alignSelf: 'center',
    maxWidth: 720,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  royalHistoryPanelCompact: {},
  historyLiveArea: {
    alignItems: 'center',
    backgroundColor: '#2A090B',
    borderRadius: 7,
    bottom: '27%',
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    left: '19%',
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    position: 'absolute',
    right: '25%',
    top: '30%',
  },
  royalHistoryDetails: {
    alignSelf: 'center',
    backgroundColor: 'rgba(38,7,9,0.96)',
    borderColor: 'rgba(217,164,65,0.42)',
    borderRadius: 16,
    borderWidth: 1,
    marginTop: -3,
    maxWidth: 560,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    width: '76%',
  },
  historyToken: { alignItems: 'center', borderRadius: radius.full, borderWidth: 1, height: 22, justifyContent: 'center', width: 22 },
  historyTokenBlack: { backgroundColor: '#090909', borderColor: '#8B6A3D' },
  historyTokenCore: { backgroundColor: 'rgba(255,255,255,0.13)', borderRadius: radius.full, height: 5, width: 5 },
  historyTokenGroup: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  historyTokenQueen: { backgroundColor: ROYAL.ruby, borderColor: ROYAL.goldBright },
  historyTokenRing: { alignItems: 'center', borderColor: 'rgba(246,217,145,0.34)', borderRadius: radius.full, borderWidth: 1, height: 14, justifyContent: 'center', width: 14 },
  historyTokenRuby: { backgroundColor: '#721119', borderColor: ROYAL.gold },
  historyTokenSeparator: { backgroundColor: ROYAL.goldBright, borderRadius: radius.full, height: 5, width: 5 },
  historyTokenWhite: { backgroundColor: '#F1E1BE', borderColor: ROYAL.gold },
  historyText: { color: '#C9B79D', flex: 1, fontSize: 9, lineHeight: 13, textAlign: 'right', writingDirection: 'rtl' },
  historyTitle: { color: ROYAL.ivory, fontSize: 12, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  miniCoin: { borderRadius: radius.full, borderWidth: 1, height: 20, width: 20 },
  miniCoinBlack: { backgroundColor: '#0B0B0C', borderColor: '#6B5842' },
  miniCoinQueen: { backgroundColor: ROYAL.ruby, borderColor: ROYAL.goldBright },
  miniCoinWhite: { backgroundColor: '#F0E0BD', borderColor: ROYAL.gold },
  pieceCount: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  pieceCountText: { color: ROYAL.ivory, fontSize: 15, fontWeight: typography.weights.black },
  pieceSummary: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-evenly', width: '100%' },
  playerBadge: {
    alignItems: 'center',
    borderColor: 'rgba(217,164,65,0.64)',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    height: 50,
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
  },
  playerBadgeActive: {
    borderColor: ROYAL.goldBright,
    borderWidth: 2,
    shadowColor: ROYAL.gold,
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  playerBadgeIvory: { flexDirection: 'row-reverse' },
  playerBadgeCompact: { gap: spacing.xs, height: 46, paddingHorizontal: spacing.xs },
  playerRail: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    marginTop: 1,
    maxWidth: 330,
    paddingHorizontal: spacing.sm,
    width: '82%',
  },
  playerRailCompact: { width: '84%' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
  referenceHeader: {
    alignSelf: 'center',
    aspectRatio: 720 / 145,
    maxWidth: 720,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  referenceSlice: {
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  referenceSliceImage: {
    left: 0,
    position: 'absolute',
    width: '100%',
  },
  referenceHeaderTitle: {
    bottom: '5%',
    color: '#E8C879',
    fontSize: 11,
    fontWeight: typography.weights.black,
    left: '35%',
    position: 'absolute',
    right: '35%',
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  scoreCoin: { alignItems: 'center', borderRadius: radius.full, height: 38, justifyContent: 'center', width: 38 },
  scoreCoinBlack: { backgroundColor: '#080808', borderColor: '#6B5944', borderWidth: 1 },
  scoreCoinCore: { borderRadius: radius.full, height: 10, width: 10 },
  scoreCoinCoreBlack: { backgroundColor: '#101010', borderColor: '#4C4842', borderWidth: 1 },
  scoreCoinCoreIvory: { backgroundColor: '#F6E7C5', borderColor: '#B17A28', borderWidth: 1 },
  scoreCoinIvory: { backgroundColor: '#EAD8B3', borderColor: ROYAL.goldBright, borderWidth: 1 },
  scoreCoinRing: { alignItems: 'center', borderRadius: radius.full, borderWidth: 1, height: 27, justifyContent: 'center', width: 27 },
  scoreCoinRingBlack: { borderColor: '#4D4842' },
  scoreCoinRingIvory: { borderColor: '#B98B3D' },
  scoreCopy: { alignItems: 'center', gap: 2 },
  scoreValue: { color: ROYAL.ivory, fontSize: 25, fontWeight: typography.weights.black, lineHeight: 27 },
  scoreValueDark: { color: '#3B2919' },
  settingChrome: {
    alignItems: 'center',
    backgroundColor: '#100908',
    borderColor: ROYAL.goldDeep,
    borderRadius: 9,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  settingChromeActive: { backgroundColor: '#261209', borderColor: ROYAL.gold },
  settingLight: { backgroundColor: '#4A3522', borderRadius: radius.full, bottom: 2, height: 3, position: 'absolute', width: 3 },
  settingLightActive: { backgroundColor: ROYAL.goldBright, shadowColor: ROYAL.goldBright, shadowOpacity: 0.95, shadowRadius: 5 },
  settingSymbol: { height: 20, width: 20 },
  settingTouch: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  settingsRail: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', marginTop: 1 },
  settingsRailCompact: { marginTop: 0 },
  turnMedallion: {
    alignItems: 'center',
    borderRadius: radius.full,
    height: 50,
    justifyContent: 'center',
    marginHorizontal: -2,
    padding: 4,
    shadowColor: ROYAL.gold,
    shadowOpacity: 0.7,
    shadowRadius: 8,
    width: 50,
    zIndex: 3,
  },
  turnMedallionCompact: { height: 48, width: 48 },
  turnMedallionInner: { alignItems: 'center', backgroundColor: '#E1AD45', borderColor: '#FFF0AD', borderRadius: radius.full, borderWidth: 1, height: '100%', justifyContent: 'center', width: '100%' },
  turnSymbol: { height: 28, width: 28 },
});
