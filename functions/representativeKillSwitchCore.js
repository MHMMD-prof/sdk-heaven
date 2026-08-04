const VALUE_ARGUMENTS = new Set(['--actor-uid', '--reason']);
const BOOLEAN_ARGUMENTS = new Set(['--acknowledge-enable', '--apply', '--enable']);

function normalizeRepresentativeFlagCommand(args = []) {
  if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
    return { ok: false, error: 'Valid command arguments are required.' };
  }
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!VALUE_ARGUMENTS.has(argument) && !BOOLEAN_ARGUMENTS.has(argument)) {
      return { ok: false, error: `Unsupported argument: ${argument}` };
    }
    if (seen.has(argument)) return { ok: false, error: `Duplicate argument: ${argument}` };
    seen.add(argument);
    if (VALUE_ARGUMENTS.has(argument)) {
      if (typeof args[index + 1] !== 'string' || args[index + 1].startsWith('--')) {
        return { ok: false, error: `${argument} requires a value.` };
      }
      index += 1;
    }
  }

  const apply = seen.has('--apply');
  const enable = seen.has('--enable');
  const actorUid = readArgument(args, '--actor-uid').slice(0, 128);
  const reason = readArgument(args, '--reason').slice(0, 300);
  if (enable && !seen.has('--acknowledge-enable')) {
    return { ok: false, error: 'Enabling requires --acknowledge-enable. Emergency disable is the default.' };
  }
  if (apply && (!actorUid || reason.length < 3)) {
    return { ok: false, error: '--actor-uid and --reason with at least 3 characters are required with --apply.' };
  }
  return { ok: true, value: { actorUid, apply, enable, reason } };
}

function isActivePlatformOwner(profile, actorUid) {
  return typeof actorUid === 'string' && actorUid.length > 0
    && profile?.uid === actorUid
    && profile?.role === 'owner'
    && profile?.status === 'active';
}

function readArgument(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || '').trim() : '';
}

module.exports = {
  isActivePlatformOwner,
  normalizeRepresentativeFlagCommand,
};
