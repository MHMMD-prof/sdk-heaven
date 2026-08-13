import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { resolveBottomEffectStageGeometry } from '../../src/voice/bottomEffectStageContract';
import { BottomEffectStagePreview, PHONE_PROFILES } from './BottomEffectStagePreview';

const approval = {
  androidPassed: true,
  controlsSafeZonePassed: true,
  iosPassed: true,
};

describe('bottom effect admin preview', () => {
  it('uses the shared app geometry for both representative phone profiles', () => {
    expect(Object.keys(PHONE_PROFILES)).toEqual(['compact', 'tall']);
    expect(resolveBottomEffectStageGeometry({
      safeAreaBottom: PHONE_PROFILES.compact.safeAreaBottom,
      viewportHeight: PHONE_PROFILES.compact.height,
      viewportWidth: PHONE_PROFILES.compact.width,
    })).toEqual({ bottom: 116, height: 259, left: -16, right: -16, width: 360 });
    expect(resolveBottomEffectStageGeometry({
      safeAreaBottom: PHONE_PROFILES.tall.safeAreaBottom,
      viewportHeight: PHONE_PROFILES.tall.height,
      viewportWidth: PHONE_PROFILES.tall.width,
    })).toEqual({ bottom: 126, height: 283, left: -16, right: -16, width: 393 });
  });

  it('renders authoritative gift copy and the exact tier surface without free-position controls', () => {
    const major = renderToStaticMarkup(
      <BottomEffectStagePreview animationEnabled approval={approval} itemNameAr="وردة ملكية" kind="gift" tier="major" visualFormat="mp4" />,
    );
    expect(major).toContain('data-surface="bottom-stage"');
    expect(major).toContain('أحمد أرسل وردة ملكية ×3 إلى سارة');
    expect(major).toContain('منطقة التحكم المحمية');
    expect(major).not.toContain('name="position');

    const inline = renderToStaticMarkup(
      <BottomEffectStagePreview animationEnabled approval={approval} itemNameAr="وردة" kind="gift" tier="inline" visualFormat="lottie-json" />,
    );
    expect(inline).toContain('data-surface="compact"');

    const targeted = renderToStaticMarkup(
      <BottomEffectStagePreview animationEnabled approval={approval} itemNameAr="وردة" kind="gift" tier="targeted" visualFormat="lottie-json" />,
    );
    expect(targeted).toContain('data-surface="target-seat"');
  });

  it('renders entry copy on the bottom stage and exposes all approval gates', () => {
    const markup = renderToStaticMarkup(
      <BottomEffectStagePreview animationEnabled approval={approval} itemNameAr="سيارة الظل" kind="entry" visualFormat="mp4" />,
    );
    expect(markup).toContain('data-surface="bottom-stage"');
    expect(markup).toContain('أحمد دخل إلى الغرفة باستخدام سيارة الظل');
    expect(markup.match(/class="passed"/g)).toHaveLength(3);
  });
});
