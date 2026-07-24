import { OPAQUE_TOKEN_PATTERN } from './contracts';

export function readBootstrapTicket(hash: string): string {
  if (!hash.startsWith('#')) return '';
  const fragment = hash.slice(1);
  const params = new URLSearchParams(fragment);
  if ([...params.keys()].length !== 1 || !params.has('ticket')) return '';
  const ticket = params.get('ticket') ?? '';
  return OPAQUE_TOKEN_PATTERN.test(ticket) ? ticket : '';
}

export function clearBootstrapFragment(history: Pick<History, 'replaceState'>, location: Pick<Location, 'pathname' | 'search'>): void {
  history.replaceState(null, '', `${location.pathname}${location.search}`);
}

export function createRequestId(randomUuid: () => string = crypto.randomUUID): string {
  const value = randomUuid().replace(/[^A-Za-z0-9_-]/g, '');
  return `portal_${value}`.slice(0, 80);
}
