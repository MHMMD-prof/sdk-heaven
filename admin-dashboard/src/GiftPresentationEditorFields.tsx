import type { AdminGiftCatalogItem } from './adminDashboardApi';
import { BottomEffectStagePreview } from './BottomEffectStagePreview';

export type GiftPhysicalApprovalDraft = {
  androidDevice: string;
  androidPassed: boolean;
  controlsSafeZonePassed: boolean;
  iosDevice: string;
  iosPassed: boolean;
  notes: string;
  testedClientVersion: string;
};

export const defaultGiftPresentation: AdminGiftCatalogItem['presentation'] = {
  animationEnabled: false,
  durationMs: 3_000,
  hapticPolicy: 'off',
  minimumClientVersion: '0.0.0',
  performanceTier: 'low',
  schemaVersion: 1,
  soundPolicy: 'off',
  tier: 'inline',
};

export const defaultStrictAnimatedPresentation: AdminGiftCatalogItem['presentation'] = {
  animationEnabled: true,
  approvalMode: 'strict',
  durationMs: 3_000,
  hapticPolicy: 'off',
  minimumClientVersion: '0.0.0',
  performanceTier: 'standard',
  schemaVersion: 1,
  soundPolicy: 'off',
  tier: 'major',
  visualFormat: 'mp4',
};

export function GiftPresentationEditorFields({ approval, itemNameAr, onApprovalChange, onChange, value }: {
  approval: GiftPhysicalApprovalDraft;
  itemNameAr: string;
  onApprovalChange: (value: GiftPhysicalApprovalDraft) => void;
  onChange: (value: AdminGiftCatalogItem['presentation']) => void;
  value: AdminGiftCatalogItem['presentation'];
}) {
  const setReference = (kind: 'visualAsset' | 'fallbackAsset' | 'audioAsset', field: 'assetId' | 'assetVersionId', next: string) => {
    const current = value[kind] || { assetId: '', assetVersionId: '' };
    onChange({ ...value, [kind]: { ...current, [field]: next.trim() } });
  };
  return <>
    <label className="field span-2 economy-checkbox">
      <span>عرض متحرك للهدية</span>
      <input
        checked={value.animationEnabled}
        onChange={(event) => onChange(event.target.checked
          ? { ...defaultStrictAnimatedPresentation }
          : defaultGiftPresentation)}
        type="checkbox"
      />
      <small>اقتصاد الهدية لا يعتمد على الحركة. كل عرض متحرك جديد يحتاج اعتماد Android وiOS ومنطقة التحكم الآمنة.</small>
    </label>
    <label className="field">
      <span>مستوى العرض</span>
      <select disabled={!value.animationEnabled} value={value.tier} onChange={(event) => onChange({ ...value, tier: event.target.value as AdminGiftCatalogItem['presentation']['tier'] })}>
        <option value="inline">مدمج</option>
        <option value="targeted">مقعد مستهدف</option>
        <option value="major">غرفة رئيسية</option>
        <option value="global">حملة عامة</option>
      </select>
    </label>
    <label className="field">
      <span>المدة (مللي ثانية)</span>
      <input disabled={!value.animationEnabled} max="6000" min="1500" type="number" value={value.durationMs} onChange={(event) => onChange({ ...value, durationMs: Number(event.target.value) })} />
    </label>
    <label className="field">
      <span>مستوى الأداء</span>
      <select disabled={!value.animationEnabled} value={value.performanceTier} onChange={(event) => onChange({ ...value, performanceTier: event.target.value as AdminGiftCatalogItem['presentation']['performanceTier'] })}>
        <option value="low">منخفض</option>
        <option value="standard">قياسي</option>
        <option value="high">مرتفع</option>
      </select>
    </label>
    <label className="field">
      <span>أدنى إصدار للعميل</span>
      <input dir="ltr" disabled={!value.animationEnabled} pattern="[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}" value={value.minimumClientVersion} onChange={(event) => onChange({ ...value, minimumClientVersion: event.target.value })} />
    </label>
    <label className="field">
      <span>الصوت</span>
      <select disabled={!value.animationEnabled} value={value.soundPolicy} onChange={(event) => onChange({ ...value, soundPolicy: event.target.value as AdminGiftCatalogItem['presentation']['soundPolicy'], ...(event.target.value === 'off' ? { audioAsset: undefined } : {}) })}>
        <option value="off">متوقف</option>
        <option value="soft">خفيف</option>
        <option value="full">كامل</option>
      </select>
    </label>
    <label className="field">
      <span>الاهتزاز</span>
      <select disabled={!value.animationEnabled} value={value.hapticPolicy} onChange={(event) => onChange({ ...value, hapticPolicy: event.target.value as AdminGiftCatalogItem['presentation']['hapticPolicy'] })}>
        <option value="off">متوقف</option>
        <option value="light">خفيف</option>
        <option value="success">نجاح</option>
      </select>
    </label>
    {value.animationEnabled ? <>
      <label className="field">
        <span>صيغة العرض</span>
        <select value={value.visualFormat || ''} onChange={(event) => onChange({ ...value, visualFormat: event.target.value as 'mp4' | 'lottie-json' })}>
          <option value="">تُستنتج من الأصل</option>
          <option value="mp4">MP4</option>
          <option value="lottie-json">Lottie</option>
        </select>
      </label>
      <label className="field">
        <span>معرّف الأصل المرئي</span>
        <input dir="ltr" required value={value.visualAsset?.assetId || ''} onChange={(event) => setReference('visualAsset', 'assetId', event.target.value)} />
      </label>
      <label className="field">
        <span>إصدار الأصل المرئي</span>
        <input dir="ltr" required value={value.visualAsset?.assetVersionId || ''} onChange={(event) => setReference('visualAsset', 'assetVersionId', event.target.value)} />
      </label>
      <label className="field">
        <span>معرّف أصل الاحتياط (PNG/JPEG)</span>
        <input dir="ltr" required value={value.fallbackAsset?.assetId || ''} onChange={(event) => setReference('fallbackAsset', 'assetId', event.target.value)} />
      </label>
      <label className="field">
        <span>إصدار أصل الاحتياط</span>
        <input dir="ltr" required value={value.fallbackAsset?.assetVersionId || ''} onChange={(event) => setReference('fallbackAsset', 'assetVersionId', event.target.value)} />
      </label>
      {value.soundPolicy !== 'off' ? <>
        <label className="field">
          <span>معرّف أصل الصوت</span>
          <input dir="ltr" required value={value.audioAsset?.assetId || ''} onChange={(event) => setReference('audioAsset', 'assetId', event.target.value)} />
        </label>
        <label className="field">
          <span>إصدار أصل الصوت</span>
          <input dir="ltr" required value={value.audioAsset?.assetVersionId || ''} onChange={(event) => setReference('audioAsset', 'assetVersionId', event.target.value)} />
        </label>
      </> : null}
      <div className="span-2 gift-presentation-preview">
        <strong>إيصال معاينة غير قابل للتعديل بالإصدار الدقيق</strong>
        <code dir="ltr">{value.visualAsset?.assetId || 'visual'} / {value.visualAsset?.assetVersionId || 'version'}</code>
        <small dir="ltr">fallback: {value.fallbackAsset?.assetId || 'required'} / {value.fallbackAsset?.assetVersionId || 'version'}</small>
        <small dir="ltr">audio: {value.audioAsset?.assetId || 'off'} / {value.audioAsset?.assetVersionId || 'off'}</small>
      </div>
      <div className="span-2">
        <BottomEffectStagePreview
          animationEnabled={value.animationEnabled}
          approval={approval}
          itemNameAr={itemNameAr}
          kind="gift"
          tier={value.tier}
          visualFormat={value.visualFormat}
        />
      </div>
      <label className="field economy-checkbox">
        <span>نجاح الاختبار على Android</span>
        <input checked={approval.androidPassed} onChange={(event) => onApprovalChange({ ...approval, androidPassed: event.target.checked })} required type="checkbox" />
      </label>
      <label className="field economy-checkbox">
        <span>نجاح الاختبار على iOS</span>
        <input checked={approval.iosPassed} onChange={(event) => onApprovalChange({ ...approval, iosPassed: event.target.checked })} required type="checkbox" />
      </label>
      <label className="field span-2 economy-checkbox">
        <span>نجاح منطقة عناصر التحكم الآمنة</span>
        <input checked={approval.controlsSafeZonePassed} onChange={(event) => onApprovalChange({ ...approval, controlsSafeZonePassed: event.target.checked })} required type="checkbox" />
        <small>يجب ألا يغطي التأثير أزرار المغادرة أو الإشراف أو الاتصال في حجمي الهاتف.</small>
      </label>
      <label className="field">
        <span>جهاز Android</span>
        <input dir="ltr" required value={approval.androidDevice} onChange={(event) => onApprovalChange({ ...approval, androidDevice: event.target.value })} />
      </label>
      <label className="field">
        <span>جهاز iOS</span>
        <input dir="ltr" required value={approval.iosDevice} onChange={(event) => onApprovalChange({ ...approval, iosDevice: event.target.value })} />
      </label>
      <label className="field">
        <span>إصدار العميل المختبَر</span>
        <input dir="ltr" pattern="[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}" required value={approval.testedClientVersion} onChange={(event) => onApprovalChange({ ...approval, testedClientVersion: event.target.value })} />
      </label>
      <label className="field span-2">
        <span>ملاحظات الاختبار الفعلي</span>
        <textarea value={approval.notes} onChange={(event) => onApprovalChange({ ...approval, notes: event.target.value })} />
      </label>
    </> : null}
  </>;
}
