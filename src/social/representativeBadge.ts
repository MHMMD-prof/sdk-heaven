export function hasActiveRepresentativeBadge(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const projection = (data as Record<string, unknown>).representativeBadge;
  return Boolean(
    projection
    && typeof projection === 'object'
    && !Array.isArray(projection)
    && (projection as Record<string, unknown>).active === true,
  );
}
