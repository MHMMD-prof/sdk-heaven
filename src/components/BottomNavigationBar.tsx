import { LinearGradient } from 'expo-linear-gradient';
import { Image, ImageSourcePropType, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';
import { MainTabKey } from '../types/navigation';

const tabs: Array<{
  key: MainTabKey;
  label: string;
  icon: ImageSourcePropType;
}> = [
  { key: 'home', label: 'الرئيسية', icon: require('../../assets/home/icons/home.png') },
  { key: 'groups', label: 'الصوتية', icon: require('../../assets/home/icons/voice.png') },
  { key: 'games', label: 'الألعاب', icon: require('../../assets/home/icons/games.png') },
  { key: 'me', label: 'أنا', icon: require('../../assets/home/icons/profile.png') },
];

type BottomNavigationBarProps = {
  activeTab: MainTabKey;
  onTabPress: (tab: MainTabKey) => void;
};

export function BottomNavigationBar({ activeTab, onTabPress }: BottomNavigationBarProps) {
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <LinearGradient
        colors={['#180709', '#060202']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.bar}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;

          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
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
                <Image source={tab.icon} style={[styles.icon, !isActive && styles.inactiveIcon]} />
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
    alignSelf: 'center',
    maxWidth: 720,
    width: '100%',
  },
  bar: {
    alignItems: 'center',
    borderColor: 'rgba(216,168,78,0.3)',
    borderTopWidth: 1,
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    minHeight: 72,
    paddingHorizontal: 4,
    paddingVertical: 5,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 16,
  },
  item: {
    alignItems: 'center',
    flex: 1,
    gap: 2,
    justifyContent: 'center',
    minHeight: 60,
  },
  activeItem: {
    backgroundColor: 'transparent',
  },
  pressedItem: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
  iconShell: {
    alignItems: 'center',
    borderColor: 'rgba(216,168,78,0.16)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  activeIconShell: {
    backgroundColor: '#72121A',
    borderColor: '#E4BE65',
    borderWidth: 2,
    shadowColor: '#A91827',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
  },
  icon: {
    height: 32,
    resizeMode: 'contain',
    width: 32,
  },
  inactiveIcon: {
    opacity: 0.44,
    transform: [{ scale: 0.88 }],
  },
  label: {
    color: colors.textSubtle,
    fontSize: 11,
    fontWeight: typography.weights.semibold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  activeLabel: {
    color: '#F6D77E',
    fontWeight: typography.weights.black,
  },
});
