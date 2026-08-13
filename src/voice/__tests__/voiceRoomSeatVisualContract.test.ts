import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/voice-room/VoiceRoomStage.tsx'),
  'utf8',
);

describe('voice room seat visual contract', () => {
  it('preserves stable identity and numeric accessibility traversal', () => {
    expect(source).toContain('orderRoomSeatsForAccessibility(seats)');
    expect(source).toContain('orderedSeats.map((seat)');
    expect(source).toContain('key={seat.id}');
  });

  it('does not let the room theme style an occupied avatar border', () => {
    expect(source).toContain("borderColor: ownedFrame ? 'transparent' : OCCUPIED_BORDER_COLOR");
    expect(source).toContain('<AvatarFrameLayer');
    expect(source).not.toContain('borderColor: seat.isSpeaking ? goldSoft');
    expect(source).not.toContain('gold={manifest.colors.gold}');
  });

  it('uses themed artwork only for empty seats and removes duplicate seat copy', () => {
    expect(source).toContain('emptySeatFrameUri={manifest.assets.emptySeatFrame?.uri}');
    expect(source).toContain('<Text style={styles.emptySeatNumber}>{seat.seatNumber}</Text>');
    expect(source).not.toContain('`مقعد ${seat.seatNumber}`');
    expect(source).not.toContain('styles.seatNumber');
  });

  it('moves seats for 250ms and honors reduced motion', () => {
    expect(source).toContain('duration: 250');
    expect(source).toContain('if (reduceMotion)');
  });
});
