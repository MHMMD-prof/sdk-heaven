import { SymbolView } from 'expo-symbols';
import { type ReactNode, useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import { colors, typography } from '../theme';
import { shouldHidePrivateContent } from './privacyState';

export function AppSwitcherPrivacyShield({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(shouldHidePrivateContent(AppState.currentState));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setHidden(shouldHidePrivateContent(state)));
    return () => subscription.remove();
  }, []);
  return (
    <View style={styles.root}>
      {children}
      {hidden ? (
        <View accessibilityElementsHidden={false} importantForAccessibility="yes" style={styles.shield}>
          <SymbolView name={{ ios: 'lock.shield.fill', android: 'lock', web: 'lock' }} size={38} tintColor={colors.gold} />
          <Text style={styles.text}>المحتوى مخفي لحماية خصوصيتك</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  shield: { alignItems: 'center', backgroundColor: '#020202', bottom: 0, gap: 12, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0, zIndex: 10_000 },
  text: { color: colors.goldSoft, fontSize: 16, fontWeight: typography.weights.bold, textAlign: 'center' },
});
