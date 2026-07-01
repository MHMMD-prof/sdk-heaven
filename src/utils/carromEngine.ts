import { CarromCoinKind, CarromDisc, CarromGameState, CarromPlayer } from '../types/carrom';

export const CARROM_WORLD_SIZE = 1000;
export const CARROM_EDGE_LEFT = 150;
export const CARROM_EDGE_RIGHT = 850;
export const CARROM_EDGE_TOP = 128;
export const CARROM_EDGE_BOTTOM = 770;
export const CARROM_POCKET_RADIUS = 30;
export const CARROM_STRIKER_RADIUS = 28;
export const CARROM_PIECE_RADIUS = 20;
export const CARROM_TOP_BASELINE_Y = 209;
export const CARROM_BOTTOM_BASELINE_Y = 678;
export const CARROM_STRIKER_MIN_X = 255;
export const CARROM_STRIKER_MAX_X = 745;
export const CARROM_POCKETS = [
  { x: 196, y: 162 },
  { x: 804, y: 162 },
  { x: 196, y: 755 },
  { x: 804, y: 755 },
];

const CARROM_SHOT_TUNING = {
  maxDiscSpeed: 46,
  maxShotSpeed: 42,
};
const CARROM_DISC_TUNING = {
  maxRadius: CARROM_STRIKER_RADIUS,
  pieceMass: 1,
  pieceRadius: CARROM_PIECE_RADIUS,
  pieceRestitution: 0.66,
  pieceRollingDrag: 0.018,
  strikerMass: 1.7,
  strikerRadius: CARROM_STRIKER_RADIUS,
  strikerRestitution: 0.64,
  strikerRollingDrag: 0.015,
};
const CARROM_DRAG_TUNING = {
  lowSpeedDrag: 0.017,
  lowSpeedThreshold: 5,
  speedDragLimit: 38,
  speedDragScale: 0.00014,
};
const CARROM_STOP_TUNING = {
  sleepFrames: 6,
  sleepSpeed: 0.9,
  stopSpeed: 0.68,
  tinyComponentSpeed: 0.06,
  tinySpeedCutoff: 0.12,
};
const CARROM_COLLISION_TUNING = {
  maxImpulse: 25,
  positionCorrection: 0.34,
  positionSlop: 1.1,
  restingContactSpeed: 0.62,
  separationPassesMultiplier: 1,
  tangentialDamping: 0.08,
  tangentialImpulseLimitRatio: 0.18,
};
const CARROM_WALL_TUNING = {
  restitution: 0.6,
};
const CARROM_POCKET_TUNING = {
  captureRadius: CARROM_POCKET_RADIUS,
  directedCaptureRadius: CARROM_POCKET_RADIUS + 26,
  fastCaptureRadius: CARROM_POCKET_RADIUS + 14,
  fastCaptureSpeed: 14,
  mouthRadius: CARROM_POCKET_RADIUS + 18,
};
const CARROM_SOLVER_TUNING = {
  collisionPasses: 2,
  substeps: 2,
};
const STOP_SPEED = CARROM_STOP_TUNING.stopSpeed;
const SLEEP_SPEED = CARROM_STOP_TUNING.sleepSpeed;
const SLEEP_FRAMES = CARROM_STOP_TUNING.sleepFrames;
const MAX_SHOT_SPEED = CARROM_SHOT_TUNING.maxShotSpeed;
const MAX_DISC_SPEED = CARROM_SHOT_TUNING.maxDiscSpeed;
const MAX_COLLISION_IMPULSE = CARROM_COLLISION_TUNING.maxImpulse;
const WALL_RESTITUTION = CARROM_WALL_TUNING.restitution;
const COLLISION_PASSES = CARROM_SOLVER_TUNING.collisionPasses;
const SEPARATION_PASSES =
  COLLISION_PASSES * CARROM_COLLISION_TUNING.separationPassesMultiplier;
const PHYSICS_SUBSTEPS = CARROM_SOLVER_TUNING.substeps;
const POSITION_CORRECTION = CARROM_COLLISION_TUNING.positionCorrection;
const POSITION_SLOP = CARROM_COLLISION_TUNING.positionSlop;
const RESTING_CONTACT_SPEED = CARROM_COLLISION_TUNING.restingContactSpeed;
const TANGENTIAL_DAMPING = CARROM_COLLISION_TUNING.tangentialDamping;
const MAX_TANGENTIAL_IMPULSE =
  MAX_COLLISION_IMPULSE * CARROM_COLLISION_TUNING.tangentialImpulseLimitRatio;
const TINY_COMPONENT_SPEED = CARROM_STOP_TUNING.tinyComponentSpeed;
const STRIKER_MASS = CARROM_DISC_TUNING.strikerMass;
const PIECE_MASS = CARROM_DISC_TUNING.pieceMass;
const STRIKER_RESTITUTION = CARROM_DISC_TUNING.strikerRestitution;
const PIECE_RESTITUTION = CARROM_DISC_TUNING.pieceRestitution;
const STRIKER_ROLLING_DRAG = CARROM_DISC_TUNING.strikerRollingDrag;
const PIECE_ROLLING_DRAG = CARROM_DISC_TUNING.pieceRollingDrag;
const PLAYER_COINS: Record<CarromPlayer, CarromCoinKind> = {
  1: 'white',
  2: 'black',
};
const CENTER = CARROM_WORLD_SIZE / 2;

export const createInitialCarromState = (): CarromGameState => ({
  currentPlayer: 1,
  discs: createInitialDiscs(1),
  pocketedThisTurn: [],
  playerCoins: PLAYER_COINS,
  queen: { pocketed: false },
  scores: { 1: 0, 2: 0 },
  status: 'placing',
  message: 'حرّك حجر الضربة على الخط',
});

export const getStrikerStart = (player: CarromPlayer) => ({
  x: CARROM_WORLD_SIZE / 2,
  y: player === 1 ? CARROM_BOTTOM_BASELINE_Y : CARROM_TOP_BASELINE_Y,
});

export const moveStrikerPlacement = (state: CarromGameState, x: number): CarromGameState => {
  if (state.status !== 'placing') {
    return state;
  }

  const baselineY =
    state.currentPlayer === 1 ? CARROM_BOTTOM_BASELINE_Y : CARROM_TOP_BASELINE_Y;

  return {
    ...state,
    discs: state.discs.map((disc) =>
      disc.kind === 'striker'
        ? {
            ...disc,
            x: clamp(sanitizeNumber(x, CENTER), CARROM_STRIKER_MIN_X, CARROM_STRIKER_MAX_X),
            y: baselineY,
            vx: 0,
            vy: 0,
            pocketed: false,
          }
        : disc,
    ),
  };
};

export const lockStrikerPlacement = (state: CarromGameState): CarromGameState =>
  state.status === 'placing'
    ? {
        ...state,
        status: 'aiming',
        message: 'اسحب للخلف ثم اترك للتصويب',
      }
    : state;

export const applyShot = (
  state: CarromGameState,
  velocity: { vx: number; vy: number },
): CarromGameState => ({
  ...state,
  pocketedThisTurn: [],
  status: 'moving',
  message: 'الحجر يتحرك',
  discs: state.discs.map((disc) =>
    disc.kind === 'striker'
      ? {
          ...disc,
          vx: clamp(sanitizeVelocityComponent(velocity.vx), -MAX_SHOT_SPEED, MAX_SHOT_SPEED),
          vy: clamp(sanitizeVelocityComponent(velocity.vy), -MAX_SHOT_SPEED, MAX_SHOT_SPEED),
          sleepFrames: 0,
        }
      : disc,
  ),
});

export const stepCarrom = (state: CarromGameState): CarromGameState => {
  const discs = sanitizeDiscs(state.discs).map((disc) => {
    if (disc.pocketed) {
      return disc;
    }

    const damped = applyRollingDrag(disc);
    const clamped = clampVelocity(damped.vx, damped.vy, MAX_DISC_SPEED);
    const clampedSpeed = Math.hypot(clamped.vx, clamped.vy);
    const nextSleepFrames =
      clampedSpeed < SLEEP_SPEED ? (disc.sleepFrames ?? 0) + 1 : 0;
    const sleeping = nextSleepFrames >= SLEEP_FRAMES;
    const vx = sleeping ? 0 : zeroTinyVelocity(clamped.vx);
    const vy = sleeping ? 0 : zeroTinyVelocity(clamped.vy);

    return {
      ...disc,
      vx,
      vy,
      sleepFrames: sleeping ? SLEEP_FRAMES : nextSleepFrames,
    };
  });

  const pocketedThisStep: CarromDisc[] = [];

  for (let substep = 0; substep < PHYSICS_SUBSTEPS; substep += 1) {
    const motionRecords = createSubstepMotionRecords(discs);

    discs.forEach((disc) => {
      if (disc.pocketed) {
        return;
      }

      disc.x += disc.vx / PHYSICS_SUBSTEPS;
      disc.y += disc.vy / PHYSICS_SUBSTEPS;
    });

    resolveWallCollisions(discs);
    pocketedThisStep.push(...resolvePockets(discs, motionRecords));
    resolveCollisionImpulses(discs);

    for (let pass = 0; pass < SEPARATION_PASSES; pass += 1) {
      separateOverlappingDiscs(discs);
    }

    clampDiscsInsideBoard(discs);
  }

  settleTinyVelocities(discs);
  const pocketedThisTurn = mergePocketedDiscs(state.pocketedThisTurn, pocketedThisStep);

  const hasActiveMotion = discs.some(
    (disc) => !disc.pocketed && Math.hypot(disc.vx, disc.vy) > STOP_SPEED,
  );

  if (!hasActiveMotion) {
    relaxSettledOverlaps(discs);
  }

  const moving = discs.some(
    (disc) => !disc.pocketed && Math.hypot(disc.vx, disc.vy) > STOP_SPEED,
  );

  if (moving) {
    return { ...state, discs, pocketedThisTurn };
  }

  return finalizeSettledCarromState(
    resolveTurnEnd({ ...state, discs, pocketedThisTurn }, pocketedThisTurn),
  );
};

const createInitialDiscs = (currentPlayer: CarromPlayer): CarromDisc[] => {
  const strikerStart = getStrikerStart(currentPlayer);
  const layout: CarromDisc[] = [
    createCoin('queen', 'queen', undefined, CENTER, CENTER),
    createCoin('white-1', 'white', 1, CENTER - 44, CENTER - 25),
    createCoin('black-1', 'black', 2, CENTER + 44, CENTER - 25),
    createCoin('white-2', 'white', 1, CENTER, CENTER + 50),
    createCoin('black-2', 'black', 2, CENTER, CENTER - 50),
    createCoin('white-3', 'white', 1, CENTER - 44, CENTER + 25),
    createCoin('black-3', 'black', 2, CENTER + 44, CENTER + 25),
    createCoin('white-4', 'white', 1, CENTER - 88, CENTER),
    createCoin('black-4', 'black', 2, CENTER + 88, CENTER),
    createCoin('white-5', 'white', 1, CENTER - 88, CENTER - 50),
    createCoin('black-5', 'black', 2, CENTER + 88, CENTER - 50),
    createCoin('white-6', 'white', 1, CENTER - 88, CENTER + 50),
    createCoin('black-6', 'black', 2, CENTER + 88, CENTER + 50),
    createCoin('white-7', 'white', 1, CENTER - 132, CENTER - 25),
    createCoin('black-7', 'black', 2, CENTER + 132, CENTER - 25),
    createCoin('white-8', 'white', 1, CENTER - 132, CENTER + 25),
    createCoin('black-8', 'black', 2, CENTER + 132, CENTER + 25),
    createCoin('white-9', 'white', 1, CENTER, CENTER + 100),
    createCoin('black-9', 'black', 2, CENTER, CENTER - 100),
  ];

  return [
    {
      id: 'striker',
      kind: 'striker',
      mass: STRIKER_MASS,
      restitution: STRIKER_RESTITUTION,
      rollingDrag: STRIKER_ROLLING_DRAG,
      x: strikerStart.x,
      y: strikerStart.y,
      vx: 0,
      vy: 0,
      radius: CARROM_STRIKER_RADIUS,
    },
    ...layout,
  ];
};

const createCoin = (
  id: string,
  kind: Exclude<CarromDisc['kind'], 'striker'>,
  owner: CarromPlayer | undefined,
  x: number,
  y: number,
): CarromDisc => ({
  id,
  kind,
  owner,
  mass: PIECE_MASS,
  restitution: PIECE_RESTITUTION,
  rollingDrag: PIECE_ROLLING_DRAG,
  x,
  y,
  vx: 0,
  vy: 0,
  radius: CARROM_PIECE_RADIUS,
});

const resetStriker = (discs: CarromDisc[], nextPlayer: CarromPlayer) => {
  const start = getStrikerStart(nextPlayer);

  return discs.map((disc) =>
    disc.kind === 'striker'
      ? {
          ...disc,
          pocketed: false,
          x: start.x,
          y: start.y,
          vx: 0,
          vy: 0,
          sleepFrames: SLEEP_FRAMES,
        }
      : {
          ...disc,
          vx: 0,
          vy: 0,
          sleepFrames: SLEEP_FRAMES,
        },
  );
};

const finalizeSettledCarromState = (state: CarromGameState): CarromGameState => {
  const discs = sanitizeDiscs(state.discs);

  relaxSettledOverlaps(discs);

  return {
    ...state,
    discs,
  };
};

const resolveTurnEnd = (
  state: CarromGameState,
  pocketedThisFrame: CarromDisc[],
): CarromGameState => {
  const currentPlayer = state.currentPlayer;
  const ownKind = state.playerCoins[currentPlayer];
  const opponent = currentPlayer === 1 ? 2 : 1;
  const strikerPocketed = pocketedThisFrame.some((disc) => disc.kind === 'striker');
  const ownPocketed = pocketedThisFrame.filter((disc) => disc.kind === ownKind);
  const opponentPocketed = pocketedThisFrame.filter(
    (disc) => disc.owner && disc.owner !== currentPlayer,
  );
  const queenPocketed = pocketedThisFrame.some((disc) => disc.kind === 'queen');
  let discs = state.discs;
  let queen = { ...state.queen };
  let message = 'انتهت الضربة';
  let keepTurn = ownPocketed.length > 0 && !strikerPocketed;
  const ownCoinsRemaining = countRemainingCoins(discs, ownKind);
  const canCoverQueen = (ownPocketed.length > 0 || ownCoinsRemaining === 0) && !strikerPocketed;

  if (queen.pendingBy === currentPlayer && canCoverQueen) {
    queen = {
      coveredBy: currentPlayer,
      pendingBy: undefined,
      pocketed: true,
    };
    message = 'تمت تغطية الملكة';
  }

  if (queenPocketed) {
    if (canCoverQueen) {
      queen = {
        coveredBy: currentPlayer,
        pendingBy: undefined,
        pocketed: true,
      };
      message =
        ownPocketed.length > 0
          ? 'دخلت الملكة وتمت تغطيتها'
          : 'دخلت الملكة بعد إنهاء القطع';
      keepTurn = true;
    } else {
      queen = {
        ...queen,
        pendingBy: currentPlayer,
        pocketed: true,
      };
      message = 'الملكة بانتظار التغطية';
      keepTurn = true;
    }
  }

  if (strikerPocketed) {
    const queenReturn = queenPocketed
      ? returnQueenToCenter(discs)
      : returnPendingQueenIfNeeded(discs, queen);
    const penalty = queenPocketed
      ? { discs: queenReturn.discs, returned: false }
      : returnPocketedOwnCoin(queenReturn.discs, currentPlayer);

    discs = penalty.discs;
    queen = queenReturn.queen;
    message = queenPocketed
      ? 'خطأ: دخلت الملكة مع حجر الضربة، عادت الملكة'
      : penalty.returned
      ? 'خطأ: دخل حجر الضربة وتمت إعادة قطعة'
      : 'خطأ: دخل حجر الضربة';
    keepTurn = false;
  } else if (queen.pendingBy === currentPlayer && ownPocketed.length === 0) {
    const returned = returnQueenToCenter(discs);

    discs = returned.discs;
    queen = { pocketed: false };
    message = 'لم تتم تغطية الملكة، عادت للوسط';
    keepTurn = false;
  } else if (ownPocketed.length > 0) {
    message = ownPocketed.length > 1 ? 'تسجيل ناجح، تستمر الجولة' : 'قطعة ناجحة، العب مجدداً';
  } else if (opponentPocketed.length > 0) {
    message = 'دخلت قطعة الخصم، ينتقل الدور';
    keepTurn = false;
  } else if (!queenPocketed) {
    message = 'لم تدخل أي قطعة';
    keepTurn = false;
  }

  const winner = getWinner(discs, queen, state.playerCoins);

  if (winner) {
    return {
      ...state,
      currentPlayer,
      discs,
      pocketedThisTurn: [],
      queen,
      scores: calculateScores(discs),
      status: 'gameOver',
      winner,
      message: `فاز اللاعب ${winner}`,
    };
  }

  const nextPlayer = keepTurn ? currentPlayer : opponent;

  return {
    ...state,
    currentPlayer: nextPlayer,
    discs: resetStriker(discs, nextPlayer),
    queen,
    pocketedThisTurn: [],
    scores: calculateScores(discs),
    status: 'placing',
    message,
  };
};

const mergePocketedDiscs = (existing: CarromDisc[], next: CarromDisc[]) => {
  const seen = new Set(existing.map((disc) => disc.id));
  const merged = [...existing];

  next.forEach((disc) => {
    if (!seen.has(disc.id)) {
      seen.add(disc.id);
      merged.push(disc);
    }
  });

  return merged;
};

const calculateScores = (discs: CarromDisc[]): Record<CarromPlayer, number> => ({
  1: discs.filter((disc) => disc.owner === 1 && disc.pocketed).length,
  2: discs.filter((disc) => disc.owner === 2 && disc.pocketed).length,
});

const getWinner = (
  discs: CarromDisc[],
  queen: CarromGameState['queen'],
  playerCoins: CarromGameState['playerCoins'],
) => {
  const queenReady = queen.coveredBy !== undefined;
  const playerOneCleared = discs.every(
    (disc) => disc.kind !== playerCoins[1] || disc.pocketed,
  );
  const playerTwoCleared = discs.every(
    (disc) => disc.kind !== playerCoins[2] || disc.pocketed,
  );

  if (playerOneCleared && queenReady) {
    return 1;
  }

  if (playerTwoCleared && queenReady) {
    return 2;
  }

  return undefined;
};

const returnPocketedOwnCoin = (discs: CarromDisc[], player: CarromPlayer) => {
  const discToReturn = [...discs]
    .reverse()
    .find((disc) => disc.owner === player && disc.pocketed);

  if (!discToReturn) {
    return { discs, returned: false };
  }

  return {
    discs: discs.map((disc) =>
      disc.id === discToReturn.id
        ? {
            ...disc,
            pocketed: false,
            x: CENTER + (player === 1 ? -54 : 54),
            y: CENTER,
            vx: 0,
            vy: 0,
            sleepFrames: SLEEP_FRAMES,
          }
        : disc,
    ),
    returned: true,
  };
};

const returnPendingQueenIfNeeded = (
  discs: CarromDisc[],
  queen: CarromGameState['queen'],
) => {
  if (!queen.pendingBy) {
    return { discs, queen };
  }

  return returnQueenToCenter(discs);
};

const returnQueenToCenter = (discs: CarromDisc[]) => ({
  discs: discs.map((disc) =>
    disc.kind === 'queen'
      ? {
          ...disc,
          pocketed: false,
          x: CENTER,
          y: CENTER,
          vx: 0,
          vy: 0,
          sleepFrames: SLEEP_FRAMES,
        }
      : disc,
  ),
  queen: { pocketed: false } as CarromGameState['queen'],
});

const resolveWallCollisions = (discs: CarromDisc[]) => {
  discs.forEach((disc) => {
    if (disc.pocketed) {
      return;
    }

    if (isNearPocket(disc)) {
      return;
    }

    if (disc.x - disc.radius < CARROM_EDGE_LEFT) {
      disc.x = CARROM_EDGE_LEFT + disc.radius;
      disc.vx = zeroTinyVelocity(Math.abs(disc.vx) * WALL_RESTITUTION);
      disc.sleepFrames = 0;
    }

    if (disc.x + disc.radius > CARROM_EDGE_RIGHT) {
      disc.x = CARROM_EDGE_RIGHT - disc.radius;
      disc.vx = zeroTinyVelocity(-Math.abs(disc.vx) * WALL_RESTITUTION);
      disc.sleepFrames = 0;
    }

    if (disc.y - disc.radius < CARROM_EDGE_TOP) {
      disc.y = CARROM_EDGE_TOP + disc.radius;
      disc.vy = zeroTinyVelocity(Math.abs(disc.vy) * WALL_RESTITUTION);
      disc.sleepFrames = 0;
    }

    if (disc.y + disc.radius > CARROM_EDGE_BOTTOM) {
      disc.y = CARROM_EDGE_BOTTOM - disc.radius;
      disc.vy = zeroTinyVelocity(-Math.abs(disc.vy) * WALL_RESTITUTION);
      disc.sleepFrames = 0;
    }

    clampDiscInsideBoard(disc);
  });
};

type CollisionContact = {
  a: CarromDisc;
  b: CarromDisc;
  exactOverlap: boolean;
  inverseMassA: number;
  inverseMassB: number;
  nx: number;
  ny: number;
  overlap: number;
  totalInverseMass: number;
};

type SubstepMotionRecord = {
  speed: number;
  x: number;
  y: number;
};

const resolveCollisionImpulses = (discs: CarromDisc[]) => {
  forEachCollisionContact(discs, (contact) => {
    if (contact.exactOverlap || contact.overlap <= 0) {
      return;
    }

    const { a, b, inverseMassA, inverseMassB, nx, ny, totalInverseMass } = contact;
    const relativeVx = b.vx - a.vx;
    const relativeVy = b.vy - a.vy;
    const velocityAlongNormal = relativeVx * nx + relativeVy * ny;

    if (velocityAlongNormal > -RESTING_CONTACT_SPEED) {
      return;
    }

    const restitution = Math.min(getDiscRestitution(a), getDiscRestitution(b));
    const impulseMagnitude = Math.min(
      (-(1 + restitution) * velocityAlongNormal) / totalInverseMass,
      MAX_COLLISION_IMPULSE,
    );
    const impulseX = impulseMagnitude * nx;
    const impulseY = impulseMagnitude * ny;
    const tx = -ny;
    const ty = nx;
    const velocityAlongTangent = relativeVx * tx + relativeVy * ty;
    const tangentImpulseMagnitude = clamp(
      (-velocityAlongTangent * TANGENTIAL_DAMPING) / totalInverseMass,
      -MAX_TANGENTIAL_IMPULSE,
      MAX_TANGENTIAL_IMPULSE,
    );
    const tangentImpulseX = tangentImpulseMagnitude * tx;
    const tangentImpulseY = tangentImpulseMagnitude * ty;

    a.vx = zeroTinyVelocity(a.vx - (impulseX + tangentImpulseX) * inverseMassA);
    a.vy = zeroTinyVelocity(a.vy - (impulseY + tangentImpulseY) * inverseMassA);
    b.vx = zeroTinyVelocity(b.vx + (impulseX + tangentImpulseX) * inverseMassB);
    b.vy = zeroTinyVelocity(b.vy + (impulseY + tangentImpulseY) * inverseMassB);

    const limitedA = clampVelocity(a.vx, a.vy, MAX_DISC_SPEED);
    const limitedB = clampVelocity(b.vx, b.vy, MAX_DISC_SPEED);

    a.vx = limitedA.vx;
    a.vy = limitedA.vy;
    b.vx = limitedB.vx;
    b.vy = limitedB.vy;
    a.sleepFrames = 0;
    b.sleepFrames = 0;
  });
};

const separateOverlappingDiscs = (discs: CarromDisc[]) => {
  forEachCollisionContact(discs, (contact) => {
    const { a, b, inverseMassA, inverseMassB, nx, ny, overlap, totalInverseMass } = contact;
    const correction = Math.max(overlap - POSITION_SLOP, 0) * POSITION_CORRECTION;

    if (correction <= 0) {
      return;
    }

    a.x -= (nx * correction * inverseMassA) / totalInverseMass;
    a.y -= (ny * correction * inverseMassA) / totalInverseMass;
    b.x += (nx * correction * inverseMassB) / totalInverseMass;
    b.y += (ny * correction * inverseMassB) / totalInverseMass;
    clampDiscInsideBoard(a);
    clampDiscInsideBoard(b);
  });
};

const forEachCollisionContact = (
  discs: CarromDisc[],
  visit: (contact: CollisionContact) => void,
) => {
  for (let i = 0; i < discs.length; i += 1) {
    for (let j = i + 1; j < discs.length; j += 1) {
      const a = discs[i];
      const b = discs[j];

      if (a.pocketed || b.pocketed) {
        continue;
      }

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const rawDistance = Math.hypot(dx, dy);
      const minDistance = a.radius + b.radius;
      const exactOverlap = rawDistance === 0;

      if (rawDistance >= minDistance) {
        continue;
      }

      const fallbackNormal = getFallbackCollisionNormal(a, b, i, j);
      const nx = exactOverlap ? fallbackNormal.nx : dx / rawDistance;
      const ny = exactOverlap ? fallbackNormal.ny : dy / rawDistance;
      const overlap = minDistance - rawDistance;
      const inverseMassA = 1 / getDiscMass(a);
      const inverseMassB = 1 / getDiscMass(b);
      const totalInverseMass = inverseMassA + inverseMassB;

      if (totalInverseMass === 0) {
        continue;
      }

      visit({
        a,
        b,
        exactOverlap,
        inverseMassA,
        inverseMassB,
        nx,
        ny,
        overlap,
        totalInverseMass,
      });
    }
  }
};

const relaxSettledOverlaps = (discs: CarromDisc[]) => {
  for (let pass = 0; pass < 12; pass += 1) {
    if (!hasResolvableOverlap(discs)) {
      return;
    }

    separateOverlappingDiscs(discs);
  }
};

const hasResolvableOverlap = (discs: CarromDisc[]) => {
  for (let i = 0; i < discs.length; i += 1) {
    for (let j = i + 1; j < discs.length; j += 1) {
      const a = discs[i];
      const b = discs[j];

      if (a.pocketed || b.pocketed) {
        continue;
      }

      if (a.radius + b.radius - Math.hypot(b.x - a.x, b.y - a.y) > POSITION_SLOP) {
        return true;
      }
    }
  }

  return false;
};

const countRemainingCoins = (discs: CarromDisc[], kind: CarromCoinKind) =>
  discs.filter((disc) => disc.kind === kind && !disc.pocketed).length;

const createSubstepMotionRecords = (discs: CarromDisc[]) =>
  discs.map((disc) => ({
    speed: Math.hypot(disc.vx, disc.vy),
    x: disc.x,
    y: disc.y,
  }));

const resolvePockets = (
  discs: CarromDisc[],
  motionRecords: SubstepMotionRecord[],
) => {
  const pocketed: CarromDisc[] = [];

  discs.forEach((disc, index) => {
    if (disc.pocketed) {
      return;
    }

    const motion = motionRecords[index];
    const captured = CARROM_POCKETS.some((pocket) => isCapturedByPocket(disc, pocket, motion));

    if (captured) {
      disc.pocketed = true;
      disc.vx = 0;
      disc.vy = 0;
      disc.sleepFrames = SLEEP_FRAMES;
      pocketed.push(disc);
    }
  });

  return pocketed;
};

const isNearPocket = (disc: CarromDisc) =>
  CARROM_POCKETS.some(
    (pocket) =>
      Math.hypot(disc.x - pocket.x, disc.y - pocket.y) <
      CARROM_POCKET_TUNING.mouthRadius + disc.radius,
  );

const isCapturedByPocket = (
  disc: CarromDisc,
  pocket: { x: number; y: number },
  motion: SubstepMotionRecord | undefined,
) => {
  const distance = Math.hypot(disc.x - pocket.x, disc.y - pocket.y);

  if (distance < CARROM_POCKET_TUNING.captureRadius) {
    return true;
  }

  const movingTowardPocket =
    (pocket.x - disc.x) * disc.vx + (pocket.y - disc.y) * disc.vy > 0;

  if (
    movingTowardPocket &&
    distance < CARROM_POCKET_TUNING.directedCaptureRadius
  ) {
    return true;
  }

  if (!motion || motion.speed < CARROM_POCKET_TUNING.fastCaptureSpeed) {
    return false;
  }

  return (
    getDistanceFromPointToSegment(
      pocket.x,
      pocket.y,
      motion.x,
      motion.y,
      disc.x,
      disc.y,
    ) < CARROM_POCKET_TUNING.fastCaptureRadius
  );
};

const settleTinyVelocities = (discs: CarromDisc[]) => {
  discs.forEach((disc) => {
    if (disc.pocketed) {
      return;
    }

    if (Math.hypot(disc.vx, disc.vy) < SLEEP_SPEED && (disc.sleepFrames ?? 0) >= SLEEP_FRAMES) {
      disc.vx = 0;
      disc.vy = 0;
      disc.sleepFrames = SLEEP_FRAMES;
    }
  });
};

const applyRollingDrag = (disc: CarromDisc) => {
  if (!isFiniteVector(disc.vx, disc.vy)) {
    return { vx: 0, vy: 0 };
  }

  const speed = Math.hypot(disc.vx, disc.vy);

  if (!Number.isFinite(speed) || speed === 0) {
    return { vx: 0, vy: 0 };
  }

  const cappedSpeed = Math.min(speed, CARROM_DRAG_TUNING.speedDragLimit);
  const lowSpeedRange = CARROM_DRAG_TUNING.lowSpeedThreshold;
  const drag = getDiscRollingDrag(disc) + cappedSpeed * CARROM_DRAG_TUNING.speedDragScale;
  const lowSpeedDrag =
    smoothStep(0, lowSpeedRange, lowSpeedRange - Math.min(speed, lowSpeedRange)) *
    CARROM_DRAG_TUNING.lowSpeedDrag;
  const nextSpeed = Math.max(0, speed * (1 - drag - lowSpeedDrag));
  const finalSpeed = nextSpeed < CARROM_STOP_TUNING.tinySpeedCutoff ? 0 : nextSpeed;
  const scale = finalSpeed / speed;

  return {
    vx: disc.vx * scale,
    vy: disc.vy * scale,
  };
};

const sanitizeDiscs = (discs: CarromDisc[]) => discs.map(sanitizeDisc);

const sanitizeDisc = (disc: CarromDisc): CarromDisc => {
  const radius = getDiscRadius(disc);
  const pocketed = Boolean(disc.pocketed);
  const x = sanitizeNumber(disc.x, CENTER);
  const y = sanitizeNumber(disc.y, CENTER);
  const vx = pocketed ? 0 : sanitizeVelocityComponent(disc.vx);
  const vy = pocketed ? 0 : sanitizeVelocityComponent(disc.vy);
  const sleepFrames = sanitizeSleepFrames(disc.sleepFrames);

  return {
    ...disc,
    mass: getDiscMass(disc),
    radius,
    restitution: getDiscRestitution(disc),
    rollingDrag: getDiscRollingDrag(disc),
    sleepFrames,
    vx,
    vy,
    x,
    y,
  };
};

const sanitizeNumber = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback;

const sanitizeVelocityComponent = (value: number) => sanitizeNumber(value, 0);

const isFiniteVector = (x: number, y: number) => Number.isFinite(x) && Number.isFinite(y);

const sanitizeSleepFrames = (value: number | undefined) => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(SLEEP_FRAMES, Math.floor(value ?? 0)));
};

const getDiscRadius = (disc: CarromDisc) => {
  const fallback =
    disc.kind === 'striker'
      ? CARROM_DISC_TUNING.strikerRadius
      : CARROM_DISC_TUNING.pieceRadius;

  return clamp(sanitizePositiveNumber(disc.radius, fallback), 1, CARROM_DISC_TUNING.maxRadius);
};

const getDiscMass = (disc: CarromDisc) =>
  sanitizePositiveNumber(disc.mass, disc.kind === 'striker' ? STRIKER_MASS : PIECE_MASS);

const getDiscRestitution = (disc: CarromDisc) =>
  clamp(
    sanitizePositiveNumber(
      disc.restitution,
      disc.kind === 'striker' ? STRIKER_RESTITUTION : PIECE_RESTITUTION,
    ),
    0,
    1,
  );

const getDiscRollingDrag = (disc: CarromDisc) =>
  clamp(
    sanitizePositiveNumber(
      disc.rollingDrag,
      disc.kind === 'striker' ? STRIKER_ROLLING_DRAG : PIECE_ROLLING_DRAG,
    ),
    0,
    0.2,
  );

const sanitizePositiveNumber = (value: number, fallback: number) => {
  const sanitized = sanitizeNumber(value, fallback);

  return sanitized > 0 ? sanitized : fallback;
};

const clampVelocity = (vx: number, vy: number, maxSpeed: number) => {
  const sanitizedVx = sanitizeVelocityComponent(vx);
  const sanitizedVy = sanitizeVelocityComponent(vy);
  const sanitizedMaxSpeed = Math.max(0, sanitizeNumber(maxSpeed, 0));
  const speed = Math.hypot(sanitizedVx, sanitizedVy);

  if (speed <= sanitizedMaxSpeed || speed === 0) {
    return { vx: sanitizedVx, vy: sanitizedVy };
  }

  const scale = sanitizedMaxSpeed / speed;

  return {
    vx: sanitizedVx * scale,
    vy: sanitizedVy * scale,
  };
};

const smoothStep = (edge0: number, edge1: number, value: number) => {
  const start = sanitizeNumber(edge0, 0);
  const end = sanitizeNumber(edge1, start + 1);
  const current = sanitizeNumber(value, start);
  const range = end - start;
  const t = range === 0 ? 0 : clamp((current - start) / range, 0, 1);

  return t * t * (3 - 2 * t);
};

const getDistanceFromPointToSegment = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) => {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;

  if (lengthSquared === 0) {
    return Math.hypot(px - ax, py - ay);
  }

  const t = clamp(((px - ax) * abx + (py - ay) * aby) / lengthSquared, 0, 1);
  const closestX = ax + abx * t;
  const closestY = ay + aby * t;

  return Math.hypot(px - closestX, py - closestY);
};

const zeroTinyVelocity = (value: number) =>
  Math.abs(sanitizeVelocityComponent(value)) < TINY_COMPONENT_SPEED
    ? 0
    : sanitizeVelocityComponent(value);

const clamp = (value: number, min: number, max: number) => {
  const sanitizedMin = sanitizeNumber(min, 0);
  const sanitizedMax = sanitizeNumber(max, sanitizedMin);
  const lower = Math.min(sanitizedMin, sanitizedMax);
  const upper = Math.max(sanitizedMin, sanitizedMax);

  return Math.min(upper, Math.max(lower, sanitizeNumber(value, lower)));
};

const getFallbackCollisionNormal = (
  a: CarromDisc,
  b: CarromDisc,
  indexA: number,
  indexB: number,
) => {
  const seed = hashDiscId(a.id) - hashDiscId(b.id) || indexA - indexB || 1;
  const angle = seed * 2.399963229728653;

  return {
    nx: Math.cos(angle),
    ny: Math.sin(angle),
  };
};

const hashDiscId = (id: string) => {
  let hash = 0;

  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }

  return hash;
};

const clampDiscInsideBoard = (disc: CarromDisc) => {
  if (disc.pocketed || isNearPocket(disc)) {
    return;
  }

  disc.x = clamp(disc.x, CARROM_EDGE_LEFT + disc.radius, CARROM_EDGE_RIGHT - disc.radius);
  disc.y = clamp(disc.y, CARROM_EDGE_TOP + disc.radius, CARROM_EDGE_BOTTOM - disc.radius);
};

const clampDiscsInsideBoard = (discs: CarromDisc[]) => {
  discs.forEach(clampDiscInsideBoard);
};
