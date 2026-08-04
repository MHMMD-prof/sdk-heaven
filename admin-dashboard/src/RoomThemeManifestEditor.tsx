import { PointerEvent, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';

import {
  AdminRoomThemeManifest,
  AdminRoomThemeSeat,
  mutateAdminRoomTheme,
  requestAdminRoomTheme,
} from './adminDashboardApi';
import { uploadRoomThemeAsset } from './storeAssets';

const counts = [5, 10, 15, 20] as const;
const slots = ['background', 'stage', 'emptySeatFrame', 'badge', 'dock', 'drawer'] as const;
const slotLabels = {
  background: 'الخلفية',
  stage: 'طبقة المنصة',
  emptySeatFrame: 'إطار المقعد الفارغ',
  badge: 'زخرفة الشارات',
  dock: 'شريط الأوامر',
  drawer: 'مركز الأوامر',
};

export function RoomThemeManifestEditor({ themeId, user }: { themeId: string; user: User }) {
  const [manifest, setManifest] = useState(() => createManifest(themeId));
  const [versions, setVersions] = useState<Array<{ manifest: AdminRoomThemeManifest; revision: number }>>([]);
  const [seatCount, setSeatCount] = useState<(typeof counts)[number]>(10);
  const [canvas, setCanvas] = useState<'compact' | 'tall'>('tall');
  const [files, setFiles] = useState<Partial<Record<(typeof slots)[number], File>>>({});
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function reload() {
    setLoading(true);
    try {
      const detail = await requestAdminRoomTheme(user, themeId);
      setManifest(detail.manifest || createManifest(themeId));
      setVersions(detail.versions);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر تحميل السمة.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [themeId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(operation: 'save-draft' | 'publish') {
    if (reason.trim().length < 3) {
      setMessage('اكتب سبباً واضحاً للتغيير.');
      return;
    }
    if (operation === 'publish' && !manifest.assets.background && !files.background) {
      setMessage('ارفع خلفية قبل النشر.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const nextRevision = manifest.revision + 1;
      const assets = { ...manifest.assets };
      for (const slot of slots) {
        const file = files[slot];
        if (!file) continue;
        const uploaded = await uploadRoomThemeAsset(
          user,
          themeId,
          nextRevision,
          slot === 'emptySeatFrame' ? 'empty-seat-frame' : slot,
          file,
        );
        assets[slot] = { uri: uploaded.url, version: nextRevision };
      }
      await mutateAdminRoomTheme(user, {
        expectedRevision: manifest.revision,
        manifest: {
          ...manifest,
          assets,
          publicationStatus: operation === 'publish' ? 'published' : 'draft',
          revision: nextRevision,
        },
        operation,
        reason: reason.trim(),
        themeId,
      });
      setFiles({});
      setReason('');
      await reload();
      setMessage(operation === 'publish' ? 'تم نشر السمة.' : 'تم حفظ المسودة.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر حفظ السمة.');
    } finally {
      setSaving(false);
    }
  }

  async function mutate(operation: 'emergency-disable' | 'rollback', rollbackRevision?: number) {
    if (reason.trim().length < 3) {
      setMessage('اكتب سبباً واضحاً للتغيير.');
      return;
    }
    setSaving(true);
    try {
      await mutateAdminRoomTheme(user, {
        expectedRevision: manifest.revision,
        operation,
        reason: reason.trim(),
        rollbackRevision,
        themeId,
      });
      setReason('');
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر تنفيذ العملية.');
    } finally {
      setSaving(false);
    }
  }

  const previewBackground = useMemo(
    () => files.background ? URL.createObjectURL(files.background) : manifest.assets.background?.uri,
    [files.background, manifest.assets.background?.uri],
  );
  const layoutKey = String(seatCount) as keyof AdminRoomThemeManifest['layouts'];

  if (loading) return <section className="economy-form-errors">جارٍ تحميل منصة سمات الغرف…</section>;
  return (
    <section className="room-theme-editor" style={{ border: '1px solid rgba(214,168,79,.35)', borderRadius: 18, padding: 16 }}>
      <header>
        <small>منصة نشر سمات الغرف · Manifest V1</small>
        <h3>التصميم، الأصول وتوزيع المقاعد</h3>
        <p>إطار المستخدم داخل الغرفة يأتي من عنصر الإطار الذي يملكه ويجهزه المستخدم، ولا يمكن للسمة تغييره.</p>
      </header>

      <div className="economy-form-grid">
        <label>أقل إصدار عميل
          <input
            dir="ltr"
            pattern="[0-9]+\.[0-9]+\.[0-9]+"
            value={manifest.minimumClientVersion}
            onChange={(event) => setManifest({ ...manifest, minimumClientVersion: event.target.value })}
          />
        </label>
        <label className="economy-checkbox">
          <input
            checked={manifest.renderingEnabled}
            type="checkbox"
            onChange={(event) => setManifest({ ...manifest, renderingEnabled: event.target.checked })}
          />
          السماح بالعرض
        </label>
        <label className="economy-checkbox">
          <input
            checked={manifest.purchasingEnabled}
            type="checkbox"
            onChange={(event) => setManifest({ ...manifest, purchasingEnabled: event.target.checked })}
          />
          السماح بشراء هذه النسخة
        </label>
        {slots.map((slot) => (
          <label key={slot}>{slotLabels[slot]}
            <input
              accept="image/jpeg,image/png,image/webp"
              type="file"
              onChange={(event) => setFiles({ ...files, [slot]: event.target.files?.[0] })}
            />
          </label>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '14px 0' }}>
        {counts.map((count) => <button className={seatCount === count ? '' : 'secondary'} key={count} onClick={() => setSeatCount(count)} type="button">{count} مقاعد</button>)}
        <button className={canvas === 'compact' ? '' : 'secondary'} onClick={() => setCanvas('compact')} type="button">هاتف مدمج</button>
        <button className={canvas === 'tall' ? '' : 'secondary'} onClick={() => setCanvas('tall')} type="button">هاتف طويل</button>
      </div>

      <SeatCanvas
        background={previewBackground}
        canvas={canvas}
        colors={manifest.colors}
        onChange={(layout) => setManifest({ ...manifest, layouts: { ...manifest.layouts, [layoutKey]: layout } })}
        seats={manifest.layouts[layoutKey]}
      />

      <div className="economy-form-grid" style={{ marginTop: 14 }}>
        {Object.entries(manifest.colors).map(([key, value]) => (
          <label key={key}>{key}
            <input
              dir="ltr"
              pattern="#[0-9A-F]{6}"
              value={value}
              onChange={(event) => setManifest({
                ...manifest,
                colors: { ...manifest.colors, [key]: event.target.value.toUpperCase() },
              })}
            />
          </label>
        ))}
        <label className="span-2">سبب التغيير
          <textarea minLength={3} required value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
      </div>
      {message ? <div className="economy-form-errors" role="status">{message}</div> : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button disabled={saving} onClick={() => void save('save-draft')} type="button">حفظ مسودة</button>
        <button disabled={saving} onClick={() => void save('publish')} type="button">نشر النسخة</button>
        <button className="danger" disabled={saving || manifest.revision === 0} onClick={() => void mutate('emergency-disable')} type="button">تعطيل العرض فوراً</button>
        {versions.filter((version) => version.revision < manifest.revision).slice(0, 3).map((version) => (
          <button className="secondary" disabled={saving} key={version.revision} onClick={() => void mutate('rollback', version.revision)} type="button">
            استعادة v{version.revision}
          </button>
        ))}
      </div>
    </section>
  );
}

function SeatCanvas({
  background,
  canvas,
  colors,
  onChange,
  seats,
}: {
  background?: string;
  canvas: 'compact' | 'tall';
  colors: AdminRoomThemeManifest['colors'];
  onChange: (seats: AdminRoomThemeSeat[]) => void;
  seats: AdminRoomThemeSeat[];
}) {
  const move = (event: PointerEvent<HTMLButtonElement>, seatNumber: number) => {
    if (event.buttons !== 1) return;
    const canvasElement = event.currentTarget.parentElement;
    if (!canvasElement) return;
    const rect = canvasElement.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0.04, 0.96);
    const y = clamp((event.clientY - rect.top) / rect.height, 0.04, 0.96);
    onChange(seats.map((seat) => seat.seatNumber === seatNumber ? { ...seat, x, y } : seat));
  };
  return (
    <div
      aria-label={`معاينة ${canvas === 'compact' ? 'الهاتف المدمج' : 'الهاتف الطويل'}`}
      style={{
        aspectRatio: canvas === 'compact' ? '360 / 640' : '390 / 844',
        backgroundColor: colors.background,
        backgroundImage: background ? `linear-gradient(rgba(0,0,0,.18),rgba(0,0,0,.4)),url(${background})` : undefined,
        backgroundPosition: 'center',
        backgroundSize: 'cover',
        border: `1px solid ${colors.gold}`,
        borderRadius: 20,
        maxHeight: 580,
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
    >
      {seats.map((seat) => (
        <button
          aria-label={`المقعد ${seat.seatNumber}`}
          key={seat.seatNumber}
          onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
          onPointerMove={(event) => move(event, seat.seatNumber)}
          style={{
            alignItems: 'center',
            background: colors.panelRaised,
            border: `2px solid ${colors.goldSoft}`,
            borderRadius: '50%',
            color: colors.text,
            display: 'flex',
            height: 38,
            justifyContent: 'center',
            left: `${seat.x * 100}%`,
            padding: 0,
            position: 'absolute',
            top: `${seat.y * 100}%`,
            transform: `translate(-50%,-50%) scale(${seat.scale})`,
            width: 38,
            zIndex: seat.z,
          }}
          type="button"
        >
          {seat.seatNumber}
        </button>
      ))}
    </div>
  );
}

function createManifest(themeId: string): AdminRoomThemeManifest {
  return {
    manifestVersion: 1,
    themeId,
    publicationStatus: 'draft',
    renderingEnabled: true,
    purchasingEnabled: true,
    minimumClientVersion: '1.0.0',
    revision: 0,
    assets: { background: null, stage: null, emptySeatFrame: null, badge: null, dock: null, drawer: null },
    colors: {
      background: '#080405',
      panel: '#130A0B',
      panelRaised: '#211012',
      ruby: '#74151D',
      rubyBright: '#B92A35',
      gold: '#D6A84F',
      goldSoft: '#F4D58A',
      text: '#FFF4DE',
      textMuted: '#CDBB9D',
    },
    layouts: {
      '5': grid(5),
      '10': grid(10),
      '15': grid(15),
      '20': grid(20),
    },
  };
}

function grid(count: number): AdminRoomThemeSeat[] {
  return Array.from({ length: count }, (_, index) => ({
    seatNumber: index + 1,
    x: ((index % 5) + 0.5) / 5,
    y: (Math.floor(index / 5) + 0.5) / Math.ceil(count / 5),
    scale: 1,
    z: index + 1,
  }));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.round(Math.max(minimum, Math.min(maximum, value)) * 1000) / 1000;
}
