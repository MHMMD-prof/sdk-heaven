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

const STOP_SPEED = 0.75;
const SLEEP_SPEED = 1.1;
const SLEEP_FRAMES = 5;
const MAX_SHOT_SPEED = 42;
const MAX_DISC_SPEED = 46;
const MAX_COLLISION_IMPULSE = 24;
const WALL_RESTITUTION = 0.58;
const COLLISION_PASSES = 2;
const PHYSICS_SUBSTEPS = 2;
const POSITION_CORRECTION = 0.26;
const POSITION_SLOP = 1.4;
const RESTING_CONTACT_SPEED = 0.8;
const TINY_COMPONENT_SPEED = 0.08;
const STRIKER_MASS = 1.8;
const PIECE_MASS = 1;
const STRIKER_RESTITUTION = 0.62;
const PIECE_RESTITUTION = 0.62;
const STRIKER_ROLLING_DRAG = 0.017;
const PIECE_ROLLING_DRAG = 0.02;
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
            x: clamp(x, CARROM_STRIKER_MIN_X, CARROM_STRIKER_MAX_X),
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
          vx: clamp(velocity.vx, -MAX_SHOT_SPEED, MAX_SHOT_SPEED),
          vy: clamp(velocity.vy, -MAX_SHOT_SPEED, MAX_SHOT_SPEED),
          sleepFrames: 0,
        }
      : disc,
  ),
});

export const stepCarrom = (state: CarromGameState): CarromGameState => {
  const discs = state.discs.map((disc) => {
    if (disc.pocketed) {
      return disc;
    }

    const damped = applyRollingDrag(disc);
    const clamped = clampVelocity(damped.vx, damped.vy, MAX_DISC_SPEED);
    const nextSleepFrames =
      Math.hypot(clamped.vx, clamped.vy) < SLEEP_SPEED ? (disc.sleepFrames ?? 0) + 1 : 0;
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
    discs.forEach((disc) => {
      if (disc.pocketed) {
        return;
      }

      disc.x += disc.vx / PHYSICS_SUBSTEPS;
      disc.y += disc.vy / PHYSICS_SUBSTEPS;
    });

    for (let pass = 0; pass < COLLISION_PASSES; pass += 1) {
      resolveDiscCollisions(discs, pass === 0);
      resolveWallCollisions(discs);
    }

    pocketedThisStep.push(...resolvePockets(discs));
  }

  settleTinyVelocities(discs);
  const pocketedThisTurn = mergePocketedDiscs(state.pocketedThisTurn, pocketedThisStep);

  const moving = discs.some(
    (disc) => !disc.pocketed && Math.hypot(disc.vx, disc.vy) > STOP_SPEED,
  );

  if (moving) {
    return { ...state, discs, pocketedThisTurn };
  }

  return resolveTurnEnd({ ...state, discs, pocketedThisTurn }, pocketedThisTurn);
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
  });
};

const resolveDiscCollisions = (discs: CarromDisc[], applyImpulse: boolean) => {
  for (let i = 0; i < discs.length; i += 1) {
    for (let j = i + 1; j < discs.length; j += 1) {
      const a = discs[i];
      const b = discs[j];

      if (a.pocketed || b.pocketed) {
        continue;
      }

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy);
      const minDistance = a.radius + b.radius;

      if (distance === 0 || distance >= minDistance) {
        continue;
      }

      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = minDistance - distance;
      const inverseMassA = 1 / getDiscMass(a);
      const inverseMassB = 1 / getDiscMass(b);
      const totalInverseMass = inverseMassA + inverseMassB;

      if (totalInverseMass === 0) {
        continue;
      }

      const correction = Math.max(overlap - POSITION_SLOP, 0) * POSITION_CORRECTION;

      a.x -= (nx * correction * inverseMassA) / totalInverseMass;
      a.y -= (ny * correction * inverseMassA) / totalInverseMass;
      b.x += (nx * correction * inverseMassB) / totalInverseMass;
      b.y += (ny * correction * inverseMassB) / totalInverseMass;

      if (!applyImpulse || overlap <= POSITION_SLOP) {
        continue;
      }

      const relativeVx = b.vx - a.vx;
      const relativeVy = b.vy - a.vy;
      const velocityAlongNormal = relativeVx * nx + relativeVy * ny;

      if (velocityAlongNormal > -RESTING_CONTACT_SPEED) {
        continue;
      }

      const restitution = Math.min(getDiscRestitution(a), getDiscRestitution(b));
      const impulseMagnitude = Math.min(
        (-(1 + restitution) * velocityAlongNormal) / totalInverseMass,
        MAX_COLLISION_IMPULSE,
      );
      const impulseX = impulseMagnitude * nx;
      const impulseY = impulseMagnitude * ny;

      a.vx = zeroTinyVelocity(a.vx - impulseX * inverseMassA);
      a.vy = zeroTinyVelocity(a.vy - impulseY * inverseMassA);
      b.vx = zeroTinyVelocity(b.vx + impulseX * inverseMassB);
      b.vy = zeroTinyVelocity(b.vy + impulseY * inverseMassB);

      const limitedA = clampVelocity(a.vx, a.vy, MAX_DISC_SPEED);
      const limitedB = clampVelocity(b.vx, b.vy, MAX_DISC_SPEED);

      a.vx = limitedA.vx;
      a.vy = limitedA.vy;
      b.vx = limitedB.vx;
      b.vy = limitedB.vy;
      a.sleepFrames = 0;
      b.sleepFrames = 0;
    }
  }
};

const countRemainingCoins = (discs: CarromDisc[], kind: CarromCoinKind) =>
  discs.filter((disc) => disc.kind === kind && !disc.pocketed).length;

const resolvePockets = (discs: CarromDisc[]) => {
  const pocketed: CarromDisc[] = [];

  discs.forEach((disc) => {
    if (disc.pocketed) {
      return;
    }

    const inPocket = CARROM_POCKETS.some(
      (pocket) => Math.hypot(disc.x - pocket.x, disc.y - pocket.y) < CARROM_POCKET_RADIUS,
    );

    if (inPocket) {
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
    (pocket) => Math.hypot(disc.x - pocket.x, disc.y - pocket.y) < CARROM_POCKET_RADIUS + disc.radius,
  );

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
  const speed = Math.hypot(disc.vx, disc.vy);

  if (speed === 0) {
    return { vx: 0, vy: 0 };
  }

  const drag = getDiscRollingDrag(disc) + Math.min(speed, 38) * 0.00016;
  const lowSpeedDrag = smoothStep(0, 5, 5 - Math.min(speed, 5)) * 0.022;
  const nextSpeed = Math.max(0, speed * (1 - drag - lowSpeedDrag));
  const finalSpeed = nextSpeed < 0.18 ? 0 : nextSpeed;
  const scale = finalSpeed / speed;

  return {
    vx: disc.vx * scale,
    vy: disc.vy * scale,
  };
};

const getDiscMass = (disc: CarromDisc) =>
  disc.mass ?? (disc.kind === 'striker' ? STRIKER_MASS : PIECE_MASS);

const getDiscRestitution = (disc: CarromDisc) =>
  disc.restitution ?? (disc.kind === 'striker' ? STRIKER_RESTITUTION : PIECE_RESTITUTION);

const getDiscRollingDrag = (disc: CarromDisc) =>
  disc.rollingDrag ?? (disc.kind === 'striker' ? STRIKER_ROLLING_DRAG : PIECE_ROLLING_DRAG);

const clampVelocity = (vx: number, vy: number, maxSpeed: number) => {
  const speed = Math.hypot(vx, vy);

  if (speed <= maxSpeed || speed === 0) {
    return { vx, vy };
  }

  const scale = maxSpeed / speed;

  return {
    vx: vx * scale,
    vy: vy * scale,
  };
};

const smoothStep = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);

  return t * t * (3 - 2 * t);
};

const zeroTinyVelocity = (value: number) =>
  Math.abs(value) < TINY_COMPONENT_SPEED ? 0 : value;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
