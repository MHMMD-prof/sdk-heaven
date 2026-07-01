import { DRAWING_GUESS_RULES } from './constants';

type CorrectGuessScoreInput = {
  guessedAt: number;
  roundStartedAt: number;
  roundEndsAt: number;
};

export const calculateCorrectGuessScore = ({
  guessedAt,
  roundEndsAt,
  roundStartedAt,
}: CorrectGuessScoreInput) => {
  const duration = Math.max(1, roundEndsAt - roundStartedAt);
  const remaining = Math.max(0, roundEndsAt - guessedAt);
  const speedRatio = Math.min(1, remaining / duration);

  return (
    DRAWING_GUESS_RULES.guessBasePoints +
    Math.round(DRAWING_GUESS_RULES.guessSpeedBonusPoints * speedRatio)
  );
};

export const getDrawerCorrectRoundBonus = (hasCorrectGuesser: boolean) =>
  hasCorrectGuesser ? DRAWING_GUESS_RULES.drawerCorrectRoundBonus : 0;
