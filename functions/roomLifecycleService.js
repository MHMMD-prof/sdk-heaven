const ROOM_REMOVAL_RECOVERY_MS = 30 * 24 * 60 * 60 * 1000;

async function finalizeRemovedRooms({
  clock = systemClock,
  db,
  fieldValue,
  limit = 50,
}) {
  const now = clock.timestampFromMillis(clock.nowMillis());
  const snapshot = await db.collection('rooms')
    .where('availability', '==', 'removed')
    .where('deletionStatus', '==', 'recoverable')
    .where('scheduledDeletionAt', '<=', now)
    .orderBy('scheduledDeletionAt', 'asc')
    .limit(limit)
    .get();
  let finalized = 0;

  for (const document of snapshot.docs) {
    const didFinalize = await db.runTransaction(async (transaction) => {
      const roomSnapshot = await transaction.get(document.ref);
      if (!roomSnapshot.exists) return false;
      const room = roomSnapshot.data();
      if (
        room.availability !== 'removed'
        || room.deletionStatus !== 'recoverable'
        || timestampToMillis(room.scheduledDeletionAt) > clock.nowMillis()
      ) {
        return false;
      }
      const timestamp = fieldValue.serverTimestamp();
      const archiveRef = db.doc(`deletedRoomArchives/${document.id}`);
      transaction.set(archiveRef, {
        countryCode: room.countryCode || '',
        createdAt: room.createdAt || timestamp,
        deletionReason: room.removalReason || '',
        finalizedAt: timestamp,
        ownerUid: room.ownerUid || room.hostId || '',
        removedAt: room.removedAt || timestamp,
        removedBy: room.removedBy || '',
        roomId: document.id,
        safetyEvidencePreserved: true,
      });
      transaction.update(document.ref, {
        activeRoomImageId: fieldValue.delete(),
        activeRoomImagePath: fieldValue.delete(),
        availability: 'purged',
        deletionFinalizedAt: timestamp,
        deletionStatus: 'finalized',
        inviteCode: fieldValue.delete(),
        pendingRoomImageId: fieldValue.delete(),
        pendingRoomImagePath: fieldValue.delete(),
        pendingOwnershipTransferExpiresAt: fieldValue.delete(),
        pendingOwnershipTransferId: fieldValue.delete(),
        status: 'closed',
        title: 'Removed room',
        updatedAt: timestamp,
        updatedBy: 'system',
      });
      return true;
    });
    if (didFinalize) finalized += 1;
  }
  return { finalized, scanned: snapshot.size ?? snapshot.docs.length };
}

function timestampToMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return 0;
}

const systemClock = {
  nowMillis: () => Date.now(),
  timestampFromMillis: (value) => new Date(value),
};

module.exports = {
  ROOM_REMOVAL_RECOVERY_MS,
  finalizeRemovedRooms,
};
