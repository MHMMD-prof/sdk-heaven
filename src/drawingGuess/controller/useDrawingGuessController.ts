import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import {
  advanceToNextRound,
  drawingGuessReducer,
  shouldAutoEndRound,
} from '../model/drawingGuessReducer';
import { getPromptAnswers, normalizeGuess } from '../model/guessNormalization';
import { chunkSnapshot, DrawingGuessSnapshotReassembler } from '../model/snapshot';
import { DrawingGuessPrompt, DrawingGuessSnapshot, DrawingPoint, DrawingStroke } from '../model/types';
import { getPromptById } from '../model/wordBank';
import { DrawingTool } from '../rendering/drawingTools';
import {
  createControlMessage,
  createGuessMessage,
  createSnapshotChunkMessage,
  createStrokeCommitMessage,
  createStrokePreviewMessage,
  getSnapshotChunkFromMessage,
  getStrokePreviewFromMessage,
  mapInboundMessageToReducerEvent,
} from '../transport/drawingGuessMessages';
import { createDrawingGuessTransport } from '../transport/createDrawingGuessTransport';
import { DrawingGuessConnection } from '../transport/types';
import {
  appendPointToActiveStroke,
  cancelActiveDrawingStroke,
  commitActiveDrawingStroke,
  createActiveDrawingStroke,
  createCommittedDrawingStrokeFromPoints,
} from './activeStrokeModel';
import {
  createDrawingGuessGuessId,
  createDrawingGuessMatchId,
  createDrawingGuessMessageId,
  createDrawingGuessStrokeId,
} from './createDrawingGuessIds';
import { createDrawingGuessRoomCode } from './createDrawingGuessRoomCode';
import {
  createDefaultDrawingToolState,
  createDrawingGuessViewModel,
  createLocalSimulatedDrawingGuessState,
  createOnlineDrawingGuessState,
} from './drawingGuessControllerModel';
import { DrawingGuessController, DrawingGuessRouteParams } from './drawingGuessControllerTypes';
import { resolveDrawingGuessLaunch } from './resolveDrawingGuessLaunch';
import {
  applyRemoteStrokePreview,
  clearRemoteStrokePreviews,
  createStrokePreviewPayload,
  initialStrokePreviewThrottleState,
  markStrokePreviewPublished,
  RemotePreviewStrokeMap,
  removeRemoteStrokePreview,
  shouldPublishStrokePreviewUpdate,
  StrokePreviewThrottleState,
} from './strokePreviewModel';

export function useDrawingGuessController(
  params: DrawingGuessRouteParams | undefined,
  onLeave: () => void,
): DrawingGuessController {
  const initialLaunch = useMemo(() => resolveDrawingGuessLaunch(params), [params]);
  const initialRoomCode = initialLaunch.roomCode;
  const initialMode = initialLaunch.mode;
  const localPlayerId = initialLaunch.playerId;
  const localDisplayName = initialLaunch.displayName;
  const gameSessionId = initialLaunch.sessionId;
  const [launchSource, setLaunchSource] = useState(initialLaunch.source);
  const [launchTitle, setLaunchTitle] = useState(initialLaunch.title);
  const [launchSubtitle, setLaunchSubtitle] = useState(initialLaunch.subtitle);
  const [roomCode, setRoomCode] = useState(initialRoomCode);
  const [mode, setMode] = useState(initialMode);
  const [now, setNow] = useState(() => Date.now());
  const [activeStroke, setActiveStroke] = useState<DrawingStroke | undefined>();
  const [remotePreviewStrokes, setRemotePreviewStrokes] = useState<RemotePreviewStrokeMap>({});
  const [isRecoveringSnapshot, setIsRecoveringSnapshot] = useState(false);
  const [lastTransportError, setLastTransportError] = useState<string | undefined>();
  const [toolState, setToolState] = useState(createDefaultDrawingToolState);
  const transportRef = useRef(createDrawingGuessTransport(initialMode));
  const localConnectionRef = useRef<DrawingGuessConnection | undefined>(undefined);
  const simulatedConnectionRefs = useRef<Record<string, DrawingGuessConnection>>({});
  const connectionsRef = useRef<DrawingGuessConnection[]>([]);
  const stateRef = useRef(
    createInitialState(initialRoomCode, initialMode, localPlayerId),
  );
  const sequenceRef = useRef(0);
  const previewThrottleRef = useRef<StrokePreviewThrottleState>(initialStrokePreviewThrottleState);
  const activePreviewStrokeIdRef = useRef<string | undefined>(undefined);
  const snapshotReassemblerRef = useRef(new DrawingGuessSnapshotReassembler());
  const showcaseAutomationRef = useRef<string | undefined>(undefined);
  const [state, dispatch] = useReducer(
    drawingGuessReducer,
    stateRef.current,
  );

  const nextSequence = useCallback(() => {
    sequenceRef.current += 1;
    return sequenceRef.current;
  }, []);

  const publishSnapshotChunks = useCallback(
    async (snapshotId: string) => {
      const connection = localConnectionRef.current;

      if (!connection) {
        return;
      }

      const snapshot: DrawingGuessSnapshot = {
        schemaVersion: 1,
        state: stateRef.current,
        createdAt: Date.now(),
      };
      const chunks = chunkSnapshot(snapshotId, snapshot);

      for (const chunk of chunks) {
        await connection.publish(
          createSnapshotChunkMessage({
            matchId: stateRef.current.matchId,
            messageId: createDrawingGuessMessageId(),
            senderId: localPlayerId,
            clientTime: Date.now(),
            sequence: nextSequence(),
            payload: {
              type: 'snapshot-chunk',
              chunk,
            },
          }),
        );
      }
    },
    [nextSequence],
  );

  const publishStrokePreview = useCallback(
    async (stroke: DrawingStroke, status: Parameters<typeof createStrokePreviewPayload>[1]) => {
      const connection = localConnectionRef.current;

      if (!connection) {
        return;
      }

      try {
        await connection.publish(
          createStrokePreviewMessage({
            matchId: stateRef.current.matchId,
            messageId: createDrawingGuessMessageId(),
            senderId: stroke.authorId,
            clientTime: Date.now(),
            sequence: nextSequence(),
            payload: createStrokePreviewPayload(stroke, status),
          }),
        );
      } catch (error) {
        setLastTransportError(error instanceof Error ? error.message : 'Drawing Guess preview failed.');
      }
    },
    [nextSequence],
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let isActive = true;

    const connectSimulation = async () => {
      await Promise.all(connectionsRef.current.map((connection) => connection.disconnect()));
      connectionsRef.current = [];

      try {
        setLastTransportError(undefined);
        transportRef.current = createDrawingGuessTransport(mode);
        dispatch({
          type: 'connection-status-changed',
          status: 'connecting',
        });

        const localConnection = await transportRef.current.connect({
          roomId: roomCode,
          playerId: localPlayerId,
          displayName: localDisplayName,
          ...(gameSessionId ? { sessionId: gameSessionId } : {}),
        });
        const simConnectionOne =
          mode === 'local-simulated'
            ? await transportRef.current.connect({
                roomId: roomCode,
                playerId: 'dg-player-sim-1',
                displayName: 'Maha',
              })
            : undefined;
        const simConnectionTwo =
          mode === 'local-simulated'
            ? await transportRef.current.connect({
                roomId: roomCode,
                playerId: 'dg-player-sim-2',
                displayName: 'Omar',
              })
            : undefined;

        if (!isActive) {
          await localConnection.disconnect();
          await simConnectionOne?.disconnect();
          await simConnectionTwo?.disconnect();
          return;
        }

        localConnection.onPresence((players) => {
          players.forEach((player, index) => {
            dispatch({
              type: 'player-joined',
              player: {
                id: player.id,
                displayName: player.displayName,
                avatarLabel: player.displayName.trim().charAt(0) || '?',
                role: 'player',
                joinedAt: player.joinedAt || Date.now() + index,
                isConnected: player.isConnected,
              },
            });
          });
        });

        localConnection.onMessage((message) => {
          const preview = getStrokePreviewFromMessage(message);

          if (preview) {
            if (message.senderId !== localPlayerId) {
              setRemotePreviewStrokes((currentPreviews) =>
                applyRemoteStrokePreview({
                  canvasRevision: stateRef.current.canvasRevision,
                  drawerId: stateRef.current.drawerId,
                  payload: preview,
                  previews: currentPreviews,
                }),
              );
            }
            return;
          }

          const chunk = getSnapshotChunkFromMessage(message);

          if (chunk) {
            try {
              const snapshot = snapshotReassemblerRef.current.pushChunk(chunk, Date.now());

              if (snapshot) {
                setIsRecoveringSnapshot(false);
                setRemotePreviewStrokes(clearRemoteStrokePreviews());
                dispatch({ type: 'apply-snapshot', state: snapshot.state });
              }
            } catch (error) {
              setIsRecoveringSnapshot(false);
              setLastTransportError(
                error instanceof Error ? error.message : 'Drawing Guess snapshot failed.',
              );
            }
            return;
          }

          const event = mapInboundMessageToReducerEvent(message);

          if (event) {
            if (event.type === 'commit-stroke') {
              setRemotePreviewStrokes((currentPreviews) =>
                removeRemoteStrokePreview(currentPreviews, event.stroke.id),
              );
            }

            if (
              event.type === 'clear-canvas' ||
              event.type === 'end-round' ||
              event.type === 'finish-match' ||
              event.type === 'apply-snapshot'
            ) {
              setRemotePreviewStrokes(clearRemoteStrokePreviews());
            }

            dispatch(event);
          }

          if (message.topic === 'dg.v1.control') {
            const payload = message.payload as { type?: string; snapshotId?: string };

            if (payload.type === 'snapshot-request' && stateRef.current.hostId === localPlayerId) {
              void publishSnapshotChunks(payload.snapshotId ?? createDrawingGuessMessageId());
            }
          }
        });

        connectionsRef.current = [
          localConnection,
          ...(simConnectionOne ? [simConnectionOne] : []),
          ...(simConnectionTwo ? [simConnectionTwo] : []),
        ];
        localConnectionRef.current = localConnection;
        dispatch({
          type: 'connection-status-changed',
          status: 'connected',
        });
        simulatedConnectionRefs.current = {
          ...(simConnectionOne ? { [simConnectionOne.localPlayerId]: simConnectionOne } : {}),
          ...(simConnectionTwo ? { [simConnectionTwo.localPlayerId]: simConnectionTwo } : {}),
        };

        if (mode === 'online') {
          setIsRecoveringSnapshot(true);
          await localConnection.publish(
            createControlMessage({
              matchId: stateRef.current.matchId,
              messageId: createDrawingGuessMessageId(),
              senderId: localPlayerId,
              clientTime: Date.now(),
              sequence: nextSequence(),
              payload: {
                type: 'snapshot-request',
                snapshotId: createDrawingGuessMessageId(),
              },
            }),
          );
        }
      } catch (error) {
        setLastTransportError(
          error instanceof Error ? error.message : 'Drawing Guess online connection failed.',
        );
      }
    };

    void connectSimulation();

    return () => {
      isActive = false;
      void Promise.all(connectionsRef.current.map((connection) => connection.disconnect()));
      connectionsRef.current = [];
      localConnectionRef.current = undefined;
      simulatedConnectionRefs.current = {};
    };
  }, [
    gameSessionId,
    localDisplayName,
    localPlayerId,
    mode,
    nextSequence,
    publishSnapshotChunks,
    roomCode,
  ]);

  const publishControl = useCallback(
    async (payload: Parameters<typeof createControlMessage>[0]['payload']) => {
      const connection = localConnectionRef.current;

      if (!connection) {
        setLastTransportError('Drawing Guess mock transport is not connected.');
        return;
      }

      try {
        setLastTransportError(undefined);
        await connection.publish(
          createControlMessage({
            matchId: stateRef.current.matchId,
            messageId: createDrawingGuessMessageId(),
            senderId: localPlayerId,
            clientTime: Date.now(),
            sequence: nextSequence(),
            payload,
          }),
        );
      } catch (error) {
        setLastTransportError(error instanceof Error ? error.message : 'Drawing Guess publish failed.');
      }
    },
    [nextSequence],
  );

  const publishControlAs = useCallback(
    async (
      senderId: string,
      payload: Parameters<typeof createControlMessage>[0]['payload'],
    ) => {
      const connection =
        senderId === localPlayerId
          ? localConnectionRef.current
          : simulatedConnectionRefs.current[senderId];

      if (!connection) {
        setLastTransportError('Drawing Guess mock transport is not connected.');
        return;
      }

      try {
        setLastTransportError(undefined);
        await connection.publish(
          createControlMessage({
            matchId: stateRef.current.matchId,
            messageId: createDrawingGuessMessageId(),
            senderId,
            clientTime: Date.now(),
            sequence: nextSequence(),
            payload,
          }),
        );
      } catch (error) {
        setLastTransportError(error instanceof Error ? error.message : 'Drawing Guess publish failed.');
      }
    },
    [nextSequence],
  );

  useEffect(() => {
    const autoEnd = shouldAutoEndRound(state, now);

    if (
      !autoEnd.shouldEnd ||
      autoEnd.reason !== 'timer' ||
      state.hostId !== localPlayerId
    ) {
      return;
    }

    setRemotePreviewStrokes(clearRemoteStrokePreviews());
    void publishControl({
      type: 'round-ended',
      now,
      reason: 'timer',
    });
  }, [now, publishControl, state.hostId, state.phase, state.roundEndsAt]);

  const resetRoom = useCallback((nextRoomCode: string, nextMode = mode) => {
    setRoomCode(nextRoomCode);
    setMode(nextMode);
    setActiveStroke(undefined);
    setRemotePreviewStrokes(clearRemoteStrokePreviews());
    showcaseAutomationRef.current = undefined;
    setIsRecoveringSnapshot(nextMode === 'online');
    dispatch({
      type: 'apply-snapshot',
      state: createInitialState(nextRoomCode, nextMode, localPlayerId),
    });
  }, [mode]);

  const viewModel = useMemo(
    () =>
      createDrawingGuessViewModel({
        activeStroke,
        state,
        roomCode,
        localPlayerId,
        now,
        previewStrokes: Object.values(remotePreviewStrokes),
        isRecoveringSnapshot,
        lastTransportError,
        launchSource,
        launchSubtitle,
        launchTitle,
        transportMode: mode === 'online' ? 'livekit' : 'mock',
        toolState,
      }),
    [
      activeStroke,
      isRecoveringSnapshot,
      lastTransportError,
      launchSource,
      launchSubtitle,
      launchTitle,
      mode,
      now,
      remotePreviewStrokes,
      roomCode,
      state,
      toolState,
    ],
  );

  const startMatch = useCallback(() => {
    void publishControl({
      type: 'start-match-applied',
      matchId: createDrawingGuessMatchId(),
      now: Date.now(),
    });
  }, [publishControl]);

  const choosePrompt = useCallback((promptId: string) => {
    const prompt = getPromptById(promptId);

    if (!prompt) {
      return;
    }

    void publishControl({
      type: 'prompt-selected',
      prompt,
      now: Date.now(),
    });
  }, [publishControl]);

  const submitGuess = useCallback((text: string) => {
    const trimmedText = text.trim();

    if (!trimmedText) {
      return;
    }

    const connection = localConnectionRef.current;

    if (!connection) {
      setLastTransportError('Drawing Guess mock transport is not connected.');
      return;
    }

    void connection.publish(
      createGuessMessage({
        matchId: stateRef.current.matchId,
        messageId: createDrawingGuessMessageId(),
        senderId: localPlayerId,
        clientTime: Date.now(),
        sequence: nextSequence(),
        payload: {
          type: 'guess-submitted',
          guessId: createDrawingGuessGuessId(),
          text: trimmedText,
        },
      }),
    );
  }, [nextSequence]);

  const submitSimulatedCorrectGuess = useCallback(() => {
    const prompt = state.privatePrompt;
    const guesser = state.players.find(
      (player) => player.id !== state.drawerId && !state.correctGuessPlayerIds.includes(player.id),
    );

    if (!prompt || !guesser) {
      return;
    }

    const connection = simulatedConnectionRefs.current[guesser.id];

    if (!connection) {
      return;
    }

    void connection.publish(
      createGuessMessage({
        matchId: stateRef.current.matchId,
        messageId: createDrawingGuessMessageId(),
        senderId: guesser.id,
        clientTime: Date.now(),
        sequence: nextSequence(),
        payload: {
          type: 'guess-submitted',
          guessId: createDrawingGuessGuessId(),
          text: prompt.text,
        },
      }),
    );
  }, [nextSequence, state.correctGuessPlayerIds, state.drawerId, state.players, state.privatePrompt]);

  const submitSimulatedGuess = useCallback(
    (playerId: string, text: string) => {
      const connection = simulatedConnectionRefs.current[playerId];

      if (!connection) {
        return;
      }

      void connection.publish(
        createGuessMessage({
          matchId: stateRef.current.matchId,
          messageId: createDrawingGuessMessageId(),
          senderId: playerId,
          clientTime: Date.now(),
          sequence: nextSequence(),
          payload: {
            type: 'guess-submitted',
            guessId: createDrawingGuessGuessId(),
            text,
          },
        }),
      );
    },
    [nextSequence],
  );

  const commitSampleStroke = useCallback(
    (tool: DrawingStroke['tool']) => {
      if (!state.drawerId) {
        return;
      }

      const connection =
        state.drawerId === localPlayerId
          ? localConnectionRef.current
          : simulatedConnectionRefs.current[state.drawerId];

      void connection?.publish(
        createStrokeCommitMessage({
          matchId: stateRef.current.matchId,
          messageId: createDrawingGuessMessageId(),
          senderId: state.drawerId,
          clientTime: Date.now(),
          sequence: nextSequence(),
          payload: {
            type: 'stroke-committed',
            stroke: {
          id: createDrawingGuessStrokeId(),
          authorId: state.drawerId,
          tool,
          color: tool === 'eraser' ? '#F7F2E8' : '#D7A54A',
          width: tool === 'eraser' ? 18 : 8,
          points: [
            { x: 0.18, y: 0.28 },
            { x: 0.36, y: 0.42 },
            { x: 0.58, y: 0.36 },
            { x: 0.78, y: 0.6 },
          ],
          createdAt: Date.now(),
          revision: state.canvasRevision,
            },
          },
        }),
      );
    },
    [nextSequence, state.canvasRevision, state.drawerId],
  );

  useEffect(() => {
    const isShowcaseMode = mode === 'local-simulated' && launchSource === 'games';

    if (
      !isShowcaseMode ||
      state.phase !== 'prompt-select' ||
      !state.drawerId ||
      state.drawerId === localPlayerId
    ) {
      return;
    }

    const prompt = state.promptOptions[0];

    if (!prompt) {
      return;
    }

    const automationKey = `${state.matchId}:${state.roundNumber}:${state.drawerId}:prompt`;
    const drawerId = state.drawerId;

    if (showcaseAutomationRef.current === automationKey) {
      return;
    }

    showcaseAutomationRef.current = automationKey;
    void publishControlAs(drawerId, {
      type: 'prompt-selected',
      prompt,
      now: Date.now(),
    });
  }, [
    launchSource,
    mode,
    publishControlAs,
    state.drawerId,
    state.matchId,
    state.phase,
    state.promptOptions,
    state.roundNumber,
  ]);

  useEffect(() => {
    const isShowcaseMode = mode === 'local-simulated' && launchSource === 'games';

    if (!isShowcaseMode || state.phase !== 'drawing' || !state.privatePrompt || !state.drawerId) {
      return;
    }

    const automationKey = `${state.matchId}:${state.roundNumber}:${state.drawerId}:${state.canvasRevision}:drawing`;

    if (showcaseAutomationRef.current === automationKey) {
      return;
    }

    showcaseAutomationRef.current = automationKey;

    if (state.drawerId === localPlayerId) {
      submitSimulatedGuess('dg-player-sim-1', getLocalShowcaseWrongGuess(state.privatePrompt));
      return;
    }

    commitSampleStroke('brush');
  }, [
    commitSampleStroke,
    launchSource,
    mode,
    state.canvasRevision,
    state.drawerId,
    state.matchId,
    state.phase,
    state.privatePrompt,
    state.roundNumber,
    submitSimulatedGuess,
  ]);

  const beginStroke = useCallback(
    (point: DrawingPoint) => {
      if (state.phase !== 'drawing' || state.drawerId !== localPlayerId) {
        return;
      }

      const stroke = createActiveDrawingStroke({
        strokeId: createDrawingGuessStrokeId(),
        userId: localPlayerId,
        point,
        canvasRevision: state.canvasRevision,
        toolState,
      });

      previewThrottleRef.current = markStrokePreviewPublished({
        now: Date.now(),
        pointCount: stroke.points.length,
      });
      setActiveStroke(stroke);
      void publishStrokePreview(stroke, 'begin');
    },
    [publishStrokePreview, state.canvasRevision, state.drawerId, state.phase, toolState],
  );

  const appendStrokePoint = useCallback((point: DrawingPoint) => {
    setActiveStroke((currentStroke) => {
      const nextStroke = appendPointToActiveStroke(currentStroke, point);

      if (!nextStroke) {
        return nextStroke;
      }

      const nowMs = Date.now();

      if (
        shouldPublishStrokePreviewUpdate({
          now: nowMs,
          pointCount: nextStroke.points.length,
          state: previewThrottleRef.current,
        })
      ) {
        previewThrottleRef.current = markStrokePreviewPublished({
          now: nowMs,
          pointCount: nextStroke.points.length,
        });
        void publishStrokePreview(nextStroke, 'update');
      }

      return nextStroke;
    });
  }, [publishStrokePreview]);

  const previewStrokePoints = useCallback(
    (points: DrawingPoint[]) => {
      if (stateRef.current.phase !== 'drawing' || stateRef.current.drawerId !== localPlayerId) {
        return;
      }

      const isFirstPreview = !activePreviewStrokeIdRef.current;
      const strokeId = activePreviewStrokeIdRef.current ?? createDrawingGuessStrokeId();
      activePreviewStrokeIdRef.current = strokeId;

      const previewStroke = createCommittedDrawingStrokeFromPoints({
        strokeId,
        userId: localPlayerId,
        points,
        canvasRevision: stateRef.current.canvasRevision,
        toolState,
      });

      if (!previewStroke) {
        return;
      }

      previewThrottleRef.current = markStrokePreviewPublished({
        now: Date.now(),
        pointCount: previewStroke.points.length,
      });
      void publishStrokePreview(previewStroke, isFirstPreview ? 'begin' : 'update');
    },
    [publishStrokePreview, toolState],
  );

  const commitStrokePoints = useCallback(
    (points: DrawingPoint[]) => {
      if (stateRef.current.phase !== 'drawing' || stateRef.current.drawerId !== localPlayerId) {
        activePreviewStrokeIdRef.current = undefined;
        return;
      }

      const stroke = createCommittedDrawingStrokeFromPoints({
        strokeId: activePreviewStrokeIdRef.current ?? createDrawingGuessStrokeId(),
        userId: localPlayerId,
        points,
        canvasRevision: stateRef.current.canvasRevision,
        toolState,
      });

      activePreviewStrokeIdRef.current = undefined;
      previewThrottleRef.current = initialStrokePreviewThrottleState;
      setActiveStroke(undefined);

      if (!stroke) {
        return;
      }

      void localConnectionRef.current?.publish(
        createStrokeCommitMessage({
          matchId: stateRef.current.matchId,
          messageId: createDrawingGuessMessageId(),
          senderId: stroke.authorId,
          clientTime: Date.now(),
          sequence: nextSequence(),
          payload: {
            type: 'stroke-committed',
            stroke,
          },
        }),
      );
    },
    [nextSequence, toolState],
  );

  const commitActiveStroke = useCallback(() => {
    setActiveStroke((currentStroke) => {
      const { activeStroke: nextActiveStroke, committedStroke } =
        commitActiveDrawingStroke(currentStroke);

      if (!committedStroke) {
        return undefined;
      }

      previewThrottleRef.current = initialStrokePreviewThrottleState;
      void localConnectionRef.current?.publish(
        createStrokeCommitMessage({
          matchId: stateRef.current.matchId,
          messageId: createDrawingGuessMessageId(),
          senderId: committedStroke.authorId,
          clientTime: Date.now(),
          sequence: nextSequence(),
          payload: {
            type: 'stroke-committed',
            stroke: committedStroke,
          },
        }),
      );

      return nextActiveStroke;
    });
  }, [nextSequence]);

  const cancelActiveStroke = useCallback(() => {
    activePreviewStrokeIdRef.current = undefined;
    setActiveStroke((currentStroke) => {
      if (currentStroke) {
        void publishStrokePreview(currentStroke, 'cancel');
      }

      previewThrottleRef.current = initialStrokePreviewThrottleState;
      return cancelActiveDrawingStroke();
    });
  }, [publishStrokePreview]);

  const setBrushColor = useCallback((color: string) => {
    setToolState((currentToolState) => ({
      ...currentToolState,
      brushColor: color,
      selectedTool: 'brush',
    }));
  }, []);

  const setBrushWidth = useCallback((width: number) => {
    setToolState((currentToolState) => ({
      ...currentToolState,
      brushWidth: width,
      selectedTool: 'brush',
    }));
  }, []);

  const setTool = useCallback((tool: DrawingTool) => {
    setToolState((currentToolState) => ({
      ...currentToolState,
      selectedTool: tool,
    }));
  }, []);

  const resetLaunchMetadata = useCallback(
    (
      nextRoomCode: string,
      nextMode: NonNullable<DrawingGuessRouteParams['mode']>,
      nextSource: NonNullable<DrawingGuessRouteParams['source']> = 'games',
    ) => {
      const launch = resolveDrawingGuessLaunch({
        roomId: nextRoomCode,
        mode: nextMode,
        source: nextSource,
      });

      setLaunchSource(launch.source);
      setLaunchTitle(launch.title);
      setLaunchSubtitle(launch.subtitle);
    },
    [],
  );

  return {
    viewModel,
    actions: {
      createLocalRoom: () => {
        const nextRoomCode = createDrawingGuessRoomCode();
        resetLaunchMetadata(nextRoomCode, 'local-simulated');
        resetRoom(nextRoomCode, 'local-simulated');
      },
      joinLocalRoom: (nextRoomCode) => {
        const resolvedRoomCode = nextRoomCode.trim() || createDrawingGuessRoomCode();
        resetLaunchMetadata(resolvedRoomCode, 'local-simulated');
        resetRoom(resolvedRoomCode, 'local-simulated');
      },
      createOnlineRoom: () => {
        const nextRoomCode = createDrawingGuessRoomCode();
        resetLaunchMetadata(nextRoomCode, 'online');
        resetRoom(nextRoomCode, 'online');
      },
      joinOnlineRoom: (nextRoomCode) => {
        const resolvedRoomCode = nextRoomCode.trim() || createDrawingGuessRoomCode();
        resetLaunchMetadata(resolvedRoomCode, 'online');
        resetRoom(resolvedRoomCode, 'online');
      },
      startMatch,
      choosePrompt,
      submitGuess,
      submitSimulatedCorrectGuess,
      addSampleStroke: () => commitSampleStroke('brush'),
      addSampleEraserStroke: () => commitSampleStroke('eraser'),
      commitStrokePoints,
      previewStrokePoints,
      beginStroke,
      appendStrokePoint,
      commitActiveStroke,
      cancelActiveStroke,
      setBrushColor,
      setBrushWidth,
      setTool,
      undoLatestStroke: () => dispatch({ type: 'undo-latest-stroke', actorId: state.drawerId ?? localPlayerId }),
      clearCanvas: () => {
        setActiveStroke(undefined);
        setRemotePreviewStrokes(clearRemoteStrokePreviews());
        void publishControl({ type: 'canvas-cleared' });
      },
      endRound: () => {
        setRemotePreviewStrokes(clearRemoteStrokePreviews());
        void publishControl({
          type: 'round-ended',
          now: Date.now(),
          reason: 'manual',
        });
      },
      advanceRound: () => {
        setRemotePreviewStrokes(clearRemoteStrokePreviews());
        void publishControl({
          type: 'round-advanced',
          state: advanceToNextRound(state, state.hostId ?? localPlayerId, Date.now()),
        });
      },
      finishMatch: () => {
        setRemotePreviewStrokes(clearRemoteStrokePreviews());
        void publishControl({ type: 'match-finished' });
      },
      leaveGame: onLeave,
    },
  };
}

const createInitialState = (
  roomCode: string,
  mode: DrawingGuessRouteParams['mode'],
  localPlayerId: string,
) =>
  mode === 'online'
    ? createOnlineDrawingGuessState({
        roomCode,
        localPlayerId,
        matchId: createDrawingGuessMatchId(),
        now: Date.now(),
      })
    : createLocalSimulatedDrawingGuessState({
        roomCode,
        localPlayerId,
        matchId: createDrawingGuessMatchId(),
        now: Date.now(),
      });

const localShowcaseWrongGuesses: Record<DrawingGuessPrompt['category'], string[]> = {
  objects: ['Clock', 'Backpack', 'Phone'],
  food: ['Banana', 'Cake', 'Pizza'],
  places: ['School', 'Park', 'Market'],
  actions: ['Running', 'Dancing', 'Swimming'],
  animals: ['Dog', 'Rabbit', 'Bird'],
  household: ['Lamp', 'Sofa', 'Mirror'],
};

export const getLocalShowcaseWrongGuess = (prompt: DrawingGuessPrompt) => {
  const promptAnswers = new Set(getPromptAnswers(prompt));
  const categoryGuesses = localShowcaseWrongGuesses[prompt.category];
  const guess =
    categoryGuesses.find((candidate) => !promptAnswers.has(normalizeGuess(candidate))) ??
    'Almost got it';

  return guess;
};
