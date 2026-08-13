import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('royal room settings contract', () => {
  it('uses the dedicated full-screen royal settings surface', () => {
    const screen = readSource('src/screens/VoiceRoomScreen.tsx');
    const settings = readSource('src/components/voice-room/RoyalRoomSettingsScreen.tsx');

    expect(screen).toContain("from '../components/voice-room/RoyalRoomSettingsScreen'");
    expect(screen).toContain("onOpenMicrophones={() => setCommandPanel('microphones')}");
    expect(screen).toContain('onSaveSection={async (settings) =>');
    expect(settings).toContain('presentationStyle="fullScreen"');
    expect(settings).toContain("colors={['#070304', '#180607', '#030202']}");
    expect(settings).toContain("'room', label: 'الغرفة'");
    expect(settings).toContain("'appearance', label: 'المظهر'");
    expect(settings).toContain("'chat', label: 'الدردشة والأمان'");
  });

  it('keeps section saves separate and protects unsaved work', () => {
    const settings = readSource('src/components/voice-room/RoyalRoomSettingsScreen.tsx');

    expect(settings).toContain("activeSection === 'room' ? roomDraft");
    expect(settings).toContain("activeSection === 'chat' ? chatDraft");
    expect(settings).toContain("'تجاهل التغييرات؟'");
    expect(settings).toContain('lastSyncedSettings.current === initialSettings');
    expect(settings).not.toContain('<RoomSheet');
  });

  it('renders full-width theme previews with purchase confirmation', () => {
    const picker = readSource('src/components/voice-room/RoomThemePicker.tsx');

    expect(picker).toContain('inventory.inventory.map((entry) =>');
    expect(picker).toContain('تأكيد شراء السمة');
    expect(picker).toContain("void apply(entry, 'coins')");
    expect(picker).toContain("void apply(entry, 'diamonds')");
    expect(picker).not.toContain('<ScrollView horizontal');
  });
});
