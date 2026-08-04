import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { mapRoomMessageDocument } from '../roomV2Contract';

describe('room chat avatar-frame history budget', () => {
  it('maps fifty immutable frame snapshots without a public-profile listener path', () => {
    const messages = Array.from({ length: 50 }, (_, index) => mapRoomMessageDocument({
      id: `chat-${index}`,
      kind: 'chat',
      revision: 1,
      roomId: 'room-1',
      schemaVersion: 2,
      senderAvatarFrame: {
        assetUrl: 'https://cdn.example/frame.png',
        canonicalAsset: { assetId: 'gold-frame', assetVersionId: 'v1-123456789abc' },
        itemId: 'gold-frame-item',
      },
      senderDisplayName: `User ${index}`,
      senderUid: `user-${index}`,
      status: 'active',
      text: 'hello',
    }));
    expect(messages).toHaveLength(50);
    expect(messages.every((message) => message?.senderAvatarFrame?.itemId === 'gold-frame-item')).toBe(true);

    const roomChatSource = readFileSync(new URL('../roomChat.ts', import.meta.url), 'utf8');
    expect(roomChatSource).not.toContain("'publicProfiles'");
    expect(roomChatSource).not.toContain('useAvatarFrameProjection');
  });
});
