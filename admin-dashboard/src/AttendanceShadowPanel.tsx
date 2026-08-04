import type { User } from 'firebase/auth';
import { FormEvent, useState } from 'react';

import {
  AdminAttendanceShadowReport,
  mutateAdminAttendanceOutage,
  requestAdminAttendanceShadow,
} from './adminDashboardApi';
import { AdminStatusBadge, AdminSurface } from './AdminUi';

export function AttendanceShadowPanel({ permissions, user }: { permissions: string[]; user: User }) {
  const [uid, setUid] = useState('');
  const [report, setReport] = useState<AdminAttendanceShadowReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outageStart, setOutageStart] = useState('');
  const [outageEnd, setOutageEnd] = useState('');
  const [outageReason, setOutageReason] = useState('');
  const canView = permissions.includes('payroll:view');
  const canManage = permissions.includes('payroll:manage');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canView || !uid.trim()) return;
    setBusy(true);
    setError('');
    try {
      setReport(await requestAdminAttendanceShadow(user, uid.trim()));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'تعذر تحميل تقرير الحضور.');
    } finally {
      setBusy(false);
    }
  }

  async function mutateOutage(operation: 'create' | 'revoke', outageId = '') {
    if (!canManage || outageReason.trim().length < 3) return;
    setBusy(true);
    setError('');
    try {
      await mutateAdminAttendanceOutage(user, {
        ...(operation === 'create' ? {
          endAtMillis: new Date(outageEnd).getTime(),
          startAtMillis: new Date(outageStart).getTime(),
        } : {}),
        operation,
        ...(outageId ? { outageId } : {}),
        reason: outageReason.trim(),
      });
      if (report) setReport(await requestAdminAttendanceShadow(user, report.uid));
      setOutageReason('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'تعذر تحديث نافذة العطل.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminSurface className="settings-card attendance-shadow-card">
      <div className="attendance-shadow-heading">
        <div><h3>حضور المايك — تقرير الظل</h3><p className="field-hint">أدلة LiveKit والمقعد الموثوق فقط. لا ينتج عن هذا التقرير أي راتب.</p></div>
        <AdminStatusBadge tone="warning">تقرير فقط</AdminStatusBadge>
      </div>
      <form className="attendance-shadow-search" onSubmit={(event) => void submit(event)}>
        <input aria-label="UID" dir="ltr" disabled={!canView || busy} onChange={(event) => setUid(event.target.value)} placeholder="Firebase UID" value={uid} />
        <button className="secondary-button compact" disabled={!canView || busy || !uid.trim()} type="submit">{busy ? 'جارٍ التحقق…' : 'عرض الأدلة'}</button>
      </form>
      {canManage ? <div className="attendance-outage-editor">
        <label><span>بداية العطل</span><input onChange={(event) => setOutageStart(event.target.value)} type="datetime-local" value={outageStart} /></label>
        <label><span>نهاية العطل</span><input onChange={(event) => setOutageEnd(event.target.value)} type="datetime-local" value={outageEnd} /></label>
        <label><span>سبب موثق</span><input onChange={(event) => setOutageReason(event.target.value)} value={outageReason} /></label>
        <button className="secondary-button compact" disabled={busy || !outageStart || !outageEnd || outageReason.trim().length < 3} onClick={() => void mutateOutage('create')} type="button">إضافة عطل معذور</button>
      </div> : null}
      {error ? <p className="danger-text">{error}</p> : null}
      {report ? <>
        <div className="settings-kpis">
          <Metric label="أيام التقرير" value={String(report.days.length)} />
          <Metric label="الفواصل الخام" value={String(report.rawIntervals.length)} />
          <Metric label="جلسات متصلة" value={String(report.sessions.filter((item) => item.connected).length)} />
          <Metric danger={report.muteGraceCycling.flagged} label="إعادة ضبط مهلة الكتم" value={report.muteGraceCycling.flagged ? 'تحتاج مراجعة' : 'طبيعي'} />
        </div>
        <div className="attendance-day-list">
          {report.days.slice().reverse().map((day) => <div className="settings-row" key={day.dayId}><div><strong dir="ltr">{day.dayId}</strong><small>{day.excusedMillis ? `عطل معذور ${minutes(day.excusedMillis)} د` : 'لا يوجد عطل معذور'}</small></div><b>{minutes(day.qualifiedMillis)} دقيقة مؤهلة</b></div>)}
        </div>
        <details><summary>الفواصل الخام وأسباب الإغلاق</summary><div className="attendance-interval-list">
          {report.rawIntervals.map((interval) => <div className="settings-row" key={interval.intervalId}><div><strong dir="ltr">{interval.roomId} · seat {interval.seatId || '—'}</strong><small dir="ltr">{new Date(interval.startAtMillis).toISOString()} → {new Date(interval.endAtMillis).toISOString()}</small></div><b>{interval.state} · {interval.exclusionReason || 'active'}</b></div>)}
          {report.rawIntervals.length === 0 ? <p className="field-hint">لا توجد فواصل مؤهلة في آخر ثمانية أيام.</p> : null}
        </div></details>
        {report.outageWindows.length ? <details><summary>نوافذ الأعطال المعذورة</summary><div className="attendance-interval-list">
          {report.outageWindows.map((window) => <div className="settings-row" key={window.outageId}><div><strong>{window.reason}</strong><small dir="ltr">{new Date(window.startAtMillis).toISOString()} → {new Date(window.endAtMillis).toISOString()}</small></div>{canManage ? <button className="danger-button compact" disabled={busy || outageReason.trim().length < 3} onClick={() => void mutateOutage('revoke', window.outageId)} type="button">إلغاء</button> : null}</div>)}
        </div></details> : null}
      </> : null}
      {!canView ? <p className="field-hint">هذا التقرير متاح لمشغلي الرواتب المخولين فقط.</p> : null}
    </AdminSurface>
  );
}

function Metric({ danger, label, value }: { danger?: boolean; label: string; value: string }) {
  return <div className="settings-kpi"><span>{label}</span><strong className={danger ? 'danger-text' : ''}>{value}</strong></div>;
}

function minutes(milliseconds: number) {
  return Math.floor(milliseconds / 60_000).toLocaleString('ar-IQ');
}
