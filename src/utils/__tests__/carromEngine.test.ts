import { describe, expect, it } from 'vitest';

import { CarromDisc, CarromGameState } from '../../types/carrom';
import {
  CARROM_EDGE_BOTTOM,
  CARROM_EDGE_LEFT,
  CARROM_EDGE_RIGHT,
  CARROM_EDGE_TOP,
  CARROM_POCKET_RADIUS,
  CARROM_POCKETS,
  applyShot,
  createInitialCarromState,
  lockStrikerPlacement,
  stepCarrom,
} from '../carromEngine';

const MAX_SETTLE_FRAMES = 700;
const SETTLED_OVERLAP_TOLERANCE = 3;
const BOUNDS_TOLERANCE = 0.001;
const TEST_POCKET_MOUTH_EXTRA_RADIUS = 18;

type ShotDiagnostics = {
  boundsViolation: boolean;
  frames: number;
  maxOverlap: number;
  maxSpeed: number;
};

const settleShot = (state: CarromGameState, maxFrames = MAX_SETTLE_FRAMES) => {
  let current = state;
  const diagnostics: ShotDiagnostics = {
    boundsViolation: false,
    frames: 0,
    maxOverlap: 0,
    maxSpeed: 0,
  };

  assertFrameInvariants(current, diagnostics);

  for (let frame = 0; frame < maxFrames && current.status === 'moving'; frame += 1) {
    current = stepCarrom(current);
    diagnostics.frames = frame + 1;
    assertFrameInvariants(current, diagnostics);
  }

  return { diagnostics, state: current };
};

const traceMovingShot = (
  state: CarromGameState,
  discId: string,
  maxFrames = MAX_SETTLE_FRAMES,
) => {
  let current = state;
  const start = getDisc(current, discId);
  let maxDistance = 0;
  let maxSpeed = Math.hypot(start.vx, start.vy);

  for (let frame = 0; frame < maxFrames && current.status === 'moving'; frame += 1) {
    current = stepCarrom(current);

    if (current.status !== 'moving') {
      break;
    }

    const disc = getDisc(current, discId);

    maxDistance = Math.max(
      maxDistance,
      Math.hypot(disc.x - start.x, disc.y - start.y),
    );
    maxSpeed = Math.max(maxSpeed, Math.hypot(disc.vx, disc.vy));
  }

  return { maxDistance, maxSpeed, state: current };
};

const startShot = (state: CarromGameState, velocity: { vx: number; vy: number }) =>
  applyShot(lockStrikerPlacement(state), velocity);

const settleAfterOneSanitizingStep = (state: CarromGameState) => settleShot(stepCarrom(state));

const getDisc = (state: CarromGameState, id: string) => {
  const disc = state.discs.find((candidate) => candidate.id === id);

  if (!disc) {
    throw new Error(`Missing carrom disc ${id}`);
  }

  return disc;
};

const assertCleanSettlement = (state: CarromGameState, diagnostics: ShotDiagnostics) => {
  expect(state.status).not.toBe('moving');
  expect(diagnostics.frames).toBeLessThan(MAX_SETTLE_FRAMES);
  expect(diagnostics.boundsViolation).toBe(false);
  expect(getMaxOverlap(state.discs)).toBeLessThanOrEqual(SETTLED_OVERLAP_TOLERANCE);

  state.discs.forEach((disc) => {
    if (!disc.pocketed) {
      expect(Math.hypot(disc.vx, disc.vy)).toBe(0);
    }
  });
};

const assertFrameInvariants = (state: CarromGameState, diagnostics: ShotDiagnostics) => {
  state.discs.forEach((disc) => {
    expect(Number.isFinite(disc.x)).toBe(true);
    expect(Number.isFinite(disc.y)).toBe(true);
    expect(Number.isFinite(disc.vx)).toBe(true);
    expect(Number.isFinite(disc.vy)).toBe(true);

    const speed = Math.hypot(disc.vx, disc.vy);
    diagnostics.maxSpeed = Math.max(diagnostics.maxSpeed, speed);

    if (disc.pocketed) {
      expect(speed).toBe(0);
      return;
    }

    diagnostics.boundsViolation ||= isOutsideBoard(disc);
  });

  diagnostics.maxOverlap = Math.max(diagnostics.maxOverlap, getMaxOverlap(state.discs));
};

const getMaxOverlap = (discs: CarromDisc[]) => {
  let maxOverlap = 0;

  for (let i = 0; i < discs.length; i += 1) {
    for (let j = i + 1; j < discs.length; j += 1) {
      const a = discs[i];
      const b = discs[j];

      if (a.pocketed || b.pocketed) {
        continue;
      }

      const overlap = a.radius + b.radius - Math.hypot(b.x - a.x, b.y - a.y);

      if (overlap > maxOverlap) {
        maxOverlap = overlap;
      }
    }
  }

  return maxOverlap;
};

const isOutsideBoard = (disc: CarromDisc) => {
  if (isNearPocket(disc)) {
    return false;
  }

  return (
    disc.x - disc.radius < CARROM_EDGE_LEFT - BOUNDS_TOLERANCE ||
    disc.x + disc.radius > CARROM_EDGE_RIGHT + BOUNDS_TOLERANCE ||
    disc.y - disc.radius < CARROM_EDGE_TOP - BOUNDS_TOLERANCE ||
    disc.y + disc.radius > CARROM_EDGE_BOTTOM + BOUNDS_TOLERANCE
  );
};

const isNearPocket = (disc: CarromDisc) =>
  CARROM_POCKETS.some(
    (pocket) =>
      Math.hypot(disc.x - pocket.x, disc.y - pocket.y) <
      CARROM_POCKET_RADIUS + TEST_POCKET_MOUTH_EXTRA_RADIUS + disc.radius,
  );

const withDisc = (
  state: CarromGameState,
  id: string,
  updates: Partial<CarromDisc>,
): CarromGameState => ({
  ...state,
  discs: state.discs.map((disc) => (disc.id === id ? { ...disc, ...updates } : disc)),
});

const withDiscs = (
  state: CarromGameState,
  updates: Record<string, Partial<CarromDisc>>,
): CarromGameState => ({
  ...state,
  discs: state.discs.map((disc) =>
    updates[disc.id] ? { ...disc, ...updates[disc.id] } : disc,
  ),
});

const createDenseClusterState = () =>
  createInitialCarromState().discs.reduce(
    (state, disc, index) =>
      disc.kind === 'striker'
        ? state
        : withDisc(state, disc.id, {
            x: 500 + (index % 5) * 10,
            y: 500 + Math.floor(index / 5) * 10,
          }),
    createInitialCarromState(),
  );

const createIsolatedTwoDiscState = (
  first: Partial<CarromDisc>,
  second: Partial<CarromDisc>,
): CarromGameState => ({
  ...createInitialCarromState(),
  status: 'moving',
  discs: createInitialCarromState().discs.map((disc) => {
    if (disc.id === 'white-1') {
      return { ...disc, sleepFrames: 5, vx: 0, vy: 0, ...first };
    }

    if (disc.id === 'black-1') {
      return { ...disc, sleepFrames: 5, vx: 0, vy: 0, ...second };
    }

    return { ...disc, pocketed: true, vx: 0, vy: 0, sleepFrames: 5 };
  }),
});

const createIsolatedStrikerCollisionState = (
  striker: Partial<CarromDisc>,
  target: Partial<CarromDisc>,
): CarromGameState => ({
  ...createInitialCarromState(),
  status: 'moving',
  discs: createInitialCarromState().discs.map((disc) => {
    if (disc.id === 'striker') {
      return { ...disc, sleepFrames: 0, ...striker };
    }

    if (disc.id === 'white-1') {
      return { ...disc, sleepFrames: 5, vx: 0, vy: 0, ...target };
    }

    return { ...disc, pocketed: true, vx: 0, vy: 0, sleepFrames: 5 };
  }),
});

const createIsolatedPocketState = (
  discId: string,
  updates: Partial<CarromDisc>,
): CarromGameState => ({
  ...createInitialCarromState(),
  status: 'moving',
  discs: createInitialCarromState().discs.map((disc) =>
    disc.id === discId
      ? { ...disc, sleepFrames: 0, vx: 0, vy: 0, ...updates }
      : { ...disc, pocketed: true, vx: 0, vy: 0, sleepFrames: 5 },
  ),
});

const normalizeState = (state: CarromGameState) => ({
  currentPlayer: state.currentPlayer,
  discs: state.discs.map((disc) => ({
    id: disc.id,
    kind: disc.kind,
    owner: disc.owner,
    pocketed: Boolean(disc.pocketed),
    vx: Number(disc.vx.toFixed(4)),
    vy: Number(disc.vy.toFixed(4)),
    x: Number(disc.x.toFixed(4)),
    y: Number(disc.y.toFixed(4)),
  })),
  queen: state.queen,
  scores: state.scores,
  status: state.status,
  winner: state.winner,
});

describe('carromEngine physics audit', () => {
  it('settles a weak shot cleanly', () => {
    const { diagnostics, state } = settleShot(startShot(createInitialCarromState(), { vx: 3, vy: -4 }));

    assertCleanSettlement(state, diagnostics);
  });

  it('keeps weak shot stopping distance controlled', () => {
    const traced = traceMovingShot(
      startShot(createInitialCarromState(), { vx: 2.5, vy: -3 }),
      'striker',
    );

    expect(traced.maxDistance).toBeGreaterThan(24);
    expect(traced.maxDistance).toBeLessThan(180);
    expect(traced.state.status).not.toBe('moving');
  });

  it('settles a medium center shot cleanly', () => {
    const { diagnostics, state } = settleShot(startShot(createInitialCarromState(), { vx: 12, vy: -20 }));

    assertCleanSettlement(state, diagnostics);
  });

  it('settles medium shots with repeatable timing and final state', () => {
    const first = settleShot(startShot(createInitialCarromState(), { vx: 13, vy: -19 }));
    const second = settleShot(startShot(createInitialCarromState(), { vx: 13, vy: -19 }));

    assertCleanSettlement(first.state, first.diagnostics);
    expect(first.diagnostics.frames).toBe(second.diagnostics.frames);
    expect(normalizeState(first.state)).toEqual(normalizeState(second.state));
  });

  it('transfers energy from a direct striker-to-coin hit', () => {
    const state = createIsolatedStrikerCollisionState(
      {
        x: 500,
        y: 620,
        vx: 0,
        vy: -28,
      },
      {
        x: 500,
        y: 550,
      },
    );
    const stepped = stepCarrom(state);
    const striker = getDisc(stepped, 'striker');
    const target = getDisc(stepped, 'white-1');

    expect(target.vy).toBeLessThan(-6);
    expect(Math.hypot(target.vx, target.vy)).toBeGreaterThan(6);
    expect(Math.hypot(striker.vx, striker.vy)).toBeLessThan(28);
  });

  it('deflects an angled striker-to-coin hit along the contact normal', () => {
    const state = createIsolatedStrikerCollisionState(
      {
        x: 470,
        y: 620,
        vx: 10,
        vy: -28,
      },
      {
        x: 500,
        y: 550,
      },
    );
    const stepped = stepCarrom(state);
    const target = getDisc(stepped, 'white-1');

    expect(target.vx).toBeGreaterThan(1);
    expect(target.vy).toBeLessThan(-3);
  });

  it('rebounds from a rail in the opposite direction', () => {
    const state = createIsolatedStrikerCollisionState(
      {
        x: CARROM_EDGE_LEFT + 29,
        y: 460,
        vx: -18,
        vy: -2,
      },
      {
        pocketed: true,
      },
    );
    const stepped = stepCarrom(state);
    const striker = getDisc(stepped, 'striker');

    expect(striker.vx).toBeGreaterThan(0);
    expect(striker.y).toBeGreaterThan(CARROM_EDGE_TOP);
    expect(striker.y).toBeLessThan(CARROM_EDGE_BOTTOM);
  });

  it('captures a fast coin crossing a pocket center', () => {
    const pocket = CARROM_POCKETS[0];
    const state = createIsolatedPocketState('white-1', {
      x: pocket.x - 34,
      y: pocket.y,
      vx: 34,
      vy: 0,
    });
    const stepped = stepCarrom(state);

    expect(getDisc(stepped, 'white-1').pocketed).toBe(true);
  });

  it('does not capture a slow coin resting in the pocket mouth outside capture range', () => {
    const pocket = CARROM_POCKETS[0];
    const state = createIsolatedPocketState('white-1', {
      x: pocket.x + CARROM_POCKET_RADIUS + 12,
      y: pocket.y,
      vx: 0,
      vy: 0,
    });
    const stepped = stepCarrom(state);

    expect(Boolean(getDisc(stepped, 'white-1').pocketed)).toBe(false);
  });

  it('captures a coin moving into the pocket mouth instead of rebounding it', () => {
    const pocket = CARROM_POCKETS[0];
    const state = createIsolatedPocketState('white-1', {
      x: pocket.x + CARROM_POCKET_RADIUS + 14,
      y: pocket.y + 6,
      vx: -11,
      vy: -1,
    });
    const stepped = stepCarrom(state);
    const coin = getDisc(stepped, 'white-1');

    expect(Boolean(coin.pocketed)).toBe(true);
    expect(coin.vx).toBe(0);
    expect(coin.vy).toBe(0);
  });

  it('keeps repeated fast pocket captures deterministic', () => {
    const pocket = CARROM_POCKETS[0];
    const state = createIsolatedPocketState('white-1', {
      x: pocket.x - 34,
      y: pocket.y,
      vx: 34,
      vy: 0,
    });
    const first = stepCarrom(state);
    const second = stepCarrom(state);

    expect(normalizeState(first)).toEqual(normalizeState(second));
  });

  it('keeps repeated pocket-mouth captures deterministic', () => {
    const pocket = CARROM_POCKETS[0];
    const state = createIsolatedPocketState('white-1', {
      x: pocket.x + CARROM_POCKET_RADIUS + 14,
      y: pocket.y + 6,
      vx: -11,
      vy: -1,
    });
    const first = stepCarrom(state);
    const second = stepCarrom(state);

    expect(normalizeState(first)).toEqual(normalizeState(second));
  });

  it('damps excessive sideways slide on a shallow angled collision', () => {
    const state = createIsolatedStrikerCollisionState(
      {
        x: 470,
        y: 620,
        vx: 10,
        vy: -28,
      },
      {
        x: 500,
        y: 550,
      },
    );
    const stepped = stepCarrom(state);
    const target = getDisc(stepped, 'white-1');

    expect(target.vy).toBeLessThan(-3);
    expect(Math.abs(target.vx)).toBeLessThan(14);
  });

  it('settles a strong shot cleanly', () => {
    const { diagnostics, state } = settleShot(startShot(createInitialCarromState(), { vx: 34, vy: -26 }));

    assertCleanSettlement(state, diagnostics);
  });

  it('keeps a rail bounce inside the playable board', () => {
    const state = withDisc(createInitialCarromState(), 'striker', {
      x: CARROM_EDGE_LEFT + 36,
      y: 460,
    });
    const { diagnostics, state: settled } = settleShot(startShot(state, { vx: -32, vy: -4 }));

    assertCleanSettlement(settled, diagnostics);
  });

  it('resolves a pocketed striker as a foul after the optimized physics loop', () => {
    const pocket = CARROM_POCKETS[0];
    const state = withDisc(createInitialCarromState(), 'striker', {
      x: pocket.x,
      y: pocket.y,
    });
    const { diagnostics, state: settled } = settleShot(startShot(state, { vx: 0, vy: 0 }));

    expect(settled.status).toBe('placing');
    expect(getDisc(settled, 'striker').pocketed).toBe(false);
    assertCleanSettlement(settled, diagnostics);
  });

  it('keeps striker pocketing as a foul after swept pocket capture', () => {
    const pocket = CARROM_POCKETS[0];
    const state = withDisc(createInitialCarromState(), 'striker', {
      x: pocket.x - 36,
      y: pocket.y,
    });
    const { diagnostics, state: settled } = settleShot(startShot(state, { vx: 34, vy: 0 }));

    expect(settled.status).toBe('placing');
    expect(getDisc(settled, 'striker').pocketed).toBe(false);
    assertCleanSettlement(settled, diagnostics);
  });

  it('keeps queen pocketing in the existing rule flow after pocket capture', () => {
    const pocket = CARROM_POCKETS[0];
    const state = createIsolatedPocketState('queen', {
      x: pocket.x - 34,
      y: pocket.y,
      vx: 34,
      vy: 0,
    });
    const settled = stepCarrom(state);

    expect(settled.queen.coveredBy).toBe(1);
    expect(settled.queen.pocketed).toBe(true);
    expect(getDisc(settled, 'queen').pocketed).toBe(true);
  });

  it('scores an own coin pocket and keeps the current player turn', () => {
    const pocket = CARROM_POCKETS[0];
    const state = {
      ...withDisc(createInitialCarromState(), 'white-1', {
        x: pocket.x,
        y: pocket.y,
        vx: 0,
        vy: 0,
      }),
      status: 'moving' as const,
    };
    const settled = stepCarrom(state);

    expect(settled.currentPlayer).toBe(1);
    expect(settled.scores[1]).toBe(1);
    expect(settled.scores[2]).toBe(0);
    expect(getDisc(settled, 'white-1').pocketed).toBe(true);
  });

  it('returns an uncovered queen after the next shot fails to cover it', () => {
    const queenPending = withDisc(
      {
        ...createInitialCarromState(),
        queen: { pendingBy: 1, pocketed: true },
      },
      'queen',
      {
        pocketed: true,
        vx: 0,
        vy: 0,
      },
    );
    const { diagnostics, state: settled } = settleShot(startShot(queenPending, { vx: 4, vy: -3 }));

    expect(settled.queen.pocketed).toBe(false);
    expect(getDisc(settled, 'queen').pocketed).toBe(false);
    expect(getDisc(settled, 'queen').x).toBe(500);
    expect(getDisc(settled, 'queen').y).toBe(500);
    assertCleanSettlement(settled, diagnostics);
  });

  it('keeps a dense center cluster numerically valid', () => {
    const clustered = createDenseClusterState();
    const { diagnostics, state } = settleShot(startShot(clustered, { vx: 0, vy: -30 }));

    expect(diagnostics.maxSpeed).toBeGreaterThan(0);
    assertCleanSettlement(state, diagnostics);
  });

  it('produces deterministic final states for repeated identical shots', () => {
    const first = settleShot(startShot(createInitialCarromState(), { vx: 18, vy: -16 }));
    const second = settleShot(startShot(createInitialCarromState(), { vx: 18, vy: -16 }));

    expect(first.diagnostics.frames).toBe(second.diagnostics.frames);
    expect(normalizeState(first.state)).toEqual(normalizeState(second.state));
  });

  it('sanitizes invalid shot velocity before simulation', () => {
    const { diagnostics, state } = settleShot(
      startShot(createInitialCarromState(), {
        vx: Number.NaN,
        vy: Number.POSITIVE_INFINITY,
      }),
    );

    assertCleanSettlement(state, diagnostics);

    const second = settleShot(
      startShot(createInitialCarromState(), {
        vx: Number.NEGATIVE_INFINITY,
        vy: Number.NaN,
      }),
    );

    assertCleanSettlement(second.state, second.diagnostics);
  });

  it('sanitizes corrupted disc position and velocity during stepping', () => {
    const corrupted = startShot(
      withDisc(createInitialCarromState(), 'white-1', {
        vx: Number.POSITIVE_INFINITY,
        vy: Number.NaN,
        x: Number.NaN,
        y: Number.NEGATIVE_INFINITY,
      }),
      { vx: 12, vy: -16 },
    );
    const { diagnostics, state } = settleAfterOneSanitizingStep(corrupted);

    assertCleanSettlement(state, diagnostics);
  });

  it('separates exact-overlap discs deterministically', () => {
    const overlapped = withDisc(
      withDisc(createInitialCarromState(), 'white-1', { x: 500, y: 500 }),
      'black-1',
      { x: 500, y: 500 },
    );
    const first = settleShot(startShot(overlapped, { vx: 0, vy: -18 }));
    const second = settleShot(startShot(overlapped, { vx: 0, vy: -18 }));

    assertCleanSettlement(first.state, first.diagnostics);
    expect(first.diagnostics.frames).toBe(second.diagnostics.frames);
    expect(normalizeState(first.state)).toEqual(normalizeState(second.state));
  });

  it('falls back from invalid physical disc properties', () => {
    const corrupted = startShot(
      withDisc(createInitialCarromState(), 'white-2', {
        mass: 0,
        radius: -20,
        restitution: Number.NaN,
        rollingDrag: Number.NEGATIVE_INFINITY,
      }),
      { vx: 9, vy: -20 },
    );
    const { diagnostics, state } = settleShot(corrupted);
    const recovered = getDisc(state, 'white-2');

    expect(recovered.mass).toBeGreaterThan(0);
    expect(recovered.radius).toBeGreaterThan(0);
    expect(recovered.restitution).toBeGreaterThanOrEqual(0);
    expect(recovered.restitution).toBeLessThanOrEqual(1);
    expect(recovered.rollingDrag).toBeGreaterThan(0);
    assertCleanSettlement(state, diagnostics);
  });

  it('keeps touching resting discs still after a physics step', () => {
    const resting = createIsolatedTwoDiscState(
      { x: 500, y: 500 },
      { x: 540, y: 500 },
    );
    const stepped = stepCarrom(resting);

    expect(getDisc(stepped, 'white-1').x).toBe(500);
    expect(getDisc(stepped, 'white-1').y).toBe(500);
    expect(getDisc(stepped, 'black-1').x).toBe(540);
    expect(getDisc(stepped, 'black-1').y).toBe(500);
    expect(getDisc(stepped, 'white-1').vx).toBe(0);
    expect(getDisc(stepped, 'black-1').vx).toBe(0);
  });

  it('separates slow overlapping discs without adding speed', () => {
    const overlapping = createIsolatedTwoDiscState(
      { x: 500, y: 500 },
      { x: 536, y: 500 },
    );
    const beforeOverlap = getMaxOverlap(overlapping.discs);
    const stepped = stepCarrom(overlapping);
    const afterOverlap = getMaxOverlap(stepped.discs);

    expect(beforeOverlap).toBeGreaterThan(SETTLED_OVERLAP_TOLERANCE);
    expect(afterOverlap).toBeLessThan(beforeOverlap);
    expect(afterOverlap).toBeLessThanOrEqual(SETTLED_OVERLAP_TOLERANCE);
    expect(getDisc(stepped, 'white-1').vx).toBe(0);
    expect(getDisc(stepped, 'white-1').vy).toBe(0);
    expect(getDisc(stepped, 'black-1').vx).toBe(0);
    expect(getDisc(stepped, 'black-1').vy).toBe(0);
  });

  it('settles exact-overlap discs below overlap tolerance', () => {
    const overlapped = withDiscs(createInitialCarromState(), {
      'white-1': { x: 500, y: 500 },
      'black-1': { x: 500, y: 500 },
    });
    const { diagnostics, state } = settleShot(startShot(overlapped, { vx: 0, vy: -24 }));

    assertCleanSettlement(state, diagnostics);
  });

  it('keeps a rail plus disc collision inside bounds', () => {
    const railCollision = withDiscs(createInitialCarromState(), {
      striker: { x: CARROM_EDGE_LEFT + 28, y: 500 },
      'white-1': { x: CARROM_EDGE_LEFT + 70, y: 500 },
    });
    const { diagnostics, state } = settleShot(startShot(railCollision, { vx: -18, vy: 0 }));

    assertCleanSettlement(state, diagnostics);
  });

  it('keeps repeated dense cluster simulations deterministic', () => {
    const first = settleShot(startShot(createDenseClusterState(), { vx: 0, vy: -30 }));
    const second = settleShot(startShot(createDenseClusterState(), { vx: 0, vy: -30 }));

    assertCleanSettlement(first.state, first.diagnostics);
    expect(first.diagnostics.frames).toBe(second.diagnostics.frames);
    expect(normalizeState(first.state)).toEqual(normalizeState(second.state));
  });

  it('ends a settled medium shot with every visible disc asleep', () => {
    const { diagnostics, state } = settleShot(startShot(createInitialCarromState(), { vx: 14, vy: -17 }));

    assertCleanSettlement(state, diagnostics);
    state.discs.forEach((disc) => {
      if (!disc.pocketed) {
        expect(Math.hypot(disc.vx, disc.vy)).toBe(0);
        expect(disc.sleepFrames).toBeGreaterThan(0);
      }
    });
  });

  it('keeps all moving discs inside bounds unless they are pocket-adjacent', () => {
    const { diagnostics, state } = settleShot(
      startShot(createInitialCarromState(), { vx: 32, vy: -19 }),
    );

    expect(diagnostics.boundsViolation).toBe(false);
    assertCleanSettlement(state, diagnostics);
  });
});
