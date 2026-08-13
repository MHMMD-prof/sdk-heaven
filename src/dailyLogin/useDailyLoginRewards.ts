import { useCallback, useEffect, useRef, useState } from 'react';

import type { DailyLoginClaimResult, DailyLoginStatus } from './dailyLoginContract';
import { createDailyLoginRequestId } from './dailyLoginEndpoint';
import {
  claimDailyLoginReward,
  DailyLoginRequestError,
  requestDailyLoginStatus,
} from './requestDailyLogin';

export type DailyLoginRewardsController = {
  claim: () => Promise<void>;
  claimResult: DailyLoginClaimResult | null;
  close: () => void;
  errorCode: string;
  errorMessage: string;
  isClaiming: boolean;
  isLoading: boolean;
  isVisible: boolean;
  open: () => void;
  refresh: () => Promise<void>;
  status: DailyLoginStatus | null;
};

export function useDailyLoginRewards(uid?: string): DailyLoginRewardsController {
  const [status, setStatus] = useState<DailyLoginStatus | null>(null);
  const [claimResult, setClaimResult] = useState<DailyLoginClaimResult | null>(null);
  const [isVisible, setVisible] = useState(false);
  const [isLoading, setLoading] = useState(Boolean(uid));
  const [isClaiming, setClaiming] = useState(false);
  const [errorCode, setErrorCode] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const requestIdRef = useRef('');
  const requestIdDayRef = useRef('');
  const autoOpenedDayRef = useRef('');
  const activeUidRef = useRef(uid);
  const refreshRunRef = useRef(0);
  const claimRunRef = useRef(0);
  const claimInFlightRef = useRef(false);

  if (activeUidRef.current !== uid) {
    activeUidRef.current = uid;
    refreshRunRef.current += 1;
    claimRunRef.current += 1;
    claimInFlightRef.current = false;
    requestIdRef.current = '';
    requestIdDayRef.current = '';
    autoOpenedDayRef.current = '';
  }

  const refresh = useCallback(async () => {
    const run = ++refreshRunRef.current;
    if (!uid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorCode('');
    setErrorMessage('');
    try {
      const next = await requestDailyLoginStatus();
      if (activeUidRef.current !== uid || refreshRunRef.current !== run) return;
      if (
        next?.alreadyClaimed
        || (requestIdDayRef.current && requestIdDayRef.current !== next?.todayDayId)
      ) {
        requestIdRef.current = '';
        requestIdDayRef.current = '';
      }
      setStatus(next);
      if (
        next?.claimable
        && next.presentationVisible
        && autoOpenedDayRef.current !== next.todayDayId
      ) {
        autoOpenedDayRef.current = next.todayDayId;
        setVisible(true);
      }
    } catch (error) {
      if (activeUidRef.current !== uid || refreshRunRef.current !== run) return;
      setRequestError(error, setErrorCode, setErrorMessage);
    } finally {
      if (activeUidRef.current === uid && refreshRunRef.current === run) setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    setStatus(null);
    setClaimResult(null);
    setVisible(false);
    setErrorCode('');
    setErrorMessage('');
    setLoading(Boolean(uid));
    setClaiming(false);
    requestIdRef.current = '';
    requestIdDayRef.current = '';
    autoOpenedDayRef.current = '';
    if (uid) void refresh();
    return () => {
      refreshRunRef.current += 1;
      claimRunRef.current += 1;
      claimInFlightRef.current = false;
    };
  }, [refresh, uid]);

  useEffect(() => {
    if (!uid || !status?.nextResetAtMillis) return undefined;
    const delay = Math.min(
      Math.max(status.nextResetAtMillis - Date.now() + 1_000, 1_000),
      2_147_000_000,
    );
    const timer = setTimeout(() => void refresh(), delay);
    return () => clearTimeout(timer);
  }, [refresh, status?.nextResetAtMillis, uid]);

  const claim = useCallback(async () => {
    if (!uid || !status?.claimable || claimInFlightRef.current) return;
    const run = ++claimRunRef.current;
    claimInFlightRef.current = true;
    setClaiming(true);
    setErrorCode('');
    setErrorMessage('');
    if (!requestIdRef.current) {
      requestIdRef.current = createDailyLoginRequestId();
      requestIdDayRef.current = status.todayDayId;
    }
    try {
      const result = await claimDailyLoginReward(requestIdRef.current);
      if (activeUidRef.current !== uid || claimRunRef.current !== run) return;
      setClaimResult(result);
      requestIdRef.current = '';
      requestIdDayRef.current = '';
      setStatus((current) => current ? {
        ...current,
        alreadyClaimed: true,
        claimable: false,
        lastReceipt: {
          campaignRevision: result.campaignRevision,
          dayId: result.dayId,
          receiptId: result.receiptId,
          settlementId: result.settlementId,
          streakPosition: result.streakPosition,
        },
        nextResetAtMillis: result.nextResetAtMillis,
        reason: 'ALREADY_CLAIMED',
        streakPosition: result.streakPosition,
      } : current);
    } catch (error) {
      if (activeUidRef.current !== uid || claimRunRef.current !== run) return;
      setRequestError(error, setErrorCode, setErrorMessage);
      const code = error instanceof DailyLoginRequestError ? error.code : '';
      if (TERMINAL_CLAIM_CODES.has(code)) {
        setStatus((current) => current ? { ...current, claimable: false, reason: code } : current);
      }
    } finally {
      if (activeUidRef.current === uid && claimRunRef.current === run) {
        claimInFlightRef.current = false;
        setClaiming(false);
      }
    }
  }, [status?.claimable, status?.todayDayId, uid]);

  return {
    claim,
    claimResult,
    close: () => setVisible(false),
    errorCode,
    errorMessage,
    isClaiming,
    isLoading,
    isVisible,
    open: () => setVisible(true),
    refresh,
    status,
  };
}

const TERMINAL_CLAIM_CODES = new Set([
  'CLAIMS_PAUSED',
  'CLAIM_CONFLICT',
  'CLAIM_STATE_CONFLICT',
  'CLIENT_INCOMPATIBLE',
  'EMERGENCY_DISABLED',
  'FEATURE_DISABLED',
  'ITEM_REWARDS_DISABLED',
]);

function setRequestError(
  error: unknown,
  setCode: (value: string) => void,
  setMessage: (value: string) => void,
) {
  setCode(error instanceof DailyLoginRequestError ? error.code : 'NETWORK_ERROR');
  setMessage(
    error instanceof DailyLoginRequestError
      ? error.message
      : 'تعذر الاتصال بخدمة المكافآت.',
  );
}
