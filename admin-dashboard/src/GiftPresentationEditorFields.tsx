import type { AdminGiftCatalogItem } from './adminDashboardApi';

export type GiftPhysicalApprovalDraft = {
  androidDevice: string;
  androidPassed: boolean;
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

export function GiftPresentationEditorFields({ approval, onApprovalChange, onChange, value }: {
  approval: GiftPhysicalApprovalDraft;
  onApprovalChange: (value: GiftPhysicalApprovalDraft) => void;
  onChange: (value: AdminGiftCatalogItem['presentation']) => void;
  value: AdminGiftCatalogItem['presentation'];
}) {
  const setReference = (kind: 'visualAsset' | 'fallbackAsset' | 'audioAsset', field: 'assetId' | 'assetVersionId', next: string) => {
    const current = value[kind] || { assetId: '', assetVersionId: '' };
    onChange({ ...value, [kind]: { ...current, [field]: next.trim() } });
  };
  return <>
    <label className="span-2">
      <span>Animated presentation</span>
      <input
        checked={value.animationEnabled}
        onChange={(event) => onChange(event.target.checked
          ? { ...defaultGiftPresentation, animationEnabled: true, performanceTier: 'standard' }
          : defaultGiftPresentation)}
        type="checkbox"
      />
      <small>The gift economy stays active when animation is disabled.</small>
    </label>
    <label>Presentation tier<select disabled={!value.animationEnabled} value={value.tier} onChange={(event) => onChange({ ...value, tier: event.target.value as AdminGiftCatalogItem['presentation']['tier'] })}><option value="inline">Inline</option><option value="targeted">Targeted seat</option><option value="major">Major room</option><option value="global">Global campaign</option></select></label>
    <label>Duration (ms)<input disabled={!value.animationEnabled} max="6000" min="1500" type="number" value={value.durationMs} onChange={(event) => onChange({ ...value, durationMs: Number(event.target.value) })} /></label>
    <label>Performance<select disabled={!value.animationEnabled} value={value.performanceTier} onChange={(event) => onChange({ ...value, performanceTier: event.target.value as AdminGiftCatalogItem['presentation']['performanceTier'] })}><option value="low">Low</option><option value="standard">Standard</option><option value="high">High</option></select></label>
    <label>Minimum client<input disabled={!value.animationEnabled} pattern="[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}" value={value.minimumClientVersion} onChange={(event) => onChange({ ...value, minimumClientVersion: event.target.value })} /></label>
    <label>Sound<select disabled={!value.animationEnabled} value={value.soundPolicy} onChange={(event) => onChange({ ...value, soundPolicy: event.target.value as AdminGiftCatalogItem['presentation']['soundPolicy'], ...(event.target.value === 'off' ? { audioAsset: undefined } : {}) })}><option value="off">Off</option><option value="soft">Soft</option><option value="full">Full</option></select></label>
    <label>Haptics<select disabled={!value.animationEnabled} value={value.hapticPolicy} onChange={(event) => onChange({ ...value, hapticPolicy: event.target.value as AdminGiftCatalogItem['presentation']['hapticPolicy'] })}><option value="off">Off</option><option value="light">Light</option><option value="success">Success</option></select></label>
    {value.animationEnabled ? <>
      <label>Visual asset ID<input required value={value.visualAsset?.assetId || ''} onChange={(event) => setReference('visualAsset', 'assetId', event.target.value)} /></label>
      <label>Visual version<input required value={value.visualAsset?.assetVersionId || ''} onChange={(event) => setReference('visualAsset', 'assetVersionId', event.target.value)} /></label>
      <label>Fallback asset ID<input required value={value.fallbackAsset?.assetId || ''} onChange={(event) => setReference('fallbackAsset', 'assetId', event.target.value)} /></label>
      <label>Fallback version<input required value={value.fallbackAsset?.assetVersionId || ''} onChange={(event) => setReference('fallbackAsset', 'assetVersionId', event.target.value)} /></label>
      {value.soundPolicy !== 'off' ? <>
        <label>Audio asset ID<input required value={value.audioAsset?.assetId || ''} onChange={(event) => setReference('audioAsset', 'assetId', event.target.value)} /></label>
        <label>Audio version<input required value={value.audioAsset?.assetVersionId || ''} onChange={(event) => setReference('audioAsset', 'assetVersionId', event.target.value)} /></label>
      </> : null}
      <div className="span-2 gift-presentation-preview">
        <strong>Exact-version preview receipt</strong>
        <code>{value.visualAsset?.assetId || 'visual'} / {value.visualAsset?.assetVersionId || 'version'}</code>
        <small>Fallback: {value.fallbackAsset?.assetId || 'required'} / {value.fallbackAsset?.assetVersionId || 'version'}</small>
      </div>
      <label><span>Android physical pass</span><input checked={approval.androidPassed} onChange={(event) => onApprovalChange({ ...approval, androidPassed: event.target.checked })} required type="checkbox" /></label>
      <label><span>iOS physical pass</span><input checked={approval.iosPassed} onChange={(event) => onApprovalChange({ ...approval, iosPassed: event.target.checked })} required type="checkbox" /></label>
      <label>Android device<input required value={approval.androidDevice} onChange={(event) => onApprovalChange({ ...approval, androidDevice: event.target.value })} /></label>
      <label>iOS device<input required value={approval.iosDevice} onChange={(event) => onApprovalChange({ ...approval, iosDevice: event.target.value })} /></label>
      <label>Tested client version<input pattern="[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}" required value={approval.testedClientVersion} onChange={(event) => onApprovalChange({ ...approval, testedClientVersion: event.target.value })} /></label>
      <label className="span-2">Physical test notes<textarea value={approval.notes} onChange={(event) => onApprovalChange({ ...approval, notes: event.target.value })} /></label>
    </> : null}
  </>;
}
