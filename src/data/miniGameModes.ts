import { MiniGameMode } from '../types/miniGame';

export const miniGameModes: MiniGameMode[] = [
  {
    id: 'naval',
    title: '\u0645\u0628\u0627\u0631\u0632\u0629 \u0627\u0644\u0628\u062d\u0631',
    subtitle:
      '\u0627\u0639\u062b\u0631 \u0639\u0644\u0649 \u0642\u0637\u0639 \u0627\u0644\u062e\u0635\u0645 \u0627\u0644\u0645\u062e\u0641\u064a\u0629 \u0642\u0628\u0644 \u0646\u0641\u0627\u062f \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0627\u062a.',
    boardLabel: '\u0627\u0644\u062e\u0631\u064a\u0637\u0629 \u0627\u0644\u0628\u062d\u0631\u064a\u0629',
    accentColor: '#4BA3FF',
    targets: [
      {
        id: 'ship-one',
        name: '\u0627\u0644\u0633\u0641\u064a\u0646\u0629 \u0627\u0644\u0645\u0644\u0643\u064a\u0629',
        shortLabel: '\u0633',
        imageKey: 'big',
        footprint: { columns: 4, rows: 2 },
      },
      {
        id: 'ship-two',
        name: '\u0627\u0644\u0637\u0631\u0627\u062f \u0627\u0644\u0637\u0648\u064a\u0644',
        shortLabel: '\u0637',
        imageKey: 'long',
        footprint: { columns: 3, rows: 1 },
      },
      {
        id: 'ship-three',
        name: '\u0627\u0644\u0642\u0627\u0631\u0628 \u0627\u0644\u0633\u0631\u064a\u0639',
        shortLabel: '\u0642',
        imageKey: 'medium',
        footprint: { columns: 2, rows: 1 },
      },
      {
        id: 'ship-four',
        name: '\u0632\u0648\u0631\u0642 \u0627\u0644\u0643\u0634\u0641',
        shortLabel: '\u0632',
        imageKey: 'small',
        footprint: { columns: 1, rows: 1 },
      },
    ],
  },
  {
    id: 'farm',
    title: '\u0645\u0632\u0631\u0639\u0629 \u0627\u0644\u0623\u0633\u0631\u0627\u0631',
    subtitle:
      '\u0627\u0643\u062a\u0634\u0641 \u0645\u0648\u0627\u0642\u0639 \u0627\u0644\u0628\u064a\u062a \u0648\u0627\u0644\u062d\u0638\u064a\u0631\u0629 \u0648\u0627\u0644\u062d\u062f\u064a\u0642\u0629 \u062f\u0627\u062e\u0644 \u0627\u0644\u062e\u0631\u064a\u0637\u0629.',
    boardLabel: '\u062e\u0631\u064a\u0637\u0629 \u0627\u0644\u0645\u0632\u0631\u0639\u0629',
    accentColor: '#2BCB88',
    targets: [
      {
        id: 'farm-house',
        name: '\u0628\u064a\u062a \u0627\u0644\u0645\u0632\u0631\u0639\u0629',
        shortLabel: '\u0628',
      },
      {
        id: 'stable',
        name: '\u0627\u0644\u062d\u0638\u064a\u0631\u0629',
        shortLabel: '\u062d',
      },
      {
        id: 'garden',
        name: '\u0627\u0644\u062d\u062f\u064a\u0642\u0629',
        shortLabel: '\u062c',
      },
    ],
  },
];
