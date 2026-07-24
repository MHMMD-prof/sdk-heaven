import { ReactNode } from 'react';

export function AdminSectionHeader({
  actions,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <header className="section-header admin-section-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {actions ? <div className="admin-section-actions">{actions}</div> : null}
    </header>
  );
}

export function AdminCollectionState({
  children,
  empty,
  emptyMessage,
  error,
  loading,
  loadingMessage,
  onRetry,
}: {
  children: ReactNode;
  empty: boolean;
  emptyMessage: string;
  error?: string;
  loading: boolean;
  loadingMessage: string;
  onRetry?: () => void;
}) {
  if (error) {
    return (
      <div className="admin-state state-error" role="alert">
        <span aria-hidden="true">!</span>
        <div><strong>تعذّر تحميل البيانات</strong><p>{error}</p></div>
        {onRetry ? <button className="secondary-button compact" onClick={onRetry} type="button">إعادة المحاولة</button> : null}
      </div>
    );
  }

  if (loading) {
    return <div aria-busy="true" className="admin-state state-loading"><span className="state-spinner" aria-hidden="true" /><div><strong>{loadingMessage}</strong><p>سيتم تحديث المحتوى تلقائياً عند اكتمال الطلب.</p></div></div>;
  }

  if (empty) {
    return <div className="admin-state state-empty"><span aria-hidden="true">◇</span><div><strong>{emptyMessage}</strong><p>جرّب تغيير المرشحات أو تحديث الصفحة.</p></div></div>;
  }

  return <>{children}</>;
}

export function AdminSurface({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`admin-surface ${className}`.trim()}>{children}</section>;
}

export function AdminStatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }) {
  return <span className={`admin-status-badge tone-${tone}`}>{children}</span>;
}
