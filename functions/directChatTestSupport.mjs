// Shared in-memory Firestore and Storage doubles for the direct-chat suites. Extracted from
// directChatService.test.mjs so the moderation suites exercise the same semantics rather than a
// second, subtly different fake.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFriendshipId } = require('./socialFriendsCore');

export function createFakeDb() {
  const documents = new Map();
  const clock = {
    now: Date.UTC(2026, 7, 2, 12),
    nowMillis() { return this.now; },
    timestampFromMillis(value) { return value; },
  };
  const makeRef = (path) => ({
    id: path.split('/').at(-1),
    path,
    collection(name) { return makeCollection(`${path}/${name}`); },
    async delete() { documents.delete(path); },
    async get() { return snapshot(makeRef(path)); },
    async set(value, options) {
      documents.set(path, options?.merge
        ? { ...(documents.get(path) || {}), ...structuredClone(value) }
        : structuredClone(value));
    },
    async update(value) {
      if (!documents.has(path)) throw new Error(`missing: ${path}`);
      documents.set(path, { ...documents.get(path), ...structuredClone(value) });
    },
  });
  const snapshot = (reference) => ({
    exists: documents.has(reference.path),
    id: reference.id,
    data: () => documents.get(reference.path),
    ref: reference,
  });
  const makeQuery = (collectionId, prefix = '') => {
    const filters = [];
    const ordering = [];
    let afterValues;
    let maximum = Number.POSITIVE_INFINITY;
    const query = {
      __query: true,
      where(field, operator, value) { filters.push([field, operator, value]); return query; },
      orderBy(field, direction = 'asc') { ordering.push([field, direction]); return query; },
      startAfter(...values) { afterValues = values; return query; },
      limit(value) { maximum = value; db.queryLimits.push(value); return query; },
      async get() {
        let entries = [...documents.entries()]
          .filter(([path]) => matchesCollection(path, collectionId, prefix))
          .filter(([, value]) => filters.every(([field, operator, expected]) => compare(value?.[field], operator, expected)));
        entries.sort((left, right) => compareOrdered(left[1], right[1], ordering));
        if (afterValues) {
          entries = entries.filter(([, value]) => isAfter(value, ordering, afterValues));
        }
        const docs = entries.slice(0, maximum).map(([path]) => snapshot(makeRef(path)));
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    };
    return query;
  };
  const makeCollection = (path) => ({
    doc(id) { return makeRef(`${path}/${id}`); },
    ...makeQuery(path.split('/').at(-1), path),
  });
  const transaction = {
    async get(reference) { return reference?.__query ? reference.get() : snapshot(reference); },
    create(reference, value) {
      if (documents.has(reference.path)) throw new Error(`already exists: ${reference.path}`);
      documents.set(reference.path, structuredClone(value));
    },
    delete(reference) { documents.delete(reference.path); },
    set(reference, value, options) {
      documents.set(reference.path, options?.merge
        ? { ...(documents.get(reference.path) || {}), ...structuredClone(value) }
        : structuredClone(value));
    },
    update(reference, value) {
      if (!documents.has(reference.path)) throw new Error(`missing: ${reference.path}`);
      documents.set(reference.path, { ...documents.get(reference.path), ...structuredClone(value) });
    },
  };
  let transactionTail = Promise.resolve();
  const db = {
    clock,
    queryLimits: [],
    batch() {
      const deletes = [];
      return { delete(reference) { deletes.push(reference); }, async commit() { deletes.forEach((reference) => documents.delete(reference.path)); } };
    },
    collection(path) { return makeCollection(path); },
    collectionGroup(id) { return makeQuery(id); },
    delete(path) { documents.delete(path); },
    doc(path) { return makeRef(path); },
    async getAll(...references) { return references.map(snapshot); },
    paths(prefix) { return [...documents.keys()].filter((path) => path.startsWith(prefix)); },
    read(path) { return documents.get(path); },
    runTransaction(callback) {
      const result = transactionTail.then(() => callback(transaction));
      transactionTail = result.catch(() => undefined);
      return result;
    },
    write(path, value) { documents.set(path, structuredClone(value)); },
  };
  return db;
}

export function createFakeBucket() {
  const objects = new Map();
  const copies = [];
  const signed = [];
  const file = (path) => ({
    async copy(destination) {
      const object = objects.get(path);
      if (!object) throw new Error('missing');
      const target = typeof destination === 'string' ? destination : destination.path;
      objects.set(target, { bytes: Buffer.from(object.bytes), metadata: object.metadata });
      copies.push({ from: path, to: target });
    },
    async delete() { objects.delete(path); },
    async download() { const object = objects.get(path); if (!object) throw new Error('missing'); return [Buffer.from(object.bytes)]; },
    async exists() { return [objects.has(path)]; },
    path,
    async getMetadata() { const object = objects.get(path); if (!object) throw new Error('missing'); return [{ ...object.metadata, size: String(object.bytes.length) }]; },
    async getSignedUrl(config) {
      if (!objects.has(path)) throw new Error('missing');
      signed.push({ ...config, path });
      return [`https://signed.test/${encodeURIComponent(path)}?expires=${config.expires}`];
    },
    async save(bytes, options) {
      if (options?.preconditionOpts?.ifGenerationMatch === 0 && objects.has(path)) { const error = new Error('exists'); error.code = 412; throw error; }
      objects.set(path, { bytes: Buffer.from(bytes), metadata: options.metadata });
    },
  });
  return {
    copies,
    file,
    paths(prefix) { return [...objects.keys()].filter((path) => path.startsWith(prefix)); },
    read(path) { return objects.get(path); },
    seed(path, bytes, metadata) { objects.set(path, { bytes: Buffer.from(bytes), metadata }); },
    signed,
  };
}

export function seedPair(db, { friends = false } = {}) {
  db.write('appConfig/socialFeatures', { directMessageRequests: true, directMessages: true });
  db.write('appConfig/voiceRoomModeration', { keywordTerms: [] });
  db.write('publicProfiles/user-1', { displayName: 'One', moderationStatus: 'active', uid: 'user-1' });
  db.write('publicProfiles/user-2', { displayName: 'Two', moderationStatus: 'active', uid: 'user-2' });
  if (friends) {
    db.write(`friendships/${createFriendshipId('user-1', 'user-2')}`, { memberUids: ['user-1', 'user-2'] });
  }
  return db.clock;
}

function matchesCollection(path, collectionId, prefix) {
  const parts = path.split('/');
  if (prefix) return path.startsWith(`${prefix}/`) && parts.length === prefix.split('/').length + 1;
  return parts.length >= 2 && parts.at(-2) === collectionId;
}

function compare(actual, operator, expected) {
  if (operator === '==') return actual === expected;
  if (operator === '<=') return actual <= expected;
  if (operator === '>=') return actual >= expected;
  if (operator === '>') return actual > expected;
  if (operator === '<') return actual < expected;
  throw new Error(`unsupported operator ${operator}`);
}

function compareOrdered(left, right, ordering) {
  for (const [field, direction] of ordering) {
    const comparison = left?.[field] === right?.[field] ? 0 : left?.[field] < right?.[field] ? -1 : 1;
    if (comparison !== 0) return direction === 'desc' ? -comparison : comparison;
  }
  return 0;
}

function isAfter(value, ordering, afterValues) {
  for (let index = 0; index < ordering.length; index += 1) {
    const [field, direction] = ordering[index];
    const current = value?.[field];
    const boundary = afterValues[index];
    if (current === boundary) continue;
    return direction === 'desc' ? current < boundary : current > boundary;
  }
  return false;
}
