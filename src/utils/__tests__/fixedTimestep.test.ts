import { describe, expect, it } from 'vitest';

import {
  FIXED_STEP_MS,
  MAX_FRAME_DELTA_MS,
  MAX_STEPS_PER_FRAME,
  advanceFixedTimestep,
  createFixedTimestepTiming,
} from '../fixedTimestep';

type CounterState = {
  completeAt?: number;
  value: number;
};

const stepCounter = (state: CounterState): CounterState => ({
  ...state,
  value: state.value + 1,
});

const isCounterComplete = (state: CounterState) =>
  state.completeAt !== undefined && state.value >= state.completeAt;

describe('fixed timestep accumulator', () => {
  it('waits for the first timestamp before stepping', () => {
    const result = advanceFixedTimestep({
      isComplete: isCounterComplete,
      state: { value: 0 },
      step: stepCounter,
      timestamp: 100,
      timing: createFixedTimestepTiming(),
    });

    expect(result.steps).toBe(0);
    expect(result.state.value).toBe(0);
    expect(result.timing.lastTimestamp).toBe(100);
  });

  it('runs one fixed step for one fixed interval', () => {
    const result = advanceFixedTimestep({
      isComplete: isCounterComplete,
      state: { value: 0 },
      step: stepCounter,
      timestamp: FIXED_STEP_MS,
      timing: { accumulatorMs: 0, lastTimestamp: 0 },
    });

    expect(result.steps).toBe(1);
    expect(result.state.value).toBe(1);
    expect(result.timing.accumulatorMs).toBeCloseTo(0);
  });

  it('runs multiple fixed steps for a longer frame', () => {
    const result = advanceFixedTimestep({
      isComplete: isCounterComplete,
      state: { value: 0 },
      step: stepCounter,
      timestamp: 50,
      timing: { accumulatorMs: 0, lastTimestamp: 0 },
    });

    expect(result.steps).toBe(3);
    expect(result.state.value).toBe(3);
  });

  it('clamps a huge frame gap and caps catch-up steps', () => {
    const result = advanceFixedTimestep({
      isComplete: isCounterComplete,
      state: { value: 0 },
      step: stepCounter,
      timestamp: 1000,
      timing: { accumulatorMs: 0, lastTimestamp: 0 },
    });

    expect(result.steps).toBe(MAX_STEPS_PER_FRAME);
    expect(result.state.value).toBe(MAX_STEPS_PER_FRAME);
    expect(result.timing.accumulatorMs).toBeLessThan(FIXED_STEP_MS);
    expect(result.timing.lastTimestamp).toBe(1000);
  });

  it('uses the maximum frame delta when catching up', () => {
    const result = advanceFixedTimestep({
      isComplete: isCounterComplete,
      state: { value: 0 },
      step: stepCounter,
      timestamp: MAX_FRAME_DELTA_MS,
      timing: { accumulatorMs: 0, lastTimestamp: 0 },
    });

    expect(result.steps).toBe(MAX_STEPS_PER_FRAME);
  });

  it('does not step an already complete state', () => {
    const result = advanceFixedTimestep({
      isComplete: isCounterComplete,
      state: { completeAt: 0, value: 0 },
      step: stepCounter,
      timestamp: 100,
      timing: { accumulatorMs: FIXED_STEP_MS, lastTimestamp: 0 },
    });

    expect(result.steps).toBe(0);
    expect(result.state.value).toBe(0);
    expect(result.timing).toEqual(createFixedTimestepTiming());
  });

  it('stops stepping when the state becomes complete', () => {
    const result = advanceFixedTimestep({
      isComplete: isCounterComplete,
      state: { completeAt: 2, value: 0 },
      step: stepCounter,
      timestamp: 50,
      timing: { accumulatorMs: 0, lastTimestamp: 0 },
    });

    expect(result.steps).toBe(2);
    expect(result.state.value).toBe(2);
    expect(result.timing.accumulatorMs).toBe(0);
  });
});
