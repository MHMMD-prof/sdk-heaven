export type FutureGameBridgeMessage = {
  type: 'GAME_READY' | 'GAME_EVENT' | 'VOICE_ROOM_HINT';
  payload?: Record<string, unknown>;
};

export const createFutureWebViewBridgeNote = () => {
  // Future wave:
  // Add react-native-webview screens here, then validate and route messages
  // between third-party game SDK content, native session state, and voice-room hooks.
  // This wave intentionally keeps game integration frontend-only and inert.
  return 'future-webview-bridge-placeholder';
};
