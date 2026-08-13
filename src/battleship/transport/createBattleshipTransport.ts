import { LiveKitBattleshipTransport } from './LiveKitBattleshipTransport';
import { MockBattleshipTransport } from './MockBattleshipTransport';
import { BattleshipTransport } from './types';

export type BattleshipTransportMode = 'online' | 'mock';

export const createBattleshipTransport = (
  mode: BattleshipTransportMode = 'online',
): BattleshipTransport =>
  mode === 'online' ? new LiveKitBattleshipTransport() : new MockBattleshipTransport();
