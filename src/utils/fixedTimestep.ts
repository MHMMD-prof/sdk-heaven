export const FIXED_STEP_MS = 1000 / 60;
export const MAX_FRAME_DELTA_MS = 100;
export const MAX_STEPS_PER_FRAME = 4;
const TIMESTEP_EPSILON_MS = 0.000001;

export type FixedTimestepTiming = {
  accumulatorMs: number;
  lastTimestamp?: number;
};

type AdvanceFixedTimestepOptions<TState> = {
  isComplete: (state: TState) => boolean;
  maxStepsPerFrame?: number;
  step: (state: TState) => TState;
  state: TState;
  timestamp: number;
  timing: FixedTimestepTiming;
};

export type AdvanceFixedTimestepResult<TState> = {
  didStep: boolean;
  state: TState;
  steps: number;
  timing: FixedTimestepTiming;
};

export const createFixedTimestepTiming = (): FixedTimestepTiming => ({
  accumulatorMs: 0,
  lastTimestamp: undefined,
});

export function advanceFixedTimestep<TState>({
  isComplete,
  maxStepsPerFrame = MAX_STEPS_PER_FRAME,
  state,
  step,
  timestamp,
  timing,
}: AdvanceFixedTimestepOptions<TState>): AdvanceFixedTimestepResult<TState> {
  if (isComplete(state)) {
    return {
      didStep: false,
      state,
      steps: 0,
      timing: createFixedTimestepTiming(),
    };
  }

  if (timing.lastTimestamp === undefined) {
    return {
      didStep: false,
      state,
      steps: 0,
      timing: {
        accumulatorMs: timing.accumulatorMs,
        lastTimestamp: timestamp,
      },
    };
  }

  const elapsedMs = Math.max(
    0,
    Math.min(timestamp - timing.lastTimestamp, MAX_FRAME_DELTA_MS),
  );
  let accumulatorMs = timing.accumulatorMs + elapsedMs;
  let nextState = state;
  let steps = 0;

  while (
    accumulatorMs + TIMESTEP_EPSILON_MS >= FIXED_STEP_MS &&
    steps < maxStepsPerFrame &&
    !isComplete(nextState)
  ) {
    nextState = step(nextState);
    accumulatorMs = Math.max(0, accumulatorMs - FIXED_STEP_MS);
    steps += 1;
  }

  if (steps >= maxStepsPerFrame && accumulatorMs >= FIXED_STEP_MS) {
    accumulatorMs = accumulatorMs % FIXED_STEP_MS;
  }

  if (isComplete(nextState)) {
    accumulatorMs = 0;
  }

  return {
    didStep: steps > 0,
    state: nextState,
    steps,
    timing: {
      accumulatorMs,
      lastTimestamp: timestamp,
    },
  };
}
