import { DrawingStroke } from '../model/types';

export type DrawingTool = DrawingStroke['tool'];

export const drawingGuessBrushColors = [
  '#111827',
  '#6B7280',
  '#FFFFFF',
  '#EF4444',
  '#F472B6',
  '#F97316',
  '#FACC15',
  '#2BCB88',
  '#14B8A6',
  '#22D3EE',
  '#4BA3FF',
  '#7C3AED',
  '#8B5A2B',
  '#F2C6A0',
  '#D7A54A',
  '#0F172A',
] as const;

export const drawingGuessBrushWidths = [4, 8, 12, 18] as const;

export const drawingGuessEraserWidth = 24;

export type DrawingToolState = {
  selectedTool: DrawingTool;
  brushColor: string;
  brushWidth: number;
  eraserWidth: number;
};
