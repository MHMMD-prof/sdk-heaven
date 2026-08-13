import { useCallback, useEffect, useReducer, useRef } from 'react';

import { MiniGameTarget } from '../../types/miniGame';
import { BattleshipLaunch } from '../resolveBattleshipLaunch';
import {
  createBattleMessage,
  createControlMessage,
  createPlacementMessage,
  createSnapshotMessage,
  getBattlePayload,
  getControlPayload,
  getPlacementPayload,
  getSnapshotPayload,
} from '../transport/battleshipMessages';
import { createBattleshipTransport } from '../transport/createBattleshipTransport';
import {
  BattleshipConnection,
  BattleshipPresencePlayer,
  BattleshipTransport,
} from '../transport/types';
import { createFleetReadySeal } from './fleetCommitment';
import { clearOnlineFleet, loadOnlineFleet, saveOnlineFleet } from './onlineFleetStore';
import { resolveIncomingShot } from './onlineBattleCore';
import {
  createPublicBattleshipSnapshot,
  createAuthorityClaimGrace,
  hasOnlineMatchProgress,
  observePeersForAuthorityClaimGrace,
  PEER_ABSENT_INTERVALS_BEFORE_CLAIM,
  shouldClaimHostAfterAuthorityProbe,
  shouldDeferInstantHostClaimOnPresenceFlap,
  tickAuthorityClaimGraceOnProbe,
  syncPresenceWithHostTransfer,
} from './onlineReliability';
import {
  BattleshipOnlineEvent,
  BattleshipOnlinePlayer,
  bothFleetsReady,
  battleshipOnlineReducer,
  canStartOnlinePlacement,
  createBattleshipMessageId,
  createBattleshipOnlineStateFromLaunch,
  createBattleshipTransportLobbyViewModel,
} from './onlineSessionModel';

type UseBattleshipOnlineSessionOptions = {
  createTransport?: () => BattleshipTransport;
  enabled: boolean;
  firestoreMaxPlayers?: number;
  firestorePlayerCount?: number;
  firestoreStatus?: string;
  launch: BattleshipLaunch;
};

export function useBattleshipOnlineSession({
  createTransport = () => createBattleshipTransport('online'),
  enabled,
  firestoreMaxPlayers,
  firestorePlayerCount,
  firestoreStatus,
  launch,
}: UseBattleshipOnlineSessionOptions) {
  const [state, dispatch] = useReducer(
    battleshipOnlineReducer,
    launch,
    createBattleshipOnlineStateFromLaunch,
  );
  const stateRef = useRef(state);
  const sequenceRef = useRef(0);
  const connectionRef = useRef<BattleshipConnection | undefined>(undefined);
  const createTransportRef = useRef(createTransport);

  // Sync after commit only. Render-phase writes can wipe mid-handler stateRef updates.
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  createTransportRef.current = createTransport;

  const nextSequence = () => {
    sequenceRef.current += 1;
    return sequenceRef.current;
  };

  useEffect(() => {
    if (!enabled || !launch.isOnline || !launch.roomId || !launch.playerId || !launch.sessionId) {
      return undefined;
    }

    let isActive = true;
    const transport = createTransportRef.current();

    const applyEvent = (event: BattleshipOnlineEvent) => {
      const next = battleshipOnlineReducer(stateRef.current, event);
      stateRef.current = next;
      dispatch(event);
      return next;
    };

    let fleetHydration: Promise<void> = Promise.resolve();

    const restoreLocalFleetIfNeeded = async (matchId: string) => {
      const current = stateRef.current;
      if (current.localFleet || matchId.startsWith('pending-')) {
        return;
      }

      const stored = await loadOnlineFleet({
        matchId,
        playerId: launch.playerId,
      });
      if (!isActive || !stored || stateRef.current.localFleet) {
        return;
      }

      applyEvent({
        type: 'local-fleet-sealed',
        fleet: stored.fleet,
        seal: stored.seal,
      });
    };

    const queueFleetRestore = (matchId: string) => {
      fleetHydration = fleetHydration
        .catch(() => undefined)
        .then(() => restoreLocalFleetIfNeeded(matchId));
      return fleetHydration;
    };

    const canAcceptForeignAuthority = (senderId: string) => {
      const current = stateRef.current;
      return (
        !hasOnlineMatchProgress(current)
        && senderId !== current.localPlayerId
      );
    };

    const yieldToPeerHost = (hostId: string, matchId?: string) => {
      if (!canAcceptForeignAuthority(hostId)) {
        return stateRef.current;
      }
      return applyEvent({
        type: 'host-yielded',
        hostId,
        ...(matchId ? { matchId } : {}),
      });
    };

    const publishLobbyAnnounce = async (
      connection: BattleshipConnection,
      presencePlayers?: BattleshipPresencePlayer[],
    ) => {
      const current = stateRef.current;
      if (current.localPlayerId !== current.hostId) {
        return;
      }

      const playersForAnnounce: BattleshipOnlinePlayer[] = presencePlayers
        ? battleshipOnlineReducer(current, {
            type: 'apply-presence',
            displayName: launch.displayName,
            players: presencePlayers,
          }).players
        : current.players;

      const message = createControlMessage({
        matchId: current.matchId,
        messageId: createBattleshipMessageId(),
        senderId: current.localPlayerId,
        clientTime: Date.now(),
        sequence: nextSequence(),
        payload: {
          type: 'lobby-announce',
          matchId: current.matchId,
          hostId: current.hostId,
          players: playersForAnnounce.map((player) => ({
            id: player.id,
            displayName: player.displayName,
            joinedAt: player.joinedAt,
            isConnected: player.isConnected,
          })),
        },
      });

      applyEvent({
        type: 'apply-lobby-announce',
        hostId: current.hostId,
        matchId: current.matchId,
        players: playersForAnnounce,
      });
      await connection.publish(message);
    };

    const publishLobbyRequest = async (
      connection: BattleshipConnection,
      options?: { asProbe?: boolean },
    ) => {
      const current = stateRef.current;
      // Hosts normally do not request; remounter probes must be allowed while still claiming host.
      if (current.localPlayerId === current.hostId && !options?.asProbe) {
        return;
      }

      await connection.publish(
        createControlMessage({
          matchId: current.matchId,
          messageId: createBattleshipMessageId(),
          senderId: current.localPlayerId,
          clientTime: Date.now(),
          sequence: nextSequence(),
          payload: { type: 'lobby-request' },
        }),
      );
    };

    const publishPlacementStart = async (connection: BattleshipConnection) => {
      const current = stateRef.current;
      if (current.localPlayerId !== current.hostId) {
        return;
      }

      const now = Date.now();
      const message = createPlacementMessage({
        matchId: current.matchId,
        messageId: createBattleshipMessageId(),
        senderId: current.localPlayerId,
        clientTime: now,
        sequence: nextSequence(),
        payload: {
          type: 'placement-start',
          matchId: current.matchId,
          now,
        },
      });

      applyEvent({ type: 'placement-started', matchId: current.matchId });
      await connection.publish(message);
    };

    const publishBattleStart = async (connection: BattleshipConnection) => {
      const current = stateRef.current;
      if (current.localPlayerId !== current.hostId || current.phase === 'battle') {
        return;
      }
      if (!bothFleetsReady(current)) {
        return;
      }

      const now = Date.now();
      const firstPlayerId = current.hostId;
      const message = createPlacementMessage({
        matchId: current.matchId,
        messageId: createBattleshipMessageId(),
        senderId: current.localPlayerId,
        clientTime: now,
        sequence: nextSequence(),
        payload: {
          type: 'battle-start',
          matchId: current.matchId,
          firstPlayerId,
          now,
        },
      });

      applyEvent({
        type: 'battle-started',
        firstPlayerId,
        matchId: current.matchId,
        now,
      });
      await connection.publish(message);
    };

    const publishShotResolved = async (
      connection: BattleshipConnection,
      shot: ReturnType<typeof resolveIncomingShot>,
    ) => {
      const current = stateRef.current;
      const message = createBattleMessage({
        matchId: current.matchId,
        messageId: createBattleshipMessageId(),
        senderId: current.localPlayerId,
        clientTime: Date.now(),
        sequence: nextSequence(),
        payload: {
          type: 'shot-resolved',
          shotId: shot.shotId,
          cellId: shot.cellId,
          attackerId: shot.attackerId,
          result: shot.result,
          nextTurnPlayerId: shot.nextTurnPlayerId,
          ...(shot.sunkTargetId ? { sunkTargetId: shot.sunkTargetId } : {}),
          ...(shot.winnerId ? { winnerId: shot.winnerId } : {}),
        },
      });

      const next = applyEvent({ type: 'apply-shot-resolved', shot });
      if (shot.winnerId) {
        void clearOnlineFleet({
          matchId: next.matchId,
          playerId: next.localPlayerId,
        });
      }
      await connection.publish(message);
    };

    const publishPublicSnapshot = async (connection: BattleshipConnection) => {
      const current = stateRef.current;
      if (current.localPlayerId !== current.hostId) {
        return;
      }

      const snapshot = createPublicBattleshipSnapshot(current);
      const message = createSnapshotMessage({
        matchId: current.matchId,
        messageId: createBattleshipMessageId(),
        senderId: current.localPlayerId,
        clientTime: Date.now(),
        sequence: nextSequence(),
        payload: {
          type: 'public-snapshot',
          snapshot,
        },
      });

      // LiveKit does not echo; hosts keep local authority without applying their own snapshot.
      await connection.publish(message);
    };

    const publishSnapshotRequest = async (
      connection: BattleshipConnection,
      options?: { markRecovering?: boolean },
    ) => {
      if (options?.markRecovering !== false) {
        applyEvent({ type: 'recovering-snapshot-changed', isRecoveringSnapshot: true });
      }
      await connection.publish(
        createSnapshotMessage({
          matchId: stateRef.current.matchId,
          messageId: createBattleshipMessageId(),
          senderId: stateRef.current.localPlayerId,
          clientTime: Date.now(),
          sequence: nextSequence(),
          payload: { type: 'snapshot-request' },
        }),
      );
    };

    const maybeStartPlacement = async (connection: BattleshipConnection) => {
      const current = stateRef.current;
      if (current.localPlayerId !== current.hostId) {
        return;
      }
      if (canStartOnlinePlacement(current)) {
        await publishPlacementStart(connection);
        return;
      }
      if (current.phase === 'placement') {
        await publishPlacementStart(connection);
      }
      if (current.phase === 'battle' || bothFleetsReady(current)) {
        await publishBattleStart(connection);
      }
    };

    // First successful solo/established claim. Remounters must probe before claiming.
    let hasClaimedLobby = false;
    let claimProbeTimer: ReturnType<typeof setTimeout> | undefined;
    let authorityProbeAttempts = 0;
    let claimGrace = createAuthorityClaimGrace();
    const AUTHORITY_PROBE_MS = 2500;

    const clearClaimProbeTimer = () => {
      if (claimProbeTimer) {
        clearTimeout(claimProbeTimer);
        claimProbeTimer = undefined;
      }
    };

    const clearRecoveringSnapshot = () => {
      if (stateRef.current.isRecoveringSnapshot) {
        applyEvent({ type: 'recovering-snapshot-changed', isRecoveringSnapshot: false });
      }
    };

    const notePeersConnected = (peersConnected: boolean) => {
      claimGrace = observePeersForAuthorityClaimGrace(claimGrace, peersConnected);
    };

    const claimHostAuthority = async (
      connection: BattleshipConnection,
      presencePlayers?: BattleshipPresencePlayer[],
    ) => {
      const current = stateRef.current;
      if (current.localPlayerId !== current.hostId) {
        return;
      }
      hasClaimedLobby = true;
      clearClaimProbeTimer();
      clearRecoveringSnapshot();
      claimGrace = createAuthorityClaimGrace();
      await publishLobbyAnnounce(connection, presencePlayers);
      await maybeStartPlacement(connection);
    };

    const probeForExistingAuthority = async (connection: BattleshipConnection) => {
      authorityProbeAttempts += 1;
      await publishLobbyRequest(connection, { asProbe: true });
      // Only the first probe marks recovering so re-probes do not pin the lobby UI.
      await publishSnapshotRequest(connection, {
        markRecovering: authorityProbeAttempts === 1,
      });
    };

    const scheduleClaimIfProbeFails = (connection: BattleshipConnection) => {
      if (claimProbeTimer || hasClaimedLobby) {
        return;
      }
      claimProbeTimer = setTimeout(() => {
        claimProbeTimer = undefined;
        if (!isActive) {
          return;
        }
        const current = stateRef.current;
        const peersConnected = current.players.some(
          (player) => player.id !== current.localPlayerId && player.isConnected,
        );
        claimGrace = tickAuthorityClaimGraceOnProbe(claimGrace, peersConnected);

        const canClaim = shouldClaimHostAfterAuthorityProbe({
          consecutivePeerAbsentIntervals: claimGrace.consecutivePeerAbsentIntervals,
          hasClaimedLobby,
          hasMatchProgress: hasOnlineMatchProgress(current),
          isLocalHost: current.localPlayerId === current.hostId,
          peersConnected,
          requiredAbsentIntervals: PEER_ABSENT_INTERVALS_BEFORE_CLAIM,
        });

        if (canClaim) {
          void claimHostAuthority(connection);
          return;
        }

        if (
          current.localPlayerId === current.hostId
          && !hasClaimedLobby
          && !hasOnlineMatchProgress(current)
        ) {
          if (peersConnected) {
            // Peer still present: keep probing, never force-claim over them.
            void probeForExistingAuthority(connection);
          }
          // Alone but grace not satisfied yet: wait another interval.
          scheduleClaimIfProbeFails(connection);
          return;
        }

        clearRecoveringSnapshot();
      }, AUTHORITY_PROBE_MS);
    };

    const claimOrProbeHostAuthority = async (connection: BattleshipConnection) => {
      const current = stateRef.current;
      if (current.localPlayerId !== current.hostId) {
        await publishLobbyRequest(connection);
        await publishSnapshotRequest(connection);
        return;
      }

      const peersConnected = current.players.some(
        (player) => player.id !== current.localPlayerId && player.isConnected,
      );
      notePeersConnected(peersConnected);
      // Remounter / late host: probe existing authority instead of claiming over it.
      if (peersConnected && !hasOnlineMatchProgress(current) && !hasClaimedLobby) {
        await probeForExistingAuthority(connection);
        scheduleClaimIfProbeFails(connection);
        return;
      }

      // True solo bootstrap (never saw a peer): claim immediately.
      // If we already saw a peer, require absent-interval grace instead of one empty tick.
      if (
        !peersConnected
        && claimGrace.sawPeerWhileUnclaimed
        && !hasClaimedLobby
      ) {
        scheduleClaimIfProbeFails(connection);
        return;
      }

      await claimHostAuthority(connection);
    };

    const connect = async () => {
      applyEvent({ type: 'connection-status-changed', status: 'connecting' });

      try {
        const connection = await transport.connect({
          roomId: launch.roomId,
          playerId: launch.playerId,
          displayName: launch.displayName,
          sessionId: launch.sessionId,
          matchId: stateRef.current.matchId,
        });

        if (!isActive) {
          await connection.disconnect();
          return;
        }

        connectionRef.current = connection;
        applyEvent({ type: 'connection-status-changed', status: 'connected' });
        applyEvent({ type: 'ensure-local-player', displayName: launch.displayName });

        connection.onPresence((players) => {
          if (!isActive) {
            return;
          }

          const before = stateRef.current;
          const synced = syncPresenceWithHostTransfer({
            localDisplayName: launch.displayName,
            localPlayerId: launch.playerId,
            players,
            state: before,
          });
          applyEvent({
            type: 'apply-presence',
            displayName: launch.displayName,
            players,
          });

          if (synced.state.localPlayerId === synced.state.hostId) {
            const peersConnected = players.some(
              (player) => player.id !== launch.playerId && player.isConnected !== false,
            );
            notePeersConnected(peersConnected);
            // Remounter: probe only until peer authority is adopted (or probe times out).
            if (
              peersConnected
              && !hasOnlineMatchProgress(stateRef.current)
              && !hasClaimedLobby
            ) {
              // Avoid stacking probes on every presence tick while a timer is already armed.
              if (!claimProbeTimer) {
                void probeForExistingAuthority(connection);
                scheduleClaimIfProbeFails(connection);
              }
              return;
            }

            // Presence flap: do not instant-claim on one empty peer tick after we saw a peer.
            if (
              shouldDeferInstantHostClaimOnPresenceFlap({
                hasClaimedLobby,
                hasMatchProgress: hasOnlineMatchProgress(stateRef.current),
                peersConnected,
                sawPeerWhileUnclaimed: claimGrace.sawPeerWhileUnclaimed,
              })
            ) {
              if (!claimProbeTimer) {
                scheduleClaimIfProbeFails(connection);
              }
              return;
            }

            void claimHostAuthority(connection, players)
              .then(() => {
                if (stateRef.current.phase !== 'lobby' || synced.becameHost) {
                  return publishPublicSnapshot(connection);
                }
                return undefined;
              });
          } else if (
            stateRef.current.matchId.startsWith('pending-')
            || stateRef.current.isRecoveringSnapshot
            || !stateRef.current.opponentConnected
            || stateRef.current.phase !== 'lobby'
          ) {
            if (players.some((player) => player.id === stateRef.current.hostId)) {
              void publishLobbyRequest(connection).then(() => publishSnapshotRequest(connection));
            }
          }
        });

        connection.onMessage((message) => {
          if (!isActive) {
            return;
          }

          if (message.senderId === launch.playerId) {
            return;
          }

          const control = getControlPayload(message);
          if (control) {
            if (control.type === 'lobby-announce') {
              if (message.senderId !== control.hostId) {
                return;
              }
              // Remounter still claiming host must yield before announce apply.
              if (
                stateRef.current.localPlayerId === stateRef.current.hostId
                && control.hostId !== launch.playerId
                && canAcceptForeignAuthority(control.hostId)
              ) {
                yieldToPeerHost(control.hostId, control.matchId);
                clearClaimProbeTimer();
                clearRecoveringSnapshot();
              }
              applyEvent({
                type: 'apply-lobby-announce',
                hostId: control.hostId,
                matchId: control.matchId,
                players: control.players,
              });
              if (!stateRef.current.matchId.startsWith('pending-')) {
                clearRecoveringSnapshot();
              }
              void queueFleetRestore(stateRef.current.matchId);
              return;
            }

            if (control.type === 'lobby-request') {
              const current = stateRef.current;
              if (current.localPlayerId === current.hostId) {
                // Marks claimed so presence stops probe-looping once a joiner asks for lobby.
                void claimHostAuthority(connection)
                  .then(() => publishPublicSnapshot(connection));
              }
            }
            return;
          }

          const placement = getPlacementPayload(message);
          if (placement) {
            if (placement.type === 'placement-start') {
              if (message.senderId !== stateRef.current.hostId) {
                if (!canAcceptForeignAuthority(message.senderId)) {
                  return;
                }
                yieldToPeerHost(message.senderId, placement.matchId);
                clearClaimProbeTimer();
                clearRecoveringSnapshot();
              }
              applyEvent({ type: 'placement-started', matchId: placement.matchId });
              void queueFleetRestore(placement.matchId);
              return;
            }

            if (placement.type === 'fleet-ready') {
              const current = applyEvent({
                type: 'peer-fleet-ready',
                playerId: message.senderId,
                seal: placement.seal,
              });
              if (current.localPlayerId === current.hostId) {
                void publishBattleStart(connection);
              }
              return;
            }

            if (placement.type === 'battle-start') {
              if (message.senderId !== stateRef.current.hostId) {
                if (!canAcceptForeignAuthority(message.senderId)) {
                  return;
                }
                yieldToPeerHost(message.senderId, placement.matchId);
                clearClaimProbeTimer();
                clearRecoveringSnapshot();
              }
              applyEvent({
                type: 'battle-started',
                firstPlayerId: placement.firstPlayerId,
                matchId: placement.matchId,
                now: placement.now,
              });
              void queueFleetRestore(placement.matchId);
            }
            return;
          }

          const battle = getBattlePayload(message);
          if (battle) {
            if (battle.type === 'shot-fired') {
              void fleetHydration
                .catch(() => undefined)
                .then(async () => {
                  if (!isActive) {
                    return;
                  }
                  await queueFleetRestore(stateRef.current.matchId);
                  const current = stateRef.current;
                  if (
                    current.phase !== 'battle'
                    || current.winnerId
                    || !current.localFleet
                    || message.senderId === current.localPlayerId
                    || current.currentTurnPlayerId !== message.senderId
                    || current.incomingResults[battle.cellId]
                  ) {
                    return;
                  }

                  applyEvent({
                    type: 'note-open-shot',
                    openShot: {
                      attackerId: message.senderId,
                      cellId: battle.cellId,
                      shotId: battle.shotId,
                    },
                  });

                  try {
                    const resolved = resolveIncomingShot({
                      attackerId: message.senderId,
                      cellId: battle.cellId,
                      defenderId: current.localPlayerId,
                      incomingGuesses: new Set(Object.keys(current.incomingResults)),
                      localFleet: current.localFleet,
                      shotId: battle.shotId,
                    });
                    await publishShotResolved(connection, resolved);
                    if (stateRef.current.localPlayerId === stateRef.current.hostId) {
                      await publishPublicSnapshot(connection);
                    }
                  } catch {
                    // Ignore duplicate / invalid resolve attempts.
                  }
                });
              return;
            }

            if (battle.type === 'shot-resolved') {
              const current = stateRef.current;
              // Inbound resolves are for the attacker; only the defender may author them.
              if (battle.attackerId !== current.localPlayerId) {
                return;
              }
              const defenderId = current.players.find(
                (player) => player.id !== current.localPlayerId,
              )?.id;
              if (!defenderId || message.senderId !== defenderId) {
                return;
              }

              const next = applyEvent({
                type: 'apply-shot-resolved',
                shot: {
                  attackerId: battle.attackerId,
                  cellId: battle.cellId,
                  nextTurnPlayerId: battle.nextTurnPlayerId,
                  result: battle.result,
                  shotId: battle.shotId,
                  ...(battle.sunkTargetId ? { sunkTargetId: battle.sunkTargetId } : {}),
                  ...(battle.winnerId ? { winnerId: battle.winnerId } : {}),
                },
              });
              if (next.winnerId) {
                void clearOnlineFleet({
                  matchId: next.matchId,
                  playerId: next.localPlayerId,
                });
              }
            }
            return;
          }

          const snapshotPayload = getSnapshotPayload(message);
          if (!snapshotPayload) {
            return;
          }

          if (snapshotPayload.type === 'snapshot-request') {
            if (stateRef.current.localPlayerId === stateRef.current.hostId) {
              void publishPublicSnapshot(connection);
            }
            return;
          }

          if (snapshotPayload.type === 'public-snapshot') {
            const snapshot = snapshotPayload.snapshot;
            const fromHost = message.senderId === stateRef.current.hostId;
            const foreignAuthority =
              message.senderId === snapshot.hostId
              && canAcceptForeignAuthority(message.senderId)
              && (
                stateRef.current.matchId.startsWith('pending-')
                || snapshot.phase === 'placement'
                || snapshot.phase === 'battle'
                || Object.keys(snapshot.readySeals).length > 0
              );
            if (!fromHost && !foreignAuthority) {
              return;
            }
            if (!fromHost && foreignAuthority) {
              yieldToPeerHost(snapshot.hostId, snapshot.matchId);
              clearClaimProbeTimer();
              clearRecoveringSnapshot();
            }
            const next = applyEvent({
              type: 'apply-public-snapshot',
              displayName: launch.displayName,
              snapshot,
            });
            void queueFleetRestore(next.matchId);
          }
        });

        await claimOrProbeHostAuthority(connection);
      } catch (error) {
        if (!isActive) {
          return;
        }

        applyEvent({
          type: 'connection-status-changed',
          status: 'error',
          error: error instanceof Error ? error.message : 'Naval Duel transport failed.',
        });
      }
    };

    void connect();

    return () => {
      isActive = false;
      clearClaimProbeTimer();
      const connection = connectionRef.current;
      connectionRef.current = undefined;
      void connection?.disconnect();
      dispatch({ type: 'connection-status-changed', status: 'disconnected' });
    };
  }, [
    enabled,
    launch.displayName,
    launch.hostUid,
    launch.isOnline,
    launch.playerId,
    launch.roomId,
    launch.sessionId,
  ]);

  const sealLocalFleet = useCallback(async (fleet: MiniGameTarget[]) => {
    const connection = connectionRef.current;
    const current = stateRef.current;
    if (!connection || current.phase !== 'placement' || current.localReady) {
      return;
    }

    const seal = await createFleetReadySeal(fleet);
    const message = createPlacementMessage({
      matchId: current.matchId,
      messageId: createBattleshipMessageId(),
      senderId: current.localPlayerId,
      clientTime: Date.now(),
      sequence: nextSequence(),
      payload: {
        type: 'fleet-ready',
        seal,
      },
    });

    const nextState = battleshipOnlineReducer(current, {
      type: 'local-fleet-sealed',
      fleet,
      seal,
    });
    stateRef.current = nextState;
    dispatch({
      type: 'local-fleet-sealed',
      fleet,
      seal,
    });
    void saveOnlineFleet({
      fleet,
      matchId: nextState.matchId,
      playerId: nextState.localPlayerId,
      seal,
    });
    await connection.publish(message);

    if (nextState.localPlayerId === nextState.hostId && bothFleetsReady(nextState)) {
      const now = Date.now();
      const firstPlayerId = nextState.hostId;
      const battleMessage = createPlacementMessage({
        matchId: nextState.matchId,
        messageId: createBattleshipMessageId(),
        senderId: nextState.localPlayerId,
        clientTime: now,
        sequence: nextSequence(),
        payload: {
          type: 'battle-start',
          matchId: nextState.matchId,
          firstPlayerId,
          now,
        },
      });
      const afterBattle = battleshipOnlineReducer(nextState, {
        type: 'battle-started',
        firstPlayerId,
        matchId: nextState.matchId,
        now,
      });
      stateRef.current = afterBattle;
      dispatch({
        type: 'battle-started',
        firstPlayerId,
        matchId: nextState.matchId,
        now,
      });
      await connection.publish(battleMessage);
    }
  }, []);

  const fireShot = useCallback(async (cellId: string) => {
    const connection = connectionRef.current;
    const current = stateRef.current;
    if (
      !connection
      || current.phase !== 'battle'
      || current.winnerId
      || current.currentTurnPlayerId !== current.localPlayerId
      || current.pendingShotId
      || current.outgoingResults[cellId]
    ) {
      return;
    }

    const shotId = createBattleshipMessageId();
    const message = createBattleMessage({
      matchId: current.matchId,
      messageId: createBattleshipMessageId(),
      senderId: current.localPlayerId,
      clientTime: Date.now(),
      sequence: nextSequence(),
      payload: {
        type: 'shot-fired',
        shotId,
        cellId,
      },
    });

    dispatch({ type: 'shot-fired-local', cellId, shotId });
    stateRef.current = battleshipOnlineReducer(current, {
      type: 'shot-fired-local',
      cellId,
      shotId,
    });
    await connection.publish(message);
  }, []);

  const lobby = createBattleshipTransportLobbyViewModel({
    firestoreMaxPlayers,
    firestorePlayerCount,
    firestoreStatus,
    launch,
    state,
  });

  return {
    fireShot,
    lobby,
    sealLocalFleet,
    state,
  };
}
