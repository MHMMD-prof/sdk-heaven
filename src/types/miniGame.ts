export type MiniGameModeId = 'naval' | 'farm';

export type MiniGameTarget = {
  id: string;
  name: string;
  shortLabel: string;
  imageKey?: 'big' | 'long' | 'medium' | 'small';
  isPlaced?: boolean;
  footprint: {
    columns: number;
    rows: number;
  };
  cells: string[];
};

export type MiniGameTargetDraft = Omit<MiniGameTarget, 'cells' | 'footprint'> & {
  footprint?: {
    columns: number;
    rows: number;
  };
};

export type MiniGameMode = {
  id: MiniGameModeId;
  title: string;
  subtitle: string;
  boardLabel: string;
  accentColor: string;
  targets: MiniGameTargetDraft[];
};

export type CellResult = 'hidden' | 'miss' | 'hit';
