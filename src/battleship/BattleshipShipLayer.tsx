import { ShipSpriteFrame } from './ShipSpriteFrame';
import { ShipFrame } from './BattleshipBoardTypes';

type BattleshipShipLayerProps = {
  keyPrefix?: string;
  ships: ShipFrame[];
};

export function BattleshipShipLayer({ keyPrefix = '', ships }: BattleshipShipLayerProps) {
  return (
    <>
      {ships.map((ship) => (
        <ShipSpriteFrame
          key={`${keyPrefix}${ship.id}`}
          image={ship.image}
          imageStyle={ship.imageStyle}
          isDarkened={ship.isDarkened}
          isExploding={ship.isExploding}
          style={ship.style}
        />
      ))}
    </>
  );
}
