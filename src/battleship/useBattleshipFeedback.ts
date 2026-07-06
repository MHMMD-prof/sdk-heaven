import { useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';

import { SoundKey, soundSources } from './constants';
import { safePlayBattleshipSound, safeRunBattleshipHaptic } from './BattleshipFeedbackSafety';

export function useBattleshipFeedback() {
  const [soundMuted, setSoundMuted] = useState(false);
  const tapPlayer = useAudioPlayer(soundSources.tap);
  const invalidPlayer = useAudioPlayer(soundSources.invalid);
  const missPlayer = useAudioPlayer(soundSources.miss);
  const hitPlayer = useAudioPlayer(soundSources.hit);
  const sunkPlayer = useAudioPlayer(soundSources.sunk);
  const victoryPlayer = useAudioPlayer(soundSources.victory);

  const soundPlayers = {
    hit: hitPlayer,
    invalid: invalidPlayer,
    miss: missPlayer,
    sunk: sunkPlayer,
    tap: tapPlayer,
    victory: victoryPlayer,
  };

  const playSound = (soundKey: SoundKey) => {
    void safePlayBattleshipSound(soundPlayers[soundKey], soundMuted);
  };

  const impact = (style: Haptics.ImpactFeedbackStyle) => {
    void safeRunBattleshipHaptic(() => Haptics.impactAsync(style));
  };

  const notify = (type: Haptics.NotificationFeedbackType) => {
    void safeRunBattleshipHaptic(() => Haptics.notificationAsync(type));
  };

  const toggleSound = () => {
    const nextMuted = !soundMuted;
    setSoundMuted(nextMuted);
    impact(Haptics.ImpactFeedbackStyle.Light);

    if (!nextMuted) {
      playSound('tap');
    }
  };

  return {
    impactHeavy: () => impact(Haptics.ImpactFeedbackStyle.Heavy),
    impactLight: () => impact(Haptics.ImpactFeedbackStyle.Light),
    impactMedium: () => impact(Haptics.ImpactFeedbackStyle.Medium),
    notifyError: () => notify(Haptics.NotificationFeedbackType.Error),
    notifySuccess: () => notify(Haptics.NotificationFeedbackType.Success),
    notifyWarning: () => notify(Haptics.NotificationFeedbackType.Warning),
    playSound,
    soundMuted,
    toggleSound,
  };
}
