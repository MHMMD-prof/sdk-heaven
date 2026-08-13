import type { AdminEntryPhysicalApproval, AdminEntryPresentation } from './adminDashboardApi';
import { BottomEffectStagePreview } from './BottomEffectStagePreview';

export const defaultEntryPresentation: AdminEntryPresentation = {
  animationEnabled: false,
  durationMs: 4_000,
  minimumClientVersion: '0.0.0',
  performanceTier: 'low',
  schemaVersion: 1,
  soundPolicy: 'off',
};

export const defaultEntryPhysicalApproval: AdminEntryPhysicalApproval = {
  androidDevice: '',
  androidPassed: false,
  controlsSafeZonePassed: false,
  iosDevice: '',
  iosPassed: false,
  notes: '',
  opaqueCompositionPassed: false,
  testedClientVersion: '',
};

export function EntryPresentationEditorFields({ approval, itemNameAr, onApprovalChange, onChange, value }: {
  approval: AdminEntryPhysicalApproval;
  itemNameAr: string;
  onApprovalChange: (value: AdminEntryPhysicalApproval) => void;
  onChange: (value: AdminEntryPresentation) => void;
  value: AdminEntryPresentation;
}) {
  const setReference = (
    kind: 'visualAsset' | 'fallbackAsset' | 'audioAsset',
    field: 'assetId' | 'assetVersionId',
    next: string,
  ) => {
    const current = value[kind] || { assetId: '', assetVersionId: '' };
    onChange({ ...value, [kind]: { ...current, [field]: next.trim() } });
  };
  return <>
    <label className="field span-2 economy-checkbox">
      <span>تفعيل حركة الدخول المعتمدة</span>
      <input
        checked={value.animationEnabled}
        onChange={(event) => onChange(event.target.checked ? {
          ...defaultEntryPresentation,
          animationEnabled: true,
          fallbackAsset: { assetId: '', assetVersionId: '' },
          performanceTier: 'standard',
          visualAsset: { assetId: '', assetVersionId: '' },
          visualFormat: 'lottie-json',
        } : defaultEntryPresentation)}
        type="checkbox"
      />
      <small>الانضمام للغرفة واتصال الصوت لا ينتظران هذا التأثير أبدًا.</small>
    </label>
    <label className="field">
      <span>المدة (مللي ثانية)</span>
      <input disabled={!value.animationEnabled} max="5000" min="3000" type="number" value={value.durationMs} onChange={(event) => onChange({ ...value, durationMs: Number(event.target.value) })} />
    </label>
    <label className="field">
      <span>مستوى الأداء</span>
      <select disabled={!value.animationEnabled} value={value.performanceTier} onChange={(event) => onChange({ ...value, performanceTier: event.target.value as AdminEntryPresentation['performanceTier'] })}>
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
      <span>صيغة العرض</span>
      <select disabled={!value.animationEnabled} value={value.visualFormat || 'lottie-json'} onChange={(event) => onChange({ ...value, visualFormat: event.target.value as 'lottie-json' | 'mp4' })}>
        <option value="lottie-json">Lottie JSON</option>
        <option value="mp4">MP4 معتم</option>
      </select>
    </label>
    <label className="field">
      <span>الصوت</span>
      <select disabled={!value.animationEnabled} value={value.soundPolicy} onChange={(event) => onChange({ ...value, soundPolicy: event.target.value as AdminEntryPresentation['soundPolicy'], ...(event.target.value === 'off' ? { audioAsset: undefined } : {}) })}>
        <option value="off">متوقف</option>
        <option value="soft">خفيف</option>
        <option value="full">كامل</option>
      </select>
    </label>
    {value.animationEnabled ? <>
      <label className="field">
        <span>معرّف الأصل المرئي</span>
        <input dir="ltr" required value={value.visualAsset?.assetId || ''} onChange={(event) => setReference('visualAsset', 'assetId', event.target.value)} />
      </label>
      <label className="field">
        <span>إصدار الأصل المرئي</span>
        <input dir="ltr" required value={value.visualAsset?.assetVersionId || ''} onChange={(event) => setReference('visualAsset', 'assetVersionId', event.target.value)} />
      </label>
      <label className="field">
        <span>معرّف أصل الاحتياط</span>
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
        <strong>حزمة الدخول غير القابلة للتغيير</strong>
        <code dir="ltr">{value.visualAsset?.assetId || 'visual'} / {value.visualAsset?.assetVersionId || 'version'}</code>
        <small dir="ltr">احتياط: {value.fallbackAsset?.assetId || 'required'} / {value.fallbackAsset?.assetVersionId || 'version'}</small>
      </div>
      <div className="span-2">
        <BottomEffectStagePreview
          animationEnabled={value.animationEnabled}
          approval={approval}
          itemNameAr={itemNameAr}
          kind="entry"
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
        <small>يجب ألا يغطي التأثير أزرار المغادرة أو الإشراف أو الاتصال.</small>
      </label>
      {value.visualFormat === 'mp4' ? (
        <label className="field span-2 economy-checkbox">
          <span>نجاح تركيبة MP4 المعتمة</span>
          <input checked={approval.opaqueCompositionPassed} onChange={(event) => onApprovalChange({ ...approval, opaqueCompositionPassed: event.target.checked })} required type="checkbox" />
        </label>
      ) : null}
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

export async function createEntryPhysicalApprovalReceiptId(itemId: string, visualVersionId: string) {
  const bytes = new TextEncoder().encode(`${itemId}|${visualVersionId}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  return `entry_physical_${hex.slice(0, 32)}`;
}
