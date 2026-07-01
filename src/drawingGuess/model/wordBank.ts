import { DrawingGuessPrompt } from './types';

export const drawingGuessWordBank: DrawingGuessPrompt[] = [
  {
    id: 'apple',
    text: 'Apple',
    category: 'food',
    aliases: ['تفاحة', 'تفاح'],
  },
  {
    id: 'coffee-cup',
    text: 'Coffee cup',
    category: 'objects',
    aliases: ['قهوة', 'كوب قهوة', 'فنجان'],
  },
  {
    id: 'house',
    text: 'House',
    category: 'household',
    aliases: ['بيت', 'منزل', 'دار'],
  },
  {
    id: 'airport',
    text: 'Airport',
    category: 'places',
    aliases: ['مطار'],
  },
  {
    id: 'running',
    text: 'Running',
    category: 'actions',
    aliases: ['ركض', 'جري', 'يركض'],
  },
  {
    id: 'cat',
    text: 'Cat',
    category: 'animals',
    aliases: ['قطة', 'قط', 'بسة'],
  },
  {
    id: 'key',
    text: 'Key',
    category: 'objects',
    aliases: ['مفتاح'],
  },
  {
    id: 'pizza',
    text: 'Pizza',
    category: 'food',
    aliases: ['بيتزا'],
  },
];

export const getPromptById = (promptId: string) =>
  drawingGuessWordBank.find((prompt) => prompt.id === promptId);
