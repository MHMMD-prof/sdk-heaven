import { MiniGameTarget } from '../types/miniGame';

import { shipSprites } from './constants';

export const getShipImageKey = (target: MiniGameTarget): MiniGameTarget['imageKey'] => {
  const longSide = Math.max(target.footprint.columns, target.footprint.rows);
  const shortSide = Math.min(target.footprint.columns, target.footprint.rows);

  if (longSide === 4 && shortSide === 2) {
    return 'big';
  }

  if (shortSide === 1 && longSide >= 3 && longSide <= 5) {
    return 'long';
  }

  if (shortSide === 1 && longSide === 2) {
    return 'medium';
  }

  if (longSide === 1 && shortSide === 1) {
    return 'small';
  }

  return target.imageKey;
};

export function createShipVisual(target: MiniGameTarget, frameWidth: number, frameHeight: number) {
  const imageKey = getShipImageKey(target);

  if (!imageKey) {
    return undefined;
  }

  const sprite = shipSprites[imageKey];
  const orientation = target.footprint.columns >= target.footprint.rows ? 'horizontal' : 'vertical';
  const crop = sprite.crop[orientation];
  const scaleX = frameWidth / crop.width;
  const scaleY = frameHeight / crop.height;

  return {
    image: sprite.source,
    imageStyle: {
      height: sprite.sheet.height * scaleY,
      left: -crop.x * scaleX,
      top: -crop.y * scaleY,
      width: sprite.sheet.width * scaleX,
    },
  };
}
