import { lazy, Suspense, useState } from 'react';
import type { User } from 'firebase/auth';

import type { AuthoredCosmeticAssetBundle } from './CosmeticAssetAuthoringDialog';
import type { CosmeticAssetReference, CosmeticAssetRequirement } from './cosmeticAssetAuthoring';

const CosmeticAssetAuthoringDialog = lazy(async () => {
  const module = await import('./CosmeticAssetAuthoringDialog');
  return { default: module.CosmeticAssetAuthoringDialog };
});

export function CosmeticAssetField({ initialAssetId, onClear, onSelect, reference, requirement, user }: {
  initialAssetId?: string;
  onClear?: () => void;
  onSelect: (bundle: AuthoredCosmeticAssetBundle) => void;
  reference?: CosmeticAssetReference;
  requirement: CosmeticAssetRequirement;
  user: User;
}) {
  const [open, setOpen] = useState(false);
  return <div className="cosmetic-asset-field span-2">
    <div><span>{requirement.label}</span>{reference ? <><code dir="ltr">{reference.assetId}</code><small dir="ltr">{reference.assetVersionId}</small></> : <small>لم يتم اختيار أصل معتمد بعد.</small>}</div>
    <div className="cosmetic-asset-field-actions">
      <button onClick={() => setOpen(true)} type="button">{reference ? 'تغيير الأصل' : 'اختيار أو رفع أصل'}</button>
      {reference && onClear ? <button className="secondary" onClick={onClear} type="button">إزالة</button> : null}
    </div>
    {open ? <Suspense fallback={<div className="asset-authoring-loading" role="status">جارٍ فتح محرر الأصل…</div>}><CosmeticAssetAuthoringDialog initialAssetId={initialAssetId} onClose={() => setOpen(false)} onSelect={onSelect} requirement={requirement} user={user} /></Suspense> : null}
  </div>;
}
