import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';
import { MainTabKey } from '../types/navigation';

const tabs: Array<{
  key: MainTabKey;
  label: string;
  icon: string;
}> = [
  { key: 'groups', label: 'المجموعات', icon: '◎' },
  { key: 'home', label: 'الرئيسية', icon: '◆' },
  { key: 'games', label: 'الألعاب', icon: '♕' },
];

type BottomNavigationBarProps = {
  activeTab: MainTabKey;
  onTabPress: (tab: MainTabKey) => void;
};

export function BottomNavigationBar({ activeTab, onTabPress }: BottomNavigationBarProps) {
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <LinearGradient
        colors={['rgba(17,12,28,0.96)', 'rgba(8,5,15,0.98)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.bar}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;

          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              key={tab.key}
              onPress={() => onTabPress(tab.key)}
              style={({ pressed }) => [
                styles.item,
                isActive && styles.activeItem,
                pressed && styles.pressedItem,
              ]}
            >
              <View style={[styles.iconShell, isActive && styles.activeIconShell]}>
                <Text style={[styles.icon, isActive && styles.activeIcon]}>{tab.icon}</Text>
              </View>
              <Text style={[styles.label, isActive && styles.activeLabel]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.sm,
  },
  bar: {
    alignItems: 'center',
    borderColor: 'rgba(232,190,97,0.25)',
    borderRadius: radius.xl,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 16,
  },
  item: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 58,
  },
  activeItem: {
    backgroundColor: 'rgba(232,190,97,0.08)',
    borderRadius: radius.lg,
  },
  pressedItem: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
  iconShell: {
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  activeIconShell: {
    backgroundColor: colors.gold,
    borderColor: colors.goldSoft,
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
  },
  icon: {
    color: colors.textSubtle,
    fontSize: 16,
    fontWeight: typography.weights.black,
  },
  activeIcon: {
    color: colors.backgroundDeep,
  },
  label: {
    color: colors.textSubtle,
    fontSize: 11,
    fontWeight: typography.weights.semibold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  activeLabel: {
    color: colors.goldSoft,
  },
});
