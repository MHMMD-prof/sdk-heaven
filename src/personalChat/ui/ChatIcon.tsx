import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Text, type ColorValue, type StyleProp, type ViewStyle } from 'react-native';

export type ChatIconName =
  | 'archive'
  | 'attach'
  | 'back'
  | 'chevron'
  | 'close'
  | 'compose'
  | 'crown'
  | 'message'
  | 'more'
  | 'mute'
  | 'retry'
  | 'search'
  | 'send'
  | 'unmute'
  | 'warning';

const definitions = {
  archive: { ios: 'archivebox.fill', android: 'archive', web: 'archive' },
  attach: { ios: 'plus', android: 'add', web: 'add' },
  back: { ios: 'chevron.backward', android: 'arrow_back', web: 'arrow_back' },
  chevron: { ios: 'chevron.forward', android: 'chevron_right', web: 'chevron_right' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  compose: { ios: 'square.and.pencil', android: 'edit_square', web: 'edit_square' },
  crown: { ios: 'crown.fill', android: 'workspace_premium', web: 'workspace_premium' },
  message: { ios: 'bubble.left.and.bubble.right.fill', android: 'forum', web: 'forum' },
  more: { ios: 'ellipsis', android: 'more_vert', web: 'more_vert' },
  mute: { ios: 'speaker.slash.fill', android: 'volume_off', web: 'volume_off' },
  retry: { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' },
  search: { ios: 'magnifyingglass', android: 'search', web: 'search' },
  send: { ios: 'paperplane.fill', android: 'send', web: 'send' },
  unmute: { ios: 'speaker.wave.2.fill', android: 'volume_up', web: 'volume_up' },
  warning: { ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' },
} as const satisfies Record<ChatIconName, SymbolViewProps['name']>;

const fallbacks: Record<ChatIconName, string> = {
  archive: '□',
  attach: '+',
  back: '‹',
  chevron: '›',
  close: '×',
  compose: '✎',
  crown: '♛',
  message: '●',
  more: '⋯',
  mute: '×',
  retry: '↻',
  search: '⌕',
  send: '➤',
  unmute: '◖',
  warning: '!',
};

export function ChatIcon({ color, name, size = 20, style }: {
  color: ColorValue;
  name: ChatIconName;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SymbolView
      fallback={<Text accessibilityElementsHidden style={{ color, fontSize: size }}>{fallbacks[name]}</Text>}
      name={definitions[name]}
      size={size}
      style={style}
      tintColor={color}
    />
  );
}
