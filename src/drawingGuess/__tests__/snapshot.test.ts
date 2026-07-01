import { describe, expect, it } from 'vitest';

import {
  assembleSnapshotChunks,
  chunkSnapshot,
  DrawingGuessSnapshotReassembler,
} from '../model/snapshot';
import { DrawingGuessSnapshot } from '../model/types';
import { createInitialDrawingGuessState } from '../model/drawingGuessReducer';

const createSnapshot = (): DrawingGuessSnapshot => ({
  schemaVersion: 1,
  state: createInitialDrawingGuessState({ roomId: 'room-1', matchId: 'match-1' }),
  createdAt: 1000,
});

describe('Drawing Guess snapshots', () => {
  it('reassembles chunks out of order', () => {
    const snapshot = createSnapshot();
    const chunks = chunkSnapshot('snapshot-1', snapshot, 80);
    const reversedChunks = [...chunks].reverse();

    expect(assembleSnapshotChunks(reversedChunks)).toEqual(snapshot);
  });

  it('does not apply missing chunks', () => {
    const chunks = chunkSnapshot('snapshot-1', createSnapshot(), 80);

    expect(assembleSnapshotChunks(chunks.slice(1))).toBeUndefined();
  });

  it('rejects bad checksum', () => {
    const chunks = chunkSnapshot('snapshot-1', createSnapshot(), 80);
    const corruptedChunks = [
      {
        ...chunks[0],
        payload: `${chunks[0].payload}x`,
      },
      ...chunks.slice(1),
    ];

    expect(() => assembleSnapshotChunks(corruptedChunks)).toThrow(
      'Drawing Guess snapshot checksum mismatch.',
    );
  });

  it('discards expired incomplete snapshots', () => {
    const chunks = chunkSnapshot('snapshot-1', createSnapshot(), 80);
    const reassembler = new DrawingGuessSnapshotReassembler(100);

    expect(reassembler.pushChunk(chunks[0], 1000)).toBeUndefined();
    expect(reassembler.hasPending('snapshot-1')).toBe(true);

    reassembler.sweepExpired(1201);
    expect(reassembler.hasPending('snapshot-1')).toBe(false);
  });
});
