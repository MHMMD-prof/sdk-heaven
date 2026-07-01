import { DrawingGuessInboundMessage, DrawingGuessOutboundMessage } from './types';
import { validateTopicCompatibleDrawingGuessMessage } from './messageValidation';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const encodeDrawingGuessLiveKitPayload = (message: DrawingGuessOutboundMessage) =>
  textEncoder.encode(JSON.stringify(message));

export const decodeDrawingGuessLiveKitPayload = (
  payload: Uint8Array,
  receivedAt: number,
): DrawingGuessInboundMessage | undefined => {
  try {
    const parsed = JSON.parse(textDecoder.decode(payload)) as unknown;
    const message = validateTopicCompatibleDrawingGuessMessage(parsed);

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
