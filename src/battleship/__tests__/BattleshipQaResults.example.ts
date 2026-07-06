import { battleshipQaResultsTemplate } from './BattleshipQaResults.template';
import type { BattleshipQaResult } from './BattleshipQaRunner';

const exampleOverrides: Record<
  string,
  Pick<BattleshipQaResult, 'date' | 'evidence' | 'notes' | 'status' | 'tester'>
> = {
  'android-full-local-match': {
    date: '',
    evidence: 'Example passed evidence: completed Player 1 setup, Player 2 setup, battle, victory, and reset on Pixel device.',
    notes: 'Example only. Keep status not-run until a real device pass is recorded.',
    status: 'not-run',
    tester: 'Example Tester',
  },
  'android-drag-scroll': {
    date: '',
    evidence: 'Example failed evidence: video showed scroll stealing active ship drag on a narrow emulator.',
    notes: 'Example only. A real failed result must include the observed device/build and reproduction notes.',
    status: 'not-run',
    tester: 'Example Tester',
  },
  'android-resume-background': {
    date: '',
    evidence: 'Example blocked evidence: Android device unavailable for background/resume verification.',
    notes: 'Example only. A real blocked result must name the missing device/build condition.',
    status: 'not-run',
    tester: 'Example Tester',
  },
};

export const battleshipQaResultsExample: BattleshipQaResult[] =
  battleshipQaResultsTemplate.map((scenario) => ({
    ...scenario,
    ...(exampleOverrides[scenario.id] ?? {}),
  }));
