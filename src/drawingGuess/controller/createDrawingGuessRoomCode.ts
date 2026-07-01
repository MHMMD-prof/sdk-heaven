const roomCodeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const createDrawingGuessRoomCode = () => {
  const suffix = Array.from({ length: 4 }, () => {
    const index = Math.floor(Math.random() * roomCodeAlphabet.length);

    return roomCodeAlphabet[index];
  }).join('');

  return `DG-${suffix}`;
};
