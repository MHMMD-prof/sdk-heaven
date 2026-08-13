const SENSITIVE_KEY = /(?:authorization|body|content|cookie|draft|email|evidence|media(?:path|url)?|message|name|requestid|text|token|targetuid|uid|url)/i;
const ALLOWED_TAGS = new Set(['app_version', 'build', 'command_action', 'error_code', 'feature', 'platform', 'presentation', 'rollout_stage']);
const ALLOWED_SPAN_ATTRIBUTES = new Set(['command_action', 'error_code', 'feature', 'outcome', 'platform', 'presentation', 'rollout_stage']);

export function sanitizeSentryEvent<T extends Record<string, unknown>>(event: T): T {
  const sanitized = sanitizeRecord(event, 0) as T;
  delete sanitized.user;
  const record = sanitized as Record<string, unknown>;
  if (record.tags && typeof record.tags === 'object') {
    record.tags = Object.fromEntries(Object.entries(record.tags as Record<string, unknown>)
      .filter(([key]) => ALLOWED_TAGS.has(key))
      .map(([key, value]) => [key, boundedScalar(value)]));
  }
  return sanitized;
}

export function sanitizeSentryBreadcrumb<T extends Record<string, unknown>>(breadcrumb: T): T | null {
  if (breadcrumb.category !== 'personal-chat') return sanitizeRecord(breadcrumb, 0) as T;
  return {
    ...breadcrumb,
    data: sanitizeAllowedRecord(breadcrumb.data, ALLOWED_SPAN_ATTRIBUTES),
    message: typeof breadcrumb.message === 'string' ? breadcrumb.message.slice(0, 64) : undefined,
  };
}

export function sanitizeSentrySpan<T extends Record<string, unknown>>(span: T): T {
  return {
    ...span,
    data: sanitizeAllowedRecord(span.data, ALLOWED_SPAN_ATTRIBUTES),
    description: typeof span.description === 'string' ? span.description.slice(0, 64) : span.description,
  };
}

export function sanitizeChatAttributes(value: unknown) {
  return sanitizeAllowedRecord(value, ALLOWED_SPAN_ATTRIBUTES);
}

function sanitizeAllowedRecord(value: unknown, allowed: Set<string>) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => allowed.has(key))
    .map(([key, entry]) => [key, boundedScalar(entry)]));
}

function sanitizeRecord(value: unknown, depth: number): unknown {
  if (depth > 5) return '[Truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => sanitizeRecord(entry, depth + 1));
  if (!value || typeof value !== 'object') return boundedScalar(value);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[Redacted]' : sanitizeRecord(entry, depth + 1),
  ]));
}

function boundedScalar(value: unknown) {
  if (typeof value === 'string') return value.slice(0, 128);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value == null) return undefined;
  return '[Redacted]';
}
