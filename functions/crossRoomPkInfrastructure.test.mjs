import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { GROWTH_ROLLOUT_STAGES } = require('./growthRolloutCore');
const indexes = JSON.parse(fs.readFileSync('../firestore.indexes.json', 'utf8'));

describe('cross-room PK Wave 3 infrastructure manifest', () => {
  it('keeps every supported general growth preset dark', () => {
    expect(GROWTH_ROLLOUT_STAGES.every((stage) => stage.growthFeatures.crossRoomPk === false)).toBe(true);
  });

  it('declares every required lifecycle, settlement, and reconciliation index', () => {
    const signatures = new Set(indexes.indexes.map((index) => [
      index.collectionGroup,
      index.queryScope,
      index.fields.map((field) => `${field.fieldPath}:${field.order || field.arrayConfig}`).join(','),
    ].join('|')));
    for (const signature of [
      'roomPkChallenges|COLLECTION|status:ASCENDING,expiresAt:ASCENDING',
      'roomPkSessions|COLLECTION|mode:ASCENDING,status:ASCENDING,endsAt:ASCENDING',
      'roomPkSessions|COLLECTION|mode:ASCENDING,status:ASCENDING',
      'roomPkSessions|COLLECTION|status:ASCENDING,settleAfter:ASCENDING',
      'roomPkReconciliations|COLLECTION|status:ASCENDING,leaseExpiresAt:ASCENDING',
      'roomPkReconciliations|COLLECTION|status:ASCENDING,updatedAt:ASCENDING',
      'rooms|COLLECTION|status:ASCENDING,visibility:ASCENDING',
      'giftEvents|COLLECTION|pkContext.pkId:ASCENDING,createdAt:ASCENDING',
    ]) expect(signatures.has(signature), signature).toBe(true);
  });

  it('declares TTL for every bounded cross-room authority record family', () => {
    const ttlGroups = new Set(indexes.fieldOverrides
      .filter((override) => override.fieldPath === 'purgeAfter' && override.ttl === true)
      .map((override) => override.collectionGroup));
    for (const group of [
      'crossRoomPkPairCooldowns', 'crossRoomPkRoomRateLimits', 'gifters', 'pkCommandRequests',
      'roomPkAuditEvents', 'roomPkChallenges', 'roomPkGiftFacts', 'roomPkRateLimits',
      'roomPkReconciliations', 'roomPkSessions', 'scoreShards',
    ]) expect(ttlGroups.has(group), group).toBe(true);
  });
});
