import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('room theme scene renderer contract', () => {
  it('renders stage artwork and seats inside the same measured canvas', () => {
    const stage = readSource('src/components/voice-room/VoiceRoomStage.tsx');

    expect(stage).toContain('resolveRoomThemeScene(manifest, viewportProfile)');
    expect(stage).toContain('manifest.assets.stage');
    expect(stage).toContain('style={styles.stageArtwork}');
    expect(stage).toContain('cachePolicy="memory-disk"');
    expect(stage).toContain('recyclingKey={`${manifest.themeId}:${manifest.revision}:stage`}');
    expect(stage).toContain('onLayout={handleLayout}');
    expect(stage).toContain('position.x * width');
    expect(stage).toContain('position.y * height');
  });

  it('uses the same responsive profile and focal point for the room backdrop', () => {
    const screen = readSource('src/screens/VoiceRoomScreen.tsx');

    expect(screen).toContain('classifyRoomSceneViewport(windowSize.width, windowSize.height)');
    expect(screen).toContain('resolveRoomThemeScene(resolvedTheme.manifest, viewportProfile)');
    expect(screen).toContain('contentFit={themeScene.background.fit}');
    expect(screen).toContain('viewportProfile={viewportProfile}');
  });

  it('uses the stale-manifest policy while retaining immediate bundled fallback', () => {
    const runtime = readSource('src/voice/roomThemeRuntime.ts');

    expect(runtime).not.toContain('requestedThemeId === DEFAULT_ROOM_THEME_ID || !enabled');
    expect(runtime).toContain('resolveRuntimeRoomThemeManifest(');
    expect(runtime).toContain("source: usesRemote && remoteManifest");
  });

  it('keeps V2 motion available when a theme upgrades to V3', () => {
    const animated = readSource('src/components/voice-room/AnimatedRoomTheme.tsx');

    expect(animated).toContain('manifest.manifestVersion === 1');
    expect(animated).not.toContain('manifest.manifestVersion !== 2');
  });
});
