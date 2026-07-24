import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AdminCollectionState, AdminStatusBadge } from './AdminUi';

describe('admin UI states', () => {
  it('renders explicit loading, empty, and retryable error states', () => {
    const loading = renderToStaticMarkup(<AdminCollectionState empty={false} emptyMessage="" loading loadingMessage="جارٍ التحميل"><span>content</span></AdminCollectionState>);
    const empty = renderToStaticMarkup(<AdminCollectionState empty emptyMessage="لا توجد نتائج" loading={false} loadingMessage=""><span>content</span></AdminCollectionState>);
    const error = renderToStaticMarkup(<AdminCollectionState empty={false} emptyMessage="" error="network" loading={false} loadingMessage="" onRetry={() => undefined}><span>content</span></AdminCollectionState>);
    expect(loading).toContain('aria-busy="true"');
    expect(empty).toContain('لا توجد نتائج');
    expect(error).toContain('role="alert"');
    expect(error).toContain('إعادة المحاولة');
  });

  it('renders semantic status tones', () => {
    expect(renderToStaticMarkup(<AdminStatusBadge tone="danger">محظور</AdminStatusBadge>)).toContain('tone-danger');
  });
});
