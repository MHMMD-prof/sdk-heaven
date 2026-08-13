import { User } from 'firebase/auth';
import { getDownloadURL, ref } from 'firebase/storage';
import lottie, { type AnimationItem } from 'lottie-web';
import { type CSSProperties, PointerEvent, useEffect, useRef, useState } from 'react';

import {
  AdminCosmeticAssetDetail,
  AdminCosmeticAssetVersion,
  AdminRoomThemeManifest,
  AdminRoomThemeSeat,
  mutateAdminRoomTheme,
  requestAdminCosmeticAssets,
  requestAdminRoomTheme,
} from './adminDashboardApi';
import { firebaseStorage } from './firebase';
import {
  ROOM_THEME_EDITOR_COUNTS,
  ROOM_THEME_INCENTIVE_PREVIEWS,
  ROOM_THEME_EDITOR_PROFILES,
  ROOM_THEME_EDITOR_REGIONS,
  ROOM_THEME_EDITOR_VIEWPORTS,
  requiredRoomThemePreviewKeys,
  roomThemePreviewKey,
  type RoomThemeEditorProfile,
  type RoomThemeIncentivePreview,
  upgradeRoomThemeManifestToV3,
  validateRoomThemeEditorManifest,
} from './roomThemeEditorModel';
import { uploadRoomThemeAsset } from './storeAssets';

const counts = ROOM_THEME_EDITOR_COUNTS;
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
  const [canvas, setCanvas] = useState<RoomThemeEditorProfile>('standard');
  const [incentivePreview, setIncentivePreview] = useState<RoomThemeIncentivePreview>('room');
  const [files, setFiles] = useState<Partial<Record<(typeof slots)[number], File>>>({});
  const [previewed, setPreviewed] = useState<Set<string>>(() => new Set());
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function reload() {
    setLoading(true);
    try {
      const detail = await requestAdminRoomTheme(user, themeId);
      setManifest(upgradeRoomThemeManifestToV3(detail.manifest || createManifest(themeId)));
      setVersions(detail.versions);
      setPreviewed(new Set());
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
    const editorIssues = validateRoomThemeEditorManifest(manifest);
    if (operation === 'publish' && editorIssues.length > 0) {
      setMessage(editorIssues[0] || 'المخطط غير صالح للنشر.');
      return;
    }
    const missingPreviews = requiredRoomThemePreviewKeys().filter((key) => !previewed.has(key));
    if (operation === 'publish' && missingPreviews.length > 0) {
      setMessage(`راجع كل أحجام المعاينة قبل النشر (${missingPreviews.length} متبقية).`);
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
          ...sanitizeMotion(manifest),
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

  const previewBackground = useObjectUrl(files.background, manifest.assets.background?.uri);
  const previewStage = useObjectUrl(files.stage, manifest.assets.stage?.uri);
  const previewDock = useObjectUrl(files.dock, manifest.assets.dock?.uri);
  const layoutKey = String(seatCount) as keyof AdminRoomThemeManifest['layouts'];
  const motion = getMotion(manifest);
  const scene = manifest.scene;
  const previewLayouts = scene?.profiles[canvas].layouts || manifest.layouts;
  const editorIssues = validateRoomThemeEditorManifest(manifest);

  useEffect(() => {
    setPreviewed((current) => {
      const key = roomThemePreviewKey(canvas, seatCount);
      if (current.has(key)) return current;
      return new Set([...current, key]);
    });
  }, [canvas, seatCount]);

  function updatePreviewLayout(layout: AdminRoomThemeSeat[]) {
    const layouts = { ...previewLayouts, [layoutKey]: layout };
    if (manifest.manifestVersion === 3 && manifest.scene) {
      setManifest({
        ...manifest,
        layouts: canvas === 'standard'
          ? { ...manifest.layouts, [layoutKey]: layout }
          : manifest.layouts,
        scene: {
          ...manifest.scene,
          profiles: {
            ...manifest.scene.profiles,
            [canvas]: { layouts },
          },
        },
      });
      return;
    }
    setManifest({ ...manifest, layouts });
  }

  function setBackgroundMotion(field: 'assetId' | 'assetVersionId', value: string) {
    const current = motion.background || { assetId: '', assetVersionId: '' };
    const background = { ...current, [field]: value.trim() };
    setManifest({
      ...manifest,
      manifestVersion: manifest.manifestVersion === 3 ? 3 : 2,
      motion: {
        ...motion,
        background: background.assetId || background.assetVersionId ? background : null,
      },
    });
  }

  function setAmbientMotion(index: number, field: 'assetId' | 'assetVersionId', value: string) {
    const ambient = [...motion.ambient];
    const current = ambient[index] || {
      id: `ambient-${index + 1}`,
      asset: { assetId: '', assetVersionId: '' },
      x: index === 0 ? 0.08 : 0.62,
      y: 0.12,
      width: 0.3,
      height: 0.25,
    };
    ambient[index] = { ...current, asset: { ...current.asset, [field]: value.trim() } };
    setManifest({
      ...manifest,
      manifestVersion: manifest.manifestVersion === 3 ? 3 : 2,
      motion: { ...motion, ambient },
    });
  }

  if (loading) return <section className="economy-form-errors">جارٍ تحميل منصة سمات الغرف…</section>;
  return (
    <section className="room-theme-editor" style={{ border: '1px solid rgba(214,168,79,.35)', borderRadius: 18, padding: 16 }}>
      <header>
        <small>منصة نشر سمات الغرف · Manifest V1/V2/V3</small>
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

      <div className="economy-form-grid" style={{ marginTop: 14 }}>
        <label>خلفية MP4 · Asset ID
          <input dir="ltr" value={motion.background?.assetId || ''} onChange={(event) => setBackgroundMotion('assetId', event.target.value)} />
        </label>
        <label>خلفية MP4 · Version ID
          <input dir="ltr" value={motion.background?.assetVersionId || ''} onChange={(event) => setBackgroundMotion('assetVersionId', event.target.value)} />
        </label>
        {[0, 1].map((index) => (
          <div className="span-2" key={index} style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
            <label>Lottie ambient {index + 1} · Asset ID
              <input dir="ltr" value={motion.ambient[index]?.asset.assetId || ''} onChange={(event) => setAmbientMotion(index, 'assetId', event.target.value)} />
            </label>
            <label>Lottie ambient {index + 1} · Version ID
              <input dir="ltr" value={motion.ambient[index]?.asset.assetVersionId || ''} onChange={(event) => setAmbientMotion(index, 'assetVersionId', event.target.value)} />
            </label>
          </div>
        ))}
        <small className="span-2">يقبل النشر مراجع room-theme منشورة فقط: MP4 صامت للخلفية وLottie للمؤثرات، مع fallback ثابت معتمد.</small>
      </div>

      <div className="room-theme-preview-toolbar">
        {counts.map((count) => <button className={seatCount === count ? '' : 'secondary'} key={count} onClick={() => setSeatCount(count)} type="button">{count} مقاعد</button>)}
        {ROOM_THEME_EDITOR_PROFILES.map((profile) => (
          <button className={canvas === profile ? '' : 'secondary'} key={profile} onClick={() => setCanvas(profile)} type="button">
            {ROOM_THEME_EDITOR_VIEWPORTS[profile].label}
          </button>
        ))}
      </div>
      <div className="room-theme-preview-toolbar room-theme-incentive-preview-toolbar" aria-label="معاينات حوافز الغرفة">
        {ROOM_THEME_INCENTIVE_PREVIEWS.map((preview) => (
          <button className={incentivePreview === preview ? '' : 'secondary'} key={preview} onClick={() => setIncentivePreview(preview)} type="button">
            {{ room: 'الغرفة', 'rocket-week': 'الصاروخ · أسبوعي', 'rocket-today': 'الصاروخ · اليوم', target: 'هدف الغرفة' }[preview]}
          </button>
        ))}
      </div>

      {scene ? (
        <div className="economy-form-grid room-theme-media-controls">
          <MediaControls
            label="الخلفية"
            media={scene.background}
            onChange={(background) => setManifest({ ...manifest, scene: { ...scene, background } })}
          />
          <MediaControls
            label="المنصة"
            media={scene.stage}
            onChange={(stage) => setManifest({ ...manifest, scene: { ...scene, stage } })}
          />
        </div>
      ) : null}

      <SeatCanvas
        background={previewBackground}
        backgroundMedia={scene?.background || { fit: 'cover', focalX: 0.5, focalY: 0.5 }}
        canvas={canvas}
        colors={manifest.colors}
        dock={previewDock}
        incentivePreview={incentivePreview}
        motion={motion}
        onChange={updatePreviewLayout}
        seats={previewLayouts[layoutKey]}
        stage={previewStage}
        stageMedia={scene?.stage || { fit: 'contain', focalX: 0.5, focalY: 0.5 }}
        user={user}
      />

      <div className="room-theme-preview-coverage" aria-label="حالة مراجعة المعاينات">
        {ROOM_THEME_EDITOR_PROFILES.flatMap((profile) => counts.map((count) => {
          const key = roomThemePreviewKey(profile, count);
          const complete = previewed.has(key);
          return <span className={complete ? 'complete' : ''} key={key}>{complete ? '✓' : '○'} {ROOM_THEME_EDITOR_VIEWPORTS[profile].label} · {count}</span>;
        }))}
      </div>
      {editorIssues.length ? (
        <div className="economy-form-errors" role="alert">
          <strong>المخطط غير جاهز للنشر</strong>
          <ul>{editorIssues.slice(0, 6).map((issue) => <li key={issue}>{issue}</li>)}</ul>
        </div>
      ) : (
        <div className="room-theme-ready" role="status">المخططات الثلاثة صالحة. أكمل مراجعة جميع المعاينات للنشر.</div>
      )}

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
  backgroundMedia,
  canvas,
  colors,
  dock,
  incentivePreview,
  motion,
  onChange,
  seats,
  stage,
  stageMedia,
  user,
}: {
  background?: string;
  backgroundMedia: { fit: 'cover' | 'contain'; focalX: number; focalY: number };
  canvas: RoomThemeEditorProfile;
  colors: AdminRoomThemeManifest['colors'];
  dock?: string;
  incentivePreview: RoomThemeIncentivePreview;
  motion: NonNullable<AdminRoomThemeManifest['motion']>;
  onChange: (seats: AdminRoomThemeSeat[]) => void;
  seats: AdminRoomThemeSeat[];
  stage?: string;
  stageMedia: { fit: 'cover' | 'contain'; focalX: number; focalY: number };
  user: User;
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
  const viewport = ROOM_THEME_EDITOR_VIEWPORTS[canvas];
  const regions = ROOM_THEME_EDITOR_REGIONS[canvas];
  return (
    <div
      aria-label={`معاينة ${viewport.label}`}
      className="room-theme-phone-preview"
      style={{
        aspectRatio: `${viewport.width} / ${viewport.height}`,
        backgroundColor: colors.background,
        border: `1px solid ${colors.gold}`,
      }}
    >
      {previewableUrl(background) ? (
        <img
          alt=""
          className="room-theme-preview-background"
          src={background}
          style={{
            objectFit: backgroundMedia.fit,
            objectPosition: `${backgroundMedia.focalX * 100}% ${backgroundMedia.focalY * 100}%`,
          }}
        />
      ) : null}
      {motion.background ? (
        <ThemeMotionPreview kind="background" reference={motion.background} user={user} />
      ) : null}
      {motion.ambient.filter((slot) => slot.asset.assetId || slot.asset.assetVersionId).map((slot) => (
        <div
          key={slot.id}
          style={{
            alignItems: 'center',
            border: `1px dashed ${colors.goldSoft}`,
            color: colors.text,
            display: 'flex',
            height: `${slot.height * 100}%`,
            justifyContent: 'center',
            left: `${slot.x * 100}%`,
            pointerEvents: 'none',
            position: 'absolute',
            top: `${slot.y * 100}%`,
            width: `${slot.width * 100}%`,
            zIndex: 3,
          }}
        >
          <ThemeMotionPreview kind="ambient" reference={slot.asset} user={user} />
        </div>
      ))}
      <div className="room-theme-preview-header" style={{ ...regionStyle(regions.header), borderColor: `${colors.gold}66`, color: colors.text }}>
        <span className="room-theme-preview-avatar" style={{ borderColor: colors.gold }}>م</span>
        <span><strong>مجلس الليلة</strong><small>ID: 152001 · 12</small></span>
        <span className="room-theme-preview-header-actions">↗ ⋮</span>
      </div>
      <div className="room-theme-preview-announcement" style={{ ...regionStyle(regions.announcement), borderColor: `${colors.gold}66`, color: colors.goldSoft }}>
        <span>◆</span><span>إعلان الغرفة · أهلاً وسهلاً بالجميع</span>
      </div>
      <div
        aria-label="منطقة منصة المقاعد القابلة للتحرير"
        className="room-theme-preview-stage"
        style={{ ...regionStyle(regions.stage), borderColor: `${colors.gold}42` }}
      >
        {previewableUrl(stage) ? (
          <img
            alt=""
            className="room-theme-preview-stage-art"
            src={stage}
            style={{
              objectFit: stageMedia.fit,
              objectPosition: `${stageMedia.focalX * 100}% ${stageMedia.focalY * 100}%`,
            }}
          />
        ) : null}
        {seats.map((seat) => (
          <button
            aria-label={`المقعد ${seat.seatNumber}`}
            className="room-theme-preview-seat"
            key={seat.seatNumber}
            onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
            onPointerMove={(event) => move(event, seat.seatNumber)}
            style={{
              background: colors.panelRaised,
              borderColor: colors.goldSoft,
              color: colors.text,
              left: `${seat.x * 100}%`,
              top: `${seat.y * 100}%`,
              transform: `translate(-50%,-50%) scale(${seat.scale})`,
              zIndex: 40 + seat.z,
            }}
            type="button"
          >
            {seat.seatNumber}
          </button>
        ))}
      </div>
      <div
        className="room-theme-preview-activity-dock"
        style={{
          ...regionStyle(regions.activityDock),
          background: `linear-gradient(180deg, ${colors.panel}E8, ${colors.background}F2)`,
          borderColor: `${colors.gold}73`,
          color: colors.text,
        }}
      >
        <div className="room-theme-preview-chat-ticker" style={{ background: `${colors.panelRaised}B8`, borderColor: `${colors.gold}73` }}>
          <span className="room-theme-preview-avatar small">س</span>
          <span><strong style={{ color: colors.goldSoft }}>سامي · </strong>مساء الخير جميعاً ❤️</span>
          <span>‹</span>
        </div>
        <div className="room-theme-preview-support-hub">
          <b className="room-theme-preview-support-icon" style={{ background: colors.rubyBright, borderColor: colors.goldSoft }}>♛</b>
          <span><small style={{ color: colors.goldSoft }}>اليوم · هذا الأسبوع</small><strong>أفضل 3 داعمين</strong></span>
          <i><em>1</em><em>2</em><em>3</em></i>
          <span className="room-theme-preview-hub-dots"><small style={{ background: colors.goldSoft }} /><small /><small /></span>
        </div>
      </div>
      <div
        className="room-theme-preview-dock"
        style={{
          ...regionStyle(regions.dock),
          backgroundColor: colors.panel,
          backgroundImage: previewableUrl(dock) ? `linear-gradient(${colors.panel}CC,${colors.background}E8),url(${dock})` : undefined,
          borderColor: `${colors.gold}80`,
          color: colors.goldSoft,
        }}
      >
        <span>🎁<small>هدية</small></span>
        <span>●<small>دردشة</small></span>
        <span className="primary" style={{ background: colors.ruby, borderColor: colors.goldSoft }}>◉<small>تحدث</small></span>
        <span>🎮<small>ألعاب</small></span>
        <span>▦<small>أدوات</small></span>
      </div>
      {incentivePreview !== 'room' ? <IncentiveSheetPreview colors={colors} mode={incentivePreview} /> : null}
    </div>
  );
}

function IncentiveSheetPreview({
  colors,
  mode,
}: {
  colors: AdminRoomThemeManifest['colors'];
  mode: Exclude<RoomThemeIncentivePreview, 'room'>;
}) {
  const rocket = mode !== 'target';
  const today = mode === 'rocket-today';
  return (
    <div className="room-theme-incentive-sheet" style={{ background: colors.panel, borderColor: colors.gold, color: colors.text }}>
      <div className="room-theme-incentive-sheet-handle" style={{ background: colors.gold }} />
      <div className="room-theme-incentive-sheet-hero" style={{ background: `linear-gradient(135deg, ${colors.rubyBright}, ${colors.ruby}, ${colors.background})`, borderColor: `${colors.gold}88` }}>
        <span>{rocket ? '🚀' : '◎'}</span>
        <div><small>{rocket ? 'هدف أسبوعي للغرفة' : 'هدف استرداد أسبوعي'}</small><strong>{rocket ? 'صاروخ الغرفة' : 'هدف الغرفة'}</strong></div>
        <b style={{ color: colors.goldSoft }}>{rocket ? '72٪' : '64٪'}</b>
      </div>
      <div className="room-theme-incentive-sheet-track" style={{ background: colors.panelRaised }}>
        <i style={{ background: `linear-gradient(90deg, ${colors.rubyBright}, ${colors.gold})`, width: rocket ? '72%' : '64%' }} />
      </div>
      {rocket ? (
        <>
          <div className="room-theme-incentive-tabs">
            <span className={today ? '' : 'active'} style={!today ? { background: colors.ruby, borderColor: colors.gold } : undefined}>الأسبوع</span>
            <span className={today ? 'active' : ''} style={today ? { background: colors.ruby, borderColor: colors.gold } : undefined}>اليوم</span>
          </div>
          <div className="room-theme-incentive-podium">
            {[2, 1, 3].map((rank) => <div className={`rank-${rank}`} key={rank}><i style={{ borderColor: colors.gold }}>{rank}</i><strong>{rank === 1 ? 'ليلى' : rank === 2 ? 'سامي' : 'نور'}</strong><small>{today ? ['4.8K', '7.2K', '3.9K'][rank - 1] : ['21K', '38K', '17K'][rank - 1]}</small></div>)}
          </div>
        </>
      ) : (
        <>
          <div className="room-theme-target-return" style={{ borderColor: `${colors.gold}66` }}><small>العائد المتوقع للمؤهلين</small><strong style={{ color: colors.goldSoft }}>12,500 💎</strong></div>
          <div className="room-theme-target-roster">
            {['المالك · 6,000', 'نور · 4,000', 'سامي · 2,500'].map((row, index) => <span key={row}><i style={{ borderColor: colors.gold }}>{index + 1}</i><b>{row}</b><small>مؤهل</small></span>)}
          </div>
        </>
      )}
    </div>
  );
}

function MediaControls({
  label,
  media,
  onChange,
}: {
  label: string;
  media: { fit: 'cover' | 'contain'; focalX: number; focalY: number };
  onChange: (media: { fit: 'cover' | 'contain'; focalX: number; focalY: number }) => void;
}) {
  return (
    <fieldset className="room-theme-media-fieldset">
      <legend>{label}</legend>
      <label>الملاءمة
        <select value={media.fit} onChange={(event) => onChange({ ...media, fit: event.target.value as 'cover' | 'contain' })}>
          <option value="cover">تغطية</option>
          <option value="contain">احتواء</option>
        </select>
      </label>
      <label>المحور الأفقي · {Math.round(media.focalX * 100)}%
        <input max="1" min="0" step="0.01" type="range" value={media.focalX} onChange={(event) => onChange({ ...media, focalX: Number(event.target.value) })} />
      </label>
      <label>المحور العمودي · {Math.round(media.focalY * 100)}%
        <input max="1" min="0" step="0.01" type="range" value={media.focalY} onChange={(event) => onChange({ ...media, focalY: Number(event.target.value) })} />
      </label>
    </fieldset>
  );
}

function regionStyle(region: { height: number; width: number; x: number; y: number }): CSSProperties {
  return {
    height: `${region.height * 100}%`,
    left: `${region.x * 100}%`,
    position: 'absolute',
    top: `${region.y * 100}%`,
    width: `${region.width * 100}%`,
  };
}

function previewableUrl(value?: string) {
  return Boolean(value && !value.startsWith('bundle://'));
}

type ThemeMotionReference = { assetId: string; assetVersionId: string };
type ThemeMotionPreviewSource = {
  fallbackUrl: string;
  format: 'lottie-json' | 'mp4';
  url: string;
};

function ThemeMotionPreview({
  kind,
  reference,
  user,
}: {
  kind: 'ambient' | 'background';
  reference: ThemeMotionReference;
  user: User;
}) {
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');
  const [source, setSource] = useState<ThemeMotionPreviewSource>();

  useEffect(() => {
    let active = true;
    setFailed(false);
    setMessage('');
    setSource(undefined);
    if (!reference.assetId || !reference.assetVersionId) return () => { active = false; };
    if (
      !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(reference.assetId)
      || !/^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/.test(reference.assetVersionId)
    ) {
      setMessage('Enter an exact immutable asset and version ID.');
      return () => { active = false; };
    }
    void loadThemeMotionPreview(user, reference, kind === 'background' ? 'mp4' : 'lottie-json')
      .then((next) => {
        if (active) setSource(next);
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : 'Motion preview is unavailable.');
      });
    return () => { active = false; };
  }, [kind, reference.assetId, reference.assetVersionId, user]);

  if (message) return <span style={previewMessageStyle}>{message}</span>;
  if (!source) return <span style={previewMessageStyle}>Loading preview…</span>;
  if (failed) return <img alt="" src={source.fallbackUrl} style={motionMediaStyle} />;
  return source.format === 'mp4' ? (
    <video
      autoPlay
      loop
      muted
      onError={() => setFailed(true)}
      playsInline
      poster={source.fallbackUrl}
      preload="metadata"
      src={source.url}
      style={motionMediaStyle}
    />
  ) : (
    <ThemeLottiePreview fallbackUrl={source.fallbackUrl} onError={() => setFailed(true)} uri={source.url} />
  );
}

function ThemeLottiePreview({ fallbackUrl, onError, uri }: {
  fallbackUrl: string;
  onError: () => void;
  uri: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let cancelled = false;
    let animation: AnimationItem | undefined;
    void fetch(uri)
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load Lottie preview.');
        return response.json();
      })
      .then((animationData) => {
        if (cancelled || !hostRef.current) return;
        host.innerHTML = '';
        animation = lottie.loadAnimation({
          animationData,
          autoplay: true,
          container: host,
          loop: true,
          renderer: 'svg',
        });
      })
      .catch(() => {
        if (!cancelled) onError();
      });
    return () => {
      cancelled = true;
      animation?.destroy();
    };
  }, [onError, uri]);
  return <div ref={hostRef} style={{ ...motionMediaStyle, backgroundImage: `url(${fallbackUrl})` }} />;
}

async function loadThemeMotionPreview(
  user: User,
  reference: ThemeMotionReference,
  expectedFormat: ThemeMotionPreviewSource['format'],
): Promise<ThemeMotionPreviewSource> {
  const detail = await loadCosmeticAssetDetail(user, reference.assetId);
  const version = requireApprovedVersion(detail, reference, expectedFormat);
  if (!version.fallbackAssetId || !version.fallbackAssetVersionId) {
    throw new Error('Approved static fallback is missing.');
  }
  const fallbackReference = {
    assetId: version.fallbackAssetId,
    assetVersionId: version.fallbackAssetVersionId,
  };
  const fallbackDetail = await loadCosmeticAssetDetail(user, fallbackReference.assetId);
  const fallback = requireApprovedVersion(fallbackDetail, fallbackReference, ['jpeg', 'png']);
  const [url, fallbackUrl] = await Promise.all([
    getDownloadURL(ref(firebaseStorage, version.storagePath)),
    getDownloadURL(ref(firebaseStorage, fallback.storagePath)),
  ]);
  return { fallbackUrl, format: expectedFormat, url };
}

async function loadCosmeticAssetDetail(user: User, assetId: string): Promise<AdminCosmeticAssetDetail> {
  const result = await requestAdminCosmeticAssets(user, { assetId });
  if (!('versions' in result)) throw new Error('Asset preview record is unavailable.');
  return result;
}

function requireApprovedVersion(
  detail: AdminCosmeticAssetDetail,
  reference: ThemeMotionReference,
  expectedFormat: string | string[],
): AdminCosmeticAssetVersion {
  const formats = Array.isArray(expectedFormat) ? expectedFormat : [expectedFormat];
  const version = detail.versions.find((candidate) => candidate.assetVersionId === reference.assetVersionId);
  const approval = detail.approvals.find((candidate) => (
    candidate.assetId === reference.assetId
    && candidate.assetVersionId === reference.assetVersionId
    && candidate.decision === 'approved'
  ));
  if (
    !detail.asset
    || !version
    || !approval
    || detail.asset.assetId !== reference.assetId
    || detail.asset.category !== 'room-theme'
    || detail.asset.moderationStatus !== 'approved'
    || detail.asset.publicationStatus !== 'published'
    || detail.asset.renderingEnabled !== true
    || detail.asset.publishedVersionId !== reference.assetVersionId
    || detail.asset.approvedVersionId !== reference.assetVersionId
    || detail.asset.approvalId !== `${reference.assetId}__${reference.assetVersionId}`
    || version.assetId !== reference.assetId
    || version.category !== 'room-theme'
    || !formats.includes(version.format)
    || approval.checksum !== version.sha256
  ) {
    throw new Error('Only the exact approved room-theme version can be previewed.');
  }
  return version;
}

const motionMediaStyle = {
  height: '100%',
  inset: 0,
  objectFit: 'cover',
  position: 'absolute',
  width: '100%',
} as const;

const previewMessageStyle = {
  alignItems: 'center',
  color: '#FFF4DE',
  display: 'flex',
  fontSize: 10,
  inset: 0,
  justifyContent: 'center',
  padding: 4,
  position: 'absolute',
  textAlign: 'center',
} as const;

function createManifest(themeId: string): AdminRoomThemeManifest {
  const layouts = {
    '5': grid(5),
    '10': grid(10),
    '15': grid(15),
    '20': grid(20),
  };
  return upgradeRoomThemeManifestToV3({
    manifestVersion: 2,
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
    layouts,
    motion: { ambient: [], background: null },
  });
}

function getMotion(manifest: AdminRoomThemeManifest): NonNullable<AdminRoomThemeManifest['motion']> {
  return manifest.motion || { ambient: [], background: null };
}

function sanitizeMotion(manifest: AdminRoomThemeManifest): AdminRoomThemeManifest {
  if (manifest.manifestVersion < 2 || !manifest.motion) return manifest;
  return {
    ...manifest,
    motion: {
      ...manifest.motion,
      ambient: manifest.motion.ambient.filter((slot) => (
        slot?.asset.assetId || slot?.asset.assetVersionId
      )),
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

function useObjectUrl(file: File | undefined, fallback?: string) {
  const [url, setUrl] = useState(fallback);
  useEffect(() => {
    if (!file) {
      setUrl(fallback);
      return undefined;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [fallback, file]);
  return url;
}
