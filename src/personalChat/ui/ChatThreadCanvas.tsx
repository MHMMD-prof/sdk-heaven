import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { chatMetrics } from './chatTheme';

/** Width-bounded thread surface. The screen backdrop remains visible around it on wide layouts. */
export function ChatThreadCanvas({ children }: { children: ReactNode }) {
  return <View style={styles.root}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { alignSelf: 'center', flex: 1, maxWidth: chatMetrics.contentMaxWidth, width: '100%' },
});
