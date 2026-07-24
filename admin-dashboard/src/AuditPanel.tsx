import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';

import {
  AdminAdministrator,
  AdminAuditDetail,
  AdminAuditEventRow,
  AdminAuditFilters,
  AdminAuditSummary,
  AdminPageInfo,
  requestAdminAdministrators,
  requestAdminAuditDetail,
  requestAdminAuditEventsPage,
  requestAdminAuditExport,
  requestAdminAuditSummary,
} from './adminDashboardApi';
import { useAdminFeedback } from './AdminFeedback';
import { useAdminDialogFocus } from './useAdminDialogFocus';
import { readAuditTarget } from './adminWorkspacePolicy';
import { readAdminRouteSnapshot, useAdminRouteSnapshot } from './adminRouteState';
import { readAdminQueryParameter, setAdminQueryParameter } from './adminDeepLinks';

const emptyFilters: AdminAuditFilters = { actorUid: '', createdFrom: '', createdTo: '', entityType: '', eventAction: '', kind: '', search: '', status: '', target: '' };

export function AuditWorkspace({ user }: { user: User }) {
  const { notify } = useAdminFeedback();
  const deepLinkedTarget = readAuditTarget(window.location.search);
  const deepLinkedEvent = readAdminQueryParameter(window.location.search, 'event');
  const restored = useRef(readAdminRouteSnapshot<{ advancedOpen: boolean; events: AdminAuditEventRow[]; filters: AdminAuditFilters; pageInfo?: AdminPageInfo; summary?: AdminAuditSummary }>('audit')).current;
  const [filters, setFilters] = useState<AdminAuditFilters>(() => deepLinkedTarget ? { ...emptyFilters, target: deepLinkedTarget } : restored?.value.filters || emptyFilters);
  const [summary, setSummary] = useState<AdminAuditSummary | undefined>(restored?.value.summary);
  const [administrators, setAdministrators] = useState<AdminAdministrator[]>([]);
  const [events, setEvents] = useState<AdminAuditEventRow[]>(deepLinkedTarget ? [] : restored?.value.events || []);
  const [pageInfo, setPageInfo] = useState<AdminPageInfo | undefined>(deepLinkedTarget ? undefined : restored?.value.pageInfo);
  const [loading, setLoading] = useState(!restored || Boolean(deepLinkedTarget));
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<AdminAuditEventRow>();
  const [detail, setDetail] = useState<AdminAuditDetail>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(restored?.value.advancedOpen || Boolean(deepLinkedTarget));
  const skipRestoredLoad = useRef(Boolean(restored && !deepLinkedTarget));

  const load = useCallback(async (append = false) => {
    setLoading(true); setError('');
    try {
      const result = await requestAdminAuditEventsPage(user, { ...filters, cursor: append ? pageInfo?.nextCursor || '' : '' });
      setEvents((current) => append ? [...current, ...result.items] : result.items);
      setPageInfo(result.pageInfo);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر تحميل سجل التدقيق.');
    } finally { setLoading(false); }
  }, [filters, pageInfo?.nextCursor, user]);

  useEffect(() => {
    void Promise.all([
      requestAdminAuditSummary(user).then(setSummary).catch(() => undefined),
      requestAdminAdministrators(user).then(setAdministrators).catch(() => undefined),
    ]);
  }, [user]);

  useEffect(() => {
    if (!deepLinkedEvent || selected?.id === deepLinkedEvent) return;
    let active = true;
    setDetailLoading(true);
    void requestAdminAuditDetail(user, deepLinkedEvent).then((result) => { if (active) { setDetail(result); setSelected(result.event); } }).catch((cause) => { if (active) notify('تعذّر فتح رابط حدث التدقيق', { description: cause instanceof Error ? cause.message : '', tone: 'error' }); }).finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [deepLinkedEvent, notify, selected?.id, user]);

  useEffect(() => { if (skipRestoredLoad.current) { skipRestoredLoad.current = false; return; } const timer = window.setTimeout(() => void load(false), 250); return () => window.clearTimeout(timer); }, [filters, user]);

  const routeSnapshot = useMemo(() => ({ advancedOpen, events, filters, pageInfo, summary }), [advancedOpen, events, filters, pageInfo, summary]);
  useAdminRouteSnapshot('audit', routeSnapshot, restored?.scrollY || 0);

  async function openDetail(event: AdminAuditEventRow) {
    setSelected(event); setDetail(undefined); setDetailLoading(true); setAdminQueryParameter('event', event.id);
    try { setDetail(await requestAdminAuditDetail(user, event.id)); }
    catch (cause) { notify('تعذّر فتح تفاصيل الحدث', { description: cause instanceof Error ? cause.message : '', tone: 'error' }); }
    finally { setDetailLoading(false); }
  }

  function closeDetail() { setSelected(undefined); setDetail(undefined); setAdminQueryParameter('event', ''); }

  async function exportCsv() {
    setExporting(true);
    try {
      const result = await requestAdminAuditExport(user, filters);
      const blob = new Blob([`\uFEFF${result.csv}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = result.filename; link.click(); URL.revokeObjectURL(url);
      notify('تم تجهيز ملف التدقيق', { description: `${result.count.toLocaleString('ar-IQ')} حدث${result.truncated ? ' — تم تطبيق الحد الآمن للتصدير' : ''}`, tone: 'success' });
    } catch (cause) { notify('تعذّر تصدير السجل', { description: cause instanceof Error ? cause.message : '', tone: 'error' }); }
    finally { setExporting(false); }
  }

  function update<K extends keyof AdminAuditFilters>(key: K, value: AdminAuditFilters[K]) { setFilters((current) => ({ ...current, [key]: value })); }
  const hasFilters = Object.values(filters).some(Boolean);

  return <div className="audit-workspace-page">
    <header className="audit-hero">
      <div><span>الحوكمة والأمان</span><h1>سجل التدقيق والمساءلة</h1><p>سلسلة زمنية موثّقة لكل إجراء إداري، من المنفّذ إلى الهدف والنتيجة.</p></div>
      <div className="audit-hero-actions"><button className="audit-export-button" disabled={exporting} onClick={() => void exportCsv()} type="button">{exporting ? 'جارٍ التصدير…' : '⇩ تصدير CSV'}</button><button className="audit-refresh-button" onClick={() => void load(false)} type="button">↻ تحديث</button></div>
    </header>

    <section className="audit-kpi-grid">
      <AuditKpi icon="◎" label="إجمالي الأحداث" value={summary?.total} meta="سجل غير قابل للتعديل" />
      <AuditKpi icon="◷" label="أحداث اليوم" value={summary?.today} meta={`${summary?.activeAdministrators ?? 0} مسؤول نشط`} />
      <AuditKpi icon="⚿" label="إجراءات أمنية" value={summary?.security} meta="ضمن آخر 500 حدث" tone="security" />
      <AuditKpi icon="!" label="نتائج فاشلة" value={summary?.failed} meta={`${summary?.retentionDays ?? 365} يومًا للاحتفاظ`} tone="danger" />
    </section>

    <section className="audit-surface">
      <div className="audit-filter-bar">
        <label className="audit-search-field"><span>⌕</span><input dir="auto" placeholder="بحث بالحدث، UID، Public ID، البلاغ أو الغرفة" value={filters.search || ''} onChange={(e) => update('search', e.target.value)} /></label>
        <select aria-label="المسؤول" value={filters.actorUid || ''} onChange={(e) => update('actorUid', e.target.value)}><option value="">كل المسؤولين</option>{administrators.map((admin) => <option key={admin.uid} value={admin.uid}>{admin.displayName || admin.email || admin.uid}</option>)}</select>
        <select aria-label="نوع الكيان" value={filters.entityType || ''} onChange={(e) => update('entityType', e.target.value as AdminAuditFilters['entityType'])}><option value="">كل الكيانات</option><option value="user">مستخدم</option><option value="room">غرفة</option><option value="report">بلاغ</option><option value="catalog">كتالوج</option><option value="economy">اقتصاد</option><option value="system">نظام</option></select>
        <button className={advancedOpen ? 'audit-filter-toggle active' : 'audit-filter-toggle'} onClick={() => setAdvancedOpen((value) => !value)} type="button">≡ فلاتر متقدمة</button>
        {hasFilters ? <button className="audit-clear-filter" onClick={() => setFilters(emptyFilters)} type="button">مسح الكل</button> : null}
      </div>

      {advancedOpen ? <div className="audit-advanced-filters">
        <label>الإجراء<input placeholder="مثل user-ban" value={filters.eventAction || ''} onChange={(e) => update('eventAction', e.target.value)} /></label>
        <label>الهدف<input dir="auto" placeholder="UID أو رقم الكيان" value={filters.target || ''} onChange={(e) => update('target', e.target.value)} /></label>
        <label>النتيجة<input placeholder="completed / failed" value={filters.status || ''} onChange={(e) => update('status', e.target.value)} /></label>
        <label>من تاريخ<input type="date" value={filters.createdFrom || ''} onChange={(e) => update('createdFrom', e.target.value)} /></label>
        <label>إلى تاريخ<input type="date" value={filters.createdTo || ''} onChange={(e) => update('createdTo', e.target.value)} /></label>
      </div> : null}

      <div className="audit-table-heading"><div><h2>التسلسل الزمني</h2><p>{events.length.toLocaleString('ar-IQ')} حدث ظاهر</p></div><span className={loading ? 'audit-data-state loading' : 'audit-data-state'}>{loading ? 'جارٍ التحديث' : 'متصل بالسجل'}</span></div>

      {error ? <div className="audit-load-state error"><strong>تعذّر تحميل السجل</strong><p>{error}</p><button onClick={() => void load(false)} type="button">إعادة المحاولة</button></div> : null}
      {loading && events.length === 0 ? <div className="audit-loading-rows">{[1,2,3,4,5].map((key) => <i key={key} />)}</div> : null}
      {!loading && !error && events.length === 0 ? <div className="audit-load-state"><span>◎</span><strong>لا توجد أحداث مطابقة</strong><p>غيّر عوامل البحث أو الفترة الزمنية.</p></div> : null}

      {events.length ? <div className="audit-professional-table-wrap"><table className="audit-professional-table"><thead><tr><th>الوقت</th><th>المسؤول</th><th>الإجراء</th><th>الكيان والهدف</th><th>النتيجة</th><th>المصدر</th><th /></tr></thead><tbody>{events.map((event) => <AuditRow event={event} key={event.id} onOpen={() => void openDetail(event)} />)}</tbody></table></div> : null}
      {pageInfo?.hasNextPage ? <div className="audit-load-more"><button disabled={loading} onClick={() => void load(true)} type="button">تحميل أحداث أقدم</button></div> : null}
    </section>

    {selected ? <AuditDrawer detail={detail} event={selected} loading={detailLoading} onClose={closeDetail} /> : null}
  </div>;
}

function AuditKpi({ icon, label, meta, tone = '', value }: { icon: string; label: string; meta: string; tone?: string; value?: number }) { return <article className={tone}><span>{icon}</span><div><small>{label}</small><strong>{value === undefined ? '—' : value.toLocaleString('ar-IQ')}</strong><p>{meta}</p></div></article>; }

function AuditRow({ event, onOpen }: { event: AdminAuditEventRow; onOpen: () => void }) {
  const link = entityLink(event);
  return <tr onDoubleClick={onOpen}><td data-label="الوقت"><time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time><small>{relativeTime(event.createdAt)}</small></td><td data-label="المسؤول"><strong>{event.actorEmail || 'مسؤول غير معروف'}</strong><small dir="ltr">{event.actorUid || '—'}</small></td><td data-label="الإجراء"><span className={`audit-action-icon entity-${event.entityType}`}>{entityIcon(event.entityType)}</span><strong>{actionLabel(event.action)}</strong><small dir="ltr">{event.action || event.kind}</small></td><td data-label="الهدف"><span>{entityLabel(event.entityType)}</span>{link ? <a href={link.href} onClick={(e) => e.stopPropagation()}>{link.label} ↗</a> : <small>بلا هدف محدد</small>}</td><td data-label="النتيجة"><AuditResult status={event.status} /></td><td data-label="المصدر"><span>{sourceLabel(event.source)}</span><small>{event.kind || '—'}</small></td><td><button aria-label="فتح تفاصيل الحدث" className="audit-open-button" onClick={onOpen} type="button">←</button></td></tr>;
}

function AuditDrawer({ detail, event, loading, onClose }: { detail?: AdminAuditDetail; event: AdminAuditEventRow; loading: boolean; onClose: () => void }) {
  const link = entityLink(event);
  const dialogRef = useAdminDialogFocus(true, onClose);
  return <div className="audit-drawer-layer"><button aria-label="إغلاق" className="audit-drawer-backdrop" onClick={onClose} type="button" /><aside aria-label="تفاصيل حدث التدقيق" aria-modal="true" className="audit-detail-drawer" ref={dialogRef} role="dialog" tabIndex={-1}><header><div><span>{entityLabel(event.entityType)} · حدث موثق</span><h2>{actionLabel(event.action)}</h2><p dir="ltr">{event.id}</p></div><button aria-label="إغلاق" onClick={onClose} type="button">×</button></header>
    <div className="audit-detail-body">
      <section className="audit-event-identity"><div className={`audit-event-seal entity-${event.entityType}`}>{entityIcon(event.entityType)}</div><div><AuditResult status={event.status} /><h3>{event.actorEmail || event.actorUid || 'مسؤول غير معروف'}</h3><p>{formatDateTime(event.createdAt)} · {sourceLabel(event.source)}</p></div></section>
      <section className="audit-detail-grid"><DetailCell label="المسؤول" value={event.actorUid || '—'} ltr /><DetailCell label="الهدف" value={event.entityId || event.targetUid || '—'} ltr /><DetailCell label="النوع" value={event.kind || event.entityType} /><DetailCell label="المصدر" value={event.source || 'admin-dashboard'} />{link ? <a className="audit-entity-link" href={link.href}>{link.label} — فتح السجل المرتبط ↗</a> : null}</section>
      {loading ? <div className="audit-detail-loading">جارٍ تحليل الحدث…</div> : null}
      {detail ? <>
        <section className="audit-change-section"><header><h3>ملخص التغيير</h3><span>قبل / بعد</span></header><div className="audit-change-columns"><AuditValue title="قبل" value={detail.before} empty="لا توجد حالة سابقة مسجلة" /><AuditValue title="بعد" value={detail.after} empty="لا توجد قيمة نهائية إضافية" /></div></section>
        {event.note ? <section className="audit-note-section"><span>الملاحظة أو السبب</span><p>{event.note}</p></section> : null}
        <details className="audit-metadata"><summary>البيانات التقنية المنقحة</summary><AuditValue title="Metadata" value={detail.metadata} empty="لا توجد بيانات إضافية" /></details>
        <section className="audit-policy"><span>⚿</span><div><strong>سياسة الحماية والاحتفاظ</strong><p>تُحجب الأسرار والرموز وكلمات المرور وأكواد الدعوة تلقائيًا. مدة الاحتفاظ المعلنة {detail.policy.retentionDays.toLocaleString('ar-IQ')} يومًا.</p></div></section>
      </> : null}
    </div>
  </aside></div>;
}

function AuditValue({ empty, title, value }: { empty: string; title: string; value: unknown }) {
  const entries = value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value as Record<string, unknown>) : [];
  return <div className="audit-value-card"><h4>{title}</h4>{entries.length ? <dl>{entries.map(([key, item]) => <div key={key}><dt>{fieldLabel(key)}</dt><dd dir={shouldUseLtr(item) ? 'ltr' : 'auto'}>{formatAuditValue(item)}</dd></div>)}</dl> : <p>{empty}</p>}</div>;
}
function DetailCell({ label, ltr = false, value }: { label: string; ltr?: boolean; value: string }) { return <div><small>{label}</small><strong dir={ltr ? 'ltr' : 'auto'}>{value}</strong></div>; }
function AuditResult({ status }: { status: string }) { const normalized = status.toLowerCase(); const tone = ['failed','error','denied','rejected'].includes(normalized) ? 'failed' : ['pending','open','triage'].includes(normalized) ? 'pending' : 'completed'; return <span className={`audit-result result-${tone}`}><i />{tone === 'failed' ? 'فشل' : tone === 'pending' ? 'قيد المتابعة' : 'مكتمل'}</span>; }
function entityLink(event: AdminAuditEventRow) { const id = encodeURIComponent(event.entityId); if (!event.entityId) return null; if (event.entityType === 'user') return { href: `/users?user=${id}`, label: event.publicId || event.entityId }; if (event.entityType === 'room') return { href: `/rooms?room=${id}`, label: event.entityId }; if (event.entityType === 'report') return { href: `/reports?report=${id}`, label: event.entityId }; if (event.entityType === 'catalog') return { href: `/store?item=${id}`, label: event.entityId }; return null; }
function entityLabel(type: AdminAuditEventRow['entityType']) { return ({ catalog: 'كتالوج', economy: 'اقتصاد', report: 'بلاغ', room: 'غرفة', system: 'نظام', user: 'مستخدم' } as const)[type]; }
function entityIcon(type: AdminAuditEventRow['entityType']) { return ({ catalog: '◇', economy: '↔', report: '⚑', room: '▣', system: '⚙', user: '♙' } as const)[type]; }
function actionLabel(action: string) { const labels: Record<string,string> = { 'report-resolve': 'حل بلاغ', 'report-assign': 'إسناد بلاغ', 'report-triage': 'نقل للمراجعة', 'room-close-room': 'إغلاق غرفة', 'room-reopen-room': 'إعادة فتح غرفة', 'user-ban': 'حظر مستخدم', 'user-unban': 'رفع الحظر', 'user-suspend': 'تعليق مستخدم', 'user-mute': 'كتم مستخدم', 'wallet-credit': 'إضافة رصيد', 'wallet-debit': 'خصم رصيد', 'store-catalog-upsert': 'تحديث الكتالوج', 'gift-catalog-upsert': 'تحديث هدية', 'special-id-upsert': 'تحديث رقم مميز' }; return labels[action] || action.replaceAll('-', ' ') || 'حدث إداري'; }
function sourceLabel(source: string) { return source === 'admin-dashboard' || !source ? 'لوحة الإدارة' : source; }
function fieldLabel(field: string) { const labels: Record<string,string> = { amount: 'القيمة', assignedTo: 'المسند إليه', availability: 'التوفر', category: 'القسم', currency: 'العملة', durationHours: 'المدة بالساعات', featured: 'العنصر المميّز', price: 'السعر', purchasingEnabled: 'السماح بالشراء', scoreValue: 'قيمة النقاط', status: 'الحالة', transactionId: 'رقم الحركة' }; return labels[field] || field; }
function formatAuditValue(value: unknown): string { if (value === null || value === undefined || value === '') return '—'; if (typeof value === 'boolean') return value ? 'نعم' : 'لا'; if (typeof value === 'object') return JSON.stringify(value); return String(value); }
function shouldUseLtr(value: unknown) { return typeof value === 'number' || (typeof value === 'string' && /^[A-Za-z0-9_./:@-]+$/.test(value)); }
function formatDateTime(value: string) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function relativeTime(value: string) { const delta = Date.now() - Date.parse(value); if (!Number.isFinite(delta)) return '—'; const minutes = Math.max(0, Math.floor(delta / 60000)); if (minutes < 1) return 'الآن'; if (minutes < 60) return `منذ ${minutes.toLocaleString('ar-IQ')} دقيقة`; const hours = Math.floor(minutes / 60); if (hours < 24) return `منذ ${hours.toLocaleString('ar-IQ')} ساعة`; return `منذ ${Math.floor(hours / 24).toLocaleString('ar-IQ')} يوم`; }
