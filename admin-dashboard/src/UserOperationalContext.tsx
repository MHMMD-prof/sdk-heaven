import { AdminStatusBadge } from './AdminUi';
import {
  AdminReportRow,
  AdminUserDetail,
  AdminUserGiftContext,
  AdminUserRelationshipContext,
} from './adminDashboardApi';
import { useAdminUserHistory } from './useAdminUserHistory';
import './UserOperationalContext.css';

type ContextSection = 'moderation' | 'economy' | 'social';

export default function UserOperationalContext({ detail, onOpenUser, section }: { detail: AdminUserDetail; onOpenUser?: (uid: string) => void; section: ContextSection }) {
  if (section === 'moderation') return <SafetyAndRoomContext detail={detail} />;
  if (section === 'economy') return <StoreAndTransferContext detail={detail} />;
  return <SocialNetworkContext detail={detail} onOpenUser={onOpenUser} />;
}

function SafetyAndRoomContext({ detail }: { detail: AdminUserDetail }) {
  const { directChat, reports, rooms } = detail.context;
  const reportHistory = useAdminUserHistory({ initialItems: reports.items, mayHaveMore: reports.sampled, section: 'reports', targetUid: detail.profile.uid });
  const roomHistory = useAdminUserHistory({ initialItems: rooms.items, mayHaveMore: rooms.sampled, section: 'rooms', targetUid: detail.profile.uid });
  const moderationHistory = useAdminUserHistory({ initialItems: rooms.moderation, mayHaveMore: rooms.moderation.length >= detail.context.limits.perSection, section: 'room-moderation', targetUid: detail.profile.uid });
  const restriction = directChat.restriction;
  return <div className="user-context-stack">
    <section className="user-context-surface safety-context">
      <ContextHeading eyebrow="الرسائل المباشرة" title="قيد المحادثات الخاصة" />
      <ContextError message={detail.context.errors.directChat} />
      {restriction ? (
        <div className="context-list">
          <div className="context-row">
            <span className={`context-row-icon ${restriction.active ? 'danger' : 'neutral'}`}>!</span>
            <div>
              <strong>{restriction.active ? 'مقيّد حالياً' : restriction.state === 'cleared' ? 'رُفع القيد' : restriction.state}</strong>
              <small>{restriction.reason || 'دون سبب'} · المنفّذ {restriction.actorUid || '—'} · يبدأ {formatDateTime(restriction.startsAt)}{restriction.endsAt ? ` · ينتهي ${formatDateTime(restriction.endsAt)}` : ' · دائم'}</small>
            </div>
            {restriction.reportId ? <div className="context-row-tail"><a href={`/reports?report=${encodeURIComponent(restriction.reportId)}`}>البلاغ ←</a></div> : null}
          </div>
        </div>
      ) : <EmptyContext visible>لا يوجد مستند قيد رسائل مباشرة لهذا المستخدم.</EmptyContext>}
      {directChat.recentAudits.length > 0 ? (
        <div className="context-subsection">
          <div className="context-subheading"><strong>آخر إجراءات القيد</strong><span>{directChat.recentAudits.length.toLocaleString('ar-IQ')}</span></div>
          <div className="context-list">
            {directChat.recentAudits.map((event) => (
              <div className="context-row" key={event.id}>
                <span className="context-row-icon danger">!</span>
                <div>
                  <strong>{directChatRestrictActionLabel(event.action)}</strong>
                  <small>{event.note || 'دون ملاحظة'} · {event.actorUid || '—'} · {formatDateTime(event.createdAt)}</small>
                </div>
                {event.reportId ? <div className="context-row-tail"><a href={`/reports?report=${encodeURIComponent(event.reportId)}`}>البلاغ ←</a></div> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
    <section className="user-context-surface safety-context">
      <ContextHeading eyebrow="السياق الآمن" sampled={reports.sampled} title="البلاغات المرتبطة بالمستخدم" />
      <ContextError message={detail.context.errors.reports} />
      <div className="context-kpi-grid">
        <ContextKpi label="بلاغات مفتوحة" tone={reports.summary.open > 0 ? 'warning' : 'neutral'} value={reports.summary.open} />
        <ContextKpi label="عاجلة" tone={reports.summary.urgent > 0 ? 'danger' : 'neutral'} value={reports.summary.urgent} />
        <ContextKpi label="حُلّت خلال 30 يوماً" tone="success" value={reports.summary.recentResolved} />
        <ContextKpi label="ضمن العينة" tone="gold" value={reports.summary.total} />
      </div>
      <div className="context-list">{reportHistory.items.map((report) => <ReportContextRow key={report.id} report={report} subjectUid={detail.profile.uid} />)}<EmptyContext visible={reportHistory.items.length === 0}>لا توجد بلاغات مرتبطة بهذا المستخدم ضمن السجل المتاح.</EmptyContext></div><HistoryPagination {...reportHistory} />
    </section>
    <section className="user-context-surface">
      <ContextHeading eyebrow="الوجود داخل الغرف" sampled={rooms.sampled} title="الاستضافة والعضوية والإشراف" />
      <ContextError message={detail.context.errors.rooms} />
      <div className="room-context-grid">{roomHistory.items.map((room) => <a className="room-context-card" href={`/rooms?room=${encodeURIComponent(room.id)}`} key={`${room.relation}-${room.id}`}><span className={`room-context-mark relation-${room.relation}`}>{room.relation === 'host' ? 'مضيف' : 'عضو'}</span><div><strong>{room.title || 'غرفة بلا عنوان'}</strong><small>{room.participantCount.toLocaleString('ar-IQ')} مشارك · {room.visibility === 'private' ? 'خاصة' : 'عامة'}</small></div><b>فتح ←</b></a>)}<EmptyContext visible={roomHistory.items.length === 0}>لا توجد استضافة أو عضوية حديثة مرتبطة بهذا المستخدم.</EmptyContext></div><HistoryPagination {...roomHistory} />
      {moderationHistory.items.length > 0 ? <div className="context-subsection"><div className="context-subheading"><strong>إجراءات إشراف داخل الغرف</strong><span>{moderationHistory.items.length.toLocaleString('ar-IQ')}</span></div><div className="context-list">{moderationHistory.items.map((event) => <a className="context-row" href={`/rooms?room=${encodeURIComponent(event.roomId)}`} key={event.id}><span className="context-row-icon danger">!</span><div><strong>{roomActionLabel(event.action)}</strong><small>{event.reason || 'دون سبب مسجل'} · {formatDateTime(event.createdAt)}</small></div><b>الغرفة ←</b></a>)}</div><HistoryPagination {...moderationHistory} /></div> : null}
    </section>
  </div>;
}

function ReportContextRow({ report, subjectUid }: { report: AdminReportRow; subjectUid: string }) {
  const direction = report.targetUid === subjectUid ? 'بلاغ ضد المستخدم' : 'بلاغ قدّمه المستخدم';
  return <a className="context-row" href={`/reports?report=${encodeURIComponent(report.id)}`}><span className={`context-row-icon severity-${report.severity}`}>!</span><div><strong>{report.reason || direction}</strong><small>{direction} · {formatDateTime(report.updatedAt || report.createdAt)}</small></div><div className="context-row-tail"><AdminStatusBadge tone={report.status === 'resolved' ? 'success' : report.severity === 'critical' || report.severity === 'high' ? 'danger' : 'warning'}>{reportStatusLabel(report.status)}</AdminStatusBadge><b>فتح ←</b></div></a>;
}

function StoreAndTransferContext({ detail }: { detail: AdminUserDetail }) {
  const { store, transfers } = detail.context;
  const ownershipHistory = useAdminUserHistory({ initialItems: store.ownerships, mayHaveMore: store.ownerships.length >= detail.context.limits.perSection, section: 'ownerships', targetUid: detail.profile.uid });
  const storeGiftHistory = useAdminUserHistory({ initialItems: store.gifts, mayHaveMore: store.gifts.length >= detail.context.limits.perSection, section: 'store-gifts', targetUid: detail.profile.uid });
  const transferHistory = useAdminUserHistory({ initialItems: transfers.items, mayHaveMore: transfers.sampled, section: 'transfers', targetUid: detail.profile.uid });
  return <div className="user-context-stack">
    <section className="user-context-surface">
      <ContextHeading eyebrow="ملكية المتجر" sampled={store.sampled} title="العناصر المملوكة والمجهّزة" />
      <ContextError message={detail.context.errors.store} />
      <div className="ownership-grid">{ownershipHistory.items.map((item) => <a className={`ownership-card state-${item.state}`} href={`/store?item=${encodeURIComponent(item.itemId)}`} key={item.itemId}>{item.thumbnailUrl ? <img alt="" src={item.thumbnailUrl} /> : <span className="ownership-placeholder">◇</span>}<div><strong>{item.nameAr || item.itemId}</strong><small>{categoryLabel(item.category)} · {item.acquisitionSource === 'gift' ? 'هدية' : 'شراء'}</small><span>{item.equipped ? 'مجهّز الآن' : item.state === 'expired' ? 'منتهي' : item.expiresAt ? `ينتهي ${formatDate(item.expiresAt)}` : 'ملكية دائمة'}</span></div><b>←</b></a>)}<EmptyContext visible={ownershipHistory.items.length === 0}>لا توجد عناصر متجر مملوكة ضمن السجل المتاح.</EmptyContext></div><HistoryPagination {...ownershipHistory} />
    </section>
    <section className="user-context-surface split-context-surface">
      <div><ContextHeading eyebrow="حركة القيمة" sampled={transfers.sampled} title="الشحن وتحويلات الوكلاء" /><ContextError message={detail.context.errors.transfers} /><div className="context-list">{transferHistory.items.map((item) => <PeerValueRow amount={item.amount} createdAt={item.createdAt} currency={item.currency} direction={item.direction} key={item.id} label={item.direction === 'sent' ? 'تحويل بواسطة الوكيل' : 'إعادة شحن للمستخدم'} peerDisplayName={item.peerDisplayName} peerPublicId={item.peerPublicId} status={item.status} />)}<EmptyContext visible={transferHistory.items.length === 0}>لا توجد إيصالات شحن أو تحويلات وكيل حديثة.</EmptyContext></div><HistoryPagination {...transferHistory} /></div>
      <div><ContextHeading eyebrow="هدايا المتجر" sampled={store.sampled} title="العناصر المرسلة والمستلمة" /><div className="context-list">{storeGiftHistory.items.map((gift) => <GiftContextRow gift={gift} key={gift.id} />)}<EmptyContext visible={storeGiftHistory.items.length === 0}>لا توجد هدايا متجر حديثة.</EmptyContext></div><HistoryPagination {...storeGiftHistory} /></div>
    </section>
  </div>;
}

function SocialNetworkContext({ detail, onOpenUser }: { detail: AdminUserDetail; onOpenUser?: (uid: string) => void }) {
  const { social } = detail.context;
  const giftHistory = useAdminUserHistory({ initialItems: social.gifts, mayHaveMore: social.gifts.length >= detail.context.limits.perSection, section: 'social-gifts', targetUid: detail.profile.uid });
  return <div className="user-context-stack">
    <section className="user-context-surface">
      <ContextHeading eyebrow="خريطة العلاقات" sampled={social.sampled} title="الأصدقاء والمتابعة والطلبات" />
      <ContextError message={detail.context.errors.social} />
      <div className="relationship-grid">{social.relationships.map((relation) => <RelationshipCard key={`${relation.kind}-${relation.id}`} onOpenUser={onOpenUser} relation={relation} />)}<EmptyContext visible={social.relationships.length === 0}>لا توجد صداقات أو متابعة أو طلبات معلّقة ضمن السجل المتاح.</EmptyContext></div>
    </section>
    <section className="user-context-surface split-context-surface">
      <div><ContextHeading eyebrow="السلامة الاجتماعية" sampled={social.sampled} title="الحظر المتبادل" /><div className="context-list">{social.blocks.map((block) => <button className="context-row peer-row" key={`${block.direction}-${block.id}`} onClick={() => onOpenUser?.(block.peerUid)} type="button"><span className="context-row-icon danger">×</span><div><strong>{block.peerDisplayName || block.peerPublicId || 'مستخدم'}</strong><small>{block.direction === 'outgoing' ? 'حظره هذا المستخدم' : 'حظر هذا المستخدم'} · {formatDateTime(block.createdAt)}</small></div><b>الملف ←</b></button>)}<EmptyContext visible={social.blocks.length === 0}>لا توجد علاقات حظر ظاهرة ضمن العينة الآمنة.</EmptyContext></div></div>
      <div><ContextHeading eyebrow="الهدايا الاجتماعية" sampled={social.sampled} title="آخر الهدايا" /><div className="context-list">{giftHistory.items.map((gift) => <GiftContextRow gift={gift} key={gift.id} onOpenUser={onOpenUser} />)}<EmptyContext visible={giftHistory.items.length === 0}>لا توجد هدايا اجتماعية حديثة.</EmptyContext></div><HistoryPagination {...giftHistory} /></div>
    </section>
  </div>;
}

function RelationshipCard({ onOpenUser, relation }: { onOpenUser?: (uid: string) => void; relation: AdminUserRelationshipContext }) {
  return <button className="relationship-card" onClick={() => onOpenUser?.(relation.peerUid)} type="button"><span className={`relationship-symbol kind-${relation.kind}`}>{relationshipSymbol(relation.kind)}</span><div><strong>{relation.peerDisplayName || relation.peerPublicId || 'مستخدم'}</strong><small>{relationshipLabel(relation.kind)}</small><span dir="ltr">{relation.peerPublicId || relation.peerUid}</span></div><b>فتح الملف ←</b></button>;
}

function GiftContextRow({ gift, onOpenUser }: { gift: AdminUserGiftContext; onOpenUser?: (uid: string) => void }) {
  if (gift.channel === 'store' && gift.itemId) return <a className="context-row peer-row" href={`/store?item=${encodeURIComponent(gift.itemId)}`}><span className="context-row-icon gift">◇</span><div><strong>{gift.label || gift.itemId}</strong><small>{gift.direction === 'sent' ? 'أُرسلت إلى' : 'استُلمت من'} {gift.peerDisplayName || gift.peerPublicId || 'مستخدم'} · {formatDateTime(gift.createdAt)}</small></div><div className="context-value"><b>{gift.amount.toLocaleString('ar-IQ')} {currencyLabel(gift.currency)}</b><small>فتح العنصر ←</small></div></a>;
  const Tag = onOpenUser ? 'button' : 'div';
  return <Tag className="context-row peer-row" {...(onOpenUser ? { onClick: () => onOpenUser(gift.peerUid), type: 'button' as const } : {})}><span className="context-row-icon gift">◇</span><div><strong>{gift.label || gift.itemId || 'هدية'}</strong><small>{gift.direction === 'sent' ? 'أُرسلت إلى' : 'استُلمت من'} {gift.peerDisplayName || gift.peerPublicId || 'مستخدم'} · {formatDateTime(gift.createdAt)}</small></div><div className="context-value"><b>{gift.amount.toLocaleString('ar-IQ')}</b><small>{currencyLabel(gift.currency)}</small></div></Tag>;
}

function PeerValueRow({ amount, createdAt, currency, direction, label, peerDisplayName, peerPublicId, status }: { amount: number; createdAt: string; currency: string; direction: 'sent' | 'received'; label: string; peerDisplayName: string; peerPublicId: string; status: string }) {
  return <div className="context-row"><span className={`context-row-icon ${direction === 'received' ? 'success' : 'gold'}`}>{direction === 'received' ? '+' : '↗'}</span><div><strong>{label}</strong><small>{peerDisplayName || peerPublicId || 'طرف موثّق'} · {formatDateTime(createdAt)}</small></div><div className="context-value"><b>{amount.toLocaleString('ar-IQ')}</b><small>{currencyLabel(currency)} · {status === 'completed' ? 'مكتمل' : status}</small></div></div>;
}

function ContextHeading({ eyebrow, sampled, title }: { eyebrow: string; sampled?: boolean; title: string }) {
  return <header className="context-heading"><div><p>{eyebrow}</p><h4>{title}</h4></div>{sampled ? <span className="sampled-badge" title="تُعرض عينة محدودة لحماية الأداء">عينة محدودة</span> : null}</header>;
}

function directChatRestrictActionLabel(action: string) {
  return ({
    'direct-chat-restrict-direct-chat': 'تقييد الرسائل المباشرة',
    'direct-chat-clear-direct-chat-restriction': 'رفع قيد الرسائل المباشرة',
  } as Record<string, string>)[action] || action;
}

function ContextKpi({ label, tone, value }: { label: string; tone: 'danger' | 'gold' | 'neutral' | 'success' | 'warning'; value: number }) {
  return <article className={`context-kpi tone-${tone}`}><span /><div><strong>{value.toLocaleString('ar-IQ')}</strong><small>{label}</small></div></article>;
}

function ContextError({ message }: { message?: string }) { return message ? <div className="context-partial-error" role="status"><span>!</span><p>{message}</p></div> : null; }

function HistoryPagination({ error, hasNextPage, loadMore, status }: { error: string; hasNextPage: boolean; loadMore: () => Promise<void>; status: 'idle' | 'loading' | 'error' }) {
  if (!hasNextPage && !error) return null;
  return <div aria-busy={status === 'loading'} aria-live="polite" className={`history-pagination${error ? ' has-error' : ''}`}>{error ? <span>{error}</span> : <small>يمكن تحميل سجل أقدم دون توسيع طلب الملف الأساسي.</small>}<button disabled={status === 'loading'} onClick={() => void loadMore()} type="button">{status === 'loading' ? 'جارٍ التحميل…' : error ? 'إعادة المحاولة' : 'تحميل الأقدم'}</button></div>;
}

function EmptyContext({ children, visible }: { children: string; visible: boolean }) { return visible ? <div className="context-empty"><span>✓</span><p>{children}</p></div> : null; }
function relationshipLabel(kind: AdminUserRelationshipContext['kind']) { return ({ friend: 'صداقة نشطة', 'friend-request-incoming': 'طلب صداقة وارد', 'friend-request-outgoing': 'طلب صداقة صادر', following: 'يتابع', follower: 'متابع', 'couple-request-incoming': 'طلب ارتباط وارد', 'couple-request-outgoing': 'طلب ارتباط صادر' } as const)[kind]; }
function relationshipSymbol(kind: AdminUserRelationshipContext['kind']) { return kind === 'friend' ? 'ص' : kind === 'following' || kind === 'follower' ? 'م' : kind.startsWith('friend') ? '+' : '♡'; }
function reportStatusLabel(status: string) { return status === 'resolved' ? 'محلول' : status === 'triage' ? 'قيد الفرز' : 'مفتوح'; }
function roomActionLabel(action: string) { return ({ 'mute-member': 'كتم عضو', 'remove-member': 'إزالة عضو', 'unmute-member': 'رفع كتم عضو', 'transfer-host': 'نقل الاستضافة' } as Record<string, string>)[action] || action || 'إجراء إشرافي'; }
function categoryLabel(category: string) { return ({ cars: 'سيارات', frames: 'إطارات', gifts: 'هدايا', 'name-colors': 'ألوان الأسماء', themes: 'سمات' } as Record<string, string>)[category] || category || 'عنصر'; }
function currencyLabel(currency: string) { return currency === 'diamonds' ? 'ماسة' : currency === 'coins' ? 'عملة' : currency || 'قيمة'; }
function formatDate(value: string) { if (!value) return 'غير محدد'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'غير محدد' : new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'medium' }).format(date); }
function formatDateTime(value: string) { if (!value) return 'وقت غير متاح'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'وقت غير متاح' : new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'short', timeStyle: 'short' }).format(date); }
