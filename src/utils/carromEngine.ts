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
  pullMaxAcceleration: 0.55,
  pullRadius: CARROM_POCKET_RADIUS + 52,
  pullStrength: 0.72,
};
const CARROM_POCKET_CAPTURE_RADIUS_SQ =
  CARROM_POCKET_TUNING.captureRadius * CARROM_POCKET_TUNING.captureRadius;
const CARROM_POCKET_DIRECTED_CAPTURE_RADIUS_SQ =
  CARROM_POCKET_TUNING.directedCaptureRadius * CARROM_POCKET_TUNING.directedCaptureRadius;
const CARROM_POCKET_FAST_CAPTURE_RADIUS_SQ =
  CARROM_POCKET_TUNING.fastCaptureRadius * CARROM_POCKET_TUNING.fastCaptureRadius;
const CARROM_POCKET_PULL_RADIUS_SQ =
  CARROM_POCKET_TUNING.pullRadius * CARROM_POCKET_TUNING.pullRadius;
const CARROM_SOLVER_TUNING = {
  collisionPasses: 2,
  substeps: 2,
};
const STOP_SPEED = CARROM_STOP_TUNING.stopSpeed;
const SLEEP_SPEED = CARROM_STOP_TUNING.sleepSpeed;
const STOP_SPEED_SQ = STOP_SPEED * STOP_SPEED;
const SLEEP_SPEED_SQ = SLEEP_SPEED * SLEEP_SPEED;
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
const COLLISION_CANDIDATE_PADDING =
  MAX_DISC_SPEED / PHYSICS_SUBSTEPS + CARROM_DISC_TUNING.maxRadius * POSITION_CORRECTION;
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
  const discs = sanitizeAndPrepareDiscs(state.discs);

  const pocketedThisStep: CarromDisc[] = [];
  const previousMotionRecords = createEmptySubstepMotionRecords(discs.length);
  const collisionCandidates = createCollisionCandidateScratch();

  for (let substep = 0; substep < PHYSICS_SUBSTEPS; substep += 1) {
    for (let index = 0; index < discs.length; index += 1) {
      const disc = discs[index]!;

      if (disc.pocketed) {
        continue;
      }

      previousMotionRecords[index].x = disc.x;
      previousMotionRecords[index].y = disc.y;
      previousMotionRecords[index].speedSq = getSpeedSquared(disc.vx, disc.vy);
      disc.x += disc.vx / PHYSICS_SUBSTEPS;
      disc.y += disc.vy / PHYSICS_SUBSTEPS;
    }

    resolveWallCollisions(discs);
    pocketedThisStep.push(...resolvePockets(discs, previousMotionRecords));
    const collisionCandidateCount = collectCollisionCandidatePairs(discs, collisionCandidates);

    if (collisionCandidateCount > 0) {
      resolveCollisionImpulses(discs, collisionCandidates, collisionCandidateCount);

      for (let pass = 0; pass < SEPARATION_PASSES; pass += 1) {
        separateOverlappingDiscs(discs, collisionCandidates, collisionCandidateCount);
      }
    }

    clampDiscsInsideBoard(discs);
  }

  settleTinyVelocities(discs);
  const pocketedThisTurn = mergePocketedDiscs(state.pocketedThisTurn, pocketedThisStep);

  if (hasMovingDiscs(discs)) {
    return { ...state, discs, pocketedThisTurn };
  }

  relaxSettledOverlaps(discs);

  if (hasMovingDiscs(discs)) {
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

const getPocketedTurnSummary = (
  pocketedThisFrame: CarromDisc[],
  ownKind: CarromCoinKind,
  currentPlayer: CarromPlayer,
) => {
  let opponentCount = 0;
  let ownCount = 0;
  let queenPocketed = false;
  let strikerPocketed = false;

  for (let index = 0; index < pocketedThisFrame.length; index += 1) {
    const disc = pocketedThisFrame[index];

    if (disc.kind === 'striker') {
      strikerPocketed = true;
    }

    if (disc.kind === 'queen') {
      queenPocketed = true;
    }

    if (disc.kind === ownKind) {
      ownCount += 1;
    } else if (disc.owner && disc.owner !== currentPlayer) {
      opponentCount += 1;
    }
  }

  return {
    opponentCount,
    ownCount,
    queenPocketed,
    strikerPocketed,
  };
};

const resolveTurnEnd = (
  state: CarromGameState,
  pocketedThisFrame: CarromDisc[],
): CarromGameState => {
  const currentPlayer = state.currentPlayer;
  const ownKind = state.playerCoins[currentPlayer];
  const opponent = currentPlayer === 1 ? 2 : 1;
  const pocketedSummary = getPocketedTurnSummary(
    pocketedThisFrame,
    ownKind,
    currentPlayer,
  );
  let discs = state.discs;
  let queen = { ...state.queen };
  let message = 'انتهت الضربة';
  let keepTurn = pocketedSummary.ownCount > 0 && !pocketedSummary.strikerPocketed;
  const ownCoinsRemaining = countRemainingCoins(discs, ownKind);
  const canCoverQueen =
    (pocketedSummary.ownCount > 0 || ownCoinsRemaining === 0) &&
    !pocketedSummary.strikerPocketed;

  if (queen.pendingBy === currentPlayer && canCoverQueen) {
    queen = {
      coveredBy: currentPlayer,
      pendingBy: undefined,
      pocketed: true,
    };
    message = 'تمت تغطية الملكة';
  }

  if (pocketedSummary.queenPocketed) {
    if (canCoverQueen) {
      queen = {
        coveredBy: currentPlayer,
        pendingBy: undefined,
        pocketed: true,
      };
      message =
        pocketedSummary.ownCount > 0
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

  if (pocketedSummary.strikerPocketed) {
    const queenReturn = pocketedSummary.queenPocketed
      ? returnQueenToCenter(discs)
      : returnPendingQueenIfNeeded(discs, queen);
    const penalty = pocketedSummary.queenPocketed
      ? { discs: queenReturn.discs, returned: false }
      : returnPocketedOwnCoin(queenReturn.discs, currentPlayer);

    discs = penalty.discs;
    queen = queenReturn.queen;
    message = pocketedSummary.queenPocketed
      ? 'خطأ: دخلت الملكة مع حجر الضربة، عادت الملكة'
      : penalty.returned
      ? 'خطأ: دخل حجر الضربة وتمت إعادة قطعة'
      : 'خطأ: دخل حجر الضربة';
    keepTurn = false;
  } else if (queen.pendingBy === currentPlayer && pocketedSummary.ownCount === 0) {
    const returned = returnQueenToCenter(discs);

    discs = returned.discs;
    queen = { pocketed: false };
    message = 'لم تتم تغطية الملكة، عادت للوسط';
    keepTurn = false;
  } else if (pocketedSummary.ownCount > 0) {
    message =
      pocketedSummary.ownCount > 1
        ? 'تسجيل ناجح، تستمر الجولة'
        : 'تسجيل ناجح، العب مجدداً';
  } else if (pocketedSummary.opponentCount > 0) {
    message = 'دخلت قطعة الخصم، ينتقل الدور';
    keepTurn = false;
  } else if (!pocketedSummary.queenPocketed) {
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
  if (next.length === 0) {
    return existing;
  }

  let merged = existing;

  for (let index = 0; index < next.length; index += 1) {
    const disc = next[index];
    let alreadySeen = false;

    for (let existingIndex = 0; existingIndex < merged.length; existingIndex += 1) {
      if (merged[existingIndex].id === disc.id) {
        alreadySeen = true;
        break;
      }
    }

    if (!alreadySeen) {
      if (merged === existing) {
        merged = [...existing];
      }
      merged.push(disc);
    }
  }

  return merged;
};

const calculateScores = (discs: CarromDisc[]): Record<CarromPlayer, number> => {
  const scores: Record<CarromPlayer, number> = { 1: 0, 2: 0 };

  for (let index = 0; index < discs.length; index += 1) {
    const disc = discs[index];

    if (disc.pocketed && disc.owner) {
      scores[disc.owner] += 1;
    }
  }

  return scores;
};

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
  let discToReturn: CarromDisc | undefined;

  for (let index = discs.length - 1; index >= 0; index -= 1) {
    const disc = discs[index];

    if (disc.owner === player && disc.pocketed) {
      discToReturn = disc;
      break;
    }
  }

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
  for (let index = 0; index < discs.length; index += 1) {
    const disc = discs[index]!;

    if (disc.pocketed) {
      continue;
    }

    if (isNearPocket(disc)) {
      continue;
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
  }
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

type CollisionCandidateScratch = {
  aIndices: number[];
  bIndices: number[];
};

type SubstepMotionRecord = {
  speedSq: number;
  x: number;
  y: number;
};

const resolveCollisionImpulses = (
  discs: CarromDisc[],
  candidatePairs?: CollisionCandidateScratch,
  candidateCount = 0,
) => {
  forEachCollisionContact(discs, candidatePairs, candidateCount, (contact) => {
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

const separateOverlappingDiscs = (
  discs: CarromDisc[],
  candidatePairs?: CollisionCandidateScratch,
  candidateCount = 0,
) => {
  forEachCollisionContact(discs, candidatePairs, candidateCount, (contact) => {
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
  candidatePairs: CollisionCandidateScratch | undefined,
  candidateCount: number,
  visit: (contact: CollisionContact) => void,
) => {
  if (candidatePairs) {
    for (let index = 0; index < candidateCount; index += 1) {
      const contact = createCollisionContact(
        discs,
        candidatePairs.aIndices[index]!,
        candidatePairs.bIndices[index]!,
      );

      if (contact) {
        visit(contact);
      }
    }

    return;
  }

  for (let i = 0; i < discs.length; i += 1) {
    for (let j = i + 1; j < discs.length; j += 1) {
      const contact = createCollisionContact(discs, i, j);

      if (contact) {
        visit(contact);
      }
    }
  }
};

const createCollisionCandidateScratch = (): CollisionCandidateScratch => ({
  aIndices: [],
  bIndices: [],
});

const collectCollisionCandidatePairs = (
  discs: CarromDisc[],
  scratch: CollisionCandidateScratch,
) => {
  let count = 0;

  for (let i = 0; i < discs.length; i += 1) {
    const a = discs[i];

    if (a.pocketed) {
      continue;
    }

    for (let j = i + 1; j < discs.length; j += 1) {
      const b = discs[j];

      if (b.pocketed) {
        continue;
      }

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const candidateDistance = a.radius + b.radius + COLLISION_CANDIDATE_PADDING;

      if (dx * dx + dy * dy <= candidateDistance * candidateDistance) {
        scratch.aIndices[count] = i;
        scratch.bIndices[count] = j;
        count += 1;
      }
    }
  }

  scratch.aIndices.length = count;
  scratch.bIndices.length = count;

  return count;
};

const createCollisionContact = (
  discs: CarromDisc[],
  aIndex: number,
  bIndex: number,
): CollisionContact | undefined => {
  const a = discs[aIndex];
  const b = discs[bIndex];

  if (a.pocketed || b.pocketed) {
    return undefined;
  }

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const minDistance = a.radius + b.radius;
  const rawDistanceSq = dx * dx + dy * dy;
  const exactOverlap = rawDistanceSq === 0;

  if (rawDistanceSq >= minDistance * minDistance) {
    return undefined;
  }

  const rawDistance = exactOverlap ? 0 : Math.sqrt(rawDistanceSq);
  const fallbackNormal = getFallbackCollisionNormal(a, b, aIndex, bIndex);
  const nx = exactOverlap ? fallbackNormal.nx : dx / rawDistance;
  const ny = exactOverlap ? fallbackNormal.ny : dy / rawDistance;
  const overlap = minDistance - rawDistance;
  const inverseMassA = 1 / getDiscMass(a);
  const inverseMassB = 1 / getDiscMass(b);
  const totalInverseMass = inverseMassA + inverseMassB;

  if (totalInverseMass === 0) {
    return undefined;
  }

  return {
    a,
    b,
    exactOverlap,
    inverseMassA,
    inverseMassB,
    nx,
    ny,
    overlap,
    totalInverseMass,
  };
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

      const minDistance = a.radius + b.radius - POSITION_SLOP;
      const dx = b.x - a.x;
      const dy = b.y - a.y;

      if (dx * dx + dy * dy < minDistance * minDistance) {
        return true;
      }
    }
  }

  return false;
};

const hasMovingDiscs = (discs: CarromDisc[]) => {
  for (let index = 0; index < discs.length; index += 1) {
    const disc = discs[index];

    if (!disc.pocketed && getSpeedSquared(disc.vx, disc.vy) > STOP_SPEED_SQ) {
      return true;
    }
  }

  return false;
};

const countRemainingCoins = (discs: CarromDisc[], kind: CarromCoinKind) => {
  let count = 0;

  for (let index = 0; index < discs.length; index += 1) {
    const disc = discs[index];

    if (disc.kind === kind && !disc.pocketed) {
      count += 1;
    }
  }

  return count;
};

const createEmptySubstepMotionRecords = (count: number) =>
  Array.from({ length: count }, () => ({
    speedSq: 0,
    x: 0,
    y: 0,
  }));

const resolvePockets = (
  discs: CarromDisc[],
  motionRecords: SubstepMotionRecord[],
) => {
  const pocketed: CarromDisc[] = [];

  for (let index = 0; index < discs.length; index += 1) {
    const disc = discs[index]!;

    if (disc.pocketed) {
      continue;
    }

    const motion = motionRecords[index];
    let captured = false;

    for (let pocketIndex = 0; pocketIndex < CARROM_POCKETS.length; pocketIndex += 1) {
      if (isCapturedByPocket(disc, CARROM_POCKETS[pocketIndex]!, motion)) {
        captured = true;
        break;
      }
    }

    if (captured) {
      disc.pocketed = true;
      disc.vx = 0;
      disc.vy = 0;
      disc.sleepFrames = SLEEP_FRAMES;
      pocketed.push(disc);
    }
  }

  return pocketed;
};

const isNearPocket = (disc: CarromDisc) => {
  const mouthDistance = CARROM_POCKET_TUNING.mouthRadius + disc.radius;
  const mouthDistanceSq = mouthDistance * mouthDistance;

  for (let index = 0; index < CARROM_POCKETS.length; index += 1) {
    const pocket = CARROM_POCKETS[index]!;

    if (getDistanceSquared(disc.x, disc.y, pocket.x, pocket.y) < mouthDistanceSq) {
      return true;
    }
  }

  return false;
};

const isCapturedByPocket = (
  disc: CarromDisc,
  pocket: { x: number; y: number },
  motion: SubstepMotionRecord | undefined,
) => {
  const dx = pocket.x - disc.x;
  const dy = pocket.y - disc.y;
  const distanceSq = dx * dx + dy * dy;

  if (distanceSq < CARROM_POCKET_CAPTURE_RADIUS_SQ) {
    return true;
  }

  const movingTowardPocket = dx * disc.vx + dy * disc.vy > 0;

  if (
    movingTowardPocket &&
    distanceSq < CARROM_POCKET_DIRECTED_CAPTURE_RADIUS_SQ
  ) {
    return true;
  }

  if (
    !motion ||
    motion.speedSq <
      CARROM_POCKET_TUNING.fastCaptureSpeed * CARROM_POCKET_TUNING.fastCaptureSpeed
  ) {
    return false;
  }

  return (
    getDistanceSquaredFromPointToSegment(
      pocket.x,
      pocket.y,
      motion.x,
      motion.y,
      disc.x,
      disc.y,
    ) < CARROM_POCKET_FAST_CAPTURE_RADIUS_SQ
  );
};

const settleTinyVelocities = (discs: CarromDisc[]) => {
  for (let index = 0; index < discs.length; index += 1) {
    const disc = discs[index]!;

    if (disc.pocketed) {
      continue;
    }

    if (getSpeedSquared(disc.vx, disc.vy) < SLEEP_SPEED_SQ && (disc.sleepFrames ?? 0) >= SLEEP_FRAMES) {
      disc.vx = 0;
      disc.vy = 0;
      disc.sleepFrames = SLEEP_FRAMES;
    }
  }
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

const applyPocketPull = (
  disc: CarromDisc,
  velocity: { vx: number; vy: number },
) => {
  if (disc.kind === 'striker' || !isFiniteVector(velocity.vx, velocity.vy)) {
    return velocity;
  }

  const speed = Math.hypot(velocity.vx, velocity.vy);

  if (!Number.isFinite(speed) || speed <= 0) {
    return velocity;
  }

  let pullX = 0;
  let pullY = 0;
  let strongestPull = 0;

  for (let index = 0; index < CARROM_POCKETS.length; index += 1) {
    const pocket = CARROM_POCKETS[index]!;
    const dx = pocket.x - disc.x;
    const dy = pocket.y - disc.y;
    const distanceSq = dx * dx + dy * dy;

    if (
      !Number.isFinite(distanceSq) ||
      distanceSq <= 0 ||
      distanceSq >= CARROM_POCKET_PULL_RADIUS_SQ
    ) {
      continue;
    }

    const distance = Math.sqrt(distanceSq);
    const nx = dx / distance;
    const ny = dy / distance;
    const radialSpeed = velocity.vx * nx + velocity.vy * ny;

    if (radialSpeed <= 0) {
      continue;
    }

    const pullWindow =
      CARROM_POCKET_TUNING.pullRadius - CARROM_POCKET_TUNING.directedCaptureRadius;
    const closeness = clamp(
      (CARROM_POCKET_TUNING.pullRadius - distance) / pullWindow,
      0,
      1,
    );
    const alignment = clamp(radialSpeed / speed, 0, 1);
    const pull = Math.min(
      CARROM_POCKET_TUNING.pullMaxAcceleration,
      CARROM_POCKET_TUNING.pullStrength * closeness * closeness * alignment,
    );

    if (pull > strongestPull) {
      strongestPull = pull;
      pullX = nx * pull;
      pullY = ny * pull;
    }
  }

  return {
    vx: velocity.vx + pullX,
    vy: velocity.vy + pullY,
  };
};

const sanitizeDiscs = (discs: CarromDisc[]) => discs.map(sanitizeDisc);

const sanitizeAndPrepareDiscs = (discs: CarromDisc[]) =>
  discs.map((disc) => prepareDiscForStep(sanitizeDisc(disc)));

const prepareDiscForStep = (disc: CarromDisc): CarromDisc => {
  if (disc.pocketed) {
    return disc;
  }

  const damped = applyRollingDrag(disc);
  const pulled = applyPocketPull(disc, damped);
  const clamped = clampVelocity(pulled.vx, pulled.vy, MAX_DISC_SPEED);
  const clampedSpeedSq = getSpeedSquared(clamped.vx, clamped.vy);
  const nextSleepFrames =
    clampedSpeedSq < SLEEP_SPEED_SQ ? (disc.sleepFrames ?? 0) + 1 : 0;
  const sleeping = nextSleepFrames >= SLEEP_FRAMES;
  const vx = sleeping ? 0 : zeroTinyVelocity(clamped.vx);
  const vy = sleeping ? 0 : zeroTinyVelocity(clamped.vy);

  disc.vx = vx;
  disc.vy = vy;
  disc.sleepFrames = sleeping ? SLEEP_FRAMES : nextSleepFrames;

  return disc;
};

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
  const speedSq = getSpeedSquared(sanitizedVx, sanitizedVy);
  const maxSpeedSq = sanitizedMaxSpeed * sanitizedMaxSpeed;

  if (speedSq <= maxSpeedSq || speedSq === 0) {
    return { vx: sanitizedVx, vy: sanitizedVy };
  }

  const speed = Math.sqrt(speedSq);
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

const getDistanceSquared = (ax: number, ay: number, bx: number, by: number) => {
  const dx = ax - bx;
  const dy = ay - by;

  return dx * dx + dy * dy;
};

const getSpeedSquared = (vx: number, vy: number) => vx * vx + vy * vy;

const getDistanceSquaredFromPointToSegment = (
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
    return getDistanceSquared(px, py, ax, ay);
  }

  const t = clamp(((px - ax) * abx + (py - ay) * aby) / lengthSquared, 0, 1);
  const closestX = ax + abx * t;
  const closestY = ay + aby * t;

  return getDistanceSquared(px, py, closestX, closestY);
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
  for (let index = 0; index < discs.length; index += 1) {
    clampDiscInsideBoard(discs[index]!);
  }
};
