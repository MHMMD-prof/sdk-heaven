export const BATTLESHIP_PROTOCOL_VERSION = 1;

export const BATTLESHIP_TOPICS = {
  control: 'nd.v1.control',
  placement: 'nd.v1.placement',
  battle: 'nd.v1.battle',
  snapshot: 'nd.v1.snapshot',
} as const;

export const BATTLESHIP_RULES = {
  minPlayers: 2,
  maxPlayers: 2,
} as const;
