import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';

import { useAdminFeedback } from './AdminFeedback';
import { AdminCollectionState, AdminSectionHeader, AdminStatusBadge, AdminSurface } from './AdminUi';
import { useAdminDialogFocus } from './useAdminDialogFocus';
import { readAdminRouteSnapshot, useAdminRouteSnapshot } from './adminRouteState';
import { readAdminQueryParameter, setAdminQueryParameter } from './adminDeepLinks';
import {
  AdminAdministrator,
  AdminAuditEventRow,
  AdminDashboardRequestError,
  AdminPageInfo,
  AdminReportAction,
  AdminReportFilters,
  AdminReportIdentity,
  AdminReportRow,
  AdminReportSeverity,
  AdminReportStatusFilter,
  AdminReportSummary,
  executeAdminReportAction,
  requestAdminAdministrators,
  requestAdminReportDetail,
  requestAdminReportsPage,
  requestAdminReportSummary,
} from './adminDashboardApi';

type QueueState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: AdminReportRow[]; pageInfo: AdminPageInfo };

const emptySummary: AdminReportSummary = {
  open: 0,
  overdue: 0,
  resolvedToday: 0,
  sampled: false,
  triage: 0,
  unassigned: 0,
  urgent: 0,
};

export function ReportsPanel({ user }: { user: User }) {
  const { confirm, notify } = useAdminFeedback();
  const deepLinkedReportId = readAdminQueryParameter(window.location.search, 'report');
  const restored = useRef(readAdminRouteSnapshot<{ filters: AdminReportFilters; queue: QueueState; searchDraft: string; summary: AdminReportSummary }>('reports')).current;
  const [filters, setFilters] = useState<AdminReportFilters>(restored?.value.filters || { status: 'open' });
  const [searchDraft, setSearchDraft] = useState(restored?.value.searchDraft || '');
  const [queue, setQueue] = useState<QueueState>(restored?.value.queue?.status === 'ready' ? restored.value.queue : { status: 'loading' });
  const [summary, setSummary] = useState<AdminReportSummary>(restored?.value.summary || emptySummary);
  const [administrators, setAdministrators] = useState<AdminAdministrator[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedReportId, setSelectedReportId] = useState(deepLinkedReportId);
  const [bulkAssignee, setBulkAssignee] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const requestVersion = useRef(0);
  const skipRestoredLoad = useRef(restored?.value.queue?.status === 'ready');

  const loadQueue = useCallback(async (append = false, cursor = '') => {
    const version = ++requestVersion.current;
    if (!append) setQueue({ status: 'loading' });
    try {
      const page = await requestAdminReportsPage(user, { ...filters, cursor });
      if (version !== requestVersion.current) return;
      setQueue((current) => ({
        status: 'ready',
        items: append && current.status === 'ready' ? [...current.items, ...page.items] : page.items,
        pageInfo: page.pageInfo,
      }));
      if (!append) setSelectedIds(new Set());
    } catch (error) {
      if (version !== requestVersion.current) return;
      setQueue({ status: 'error', message: error instanceof Error ? error.message : 'تعذّر تحميل البلاغات.' });
    }
  }, [filters, user]);

  const refreshSummary = useCallback(async () => {
    try {
      setSummary(await requestAdminReportSummary(user));
    } catch (error) {
      notify('تعذّر تحديث مؤشرات البلاغات', { description: error instanceof Error ? error.message : undefined, tone: 'error' });
    }
  }, [notify, user]);

  useEffect(() => { if (skipRestoredLoad.current) { skipRestoredLoad.current = false; return; } void loadQueue(); }, [loadQueue]);
  useEffect(() => {
    void refreshSummary();
    void requestAdminAdministrators(user)
      .then(setAdministrators)
      .catch((error) => notify('تعذّر تحميل قائمة المشرفين', { description: error instanceof Error ? error.message : undefined, tone: 'error' }));
  }, [notify, refreshSummary, user]);

  const rows = queue.status === 'ready' ? queue.items : [];
  const routeSnapshot = useMemo(() => ({ filters, queue, searchDraft, summary }), [filters, queue, searchDraft, summary]);
  useAdminRouteSnapshot('reports', routeSnapshot, restored?.scrollY || 0);
  const allVisibleSelected = rows.length > 0 && rows.every((report) => selectedIds.has(report.id));
  function openReport(reportId: string) { setSelectedReportId(reportId); setAdminQueryParameter('report', reportId); }
  function closeReport() { setSelectedReportId(''); setAdminQueryParameter('report', ''); }

  function updateFilter<K extends keyof AdminReportFilters>(key: K, value: AdminReportFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, cursor: '' }));
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    updateFilter('search', searchDraft.trim());
  }

  function toggleSelected(reportId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(reportId)) next.delete(reportId); else next.add(reportId);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) rows.forEach((report) => next.delete(report.id));
      else rows.forEach((report) => next.add(report.id));
      return next;
    });
  }

  async function runBulkAction(action: 'assign' | 'triage') {
    const selectedRows = rows.filter((report) => selectedIds.has(report.id));
    if (!selectedRows.length || (action === 'assign' && !bulkAssignee)) return;
    const approved = await confirm({
      confirmLabel: action === 'assign' ? 'تأكيد التعيين' : 'بدء الفرز',
      description: `سيتم تحديث ${selectedRows.length.toLocaleString('ar-IQ')} بلاغات وتسجيل كل إجراء في سجل التدقيق.`,
      title: action === 'assign' ? 'تعيين البلاغات المحددة؟' : 'نقل البلاغات إلى الفرز؟',
    });
    if (!approved) return;
    setBulkBusy(true);
    const results = await Promise.allSettled(selectedRows.map((report) => executeAdminReportAction(user, {
      assigneeUid: action === 'assign' ? bulkAssignee : report.assignedTo,
      expectedUpdatedAt: report.updatedAt,
      reportAction: action,
      reportId: report.id,
    })));
    const failed = results.filter((result) => result.status === 'rejected').length;
    setBulkBusy(false);
    notify(failed ? 'اكتمل الإجراء مع بعض التعذّر' : 'تم تحديث البلاغات المحددة', {
      description: failed ? `تعذّر تحديث ${failed.toLocaleString('ar-IQ')} بلاغات؛ أعد تحميلها قبل المحاولة.` : undefined,
      tone: failed ? 'error' : 'success',
    });
    await Promise.all([loadQueue(), refreshSummary()]);
  }

  return (
    <div className="reports-workspace">
      <AdminSectionHeader
        actions={<button className="secondary-button compact" onClick={() => void Promise.all([loadQueue(), refreshSummary()])} type="button">تحديث البيانات</button>}
        description="مساحة عمل موحّدة لفرز البلاغات وتوثيق القرارات ومراقبة زمن الاستجابة."
        eyebrow="الثقة والأمان"
        title="مركز مراجعة البلاغات"
      />

      <ReportKpis summary={summary} />

      <AdminSurface className="report-queue-surface">
        <div className="report-status-tabs" role="tablist" aria-label="حالة البلاغ">
          {(['open', 'triage', 'resolved'] as AdminReportStatusFilter[]).map((status) => (
            <button aria-selected={filters.status === status} className={filters.status === status ? 'selected' : ''} key={status} onClick={() => updateFilter('status', status)} role="tab" type="button">
              {reportStatusLabel(status)}
              <span>{status === 'open' ? summary.open : status === 'triage' ? summary.triage : summary.resolvedToday}</span>
            </button>
          ))}
        </div>

        <form className="report-filter-bar" onSubmit={submitSearch}>
          <label className="report-search"><span aria-hidden="true">⌕</span><input aria-label="البحث في البلاغات" onChange={(event) => setSearchDraft(event.target.value)} placeholder="ابحث بالمعرّف أو المستخدم أو السبب…" value={searchDraft} /></label>
          <select aria-label="درجة الخطورة" onChange={(event) => updateFilter('severity', event.target.value as AdminReportSeverity | '')} value={filters.severity || ''}>
            <option value="">كل درجات الخطورة</option><option value="critical">حرج</option><option value="high">عالٍ</option><option value="medium">متوسط</option><option value="low">منخفض</option>
          </select>
          <select aria-label="المشرف المعيّن" onChange={(event) => updateFilter('assigneeUid', event.target.value)} value={filters.assigneeUid || ''}>
            <option value="">كل المسؤولين</option><option value="unassigned">غير معيّن</option>{administrators.map((adminUser) => <option key={adminUser.uid} value={adminUser.uid}>{adminLabel(adminUser)}</option>)}
          </select>
          <input aria-label="مصدر البلاغ" className="report-source-filter" onChange={(event) => updateFilter('source', event.target.value.trim())} placeholder="المصدر" value={filters.source || ''} />
          <button className="primary-button compact" type="submit">بحث</button>
        </form>
        <div className="report-advanced-filter-bar">
          <span>تصفية متقدمة</span>
          <label>الغرفة<input onChange={(event) => updateFilter('roomId', event.target.value.trim())} placeholder="معرّف الغرفة" value={filters.roomId || ''} /></label>
          <label>من تاريخ<input onChange={(event) => updateFilter('createdFrom', event.target.value)} type="date" value={filters.createdFrom || ''} /></label>
          <label>إلى تاريخ<input onChange={(event) => updateFilter('createdTo', event.target.value)} type="date" value={filters.createdTo || ''} /></label>
          {(filters.roomId || filters.createdFrom || filters.createdTo) ? <button onClick={() => setFilters((current) => ({ ...current, createdFrom: '', createdTo: '', roomId: '' }))} type="button">مسح التصفية المتقدمة</button> : null}
        </div>

        {selectedIds.size > 0 ? (
          <div className="report-bulk-bar">
            <strong>{selectedIds.size.toLocaleString('ar-IQ')} محدد</strong>
            <select aria-label="تعيين المشرف للبلاغات المحددة" onChange={(event) => setBulkAssignee(event.target.value)} value={bulkAssignee}>
              <option value="">اختر مشرفاً للتعيين</option>{administrators.map((adminUser) => <option key={adminUser.uid} value={adminUser.uid}>{adminLabel(adminUser)}</option>)}
            </select>
            <button className="secondary-button compact" disabled={bulkBusy || !bulkAssignee} onClick={() => void runBulkAction('assign')} type="button">تعيين جماعي</button>
            <button className="secondary-button compact" disabled={bulkBusy} onClick={() => void runBulkAction('triage')} type="button">بدء الفرز</button>
            <button className="report-clear-selection" onClick={() => setSelectedIds(new Set())} type="button">إلغاء التحديد</button>
          </div>
        ) : null}

        <AdminCollectionState empty={queue.status === 'ready' && rows.length === 0} emptyMessage="لا توجد بلاغات مطابقة" error={queue.status === 'error' ? queue.message : undefined} loading={queue.status === 'loading'} loadingMessage="جارٍ تجهيز طابور المراجعة…" onRetry={() => void loadQueue()}>
          {queue.status === 'ready' ? (
            <>
              <div className="report-table-wrap">
                <table className="report-queue-table">
                  <thead><tr><th><input aria-label="تحديد كل البلاغات الظاهرة" checked={allVisibleSelected} onChange={toggleAllVisible} type="checkbox" /></th><th>البلاغ</th><th>الخطورة</th><th>المصدر</th><th>المسؤول</th><th>وقت الاستجابة</th><th>آخر تحديث</th><th aria-label="فتح التفاصيل" /></tr></thead>
                  <tbody>{rows.map((report) => (
                    <tr className={selectedIds.has(report.id) ? 'selected' : ''} key={report.id} onDoubleClick={() => openReport(report.id)}>
                      <td><input aria-label={`تحديد البلاغ ${report.id}`} checked={selectedIds.has(report.id)} onChange={() => toggleSelected(report.id)} type="checkbox" /></td>
                      <td><button className="report-title-button" onClick={() => openReport(report.id)} type="button"><strong>{report.reason || 'بلاغ بلا وصف'}</strong><small>#{report.id} · {report.targetUid || 'هدف غير محدد'}</small></button></td>
                      <td><SeverityBadge severity={report.severity} /></td>
                      <td><span className="report-source">{sourceLabel(report.source)}</span></td>
                      <td><span className={report.assignedTo ? '' : 'muted'}>{administratorName(administrators, report.assignedTo)}</span></td>
                      <td><SlaBadge report={report} /></td>
                      <td><time dateTime={report.updatedAt}>{relativeTime(report.updatedAt)}</time></td>
                      <td><button aria-label={`فتح تفاصيل البلاغ ${report.id}`} className="report-open-button" onClick={() => openReport(report.id)} type="button">←</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {queue.pageInfo.hasNextPage && queue.pageInfo.nextCursor ? <button className="report-load-more secondary-button" onClick={() => void loadQueue(true, queue.pageInfo.nextCursor || '')} type="button">تحميل المزيد من البلاغات</button> : null}
            </>
          ) : null}
        </AdminCollectionState>
      </AdminSurface>

      {selectedReportId ? <ReportDrawer administrators={administrators} onClose={closeReport} onChanged={() => Promise.all([loadQueue(), refreshSummary()]).then(() => undefined)} reportId={selectedReportId} user={user} /> : null}
    </div>
  );
}


function ReportKpis({ summary }: { summary: AdminReportSummary }) {
  const cards = [
    { label: 'بانتظار الفرز', value: summary.open, detail: `${summary.unassigned.toLocaleString('ar-IQ')} بلا مسؤول`, tone: 'gold' },
    { label: 'بلاغات حرجة', value: summary.urgent, detail: 'تحتاج أولوية مباشرة', tone: 'red' },
    { label: 'تجاوزت 24 ساعة', value: summary.overdue, detail: 'خارج زمن الاستجابة', tone: 'purple' },
    { label: 'أُغلقت اليوم', value: summary.resolvedToday, detail: 'قرارات موثقة', tone: 'green' },
  ];
  return <div className="report-kpi-grid">{cards.map((card) => <article className={`report-kpi tone-${card.tone}`} key={card.label}><span className="report-kpi-icon" aria-hidden="true" /><div><small>{card.label}</small><strong>{card.value.toLocaleString('ar-IQ')}</strong><p>{card.detail}</p></div></article>)}</div>;
}

function ReportDrawer({ administrators, onChanged, onClose, reportId, user }: { administrators: AdminAdministrator[]; onChanged: () => Promise<void>; onClose: () => void; reportId: string; user: User }) {
  const { confirm, notify } = useAdminFeedback();
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; report: AdminReportRow; history: AdminAuditEventRow[]; identities: { reporter: AdminReportIdentity; target: AdminReportIdentity } }>({ status: 'loading' });
  const [note, setNote] = useState('');
  const [assigneeUid, setAssigneeUid] = useState('');
  const [busy, setBusy] = useState(false);
  const dialogRef = useAdminDialogFocus(true, onClose);

  const loadDetail = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const detail = await requestAdminReportDetail(user, reportId);
      setState({ status: 'ready', ...detail });
      setAssigneeUid(detail.report.assignedTo);
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : 'تعذّر تحميل تفاصيل البلاغ.' });
    }
  }, [reportId, user]);

  useEffect(() => { void loadDetail(); }, [loadDetail]);

  async function runAction(reportAction: AdminReportAction) {
    if (state.status !== 'ready') return;
    const needsNote = ['escalate', 'note', 'reopen', 'resolve'].includes(reportAction);
    if (needsNote && note.trim().length < 2) {
      notify('أضف ملاحظة توثّق سبب الإجراء', { tone: 'error' });
      return;
    }
    if (['escalate', 'reopen', 'resolve'].includes(reportAction)) {
      const approved = await confirm({
        confirmLabel: actionLabel(reportAction),
        description: `سيُسجل هذا القرار باسمك في سجل البلاغ. ${note.trim()}`,
        destructive: reportAction === 'resolve',
        title: `${actionLabel(reportAction)}؟`,
      });
      if (!approved) return;
    }
    setBusy(true);
    try {
      await executeAdminReportAction(user, { assigneeUid, expectedUpdatedAt: state.report.updatedAt, note: note.trim(), reportAction, reportId });
      setNote('');
      notify('تم تحديث البلاغ', { description: actionLabel(reportAction), tone: 'success' });
      await Promise.all([loadDetail(), onChanged()]);
    } catch (error) {
      const isConflict = error instanceof AdminDashboardRequestError && error.status === 409;
      notify(isConflict ? 'تغير البلاغ بواسطة مشرف آخر' : 'تعذّر تحديث البلاغ', { description: error instanceof Error ? error.message : undefined, tone: 'error' });
      if (isConflict) await loadDetail();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="report-drawer-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <aside aria-label="تفاصيل البلاغ" aria-modal="true" className="report-drawer" ref={dialogRef} role="dialog" tabIndex={-1}>
        <header className="report-drawer-header"><div><p className="eyebrow">ملف المراجعة</p><h3>تفاصيل البلاغ</h3><small>#{reportId}</small></div><button aria-label="إغلاق تفاصيل البلاغ" onClick={onClose} type="button">×</button></header>
        {state.status === 'loading' ? <div className="report-drawer-state"><span className="state-spinner" /> جارٍ تحميل الملف…</div> : null}
        {state.status === 'error' ? <div className="report-drawer-state error"><strong>تعذّر فتح البلاغ</strong><p>{state.message}</p><button className="secondary-button compact" onClick={() => void loadDetail()} type="button">إعادة المحاولة</button></div> : null}
        {state.status === 'ready' ? (
          <div className="report-drawer-content">
            <section className="report-drawer-summary"><div className="report-drawer-badges"><SeverityBadge severity={state.report.severity} /><AdminStatusBadge tone={state.report.status === 'resolved' ? 'success' : state.report.status === 'triage' ? 'warning' : 'danger'}>{reportStatusLabel(state.report.status as AdminReportStatusFilter)}</AdminStatusBadge><SlaBadge report={state.report} /></div><h4>{state.report.reason || 'بلاغ بلا وصف'}</h4><p>{state.report.subjectType ? `نوع المحتوى: ${state.report.subjectType}` : 'لم يُرفق نوع محتوى.'}</p>{state.report.resolutionNote ? <div className="report-resolution-note"><small>قرار الإغلاق</small><strong>{state.report.resolutionNote}</strong></div> : null}</section>
            <section className="report-context-grid"><ContextItem label="المبلّغ" value={identityLabel(state.identities.reporter)} /><ContextItem label="المستخدم المستهدف" value={identityLabel(state.identities.target)} /><ContextItem label="Public ID للمبلّغ" value={state.identities.reporter.publicId || state.report.reporterPublicId || 'غير متاح'} /><ContextItem label="Public ID للمستهدف" value={state.identities.target.publicId || state.report.targetPublicId || 'غير متاح'} /><ContextItem label="الغرفة" value={state.report.roomId || 'لا توجد غرفة'} /><ContextItem label="المصدر" value={sourceLabel(state.report.source)} /><ContextItem label="تاريخ الإنشاء" value={formatDateTime(state.report.createdAt)} /><ContextItem label="آخر تحديث" value={formatDateTime(state.report.updatedAt)} /></section>
            <section className="report-evidence-panel"><div className="report-panel-heading"><div><p className="eyebrow">سياق البلاغ</p><h4>المحتوى والأدلة</h4></div><span>{state.report.evidence.length.toLocaleString('ar-IQ')} مرفقات</span></div>{state.report.contentExcerpt ? <blockquote>{state.report.contentExcerpt}</blockquote> : <p className="report-history-empty">لم تُحفظ معاينة نصية للمحتوى.</p>}{state.report.evidence.length ? <div className="report-evidence-list">{state.report.evidence.map((item, index) => <a href={item.url} key={`${item.url}-${index}`} rel="noreferrer" target="_blank"><span aria-hidden="true">↗</span><div><strong>{item.label}</strong><small>{item.kind}</small></div></a>)}</div> : <p className="report-history-empty">لا توجد روابط أدلة مرفقة بهذا البلاغ.</p>}</section>
            <section className="report-decision-panel"><div className="report-panel-heading"><div><p className="eyebrow">قرار المراجعة</p><h4>المعالجة والتوثيق</h4></div><span>{state.report.noteCount.toLocaleString('ar-IQ')} ملاحظات</span></div><label>المشرف المسؤول<select onChange={(event) => setAssigneeUid(event.target.value)} value={assigneeUid}><option value="">تعيين لنفسي عند الإجراء</option>{administrators.map((adminUser) => <option key={adminUser.uid} value={adminUser.uid}>{adminLabel(adminUser)}</option>)}</select></label><label>ملاحظة القرار<textarea onChange={(event) => setNote(event.target.value)} placeholder="دوّن سبب القرار والسياق المهم للمشرف التالي…" rows={4} value={note} /></label><div className="report-drawer-actions">{state.report.status !== 'resolved' ? <><button disabled={busy} onClick={() => void runAction('assign')} type="button">تعيين</button><button disabled={busy} onClick={() => void runAction('triage')} type="button">بدء الفرز</button><button className="warning" disabled={busy} onClick={() => void runAction('escalate')} type="button">تصعيد</button><button disabled={busy} onClick={() => void runAction('note')} type="button">حفظ ملاحظة</button><button className="danger" disabled={busy} onClick={() => void runAction('resolve')} type="button">إغلاق البلاغ</button></> : <button className="warning wide" disabled={busy} onClick={() => void runAction('reopen')} type="button">إعادة فتح البلاغ</button>}</div></section>
            <section className="report-history"><div className="report-panel-heading"><div><p className="eyebrow">سجل غير قابل للضياع</p><h4>مسار البلاغ</h4></div><span>{state.history.length.toLocaleString('ar-IQ')} أحداث</span></div>{state.history.length ? <ol>{state.history.map((event) => <li key={event.id}><span className="report-history-dot" /><div><strong>{auditActionLabel(event.action)}</strong><p>{event.note || 'إجراء إداري بلا ملاحظة إضافية.'}</p><small>{event.actorEmail || event.actorUid || 'مشرف'} · {formatDateTime(event.createdAt)}</small></div></li>)}</ol> : <p className="report-history-empty">لم تُسجّل إجراءات على هذا البلاغ بعد.</p>}</section>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function ContextItem({ label, value }: { label: string; value: string }) { return <div><small>{label}</small><strong title={value}>{value}</strong></div>; }
function identityLabel(identity: AdminReportIdentity) { return identity.displayName ? `${identity.displayName} · ${identity.uid}` : identity.uid || 'غير معروف'; }
function SeverityBadge({ severity }: { severity: AdminReportSeverity }) { return <span className={`report-severity severity-${severity}`}><i />{severity === 'critical' ? 'حرج' : severity === 'high' ? 'عالٍ' : severity === 'medium' ? 'متوسط' : 'منخفض'}</span>; }
function SlaBadge({ report }: { report: AdminReportRow }) { const sla = reportSla(report); return <span className={`report-sla tone-${sla.tone}`}>{sla.label}</span>; }
function reportSla(report: AdminReportRow) { if (report.status === 'resolved') return { label: 'مغلق', tone: 'resolved' }; const hours = report.createdAt ? (Date.now() - new Date(report.createdAt).getTime()) / 36e5 : 0; if (hours >= 24) return { label: `متأخر ${Math.floor(hours).toLocaleString('ar-IQ')}س`, tone: 'overdue' }; if (hours >= 12) return { label: `متبقي ${Math.ceil(24 - hours).toLocaleString('ar-IQ')}س`, tone: 'warning' }; return { label: 'ضمن الوقت', tone: 'healthy' }; }
function reportStatusLabel(status: AdminReportStatusFilter) { return status === 'triage' ? 'قيد الفرز' : status === 'resolved' ? 'تم الحل' : 'مفتوح'; }
function sourceLabel(source: string) { const labels: Record<string, string> = { chat: 'المحادثات', room: 'الغرف', user: 'ملف مستخدم', voice: 'الصوت' }; return labels[source.toLowerCase()] || source || 'غير محدد'; }
function adminLabel(adminUser: AdminAdministrator) { return adminUser.displayName || adminUser.email || adminUser.uid; }
function administratorName(administrators: AdminAdministrator[], uid: string) { if (!uid) return 'غير معيّن'; const found = administrators.find((item) => item.uid === uid); return found ? adminLabel(found) : uid.slice(0, 12); }
function actionLabel(action: AdminReportAction) { const labels: Record<AdminReportAction, string> = { assign: 'تعيين البلاغ', escalate: 'تصعيد البلاغ', note: 'حفظ ملاحظة', reopen: 'إعادة فتح البلاغ', resolve: 'إغلاق البلاغ', triage: 'بدء الفرز' }; return labels[action]; }
function auditActionLabel(action: string) { return action.startsWith('report-') ? actionLabel(action.slice(7) as AdminReportAction) : action || 'إجراء إداري'; }
function relativeTime(value: string) { if (!value) return 'غير معروف'; const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000)); if (minutes < 60) return `منذ ${minutes.toLocaleString('ar-IQ')} د`; const hours = Math.floor(minutes / 60); if (hours < 24) return `منذ ${hours.toLocaleString('ar-IQ')} س`; return `منذ ${Math.floor(hours / 24).toLocaleString('ar-IQ')} ي`; }
function formatDateTime(value: string) { if (!value) return 'غير معروف'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'غير معروف' : new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
