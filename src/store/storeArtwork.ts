import type { ImageSourcePropType } from 'react-native';

const mockArtwork: Record<string, ImageSourcePropType> = {
  'mock-store://baghdad-theme': require('../../assets/home/room-voice-salon-v3.jpg') as ImageSourcePropType,
  'mock-store://celebration-dice': require('../../assets/home/feature-game.jpg') as ImageSourcePropType,
  'mock-store://custom-id': require('../../assets/home/feature-popular.jpg') as ImageSourcePropType,
  'mock-store://emerald-frame': require('../../assets/home/feature-voice.jpg') as ImageSourcePropType,
  'mock-store://night-frame': require('../../assets/home/room-voice-anonymous-v3.jpg') as ImageSourcePropType,
  'mock-store://royal-carrom': require('../../assets/carrom/board-royal-majlis-v3.png') as ImageSourcePropType,
  'mock-store://royal-frame': require('../../assets/home/room-voice-royal-v3.jpg') as ImageSourcePropType,
  'mock-store://shadow-car': require('../../assets/home/room-game-party-v3.jpg') as ImageSourcePropType,
};

export function resolveStoreArtwork(url: string): ImageSourcePropType {
  return mockArtwork[url] || { uri: url };
}
