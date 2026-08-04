import { useEffect, useState } from 'react';
import { User } from 'firebase/auth';

import { AdminStoreCatalogItem, AdminStoreItemDetail, requestAdminStoreItemDetail } from './adminDashboardApi';
import { useAdminDialogFocus } from './useAdminDialogFocus';
import './StoreItemInspector.css';

export default function StoreItemInspector({ initialItem, itemId, onClose, onEdit, user }: { initialItem?: AdminStoreCatalogItem; itemId: string; onClose: () => void; onEdit?: (item: AdminStoreCatalogItem) => void; user: User }) {
  const [detail, setDetail] = useState<AdminStoreItemDetail>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useAdminDialogFocus(true, onClose, '.economy-drawer');

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setDetail(undefined);
    void requestAdminStoreItemDetail(user, itemId).then((result) => {
      if (active) setDetail(result);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'تعذّر تحميل ملف العنصر.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [itemId, user]);

  const item = detail?.item || initialItem;
  const metrics = detail?.metrics;
  const sampled = detail?.sampled && Object.values(detail.sampled).some(Boolean);
  return <div className="economy-drawer-layer" role="presentation">
    <button aria-label="إغلاق" className="economy-drawer-backdrop" onClick={onClose} type="button" />
    <aside aria-label={item ? `ملف ${item.name.ar}` : 'ملف العنصر'} aria-modal="true" className="economy-drawer store-item-inspector" role="dialog" tabIndex={-1}>
      <header><div><span>ذكاء الكتالوج</span><h2>ملف العنصر</h2><p>المبيعات والملكية وسجل التغييرات</p></div><button aria-label="إغلاق" onClick={onClose} type="button">×</button></header>
      {item ? <section className="store-item-identity" style={item.previewAssetUrl ? { backgroundImage: `linear-gradient(90deg,rgba(17,16,23,.98),rgba(17,16,23,.72)),url(${item.previewAssetUrl})` } : undefined}>
        <img alt="" src={item.thumbnailUrl} />
        <div><span>{categoryLabel(item.category)}</span><h3>{item.name.ar}</h3><p>{item.description.ar}</p><small dir="ltr">{item.itemId}</small></div>
        <div className={`store-item-state state-${item.availability}`}>{availabilityLabel(item.availability)}</div>
      </section> : null}

      {loading ? <div className="store-item-loading">جارٍ جمع بيانات العنصر…</div> : null}
      {error ? <div className="economy-error"><strong>تعذّر تحميل ملف العنصر</strong><span>{error}</span></div> : null}
      {detail && item ? <div className="store-item-detail-body">
        {sampled ? <p className="store-item-sample-note">الأرقام مبنية على أحدث السجلات ضمن حدود القراءة الآمنة.</p> : null}
        <section className="store-item-metrics" aria-label="مؤشرات العنصر">
          <Metric label="المشتريات" value={metrics?.purchases} />
          <Metric label="الهدايا" value={metrics?.gifts} />
          <Metric label="الملاك الحاليون" value={metrics?.activeOwnerships} />
          <Metric label="قيد الاستخدام" value={metrics?.equippedOwnerships} />
          <Metric label="إيراد العملات" suffix="COIN" value={metrics?.revenueCoins} />
          <Metric label="إيراد الألماس" suffix="DIA" value={metrics?.revenueDiamonds} />
        </section>
        <section className="store-item-commerce">
          <div><span>المخزون</span><strong>{item.stock.kind === 'unlimited' ? 'غير محدود' : item.stock.remaining.toLocaleString('ar-IQ')}</strong></div>
          <div><span>الملكية الكلية</span><strong>{metrics?.ownerships.toLocaleString('ar-IQ')}</strong></div>
          <div><span>ملكيات منتهية</span><strong>{metrics?.expiredOwnerships.toLocaleString('ar-IQ')}</strong></div>
          <div><span>حالة البيع</span><strong>{item.purchasingEnabled ? 'مفعّل' : 'متوقف'}</strong></div>
        </section>
        <section className="store-item-history">
          <header><div><span>الخط الزمني</span><h3>آخر نشاطات العنصر</h3></div><small>{detail.history.length.toLocaleString('ar-IQ')} سجل</small></header>
          {detail.history.map((entry) => <article key={`${entry.kind}-${entry.id}`}><i className={`history-${entry.kind}`} /><div><strong>{historyLabel(entry.kind)}</strong><small>{entry.actorUid ? `بواسطة ${entry.actorUid}` : 'تغيير إداري'}</small></div><div>{entry.amount ? <b dir="ltr">{entry.amount.toLocaleString('en-US')} {entry.currency === 'diamonds' ? 'DIA' : 'COIN'}</b> : null}<time>{formatDateTime(entry.createdAt)}</time></div></article>)}
          {!detail.history.length ? <p className="economy-overview-empty">لا يوجد نشاط مسجل لهذا العنصر بعد.</p> : null}
        </section>
      </div> : null}
      <footer className="store-item-inspector-actions"><button className="secondary" onClick={() => void navigator.clipboard.writeText(itemId)} type="button">نسخ المعرّف</button>{onEdit && item ? <button onClick={() => onEdit(item)} type="button">تعديل العنصر</button> : null}</footer>
    </aside>
  </div>;
}

function Metric({ label, suffix, value }: { label: string; suffix?: string; value?: number }) {
  return <article><small>{label}</small><strong dir={suffix ? 'ltr' : undefined}>{value === undefined ? '—' : value.toLocaleString(suffix ? 'en-US' : 'ar-IQ')} {suffix}</strong></article>;
}

function categoryLabel(value: AdminStoreCatalogItem['category']) { return ({ 'game-items': 'عناصر اللعبة', 'chat-themes': 'سمات الدردشة', 'avatar-frames': 'إطارات الصور', 'profile-skins': 'خلفيات الملف', 'chat-bubbles': 'فقاعات الدردشة', nameplates: 'لوحات الاسم', 'cosmetic-badges': 'الشارات التجميلية', 'seat-effects': 'تأثيرات المقعد', stickers: 'ملصقات الدردشة', cars: 'السيارات', 'custom-ids': 'معرّفات مخصصة' } as const)[value]; }
function availabilityLabel(value: AdminStoreCatalogItem['availability']) { return ({ available: 'متاح', disabled: 'متوقف', unavailable: 'غير متاح' } as const)[value]; }
function historyLabel(value: AdminStoreItemDetail['history'][number]['kind']) { return ({ purchase: 'عملية شراء', gift: 'إهداء العنصر', 'catalog-change': 'تغيير في الكتالوج' } as const)[value]; }
function formatDateTime(value: string) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'short', timeStyle: 'short' }).format(date); }
