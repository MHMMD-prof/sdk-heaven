export type BattleshipQaPlatform = 'android' | 'ios';
export type BattleshipQaStatus = 'blocked' | 'failed' | 'not-run' | 'passed';
export type BattleshipAutomatedCheckStatus = 'failed' | 'not-run' | 'passed';
export type BattleshipQaEvidenceKind = 'device-log' | 'screenshot' | 'text' | 'video';

export type BattleshipQaScenario = {
  id: string;
  blocker: boolean;
  estimatedMinutes?: number;
  evidenceKind?: BattleshipQaEvidenceKind;
  platform: BattleshipQaPlatform;
  setupNotes?: string;
  targeted: boolean;
  title: string;
};

export type BattleshipQaResult = BattleshipQaScenario & {
  date?: string;
  evidence?: string;
  notes?: string;
  status: BattleshipQaStatus;
  tester?: string;
};

export type BattleshipQaSummary = {
  approved: boolean;
  blocked: number;
  failed: number;
  notRun: number;
  openBlockers: BattleshipQaResult[];
  passed: number;
  total: number;
};

export type BattleshipQaValidation = {
  errors: string[];
  summary: BattleshipQaSummary;
};

export type BattleshipAutomatedCheckResult = {
  command: string;
  date?: string;
  evidence?: string;
  id: string;
  notes?: string;
  required: boolean;
  requiredResult: 'pass';
  status: BattleshipAutomatedCheckStatus;
};

export type BattleshipAutomatedCheckSummary = {
  failed: number;
  notRun: number;
  openBlockers: BattleshipAutomatedCheckResult[];
  passed: number;
  total: number;
};

export type BattleshipAutomatedCheckValidation = {
  errors: string[];
  summary: BattleshipAutomatedCheckSummary;
};

export type BattleshipReleaseEvidence = {
  automatedChecks: BattleshipAutomatedCheckResult[];
  manualResults: BattleshipQaResult[];
};

export type BattleshipReleaseStatusSummary = {
  approved: boolean;
  automatedSummary: BattleshipAutomatedCheckSummary;
  blockedByAutomation: boolean;
  blockedByManualQa: boolean;
  blockerReasons: string[];
  manualSummary: BattleshipQaSummary;
};

export type BattleshipManualQaPacketItem = BattleshipQaResult & {
  evidenceKind: BattleshipQaEvidenceKind;
  expectedPassCriteria: string;
  setupNotes: string;
};

export type BattleshipManualQaPacket = {
  androidBlockers: BattleshipManualQaPacketItem[];
  androidNonBlockers: BattleshipManualQaPacketItem[];
  totalEstimatedMinutes: number;
};

export const battleshipQaTemplate: BattleshipQaResult[] = [
  {
    blocker: true,
    id: 'android-full-local-match',
    estimatedMinutes: 12,
    evidenceKind: 'text',
    platform: 'android',
    setupNotes: 'Use a native Android dev-client or release-like build. Start from the Games flow with a clean local Battleship state.',
    status: 'not-run',
    targeted: true,
    title: 'Complete a full local match from setup through victory or draw.',
  },
  {
    blocker: true,
    id: 'android-drag-scroll',
    estimatedMinutes: 8,
    evidenceKind: 'video',
    platform: 'android',
    setupNotes: 'Use a small or standard Android phone screen. Start in Player 1 setup with at least one unplaced ship selected.',
    status: 'not-run',
    targeted: true,
    title: 'Drag every ship type, rotate at least one ship, and confirm page scroll does not steal the drag.',
  },
  {
    blocker: true,
    id: 'android-resume-background',
    estimatedMinutes: 10,
    evidenceKind: 'text',
    platform: 'android',
    setupNotes: 'Use Android app switcher/background controls. Exercise setup, battle, and pending turn handoff before recording the result.',
    status: 'not-run',
    targeted: true,
    title: 'Background and resume during setup, battle, and pending handoff.',
  },
  {
    blocker: true,
    id: 'android-privacy-handoff',
    estimatedMinutes: 6,
    evidenceKind: 'screenshot',
    platform: 'android',
    setupNotes: 'Complete Player 1 setup, then trigger setup handoff and at least one battle turn handoff.',
    status: 'not-run',
    targeted: true,
    title: 'Confirm setup and turn handoff screens hide board state until readiness is confirmed.',
  },
  {
    blocker: true,
    id: 'android-small-screen-rtl',
    estimatedMinutes: 7,
    evidenceKind: 'screenshot',
    platform: 'android',
    setupNotes: 'Use the narrowest Android device/emulator in the release matrix and Arabic/RTL UI as shipped.',
    status: 'not-run',
    targeted: true,
    title: 'Confirm narrow-screen Arabic labels, buttons, stats, fleet rows, and prompts do not clip.',
  },
  {
    blocker: true,
    id: 'android-accessibility-smoke',
    estimatedMinutes: 8,
    evidenceKind: 'text',
    platform: 'android',
    setupNotes: 'Enable Android screen reader and traverse setup rows, board cells, sound toggle, resume, and prompts.',
    status: 'not-run',
    targeted: true,
    title: 'Run a screen reader smoke pass over setup rows, board cells, sound toggle, resume, and prompts.',
  },
  {
    blocker: true,
    id: 'android-corrupt-save',
    estimatedMinutes: 5,
    evidenceKind: 'device-log',
    platform: 'android',
    setupNotes: 'Seed an invalid value for the Battleship AsyncStorage save key in development, then relaunch the app.',
    status: 'not-run',
    targeted: true,
    title: 'Seed a corrupt local save, relaunch, and confirm Resume is hidden and the game does not crash.',
  },
  {
    blocker: false,
    id: 'android-audio-haptics-muted',
    estimatedMinutes: 3,
    evidenceKind: 'text',
    platform: 'android',
    setupNotes: 'Use the in-game sound toggle and a device/emulator where haptic behavior can be observed or safely ignored.',
    status: 'not-run',
    targeted: true,
    title: 'Toggle sound off and verify the game remains playable without audio or haptics assumptions.',
  },
  {
    blocker: true,
    id: 'android-audio-unavailable',
    estimatedMinutes: 4,
    evidenceKind: 'text',
    platform: 'android',
    setupNotes: 'Use an emulator/device configuration where sound may be unavailable or interrupted.',
    status: 'not-run',
    targeted: true,
    title: 'Disable or interrupt audio output in development and confirm gameplay continues without crashes.',
  },
  {
    blocker: true,
    id: 'android-haptics-unavailable',
    estimatedMinutes: 4,
    evidenceKind: 'text',
    platform: 'android',
    setupNotes: 'Use an emulator or device/settings combination where haptic feedback is unavailable.',
    status: 'not-run',
    targeted: true,
    title: 'Run where haptics are unavailable and confirm all gameplay remains usable.',
  },
  {
    blocker: true,
    id: 'android-interrupted-gesture',
    estimatedMinutes: 5,
    evidenceKind: 'video',
    platform: 'android',
    setupNotes: 'Begin dragging a selected setup ship, then interrupt via app switcher, navigation, or gesture cancellation.',
    status: 'not-run',
    targeted: true,
    title: 'Interrupt a ship drag and confirm preview and ghost state clear.',
  },
  {
    blocker: true,
    id: 'android-animation-reset',
    estimatedMinutes: 5,
    evidenceKind: 'video',
    platform: 'android',
    setupNotes: 'Enter battle, fire a shot, then immediately reset or trigger handoff while feedback is active.',
    status: 'not-run',
    targeted: true,
    title: 'Reset or hand off during shot feedback and confirm the board does not stay locked.',
  },
  {
    blocker: true,
    id: 'ios-full-local-match',
    estimatedMinutes: 12,
    evidenceKind: 'text',
    platform: 'ios',
    setupNotes: 'Only target this scenario when iOS is included in the release scope.',
    status: 'not-run',
    targeted: false,
    title: 'Complete a full local match on iOS if iOS is in the release target.',
  },
  {
    blocker: true,
    id: 'ios-resume-background',
    estimatedMinutes: 8,
    evidenceKind: 'text',
    platform: 'ios',
    setupNotes: 'Only target this scenario when iOS is included in the release scope.',
    status: 'not-run',
    targeted: false,
    title: 'Background and resume setup and battle on iOS if iOS is in the release target.',
  },
];

export const battleshipAutomatedCheckTemplate: BattleshipAutomatedCheckResult[] = [
  {
    command: 'npx vitest run src/battleship/__tests__',
    id: 'battleship-tests',
    required: true,
    requiredResult: 'pass',
    status: 'not-run',
  },
  {
    command: 'npx tsc --noEmit',
    id: 'typescript',
    required: true,
    requiredResult: 'pass',
    status: 'not-run',
  },
  {
    command: 'npm test',
    id: 'full-suite',
    required: true,
    requiredResult: 'pass',
    status: 'not-run',
  },
];

export const summarizeBattleshipQaResults = (
  results: BattleshipQaResult[],
): BattleshipQaSummary => {
  const targetedResults = results.filter((result) => result.targeted);
  const openBlockers = targetedResults.filter(
    (result) => result.blocker && result.status !== 'passed',
  );

  return {
    approved: openBlockers.length === 0,
    blocked: targetedResults.filter((result) => result.status === 'blocked').length,
    failed: targetedResults.filter((result) => result.status === 'failed').length,
    notRun: targetedResults.filter((result) => result.status === 'not-run').length,
    openBlockers,
    passed: targetedResults.filter((result) => result.status === 'passed').length,
    total: targetedResults.length,
  };
};

export const canApproveBattleshipRelease = (summary: BattleshipQaSummary) =>
  summary.approved && summary.openBlockers.length === 0;

export const validateBattleshipQaResults = (
  results: BattleshipQaResult[],
): BattleshipQaValidation => {
  const errors: string[] = [];
  const seenIds = new Set<string>();

  results.forEach((result) => {
    if (seenIds.has(result.id)) {
      errors.push(`${result.id}: duplicate scenario id`);
    }
    seenIds.add(result.id);

    if (result.platform === 'android' && !result.targeted) {
      errors.push(`${result.id}: Android scenarios must be targeted`);
    }

    if ((result.status === 'failed' || result.status === 'blocked') && !result.notes?.trim()) {
      errors.push(`${result.id}: failed or blocked scenarios require notes`);
    }

    if (result.status === 'passed' && (!result.tester?.trim() || !result.date?.trim())) {
      errors.push(`${result.id}: passed scenarios require tester and date`);
    }
  });

  const summary = summarizeBattleshipQaResults(results);

  if (canApproveBattleshipRelease(summary)) {
    const missingEvidence = results.filter(
      (result) => result.targeted && result.status === 'passed' && !result.evidence?.trim(),
    );

    missingEvidence.forEach((result) => {
      errors.push(`${result.id}: approved releases require evidence text`);
    });
  }

  return {
    errors,
    summary: errors.length ? { ...summary, approved: false } : summary,
  };
};

export const summarizeBattleshipAutomatedChecks = (
  checks: BattleshipAutomatedCheckResult[],
): BattleshipAutomatedCheckSummary => {
  const requiredChecks = checks.filter((check) => check.required);
  const openBlockers = requiredChecks.filter((check) => check.status !== 'passed');

  return {
    failed: requiredChecks.filter((check) => check.status === 'failed').length,
    notRun: requiredChecks.filter((check) => check.status === 'not-run').length,
    openBlockers,
    passed: requiredChecks.filter((check) => check.status === 'passed').length,
    total: requiredChecks.length,
  };
};

export const validateBattleshipAutomatedChecks = (
  checks: BattleshipAutomatedCheckResult[],
): BattleshipAutomatedCheckValidation => {
  const errors: string[] = [];
  const seenIds = new Set<string>();

  checks.forEach((check) => {
    if (seenIds.has(check.id)) {
      errors.push(`${check.id}: duplicate automated check id`);
    }
    seenIds.add(check.id);

    if (check.required && check.status !== 'passed') {
      errors.push(`${check.id}: required automated check must pass`);
    }

    if (check.status === 'failed' && !check.notes?.trim()) {
      errors.push(`${check.id}: failed automated checks require notes`);
    }

    if (check.status === 'passed' && (!check.date?.trim() || !check.evidence?.trim())) {
      errors.push(`${check.id}: passed automated checks require date and evidence`);
    }
  });

  return {
    errors,
    summary: summarizeBattleshipAutomatedChecks(checks),
  };
};

export const summarizeBattleshipReleaseEvidence = ({
  automatedChecks,
  manualResults,
}: BattleshipReleaseEvidence): BattleshipReleaseStatusSummary => {
  const automatedValidation = validateBattleshipAutomatedChecks(automatedChecks);
  const manualValidation = validateBattleshipQaResults(manualResults);
  const blockedByAutomation =
    automatedValidation.errors.length > 0 ||
    automatedValidation.summary.openBlockers.length > 0;
  const blockedByManualQa =
    manualValidation.errors.length > 0 || manualValidation.summary.openBlockers.length > 0;
  const automatedReasons = automatedValidation.errors.length
    ? automatedValidation.errors
    : automatedValidation.summary.openBlockers.map(
        (check) => `${check.id}: automated check is ${check.status}`,
      );
  const manualReasons = manualValidation.errors.length
    ? manualValidation.errors
    : manualValidation.summary.openBlockers.map(
        (result) => `${result.id}: manual QA is ${result.status}`,
      );

  return {
    approved: !blockedByAutomation && !blockedByManualQa,
    automatedSummary: automatedValidation.summary,
    blockedByAutomation,
    blockedByManualQa,
    blockerReasons: [...automatedReasons, ...manualReasons],
    manualSummary: manualValidation.summary,
  };
};

export const getBattleshipManualQaPacket = (
  results: BattleshipQaResult[],
): BattleshipManualQaPacket => {
  const androidItems = results
    .filter((result) => result.targeted && result.platform === 'android')
    .map((result) => ({
      ...result,
      evidenceKind: result.evidenceKind ?? 'text',
      expectedPassCriteria: getExpectedPassCriteria(result),
      setupNotes: result.setupNotes ?? 'Use the Android release QA build.',
    }));

  return {
    androidBlockers: androidItems.filter((item) => item.blocker),
    androidNonBlockers: androidItems.filter((item) => !item.blocker),
    totalEstimatedMinutes: androidItems.reduce(
      (total, item) => total + (item.estimatedMinutes ?? 0),
      0,
    ),
  };
};

const getExpectedPassCriteria = (scenario: BattleshipQaScenario) => {
  switch (scenario.id) {
    case 'android-drag-scroll':
      return 'Ship ghost follows the finger, placement preview clears on interruption, and page scroll does not steal active drags.';
    case 'android-resume-background':
      return 'Resume restores setup, battle, and pending handoff state without stale previews or wrong-player exposure.';
    case 'android-privacy-handoff':
      return 'No board state is visible until the correct player explicitly confirms readiness.';
    case 'android-small-screen-rtl':
      return 'Arabic labels, buttons, stat tiles, fleet rows, and prompts remain readable without clipping.';
    case 'android-accessibility-smoke':
      return 'Screen reader announces core controls clearly and gameplay remains navigable.';
    case 'android-corrupt-save':
      return 'Invalid local save is discarded, Resume is hidden, and the app does not crash.';
    case 'android-audio-haptics-muted':
      return 'Muted or ignored feedback never blocks setup, firing, handoff, victory, or reset.';
    case 'android-audio-unavailable':
      return 'Audio playback failures do not crash the app or block gameplay.';
    case 'android-haptics-unavailable':
      return 'Missing haptics do not crash the app or block gameplay.';
    case 'android-interrupted-gesture':
      return 'Interrupted drags clear preview and ghost state, then setup remains usable.';
    case 'android-animation-reset':
      return 'Shot feedback interruption does not leave cells locked or stale animations visible.';
    case 'android-full-local-match':
    default:
      return 'A complete local match can be finished and reset without crashes, privacy leaks, or stuck state.';
  }
};
