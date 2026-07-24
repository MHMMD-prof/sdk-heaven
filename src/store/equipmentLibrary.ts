import type { MyStoreItem } from '../social/types';

export function orderEquipmentItems(items: MyStoreItem[]) {
  return [...items].sort((left, right) => {
    if (left.ownership.equipped !== right.ownership.equipped) {
      return left.ownership.equipped ? -1 : 1;
    }
    if (left.ownership.state !== right.ownership.state) {
      return left.ownership.state === 'active' ? -1 : 1;
    }
    return (left.catalog?.order || 0) - (right.catalog?.order || 0);
  });
}
