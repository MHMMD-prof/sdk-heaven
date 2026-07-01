import { DrawingGuessPrompt } from './types';

const arabicDiacriticsPattern = /[\u064B-\u065F\u0670]/g;
const repeatedWhitespacePattern = /\s+/g;

export const normalizeGuess = (value: string) =>
  value
    .trim()
    .replace(repeatedWhitespacePattern, ' ')
    .replace(arabicDiacriticsPattern, '')
    .toLocaleLowerCase('en-US');

export const getPromptAnswers = (prompt: DrawingGuessPrompt) => [
  normalizeGuess(prompt.text),
  ...prompt.aliases.map(normalizeGuess),
];

export const isCorrectGuessForPrompt = (guess: string, prompt: DrawingGuessPrompt) => {
  const normalizedGuess = normalizeGuess(guess);

  return getPromptAnswers(prompt).includes(normalizedGuess);
};
