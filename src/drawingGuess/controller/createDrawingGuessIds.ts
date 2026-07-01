let messageCounter = 0;
let guessCounter = 0;
let strokeCounter = 0;
let matchCounter = 0;

export const createDrawingGuessPlayerId = (seed = 'local') => `dg-player-${seed}`;

export const createDrawingGuessMatchId = () => {
  matchCounter += 1;
  return `dg-match-${Date.now()}-${matchCounter}`;
};

export const createDrawingGuessMessageId = () => {
  messageCounter += 1;
  return `dg-message-${Date.now()}-${messageCounter}`;
};

export const createDrawingGuessGuessId = () => {
  guessCounter += 1;
  return `dg-guess-${Date.now()}-${guessCounter}`;
};

export const createDrawingGuessStrokeId = () => {
  strokeCounter += 1;
  return `dg-stroke-${Date.now()}-${strokeCounter}`;
};
