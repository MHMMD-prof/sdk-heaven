import { DRAWING_GUESS_SNAPSHOT } from './constants';
import { DrawingGuessSnapshot, DrawingGuessSnapshotChunk } from './types';

export const calculateSnapshotChecksum = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
};

export const encodeSnapshot = (snapshot: DrawingGuessSnapshot) => JSON.stringify(snapshot);

export const decodeSnapshot = (payload: string): DrawingGuessSnapshot => {
  const parsed = JSON.parse(payload) as DrawingGuessSnapshot;

  if (parsed.schemaVersion !== 1 || !parsed.state || typeof parsed.createdAt !== 'number') {
    throw new Error('Invalid Drawing Guess snapshot.');
  }

  return parsed;
};

export const chunkSnapshot = (
  snapshotId: string,
  snapshot: DrawingGuessSnapshot,
  maxPayloadLength: number = DRAWING_GUESS_SNAPSHOT.maxChunkPayloadLength,
): DrawingGuessSnapshotChunk[] => {
  const encoded = encodeSnapshot(snapshot);
  const checksum = calculateSnapshotChecksum(encoded);
  const chunkCount = Math.max(1, Math.ceil(encoded.length / maxPayloadLength));

  return Array.from({ length: chunkCount }, (_, chunkIndex) => ({
    snapshotId,
    chunkIndex,
    chunkCount,
    checksum,
    createdAt: snapshot.createdAt,
    payload: encoded.slice(
      chunkIndex * maxPayloadLength,
      chunkIndex * maxPayloadLength + maxPayloadLength,
    ),
  }));
};

export const assembleSnapshotChunks = (chunks: DrawingGuessSnapshotChunk[]) => {
  if (!chunks.length) {
    return undefined;
  }

  const [firstChunk] = chunks;
  const hasSameEnvelope = chunks.every(
    (chunk) =>
      chunk.snapshotId === firstChunk.snapshotId &&
      chunk.chunkCount === firstChunk.chunkCount &&
      chunk.checksum === firstChunk.checksum,
  );

  if (!hasSameEnvelope || chunks.length !== firstChunk.chunkCount) {
    return undefined;
  }

  const sortedChunks = [...chunks].sort((left, right) => left.chunkIndex - right.chunkIndex);
  const hasEveryChunk = sortedChunks.every((chunk, index) => chunk.chunkIndex === index);

  if (!hasEveryChunk) {
    return undefined;
  }

  const payload = sortedChunks.map((chunk) => chunk.payload).join('');

  if (calculateSnapshotChecksum(payload) !== firstChunk.checksum) {
    throw new Error('Drawing Guess snapshot checksum mismatch.');
  }

  return decodeSnapshot(payload);
};

type PendingSnapshot = {
  firstSeenAt: number;
  chunks: Map<number, DrawingGuessSnapshotChunk>;
};

export class DrawingGuessSnapshotReassembler {
  private pendingSnapshots = new Map<string, PendingSnapshot>();

  constructor(private readonly ttlMs: number = DRAWING_GUESS_SNAPSHOT.incompleteSnapshotTtlMs) {}

  pushChunk(chunk: DrawingGuessSnapshotChunk, now: number) {
    const existing = this.pendingSnapshots.get(chunk.snapshotId);
    const pending = existing ?? {
      firstSeenAt: now,
      chunks: new Map<number, DrawingGuessSnapshotChunk>(),
    };

    pending.chunks.set(chunk.chunkIndex, chunk);
    this.pendingSnapshots.set(chunk.snapshotId, pending);

    if (now - pending.firstSeenAt > this.ttlMs) {
      this.pendingSnapshots.delete(chunk.snapshotId);
      return undefined;
    }

    const chunks = Array.from(pending.chunks.values());

    if (chunks.length !== chunk.chunkCount) {
      return undefined;
    }

    const snapshot = assembleSnapshotChunks(chunks);
    this.pendingSnapshots.delete(chunk.snapshotId);

    return snapshot;
  }

  sweepExpired(now: number) {
    this.pendingSnapshots.forEach((pending, snapshotId) => {
      if (now - pending.firstSeenAt > this.ttlMs) {
        this.pendingSnapshots.delete(snapshotId);
      }
    });
  }

  hasPending(snapshotId: string) {
    return this.pendingSnapshots.has(snapshotId);
  }
}
