const { createDirectConversationId } = require('./directChatCore');
const { createFriendshipId } = require('./socialFriendsCore');
const { readFollowCount } = require('./socialFollowCore');
const { BLOCK_MUTATION_ACTIONS, normalizeBlockTargetInput } = require('./socialBlocksCore');

/**
 * Clears friendship + follow edges both ways and corrects public profile counts.
 * Callers must read all referenced docs before invoking (Firestore read-before-write).
 */
function applySocialBlockRelationshipCleanup({
  actorProfileData = {},
  actorUid,
  db,
  followActorToTargetExists,
  followTargetToActorExists,
  followerActorOfTargetExists,
  followerTargetOfActorExists,
  friendshipExists,
  targetProfileData = {},
  targetUid,
  timestamp,
  transaction,
}) {
  const friendshipId = createFriendshipId(actorUid, targetUid);
  const refs = {
    actor: db.doc(`publicProfiles/${actorUid}`),
    followActorToTarget: db.doc(`following/${actorUid}/items/${targetUid}`),
    followTargetToActor: db.doc(`following/${targetUid}/items/${actorUid}`),
    followerActorOfTarget: db.doc(`followers/${targetUid}/items/${actorUid}`),
    followerTargetOfActor: db.doc(`followers/${actorUid}/items/${targetUid}`),
    friendship: db.doc(`friendships/${friendshipId}`),
    friendRequest: db.doc(`friendRequests/${friendshipId}`),
    target: db.doc(`publicProfiles/${targetUid}`),
  };

  let actorFriendCount = readFollowCount(actorProfileData.friendCount);
  let targetFriendCount = readFollowCount(targetProfileData.friendCount);
  let actorFollowingCount = readFollowCount(actorProfileData.followingCount);
  let actorFollowerCount = readFollowCount(actorProfileData.followerCount);
  let targetFollowingCount = readFollowCount(targetProfileData.followingCount);
  let targetFollowerCount = readFollowCount(targetProfileData.followerCount);
  let countsChanged = false;

  if (friendshipExists) {
    transaction.delete(refs.friendship);
    actorFriendCount = Math.max(0, actorFriendCount - 1);
    targetFriendCount = Math.max(0, targetFriendCount - 1);
    countsChanged = true;
  }
  transaction.delete(refs.friendRequest);

  if (followActorToTargetExists || followerActorOfTargetExists) {
    if (followActorToTargetExists) transaction.delete(refs.followActorToTarget);
    if (followerActorOfTargetExists) transaction.delete(refs.followerActorOfTarget);
    actorFollowingCount = Math.max(0, actorFollowingCount - 1);
    targetFollowerCount = Math.max(0, targetFollowerCount - 1);
    countsChanged = true;
  }

  if (followTargetToActorExists || followerTargetOfActorExists) {
    if (followTargetToActorExists) transaction.delete(refs.followTargetToActor);
    if (followerTargetOfActorExists) transaction.delete(refs.followerTargetOfActor);
    targetFollowingCount = Math.max(0, targetFollowingCount - 1);
    actorFollowerCount = Math.max(0, actorFollowerCount - 1);
    countsChanged = true;
  }

  if (countsChanged) {
    transaction.update(refs.actor, {
      friendCount: actorFriendCount,
      followerCount: actorFollowerCount,
      followingCount: actorFollowingCount,
      updatedAt: timestamp,
    });
    transaction.update(refs.target, {
      friendCount: targetFriendCount,
      followerCount: targetFollowerCount,
      followingCount: targetFollowingCount,
      updatedAt: timestamp,
    });
  }

  return { countsChanged, friendshipId };
}

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
      followActorToTarget: db.doc(`following/${uid}/items/${targetUid}`),
      followTargetToActor: db.doc(`following/${targetUid}/items/${uid}`),
      followerActorOfTarget: db.doc(`followers/${targetUid}/items/${uid}`),
      followerTargetOfActor: db.doc(`followers/${uid}/items/${targetUid}`),
      friendship: db.doc(`friendships/${friendshipId}`),
      friendRequest: db.doc(`friendRequests/${friendshipId}`),
      messageRequest: db.doc(`directMessageRequests/${conversationId}`),
      target: db.doc(`publicProfiles/${targetUid}`),
    };
    const [
      actor,
      target,
      block,
      command,
      conversation,
      messageRequest,
      friendship,
      followActorToTarget,
      followTargetToActor,
      followerActorOfTarget,
      followerTargetOfActor,
    ] = await Promise.all([
      transaction.get(refs.actor),
      transaction.get(refs.target),
      transaction.get(refs.block),
      transaction.get(refs.command),
      transaction.get(refs.conversation),
      transaction.get(refs.messageRequest),
      transaction.get(refs.friendship),
      transaction.get(refs.followActorToTarget),
      transaction.get(refs.followTargetToActor),
      transaction.get(refs.followerActorOfTarget),
      transaction.get(refs.followerTargetOfActor),
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
      if (!block.exists) {
        transaction.create(refs.block, {
          blockedUid: targetUid,
          blockerUid: uid,
          createdAt: timestamp,
          source: 'personal-chat',
        });
      }

      applySocialBlockRelationshipCleanup({
        actorProfileData: actor.exists ? actor.data() : {},
        actorUid: uid,
        db,
        followActorToTargetExists: followActorToTarget.exists === true,
        followTargetToActorExists: followTargetToActor.exists === true,
        followerActorOfTargetExists: followerActorOfTarget.exists === true,
        followerTargetOfActorExists: followerTargetOfActor.exists === true,
        friendshipExists: friendship.exists === true,
        targetProfileData: target.exists ? target.data() : {},
        targetUid,
        timestamp,
        transaction,
      });

      if (messageRequest.exists && messageRequest.data()?.status === 'pending') {
        transaction.set(refs.messageRequest, {
          blockedAt: timestamp,
          blockedByUid: uid,
          status: 'blocked',
          updatedAt: timestamp,
        }, { merge: true });
        if (conversation.exists) {
          transaction.set(refs.conversation, {
            recipientUid: '',
            requesterUid: '',
            requestState: 'blocked',
            updatedAt: timestamp,
          }, { merge: true });
        }
        for (const memberUid of [uid, targetUid]) {
          transaction.set(
            db.doc(`directConversationMembers/${memberUid}/items/${conversationId}`),
            { requestState: 'blocked', updatedAt: timestamp },
            { merge: true },
          );
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

module.exports = {
  applySocialBlockRelationshipCleanup,
  mutateUserBlock,
};
