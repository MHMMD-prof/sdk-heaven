const { normalizeDailyLoginCampaignVersion } = require('./dailyLoginCore');

const DAILY_LOGIN_ADMIN_OPERATIONS = Object.freeze([
  'emergency-disable',
  'emergency-enable',
  'publish',
  'rollback',
  'save-draft',
  'set-claims-paused',
  'set-presentation-visible',
]);

function normalizeAdminDailyLoginMutation(input) {
  if (!isPlainObject(input)) return invalid();
  const operation = typeof input.operation === 'string' ? input.operation.trim() : '';
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
  const requestId = typeof input.requestId === 'string' ? input.requestId.trim() : '';
  const expectedRevision = input.expectedRevision;
  if (
    !DAILY_LOGIN_ADMIN_OPERATIONS.includes(operation)
    || reason.length < 3
    || !/^[A-Za-z0-9_-]{12,80}$/.test(requestId)
    || !Number.isSafeInteger(expectedRevision)
    || expectedRevision < 0
  ) return invalid();
  const template = input.template === undefined ? undefined : normalizeDailyLoginTemplate(input.template);
  if (input.template !== undefined && !template) return invalid('A valid seven-day reward template is required.');
  if (['save-draft', 'publish'].includes(operation) && !template && operation === 'save-draft') {
    return invalid('A reward template is required to save a draft.');
  }
  const rollbackRevision = input.rollbackRevision === undefined ? 0 : input.rollbackRevision;
  if (operation === 'rollback' && (!Number.isSafeInteger(rollbackRevision) || rollbackRevision < 1)) {
    return invalid('A valid rollback revision is required.');
  }
  const enabled = input.enabled;
  if (
    ['set-claims-paused', 'set-presentation-visible'].includes(operation)
    && typeof enabled !== 'boolean'
  ) return invalid('The requested state is required.');
  return {
    ok: true,
    value: {
      ...(typeof enabled === 'boolean' ? { enabled } : {}),
      expectedRevision,
      operation,
      reason,
      requestId,
      ...(rollbackRevision ? { rollbackRevision } : {}),
      ...(template ? { template } : {}),
    },
  };
}

function normalizeDailyLoginTemplate(input) {
  if (!isPlainObject(input)) return undefined;
  const normalized = normalizeDailyLoginCampaignVersion({
    minimumClientVersion: input.minimumClientVersion,
    publicationStatus: 'published',
    revision: 1,
    rewards: input.rewards,
    schemaVersion: 1,
    timeZone: 'Asia/Baghdad',
  });
  if (!normalized.ok) return undefined;
  return {
    minimumClientVersion: normalized.value.minimumClientVersion,
    rewards: normalized.value.rewards,
    schemaVersion: 1,
    timeZone: 'Asia/Baghdad',
  };
}

function calculateDailyLoginLiability(template, claimants) {
  if (!template || !Array.isArray(template.rewards) || !Number.isSafeInteger(claimants) || claimants < 0) {
    return undefined;
  }
  const perCycle = template.rewards.reduce((total, entry) => ({
    coins: total.coins + entry.reward.coins,
    diamonds: total.diamonds + entry.reward.diamonds,
    items: total.items + entry.reward.items.length,
  }), { coins: 0, diamonds: 0, items: 0 });
  return {
    claimants,
    coins: perCycle.coins * claimants,
    diamonds: perCycle.diamonds * claimants,
    items: perCycle.items * claimants,
  };
}

function invalid(error = 'The Daily Login campaign request is invalid.') {
  return { ok: false, status: 400, error };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

module.exports = {
  DAILY_LOGIN_ADMIN_OPERATIONS,
  calculateDailyLoginLiability,
  normalizeAdminDailyLoginMutation,
  normalizeDailyLoginTemplate,
};
