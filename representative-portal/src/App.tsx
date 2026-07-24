import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortalApi, PortalApiError, type PortalApi } from './api';
import { clearBootstrapFragment, createRequestId, readBootstrapTicket } from './bootstrap';
import { parsePortalBridgeMessage, postPortalBridgeMessage } from './bridge';
import {
  NORMAL_PUBLIC_ID_PATTERN,
  PIN_PATTERN,
  PORTAL_SESSION_POLL_MILLISECONDS,
  PUBLIC_REFERENCE_PATTERN,
  type PortalCurrency,
  type PortalReceipt,
} from './contracts';
import { canOpenReview, initialPortalState, portalReducer } from './machine';
import { createReceiptImageDataUrl, createSafeReceiptText, currencyLabel, formatAmount, receiptFromTransfer } from './receipt';

const QUICK_AMOUNTS = [100, 500, 1_000, 5_000];

export function App() {
  const [state, dispatch] = useReducer(portalReducer, {
    ...initialPortalState,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
  });
  const [pin, setPin] = useState('');
  const [pinSetup, setPinSetup] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinSetupBusy, setPinSetupBusy] = useState(false);
  const [acknowledgedPayment, setAcknowledgedPayment] = useState(false);
  const [shareNotice, setShareNotice] = useState('');
  const sessionTokenRef = useRef('');
  const sessionExpiresAtRef = useRef(0);
  const requestIdRef = useRef('');
  const submittingRef = useRef(false);
  const bootstrapStartedRef = useRef(false);

  const api = useMemo<PortalApi | undefined>(() => {
    const endpoint = String(import.meta.env.VITE_REPRESENTATIVE_PORTAL_API_URL ?? '').trim();
    if (!endpoint) return undefined;
    try {
      return createPortalApi(endpoint, { allowLocalhost: import.meta.env.DEV });
    } catch {
      return undefined;
    }
  }, []);

  const handleTerminalApiError = useCallback((error: unknown): boolean => {
    if (!(error instanceof PortalApiError)) return false;
    if (error.code === 'FEATURE_DISABLED' || error.code === 'REPRESENTATIVE_REQUIRED' || error.code === 'PERMISSION_DENIED') {
      sessionTokenRef.current = '';
      dispatch({ type: 'FEATURE_DISABLED' });
      postPortalBridgeMessage({ type: 'feature-disabled', version: 1 });
      return true;
    }
    if (error.code === 'PORTAL_SESSION_INVALID' || error.code === 'PORTAL_ORIGIN_DENIED') {
      sessionTokenRef.current = '';
      dispatch({ type: 'SESSION_EXPIRED' });
      postPortalBridgeMessage({ type: 'session-expired', version: 1 });
      return true;
    }
    return false;
  }, []);

  const refreshStatus = useCallback(async () => {
    const token = sessionTokenRef.current;
    if (!api || !token || Date.now() >= sessionExpiresAtRef.current) {
      if (token) {
        sessionTokenRef.current = '';
        dispatch({ type: 'SESSION_EXPIRED' });
        postPortalBridgeMessage({ type: 'session-expired', version: 1 });
      }
      return;
    }
    try {
      dispatch({ status: await api.status(token), type: 'STATUS_REFRESHED' });
    } catch (error) {
      handleTerminalApiError(error);
    }
  }, [api, handleTerminalApiError]);

  useEffect(() => {
    if (bootstrapStartedRef.current) return;
    bootstrapStartedRef.current = true;
    const ticket = readBootstrapTicket(window.location.hash);
    clearBootstrapFragment(window.history, window.location);
    if (!api) {
      dispatch({ message: 'إعداد بوابة الوكيل غير مكتمل. تواصل مع الدعم.', type: 'BOOTSTRAP_FAILED' });
      return;
    }
    if (!ticket) {
      dispatch({ message: 'افتح بوابة الوكيل من داخل التطبيق لبدء جلسة آمنة.', type: 'BOOTSTRAP_FAILED' });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const exchange = await api.exchange(ticket);
        if (cancelled) return;
        sessionTokenRef.current = exchange.sessionToken;
        sessionExpiresAtRef.current = Date.parse(exchange.expiresAt);
        const status = await api.status(exchange.sessionToken);
        if (!cancelled) dispatch({ status, type: 'BOOTSTRAP_SUCCEEDED' });
      } catch (error) {
        if (cancelled || handleTerminalApiError(error)) return;
        dispatch({ message: portalMessage(error), type: 'BOOTSTRAP_FAILED' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, handleTerminalApiError]);

  useEffect(() => {
    const onOnline = () => dispatch({ online: true, type: 'ONLINE_CHANGED' });
    const onOffline = () => dispatch({ online: false, type: 'ONLINE_CHANGED' });
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshStatus();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    const interval = window.setInterval(() => void refreshStatus(), PORTAL_SESSION_POLL_MILLISECONDS);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(interval);
    };
  }, [refreshStatus]);

  useEffect(() => {
    const onNativeMessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      const message = parsePortalBridgeMessage(event.data);
      if (message?.type === 'refresh-balance') void refreshStatus();
    };
    const onDocumentMessage = onNativeMessage as unknown as EventListener;

    window.addEventListener('message', onNativeMessage);
    document.addEventListener('message', onDocumentMessage);
    return () => {
      window.removeEventListener('message', onNativeMessage);
      document.removeEventListener('message', onDocumentMessage);
    };
  }, [refreshStatus]);

  const verifyRecipient = async (event: FormEvent) => {
    event.preventDefault();
    if (!api || !state.online || state.busy || !NORMAL_PUBLIC_ID_PATTERN.test(state.recipientInput)) return;
    const token = sessionTokenRef.current;
    if (!token) return;
    dispatch({ type: 'VERIFY_STARTED' });
    try {
      const preview = await api.previewRecipient(token, state.recipientInput);
      requestIdRef.current = '';
      dispatch({ preview, type: 'VERIFY_SUCCEEDED' });
    } catch (error) {
      if (handleTerminalApiError(error)) return;
      dispatch({ message: portalMessage(error), type: 'VERIFY_FAILED' });
    }
  };

  const setupTransferPin = async (event: FormEvent) => {
    event.preventDefault();
    if (!api || pinSetupBusy || !PIN_PATTERN.test(pinSetup) || pinSetup !== pinConfirm) return;
    setPinSetupBusy(true);
    try {
      await api.setupPin(sessionTokenRef.current, pinSetup);
      setPinSetup('');
      setPinConfirm('');
      await refreshStatus();
    } catch (error) {
      if (!handleTerminalApiError(error)) {
        dispatch({ message: portalMessage(error), type: 'BOOTSTRAP_FAILED' });
      }
    } finally {
      setPinSetupBusy(false);
    }
  };

  const openReview = () => {
    if (!canOpenReview(state)) return;
    requestIdRef.current = createRequestId();
    setAcknowledgedPayment(false);
    dispatch({ type: 'REVIEW_OPENED' });
  };

  const submitTransfer = async (event: FormEvent) => {
    event.preventDefault();
    if (!api || !PIN_PATTERN.test(pin) || !state.preview || !state.currency || submittingRef.current || !state.online) return;
    const amount = Number(state.amountInput);
    const requestId = requestIdRef.current;
    if (!requestId) return;
    submittingRef.current = true;
    dispatch({ type: 'SUBMIT_STARTED' });
    try {
      const result = await api.transfer(sessionTokenRef.current, {
        amount,
        currency: state.currency,
        pin,
        proof: state.preview.proof,
        requestId,
      });
      setPin('');
      dispatch({ result, type: 'SUBMIT_SUCCEEDED' });
      postPortalBridgeMessage({ type: 'refresh-balance', version: 1 });
    } catch (error) {
      if (handleTerminalApiError(error)) return;
      const apiError = error instanceof PortalApiError ? error : new PortalApiError('INTERNAL', portalMessage(error), 0);
      if (apiError.code !== 'PIN_INVALID') setPin('');
      dispatch({ code: apiError.code, message: apiError.message, type: 'SUBMIT_FAILED' });
    } finally {
      submittingRef.current = false;
    }
  };

  const endSession = () => {
    sessionTokenRef.current = '';
    sessionExpiresAtRef.current = 0;
    postPortalBridgeMessage({ type: 'close', version: 1 });
    dispatch({ type: 'SESSION_EXPIRED' });
  };

  const shareReceipt = async (receipt: PortalReceipt) => {
    const text = createSafeReceiptText(receipt);
    const imageDataUrl = createReceiptImageDataUrl(receipt);
    if (postPortalBridgeMessage({ imageDataUrl: imageDataUrl || undefined, text, type: 'receipt-share', version: 1 })) {
      setShareNotice('تم إرسال الإيصال إلى التطبيق للمشاركة.');
      return;
    }
    try {
      if (navigator.share) {
        await navigator.share({ text, title: 'إيصال تسليم رصيد افتراضي' });
        setShareNotice('تمت مشاركة الإيصال.');
      } else {
        await navigator.clipboard.writeText(text);
        setShareNotice('تم نسخ نص الإيصال.');
      }
    } catch {
      setShareNotice('لم تكتمل المشاركة.');
    }
  };

  const saveReceiptImage = (receipt: PortalReceipt) => {
    const dataUrl = createReceiptImageDataUrl(receipt);
    if (!dataUrl) {
      setShareNotice('تعذّر إنشاء صورة الإيصال.');
      return;
    }
    const anchor = document.createElement('a');
    anchor.download = `${receipt.publicReference || 'virtual-credit-receipt'}.png`;
    anchor.href = dataUrl;
    anchor.click();
    setShareNotice('تم تجهيز صورة الإيصال.');
  };

  const selectedReceipt = state.receipt
    ?? (state.lastResult ? receiptFromTransfer(state.lastResult) : undefined);
  const status = state.status;
  const currency = state.currency;
  const amount = Number(state.amountInput || 0);
  const currentBalance = status && currency ? status.wallet.balances[currency] : 0;
  const resultingBalance = Math.max(0, currentBalance - amount);
  const dailyRemaining = status && currency ? status.dailyAllowance[currency] : undefined;
  const pinNeedsSetup = status?.pin.state === 'not-configured' || status?.pin.state === 'reset-required';

  return (
    <main className="portal-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <header className="portal-header">
        <button className="icon-button" type="button" onClick={endSession} aria-label="إغلاق بوابة الوكيل">
          <Icon name="close" />
        </button>
        <div className="brand-lockup">
          <span className="eyebrow">SDK HEAVEN</span>
          <strong>بوابة الوكيل</strong>
        </div>
        <button className="icon-button" type="button" onClick={() => void refreshStatus()} aria-label="تحديث الرصيد والحالة">
          <Icon name="refresh" />
        </button>
      </header>

      {!state.online && (
        <div className="offline-banner" role="status">
          <Icon name="offline" />
          <span>أنت غير متصل. لن يتم إرسال أي عملية حتى يعود الاتصال.</span>
        </div>
      )}

      {status && (
        <section className="wallet-strip" aria-label="رصيد محفظتك المشتركة">
          <WalletBalance currency="coins" value={status.wallet.balances.coins} enabled={status.privilege.currencies.coins} />
          <div className="wallet-divider" />
          <WalletBalance currency="diamonds" value={status.wallet.balances.diamonds} enabled={status.privilege.currencies.diamonds} />
        </section>
      )}

      {state.step === 'bootstrapping' && <StateCard kind="loading" title="جارٍ فتح جلستك الآمنة" body="يتم التحقق من صلاحية الوكيل وإعداد المحفظة…" />}
      {state.step === 'failed' && (
        <StateCard kind="error" title="تعذّر فتح البوابة" body={state.error}>
          <button className="primary-button" type="button" onClick={endSession}>العودة إلى التطبيق</button>
        </StateCard>
      )}
      {state.step === 'unavailable' && (
        <StateCard kind="unavailable" title="الخدمة متوقفة مؤقتاً" body="تم تعطيل تحويلات الوكلاء أو سحب الصلاحية. لا يمكن تنفيذ أي تحويل الآن.">
          <button className="primary-button" type="button" onClick={endSession}>إغلاق البوابة</button>
        </StateCard>
      )}
      {state.step === 'locked' && (
        <StateCard kind="locked" title="رمز التحويل مقفل" body={lockedMessage(status?.pin)}>
          <button className="secondary-button" type="button" onClick={() => void refreshStatus()}>تحديث الحالة</button>
        </StateCard>
      )}

      {status && !['bootstrapping', 'failed', 'unavailable', 'locked'].includes(state.step) && (
        <>
          {pinNeedsSetup && (
            <section className="panel pin-setup-panel" aria-labelledby="pin-setup-title">
              <div className="section-heading">
                <span className="section-icon"><Icon name="shield" /></span>
                <div>
                  <span className="eyebrow">خطوة أمان مطلوبة</span>
                  <h1 id="pin-setup-title">{status.pin.state === 'reset-required' ? 'إعادة إعداد رمز التحويل' : 'إعداد رمز التحويل'}</h1>
                </div>
              </div>
              <p className="muted">أنشئ رمزاً من ستة أرقام. سيُطلب منك عند كل تحويل ولا يمكن للإدارة رؤيته أو استعادته.</p>
              <form onSubmit={setupTransferPin} className="pin-setup-form">
                <PinInput label="رمز التحويل الجديد" value={pinSetup} onChange={setPinSetup} autoComplete="new-password" />
                <PinInput label="تأكيد رمز التحويل" value={pinConfirm} onChange={setPinConfirm} autoComplete="new-password" />
                {pinSetup && pinConfirm && pinSetup !== pinConfirm && <p className="field-error" role="alert">الرمزان غير متطابقين.</p>}
                <button className="primary-button" disabled={pinSetupBusy || !PIN_PATTERN.test(pinSetup) || pinSetup !== pinConfirm} type="submit">
                  {pinSetupBusy ? 'جارٍ الحفظ…' : 'حفظ الرمز بأمان'}
                </button>
              </form>
            </section>
          )}

          {!pinNeedsSetup && (
            <>
              <section className="hero-card">
                <div className="hero-seal" aria-hidden="true"><Icon name="verified" /></div>
                <div className="hero-copy">
                  <span className="status-pill"><span className="pulse-dot" /> وكيل معتمد</span>
                  <h1>إرسال رصيد</h1>
                  <p>تحويل فوري من محفظتك المشتركة إلى المعرّف العادي للمستلم.</p>
                </div>
                <div className="hero-rule" />
                <div className="hero-trust">
                  <span><Icon name="shield" /> محمي برمز التحويل</span>
                  <span><Icon name="clock" /> جلسة قصيرة وآمنة</span>
                </div>
              </section>

              {state.step === 'completed' && state.lastResult ? (
                <SuccessPanel
                  receipt={receiptFromTransfer(state.lastResult)}
                  onShare={shareReceipt}
                  onSave={saveReceiptImage}
                  onAnother={() => {
                    requestIdRef.current = '';
                    setAcknowledgedPayment(false);
                    dispatch({ type: 'START_ANOTHER' });
                    void refreshStatus();
                  }}
                />
              ) : (
                <section className="panel transfer-panel" aria-labelledby="transfer-title">
                  <div className="step-indicator" aria-label="مراحل التحويل">
                    <span className="active">١ <small>المستلم</small></span>
                    <i />
                    <span className={state.preview ? 'active' : ''}>٢ <small>القيمة</small></span>
                    <i />
                    <span className={state.step === 'review' || state.step === 'pin-challenge' || state.step === 'submitting' ? 'active' : ''}>٣ <small>التأكيد</small></span>
                  </div>

                  <div className="section-heading compact">
                    <span className="section-icon"><Icon name="user" /></span>
                    <div>
                      <span className="eyebrow">المستلم</span>
                      <h2 id="transfer-title">تحقق من المعرّف العادي</h2>
                    </div>
                  </div>
                  <form className="recipient-form" onSubmit={verifyRecipient}>
                    <label htmlFor="recipient-id">معرّف المستخدم المكوّن من 7 أرقام</label>
                    <div className="input-action-row">
                      <div className="input-shell ltr-input">
                        <span className="input-prefix">ID</span>
                        <input
                          id="recipient-id"
                          aria-label="معرّف المستلم العادي المكوّن من سبعة أرقام"
                          autoComplete="off"
                          enterKeyHint="search"
                          inputMode="numeric"
                          maxLength={7}
                          pattern="[1-9][0-9]{6}"
                          placeholder="0000000"
                          value={state.recipientInput}
                          onChange={(event) => {
                            requestIdRef.current = '';
                            dispatch({ type: 'RECIPIENT_EDITED', value: event.target.value });
                          }}
                        />
                      </div>
                      <button
                        className="verify-button"
                        disabled={!state.online || state.busy || !NORMAL_PUBLIC_ID_PATTERN.test(state.recipientInput)}
                        type="submit"
                      >
                        {state.step === 'verifying' ? <span className="button-spinner" aria-label="جارٍ التحقق" /> : <><Icon name="search" /> تحقق</>}
                      </button>
                    </div>
                  </form>

                  {state.preview && (
                    <div className="recipient-preview" aria-live="polite">
                      <Avatar src={state.preview.recipient.avatarUrl} name={state.preview.recipient.displayName} />
                      <div>
                        <span className="verified-label"><Icon name="verified" /> تم التحقق</span>
                        <strong>{state.preview.recipient.displayName}</strong>
                        <span className="public-id" dir="ltr">ID {state.preview.recipient.publicId}</span>
                      </div>
                    </div>
                  )}

                  {state.preview && (
                    <div className="amount-section">
                      <div className="section-heading compact">
                        <span className="section-icon"><Icon name="wallet" /></span>
                        <div>
                          <span className="eyebrow">الرصيد</span>
                          <h2>اختر العملة والقيمة</h2>
                        </div>
                      </div>
                      <div className="currency-tabs" role="radiogroup" aria-label="عملة التحويل">
                        {(['coins', 'diamonds'] as PortalCurrency[]).map((item) => (
                          <button
                            aria-checked={currency === item}
                            className={currency === item ? 'selected' : ''}
                            disabled={!status.privilege.currencies[item]}
                            key={item}
                            role="radio"
                            type="button"
                            onClick={() => {
                              requestIdRef.current = '';
                              dispatch({ currency: item, type: 'CURRENCY_SELECTED' });
                            }}
                          >
                            <CurrencyMark currency={item} />
                            <span>{item === 'coins' ? 'العملات' : 'الألماس'}</span>
                            {!status.privilege.currencies[item] && <small>غير مصرح</small>}
                          </button>
                        ))}
                      </div>
                      <label htmlFor="transfer-amount">قيمة التحويل</label>
                      <div className="amount-input-shell">
                        <input
                          id="transfer-amount"
                          aria-label="قيمة التحويل كعدد صحيح موجب"
                          enterKeyHint="done"
                          inputMode="numeric"
                          maxLength={12}
                          placeholder="0"
                          value={state.amountInput}
                          onChange={(event) => {
                            requestIdRef.current = '';
                            dispatch({ type: 'AMOUNT_EDITED', value: event.target.value });
                          }}
                        />
                        <span>{currency ? currencyLabel(currency) : ''}</span>
                      </div>
                      <div className="quick-amounts" aria-label="قيم سريعة">
                        {QUICK_AMOUNTS.map((value) => (
                          <button
                            disabled={!currency || value > currentBalance}
                            key={value}
                            type="button"
                            onClick={() => dispatch({ type: 'AMOUNT_EDITED', value: String(value) })}
                          >
                            +{formatAmount(value)}
                          </button>
                        ))}
                      </div>
                      <div className="balance-summary">
                        <span>الرصيد الحالي <strong>{formatAmount(currentBalance)}</strong></span>
                        <span>المتاح اليوم <strong>{dailyRemaining === undefined ? '—' : formatAmount(dailyRemaining)}</strong></span>
                      </div>
                      <button className="primary-button" disabled={!state.online || !canOpenReview(state)} type="button" onClick={openReview}>
                        مراجعة التحويل <Icon name="arrow" />
                      </button>
                    </div>
                  )}
                  {state.error && <p className="form-alert" role="alert">{state.error}</p>}
                </section>
              )}

              <HistoryExplorer
                api={api}
                initialItems={status.recentTransfers}
                online={state.online}
                sessionToken={sessionTokenRef.current}
                onReceipt={(receipt) => dispatch({ receipt, type: 'RECEIPT_SELECTED' })}
                onTerminalError={handleTerminalApiError}
              />
            </>
          )}
        </>
      )}

      {(state.step === 'review' || state.step === 'pin-challenge' || state.step === 'submitting') && state.preview && currency && (
        <div className="modal-backdrop" role="presentation">
          <section className="review-sheet" role="dialog" aria-modal="true" aria-labelledby="review-title">
            <div className="sheet-handle" aria-hidden="true" />
            <button className="sheet-close" type="button" aria-label="إغلاق مراجعة التحويل" disabled={state.busy} onClick={() => dispatch({ type: state.step === 'pin-challenge' ? 'PIN_CLOSED' : 'REVIEW_CLOSED' })}>
              <Icon name="close" />
            </button>
            <div className="review-seal"><Icon name={state.step === 'pin-challenge' || state.step === 'submitting' ? 'shield' : 'receipt'} /></div>
            <span className="eyebrow">{state.step === 'review' ? 'راجع قبل المتابعة' : 'تأكيد آمن'}</span>
            <h2 id="review-title">{state.step === 'review' ? 'تفاصيل التحويل' : 'أدخل رمز التحويل'}</h2>

            {state.step === 'review' ? (
              <>
                <div className="review-recipient">
                  <Avatar src={state.preview.recipient.avatarUrl} name={state.preview.recipient.displayName} />
                  <div><strong>{state.preview.recipient.displayName}</strong><span dir="ltr">ID {state.preview.recipient.publicId}</span></div>
                  <span className="verified-label"><Icon name="verified" /> موثّق</span>
                </div>
                <div className="review-amount">
                  <CurrencyMark currency={currency} />
                  <strong>{formatAmount(amount)}</strong>
                  <span>{currencyLabel(currency)}</span>
                </div>
                <dl className="review-grid">
                  <div><dt>الرصيد الحالي</dt><dd>{formatAmount(currentBalance)}</dd></div>
                  <div><dt>الرصيد بعد التحويل</dt><dd>{formatAmount(resultingBalance)}</dd></div>
                  <div><dt>المتبقي اليوم</dt><dd>{dailyRemaining === undefined ? '—' : formatAmount(Math.max(0, dailyRemaining - amount))}</dd></div>
                </dl>
                <label className="payment-acknowledgement">
                  <input type="checkbox" checked={acknowledgedPayment} onChange={(event) => setAcknowledgedPayment(event.target.checked)} />
                  <span className="custom-check"><Icon name="check" /></span>
                  <span><strong>أؤكد أن المقابل الخارجي تم تحصيله</strong><small>هذا الإقرار لا يجعل إيصال التطبيق إثباتاً للدفع الخارجي.</small></span>
                </label>
                <button className="primary-button" disabled={!acknowledgedPayment} type="button" onClick={() => dispatch({ type: 'PIN_OPENED' })}>
                  المتابعة إلى الرمز <Icon name="shield" />
                </button>
              </>
            ) : (
              <form onSubmit={submitTransfer} className="pin-challenge-form">
                <p>أدخل رمزك المكوّن من ستة أرقام لإرسال <strong>{formatAmount(amount)} {currencyLabel(currency)}</strong>.</p>
                <PinInput label="رمز التحويل" value={pin} onChange={setPin} autoComplete="current-password" autoFocus />
                {state.error && <p className="form-alert" role="alert">{state.error}</p>}
                <button className="primary-button" disabled={!state.online || state.busy || !PIN_PATTERN.test(pin)} type="submit">
                  {state.step === 'submitting' ? <><span className="button-spinner" /> جارٍ التنفيذ…</> : <>تأكيد وإرسال <Icon name="arrow" /></>}
                </button>
                <p className="security-note"><Icon name="lock" /> لن يطلب منك فريق الدعم مشاركة هذا الرمز مطلقاً.</p>
              </form>
            )}
          </section>
        </div>
      )}

      {selectedReceipt && state.receipt && (
        <ReceiptDetail
          receipt={selectedReceipt}
          notice={shareNotice}
          onClose={() => {
            setShareNotice('');
            dispatch({ receipt: undefined, type: 'RECEIPT_SELECTED' });
          }}
          onSave={saveReceiptImage}
          onShare={shareReceipt}
        />
      )}
      <footer className="portal-footer">جلسة مشفرة ومحدودة المدة · لا تشارك رمز التحويل</footer>
    </main>
  );
}

type HistoryFilters = {
  currency: '' | PortalCurrency;
  from: string;
  status: '' | 'completed' | 'reversed';
  to: string;
};

const EMPTY_HISTORY_FILTERS: HistoryFilters = { currency: '', from: '', status: '', to: '' };

function HistoryExplorer({
  api,
  initialItems,
  online,
  onReceipt,
  onTerminalError,
  sessionToken,
}: {
  api?: PortalApi;
  initialItems: PortalReceipt[];
  online: boolean;
  onReceipt(receipt: PortalReceipt): void;
  onTerminalError(error: unknown): boolean;
  sessionToken: string;
}) {
  const [filters, setFilters] = useState<HistoryFilters>(EMPTY_HISTORY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<HistoryFilters>(EMPTY_HISTORY_FILTERS);
  const [items, setItems] = useState<PortalReceipt[]>(initialItems);
  const [nextCursor, setNextCursor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reference, setReference] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);

  const loadHistory = useCallback(async (cursor: string, append: boolean, selectedFilters: HistoryFilters) => {
    if (!api || !sessionToken || !online || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.history(sessionToken, {
        ...selectedFilters,
        cursor,
        from: selectedFilters.from ? `${selectedFilters.from}T00:00:00.000Z` : '',
        limit: 20,
        to: selectedFilters.to ? `${selectedFilters.to}T23:59:59.999Z` : '',
      });
      setItems((current) => append ? [...current, ...result.items] : result.items);
      setNextCursor(result.nextCursor);
    } catch (caught) {
      if (!onTerminalError(caught)) setError(portalMessage(caught));
    } finally {
      setBusy(false);
    }
  }, [api, busy, online, onTerminalError, sessionToken]);

  useEffect(() => {
    if (!api || !sessionToken || !online) return;
    void loadHistory('', false, EMPTY_HISTORY_FILTERS);
    // The session token is established before this component mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, online, sessionToken]);

  const lookup = async (event: FormEvent) => {
    event.preventDefault();
    if (!api || !online || lookupBusy || !PUBLIC_REFERENCE_PATTERN.test(reference)) return;
    setLookupBusy(true);
    setError('');
    try {
      onReceipt(await api.lookupReceipt(sessionToken, reference));
    } catch (caught) {
      if (!onTerminalError(caught)) setError(portalMessage(caught));
    } finally {
      setLookupBusy(false);
    }
  };

  return (
    <section className="history-section" aria-labelledby="history-title">
      <div className="history-heading">
        <div>
          <span className="eyebrow">السجل الخاص</span>
          <h2 id="history-title">الإيصالات والعمليات</h2>
        </div>
        <span>{items.length}</span>
      </div>

      <form className="receipt-lookup" onSubmit={lookup}>
        <label htmlFor="receipt-reference">البحث بالمرجع العام</label>
        <div className="input-action-row">
          <div className="input-shell ltr-input">
            <span className="input-prefix">RPT</span>
            <input
              id="receipt-reference"
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={20}
              placeholder="RPT-0000000000000000"
              value={reference}
              onChange={(event) => setReference(event.target.value.toUpperCase().replace(/[^0-9A-Z-]/g, '').slice(0, 20))}
            />
          </div>
          <button className="verify-button" disabled={!online || lookupBusy || !PUBLIC_REFERENCE_PATTERN.test(reference)} type="submit">
            {lookupBusy ? <span className="button-spinner" /> : <><Icon name="search" /> بحث</>}
          </button>
        </div>
      </form>

      <div className="history-filters" aria-label="مرشحات سجل العمليات">
        <label>
          <span>العملة</span>
          <select value={filters.currency} onChange={(event) => setFilters((current) => ({ ...current, currency: event.target.value as HistoryFilters['currency'] }))}>
            <option value="">الكل</option>
            <option value="coins">العملات</option>
            <option value="diamonds">الألماس</option>
          </select>
        </label>
        <label>
          <span>الحالة</span>
          <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as HistoryFilters['status'] }))}>
            <option value="">الكل</option>
            <option value="completed">مكتملة</option>
            <option value="reversed">مسترجعة</option>
          </select>
        </label>
        <label>
          <span>من</span>
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} />
        </label>
        <label>
          <span>إلى</span>
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} />
        </label>
        <button className="history-apply" disabled={!online || busy} type="button" onClick={() => {
          setAppliedFilters(filters);
          void loadHistory('', false, filters);
        }}>
          {busy ? 'جارٍ التحديث…' : 'تطبيق المرشحات'}
        </button>
      </div>

      {error && <p className="form-alert" role="alert">{error}</p>}
      {items.length > 0 ? (
        <div className="receipt-list">
          {items.map((receipt, index) => (
            <button className={`receipt-row ${receipt.status}`} key={`${receipt.publicReference}-${receipt.kind}-${index}`} type="button" onClick={() => onReceipt(receipt)}>
              <CurrencyMark currency={receipt.currency} />
              <span className="receipt-person">
                <strong>{receipt.recipientDisplayName || 'مستخدم'}</strong>
                <small dir="ltr">ID {receipt.recipientPublicId}</small>
              </span>
              <span className="receipt-amount">
                <strong>{formatAmount(receipt.amount)}</strong>
                <small>{receipt.status === 'reversed' ? 'مسترجعة' : relativeDate(receipt.createdAt)}</small>
              </span>
              <Icon name="chevron" />
            </button>
          ))}
        </div>
      ) : (
        <div className="history-empty"><Icon name="receipt" /><span>{busy ? 'جارٍ تحميل السجل…' : 'لا توجد عمليات مطابقة.'}</span></div>
      )}
      {nextCursor && (
        <button className="secondary-button history-more" disabled={!online || busy} type="button" onClick={() => void loadHistory(nextCursor, true, appliedFilters)}>
          {busy ? 'جارٍ التحميل…' : 'عرض المزيد'}
        </button>
      )}
    </section>
  );
}

function WalletBalance({ currency, enabled, value }: { currency: PortalCurrency; enabled: boolean; value: number }) {
  return (
    <div className={`wallet-balance ${enabled ? '' : 'disabled'}`}>
      <CurrencyMark currency={currency} />
      <span><small>{currency === 'coins' ? 'العملات' : 'الألماس'}</small><strong>{formatAmount(value)}</strong></span>
      {!enabled && <em>غير مصرح</em>}
    </div>
  );
}

function CurrencyMark({ currency }: { currency: PortalCurrency }) {
  return <span className={`currency-mark ${currency}`} aria-hidden="true">{currency === 'coins' ? '●' : '◆'}</span>;
}

function Avatar({ name, src }: { name: string; src: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed
    ? <img className="avatar" alt="" src={src} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span className="avatar avatar-fallback" aria-hidden="true">{name.trim().charAt(0) || 'م'}</span>;
}

function PinInput({ autoComplete, autoFocus, label, onChange, value }: { autoComplete: string; autoFocus?: boolean; label: string; onChange(value: string): void; value: string }) {
  return (
    <label className="pin-field">
      <span>{label}</span>
      <input
        aria-label={label}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        enterKeyHint="done"
        inputMode="numeric"
        maxLength={6}
        pattern="[0-9]{6}"
        placeholder="••••••"
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
      />
    </label>
  );
}

function SuccessPanel({ onAnother, onSave, onShare, receipt }: { onAnother(): void; onSave(receipt: PortalReceipt): void; onShare(receipt: PortalReceipt): void; receipt: PortalReceipt }) {
  return (
    <section className="panel success-panel" aria-labelledby="success-title">
      <div className="success-orbit"><span><Icon name="check" /></span></div>
      <span className="eyebrow">اكتملت العملية</span>
      <h1 id="success-title">تم تسليم الرصيد</h1>
      <p>وصل الرصيد الافتراضي إلى <strong>{receipt.recipientDisplayName}</strong>.</p>
      <div className="success-value">
        <CurrencyMark currency={receipt.currency} />
        <strong>{formatAmount(receipt.amount)}</strong>
        <span>{currencyLabel(receipt.currency)}</span>
      </div>
      <div className="reference-card">
        <span>المرجع العام</span>
        <strong dir="ltr">{receipt.publicReference}</strong>
        <small>احتفظ به عند التواصل مع الدعم</small>
      </div>
      <div className="success-actions">
        <button className="secondary-button" type="button" onClick={() => void onShare(receipt)}><Icon name="share" /> مشاركة</button>
        <button className="secondary-button" type="button" onClick={() => onSave(receipt)}><Icon name="image" /> حفظ صورة</button>
      </div>
      <p className="receipt-disclaimer">الإيصال يؤكد تسليم الرصيد الافتراضي فقط، ولا يثبت استلام دفعة مالية خارجية.</p>
      <button className="primary-button" type="button" onClick={onAnother}>إجراء تحويل آخر</button>
    </section>
  );
}

function ReceiptDetail({ notice, onClose, onSave, onShare, receipt }: { notice: string; onClose(): void; onSave(receipt: PortalReceipt): void; onShare(receipt: PortalReceipt): void; receipt: PortalReceipt }) {
  const reversed = receipt.status === 'reversed';
  return (
    <div className="modal-backdrop receipt-backdrop">
      <section className="receipt-sheet" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
        <button className="sheet-close" type="button" aria-label="إغلاق تفاصيل الإيصال" onClick={onClose}><Icon name="close" /></button>
        <div className={`receipt-stamp ${reversed ? 'reversed' : ''}`}><Icon name={reversed ? 'refresh' : 'check'} /></div>
        <span className="eyebrow">{reversed ? 'إيصال مسترجع' : 'إيصال مكتمل'}</span>
        <h2 id="receipt-title">{reversed ? 'استرجاع رصيد افتراضي' : 'تسليم رصيد افتراضي'}</h2>
        <div className="receipt-ticket">
          <div className="ticket-value"><CurrencyMark currency={receipt.currency} /><strong>{formatAmount(receipt.amount)}</strong><span>{currencyLabel(receipt.currency)}</span></div>
          <dl>
            <div><dt>المستلم</dt><dd>{receipt.recipientDisplayName || 'مستخدم'}</dd></div>
            <div><dt>المعرّف</dt><dd dir="ltr">ID {receipt.recipientPublicId}</dd></div>
            <div><dt>التاريخ</dt><dd>{fullDate(receipt.createdAt)}</dd></div>
            {receipt.reversedAt && <div><dt>تاريخ الاسترجاع</dt><dd>{fullDate(receipt.reversedAt)}</dd></div>}
            <div><dt>المرجع</dt><dd dir="ltr">{receipt.publicReference || '—'}</dd></div>
          </dl>
        </div>
        <div className="success-actions">
          <button className="secondary-button" type="button" onClick={() => void onShare(receipt)}><Icon name="share" /> مشاركة</button>
          <button className="secondary-button" type="button" onClick={() => onSave(receipt)}><Icon name="image" /> صورة</button>
        </div>
        {notice && <p className="share-notice" role="status">{notice}</p>}
        <p className="receipt-disclaimer">
          {reversed
            ? 'يرتبط هذا الاسترجاع بالمرجع الأصلي، ولا يغيّر سجل العملية الأصلية.'
            : 'لا يتضمن الإيصال أرصدة المحافظ أو بيانات داخلية. وهو ليس إثباتاً لدفع خارجي.'}
        </p>
      </section>
    </div>
  );
}

function StateCard({ body, children, kind, title }: { body: string; children?: ReactNode; kind: string; title: string }) {
  return (
    <section className={`panel state-card ${kind}`} role={kind === 'loading' ? 'status' : 'alert'}>
      <div className="state-symbol"><Icon name={kind === 'loading' ? 'refresh' : kind === 'locked' ? 'lock' : kind === 'unavailable' ? 'pause' : 'warning'} /></div>
      <span className="eyebrow">بوابة الوكيل</span>
      <h1>{title}</h1>
      <p>{body}</p>
      {children}
    </section>
  );
}

type IconName = 'arrow' | 'check' | 'chevron' | 'clock' | 'close' | 'image' | 'lock' | 'offline' | 'pause' | 'receipt' | 'refresh' | 'search' | 'share' | 'shield' | 'user' | 'verified' | 'wallet' | 'warning';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m15 18-6-6 6-6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    close: <><path d="m6 6 12 12" /><path d="m18 6-12 12" /></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 15-5-5L5 20" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    offline: <><path d="M2 8.8A15 15 0 0 1 19.2 6" /><path d="M5 12.6a10 10 0 0 1 9.8-2.1" /><path d="M8.5 16.2a5 5 0 0 1 3.7-.9" /><path d="m3 3 18 18" /></>,
    pause: <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>,
    receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" /><path d="M9 8h6M9 12h6" /></>,
    refresh: <><path d="M20 6v5h-5" /><path d="M4 18v-5h5" /><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9M5.5 15A7 7 0 0 0 18 17.5l2-2.5" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" /></>,
    shield: <><path d="M12 3 4 6v5c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6Z" /><path d="m9 12 2 2 4-5" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    verified: <><path d="m12 2 2.2 2.1 3-.4.9 2.9 2.7 1.4-1 2.8 1 2.8-2.7 1.4-.9 2.9-3-.4L12 22l-2.2-2.1-3 .4-.9-2.9L3.2 16l1-2.8-1-2.8L5.9 9l.9-2.9 3 .4Z" /><path d="m9 12 2 2 4-5" /></>,
    wallet: <><path d="M4 6h15a2 2 0 0 1 2 2v11H5a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3h12" /><path d="M15 11h6v5h-6a2.5 2.5 0 0 1 0-5Z" /></>,
    warning: <><path d="M12 3 2.8 20h18.4Z" /><path d="M12 9v5M12 17h.01" /></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function portalMessage(error: unknown): string {
  return error instanceof PortalApiError ? error.message : 'حدث خطأ غير متوقع. حاول مجدداً.';
}

function lockedMessage(pinState: unknown): string {
  if (pinState && typeof pinState === 'object' && 'lockedUntil' in pinState && typeof pinState.lockedUntil === 'string') {
    const value = Date.parse(pinState.lockedUntil);
    if (Number.isFinite(value)) return `تم إيقاف المحاولات مؤقتاً حتى ${new Intl.DateTimeFormat('ar-IQ', { hour: 'numeric', minute: '2-digit' }).format(new Date(value))}.`;
  }
  return 'تم إيقاف المحاولات مؤقتاً. حاول لاحقاً.';
}

function fullDate(value: string): string {
  return Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : '—';
}

function relativeDate(value: string): string {
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return '—';
  const minutes = Math.max(0, Math.round((Date.now() - millis) / 60_000));
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `منذ ${minutes} د`;
  if (minutes < 1_440) return `منذ ${Math.round(minutes / 60)} س`;
  return fullDate(value);
}
