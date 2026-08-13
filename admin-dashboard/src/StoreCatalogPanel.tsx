import { FormEvent, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';

import {
  AdminEconomyTransaction,
  AdminGiftCatalogItem,
  AdminListPage,
  AdminSpecialIdItem,
  AdminStoreCatalogItem,
  AdminStoreSummary,
  requestAdminEconomyExport,
  requestAdminEconomyHistoryPage,
  requestAdminGiftCatalogPage,
  requestAdminSpecialIdCatalogPage,
  requestAdminStoreCatalogPage,
  requestAdminStoreSummary,
  upsertAdminGiftCatalog,
  upsertAdminSpecialId,
} from './adminDashboardApi';
import { useAdminFeedback } from './AdminFeedback';
import { useAdminDialogFocus } from './useAdminDialogFocus';
import { defaultGiftPresentation, GiftPresentationEditorFields } from './GiftPresentationEditorFields';
import { isSameGiftPresentationApprovalScope } from './giftPresentationApproval';
import { canManageStoreWorkspace } from './adminWorkspacePolicy';
import { readAdminRouteSnapshot, useAdminRouteSnapshot } from './adminRouteState';
import { readAdminQueryParameter, setAdminQueryParameter } from './adminDeepLinks';

const StoreCatalogEditor = lazy(() => import('./StoreCatalogEditor'));
const StoreItemInspector = lazy(() => import('./StoreItemInspector'));
const StoreCatalogTable = lazy(() => import('./StoreCatalogTable'));

type Tab = 'overview' | 'catalog' | 'gifts' | 'special-ids' | 'ledger';
type Editor = { duplicate?: boolean; kind: 'catalog'; item?: AdminStoreCatalogItem } | { kind: 'gift'; item?: AdminGiftCatalogItem } | { kind: 'special-id'; item?: AdminSpecialIdItem } | null;
type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type StoreRouteSnapshot = { catalog: AdminStoreCatalogItem[]; category: string; createdFrom: string; createdTo: string; currency: string; gifts: AdminGiftCatalogItem[]; ledger: AdminEconomyTransaction[]; page?: AdminListPage<unknown>['pageInfo']; search: string; specialIds: AdminSpecialIdItem[]; status: string; summary?: AdminStoreSummary; tab: Tab; transactionSource: string; transactionType: string };

const tabLabels: Record<Tab, string> = {
  overview: 'نظرة عامة', catalog: 'الكتالوج العام', gifts: 'الهدايا', 'special-ids': 'الأرقام المميزة', ledger: 'سجل الاقتصاد',
};

export function StoreCatalogPanel({ permissions, user }: { permissions: string[]; user: User }) {
  const { notify } = useAdminFeedback();
  const canManage = canManageStoreWorkspace(permissions);
  const deepLinkedItemId = readAdminQueryParameter(window.location.search, 'item', 80);
  const restored = useRef(readAdminRouteSnapshot<StoreRouteSnapshot>('store')).current;
  const [tab, setTab] = useState<Tab>(deepLinkedItemId ? 'catalog' : restored?.value.tab || 'overview');
  const [summary, setSummary] = useState<AdminStoreSummary | undefined>(restored?.value.summary);
  const [catalog, setCatalog] = useState<AdminStoreCatalogItem[]>(restored?.value.catalog || []);
  const [gifts, setGifts] = useState<AdminGiftCatalogItem[]>(restored?.value.gifts || []);
  const [specialIds, setSpecialIds] = useState<AdminSpecialIdItem[]>(restored?.value.specialIds || []);
  const [ledger, setLedger] = useState<AdminEconomyTransaction[]>(restored?.value.ledger || []);
  const [page, setPage] = useState<AdminListPage<unknown>['pageInfo'] | undefined>(restored?.value.page);
  const [state, setState] = useState<LoadState>(restored ? 'ready' : 'idle');
  const [error, setError] = useState('');
  const [search, setSearch] = useState(restored?.value.search || '');
  const [status, setStatus] = useState(restored?.value.status || '');
  const [category, setCategory] = useState(restored?.value.category || '');
  const [currency, setCurrency] = useState(restored?.value.currency || '');
  const [transactionType, setTransactionType] = useState(restored?.value.transactionType || '');
  const [transactionSource, setTransactionSource] = useState(restored?.value.transactionSource || '');
  const [createdFrom, setCreatedFrom] = useState(restored?.value.createdFrom || '');
  const [createdTo, setCreatedTo] = useState(restored?.value.createdTo || '');
  const [selectedTransaction, setSelectedTransaction] = useState<AdminEconomyTransaction>();
  const [selectedCatalogItem, setSelectedCatalogItem] = useState<{ item?: AdminStoreCatalogItem; itemId: string } | undefined>(deepLinkedItemId ? { itemId: deepLinkedItemId } : undefined);
  const [exporting, setExporting] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const skipRestoredLoad = useRef(Boolean(restored && !deepLinkedItemId));

  const loadSummary = useCallback(async () => {
    try { setSummary(await requestAdminStoreSummary(user)); } catch { /* KPIs must not block the workspace. */ }
  }, [user]);

  const load = useCallback(async (append = false) => {
    setState('loading'); setError('');
    const cursor = append ? page?.nextCursor || '' : '';
    try {
      if (tab === 'overview') {
        const result = await requestAdminEconomyHistoryPage(user, { cursor });
        setLedger((current) => append ? [...current, ...result.items] : result.items); setPage(result.pageInfo);
      } else if (tab === 'catalog') {
        const result = await requestAdminStoreCatalogPage(user, { availability: status as '' | AdminStoreCatalogItem['availability'], category: category as '' | AdminStoreCatalogItem['category'], cursor, search });
        setCatalog((current) => append ? [...current, ...result.items] : result.items); setPage(result.pageInfo);
      } else if (tab === 'gifts') {
        const result = await requestAdminGiftCatalogPage(user, { cursor, search, status: status as '' | 'available' | 'disabled' });
        setGifts((current) => append ? [...current, ...result.items] : result.items); setPage(result.pageInfo);
      } else if (tab === 'special-ids') {
        const result = await requestAdminSpecialIdCatalogPage(user, { cursor, search, status: status as '' | 'available' | 'disabled' | 'sold' });
        setSpecialIds((current) => append ? [...current, ...result.items] : result.items); setPage(result.pageInfo);
      } else {
        const result = await requestAdminEconomyHistoryPage(user, { createdFrom, createdTo, currency: currency as '' | 'coins' | 'diamonds', cursor, search, source: transactionSource, type: transactionType as '' | AdminEconomyTransaction['type'] });
        setLedger((current) => append ? [...current, ...result.items] : result.items); setPage(result.pageInfo);
      }
      setState('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر تحميل بيانات المتجر.'); setState('error');
    }
  }, [category, createdFrom, createdTo, currency, page?.nextCursor, search, status, tab, transactionSource, transactionType, user]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => { if (skipRestoredLoad.current) { skipRestoredLoad.current = false; return; } const timer = window.setTimeout(() => void load(false), 250); return () => window.clearTimeout(timer); }, [tab, search, status, category, currency, transactionType, transactionSource, createdFrom, createdTo, user]);

  function switchTab(next: Tab) {
    setTab(next); setSearch(''); setStatus(''); setCategory(''); setCurrency(''); setTransactionType(''); setTransactionSource(''); setCreatedFrom(''); setCreatedTo(''); setPage(undefined); setError('');
  }

  const visibleCount = tab === 'overview' || tab === 'ledger' ? ledger.length : tab === 'catalog' ? catalog.length : tab === 'gifts' ? gifts.length : specialIds.length;
  const routeSnapshot = useMemo<StoreRouteSnapshot>(() => ({ catalog, category, createdFrom, createdTo, currency, gifts, ledger, page, search, specialIds, status, summary, tab, transactionSource, transactionType }), [catalog, category, createdFrom, createdTo, currency, gifts, ledger, page, search, specialIds, status, summary, tab, transactionSource, transactionType]);
  useAdminRouteSnapshot('store', routeSnapshot, restored?.scrollY || 0);

  function openCatalogItem(itemId: string, item?: AdminStoreCatalogItem) {
    setSelectedCatalogItem({ item, itemId });
    setAdminQueryParameter('item', itemId);
  }

  async function exportLedger() {
    setExporting(true);
    try {
      const result = await requestAdminEconomyExport(user, { createdFrom, createdTo, currency: currency as '' | 'coins' | 'diamonds', search, source: transactionSource, type: transactionType as '' | AdminEconomyTransaction['type'] });
      downloadCsv(result.csv, result.filename);
      notify('تم تجهيز ملف السجل', { description: result.truncated ? `تم تصدير ${result.count.toLocaleString('ar-IQ')} حركة؛ الملف محدود بأحدث النتائج.` : `تم تصدير ${result.count.toLocaleString('ar-IQ')} حركة مطابقة.`, tone: 'success' });
    } catch (cause) {
      notify('تعذّر تصدير السجل', { description: failureMessage(cause), tone: 'error' });
    } finally { setExporting(false); }
  }

  return <div className="economy-page">
    <header className="economy-hero">
      <div><span className="economy-eyebrow">مركز العمليات المالية</span><h1>المتجر والاقتصاد</h1><p>إدارة الكتالوج والأسعار والتوفر، ومراجعة حركة المحافظ من مساحة واحدة.</p></div>
      <button className="economy-refresh" onClick={() => { void load(false); void loadSummary(); }} type="button"><span>↻</span> تحديث البيانات</button>
    </header>

    <section className="economy-kpis" aria-label="ملخص المتجر">
      <Kpi icon="◇" label="العناصر النشطة" value={summary?.activeCatalogItems} meta={`${summary?.catalogItems ?? 0} عنصر إجمالي`} />
      <Kpi icon="♕" label="الهدايا المتاحة" value={summary?.activeGifts} meta={`${summary?.gifts ?? 0} هدية مسجلة`} />
      <Kpi icon="#" label="الأرقام المتاحة" value={summary?.availableSpecialIds} meta={`${summary?.specialIds ?? 0} رقم في الكتالوج`} />
      <Kpi icon="↔" label="حركات المحافظ" value={summary?.transactions} meta="سجل كامل قابل للبحث" />
    </section>

    <section className="economy-workspace">
      <div className="economy-tabs" role="tablist">
        {(Object.keys(tabLabels) as Tab[]).map((key) => <button aria-selected={tab === key} className={tab === key ? 'active' : ''} key={key} onClick={() => switchTab(key)} role="tab" type="button"><span>{tabIcon(key)}</span>{tabLabels[key]}</button>)}
      </div>

      {tab === 'overview' ? <StoreOverview ledger={ledger} loading={state === 'loading'} summary={summary} /> : <>
      <div className="economy-toolbar">
        <label className="economy-search"><span>⌕</span><input aria-label="بحث" dir="auto" placeholder={tab === 'ledger' ? 'ابحث بـ UID أو الرقم العام أو المميز' : 'ابحث بالاسم أو المعرّف'} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        {tab === 'catalog' ? <select aria-label="القسم" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">كل الأقسام</option><option value="game-items">عناصر اللعبة</option><option value="chat-themes">سمات الدردشة</option><option value="avatar-frames">إطارات الصور</option><option value="profile-skins">خلفيات الملف</option><option value="chat-bubbles">فقاعات الدردشة</option><option value="nameplates">لوحات الاسم</option><option value="cosmetic-badges">الشارات التجميلية</option><option value="seat-effects">تأثيرات المقعد</option><option value="couple-effects">تأثيرات الارتباط</option><option value="stickers">ملصقات الدردشة</option><option value="cars">السيارات</option><option value="custom-ids">معرّفات مخصصة</option></select> : null}
        {tab !== 'ledger' ? <select aria-label="الحالة" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">كل الحالات</option><option value="available">متاح</option><option value="disabled">متوقف</option>{tab === 'catalog' ? <option value="unavailable">غير متاح</option> : null}{tab === 'special-ids' ? <option value="sold">مباع</option> : null}</select> : <><select aria-label="العملة" value={currency} onChange={(event) => setCurrency(event.target.value)}><option value="">كل العملات</option><option value="coins">العملات</option><option value="diamonds">الألماس</option></select><select aria-label="نوع الحركة" value={transactionType} onChange={(event) => setTransactionType(event.target.value)}><option value="">كل الحركات</option><option value="credit">إضافة</option><option value="debit">خصم</option><option value="purchase">شراء</option><option value="transfer">تحويل</option></select><select aria-label="مصدر الحركة" value={transactionSource} onChange={(event) => setTransactionSource(event.target.value)}><option value="">كل المصادر</option><option value="store-purchase">شراء متجر</option><option value="store-gift">إهداء متجر</option><option value="gift">هدية اجتماعية</option><option value="representative-transfer">تحويل وكيل</option><option value="admin-credit">إضافة إدارية</option><option value="admin-debit">خصم إداري</option></select><label className="economy-date-filter">من<input aria-label="من تاريخ" type="date" value={createdFrom} onChange={(event) => setCreatedFrom(event.target.value)} /></label><label className="economy-date-filter">إلى<input aria-label="إلى تاريخ" type="date" value={createdTo} onChange={(event) => setCreatedTo(event.target.value)} /></label><button className="economy-export" disabled={exporting} onClick={() => void exportLedger()} type="button">{exporting ? 'جارٍ التصدير…' : 'تصدير CSV'}</button></>}
        {tab !== 'ledger' && canManage ? <button className="economy-create" onClick={() => setEditor({ kind: tab === 'catalog' ? 'catalog' : tab === 'gifts' ? 'gift' : 'special-id' })} type="button">＋ إضافة {tab === 'catalog' ? 'عنصر' : tab === 'gifts' ? 'هدية' : 'رقم'}</button> : null}
      </div>

      <div className="economy-list-head"><div><h2>{tabLabels[tab]}</h2><p>{visibleCount.toLocaleString('ar-IQ')} نتيجة ظاهرة</p></div><span className={state === 'loading' ? 'economy-live loading' : 'economy-live'}>{state === 'loading' ? 'جارٍ التحديث' : 'بيانات مباشرة'}</span></div>

      {error ? <div className="economy-error"><strong>تعذّر تحميل البيانات</strong><span>{error}</span><button onClick={() => void load(false)} type="button">إعادة المحاولة</button></div> : null}
      {state === 'loading' && visibleCount === 0 ? <div className="economy-skeleton">{[1, 2, 3, 4].map((key) => <i key={key} />)}</div> : null}
      {state !== 'loading' && !error && visibleCount === 0 ? <div className="economy-empty"><span>◇</span><h3>لا توجد نتائج مطابقة</h3><p>غيّر عوامل التصفية أو أضف أول عنصر لهذا القسم.</p></div> : null}

      {tab === 'catalog' && catalog.length ? <Suspense fallback={<div className="economy-skeleton"><i /><i /><i /></div>}><StoreCatalogTable items={catalog} onDuplicate={canManage ? (item) => setEditor({ duplicate: true, kind: 'catalog', item }) : undefined} onEdit={canManage ? (item) => setEditor({ kind: 'catalog', item }) : undefined} onInspect={(item) => openCatalogItem(item.itemId, item)} /></Suspense> : null}
      {tab === 'gifts' && gifts.length ? <GiftGrid items={gifts} onEdit={canManage ? (item) => setEditor({ kind: 'gift', item }) : undefined} /> : null}
      {tab === 'special-ids' && specialIds.length ? <SpecialIdsTable items={specialIds} onEdit={canManage ? (item) => setEditor({ kind: 'special-id', item }) : undefined} /> : null}
      {tab === 'ledger' && ledger.length ? <LedgerTable items={ledger} onOpen={setSelectedTransaction} /> : null}

      {page?.hasNextPage ? <div className="economy-pagination"><button disabled={state === 'loading'} onClick={() => void load(true)} type="button">تحميل المزيد</button></div> : null}
      </>}
    </section>

    {editor?.kind === 'catalog' ? <Suspense fallback={null}><StoreCatalogEditor editor={editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void load(false); void loadSummary(); }} user={user} /></Suspense> : null}
    {editor?.kind === 'gift' ? <GiftEditor editor={editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void load(false); void loadSummary(); }} user={user} /> : null}
    {editor?.kind === 'special-id' ? <SpecialIdEditor editor={editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void load(false); void loadSummary(); }} user={user} /> : null}
    {selectedTransaction ? <TransactionDrawer item={selectedTransaction} onClose={() => setSelectedTransaction(undefined)} onOpenItem={selectedTransaction.referenceId && selectedTransaction.source.startsWith('store') ? () => { openCatalogItem(selectedTransaction.referenceId); setSelectedTransaction(undefined); } : undefined} /> : null}
    {selectedCatalogItem ? <Suspense fallback={<div className="economy-drawer-layer"><div className="economy-drawer-backdrop" /><aside className="economy-drawer store-item-loading">جارٍ تحميل ملف العنصر…</aside></div>}><StoreItemInspector initialItem={selectedCatalogItem.item} itemId={selectedCatalogItem.itemId} onClose={() => { setSelectedCatalogItem(undefined); setAdminQueryParameter('item', ''); }} onEdit={canManage ? (item) => { setEditor({ kind: 'catalog', item }); setSelectedCatalogItem(undefined); setAdminQueryParameter('item', ''); } : undefined} user={user} /></Suspense> : null}
  </div>;
}


function Kpi({ icon, label, value, meta }: { icon: string; label: string; value?: number; meta: string }) {
  return <article><span className="economy-kpi-icon">{icon}</span><div><small>{label}</small><strong>{value === undefined ? '—' : value.toLocaleString('ar-IQ')}</strong><p>{meta}</p></div></article>;
}

function StoreOverview({ ledger, loading, summary }: { ledger: AdminEconomyTransaction[]; loading: boolean; summary?: AdminStoreSummary }) {
  const recent = ledger.slice(0, 6);
  return <div className="store-overview">
    <section className="store-performance-panel">
      <header><div><span className="economy-eyebrow">آخر 24 ساعة</span><h2>نبض المتجر</h2></div>{summary?.sampled24h ? <small>النتائج مبنية على أحدث 1,000 حركة</small> : <small>بيانات مكتملة للفترة</small>}</header>
      <div className="store-performance-grid">
        <article><small>عمليات الشراء</small><strong>{summary?.purchases24h.toLocaleString('ar-IQ') ?? '—'}</strong><span>عملية مكتملة</span></article>
        <article><small>إيراد العملات</small><strong>{summary?.revenueCoins24h.toLocaleString('ar-IQ') ?? '—'}</strong><span>◈ COIN</span></article>
        <article><small>إيراد الألماس</small><strong>{summary?.revenueDiamonds24h.toLocaleString('ar-IQ') ?? '—'}</strong><span>♦ DIA</span></article>
        <article><small>هدايا العناصر</small><strong>{summary?.giftedItems24h.toLocaleString('ar-IQ') ?? '—'}</strong><span>هدية مكتملة</span></article>
      </div>
    </section>
    <section className="store-health-panel">
      <header><div><span className="economy-eyebrow">سلامة المخزون</span><h2>حالة الكتالوج</h2></div></header>
      <div className="store-health-row"><span>عناصر نشطة</span><strong>{summary?.activeCatalogItems.toLocaleString('ar-IQ') ?? '—'}</strong></div>
      <div className="store-health-row warning"><span>نفد مخزونها</span><strong>{summary?.soldOutItems.toLocaleString('ar-IQ') ?? '—'}</strong></div>
      <div className="store-health-row"><span>هدايا متاحة</span><strong>{summary?.activeGifts.toLocaleString('ar-IQ') ?? '—'}</strong></div>
      <div className="store-health-row"><span>أرقام مميزة متاحة</span><strong>{summary?.availableSpecialIds.toLocaleString('ar-IQ') ?? '—'}</strong></div>
    </section>
    <section className="store-recent-panel">
      <header><div><span className="economy-eyebrow">آخر الحركات</span><h2>سجل مباشر</h2></div><small>{loading ? 'جارٍ التحديث…' : `${recent.length.toLocaleString('ar-IQ')} حركات`}</small></header>
      {recent.map((item) => <article key={item.id}><TransactionType value={item.type} /><div><strong>{item.displayName || item.publicId || 'مستخدم'}</strong><small>{sourceLabel(item.source)}</small></div><div><b dir="ltr">{item.amount.toLocaleString('en-US')} {item.currency === 'coins' ? 'COIN' : 'DIA'}</b><time>{relativeTime(item.createdAt)}</time></div></article>)}
      {!loading && recent.length === 0 ? <p className="economy-overview-empty">لا توجد حركات اقتصادية حديثة.</p> : null}
    </section>
  </div>;
}

function GiftGrid({ items, onEdit }: { items: AdminGiftCatalogItem[]; onEdit?: (item: AdminGiftCatalogItem) => void }) {
  return <div className="gift-admin-grid">{items.map((item) => <article key={item.giftId}><div className={`gift-orb gift-${item.iconKey}`}>{giftIcon(item.iconKey)}</div><div className="gift-card-title"><div><h3>{item.nameAr}</h3><small dir="ltr">{item.giftId}</small></div><Status value={item.status} /></div><div className="gift-metrics"><span><small>السعر</small><strong>{item.price.toLocaleString('ar-IQ')} ◈</strong></span><span><small>القيمة</small><strong>{item.scoreValue.toLocaleString('ar-IQ')} نقطة</strong></span></div><footer><span>{relativeTime(item.updatedAt)}</span>{onEdit ? <button onClick={() => onEdit(item)} type="button">تعديل</button> : <span>للقراءة فقط</span>}</footer></article>)}</div>;
}

function SpecialIdsTable({ items, onEdit }: { items: AdminSpecialIdItem[]; onEdit?: (item: AdminSpecialIdItem) => void }) {
  return <div className="special-id-grid">{items.map((item) => <article className={`special-id-card status-${item.status}`} key={item.specialId}><div className="special-id-number" dir="ltr">{item.specialId}</div><div><Status value={item.status} /><strong>{item.price.toLocaleString('ar-IQ')} ◈</strong></div><p>{item.status === 'sold' ? `محجوز للمستخدم ${item.ownerUid || '—'}` : `آخر تعديل ${relativeTime(item.updatedAt)}`}</p>{onEdit ? <button disabled={item.status === 'sold'} onClick={() => onEdit(item)} type="button">{item.status === 'sold' ? 'مباع ومحمي' : 'إدارة الرقم'}</button> : <span className="economy-readonly">للقراءة فقط</span>}</article>)}</div>;
}

function LedgerTable({ items, onOpen }: { items: AdminEconomyTransaction[]; onOpen: (item: AdminEconomyTransaction) => void }) {
  return <div className="economy-table-wrap"><table className="economy-table ledger-table"><thead><tr><th>المستخدم</th><th>الحركة</th><th>القيمة</th><th>الرصيد بعدها</th><th>المصدر</th><th>المرجع</th><th>الوقت</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.displayName || 'مستخدم'}</strong><small dir="ltr">{item.specialId || item.publicId || item.uid}</small></td><td><TransactionType value={item.type} /></td><td className={item.type === 'credit' ? 'amount-positive' : 'amount-negative'} dir="ltr">{item.type === 'credit' ? '+' : '−'}{item.amount.toLocaleString('en-US')} {item.currency === 'coins' ? 'COIN' : 'DIA'}</td><td>{item.balanceAfter.toLocaleString('ar-IQ')}</td><td>{sourceLabel(item.source)}<small>{item.note || '—'}</small></td><td dir="ltr">{item.referenceId || '—'}</td><td>{formatDateTime(item.createdAt)}</td><td><button className="economy-row-action" onClick={() => onOpen(item)} type="button">التفاصيل</button></td></tr>)}</tbody></table></div>;
}

function GiftEditor({ editor, onClose, onSaved, user }: { editor: Extract<Editor, { kind: 'gift' }>; onClose: () => void; onSaved: () => void; user: User }) {
  const { confirm, notify } = useAdminFeedback(); const item = editor.item;
  const [giftId, setGiftId] = useState(item?.giftId || ''); const [nameAr, setNameAr] = useState(item?.nameAr || ''); const [iconKey, setIconKey] = useState<AdminGiftCatalogItem['iconKey']>(item?.iconKey || 'rose'); const [price, setPrice] = useState(item?.price || 1); const [scoreValue, setScoreValue] = useState(item?.scoreValue || 1); const [status, setStatus] = useState<'available' | 'disabled'>(item?.status || 'available'); const [reason, setReason] = useState(''); const [saving, setSaving] = useState(false);
  const [presentation, setPresentation] = useState<AdminGiftCatalogItem['presentation']>(item?.presentation || defaultGiftPresentation);
  const [theaterTags, setTheaterTags] = useState<Array<'combo' | 'storm' | 'lucky' | 'magic'>>(item?.theater?.tags || []);
  const [physicalApproval, setPhysicalApproval] = useState({
    androidDevice: item?.presentation.physicalApprovalReceiptId ? 'Recorded in immutable receipt' : '',
    androidPassed: Boolean(item?.presentation.physicalApprovalReceiptId),
    controlsSafeZonePassed: Boolean(item?.presentation.physicalApprovalReceiptId),
    iosDevice: item?.presentation.physicalApprovalReceiptId ? 'Recorded in immutable receipt' : '',
    iosPassed: Boolean(item?.presentation.physicalApprovalReceiptId),
    notes: item?.presentation.physicalApprovalReceiptId ? `Existing receipt: ${item.presentation.physicalApprovalReceiptId}` : '',
    testedClientVersion: item?.presentation.physicalApprovalReceiptId ? item.presentation.minimumClientVersion : '',
  });
  const reusesPhysicalApproval = Boolean(
    item?.presentation.physicalApprovalReceiptId
    && isSameGiftPresentationApprovalScope(presentation, item.presentation),
  );
  function updatePresentation(next: AdminGiftCatalogItem['presentation']) {
    setPresentation(next);
    if (item?.presentation.physicalApprovalReceiptId && !isSameGiftPresentationApprovalScope(next, item.presentation)) {
      setPhysicalApproval({
        androidDevice: '',
        androidPassed: false,
        controlsSafeZonePassed: false,
        iosDevice: '',
        iosPassed: false,
        notes: '',
        testedClientVersion: '',
      });
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (item?.status === 'available' && status === 'disabled' && !await confirm({ confirmLabel: 'إيقاف الهدية', description: 'ستتوقف الهدية عن الظهور للمرسلين الجدد.', destructive: true, title: 'تأكيد إيقاف الهدية' })) return;
    setSaving(true);
    try {
      const approvalMode = presentation.animationEnabled ? 'strict' : undefined;
      await upsertAdminGiftCatalog(user, {
        expectedUpdatedAt: item?.updatedAt,
        giftId,
        iconKey,
        nameAr,
        ...(approvalMode ? { physicalApproval } : {}),
        presentation: {
          ...presentation,
          ...(approvalMode ? { approvalMode } : {}),
        },
        price,
        reason,
        reusePhysicalApprovalReceipt: reusesPhysicalApproval,
        scoreValue,
        status,
        theater: { luckyTableId: 'default', tags: theaterTags },
      });
      notify('تم حفظ الهدية', { tone: 'success' });
      onSaved();
    } catch (cause) {
      notify('تعذّر حفظ الهدية', { description: failureMessage(cause), tone: 'error' });
    } finally {
      setSaving(false);
    }
  }
  return <Drawer title={item ? 'تعديل الهدية' : 'إضافة هدية'} subtitle="السعر والقيمة البصرية" onClose={onClose}>
    <form className="economy-editor-form" onSubmit={submit}>
      <div className="gift-editor-preview">
        <div className={`gift-orb gift-${iconKey}`}>{giftIcon(iconKey)}</div>
        <h3>{nameAr || 'اسم الهدية'}</h3>
        <p>{price.toLocaleString('ar-IQ')} عملة · {scoreValue.toLocaleString('ar-IQ')} نقطة · {presentation.tier}</p>
      </div>
      <div className="economy-form-grid">
        <label>معرّف الهدية<input disabled={Boolean(item)} pattern="[a-z0-9_-]{2,40}" required value={giftId} onChange={(e) => setGiftId(e.target.value)} /></label>
        <label>الاسم العربي<input minLength={2} required value={nameAr} onChange={(e) => setNameAr(e.target.value)} /></label>
        <label>الأيقونة<select value={iconKey} onChange={(e) => setIconKey(e.target.value as AdminGiftCatalogItem['iconKey'])}><option value="rose">وردة</option><option value="crown">تاج</option><option value="diamond">ألماسة</option><option value="heart">قلب</option><option value="star">نجمة</option></select></label>
        <label>الحالة<select value={status} onChange={(e) => setStatus(e.target.value as 'available' | 'disabled')}><option value="available">متاحة</option><option value="disabled">متوقفة</option></select></label>
        <label>السعر<input min="1" required type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} /></label>
        <label>قيمة النقاط<input min="1" required type="number" value={scoreValue} onChange={(e) => setScoreValue(Number(e.target.value))} /></label>
        <div className="span-2">
          <span>وسوم مسرح الهدايا</span>
          <div className="economy-checkbox-row">
            {(['combo', 'storm', 'lucky', 'magic'] as const).map((tag) => (
              <label className="economy-checkbox" key={tag}>
                <input
                  checked={theaterTags.includes(tag)}
                  onChange={(event) => setTheaterTags((current) => (
                    event.target.checked ? [...current, tag] : current.filter((value) => value !== tag)
                  ))}
                  type="checkbox"
                />
                <span>{tag}</span>
              </label>
            ))}
          </div>
          <small>storm يعزز العاصفة · lucky يفعل جدول الحظ · magic يطلب إطاراً معتمداً.</small>
        </div>
        <GiftPresentationEditorFields approval={physicalApproval} itemNameAr={nameAr} onApprovalChange={setPhysicalApproval} onChange={updatePresentation} value={presentation} />
        <label className="span-2 required-reason">سبب التغيير<textarea minLength={2} required value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </div>
      <EditorFooter saving={saving} onClose={onClose} />
    </form>
  </Drawer>;
}

function SpecialIdEditor({ editor, onClose, onSaved, user }: { editor: Extract<Editor, { kind: 'special-id' }>; onClose: () => void; onSaved: () => void; user: User }) {
  const { confirm, notify } = useAdminFeedback(); const item = editor.item; const [specialId, setSpecialId] = useState(item?.specialId || ''); const [price, setPrice] = useState(item?.price || 1); const [status, setStatus] = useState<'available' | 'disabled'>(item?.status === 'disabled' ? 'disabled' : 'available'); const [reason, setReason] = useState(''); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); if (item?.status === 'available' && status === 'disabled' && !await confirm({ confirmLabel: 'حجز الرقم', description: 'سيُمنع شراء الرقم حتى إعادة تفعيله.', destructive: true, title: 'تأكيد إيقاف الرقم' })) return; setSaving(true); try { await upsertAdminSpecialId(user, { expectedUpdatedAt: item?.updatedAt, price, reason, specialId, status }); notify('تم حفظ الرقم المميز', { tone: 'success' }); onSaved(); } catch (cause) { notify('تعذّر حفظ الرقم', { description: failureMessage(cause), tone: 'error' }); } finally { setSaving(false); } }
  return <Drawer title={item ? 'إدارة الرقم المميز' : 'إضافة رقم مميز'} subtitle="الأرقام المباعة محمية من التعديل" onClose={onClose}><form className="economy-editor-form" onSubmit={submit}><div className="special-id-preview" dir="ltr">{specialId || '0000000'}</div><div className="economy-form-grid"><label>الرقم المميز<input disabled={Boolean(item)} inputMode="numeric" pattern="[0-9]{7}" required value={specialId} onChange={(e) => setSpecialId(e.target.value)} /></label><label>السعر بالعملات<input min="1" required type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} /></label><label>الحالة<select value={status} onChange={(e) => setStatus(e.target.value as 'available' | 'disabled')}><option value="available">متاح</option><option value="disabled">محجوز إداريًا</option></select></label><label className="span-2 required-reason">سبب التغيير<textarea minLength={2} required value={reason} onChange={(e) => setReason(e.target.value)} /></label></div><EditorFooter saving={saving} onClose={onClose} /></form></Drawer>;
}

function TransactionDrawer({ item, onClose, onOpenItem }: { item: AdminEconomyTransaction; onClose: () => void; onOpenItem?: () => void }) {
  return <Drawer onClose={onClose} subtitle="مرجع مالي غير قابل للتعديل" title="تفاصيل الحركة">
    <div className="transaction-inspector">
      <section className="transaction-inspector-hero"><TransactionType value={item.type} /><div><span>{sourceLabel(item.source)}</span><strong dir="ltr">{item.amount.toLocaleString('en-US')} {item.currency === 'coins' ? 'COIN' : 'DIA'}</strong><small>{formatDateTime(item.createdAt)}</small></div></section>
      <dl>
        <div><dt>المستخدم</dt><dd>{item.displayName || 'مستخدم بلا اسم'}</dd></div>
        <div><dt>UID</dt><dd dir="ltr">{item.uid}</dd></div>
        <div><dt>Public ID</dt><dd dir="ltr">{item.publicId || '—'}</dd></div>
        <div><dt>الرقم المميز</dt><dd dir="ltr">{item.specialId || '—'}</dd></div>
        <div><dt>الرصيد بعد الحركة</dt><dd>{item.balanceAfter.toLocaleString('ar-IQ')}</dd></div>
        <div><dt>المنفذ</dt><dd dir="ltr">{item.actorUid || 'النظام'}</dd></div>
        <div><dt>مرجع العملية</dt><dd dir="ltr">{item.referenceId || '—'}</dd></div>
        <div><dt>معرّف القيد</dt><dd dir="ltr">{item.id}</dd></div>
      </dl>
      {item.note ? <section className="transaction-note"><span>ملاحظة العملية</span><p>{item.note}</p></section> : null}
      <div className="transaction-inspector-actions"><button className="secondary" onClick={() => void navigator.clipboard.writeText(item.id)} type="button">نسخ معرّف القيد</button>{onOpenItem ? <button className="secondary" onClick={onOpenItem} type="button">فتح ملف العنصر</button> : null}<button onClick={() => openUserWorkspace(item.uid)} type="button">فتح ملف المستخدم</button></div>
    </div>
  </Drawer>;
}

function Drawer({ children, onClose, subtitle, title }: { children: React.ReactNode; onClose: () => void; subtitle: string; title: string }) { useAdminDialogFocus(true, onClose, '.economy-drawer'); return <div className="economy-drawer-layer" role="presentation"><button aria-label="إغلاق" className="economy-drawer-backdrop" onClick={onClose} type="button" /><aside aria-label={title} aria-modal="true" className="economy-drawer" role="dialog" tabIndex={-1}><header><div><span>المتجر والاقتصاد</span><h2>{title}</h2><p>{subtitle}</p></div><button aria-label="إغلاق" onClick={onClose} type="button">×</button></header>{children}</aside></div>; }
function EditorFooter({ onClose, saving }: { onClose: () => void; saving: boolean }) { return <footer className="economy-editor-footer"><button className="secondary" disabled={saving} onClick={onClose} type="button">إلغاء</button><button disabled={saving} type="submit">{saving ? 'جارٍ الحفظ…' : 'حفظ التغييرات'}</button></footer>; }
function Price({ prices }: { prices: AdminStoreCatalogItem['prices'] }) { return <span className="economy-price">{prices.coins ? `${prices.coins.toLocaleString('ar-IQ')} ◈` : ''}{prices.coins && prices.diamonds ? ' · ' : ''}{prices.diamonds ? `${prices.diamonds.toLocaleString('ar-IQ')} ♦` : ''}</span>; }
function Status({ value }: { value: string }) { const labels: Record<string, string> = { available: 'متاح', disabled: 'متوقف', unavailable: 'غير متاح', sold: 'مباع' }; return <span className={`economy-status status-${value}`}>{labels[value] || value}</span>; }
function TransactionType({ value }: { value: AdminEconomyTransaction['type'] }) { return <span className={`transaction-type type-${value}`}>{({ credit: 'إضافة رصيد', debit: 'خصم إداري', purchase: 'شراء', transfer: 'تحويل' } as const)[value]}</span>; }
function tabIcon(tab: Tab) { return ({ overview: '◈', catalog: '◇', gifts: '♕', 'special-ids': '#', ledger: '↔' } as const)[tab]; }
function giftIcon(icon: AdminGiftCatalogItem['iconKey']) { return ({ rose: '✿', crown: '♕', diamond: '♦', heart: '♥', star: '★' } as const)[icon]; }
function categoryLabel(value: AdminStoreCatalogItem['category']) { return ({ 'game-items': 'عناصر اللعبة', 'chat-themes': 'سمات الدردشة', 'avatar-frames': 'إطارات الصور', 'profile-skins': 'خلفيات الملف', 'chat-bubbles': 'فقاعات الدردشة', nameplates: 'لوحات الاسم', 'cosmetic-badges': 'الشارات التجميلية', 'seat-effects': 'تأثيرات المقعد', 'couple-effects': 'تأثيرات الارتباط', stickers: 'ملصقات الدردشة', cars: 'السيارات', 'custom-ids': 'معرّفات مخصصة' } as const)[value]; }
function sourceLabel(value: string) { return ({ 'admin-credit': 'إضافة إدارية', 'admin-debit': 'خصم إداري', gift: 'هدية اجتماعية', 'special-id-store': 'شراء رقم مميز', store: 'شراء من المتجر', 'store-purchase': 'شراء من المتجر', 'store-gift': 'إهداء عنصر', 'representative-transfer': 'تحويل ممثل', 'representative-transfer-reversal': 'عكس تحويل ممثل' } as Record<string, string>)[value] || value || 'غير محدد'; }
function durationLabel(value: AdminStoreCatalogItem['duration']) { return value.kind === 'permanent' ? 'دائم' : `${value.value.toLocaleString('ar-IQ')} ${value.unit === 'days' ? 'يوم' : value.unit === 'weeks' ? 'أسبوع' : 'شهر'}`; }
function openUserWorkspace(uid: string) { window.history.pushState({}, '', `/users?user=${encodeURIComponent(uid)}`); window.dispatchEvent(new PopStateEvent('popstate')); }
function downloadCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}
function failureMessage(cause: unknown) { return cause instanceof Error ? cause.message : 'حدث خطأ غير متوقع.'; }
function relativeTime(value: string) { if (!value) return 'غير محدد'; const delta = Date.now() - Date.parse(value); if (!Number.isFinite(delta)) return 'غير محدد'; const minutes = Math.max(0, Math.floor(delta / 60000)); if (minutes < 1) return 'الآن'; if (minutes < 60) return `منذ ${minutes.toLocaleString('ar-IQ')} د`; const hours = Math.floor(minutes / 60); if (hours < 24) return `منذ ${hours.toLocaleString('ar-IQ')} س`; return `منذ ${Math.floor(hours / 24).toLocaleString('ar-IQ')} يوم`; }
function formatDateTime(value: string) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'short', timeStyle: 'short' }).format(date); }
