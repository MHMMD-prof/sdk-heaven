import type { AdminEntryPhysicalApproval, AdminEntryPresentation } from './adminDashboardApi';

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

export function EntryPresentationEditorFields({ approval, onApprovalChange, onChange, value }: {
  approval: AdminEntryPhysicalApproval;
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
    <label className="span-2 economy-checkbox">
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
      Enable approved entrance motion
      <small>Room joining and voice connection never wait for this effect.</small>
    </label>
    <label>Duration (ms)<input disabled={!value.animationEnabled} max="5000" min="3000" type="number" value={value.durationMs} onChange={(event) => onChange({ ...value, durationMs: Number(event.target.value) })} /></label>
    <label>Performance<select disabled={!value.animationEnabled} value={value.performanceTier} onChange={(event) => onChange({ ...value, performanceTier: event.target.value as AdminEntryPresentation['performanceTier'] })}><option value="low">Low</option><option value="standard">Standard</option><option value="high">High</option></select></label>
    <label>Minimum client<input disabled={!value.animationEnabled} pattern="[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}" value={value.minimumClientVersion} onChange={(event) => onChange({ ...value, minimumClientVersion: event.target.value })} /></label>
    <label>Visual format<select disabled={!value.animationEnabled} value={value.visualFormat || 'lottie-json'} onChange={(event) => onChange({ ...value, visualFormat: event.target.value as 'lottie-json' | 'mp4' })}><option value="lottie-json">Lottie JSON</option><option value="mp4">Opaque MP4</option></select></label>
    <label>Sound<select disabled={!value.animationEnabled} value={value.soundPolicy} onChange={(event) => onChange({ ...value, soundPolicy: event.target.value as AdminEntryPresentation['soundPolicy'], ...(event.target.value === 'off' ? { audioAsset: undefined } : {}) })}><option value="off">Off</option><option value="soft">Soft</option><option value="full">Full</option></select></label>
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
        <strong>Exact immutable entry bundle</strong>
        <code>{value.visualAsset?.assetId || 'visual'} / {value.visualAsset?.assetVersionId || 'version'}</code>
        <small>Fallback: {value.fallbackAsset?.assetId || 'required'} / {value.fallbackAsset?.assetVersionId || 'version'}</small>
      </div>
      <label><span>Android physical pass</span><input checked={approval.androidPassed} onChange={(event) => onApprovalChange({ ...approval, androidPassed: event.target.checked })} required type="checkbox" /></label>
      <label><span>iOS physical pass</span><input checked={approval.iosPassed} onChange={(event) => onApprovalChange({ ...approval, iosPassed: event.target.checked })} required type="checkbox" /></label>
      <label className="span-2"><span>Controls safe-zone pass</span><input checked={approval.controlsSafeZonePassed} onChange={(event) => onApprovalChange({ ...approval, controlsSafeZonePassed: event.target.checked })} required type="checkbox" /><small>Effect must not cover leave, moderation, or connection controls.</small></label>
      {value.visualFormat === 'mp4' ? <label className="span-2"><span>Opaque MP4 composition pass</span><input checked={approval.opaqueCompositionPassed} onChange={(event) => onApprovalChange({ ...approval, opaqueCompositionPassed: event.target.checked })} required type="checkbox" /></label> : null}
      <label>Android device<input required value={approval.androidDevice} onChange={(event) => onApprovalChange({ ...approval, androidDevice: event.target.value })} /></label>
      <label>iOS device<input required value={approval.iosDevice} onChange={(event) => onApprovalChange({ ...approval, iosDevice: event.target.value })} /></label>
      <label>Tested client version<input pattern="[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}" required value={approval.testedClientVersion} onChange={(event) => onApprovalChange({ ...approval, testedClientVersion: event.target.value })} /></label>
      <label className="span-2">Physical test notes<textarea value={approval.notes} onChange={(event) => onApprovalChange({ ...approval, notes: event.target.value })} /></label>
    </> : null}
  </>;
}

export async function createEntryPhysicalApprovalReceiptId(itemId: string, visualVersionId: string) {
  const bytes = new TextEncoder().encode(`${itemId}|${visualVersionId}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  return `entry_physical_${hex.slice(0, 32)}`;
}
