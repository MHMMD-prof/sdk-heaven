export type GrowthMatchMask = {
  expiresAtMs: number;
  labelAr: string;
  roomId: string;
};

let activeMask: GrowthMatchMask | null = null;

export function setGrowthMatchMask(mask: GrowthMatchMask | null) {
  activeMask = mask;
}

export function getGrowthMatchMask(roomId?: string): GrowthMatchMask | null {
  if (!activeMask) return null;
  if (Date.now() > activeMask.expiresAtMs) {
    activeMask = null;
    return null;
  }
  if (roomId && activeMask.roomId !== roomId) return null;
  return activeMask;
}

export function clearGrowthMatchMask() {
  activeMask = null;
}

export function revealGrowthMatchMask() {
  clearGrowthMatchMask();
}
