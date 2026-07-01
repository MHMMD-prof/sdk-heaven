import { useCallback, useEffect, useRef, useState } from 'react';

import { CarromDisc, CarromGameState } from '../types/carrom';
import { MatchSession, MatchStatus, MatchTable, ShotInput } from '../types/carromMatch';
import { localCarromMatchController } from '../utils/localCarromMatchController';

export type MatchPhase = 'tableSelect' | MatchStatus;

type PendingShot = {
  beforeState: CarromGameState;
  input: ShotInput;
};

type SubmitShotOptions = {
  beforeState: CarromGameState;
  striker: Pick<CarromDisc, 'x' | 'y'>;
  velocity: {
    vx: number;
    vy: number;
  };
};

export type SubmitShotResult =
  | { accepted: true }
  | { accepted: false; reason: string };

type UseLocalCarromMatchOptions = {
  countdownSeconds: number;
};

export function useLocalCarromMatch({ countdownSeconds }: UseLocalCarromMatchOptions) {
  const [matchSession, setMatchSession] = useState<MatchSession | undefined>();
  const [countdown, setCountdown] = useState(countdownSeconds);
  const [matchError, setMatchError] = useState<string | undefined>();
  const matchSessionRef = useRef<MatchSession | undefined>(undefined);
  const pendingShotRef = useRef<PendingShot | undefined>(undefined);
  const selectedTable = matchSession?.table;
  const matchPhase: MatchPhase = matchSession?.status ?? 'tableSelect';
  const playerReady =
    matchSession?.players.find((player) => player.id === 'local-player-1')?.ready ?? false;
  const opponentReady =
    matchSession?.players.find((player) => player.id === 'local-player-2')?.ready ?? false;

  useEffect(() => {
    matchSessionRef.current = matchSession;
  }, [matchSession]);

  useEffect(() => {
    if (matchPhase !== 'countdown') {
      return undefined;
    }

    setCountdown(countdownSeconds);
    let remaining = countdownSeconds;
    const intervalId = setInterval(() => {
      remaining -= 1;

      if (remaining <= 0) {
        clearInterval(intervalId);
        setCountdown(0);

        const session = matchSessionRef.current;

        if (!session) {
          return;
        }

        try {
          const nextSession = localCarromMatchController.startMatch(session);

          matchSessionRef.current = nextSession;
          setMatchSession(nextSession);
          setMatchError(undefined);
        } catch (error) {
          setMatchError(getCommandErrorMessage(error));
        }
        return;
      }

      setCountdown(remaining);
    }, 1000);

    return () => clearInterval(intervalId);
  }, [countdownSeconds, matchPhase]);

  const clearPendingShot = useCallback(() => {
    pendingShotRef.current = undefined;
  }, []);

  const selectTable = useCallback((table: MatchTable, resetGame: () => void) => {
    resetGame();

    try {
      const nextSession = localCarromMatchController.createMatch(table.id, countdownSeconds);

      matchSessionRef.current = nextSession;
      setMatchSession(nextSession);
      setCountdown(countdownSeconds);
      setMatchError(undefined);
    } catch (error) {
      setMatchError(getCommandErrorMessage(error));
    }
  }, [countdownSeconds]);

  const confirmReady = useCallback(() => {
    const session = matchSessionRef.current;

    if (!session) {
      return;
    }

    try {
      const withLocalReady = localCarromMatchController.setReady(
        session,
        'local-player-1',
        true,
      );
      const withOpponentReady = localCarromMatchController.setReady(
        withLocalReady,
        'local-player-2',
        true,
      );
      const nextSession = localCarromMatchController.startCountdown(withOpponentReady);

      matchSessionRef.current = nextSession;
      setMatchSession(nextSession);
      setCountdown(countdownSeconds);
      setMatchError(undefined);
    } catch (error) {
      setMatchError(getCommandErrorMessage(error));
    }
  }, [countdownSeconds]);

  const prepareRound = useCallback((resetGame: () => void) => {
    const session = matchSessionRef.current;

    if (!session) {
      resetGame();
      setCountdown(countdownSeconds);
      setMatchError(undefined);
      return;
    }

    try {
      const nextSession = localCarromMatchController.resetRound(session);

      resetGame();
      setCountdown(countdownSeconds);
      matchSessionRef.current = nextSession;
      setMatchSession(nextSession);
      setMatchError(undefined);
    } catch (error) {
      setMatchError(getCommandErrorMessage(error));
    }
  }, [countdownSeconds]);

  const leaveTable = useCallback((resetGame: () => void) => {
    const session = matchSessionRef.current;

    try {
      if (session) {
        localCarromMatchController.cancelMatch(session);
      }

      matchSessionRef.current = undefined;
      setMatchSession(undefined);
      resetGame();
      setCountdown(countdownSeconds);
      setMatchError(undefined);
    } catch (error) {
      setMatchError(getCommandErrorMessage(error));
    }
  }, [countdownSeconds]);

  const handleResetPress = useCallback((resetGame: () => void) => {
    if (matchPhase === 'tableSelect') {
      resetGame();
      setMatchError(undefined);
      return;
    }

    if (matchPhase === 'settled' || matchPhase === 'cancelled') {
      prepareRound(resetGame);
      return;
    }

    leaveTable(resetGame);
  }, [leaveTable, matchPhase, prepareRound]);

  const failClosed = useCallback((error: unknown) => {
    pendingShotRef.current = undefined;
    setMatchError(getCommandErrorMessage(error));

    const session = matchSessionRef.current;

    if (!session || session.status === 'cancelled' || session.status === 'settled') {
      return;
    }

    try {
      const cancelled = localCarromMatchController.cancelMatch(session);

      matchSessionRef.current = cancelled;
      setMatchSession(cancelled);
    } catch {
      matchSessionRef.current = undefined;
      setMatchSession(undefined);
    }
  }, []);

  const submitShot = useCallback(({ beforeState, striker, velocity }: SubmitShotOptions): SubmitShotResult => {
    const session = matchSessionRef.current;

    if (!session) {
      const reason = getCommandErrorMessage(undefined);

      setMatchError(reason);
      return { accepted: false, reason };
    }

    try {
      const input = localCarromMatchController.createShotInput({
        match: session,
        player: beforeState.currentPlayer,
        striker,
        velocity,
      });
      const nextSession = localCarromMatchController.recordShotSubmitted(session, input);

      pendingShotRef.current = { beforeState, input };
      matchSessionRef.current = nextSession;
      setMatchSession(nextSession);
      setMatchError(undefined);
      return { accepted: true };
    } catch (error) {
      const reason = getCommandErrorMessage(error);

      setMatchError(reason);
      return { accepted: false, reason };
    }
  }, []);

  const resolvePendingShot = useCallback((afterState: CarromGameState) => {
    const pendingShot = pendingShotRef.current;
    const session = matchSessionRef.current;

    if (!pendingShot || !session) {
      return;
    }

    try {
      const result = localCarromMatchController.createShotResult({
        input: pendingShot.input,
        beforeState: pendingShot.beforeState,
        afterState,
      });
      let nextSession = localCarromMatchController.recordShotResolved(session, result);

      if (afterState.status === 'gameOver' && afterState.winner) {
        nextSession = localCarromMatchController.settleMatch(nextSession, afterState.winner);
      }

      pendingShotRef.current = undefined;
      matchSessionRef.current = nextSession;
      setMatchSession(nextSession);
      setMatchError(undefined);
    } catch (error) {
      failClosed(error);
    }
  }, [failClosed]);

  return {
    clearPendingShot,
    confirmReady,
    countdown,
    handleResetPress,
    leaveTable,
    matchError,
    matchPhase,
    matchSession,
    matchSessionRef,
    opponentReady,
    playerReady,
    prepareRound,
    resolvePendingShot,
    selectedTable,
    selectTable,
    submitShot,
  };
}

function getCommandErrorMessage(_error: unknown) {
  return 'تعذر تنفيذ أمر المباراة. حاول مرة أخرى.';
}
