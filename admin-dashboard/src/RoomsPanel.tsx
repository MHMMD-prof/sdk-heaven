import { User } from 'firebase/auth';
import { getDownloadURL, ref } from 'firebase/storage';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAdminFeedback } from './AdminFeedback';
import { AdminCollectionState, AdminSectionHeader, AdminStatusBadge, AdminSurface } from './AdminUi';
import { firebaseStorage } from './firebase';
import { useAdminDialogFocus } from './useAdminDialogFocus';
import { readAdminRouteSnapshot, useAdminRouteSnapshot } from './adminRouteState';
import { readAdminQueryParameter, setAdminQueryParameter } from './adminDeepLinks';
import {
  AdminDashboardRequestError,
  AdminPageInfo,
  AdminRoomAction,
  AdminRoomDetail,
  AdminRoomFilters,
  AdminRoomMedia,
  AdminRoomMediaAction,
  AdminRoomMember,
  AdminRoomRow,
  AdminRoomSummary,
  executeAdminRoomAction,
  executeAdminRoomMediaAction,
  requestAdminRoomDetail,
  requestAdminRoomsPage,
  requestAdminRoomSummary,
} from './adminDashboardApi';

type RoomQueueState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; items: AdminRoomRow[]; pageInfo: AdminPageInfo };
type RoomTab = 'overview' | 'participants' | 'reports' | 'media' | 'game' | 'activity';
const emptySummary: AdminRoomSummary = { active: 0, flagged: 0, games: 0, participants: 0, privateRooms: 0, sampled: false, total: 0 };

export function RoomsPanel({ user }: { user: User }) {
  const { notify } = useAdminFeedback();
  const deepLinkedRoomId = readAdminQueryParameter(window.location.search, 'room');
  const restored = useRef(readAdminRouteSnapshot<{ filters: AdminRoomFilters; queue: RoomQueueState; searchDraft: string; summary: AdminRoomSummary }>('rooms')).current;
  const [filters, setFilters] = useState<AdminRoomFilters>(restored?.value.filters || { status: 'active' });
  const [searchDraft, setSearchDraft] = useState(restored?.value.searchDraft || '');
  const [queue, setQueue] = useState<RoomQueueState>(restored?.value.queue?.status === 'ready' ? restored.value.queue : { status: 'loading' });
  const [summary, setSummary] = useState(restored?.value.summary || emptySummary);
  const [selectedRoomId, setSelectedRoomId] = useState(deepLinkedRoomId);
  const version = useRef(0);
  const skipRestoredLoad = useRef(restored?.value.queue?.status === 'ready');

  const loadRooms = useCallback(async (append = false, cursor = '') => {
    const currentVersion = ++version.current;
    if (!append) setQueue({ status: 'loading' });
    try {
      const page = await requestAdminRoomsPage(user, { ...filters, cursor });
      if (currentVersion !== version.current) return;
      setQueue((current) => ({ status: 'ready', items: append && current.status === 'ready' ? [...current.items, ...page.items] : page.items, pageInfo: page.pageInfo }));
    } catch (error) {
      if (currentVersion !== version.current) return;
      setQueue({ status: 'error', message: error instanceof Error ? error.message : 'تعذّر تحميل الغرف.' });
    }
  }, [filters, user]);

  const loadSummary = useCallback(async () => {
    try { setSummary(await requestAdminRoomSummary(user)); }
    catch (error) { notify('تعذّر تحديث مؤشرات الغرف', { description: error instanceof Error ? error.message : undefined, tone: 'error' }); }
  }, [notify, user]);

  useEffect(() => { if (skipRestoredLoad.current) { skipRestoredLoad.current = false; return; } void loadRooms(); }, [loadRooms]);
  useEffect(() => { void loadSummary(); }, [loadSummary]);

  function updateFilter<K extends keyof AdminRoomFilters>(key: K, value: AdminRoomFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, cursor: '' }));
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    updateFilter('search', searchDraft.trim());
  }

  const rows = queue.status === 'ready' ? queue.items : [];
  const routeSnapshot = useMemo(() => ({ filters, queue, searchDraft, summary }), [filters, queue, searchDraft, summary]);
  useAdminRouteSnapshot('rooms', routeSnapshot, restored?.scrollY || 0);
  function openRoom(roomId: string) { setSelectedRoomId(roomId); setAdminQueryParameter('room', roomId); }
  function closeRoom() { setSelectedRoomId(''); setAdminQueryParameter('room', ''); }
  return <div className="rooms-workspace">
    <AdminSectionHeader actions={<button className="secondary-button compact" onClick={() => void Promise.all([loadRooms(), loadSummary()])} type="button">تحديث مباشر</button>} description="راقب الغرف والمشاركين والبلاغات وحالة الألعاب، ونفّذ إجراءات الإشراف من سياق تشغيلي واحد." eyebrow="المجتمع المباشر" title="مركز عمليات الغرف" />
    <RoomKpis summary={summary} />
    <AdminSurface className="room-directory-surface">
      <form className="room-filter-bar" onSubmit={submitSearch}>
        <label className="room-search"><span aria-hidden="true">⌕</span><input aria-label="البحث في الغرف" onChange={(event) => setSearchDraft(event.target.value)} placeholder="اسم الغرفة، المعرّف، المضيف أو اللعبة…" value={searchDraft} /></label>
        <select aria-label="حالة الغرفة" onChange={(event) => updateFilter('status', event.target.value as AdminRoomFilters['status'])} value={filters.status}><option value="active">نشطة</option><option value="closed">مغلقة</option><option value="all">كل الحالات</option></select>
        <select aria-label="نوع الغرفة" onChange={(event) => updateFilter('type', event.target.value as AdminRoomFilters['type'])} value={filters.type || ''}><option value="">كل الأنواع</option><option value="voice">صوتية</option><option value="game">ألعاب</option></select>
        <select aria-label="خصوصية الغرفة" onChange={(event) => updateFilter('visibility', event.target.value as AdminRoomFilters['visibility'])} value={filters.visibility || ''}><option value="">كل الخصوصية</option><option value="public">عامة</option><option value="private">خاصة</option></select>
        <button className="primary-button compact" type="submit">بحث</button>
      </form>
      <div className="room-advanced-filters">
        <span>تصفية إضافية</span>
        <select aria-label="كثافة الحضور" onChange={(event) => updateFilter('capacity', event.target.value as AdminRoomFilters['capacity'])} value={filters.capacity || ''}><option value="">كل أحجام الحضور</option><option value="quiet">هادئة (0–4)</option><option value="busy">نشطة (5–19)</option><option value="crowded">مزدحمة (20+)</option></select>
        <input aria-label="رمز دولة الغرفة" maxLength={2} onChange={(event) => updateFilter('countryCode', event.target.value.toUpperCase())} placeholder="الدولة" value={filters.countryCode || ''} />
        <input aria-label="مضيف الغرفة" onChange={(event) => updateFilter('host', event.target.value)} placeholder="المضيف" value={filters.host || ''} />
      </div>
      <AdminCollectionState empty={queue.status === 'ready' && rows.length === 0} emptyMessage="لا توجد غرف مطابقة" error={queue.status === 'error' ? queue.message : undefined} loading={queue.status === 'loading'} loadingMessage="جارٍ تجهيز غرفة العمليات…" onRetry={() => void loadRooms()}>
        {queue.status === 'ready' ? <>
          <div className="room-table-wrap"><table className="room-directory-table"><thead><tr><th>الغرفة</th><th>الحالة</th><th>المضيف</th><th>الحضور</th><th>الخصوصية</th><th>البلاغات</th><th>آخر نشاط</th><th /></tr></thead><tbody>{rows.map((room) => <RoomTableRow key={room.id} onOpen={() => openRoom(room.id)} room={room} />)}</tbody></table></div>
          <div className="room-mobile-list">{rows.map((room) => <RoomMobileCard key={room.id} onOpen={() => openRoom(room.id)} room={room} />)}</div>
          {queue.pageInfo.hasNextPage && queue.pageInfo.nextCursor ? <button className="report-load-more secondary-button" onClick={() => void loadRooms(true, queue.pageInfo.nextCursor || '')} type="button">تحميل المزيد من الغرف</button> : null}
        </> : null}
      </AdminCollectionState>
    </AdminSurface>
    {selectedRoomId ? <RoomDrawer onChanged={() => Promise.all([loadRooms(), loadSummary()]).then(() => undefined)} onClose={closeRoom} roomId={selectedRoomId} user={user} /> : null}
  </div>;
}


function RoomKpis({ summary }: { summary: AdminRoomSummary }) {
  const items = [
    { detail: 'غرفة متاحة الآن', label: 'الغرف النشطة', tone: 'gold', value: summary.active },
    { detail: 'عبر الغرف النشطة', label: 'الحضور المباشر', tone: 'green', value: summary.participants },
    { detail: `${summary.games.toLocaleString('ar-IQ')} غرفة ألعاب`, label: 'غرف خاصة', tone: 'purple', value: summary.privateRooms },
    { detail: 'تحتاج متابعة إدارية', label: 'غرف عليها بلاغات', tone: 'red', value: summary.flagged },
  ];
  return <div className="room-kpi-grid">{items.map((item) => <article className={`room-kpi tone-${item.tone}`} key={item.label}><span className="room-kpi-icon" /><div><small>{item.label}</small><strong>{item.value.toLocaleString('ar-IQ')}</strong><p>{item.detail}</p></div></article>)}</div>;
}

function RoomTableRow({ onOpen, room }: { onOpen: () => void; room: AdminRoomRow }) {
  return <tr onDoubleClick={onOpen}><td><button className="room-identity-cell" onClick={onOpen} type="button"><RoomGlyph type={room.type} /><span><strong>{room.title || 'غرفة بلا اسم'}</strong><small dir="ltr">{room.id}</small></span></button></td><td><RoomStatus room={room} /></td><td><span>{room.hostDisplayName || 'مضيف غير معروف'}</span><small dir="ltr">{room.hostId}</small></td><td><strong className="room-count">{room.participantCount.toLocaleString('ar-IQ')}</strong><small>{capacityLabel(room.participantCount)}</small></td><td><span>{room.visibility === 'private' ? 'خاصة' : 'عامة'}</span><small>{room.countryCode || 'بلا دولة'}</small></td><td>{room.openReportCount ? <AdminStatusBadge tone="danger">{room.openReportCount.toLocaleString('ar-IQ')} مفتوح</AdminStatusBadge> : <AdminStatusBadge tone="success">سليمة</AdminStatusBadge>}</td><td><time dateTime={room.updatedAt}>{relativeTime(room.updatedAt)}</time></td><td><button aria-label={`فتح غرفة ${room.title || room.id}`} className="report-open-button" onClick={onOpen} type="button">←</button></td></tr>;
}

function RoomMobileCard({ onOpen, room }: { onOpen: () => void; room: AdminRoomRow }) { return <button className="room-mobile-card" onClick={onOpen} type="button"><RoomGlyph type={room.type} /><span><strong>{room.title || room.id}</strong><small>{room.participantCount.toLocaleString('ar-IQ')} حاضر · {room.hostDisplayName}</small></span><RoomStatus room={room} /><b>←</b></button>; }

function RoomDrawer({ onChanged, onClose, roomId, user }: { onChanged: () => Promise<void>; onClose: () => void; roomId: string; user: User }) {
  const { confirm, notify } = useAdminFeedback();
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; detail: AdminRoomDetail }>({ status: 'loading' });
  const [tab, setTab] = useState<RoomTab>('overview');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useAdminDialogFocus(true, onClose, '.room-drawer');

  const loadDetail = useCallback(async () => {
    setState({ status: 'loading' });
    try { setState({ status: 'ready', detail: await requestAdminRoomDetail(user, roomId) }); }
    catch (error) { setState({ status: 'error', message: error instanceof Error ? error.message : 'تعذّر تحميل الغرفة.' }); }
  }, [roomId, user]);
  useEffect(() => { void loadDetail(); }, [loadDetail]);

  async function runAction(roomAction: AdminRoomAction, target?: AdminRoomMember) {
    if (state.status !== 'ready') return;
    if (reason.trim().length < 2) { notify('اكتب سبباً واضحاً للإجراء', { tone: 'error' }); return; }
    const destructive = ['close-room', 'kick-everyone', 'remove-member', 'staff-lockdown', 'transfer-host'].includes(roomAction);
    const approved = await confirm({ confirmLabel: roomActionLabel(roomAction), description: `${target ? `سيُطبق على ${target.displayName || target.uid} داخل الغرفة.` : `سيُطبق على غرفة «${state.detail.room.title || roomId}».`} السبب: ${reason.trim()}`, destructive, title: `${roomActionLabel(roomAction)}؟` });
    if (!approved) return;
    setBusy(true);
    try {
      await executeAdminRoomAction(user, { expectedUpdatedAt: state.detail.room.updatedAt, reason: reason.trim(), roomAction, roomId, targetUid: target?.uid });
      setReason('');
      notify('تم تحديث الغرفة', { description: roomActionLabel(roomAction), tone: 'success' });
      await Promise.all([loadDetail(), onChanged()]);
    } catch (error) {
      const conflict = error instanceof AdminDashboardRequestError && error.status === 409;
      notify(conflict ? 'تغيرت الغرفة أثناء المراجعة' : 'تعذّر تنفيذ الإجراء', { description: error instanceof Error ? error.message : undefined, tone: 'error' });
      if (conflict) await loadDetail();
    } finally { setBusy(false); }
  }

  async function runMediaAction(mediaAction: AdminRoomMediaAction, media?: AdminRoomMedia) {
    if (state.status !== 'ready') return;
    const requiresReason = mediaAction === 'reject-room-image' || mediaAction === 'remove-room-image';
    if (requiresReason && reason.trim().length < 4) {
      notify('اكتب سبباً واضحاً من أربعة أحرف على الأقل', { tone: 'error' });
      return;
    }
    const approved = await confirm({
      confirmLabel: roomMediaActionLabel(mediaAction),
      description: `${media ? `ستتم مراجعة الصورة ${media.id}.` : 'سيُعاد السماح للمالك بتخصيص الغرفة.'}${requiresReason ? ` السبب: ${reason.trim()}` : ''}`,
      destructive: requiresReason,
      title: `${roomMediaActionLabel(mediaAction)}؟`,
    });
    if (!approved) return;
    setBusy(true);
    try {
      await executeAdminRoomMediaAction(user, {
        action: mediaAction,
        expectedRevision: state.detail.room.revision,
        mediaId: media?.id,
        reason: reason.trim(),
        roomId,
        suspendCustomization: mediaAction === 'remove-room-image',
      });
      setReason('');
      notify('تم تحديث صورة الغرفة', { description: roomMediaActionLabel(mediaAction), tone: 'success' });
      await Promise.all([loadDetail(), onChanged()]);
    } catch (error) {
      const conflict = error instanceof AdminDashboardRequestError && error.status === 409;
      notify(conflict ? 'تغيرت الغرفة أثناء مراجعة الصورة' : 'تعذّر تنفيذ إجراء الصورة', {
        description: error instanceof Error ? error.message : undefined,
        tone: 'error',
      });
      if (conflict) await loadDetail();
    } finally {
      setBusy(false);
    }
  }

  return <div className="room-drawer-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><aside aria-label="تفاصيل الغرفة" aria-modal="true" className="room-drawer" role="dialog"><header className="room-drawer-header"><div><p className="eyebrow">مراقبة مباشرة</p><h3>ملف الغرفة التشغيلي</h3><small dir="ltr">{roomId}</small></div><button aria-label="إغلاق تفاصيل الغرفة" onClick={onClose} type="button">×</button></header>{state.status === 'loading' ? <div className="room-drawer-state"><span className="state-spinner" /> جارٍ تحميل الغرفة…</div> : null}{state.status === 'error' ? <div className="room-drawer-state error"><strong>تعذّر فتح الغرفة</strong><p>{state.message}</p><button className="secondary-button compact" onClick={() => void loadDetail()} type="button">إعادة المحاولة</button></div> : null}{state.status === 'ready' ? <div className="room-drawer-body"><RoomDrawerIdentity detail={state.detail} /><section className="room-command-bar"><input onChange={(event) => setReason(event.target.value)} placeholder="سبب الإجراء الإشرافي (إلزامي للإجراءات العقابية)" value={reason} />{state.detail.room.status === 'active' ? <button className="danger-button compact" disabled={busy} onClick={() => void runAction('close-room')} type="button">إغلاق الغرفة</button> : <button className="secondary-button compact" disabled={busy} onClick={() => void runAction('reopen-room')} type="button">إعادة فتح الغرفة</button>}{state.detail.room.status === 'active' ? <><button className="danger-button compact" disabled={busy} onClick={() => void runAction('staff-lockdown')} type="button">إغلاق طارئ للطاقم</button><button className="danger-button compact" disabled={busy} onClick={() => void runAction('kick-everyone')} type="button">طرد الجميع وإغلاق الغرفة</button></> : null}<button className="secondary-button compact" disabled={busy} onClick={() => void runAction('clear-staff-lockdown')} type="button">رفع إغلاق الطاقم</button></section><nav className="room-drawer-tabs" aria-label="أقسام الغرفة">{(['overview', 'participants', 'reports', 'media', 'game', 'activity'] as RoomTab[]).map((item) => <button className={tab === item ? 'selected' : ''} key={item} onClick={() => setTab(item)} type="button">{roomTabLabel(item)}</button>)}</nav><div className="room-tab-content">{tab === 'overview' ? <RoomOverview detail={state.detail} /> : tab === 'participants' ? <ParticipantsTab busy={busy} detail={state.detail} onAction={runAction} /> : tab === 'reports' ? <RoomReports detail={state.detail} /> : tab === 'media' ? <RoomMediaTab busy={busy} detail={state.detail} onAction={runMediaAction} /> : tab === 'game' ? <RoomGame detail={state.detail} /> : <RoomActivity detail={state.detail} />}</div></div> : null}</aside></div>;
}

function RoomDrawerIdentity({ detail }: { detail: AdminRoomDetail }) { const room = detail.room; return <section className="room-drawer-identity"><RoomGlyph large type={room.type} /><div><div className="room-identity-badges"><RoomStatus room={room} />{room.openReportCount ? <AdminStatusBadge tone="danger">{room.openReportCount.toLocaleString('ar-IQ')} بلاغ</AdminStatusBadge> : null}</div><h4>{room.title || room.id}</h4><p>{room.hostDisplayName || 'مضيف غير معروف'} · {room.participantCount.toLocaleString('ar-IQ')} حاضر</p><small>{room.visibility === 'private' ? 'غرفة خاصة' : 'غرفة عامة'} · {room.countryCode || 'بلا دولة'} · {room.type === 'game' ? 'ألعاب' : 'صوتية'}</small></div></section>; }

function RoomOverview({ detail }: { detail: AdminRoomDetail }) { const room = detail.room; return <div className="room-detail-grid"><RoomDetailCard title="الحالة المباشرة" rows={[['الحضور المتصل', detail.metrics.online.toLocaleString('ar-IQ')], ['العضويات النشطة', detail.metrics.activeMembers.toLocaleString('ar-IQ')], ['المتحدثون', detail.metrics.speakers.toLocaleString('ar-IQ')], ['المستمعون', detail.metrics.listeners.toLocaleString('ar-IQ')]]} /><RoomDetailCard title="هوية الغرفة" rows={[['المعرّف', room.id], ['المضيف', room.hostDisplayName || room.hostId], ['النوع', room.type === 'game' ? 'ألعاب' : 'صوتية'], ['الدولة', room.countryCode || '—']]} /><RoomDetailCard title="السلامة" rows={[['البلاغات المفتوحة', room.openReportCount.toLocaleString('ar-IQ')], ['أحداث الإشراف', detail.moderation.length.toLocaleString('ar-IQ')], ['آخر تحديث', formatDateTime(room.updatedAt)], ['تاريخ الإنشاء', formatDateTime(room.createdAt)]]} /><RoomDetailCard title="الجلسة" rows={[['الخصوصية', room.visibility === 'private' ? 'خاصة' : 'عامة'], ['اللعبة', room.currentGameId || 'لا توجد'], ['الحالة', room.status === 'active' ? 'نشطة' : 'مغلقة'], ['عمر الغرفة', relativeTime(room.createdAt)]]} /></div>; }

function ParticipantsTab({ busy, detail, onAction }: { busy: boolean; detail: AdminRoomDetail; onAction: (action: AdminRoomAction, member: AdminRoomMember) => Promise<void> }) { return <div className="room-participant-list">{detail.members.map((member) => <article className={member.status !== 'active' ? 'inactive' : ''} key={member.uid}><span className="participant-avatar">{member.avatarLabel || member.displayName.slice(0, 1) || '؟'}</span><div><strong>{member.displayName || 'عضو بلا اسم'}</strong><small dir="ltr">{member.publicId ? `#${member.publicId}` : member.uid}</small><p>{roleLabel(member.role)} · {member.online ? 'متصل الآن' : relativeTime(member.lastSeenAt)}{member.muted ? ' · مكتوم' : ''}</p></div><div className="participant-actions">{member.uid !== detail.room.hostId && member.status === 'active' ? <>{member.muted ? <button disabled={busy} onClick={() => void onAction('unmute-member', member)} type="button">رفع الكتم</button> : <button disabled={busy} onClick={() => void onAction('mute-member', member)} type="button">كتم</button>}<button disabled={busy} onClick={() => void onAction('transfer-host', member)} type="button">نقل الاستضافة</button><button className="danger" disabled={busy} onClick={() => void onAction('remove-member', member)} type="button">إزالة</button></> : <AdminStatusBadge tone={member.uid === detail.room.hostId ? 'info' : 'neutral'}>{member.uid === detail.room.hostId ? 'المضيف' : 'مزال'}</AdminStatusBadge>}</div></article>)}{detail.members.length === 0 ? <p className="room-empty-copy">لا توجد عضويات مسجلة.</p> : null}</div>; }

function RoomReports({ detail }: { detail: AdminRoomDetail }) { return <div className="room-report-list">{detail.reports.map((report) => <article key={report.id}><AdminStatusBadge tone={report.status === 'resolved' ? 'success' : report.severity === 'critical' || report.severity === 'high' ? 'danger' : 'warning'}>{report.status === 'resolved' ? 'محلول' : report.severity}</AdminStatusBadge><div><strong>{report.reason || 'بلاغ بلا وصف'}</strong><p>{report.targetPublicId ? `المستخدم #${report.targetPublicId}` : report.targetUid || 'هدف غير محدد'}</p><small>{formatDateTime(report.updatedAt)}</small></div></article>)}{detail.reports.length === 0 ? <p className="room-empty-copy">لا توجد بلاغات مرتبطة بهذه الغرفة.</p> : null}</div>; }
function RoomMediaTab({ busy, detail, onAction }: { busy: boolean; detail: AdminRoomDetail; onAction: (action: AdminRoomMediaAction, media?: AdminRoomMedia) => Promise<void> }) {
  return <div className="room-media-review">
    <header>
      <div><h4>مراجعة صور الغرفة</h4><p>لا تصبح الصورة مرئية للأعضاء قبل موافقة فريق العمليات.</p></div>
      {detail.room.roomCustomizationSuspended ? <button className="secondary-button compact" disabled={busy} onClick={() => void onAction('restore-room-customization')} type="button">إعادة التخصيص للمالك</button> : null}
    </header>
    {detail.room.roomCustomizationSuspended ? <div className="room-media-suspension">تخصيص الغرفة موقوف حالياً بقرار إشرافي.</div> : null}
    <div className="room-media-list">{detail.media.map((media) => <article key={media.id}>
      <RoomMediaPreview media={media} />
      <div className="room-media-copy">
        <div><AdminStatusBadge tone={media.status === 'approved' ? 'success' : media.status === 'pending' ? 'warning' : media.status === 'removed' ? 'danger' : 'neutral'}>{roomMediaStatusLabel(media.status)}</AdminStatusBadge><small>{media.width}×{media.height} · {formatBytes(media.bytes)}</small></div>
        <strong dir="ltr">{media.id}</strong>
        <p>{media.moderationReason || `رُفعت بواسطة ${media.ownerUid}`}</p>
        <small>{formatDateTime(media.updatedAt || media.createdAt)}</small>
      </div>
      <div className="room-media-actions">
        {media.status === 'pending' ? <><button className="primary-button compact" disabled={busy} onClick={() => void onAction('approve-room-image', media)} type="button">موافقة</button><button className="danger-button compact" disabled={busy} onClick={() => void onAction('reject-room-image', media)} type="button">رفض</button></> : null}
        {media.status === 'approved' && detail.room.activeRoomImageId === media.id ? <button className="danger-button compact" disabled={busy} onClick={() => void onAction('remove-room-image', media)} type="button">إزالة وإيقاف التخصيص</button> : null}
      </div>
    </article>)}</div>
    {detail.media.length === 0 ? <p className="room-empty-copy">لا توجد صور مرفوعة لهذه الغرفة.</p> : null}
  </div>;
}
function RoomMediaPreview({ media }: { media: AdminRoomMedia }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setUrl('');
    setFailed(false);
    void getDownloadURL(ref(firebaseStorage, media.path)).then((value) => {
      if (active) setUrl(value);
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => { active = false; };
  }, [media.path]);
  return <div className="room-media-preview">{url ? <img alt="صورة الغرفة قيد المراجعة" src={url} /> : <span>{failed ? 'تعذّر تحميل المعاينة' : 'جارٍ تحميل المعاينة…'}</span>}</div>;
}
function RoomGame({ detail }: { detail: AdminRoomDetail }) { return <section className="room-game-card"><RoomGlyph large type="game" /><div><p className="eyebrow">حالة اللعبة</p><h4>{detail.game.currentGameId || 'لا توجد لعبة نشطة'}</h4><p>{detail.game.currentGameId ? 'الغرفة مهيأة لتشغيل هذه اللعبة. حالة الجولة نفسها تُدار داخل جلسة اللعب المباشرة.' : 'هذه الغرفة لا تحمل معرّف لعبة حالياً.'}</p></div></section>; }
function RoomActivity({ detail }: { detail: AdminRoomDetail }) { return <ol className="room-timeline">{detail.moderation.map((event) => <li key={event.id}><span /><div><strong>{roomActionLabel(event.action as AdminRoomAction)}</strong><p>{event.reason || 'إجراء إشرافي'}</p><small>{event.actorEmail || event.actorUid || 'مشرف'} · {event.targetUid || detail.room.id} · {formatDateTime(event.createdAt)}</small></div></li>)}</ol>; }
function RoomDetailCard({ rows, title }: { rows: Array<[string, string]>; title: string }) { return <section className="room-detail-card"><h4>{title}</h4><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}</dl></section>; }
function RoomGlyph({ large = false, type }: { large?: boolean; type: string }) { return <span className={`room-glyph ${type === 'game' ? 'game' : 'voice'}${large ? ' large' : ''}`} aria-hidden="true">{type === 'game' ? '◇' : '◉'}</span>; }
function RoomStatus({ room }: { room: AdminRoomRow }) { if (room.status === 'closed') return <AdminStatusBadge tone="neutral">مغلقة</AdminStatusBadge>; if (room.openReportCount) return <AdminStatusBadge tone="danger">تحتاج متابعة</AdminStatusBadge>; const idle = room.updatedAt && Date.now() - Date.parse(room.updatedAt) > 30 * 60 * 1000; return <AdminStatusBadge tone={idle ? 'warning' : 'success'}>{idle ? 'خاملة' : 'سليمة'}</AdminStatusBadge>; }
function roomTabLabel(tab: RoomTab) { return ({ activity: 'سجل الإشراف', game: 'اللعبة', media: 'الصور', overview: 'نظرة عامة', participants: 'المشاركون', reports: 'البلاغات' } as Record<RoomTab, string>)[tab]; }
function roomActionLabel(action: AdminRoomAction | string) { return ({ 'clear-staff-lockdown': 'رفع إغلاق الطاقم', 'close-room': 'إغلاق الغرفة', 'kick-everyone': 'طرد الجميع وإغلاق الغرفة', 'mute-member': 'كتم المشارك', 'remove-member': 'إزالة المشارك', 'reopen-room': 'إعادة فتح الغرفة', 'staff-lockdown': 'إغلاق طارئ للطاقم', 'transfer-host': 'نقل الاستضافة', 'unmute-member': 'رفع كتم المشارك' } as Record<string, string>)[action] || action || 'إجراء إشرافي'; }
function roomMediaActionLabel(action: AdminRoomMediaAction) { return ({ 'approve-room-image': 'الموافقة على الصورة', 'reject-room-image': 'رفض الصورة', 'remove-room-image': 'إزالة الصورة وإيقاف التخصيص', 'restore-room-customization': 'إعادة تخصيص الغرفة' } as Record<AdminRoomMediaAction, string>)[action]; }
function roomMediaStatusLabel(status: string) { return ({ approved: 'معتمدة', pending: 'بانتظار المراجعة', rejected: 'مرفوضة', removed: 'مُزالة', superseded: 'استُبدلت' } as Record<string, string>)[status] || status; }
function formatBytes(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} م.ب` : `${Math.max(0, Math.round(bytes / 1024))} ك.ب`; }
function roleLabel(role: string) { return role === 'host' ? 'مضيف' : role === 'speaker' ? 'متحدث' : 'مستمع'; }
function capacityLabel(count: number) { return count >= 20 ? 'مزدحمة' : count >= 5 ? 'نشطة' : 'هادئة'; }
function relativeTime(value: string) { if (!value) return 'غير معروف'; const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000)); if (minutes < 60) return `منذ ${minutes.toLocaleString('ar-IQ')} د`; const hours = Math.floor(minutes / 60); if (hours < 24) return `منذ ${hours.toLocaleString('ar-IQ')} س`; return `منذ ${Math.floor(hours / 24).toLocaleString('ar-IQ')} ي`; }
function formatDateTime(value: string) { if (!value) return 'غير متاح'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'غير متاح' : new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
