const { createDirectConversationId } = require('./directChatCore');
const { createFriendshipId } = require('./socialFriendsCore');
const { BLOCK_MUTATION_ACTIONS, normalizeBlockTargetInput } = require('./socialBlocksCore');

async function mutateUserBlock({ action, db, fieldValue, input, requestId, uid }) {
  if (!BLOCK_MUTATION_ACTIONS.includes(action)) return { errorCode: 'INVALID_REQUEST' };
  const validation = normalizeBlockTargetInput(input, uid);
  if (!validation.ok) return { errorCode: validation.code };
  const targetUid = validation.value.targetUid;
  const friendshipId = createFriendshipId(uid, targetUid);
  const conversationId = createDirectConversationId(uid, targetUid);
  return db.runTransaction(async (transaction) => {
    const refs = {
      actor: db.doc(`publicProfiles/${uid}`),
      block: db.doc(`blocks/${uid}/blocked/${targetUid}`),
      command: db.doc(`socialCommandRequests/${uid}/requests/${requestId}`),
      conversation: db.doc(`directConversations/${conversationId}`),
      friendship: db.doc(`friendships/${friendshipId}`),
      friendRequest: db.doc(`friendRequests/${friendshipId}`),
      messageRequest: db.doc(`directMessageRequests/${conversationId}`),
      target: db.doc(`publicProfiles/${targetUid}`),
    };
    const [actor, target, block, command, conversation, messageRequest] = await Promise.all([
      transaction.get(refs.actor),
      transaction.get(refs.target),
      transaction.get(refs.block),
      transaction.get(refs.command),
      transaction.get(refs.conversation),
      transaction.get(refs.messageRequest),
    ]);
    if (command.exists) {
      const previous = command.data();
      return previous.action === action && previous.targetUid === targetUid && previous.result
        ? { result: previous.result }
        : { errorCode: 'CONFLICT' };
    }
    if (actor.data()?.moderationStatus !== 'active' || !target.exists || target.data()?.moderationStatus === 'removed') {
      return { errorCode: 'PERMISSION_DENIED' };
    }
    const timestamp = fieldValue.serverTimestamp();
    if (action === 'block-user') {
      if (!block.exists) transaction.create(refs.block, { blockedUid: targetUid, blockerUid: uid, createdAt: timestamp, source: 'personal-chat' });
      transaction.delete(refs.friendship);
      transaction.delete(refs.friendRequest);
      if (messageRequest.exists && messageRequest.data()?.status === 'pending') {
        transaction.set(refs.messageRequest, { blockedAt: timestamp, blockedByUid: uid, status: 'blocked', updatedAt: timestamp }, { merge: true });
        if (conversation.exists) transaction.set(refs.conversation, { recipientUid: '', requesterUid: '', requestState: 'blocked', updatedAt: timestamp }, { merge: true });
        for (const memberUid of [uid, targetUid]) {
          transaction.set(db.doc(`directConversationMembers/${memberUid}/items/${conversationId}`), { requestState: 'blocked', updatedAt: timestamp }, { merge: true });
        }
      }
    } else if (block.exists) {
      transaction.delete(refs.block);
    }
    const result = { blocked: action === 'block-user', targetUid };
    transaction.create(refs.command, { action, actorUid: uid, createdAt: timestamp, requestId, result, targetUid });
    return { result };
  });
}

module.exports = { mutateUserBlock };
