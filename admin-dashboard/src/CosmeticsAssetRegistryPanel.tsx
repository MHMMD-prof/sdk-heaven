import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';

import {
  AdminCosmeticAssetDetail,
  AdminCosmeticAssetSummary,
  mutateAdminCosmeticAsset,
  requestAdminCosmeticAssets,
} from './adminDashboardApi';
import { useAdminFeedback } from './AdminFeedback';
import { uploadCosmeticAsset } from './storeAssets';
import './CosmeticsAssetRegistryPanel.css';

const categories = [
  'avatar-frame', 'profile-skin', 'chat-bubble', 'nameplate',
  'cosmetic-badge', 'entry-effect', 'seat-effect', 'gift-effect',
  'room-theme', 'room-reaction', 'couple-effect', 'effect-audio',
] as const;
const formats = ['png', 'jpeg', 'lottie-json', 'mp4', 'm4a-aac'] as const;
const categorySlots: Record<string, string> = {
  'avatar-frame': 'avatar-frame',
  'chat-bubble': 'chat-bubble',
  'cosmetic-badge': 'cosmetic-badge',
  'entry-effect': 'entry-effect',
  nameplate: 'nameplate',
  'profile-skin': 'profile-skin',
  'seat-effect': 'seat-effect',
};

type Draft = {
  assetId: string;
  assetVersionId: string;
  audioAssetId: string;
  audioAssetVersionId: string;
  category: (typeof categories)[number];
  fallbackAssetId: string;
  fallbackAssetVersionId: string;
  format: (typeof formats)[number];
  loop: boolean;
  minimumClientVersion: string;
  ownerType: 'platform' | 'user';
  ownerUid: string;
  performanceTier: 'low' | 'standard' | 'high';
};

const initialDraft: Draft = {
  assetId: '',
  assetVersionId: `v1-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
  audioAssetId: '',
  audioAssetVersionId: '',
  category: 'avatar-frame',
  fallbackAssetId: '',
  fallbackAssetVersionId: '',
  format: 'png',
  loop: false,
  minimumClientVersion: '1.0.0',
  ownerType: 'platform',
  ownerUid: '',
  performanceTier: 'low',
};

export function CosmeticsAssetRegistryPanel({
  permissions,
  user,
}: {
  permissions: string[];
  user: User;
}) {
  const { confirm, notify } = useAdminFeedback();
  const canManage = permissions.includes('store:manage');
  const [assets, setAssets] = useState<AdminCosmeticAssetSummary[]>([]);
  const [category, setCategory] = useState('');
  const [moderationStatus, setModerationStatus] = useState('');
  const [publicationStatus, setPublicationStatus] = useState('');
  const [selected, setSelected] = useState<AdminCosmeticAssetDetail>();
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [file, setFile] = useState<File>();
  const [reason, setReason] = useState('');
  const [authoritySeparationPassed, setAuthoritySeparationPassed] = useState(false);
  const [readableIdentityPassed, setReadableIdentityPassed] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const registry = await requestAdminCosmeticAssets(user, {
        category,
        moderationStatus,
        publicationStatus,
      });
      setAssets('assets' in registry ? registry.assets || [] : []);
      setState('ready');
    } catch (cause) {
      setError(message(cause));
      setState('error');
    }
  }, [category, moderationStatus, publicationStatus, user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(assetId: string) {
    setBusy(true);
    try {
      const registry = await requestAdminCosmeticAssets(user, { assetId });
      if ('asset' in registry) setSelected(registry);
    } catch (cause) {
      notify('Could not load asset', { description: message(cause), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function register(event: FormEvent) {
    event.preventDefault();
    if (!file || reason.trim().length < 3) {
      setError('Choose the exact source file and enter a review reason.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const existing = await requestAdminCosmeticAssets(user, { assetId: draft.assetId });
      const expectedRevision = 'asset' in existing ? existing.asset?.revision || 0 : 0;
      await uploadCosmeticAsset(user, {
        assetId: draft.assetId,
        assetVersionId: draft.assetVersionId,
        file,
        format: draft.format,
        ownerType: draft.ownerType,
        ownerUid: draft.ownerUid || undefined,
      });
      await mutateAdminCosmeticAsset(user, {
        asset: {
          assetId: draft.assetId,
          assetVersionId: draft.assetVersionId,
          ...(draft.audioAssetId ? {
            audioAssetId: draft.audioAssetId,
            audioAssetVersionId: draft.audioAssetVersionId,
          } : {}),
          category: draft.category,
          ...(draft.fallbackAssetId ? {
            fallbackAssetId: draft.fallbackAssetId,
            fallbackAssetVersionId: draft.fallbackAssetVersionId,
          } : {}),
          format: draft.format,
          loop: draft.loop,
          minimumClientVersion: draft.minimumClientVersion,
          ownerType: draft.ownerType,
          ...(draft.ownerUid ? { ownerUid: draft.ownerUid } : {}),
          performanceTier: draft.performanceTier,
          ...(categorySlots[draft.category] ? { slot: categorySlots[draft.category] } : {}),
          usage: staticFormat(draft.format) ? 'static' : draft.loop ? 'looping' : 'one-shot',
        },
        expectedRevision,
        operation: 'validate-version',
        reason: reason.trim(),
      });
      notify('Version validated', {
        description: 'The immutable version is pending moderation and is not public.',
        tone: 'success',
      });
      setFile(undefined);
      setReason('');
      setDraft({
        ...initialDraft,
        assetVersionId: `v1-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
      });
      await load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function mutate(
    operation:
      | 'approve-version'
      | 'reject-version'
      | 'publish-version'
      | 'emergency-disable'
      | 'suspend'
      | 'rollback-version',
    assetVersionId = '',
  ) {
    const asset = selected?.asset;
    if (!asset || reason.trim().length < 3) {
      setError('Select an asset and enter a reason before changing its state.');
      return;
    }
    if (['reject-version', 'emergency-disable', 'suspend', 'rollback-version'].includes(operation)) {
      const accepted = await confirm({
        confirmLabel: operation === 'rollback-version' ? 'Rollback' : 'Continue',
        description: `${operation} will be audited and changes public availability immediately when applicable.`,
        destructive: true,
        title: `Confirm ${operation}`,
      });
      if (!accepted) return;
    }
    setBusy(true);
    setError('');
    try {
      await mutateAdminCosmeticAsset(user, {
        assetId: asset.assetId,
        assetVersionId,
        ...(operation === 'rollback-version'
          ? { confirmation: `ROLLBACK ${asset.assetId} ${assetVersionId}` }
          : operation === 'suspend'
            ? { confirmation: `SUSPEND ${asset.assetId}` }
            : {}),
        expectedRevision: asset.revision,
        operation,
        reason: reason.trim(),
        ...(operation === 'approve-version' && ['nameplate', 'cosmetic-badge'].includes(asset.category) ? {
          authoritySeparationPassed,
          readableIdentityPassed,
        } : {}),
      });
      setReason('');
      setAuthoritySeparationPassed(false);
      setReadableIdentityPassed(false);
      await open(asset.assetId);
      await load();
      notify('Asset state updated', { tone: 'success' });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  const expectedPath = useMemo(() => {
    const extension = {
      jpeg: 'jpg',
      'lottie-json': 'json',
      'm4a-aac': 'm4a',
      mp4: 'mp4',
      png: 'png',
    }[draft.format];
    const owner = draft.ownerType === 'platform' ? 'platform' : `users/${draft.ownerUid || '{uid}'}`;
    return `cosmetic-assets/${owner}/${draft.assetId || '{assetId}'}/${draft.assetVersionId}/source.${extension}`;
  }, [draft]);

  return (
    <div className="cosmetics-registry">
      <header className="cosmetics-registry-hero">
        <div>
          <small>Wave 1 · dark registry</small>
          <h1>Cosmetics Asset Registry</h1>
          <p>Immutable files, trusted validation receipts, separate moderation, and reversible publication.</p>
        </div>
        <button disabled={state === 'loading'} onClick={() => void load()} type="button">Refresh</button>
      </header>

      <section className="cosmetics-registry-toolbar">
        <select aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">All categories</option>
          {categories.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Moderation status" value={moderationStatus} onChange={(event) => setModerationStatus(event.target.value)}>
          <option value="">All moderation states</option>
          {['pending', 'approved', 'rejected', 'suspended'].map((value) => <option key={value}>{value}</option>)}
        </select>
        <select aria-label="Publication status" value={publicationStatus} onChange={(event) => setPublicationStatus(event.target.value)}>
          <option value="">All publication states</option>
          {['unpublished', 'published', 'disabled'].map((value) => <option key={value}>{value}</option>)}
        </select>
      </section>

      {error ? <div className="economy-error"><strong>Registry operation failed</strong><span>{error}</span></div> : null}

      <section className="cosmetics-registry-grid">
        <div className="cosmetics-registry-list">
          <h2>Inventory</h2>
          {state === 'loading' ? <p>Loading registry…</p> : null}
          {state === 'ready' && assets.length === 0 ? <p>No canonical assets match these filters.</p> : null}
          {assets.map((asset) => (
            <button className="cosmetics-registry-row" key={asset.assetId} onClick={() => void open(asset.assetId)} type="button">
              <span><strong>{asset.assetId}</strong><small>{asset.category} · r{asset.revision}</small></span>
              <span><b>{asset.moderationStatus}</b><small>{asset.publicationStatus}</small></span>
            </button>
          ))}
        </div>

        <div className="cosmetics-registry-detail">
          <h2>Version history and approval</h2>
          {!selected?.asset ? <p>Select an asset to inspect immutable versions.</p> : (
            <>
              <div className="cosmetics-registry-summary">
                <strong>{selected.asset.assetId}</strong>
                <span>{selected.asset.moderationStatus} / {selected.asset.publicationStatus}</span>
                <span>Published: {selected.asset.publishedVersionId || 'none'}</span>
              </div>
              <label>Audit reason
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>
              {['nameplate', 'cosmetic-badge'].includes(selected.asset.category) ? (
                <div className="cosmetics-safety-attestations">
                  <label><input checked={readableIdentityPassed} onChange={(event) => setReadableIdentityPassed(event.target.checked)} type="checkbox" /> Name remains readable and selectable</label>
                  <label><input checked={authoritySeparationPassed} onChange={(event) => setAuthoritySeparationPassed(event.target.checked)} type="checkbox" /> Cannot resemble staff, moderator, verification, representative, or safety status</label>
                </div>
              ) : null}
              <div className="cosmetics-registry-actions">
                <button disabled={!canManage || busy || selected.asset.moderationStatus !== 'pending' || !selected.asset.currentVersionId || (['nameplate', 'cosmetic-badge'].includes(selected.asset.category) && (!authoritySeparationPassed || !readableIdentityPassed))} onClick={() => void mutate('approve-version', selected.asset?.currentVersionId)} type="button">Approve current</button>
                <button disabled={!canManage || busy || selected.asset.moderationStatus !== 'pending' || !selected.asset.currentVersionId} onClick={() => void mutate('reject-version', selected.asset?.currentVersionId)} type="button">Reject current</button>
                <button disabled={!canManage || busy || !selected.asset.approvedVersionId} onClick={() => void mutate('publish-version', selected.asset?.approvedVersionId)} type="button">Publish approved</button>
                <button disabled={!canManage || busy} onClick={() => void mutate('emergency-disable')} type="button">Emergency disable</button>
                <button disabled={!canManage || busy} onClick={() => void mutate('suspend')} type="button">Suspend</button>
              </div>
              <div className="cosmetics-version-list">
                {selected.versions.map((version) => (
                  <article key={version.assetVersionId}>
                    <strong>{version.assetVersionId}</strong>
                    <small>{version.format} · {formatBytes(version.byteSize)} · {version.width}×{version.height} · {version.durationMs}ms</small>
                    <code>{version.sha256}</code>
                    <small>Fallback: {version.fallbackAssetId ? `${version.fallbackAssetId}/${version.fallbackAssetVersionId}` : 'none'}</small>
                    {version.assetVersionId !== selected.asset?.publishedVersionId
                      && selected.approvals.some((approval) =>
                        approval.assetVersionId === version.assetVersionId
                        && approval.decision === 'approved') ? (
                      <button disabled={!canManage || busy} onClick={() => void mutate('rollback-version', version.assetVersionId)} type="button">Publish this approved version</button>
                    ) : null}
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {canManage ? (
        <form className="cosmetics-register-form" onSubmit={(event) => void register(event)}>
          <header><h2>Upload and validate immutable version</h2><p>Upload is private until validation, approval, and publication all succeed.</p></header>
          <div className="economy-form-grid">
            <label>Asset ID<input required value={draft.assetId} onChange={(event) => setDraft({ ...draft, assetId: event.target.value.trim().toLowerCase() })} /></label>
            <label>Version ID<input required value={draft.assetVersionId} onChange={(event) => setDraft({ ...draft, assetVersionId: event.target.value.trim().toLowerCase() })} /></label>
            <label>Category<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as Draft['category'] })}>{categories.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Format<select value={draft.format} onChange={(event) => setDraft({ ...draft, format: event.target.value as Draft['format'] })}>{formats.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Owner<select value={draft.ownerType} onChange={(event) => setDraft({ ...draft, ownerType: event.target.value as Draft['ownerType'] })}><option value="platform">platform</option><option value="user">approved user</option></select></label>
            {draft.ownerType === 'user' ? <label>Owner UID<input required value={draft.ownerUid} onChange={(event) => setDraft({ ...draft, ownerUid: event.target.value.trim() })} /></label> : null}
            <label>Minimum client<input required value={draft.minimumClientVersion} onChange={(event) => setDraft({ ...draft, minimumClientVersion: event.target.value.trim() })} /></label>
            <label>Performance<select value={draft.performanceTier} onChange={(event) => setDraft({ ...draft, performanceTier: event.target.value as Draft['performanceTier'] })}><option>low</option><option>standard</option><option>high</option></select></label>
            {!staticFormat(draft.format) && draft.format !== 'm4a-aac' ? <label className="economy-checkbox"><input checked={draft.loop} type="checkbox" onChange={(event) => setDraft({ ...draft, loop: event.target.checked })} />Looping</label> : null}
            {(draft.format === 'lottie-json' || draft.format === 'mp4') ? <>
              <label>Fallback asset ID<input required value={draft.fallbackAssetId} onChange={(event) => setDraft({ ...draft, fallbackAssetId: event.target.value.trim() })} /></label>
              <label>Fallback version ID<input required value={draft.fallbackAssetVersionId} onChange={(event) => setDraft({ ...draft, fallbackAssetVersionId: event.target.value.trim() })} /></label>
            </> : null}
            {draft.format !== 'm4a-aac' ? <>
              <label>Optional audio asset ID<input value={draft.audioAssetId} onChange={(event) => setDraft({ ...draft, audioAssetId: event.target.value.trim() })} /></label>
              <label>Optional audio version ID<input value={draft.audioAssetVersionId} onChange={(event) => setDraft({ ...draft, audioAssetVersionId: event.target.value.trim() })} /></label>
            </> : null}
            <label>Exact source file<input required type="file" onChange={(event) => setFile(event.target.files?.[0])} /></label>
            <label>Validation reason<textarea required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          </div>
          <code className="cosmetics-storage-path">{expectedPath}</code>
          <button disabled={busy} type="submit">{busy ? 'Validating…' : 'Upload and create validation receipt'}</button>
        </form>
      ) : null}
    </div>
  );
}

function staticFormat(format: Draft['format']) {
  return format === 'png' || format === 'jpeg';
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return 'unknown size';
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
    : `${(bytes / 1024).toFixed(1)} KiB`;
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : 'The registry operation failed.';
}
