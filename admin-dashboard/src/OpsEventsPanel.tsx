import type { User } from 'firebase/auth';
import { FormEvent, useCallback, useEffect, useState } from 'react';

import {
  mutateAdminOpsEvent,
  requestAdminOpsEvents,
  type AdminOpsEvent,
} from './adminDashboardApi';

function createRequestId() {
  return `ops_evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function OpsEventsPanel({ permissions, user }: { permissions: string[]; user: User }) {
  const canView = permissions.includes('incentives:view') || permissions.includes('incentives:manage');
  const canManage = permissions.includes('incentives:manage');
  const [events, setEvents] = useState<AdminOpsEvent[]>([]);
  const [activeEventId, setActiveEventId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [titleAr, setTitleAr] = useState('فعالية الأسبوع');
  const [themeAr, setThemeAr] = useState('أرسل الهدايا وارفع ترتيب عائلتك');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('نشر فعالية تشغيلية');

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const overview = await requestAdminOpsEvents(user);
      setEvents(overview.events);
      setActiveEventId(overview.activeEventId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل الفعاليات.');
    } finally {
      setLoading(false);
    }
  }, [canView, user]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const now = Date.now();
    const start = new Date(now);
    const end = new Date(now + 7 * 24 * 60 * 60 * 1000);
    const toLocal = (value: Date) => {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
    };
    setStartsAt(toLocal(start));
    setEndsAt(toLocal(end));
  }, []);

  if (!canView) {
    return <p className="muted">لا تملك صلاحية عرض فعاليات التشغيل.</p>;
  }

  const onPublish = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage) return;
    setBusy(true);
    setError('');
    try {
      const startsAtMs = new Date(startsAt).getTime();
      const endsAtMs = new Date(endsAt).getTime();
      await mutateAdminOpsEvent(user, {
        action: 'publish',
        endsAtMs,
        reason,
        requestId: createRequestId(),
        startsAtMs,
        themeAr,
        titleAr,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر النشر.');
    } finally {
      setBusy(false);
    }
  };

  const onRetire = async (eventId: string) => {
    if (!canManage) return;
    setBusy(true);
    setError('');
    try {
      await mutateAdminOpsEvent(user, {
        action: 'retire',
        eventId,
        reason: reason || 'إيقاف فعالية',
        requestId: createRequestId(),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر الإيقاف.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="daily-login-admin">
      <div className="daily-login-hero">
        <div>
          <span className="economy-eyebrow">Wave 8</span>
          <h2>فعاليات ومهام يومية</h2>
          <p>انشر عنوانًا ونافذة زمنية وثيمًا عربيًا يظهر في شريط الرئيسية. المهام اليومية الافتراضية (أرسل 3 هدايا) تُدار عبر العلم dailyMissions.</p>
        </div>
        <div className="daily-login-statuses">
          <span className="pill">{activeEventId ? `نشط: ${activeEventId}` : 'لا توجد فعالية نشطة'}</span>
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="muted">جارٍ التحميل…</p> : null}

      {canManage ? (
        <form className="daily-login-editor panel" onSubmit={onPublish}>
          <h3>نشر فعالية</h3>
          <label>
            العنوان
            <input value={titleAr} onChange={(e) => setTitleAr(e.target.value)} maxLength={80} required />
          </label>
          <label>
            الثيم
            <input value={themeAr} onChange={(e) => setThemeAr(e.target.value)} maxLength={160} />
          </label>
          <label>
            يبدأ
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
          </label>
          <label>
            ينتهي
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required />
          </label>
          <label>
            سبب التدقيق
            <input value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} required />
          </label>
          <button disabled={busy} type="submit">نشر</button>
        </form>
      ) : null}

      <div className="panel">
        <h3>الفعاليات الأخيرة</h3>
        {!events.length ? <p className="muted">لا توجد فعاليات بعد.</p> : null}
        <ul className="ops-events-list">
          {events.map((row) => (
            <li key={row.eventId}>
              <strong>{row.titleAr}</strong>
              <span className="muted"> · {row.status} · {row.eventId}</span>
              {row.themeAr ? <div className="muted">{row.themeAr}</div> : null}
              {canManage && row.status === 'published' ? (
                <button disabled={busy} onClick={() => void onRetire(row.eventId)} type="button">
                  إيقاف
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
