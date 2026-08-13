import { validateTopicCompatibleBattleshipMessage } from './messageValidation';
import { BattleshipInboundMessage, BattleshipOutboundMessage } from './types';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const encodeBattleshipLiveKitPayload = (message: BattleshipOutboundMessage) =>
  textEncoder.encode(JSON.stringify(message));

export const decodeBattleshipLiveKitPayload = (
  payload: Uint8Array,
  receivedAt: number,
): BattleshipInboundMessage | undefined => {
  try {
    const parsed = JSON.parse(textDecoder.decode(payload)) as unknown;
    const message = validateTopicCompatibleBattleshipMessage(parsed);

    return message
      ? {
          ...message,
          receivedAt,
        }
      : undefined;
  } catch {
    return undefined;
  }
};
