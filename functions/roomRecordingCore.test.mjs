import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  RECORDING_POLICY_VERSION,
  buildEvidenceForReport,
  normalizeRoomRecordingBody,
  resolveEnsureRollingSession,
  resolveRequestPlayback,
  shouldDeleteExpiredEvidence,
  validateRoomRecordingRequest,
} = require('./roomRecordingCore');

const nowMs = 2_000_000_000_000;
const roomId = 'room-1';
const requestId = 'roomrecording_request_01';

describe('roomRecordingCore', () => {
  it('fails closed without the safety recording flag', () => {
    expect(resolveEnsureRollingSession({
      featureFlags: {},
      membership: { status: 'active', uid: 'u1' },
      nowMs,
      room: { availability: 'active', id: roomId, status: 'active' },
      senderUid: 'u1',
      sessionId: 'rrs_1',
    }).code).toBe('FEATURE_DISABLED');
  });

  it('validates acknowledge notice against the frozen policy version', () => {
    expect(validateRoomRecordingRequest(normalizeRoomRecordingBody({
      action: 'acknowledge-recording-notice',
      noticeVersion: 'old',
      requestId,
      roomId,
    })).code).toBe('NOTICE_STALE');
    expect(validateRoomRecordingRequest(normalizeRoomRecordingBody({
      action: 'acknowledge-recording-notice',
      noticeVersion: RECORDING_POLICY_VERSION,
      requestId,
      roomId,
    })).ok).toBe(true);
  });

  it('marks voice evidence missing when egress is not configured', () => {
    const evidence = buildEvidenceForReport({
      nowMs,
      reportId: 'room_report_1',
      roomId,
      reporterUid: 'u1',
      session: { egressStatus: 'not-configured', sessionId: 'rrs_1' },
    });
    expect(evidence.audioStatus).toBe('missing');
    expect(evidence.accessPolicy).toBe('staff-only');
  });

  it('denies playback when audio bytes are missing and audits the request shape', () => {
    const result = resolveRequestPlayback({
      evidence: {
        audioStatus: 'missing',
        evidenceId: 'rev_1',
        legalHold: false,
        retentionUntilMs: nowMs + 1000,
        storagePath: '',
      },
      featureFlags: { voice_room_safety_recording: true },
      nowMs,
      operatorProfile: { role: 'super-moderator', status: 'active', uid: 'staff' },
      reason: 'review',
      senderUid: 'staff',
    });
    expect(result.ok).toBe(true);
    expect(result.value.playbackAvailable).toBe(false);
    expect(result.value.audioStatus).toBe('missing');
  });

  it('retains legal-hold evidence past default expiry', () => {
    expect(shouldDeleteExpiredEvidence({
      legalHold: true,
      retentionUntilMs: nowMs - 1,
    }, nowMs)).toBe(false);
    expect(shouldDeleteExpiredEvidence({
      legalHold: false,
      retentionUntilMs: nowMs - 1,
    }, nowMs)).toBe(true);
  });
});
