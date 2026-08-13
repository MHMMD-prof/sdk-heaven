import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('voice room Android release gate', () => {
  it('keeps floating-window permission out of generated production configuration', () => {
    const appConfig = JSON.parse(rootFile('app.json')) as {
      expo?: { android?: { permissions?: string[] } };
    };

    expect(appConfig.expo?.android?.permissions || []).not.toContain('android.permission.SYSTEM_ALERT_WINDOW');
  });

  it('does not render a floating settings or developer control over the room stage', () => {
    const screen = rootFile('src/screens/VoiceRoomScreen.tsx');
    expect(screen).not.toContain('floatingGear');
    expect(screen).not.toContain('developerOverlay');
    expect(screen).not.toContain('SYSTEM_ALERT_WINDOW');
  });
});
