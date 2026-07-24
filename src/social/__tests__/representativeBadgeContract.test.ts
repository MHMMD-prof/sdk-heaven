import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('representative badge UI contract', () => {
  it('offers accessible compact and full variants with a private information sheet', () => {
    const source = readSource('src/components/RepresentativeBadge.tsx');

    expect(source).toContain("variant?: 'compact' | 'full'");
    expect(source).toContain('وكيل معتمد');
    expect(source).toContain('accessibilityRole="button"');
    expect(source).toContain('event.stopPropagation()');
    expect(source).toContain('<Modal');
    expect(source).toContain('لا تكشف الشارة رصيد الحساب');
  });

  it('uses the full treatment on profiles and compact treatment on constrained identities', () => {
    for (const path of [
      'src/components/MeProfilePage.tsx',
      'src/components/PublicProfilePage.tsx',
    ]) {
      expect(readSource(path), path).toContain('variant="full"');
    }

    for (const path of [
      'src/screens/FriendsScreen.tsx',
      'src/screens/UsersDiscoveryScreen.tsx',
      'src/screens/CouplesScreen.tsx',
      'src/screens/GiftsScreen.tsx',
      'src/components/voice-room/VoiceRoomStage.tsx',
      'src/components/voice-room/VoiceRoomSheets.tsx',
      'src/components/voice-room/RoomCommandCenterPanels.tsx',
    ]) {
      const source = readSource(path);
      expect(source, path).toContain('RepresentativeBadge');
      expect(source, path).not.toContain('variant="full"');
    }
  });
});
