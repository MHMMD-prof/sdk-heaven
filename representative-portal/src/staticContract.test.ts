import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

describe('portal static accessibility and responsive contract', () => {
  it('locks the document to Arabic RTL with safe viewport and referrer behavior', () => {
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain('name="referrer" content="no-referrer"');
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  });

  it('provides numeric keyboard hints, exact input lengths, labels, and modal semantics', () => {
    expect(app).toContain('inputMode="numeric"');
    expect(app).toContain('maxLength={7}');
    expect(app).toContain('maxLength={6}');
    expect(app).toContain('enterKeyHint="search"');
    expect(app).toContain('enterKeyHint="done"');
    expect(app).toContain('aria-label="معرّف المستلم العادي المكوّن من سبعة أرقام"');
    expect(app).toContain('role="dialog" aria-modal="true"');
    expect(app).toContain('disabled={!state.online || state.busy');
  });

  it('supports narrow screens, dynamic safe areas, and reduced motion', () => {
    expect(styles).toContain('@media (max-width: 420px)');
    expect(styles).toContain('@media (max-width: 350px)');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('env(safe-area-inset-bottom)');
    expect(styles).toContain('min-height: 100dvh');
  });
});
