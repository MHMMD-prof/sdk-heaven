type BattleshipSoundPlayer = {
  play: () => Promise<unknown> | unknown;
  seekTo: (seconds: number) => Promise<unknown> | unknown;
};

export const safePlayBattleshipSound = async (
  player: BattleshipSoundPlayer,
  muted: boolean,
) => {
  if (muted) {
    return;
  }

  try {
    await player.seekTo(0);
  } catch {
    // Sound feedback is optional; failed seek should not block gameplay.
  }

  try {
    await player.play();
  } catch {
    try {
      await player.play();
    } catch {
      // Some simulators/devices cannot play every bundled sound; ignore it.
    }
  }
};

export const safeRunBattleshipHaptic = async (
  callback: () => Promise<unknown> | unknown,
) => {
  try {
    await callback();
  } catch {
    // Haptics are optional and can fail on devices, simulators, or settings.
  }
};
