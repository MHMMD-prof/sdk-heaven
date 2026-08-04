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
  const hasAutoOpenedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    setErrorCode('');
    setErrorMessage('');
    try {
      const next = await requestDailyLoginStatus();
      setStatus(next);
      if (next?.claimable && next.presentationVisible && !hasAutoOpenedRef.current) {
        hasAutoOpenedRef.current = true;
        setVisible(true);
      }
    } catch (error) {
      setRequestError(error, setErrorCode, setErrorMessage);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    setStatus(null);
    setClaimResult(null);
    setVisible(false);
    setErrorCode('');
    setErrorMessage('');
    requestIdRef.current = '';
    hasAutoOpenedRef.current = false;
    if (uid) void refresh();
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
    if (!uid || !status?.claimable || isClaiming) return;
    setClaiming(true);
    setErrorCode('');
    setErrorMessage('');
    if (!requestIdRef.current) requestIdRef.current = createDailyLoginRequestId();
    try {
      const result = await claimDailyLoginReward(requestIdRef.current);
      setClaimResult(result);
      requestIdRef.current = '';
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
      setRequestError(error, setErrorCode, setErrorMessage);
    } finally {
      setClaiming(false);
    }
  }, [isClaiming, status?.claimable, uid]);

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

function setRequestError(
  error: unknown,
  setCode: (value: string) => void,
  setMessage: (value: string) => void,
) {
  setCode(error instanceof DailyLoginRequestError ? error.code : 'NETWORK_ERROR');
  setMessage(error instanceof Error ? error.message : 'تعذر الاتصال بخدمة المكافآت.');
}
