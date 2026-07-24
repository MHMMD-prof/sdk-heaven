import { createContext, ReactNode, useCallback, useContext, useRef, useState } from 'react';

import { useAdminDialogFocus } from './useAdminDialogFocus';

type FeedbackTone = 'success' | 'error' | 'info';

type ConfirmOptions = {
  cancelLabel?: string;
  confirmLabel?: string;
  description: string;
  destructive?: boolean;
  title: string;
};

type ConfirmRequest = ConfirmOptions & {
  resolve: (confirmed: boolean) => void;
};

type Toast = {
  description?: string;
  id: number;
  title: string;
  tone: FeedbackTone;
};

type AdminFeedbackValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  notify: (title: string, options?: { description?: string; tone?: FeedbackTone }) => void;
};

const AdminFeedbackContext = createContext<AdminFeedbackValue | null>(null);

export function AdminFeedbackProvider({ children }: { children: ReactNode }) {
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextToastId = useRef(0);
  const dialogRef = useAdminDialogFocus(Boolean(confirmRequest), () => settleConfirmation(false));

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    setConfirmRequest((current) => {
      current?.resolve(false);
      return { ...options, resolve };
    });
  }), []);

  const notify = useCallback((title: string, options?: { description?: string; tone?: FeedbackTone }) => {
    const id = nextToastId.current + 1;
    nextToastId.current = id;
    setToasts((current) => [...current, {
      description: options?.description,
      id,
      title,
      tone: options?.tone ?? 'info',
    }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4500);
  }, []);

  function settleConfirmation(confirmed: boolean) {
    setConfirmRequest((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }

  return (
    <AdminFeedbackContext.Provider value={{ confirm, notify }}>
      {children}
      <div aria-live="polite" className="admin-toast-region">
        {toasts.map((toast) => (
          <article className={`admin-toast tone-${toast.tone}`} key={toast.id} role="status">
            <span className="admin-toast-mark" aria-hidden="true">{toast.tone === 'success' ? '✓' : toast.tone === 'error' ? '!' : 'i'}</span>
            <div><strong>{toast.title}</strong>{toast.description ? <small>{toast.description}</small> : null}</div>
            <button aria-label="إغلاق الإشعار" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))} type="button">×</button>
          </article>
        ))}
      </div>
      {confirmRequest ? (
        <div className="admin-dialog-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) settleConfirmation(false); }}>
          <section aria-describedby="admin-dialog-description" aria-labelledby="admin-dialog-title" aria-modal="true" className="admin-dialog" ref={dialogRef} role="alertdialog" tabIndex={-1}>
            <span className={`admin-dialog-icon${confirmRequest.destructive ? ' destructive' : ''}`} aria-hidden="true">{confirmRequest.destructive ? '!' : '؟'}</span>
            <div>
              <p className="eyebrow">تأكيد الإجراء</p>
              <h3 id="admin-dialog-title">{confirmRequest.title}</h3>
              <p id="admin-dialog-description">{confirmRequest.description}</p>
            </div>
            <div className="admin-dialog-actions">
              <button className="dialog-cancel" onClick={() => settleConfirmation(false)} type="button">{confirmRequest.cancelLabel ?? 'إلغاء'}</button>
              <button autoFocus className={confirmRequest.destructive ? 'dialog-confirm destructive' : 'dialog-confirm'} onClick={() => settleConfirmation(true)} type="button">{confirmRequest.confirmLabel ?? 'تأكيد'}</button>
            </div>
          </section>
        </div>
      ) : null}
    </AdminFeedbackContext.Provider>
  );
}

export function useAdminFeedback() {
  const value = useContext(AdminFeedbackContext);
  if (!value) throw new Error('useAdminFeedback must be used inside AdminFeedbackProvider.');
  return value;
}
