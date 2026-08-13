import { useState } from 'react';

import {
  resolveBottomEffectStageGeometry,
} from '../../src/voice/bottomEffectStageContract';
import {
  buildRoomEffectCopy,
  resolveRoomEffectSurface,
  ROOM_EFFECT_COPY_TEMPLATE_VERSION,
  type RoomGiftPresentationTier,
} from '../../src/voice/roomEffectPresentation';
import './BottomEffectStagePreview.css';

const PHONE_PROFILES = {
  compact: { height: 720, label: 'هاتف مدمج 360×720', safeAreaBottom: 24, width: 360 },
  tall: { height: 852, label: 'هاتف طويل 393×852', safeAreaBottom: 34, width: 393 },
} as const;

type ApprovalState = {
  androidPassed: boolean;
  controlsSafeZonePassed: boolean;
  iosPassed: boolean;
};

export function BottomEffectStagePreview({
  animationEnabled,
  approval,
  itemNameAr,
  kind,
  tier = 'major',
  visualFormat,
}: {
  animationEnabled: boolean;
  approval: ApprovalState;
  itemNameAr: string;
  kind: 'entry' | 'gift';
  tier?: RoomGiftPresentationTier;
  visualFormat?: string;
}) {
  const [profileId, setProfileId] = useState<keyof typeof PHONE_PROFILES>('compact');
  const profile = PHONE_PROFILES[profileId];
  const geometry = resolveBottomEffectStageGeometry({
    safeAreaBottom: profile.safeAreaBottom,
    viewportHeight: profile.height,
    viewportWidth: profile.width,
  });
  const surface = kind === 'entry'
    ? resolveRoomEffectSurface('room-entry')
    : resolveRoomEffectSurface('room-gift', tier);
  const copy = kind === 'gift'
    ? buildRoomEffectCopy({
      itemName: { ar: itemNameAr || 'هدية ملكية' },
      kind: 'gift',
      quantity: 3,
      recipientDisplayName: 'سارة',
      schemaVersion: ROOM_EFFECT_COPY_TEMPLATE_VERSION,
      senderDisplayName: 'أحمد',
    }, 'ar')
    : buildRoomEffectCopy({
      entrantDisplayNames: ['أحمد'],
      itemName: { ar: itemNameAr || 'مؤثر الدخول' },
      kind: 'entry',
      schemaVersion: ROOM_EFFECT_COPY_TEMPLATE_VERSION,
    }, 'ar');
  const stageStyle = surface === 'bottom-stage' ? {
    bottom: `${geometry.bottom / profile.height * 100}%`,
    height: `${geometry.height / profile.height * 100}%`,
    left: `${geometry.left / profile.width * 100}%`,
    right: `${geometry.right / profile.width * 100}%`,
  } : undefined;

  return (
    <section className="bottom-effect-admin-preview" data-surface={surface}>
      <header>
        <div>
          <strong>معاينة مطابقة لسطح الغرفة</strong>
          <small>النص والموقع ونسبة المرحلة من عقد التطبيق نفسه.</small>
        </div>
        <label>
          <span>حجم الهاتف</span>
          <select aria-label="حجم هاتف المعاينة" onChange={(event) => setProfileId(event.target.value as keyof typeof PHONE_PROFILES)} value={profileId}>
            {Object.entries(PHONE_PROFILES).map(([id, value]) => <option key={id} value={id}>{value.label}</option>)}
          </select>
        </label>
      </header>
      <div className="bottom-effect-admin-layout">
        <div
          aria-label={`معاينة ${surface}`}
          className="bottom-effect-admin-phone"
          style={{ aspectRatio: `${profile.width} / ${profile.height}` }}
        >
          <div className="bottom-effect-admin-room-header">غرفة السهرة</div>
          <div className="bottom-effect-admin-seats" aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => <span key={index}>{index + 1}</span>)}
          </div>
          <div className="bottom-effect-admin-safe-zone" aria-hidden="true">منطقة التحكم المحمية</div>
          <div className="bottom-effect-admin-controls" aria-hidden="true">
            <span>🎤</span><span>💬</span><span>🎁</span><span>⋯</span>
          </div>
          <div
            className={`bottom-effect-admin-stage surface-${surface}`}
            data-testid="bottom-effect-admin-stage"
            style={stageStyle}
          >
            <div className="bottom-effect-admin-media">
              <b>{animationEnabled ? visualFormat === 'mp4' ? 'MP4' : 'LOTTIE' : 'STATIC'}</b>
            </div>
            <div className="bottom-effect-admin-copy">
              <span>{kind === 'gift' ? 'أ ⇄ س' : 'أ'}</span>
              <p>{copy}</p>
            </div>
          </div>
        </div>
        <aside>
          <span className="bottom-effect-admin-surface">{surface}</span>
          <p>{copy}</p>
          <ul>
            <li className={approval.androidPassed ? 'passed' : ''}>Android</li>
            <li className={approval.iosPassed ? 'passed' : ''}>iOS</li>
            <li className={approval.controlsSafeZonePassed ? 'passed' : ''}>منطقة التحكم الآمنة</li>
          </ul>
          <small>لا توجد حقول موضع أو نص حر؛ المعاينة تتبع السطح المحدد تلقائيًا.</small>
        </aside>
      </div>
    </section>
  );
}

export { PHONE_PROFILES };
