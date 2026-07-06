import { battleshipQaTemplate, type BattleshipQaResult } from './BattleshipQaRunner';

export const battleshipQaResultsTemplate: BattleshipQaResult[] = battleshipQaTemplate.map(
  (scenario) => ({
    ...scenario,
    date: '',
    evidence: '',
    notes: '',
    tester: '',
  }),
);
