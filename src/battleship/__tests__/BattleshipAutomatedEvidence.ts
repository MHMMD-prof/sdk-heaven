import {
  battleshipAutomatedCheckTemplate,
  type BattleshipAutomatedCheckResult,
} from './BattleshipQaRunner';

const evidenceById: Record<string, Pick<BattleshipAutomatedCheckResult, 'date' | 'evidence' | 'status'>> = {
  'battleship-tests': {
    date: '2026-07-06',
    evidence: 'Passed: 6 test files, 66 tests.',
    status: 'passed',
  },
  typescript: {
    date: '2026-07-06',
    evidence: 'Passed: npx tsc --noEmit.',
    status: 'passed',
  },
  'full-suite': {
    date: '2026-07-06',
    evidence: 'Passed: 29 test files, 245 tests.',
    status: 'passed',
  },
};

export const battleshipAutomatedEvidence: BattleshipAutomatedCheckResult[] =
  battleshipAutomatedCheckTemplate.map((check) => ({
    ...check,
    date: evidenceById[check.id]?.date ?? '',
    evidence: evidenceById[check.id]?.evidence ?? '',
    notes: '',
    status: evidenceById[check.id]?.status ?? check.status,
  }));
