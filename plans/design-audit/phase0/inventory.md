# Phase 0 inventory (deterministic)

Snapshot: origin/main. 1307 files, 442 non-test.

## Size by tier

| tier | files | lines |
|---|---|---|
| test | 865 | 131434 |
| components | 125 | 22706 |
| server | 75 | 12783 |
| tools | 49 | 11780 |
| lib | 102 | 9413 |
| app | 24 | 8879 |
| scripts | 38 | 4901 |
| locales | 3 | 3138 |
| context | 8 | 2893 |
| shared | 7 | 1118 |
| eslint.config | 1 | 250 |
| eslint.selectors | 1 | 112 |
| jest.config | 1 | 75 |
| modules | 4 | 53 |
| metro.config | 1 | 38 |
| drizzle.config | 1 | 23 |
| plugins | 1 | 22 |
| babel.config | 1 | 9 |

## Largest non-test modules (>= 500 lines)

| file | lines | prod fan-in | test fan-in | fan-out | exports |
|---|---|---|---|---|---|
| tools/loop/queue-loop.mjs | 1707 | 2 | 10 | 16 | 38 |
| components/GameTable.tsx | 1687 | 5 | 56 | 74 | 4 |
| lib/game/gameEngine.ts | 1526 | 66 | 161 | 1 | 77 |
| components/table/hand.tsx | 1497 | 2 | 7 | 22 | 4 |
| app/index.tsx | 1178 | 0 | 4 | 19 | 1 |
| context/OnlineGameContext.tsx | 1138 | 3 | 11 | 17 | 9 |
| app/profile.tsx | 1071 | 0 | 2 | 26 | 1 |
| locales/sq.ts | 1049 | 1 | 5 | 1 | 1 |
| locales/en.ts | 1046 | 3 | 27 | 0 | 1 |
| locales/it.ts | 1043 | 1 | 13 | 1 | 1 |
| server/http/routes.ts | 1042 | 1 | 1 | 27 | 4 |
| components/table/seats.tsx | 981 | 1 | 7 | 20 | 5 |
| components/table/pile.tsx | 942 | 1 | 4 | 24 | 8 |
| app/tutorial.tsx | 907 | 0 | 3 | 19 | 1 |
| app/(online)/room.tsx | 861 | 0 | 2 | 27 | 2 |
| server/game/tableHandlers.ts | 840 | 1 | 6 | 28 | 3 |
| tools/loop/loop-render.mjs | 775 | 7 | 3 | 0 | 42 |
| components/CardView.tsx | 722 | 9 | 17 | 12 | 8 |
| lib/tokens.ts | 716 | 27 | 62 | 0 | 40 |
| app/(online)/friends.tsx | 679 | 0 | 3 | 17 | 1 |
| components/flightPhysics.ts | 651 | 12 | 20 | 11 | 37 |
| app/(online)/index.tsx | 578 | 0 | 2 | 15 | 1 |
| scripts/measureHeadsUpBalance.ts | 560 | 0 | 1 | 6 | 2 |
| scripts/iconSubsetChars.mjs | 554 | 1 | 1 | 0 | 5 |
| components/SettingsModal.tsx | 553 | 1 | 5 | 18 | 1 |
| tools/loop/loop-derive.mjs | 548 | 10 | 4 | 1 | 21 |
| tools/loop/settle.mjs | 548 | 1 | 4 | 8 | 12 |
| components/table/scorePill.tsx | 532 | 1 | 0 | 12 | 1 |
| context/SocketContext.tsx | 528 | 7 | 29 | 12 | 2 |
| tools/loop/workspace.mjs | 521 | 2 | 3 | 6 | 11 |
| tools/loop/loop-logs.mjs | 519 | 3 | 7 | 1 | 37 |

## Functions >= 80 lines (94)

- components/GameTable.tsx:353 `GameTable` 1310 lines
- context/OnlineGameContext.tsx:276 `OnlineGameProvider` 845 lines
- components/table/hand.tsx:640 `StraightHand` 803 lines
- server/http/routes.ts:410 `registerRoutes` 632 lines
- app/(online)/friends.tsx:52 `FriendsScreen` 453 lines
- context/SocketContext.tsx:119 `SocketProvider` 409 lines
- app/(online)/index.tsx:34 `OnlineLobbyScreen` 391 lines
- tools/loop/loop-screen.mjs:74 `ticker` 386 lines
- context/OnlineGameContext.tsx:498 `(anon)` 384 lines
- components/SettingsModal.tsx:64 `SettingsModal` 378 lines
- app/(online)/room.tsx:311 `RoomScreen` 367 lines
- app/tutorial.tsx:456 `TutorialScreen` 362 lines
- app/(online)/game.tsx:49 `OnlineGameScreen` 317 lines
- app/profile.tsx:531 `ProfileScreen` 317 lines
- components/table/hand.tsx:259 `CardItemBase` 302 lines
- components/table/pile.tsx:619 `usePileFlight` 278 lines
- context/GameContext.tsx:143 `GameProvider` 262 lines
- components/table/scorePill.tsx:111 `ScorePill` 260 lines
- app/index.tsx:651 `HomeScreen` 254 lines
- app/auth.tsx:32 `AuthScreen` 240 lines
- context/SocketContext.tsx:255 `(anon)` 234 lines
- components/CardView.tsx:422 `CardViewBase` 222 lines
- app/(online)/quickmatch.tsx:82 `QuickmatchScreen` 209 lines
- server/socket/socketRooms.ts:47 `registerRoomHandlers` 209 lines
- app/game.tsx:38 `GameScreen` 201 lines
- app/lobby.tsx:112 `LobbyScreen` 201 lines
- components/table/settingsSheet.tsx:189 `GameSettingsSheet` 195 lines
- tools/loop/queue-loop.mjs:1098 `runOnce` 194 lines
- app/(online)/replay.tsx:40 `ReplayScreen` 192 lines
- tools/loop/queue-loop.mjs:1505 `main` 191 lines
- components/table/seats.tsx:387 `SeatRing` 185 lines
- app/tutorial.tsx:608 `renderBody` 181 lines
- server/game/roundOver.ts:59 `handleRoundOver` 181 lines
- app/tutorial.tsx:196 `buildBeats` 178 lines
- components/table/ExchangeLegs.tsx:159 `ExchangeLegs` 161 lines
- components/table/actions.tsx:51 `GiocaButton` 158 lines
- components/table/pile.tsx:407 `PileLayer` 158 lines
- app/recover.tsx:22 `RecoverScreen` 153 lines
- server/game/onlineGameLogic.ts:348 `resolveRoundEnd` 147 lines
- app/verify-email.tsx:24 `VerifyEmailScreen` 145 lines
- components/table/notices/hud.tsx:59 `TurnChip` 144 lines
- lib/game/bot.ts:222 `botChoosePlay` 144 lines
- components/table/useLampRig.ts:42 `useLampRig` 142 lines
- components/NotificationBanner.tsx:80 `NotificationBanner` 140 lines
- components/useTableFeedback.ts:256 `useTableFeedback` 137 lines
- context/AuthContext.tsx:76 `AuthProvider` 137 lines
- server/game/tableHandlers.ts:509 `startMatchAction` 136 lines
- components/table/particleLayer.tsx:121 `ParticleLayer` 135 lines
- server/socket/friendships.ts:56 `createFriendships` 135 lines
- server/socket/socket.ts:76 `setupSocket` 131 lines
- components/ErrorFallback.tsx:28 `ErrorFallback` 130 lines
- tools/loop/queue-loop.mjs:1355 `realPorts` 129 lines
- components/table/pile.tsx:136 `PlayGroup` 128 lines
- components/Slider.tsx:42 `Slider` 127 lines
- components/table/seats.tsx:256 `CountdownRing` 126 lines
- app/profile.tsx:80 `UserCard` 123 lines
- app/(online)/leaderboard.tsx:28 `LeaderboardScreen` 122 lines
- server/http/adminPage.ts:53 `renderAdminPage` 122 lines
- tools/loop/loop-derive.mjs:426 `derive` 122 lines
- app/(online)/room.tsx:190 `InviteFriendsPanel` 120 lines

## Import cycles (2)

- 6 files: lib/wire.ts, lib/game/matchState.ts, lib/game/botPersonalities.ts, lib/game/gameEngine.ts, shared/protocol.ts, lib/i18n.ts
- 2 files: components/table/particles.ts, components/table/air.ts

## Layer edges

- components -> lib: 242
- app -> lib: 131
- app -> components: 112
- components -> lib/game: 50
- server -> shared: 50
- app -> context: 35
- context -> lib: 34
- server -> lib/game: 29
- tools -> scripts: 29
- app -> lib/game: 15
- lib -> lib/game: 10
- server -> lib: 10
- components -> context: 8
- context -> lib/game: 8
- lib/game -> lib: 8
- components -> shared: 4
- lib -> shared: 4
- scripts -> lib/game: 4
- shared -> lib/game: 4
- lib -> modules: 3
- shared -> locales: 3
- app -> shared: 2
- context -> shared: 2
- scripts -> tools: 2
- scripts -> lib: 2
- scripts -> components: 2
- components -> modules: 1
- context -> components: 1
- eslint.config -> eslint.selectors: 1
- shared -> lib: 1
- tools -> jest.config: 1

## Layer violations (5)

Rule: shared imports nothing; lib/game imports no UI/server; server imports no UI; lib imports no components/app; components/context import no server/app.

- shared/protocol.ts -> lib/game/gameEngine.ts
- shared/protocol.ts -> lib/game/matchState.ts
- shared/protocol.ts -> lib/wire.ts
- shared/schema.ts -> lib/game/gameEngine.ts
- shared/schema.ts -> lib/game/replay.ts

## Production importing test files (2)

- scripts/measureHeadsUpBalance.ts -> tests/helpers/offlineMatch.ts
- scripts/measureHeadsUpBalance.ts -> tests/engine/helpers.ts

## Orphan modules: no production importer, not an entry (1)

- modules/murlan-diagnostics/app.plugin.js (no importers at all)

## Exports with no production importer (679; 498 used only by tests)

Grouped by file. `*` = only tests use it.

- tools/loop/queue-loop.mjs: liveRoute*, nextRoute*, turnsFor, contextFor*, allowedTools*, queueLoopArgs*, reinstall*, syncCheckout*, CI_ROUNDS*, MAX_HANDOFFS*, BREAKER*, HEARTBEAT_MS, holdFor*, park*, repark*, removeWorktree*, removeLanded*, publishForReview*, refreshWorktree*, ticketFacts*, sessionEnv, roundOf, openTicket, sessionView*, ticketRun, runTicket*, loopMoved*, loopSha*, pushedPr*, settle*, TICKET_HOLDS*, parkAndRecord, runOnce*, journaled*, screenEvents*, main*
- lib/game/gameEngine.ts: STRAIGHT_MAX_LEN*, shuffleDeck*, HEADS_UP_HAND*, freshHandFloor*, findStartingPlayer*, getCombinationType*, getCombinationStrength*, BeatRefusal*, PassRefusal*, canPlay*, PlayCheck*, canPlayerPlay*, loserHasBothJokers*, getBestCardFromHand*, nextDealFirstSeat*, targetsFor*, MatchResolution*, scoreRound*, addPlacementPoints*, nextMatchTarget*, resolveMatch*, resolveTeamMatch*, FoldRoundInput*, FoldRoundResult*
- tools/loop/mainHealth.ts: MainRun*, FiledIssue*, MainHealth, MAIN_RED_LABEL*, titleFor*, WINDOW*, alreadyFiled*, staleIssues, decideMainHealth*, mainRunArgs*, filedIssueArgs*, closeArgs, jobArgs*, issueArgs, bodyFor*, Gh, readMain, checkMain*, MainFailures, mainFailures*
- components/cardFaceModel.ts: isWideRank*, rankTextWidth*, Box, indexBox*, PIP_COL, PIP_TOP, PIP_BOTTOM, PIP_SIZE, ACE_PIP_SIZE, CROWDED_PIP_SCALE, PipColumn, PipSpot, PIP_LAYOUTS*, COURT_ART_BOX, PIP_RANKS*, PlacedPip, placedPips*, pipBox*, boxesOverlap*
- tools/ci/e2e-shard.mjs: UNMEASURED_SECONDS*, TARGET_RUN_SECONDS*, AROUND_SHARDS_SECONDS, SHARD_OVERHEAD_SECONDS, SHARD_NOISE, MAX_CONCURRENT_JOBS*, MAX_SHARDS*, readTimings*, assignShards*, filesForShard*, resolveTimings, medianTimings, shardsNeeded*, plan*
- tools/loop/loop-logs.mjs: ARTEFACTS*, reportPath, supervisorLogPath*, prunable*, SCHEMA, STDERR_CAP*, sessionRow*, startRow, totalsOf, handoffIn*, parkReasonOf*, windowCost*, holdRound*
- tools/loop/next-ticket.mjs: LAUNCH_MILESTONE*, openIssues*, sizeOf*, routeOf*, stranded*, launchOpen*, classify*, claimedElsewhere*, takeable*, rank, waitingOn*, pickRoute*, takeableReasons*
- scripts/ios-device.mjs: needsInstall*, lanAddress*, parseDevices*, pickRun*, readHidden*, artifactFor*, withBenchHost*, patchBenchHost*, benchUrl*, errorLine*, metroEnv*
- tools/loop/reap.mjs: checkoutRoot*, toolingRoots*, ownedByTooling*, orphans*, staleByAge*, parseWindowsProcessJson*, readProcessTable*, wouldTakeSelf*, isSessionHost*, netstatListeners*, stalePortHolders*
- tools/loop/loop-render.mjs: WIDTH*, MIN_WIDTH*, cols*, cut, clamp, row, PHASES*, SPIN*, KEYS*, wrap*
- components/table/cardShadows.ts: ShadowKind*, shadowKind*, inPath*, castOffset*, ShadowTransform*, PathSink*, PilePlay*, ShadeCards*, SHADE_STEP*
- scripts/bundle-budget.mjs: BUDGET_BYTES*, DEFERRED_BUDGET_BYTES*, DIST_DIR, BUNDLE_DIR, CANVASKIT_MARK*, gzippedJsSize*, firstLoadFiles*, canvasKitCheck*, report*
- tools/loop/agent-check.mjs: checkSubject*, readSubject*, cacheEntry*, replays*, clip, stepEnv, runStep*, runAll*, judge*
- tools/loop/decide.mjs: handoffOf, exhausted*, RESUMABLE, resumePhase*, apiFailure*, waitFor*, afterRefusal*, outcomeOf*, reasonFor*
- tools/loop/related-tests.mjs: NATIVE_TEST, CODE, LOCAL_PROJECTS*, onLocalProjects*, localProjectOf*, nearTests*, NEAR_CAP, capNear*, listedTests*
- shared/persistedEnvelope.ts: readPersistedPlayerMap*, PersistedSeats*, readPersistedSeats, GAME_SCHEMA_VERSION*, persistedMatchSchema*, PersistedMatch*, PersistedRestore, persistedEnvelopeSchema*
- tools/ci/native-budget.mjs: BUDGET_S*, OUTSIDE_S*, CI_SLOWER*, HARD_FACTOR*, MAX_EXCEPTION_S*, EXCEPTIONS*, overBudget*, default*
- tools/loop/loop-stream.mjs: PHASE, echoedPhase, scopeEnds*, HANDOFF, usageOf*, readEvent, ACCOUNT_ERRORS, closesTask
- tools/loop/settle.mjs: startSettle*, rested*, overdueAt*, endSettle*, stepSettle*, failingFiles, ciRedBody*, onMainLine*
- components/flightPhysics.ts: arrivingCard*, comboImpactTier*, shakeMagnitude*, TableGeometry*, SeatPlace*, flightOrigin*, INACTIVE_EXCHANGE*
- components/tableArc.ts: ArcBox, ArcSpec, fitSpread*, arcCards*, ArcBounds, ArcBudget, FIELD_ARC
- context/OnlineGameContext.tsx: RoomState*, RematchVoteState*, OnlineMatchState*, ReconnectNotice*, TurnDeadline*, GameStateBroadcast*, useOnlineGame*
- lib/device/moments.ts: Haptic, Cue, MomentSpec, PILE_UP_WINDOW_MS*, isCombo*, landingKind, MOMENTS*
- tools/ci/analyze-maestro-run.mjs: parseCommandWindows*, parseHierarchyFetches*, parseJankFrames*, appPidAt*, summarize*, headline*, toMarkdownTable
- tools/ci/e2ePort.mjs: BASE_PORT, PORT_SPAN*, chooseE2ePort*, CLAIM_TTL_MS, claimedBy, claimPort, takeE2ePort
- tools/loop/ciVerdict.ts: CiProgress, ciProgress*, Verdict, ghExecOptions*, GhExec, LandingState, readLandingState*
- tools/loop/workspace.mjs: reparsePointNames*, detachLinks*, findOrphanedWorktreeDirs, misnamedWorktrees, removeWorktree, sweep*, lockDrift*
- components/table/noticeModel.ts: NoticeTone, ToneOf, NoticeSelector, NoticeSpec, selectorBox*, selectorGlow*
- lib/game/exchangeTimeline.ts: ExchangePose, LegTimes, LEG*, REDUCED_LEG*, RECEIVE_MS, GIVE_MS
- server/game/gamePersistence.ts: ABANDONED_GAME_MAX_AGE_MS*, STALE_ROOM_MAX_AGE_MS*, sanitizeStateForPlayer*, persistence*, pruneAbandonedGames*, pruneStaleRooms*
- server/game/gameTimers.ts: TIMER_KINDS*, TimerKind*, Clock*, setClock*, clear*, pendingKeys*
- tools/ci/ios-wall.mjs: BUDGET_S*, HARD_FACTOR*, overBudget*, overCeiling*, wallSeconds*, run*
- tools/loop/loop-cost.mjs: RATES, summary*, report*, select*, killedLine*, shaTable*
- components/table/lampRig.ts: LampTarget*, TABLE_CENTRE*, poolOver*, LAMP_LIGHT*, GLIDE*
- components/table/pile.tsx: Flight*, BombClock*, PileNote*, PileLayerProps*, PileFlightInput*
- lib/e2eTrace.ts: TraceFrame*, TraceRecorder*, FrameHost*, recordFrames*, traceRecorder*
- server/game/onlineGameLogic.ts: VisibleExchangePhaseInput, isContestedTable*, ResolveRoundEndInput, ScoreboardRow, ResolveRoundEndResult
- server/http/shutdown.ts: PLATFORM_GRACE_MS*, DRAIN_TIMEOUT_MS*, DISCONNECT_SETTLE_MS*, FORCED_EXIT_MS*, ShutdownDeps*
- server/socket/socketAdapter.ts: DEFAULT_POOL_MAX*, channelPrefix*, listenPattern*, PoolStats*, meterPool*
- tools/ci/budget-gate.mjs: budgetFinding*, budgetReport*, budgetListArgs*, overBudget*, run*
- tools/loop/claim.mjs: slugOf*, claimSteps*, baseOf*, claim*, failedClaim*
- tools/loop/land.ts: CiVerdict*, Landing*, landing*, armArgs*, disarmArgs*
- tools/loop/loop-gate.mjs: buildPassed*, lineResolver, dodVerdict*, MAX_FIX_HOLDS*, roundVerdict*
- components/handLayout.ts: MIN_READABLE_STEP*, MAX_STEP_RATIO*, HandLayout, cardAtX*
- components/table/feltShader.ts: TWILL*, LAMP_HEIGHT, CLOTH_BODY*, ClothUniforms*
- lib/i18n.ts: LOCALE_LABELS*, detectDeviceLocale*, setLocale*, tn*
- lib/sendIntent.ts: INTENT_ATTEMPTS, RETRYABLE_CODES, IntentOutcome, sendIntent*
- scripts/await-run.mjs: BUDGET_MS*, EVERY_MS*, runArgs*, awaitRuns*
- scripts/checkStrictIndexed.mjs: REPO_ROOT*, DEFAULT_CONFIG, areasOf*, runStrictIndexedCheck*
- scripts/contextSurface.mjs: walk*, fieldsOf*, destructuredNames, readersOf
- scripts/diagnostics-verdict.mjs: flingerUnderruns*, flingerVerdict*, medianHz*, burstStalls*
- server/game/gameTurn.ts: AutoMovable*, CommittedMove, autoMoveForSeat*, armAfterMove
- server/game/tableState.ts: MEMORY_ONLY*, freshMemory*, TableRoom, TableRestore
- server/socket/socketSafety.ts: EventOptions, __resetRateLimits*, errorEventFor*, EventContext
- server/socket/socketTable.ts: seatedHumansOf, roomOf, emitRoomStateTo, announceRoomJoinable
- tools/ci/e2e-budget.mjs: SLACK_S*, HARD_FACTOR*, overBudget*, default*
- tools/loop/loop-derive.mjs: currentBranch, handoffFor*, fixHolds*, CI_BUDGET_MS*
- tools/loop/loop-status.mjs: report*, silentAt*, inform, statusFor*
- components/GameTable.tsx: TurnTimerConfig*, ExchangeAnnouncementSlot*, GameTableProps*
- components/seatLayout.ts: ACTION_BTN_FLOOR*, getOpponentPosition*, SeatedPlayer
- components/table/cardGloss.ts: Gloss*, GLOSS_FRAME_S*, FoilGlint*
- components/table/rail.ts: RAIL*, SHADE_MAX*, rng
- components/tableFrame.ts: EdgeInsets*, ScreenPads, TableFrame
- lib/captureStates.ts: CaptureState*, LINK_STATES*, MOMENT_STATES*
- lib/device/audioEngine.ts: AudioState*, EngineStats*, MUSIC_CROSSFADE_MS*
- lib/device/audioEngine.web.ts: AudioState*, EngineStats*, MUSIC_CROSSFADE_MS*
- lib/diagnostics/index.ts: TableAnchors*, ORIENTATION_ROW_MS*, RING_PROBE_MS*
- lib/game/rating.ts: kFactor*, SEASON_CARRY, expectedScore*
- lib/profileStats.ts: MatchRecord*, PlacementSlice, PlayerCountSlice
- lib/reactions.ts: REACTION_TTL_MS*, subscribeToReactions*, readReactions*
- scripts/e2eBuildMark.mjs: E2E_BUILD_MARK*, DIAGNOSTICS_MARK*, filesCarryingMark
- scripts/iconSubsetChars.mjs: analyzeIcons*, analyzeSnippet*, iconNames
- server/game/ratings.ts: LEADERBOARD_SIZE*, RatingView*, LeaderboardEntry*
- server/game/stats.ts: MAX_HISTORY_ROWS_PER_USER*, UserStatsView*, AchievementStatus*
- server/http/bugReports.ts: BUG_REPORT_PAGE*, BugReportInput*, BugReportRow*
- server/http/rateLimit.ts: LimiterKey, LimiterOptions, maxFrom*
- server/http/routes.ts: verificationEmailBody*, passwordResetEmailBody*, mailLocale*
- server/socket/pushShape.ts: renderBody*, ExpoPushRequest, DEVICE_NOT_REGISTERED*
- server/socket/socketPresence.ts: PresenceContext, SESSION_EVICTION_EVENT, evictOlderSessions*
- server/store/roomStore.ts: SeatClaim*, StartClose*, JoinableRoom*
- shared/events.ts: EVENT_NAMES*, SOCKET_CLOSE_REASONS, SocketCloseReason
- tools/ci/find-native-crash.mjs: androidCrash*, androidAnr*, iosCrash*
- tools/loop/brief.mjs: MODEL_BY_KIND*, readsComments, commentReads*
- tools/loop/guard-bash.mjs: gitAt*, implementRoute*, check*
- components/homeCardField.ts: Depth*, DepthBand
- components/ReactionLayer.tsx: EMOJIS, REACTION_ANCHOR*
- components/RoomSeatList.tsx: SeatHoldView, RoomSeatListProps
- components/table/cardRects.ts: CARD_SCOPES*, TABLE_AT_REST*
- components/table/ember.ts: RIM*, emberSweep*
- components/table/particleSprites.ts: GLOWS*, Cell*
- components/table/seats.tsx: SeatMark*, SeatCountdown*
- components/turnTimerUi.ts: TurnFacts, ComboShape*
- lib/audioLevel.ts: migrateLevel*, StoredAudio
- lib/diagnostics/lampLegibility.ts: RING_ON_IMAGE*, FELT_SHARE*
- lib/errorReporting.ts: PENDING_CRASH_REPORTS_MAX*, resetErrorReportingForTests*
- lib/game/botPersonalities.ts: BotPersonality, isBotPersonalityId*
- lib/game/matchState.ts: celebratesViewer*, isDrawnRound*
- lib/offlineSave.ts: OFFLINE_SAVE_VERSION*, OfflineDecode
- lib/ownLink.ts: LinkPill, CatchUp
- lib/theme.ts: ShadowLayer, makeLayeredShadow*
- scripts/bundleRoutes.mjs: expectedRouteKeys*, missingRoutes*
- scripts/devStackPort.mjs: PORT_SPAN*, isAddressInUse*
- scripts/lib/commentShape.ts: Line, classify*
- scripts/measureHeadsUpBalance.ts: isCertainLead*, handHasLegalRoyalStraight*
- scripts/mockupParityPage.mjs: findMoments*, buildPage*
- server/app.ts: __testables*, CreatedApp*
- server/game/tableActions.ts: TableActionBase, TableActionKind*
- server/game/tableRouter.ts: TABLE_ACTION_EVENT*, inFlight*
- server/http/admin.ts: ROW_LIMIT, DayCount
- server/http/clientErrors.ts: CLIENT_ERROR_PAGE*, ClientErrorInput*
- server/http/logger.ts: REDACT_PATHS*, createLogger*
- server/http/roundHistoryView.ts: HistoryParticipant*, RoundHistoryRow*
- server/socket/friendships.ts: FriendshipDeps*, createFriendships*
- server/socket/push.ts: MAX_DEVICES_PER_USER*, tokensFor*
- server/store/drainPool.ts: PoolActivity, DrainOptions
- server/store/schemaDdl.ts: schemaStatements*, assertRenamesApplied*
- shared/protocol.ts: WirePlayer, IntentSchemas
- tools/ci/await-artifact.mjs: POLL_MS, awaitArtifact*
- tools/ci/e2e-timings.mjs: timingsFromReport*, coverageGap*
- tools/ci/edgePixels.mjs: SOFT_MIN*, edgeVerdict*
- tools/ci/feltPixels.mjs: BLACK_MAX*, feltVerdict*
- tools/ci/gate.mjs: gateVerdict*, run*
- tools/ci/nativeScope.mjs: patchReader*, needsNative*
- tools/ci/preflightMemory.mjs: memoryFloor*, memoryVerdict*
- components/Avatar.tsx: AvatarSize
- components/CardView.tsx: cardViewPropsEqual*
- components/ChoiceChips.tsx: Choice
- components/ErrorBoundary.tsx: ErrorBoundaryProps
- components/flightPose.ts: Pose*
- components/homeMenuModel.ts: HomeMenu
- components/ReplayControls.tsx: moveActionText
- components/table/air.ts: moteAt*
- components/table/dealPose.ts: backDealArc*
- components/table/feltReady.ts: CardCast
- components/table/hand.tsx: cardItemPropsEqual*
- components/table/legibilityRing.ts: ANNULUS_OUTER*
- components/table/notices/floats.tsx: BesideGioca
- components/table/scorePillModel.ts: PillBox
- components/table/settingsSheet.tsx: GameSettingsSheetProps
- components/table/tableTimeline.ts: Anchor
- components/table/trick.ts: beatenPlay*
- components/table/useRoundEnding.ts: RoundEndingClock
- components/tableA11y.ts: TableA11yInput
- components/useHandOrder.ts: HandOrder
- components/useTableFeedback.ts: KICK_JOLTS*
- context/GameContext.tsx: applyRoundToMatch*
- context/NotificationContext.tsx: NOTIFICATION_QUEUE_MAX*
- drizzle.config.ts: default
- lib/achievements.ts: AchievementDef
- lib/canvaskit.ts: CANVASKIT_VERSION*
- lib/cosmetics.ts: cardBackField*
- lib/device/musicTracks.ts: CONTAINER*
- lib/device/musicTracks.web.ts: CONTAINER*
- lib/device/soundAssets.ts: SoundSpec
- lib/diagnostics/FrameProbe.tsx: sampleFrame*
- lib/game/autoMove.ts: AutoMoveContext*
- lib/game/bot.ts: applyPersonality*
- lib/game/matchEnding.ts: MatchOnsets
- lib/game/replay.ts: bombsPlayedBy*
- lib/game/roundEnding.ts: RoundOnsets
- lib/game/sharedGameFlow.ts: ExchangeAnnouncement
- lib/game/standings.ts: StandingRow
- lib/query-client.ts: getQueryFn*
- lib/storageKeys.ts: DEVICE_KEYS*
- lib/streak.ts: UtcDay
- lib/wire.ts: HistoryParticipantDto
- modules/murlan-audio-session/index.ts: MurlanAudioSession*
- modules/murlan-diagnostics/index.ts: MurlanDiagnostics
- modules/murlan-orientation/index.ts: MurlanOrientation*
- scripts/backupNaming.mjs: dumpStamp
- scripts/diagnostics-collector.mjs: createCollector*
- scripts/reactCompilerOptions.mjs: presetRequire*
- server/game/gameOwnership.ts: ownershipKey*
- server/game/replays.ts: MAX_REPLAYS_LISTED*
- server/game/seatAllocation.ts: SeatingInput
- server/game/tableHandlers.ts: rehydrateGame*
- server/http/authTokens.ts: MAX_CODE_ATTEMPTS*
- server/http/schemas.ts: PASSWORD_MIN
- server/http/session.ts: SESSION_MAX_AGE_MS
- server/socket/events.ts: FUNNEL_WINDOW_DAYS*
- server/socket/seating.ts: STOP_SPECTATING_EVENT
- server/socket/socketGameplay.ts: GameplayHandlerContext
- server/socket/socketRooms.ts: RoomHandlerContext
- server/socket/ticket.ts: SocketTicket
- server/store/db.ts: resolvePoolMax*
- server/store/friendStore.ts: AddFriendResult*
- server/store/userStore.ts: EmailTakenError*
- shared/username.ts: UsernameProblem
- tools/ci/clamp-timings.mjs: clampTimings*
- tools/ci/e2eGlobalTimeout.mjs: localGlobalTimeoutMs*
- tools/ci/pick-simulator.mjs: pickSimulator*
- tools/loop/check-steps.mjs: byName*
- tools/loop/guard-write.mjs: verdict*
- tools/loop/run-loop.mjs: supervise*
- tools/loop/tracker.mjs: fakeTracker*

## Duplicated code blocks (>= 8 lines, 71)

- 1036 lines: locales/en.ts:13-35 = locales/it.ts:6-1041
- 1026 lines: locales/en.ts:13-35 = locales/sq.ts:22-1047
- 1025 lines: locales/en.ts:15-35 = locales/en.ts:20-1044
- 126 lines: components/table/scorePill.tsx:81-111 = lib/tokens.ts:6-131
- 44 lines: context/onlineGameHooks.ts:34-84 = context/onlineGameHooks.ts:76-119
- 43 lines: components/table/scorePill.tsx:81-111 = lib/tokens.ts:425-467
- 41 lines: lib/tokens.ts:4-31 = lib/tokens.ts:415-455
- 39 lines: lib/tokens.ts:96-131 = lib/tokens.ts:429-467
- 38 lines: server/http/routes.ts:200-245 = server/http/routes.ts:216-253
- 37 lines: components/table/matchBoard.tsx:32-50 = lib/tokens.ts:431-467
- 35 lines: lib/tokens.ts:386-414 = lib/tokens.ts:436-470
- 32 lines: app/recover.tsx:112-140 = app/verify-email.tsx:101-132
- 31 lines: lib/captureStates.ts:65-93 = lib/captureStates.ts:73-103
- 31 lines: components/table/matchBoard.tsx:32-50 = lib/tokens.ts:103-133
- 31 lines: server/http/routes.ts:271-298 = server/http/routes.ts:280-310
- 26 lines: components/SettingsModal.tsx:267-281 = components/SettingsModal.tsx:284-309
- 26 lines: lib/device/audioEngine.ts:6-36 = lib/device/audioEngine.web.ts:1-26
- 26 lines: server/socket/socketGameplay.ts:113-132 = server/socket/socketGameplay.ts:156-181
- 24 lines: app/(online)/quickmatch.tsx:47-70 = app/(online)/quickmatch.tsx:55-78
- 23 lines: app/recover.tsx:86-108 = app/recover.tsx:141-163
- 23 lines: locales/it.ts:4-26 = locales/sq.ts:20-42
- 22 lines: components/table/actions.tsx:82-106 = components/table/actions.tsx:224-245
- 22 lines: components/table/scorePill.tsx:82-100 = components/table/scorePill.tsx:87-108
- 22 lines: lib/tokens.ts:590-617 = lib/tokens.ts:613-634
- 21 lines: app/(online)/room.tsx:76-96 = app/(online)/room.tsx:117-137
- 21 lines: locales/en.ts:1025-1045 = locales/it.ts:1022-1042
- 21 lines: locales/en.ts:1025-1045 = locales/sq.ts:1028-1048
- 20 lines: components/homeCardField.ts:43-62 = components/homeCardField.ts:53-72
- 19 lines: server/store/friendStore.ts:24-34 = server/store/friendStore.ts:34-52
- 18 lines: app/(online)/room.tsx:779-797 = app/(online)/room.tsx:790-807
- 18 lines: lib/e2eBotSuspend.ts:5-22 = lib/e2eRealExchange.ts:5-22
- 17 lines: components/table/moments.tsx:162-179 = components/table/moments.tsx:243-259
- 16 lines: app/(online)/room.tsx:611-626 = app/(online)/room.tsx:655-670
- 15 lines: app/(online)/room.tsx:804-821 = app/(online)/room.tsx:810-824
- 15 lines: lib/device/soundAssets.ts:2-8 = lib/device/soundAssets.ts:7-21
- 15 lines: server/http/routes.ts:486-502 = server/http/routes.ts:564-578
- 15 lines: server/socket/socketGameplay.ts:87-101 = server/socket/socketGameplay.ts:99-113
- 14 lines: app/(online)/room.tsx:766-782 = app/(online)/room.tsx:838-851
- 14 lines: app/(online)/room.tsx:162-175 = app/lobby.tsx:249-262
- 14 lines: app/recover.tsx:60-73 = app/verify-email.tsx:81-94
- 13 lines: app/auth.tsx:165-177 = app/recover.tsx:77-89
- 13 lines: app/recover.tsx:73-85 = app/recover.tsx:114-126
- 13 lines: components/SettingsModal.tsx:236-248 = components/SettingsModal.tsx:252-264
- 13 lines: lib/device/soundAssets.ts:49-55 = lib/tokens.ts:556-568
- 13 lines: server/http/routes.ts:871-883 = server/http/routes.ts:877-889
- 13 lines: app/(online)/leaderboard.tsx:6-15 = server/socket/socket.ts:13-25
- 12 lines: app/(online)/index.tsx:387-398 = app/(online)/index.tsx:402-413
- 12 lines: app/auth.tsx:188-199 = app/recover.tsx:79-90
- 12 lines: components/MenuButton.tsx:54-64 = components/table/actions.tsx:97-108
- 12 lines: lib/device/soundAssets.ts:41-46 = lib/tokens.ts:556-567
- 11 lines: app/(online)/index.tsx:169-179 = app/lobby.tsx:212-222
- 11 lines: app/auth.tsx:165-175 = app/recover.tsx:118-128
- 11 lines: app/auth.tsx:165-175 = app/verify-email.tsx:107-117
- 11 lines: app/auth.tsx:165-175 = app/verify-email.tsx:122-132
- 11 lines: components/MenuButton.tsx:54-64 = components/table/actions.tsx:236-246
- 11 lines: lib/tokens.ts:285-300 = lib/tokens.ts:294-304
- 11 lines: app/(online)/replay.tsx:7-19 = server/app.ts:7-17
- 11 lines: app/verify-email.tsx:4-14 = server/app.ts:10-20
- 11 lines: shared/protocol.ts:102-112 = shared/protocol.ts:107-117
- 10 lines: app/(online)/room.tsx:524-533 = app/(online)/room.tsx:535-544
- 10 lines: components/SettingsModal.tsx:237-246 = components/SettingsModal.tsx:270-279
- 10 lines: components/SettingsModal.tsx:267-276 = components/SettingsModal.tsx:317-326
- 10 lines: components/table/noticeModel.ts:53-58 = components/table/noticeModel.ts:58-67
- 10 lines: lib/device/soundAssets.ts:40-47 = lib/device/soundAssets.ts:45-54
- 10 lines: server/game/tableHandlers.ts:202-214 = server/game/tableHandlers.ts:260-269
- 9 lines: components/homeCardField.ts:87-98 = components/homeCardField.ts:98-106
- 9 lines: components/table/notices/tableLines.tsx:4-12 = components/table/notices/tableLines.tsx:14-22
- 9 lines: app/(online)/index.tsx:22-30 = server/game/retention.ts:10-18
- 9 lines: server/socket/friendships.ts:111-120 = server/socket/friendships.ts:117-125
- 8 lines: app/(online)/index.tsx:297-304 = app/(online)/index.tsx:319-326
- 8 lines: components/table/particleLayer.tsx:27-34 = components/table/particleLayer.web.tsx:9-16

## jest.mock targets (377 calls)

- expo-router: 47
- lib/accessibility.ts: 46
- context/AuthContext.tsx: 36
- context/SocketContext.tsx: 20
- lib/query-client.ts: 19
- context/NotificationContext.tsx: 15
- context/onlineGameHooks.ts: 14
- @react-native-community/netinfo: 12
- @tanstack/react-query: 12
- react-native/Libraries/Utilities/useWindowDimensions: 11
- lib/diagnostics/recorder.ts: 10
- lib/socket.ts: 9
- context/GameContext.tsx: 9
- components/GameTable.tsx: 8
- react-native-reanimated: 7
- lib/e2eTrace.ts: 6
- lib/device/pushRegistration.ts: 5
- lib/cosmetics.ts: 5
- components/table/particles.ts: 5
- react-native-worklets: 5
- @shopify/react-native-skia: 4
- @react-native-async-storage/async-storage: 4
- components/SettingsModal.tsx: 4
- context/OnlineGameContext.tsx: 3
- react-native-gesture-handler: 3
- components/table/cardShadows.ts: 3
- lib/errorReporting.ts: 2
- components/table/seats.tsx: 2
- components/table/pile.tsx: 2
- components/table/hand.tsx: 2
- expo-asset: 2
- components/table/dealSlots.ts: 2
- expo-notifications: 2
- components/useTableFeedback.ts: 2
- lib/game/gameEngine.ts: 2
- modules/murlan-orientation/index.ts: 2
- components/CardView.tsx: 2
- components/table/useFlightClock.ts: 2
- expo-screen-orientation: 2
- lib/device/musicTracks.ts: 1
- expo-keep-awake: 1
- components/flightPhysics.ts: 1
- react-native-svg: 1
- components/table/cardGloss.ts: 1
- components/table/lampRig.ts: 1
- components/table/dealPose.ts: 1
- react-native: 1
- expo-constants: 1
- components/table/ExchangeLegs.tsx: 1
- components/table/feltFallback.tsx: 1
- components/table/feltSkiaBoundary.tsx: 1
- components/table/ember.ts: 1
- components/table/handShadeCanvas.tsx: 1
- components/MenuLayout.tsx: 1
- lib/device/orientation.tsx: 1
- lib/diagnostics/index.ts: 1
- components/table/selection.ts: 1
- components/table/particleSprites.ts: 1
- components/table/air.ts: 1
- expo-clipboard: 1

## Unresolved local imports (0)


