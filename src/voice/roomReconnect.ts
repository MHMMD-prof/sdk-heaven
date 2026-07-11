export type RoomAppState = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export function shouldReconnectVoiceRoom(previousState: RoomAppState, nextState: RoomAppState) {
  return previousState !== 'active' && nextState === 'active';
}
