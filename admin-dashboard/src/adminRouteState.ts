import { useEffect, useLayoutEffect, useRef } from 'react';

import { AdminRouteKey } from './adminRoutes';

type StoredRouteSnapshot<T> = { capturedAt: number; scrollY: number; value: T; version: 1 };
const MAX_SNAPSHOT_AGE_MS = 30 * 60 * 1000;

export function readAdminRouteSnapshot<T>(route: AdminRouteKey): StoredRouteSnapshot<T> | undefined {
  const candidate = window.history.state?.adminRouteSnapshots?.[route];
  if (!candidate || candidate.version !== 1 || typeof candidate.capturedAt !== 'number' || Date.now() - candidate.capturedAt > MAX_SNAPSHOT_AGE_MS || typeof candidate.scrollY !== 'number' || !candidate.value || typeof candidate.value !== 'object') return undefined;
  return candidate as StoredRouteSnapshot<T>;
}

export function writeAdminRouteSnapshot<T>(route: AdminRouteKey, value: T, scrollY = window.scrollY) {
  const current = window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
  const snapshots = current.adminRouteSnapshots && typeof current.adminRouteSnapshots === 'object' ? current.adminRouteSnapshots : {};
  window.history.replaceState({ ...current, adminRouteSnapshots: { ...snapshots, [route]: { capturedAt: Date.now(), scrollY: Math.max(0, scrollY), value, version: 1 } } }, '', window.location.href);
}

export function useAdminRouteSnapshot<T>(route: AdminRouteKey, value: T, restoredScrollY = 0) {
  const valueRef = useRef(value);
  valueRef.current = value;
  useLayoutEffect(() => {
    if (restoredScrollY <= 0) return;
    const frame = window.requestAnimationFrame(() => window.scrollTo({ left: 0, top: restoredScrollY }));
    return () => window.cancelAnimationFrame(frame);
  }, [restoredScrollY, route]);
  useEffect(() => { writeAdminRouteSnapshot(route, valueRef.current); }, [route, value]);
  useEffect(() => {
    let frame = 0;
    const capture = () => { window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(() => writeAdminRouteSnapshot(route, valueRef.current)); };
    window.addEventListener('scroll', capture, { passive: true });
    return () => { window.removeEventListener('scroll', capture); window.cancelAnimationFrame(frame); writeAdminRouteSnapshot(route, valueRef.current); };
  }, [route]);
}

export function mergeAdminRouteSnapshotState(current: unknown, route: AdminRouteKey, snapshot: unknown) {
  const state = current && typeof current === 'object' ? current as Record<string, unknown> : {};
  const existing = state.adminRouteSnapshots && typeof state.adminRouteSnapshots === 'object' ? state.adminRouteSnapshots as Record<string, unknown> : {};
  return { ...state, adminRouteSnapshots: { ...existing, [route]: snapshot } };
}
