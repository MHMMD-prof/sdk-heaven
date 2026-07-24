import { RoomAuthorityRole } from './roomV2Contract';

export type RoomCommandCenterCapability =
  | 'share'
  | 'games'
  | 'gifts'
  | 'reactions'
  | 'participants'
  | 'report'
  | 'microphones'
  | 'people'
  | 'safety'
  | 'room-settings'
  | 'ownership';

const EVERYONE: RoomCommandCenterCapability[] = [
  'share',
  'games',
  'gifts',
  'reactions',
  'participants',
  'report',
];

export function roomCommandCenterCapabilities(
  authorityRole: RoomAuthorityRole | undefined,
): RoomCommandCenterCapability[] {
  if (authorityRole === 'owner') {
    return [...EVERYONE, 'microphones', 'people', 'safety', 'room-settings', 'ownership'];
  }
  if (authorityRole === 'moderator') {
    return [...EVERYONE, 'microphones', 'people', 'safety'];
  }
  return EVERYONE;
}

export function hasRoomCommandCenterCapability(
  authorityRole: RoomAuthorityRole | undefined,
  capability: RoomCommandCenterCapability,
) {
  return roomCommandCenterCapabilities(authorityRole).includes(capability);
}
