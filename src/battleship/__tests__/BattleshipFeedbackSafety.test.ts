import { describe, expect, it, vi } from 'vitest';

import {
  safePlayBattleshipSound,
  safeRunBattleshipHaptic,
} from '../BattleshipFeedbackSafety';

describe('Battleship feedback safety', () => {
  it('does nothing while sound is muted', async () => {
    const player = {
      play: vi.fn(),
      seekTo: vi.fn(),
    };

    await safePlayBattleshipSound(player, true);

    expect(player.seekTo).not.toHaveBeenCalled();
    expect(player.play).not.toHaveBeenCalled();
  });

  it('swallows failed seek and still attempts playback', async () => {
    const player = {
      play: vi.fn().mockResolvedValue(undefined),
      seekTo: vi.fn().mockRejectedValue(new Error('seek failed')),
    };

    await safePlayBattleshipSound(player, false);

    expect(player.seekTo).toHaveBeenCalledWith(0);
    expect(player.play).toHaveBeenCalledOnce();
  });

  it('swallows failed initial and retry playback', async () => {
    const player = {
      play: vi.fn().mockRejectedValue(new Error('play failed')),
      seekTo: vi.fn().mockResolvedValue(undefined),
    };

    await expect(safePlayBattleshipSound(player, false)).resolves.toBeUndefined();

    expect(player.play).toHaveBeenCalledTimes(2);
  });

  it('swallows failed haptic callbacks', async () => {
    const haptic = vi.fn().mockRejectedValue(new Error('haptic failed'));

    await expect(safeRunBattleshipHaptic(haptic)).resolves.toBeUndefined();

    expect(haptic).toHaveBeenCalledOnce();
  });
});
