import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useCallback, useEffect } from 'react';

const hitSound = require('../../assets/carrom/sounds/hit.wav');
const pocketSound = require('../../assets/carrom/sounds/pocket.wav');
const foulSound = require('../../assets/carrom/sounds/foul.wav');
const winSound = require('../../assets/carrom/sounds/win.wav');

type SoundPlayer = {
  play: () => void;
  seekTo: (seconds: number) => Promise<void>;
};

export function useCarromAudio(enabled: boolean) {
  const hitPlayer = useAudioPlayer(hitSound);
  const pocketPlayer = useAudioPlayer(pocketSound);
  const foulPlayer = useAudioPlayer(foulSound);
  const winPlayer = useAudioPlayer(winSound);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
  }, []);

  const play = useCallback(
    (player: SoundPlayer) => {
      if (!enabled) {
        return;
      }

      try {
        void player
          .seekTo(0)
          .then(() => {
            player.play();
          })
          .catch(() => {
            try {
              player.play();
            } catch {
              // Sound polish should never interrupt the game loop.
            }
          });
      } catch {
        // Sound polish should never interrupt the game loop.
      }
    },
    [enabled],
  );

  return {
    playFoul: useCallback(() => play(foulPlayer), [foulPlayer, play]),
    playHit: useCallback(() => play(hitPlayer), [hitPlayer, play]),
    playPocket: useCallback(() => play(pocketPlayer), [play, pocketPlayer]),
    playWin: useCallback(() => play(winPlayer), [play, winPlayer]),
  };
}
