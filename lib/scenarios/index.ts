import type { Scenario } from "./types";
import { stuckAt3am } from "./stuck-at-3am";
import { zombiePods } from "./zombie-pods";
import { driftInTheDark } from "./drift-in-the-dark";
import { lockedOut } from "./locked-out";
import { helmGoneWrong } from "./helm-gone-wrong";
import { hookThatWouldntDie } from "./hook-that-wouldnt-die";
import { silentFailure } from "./silent-failure";
import { sigtermNeverArrived } from "./sigterm-never-arrived";
import { virtualThreadsRealProblems } from "./virtual-threads-real-problems";
import { heapThatWasntTheProblem } from "./heap-that-wasnt-the-problem";
import { noDataKnowProblem } from "./no-data-know-problem";
import { alertThatNeverFired } from "./alert-that-never-fired";
import { tooManySeries } from "./too-many-series";
import { whereDidTheLogsGo } from "./where-did-the-logs-go";
import { blockedAtTheBorder } from "./blocked-at-the-border";
import { theIngressThatWasnt } from "./the-ingress-that-wasnt";
import { theFiveSecondDelay } from "./the-five-second-delay";
import { theSandboxThatWasnt } from "./the-sandbox-that-wasnt";
import { eightToTwentyFive } from "./eight-to-twenty-five";
import { theCacheThatForgot } from "./the-cache-that-forgot";
import { theConfigmapThatLied } from "./the-configmap-that-lied";
import { deathByLivenessProbe } from "./death-by-liveness-probe";
import { thePvcThatFollowedYou } from "./the-pvc-that-followed-you";
import { quotaOfSilence } from "./quota-of-silence";
import { theWrongToleration } from "./the-wrong-toleration";
import { initContainerPurgatory } from "./init-container-purgatory";
import { poddisruptionbudgetDeadlock } from "./poddisruptionbudget-deadlock";
import { theAntiAffinityTrap } from "./the-anti-affinity-trap";
import { theScalingSeesaw } from "./the-scaling-seesaw";
import { theSidecarThatWouldntDie } from "./the-sidecar-that-wouldnt-die";
import { theAppThatSyncedTwice } from "./the-app-that-synced-twice";
import { healthCheckBlindSpot } from "./health-check-blind-spot";
import { thePruneThatWasnt } from "./the-prune-that-wasnt";
import { syncWavesOutOfOrder } from "./sync-waves-out-of-order";
import { theRepoServerTimeout } from "./the-repo-server-timeout";
import { clusterSecretDrift } from "./cluster-secret-drift";
import { theIgnoredDiff } from "./the-ignored-diff";
import { appsetMultiplication } from "./appset-multiplication";
import { theProbeThatStartedTooSoon } from "./the-probe-that-started-too-soon";
import { theAotCacheMismatch } from "./the-aot-cache-mismatch";
import { zgcPausesInDisguise } from "./zgc-pauses-in-disguise";
import { theClassloaderLeak } from "./the-classloader-leak";
import { theStartupProbeRace } from "./the-startup-probe-race";
import { theNonRootUploadFailure } from "./the-non-root-upload-failure";
import { configServerThunderingHerd } from "./config-server-thundering-herd";
import { theProfileThatWasntPackaged } from "./the-profile-that-wasnt-packaged";
import { theTraceThatWentNowhere } from "./the-trace-that-went-nowhere";
import { doubleCounted } from "./double-counted";
import { theBlindSpotBehindTheSidecar } from "./the-blind-spot-behind-the-sidecar";
import { recordingRuleRoulette } from "./recording-rule-roulette";
import { theKibanaTimeFilterTrap } from "./the-kibana-time-filter-trap";
import { syntheticButNotReally } from "./synthetic-but-not-really";
import { theAlertThatPagedTheWrongTeam } from "./the-alert-that-paged-the-wrong-team";
import { logSamplingBlindness } from "./log-sampling-blindness";
import { theStaleEndpoint } from "./the-stale-endpoint";
import { eastWestMtlsRejected } from "./east-west-mtls-rejected";
import { theLoadBalancerThatWasntBalancing } from "./the-load-balancer-that-wasnt-balancing";
import { theNegativeCacheThatOutlivedTheProblem } from "./the-negative-cache-that-outlived-the-problem";
import { theMtuMismatch } from "./the-mtu-mismatch";
import { theLoadBalancerIdleTimeout } from "./the-load-balancer-idle-timeout";
import { egressPortExhaustion } from "./egress-port-exhaustion";
import { splitBrainDns } from "./split-brain-dns";
import { theSilentTruncation } from "./the-silent-truncation";
import { theAutoboxingTrap } from "./the-autoboxing-trap";
import { theFinalizerThatWouldntLetGo } from "./the-finalizer-that-wouldnt-let-go";
import { timeZoneDrift } from "./time-zone-drift";
import { theSerializationTimeBomb } from "./the-serialization-time-bomb";
import { offTheCharsetPath } from "./off-the-charset-path";
import { theOptionalThatWasnt } from "./the-optional-that-wasnt";
import { theRecordsThatWouldntUpdate } from "./the-records-that-wouldnt-update";

import { certManagerRenewalSilentlyFailing } from "./cert-manager-renewal-silently-failing";
import { clusteripUsedExternallyFails } from "./clusterip-used-externally-fails";
import { connectionPoolVsServerIdleClose } from "./connection-pool-vs-server-idle-close";
import { corednsPodCpuThrottled } from "./coredns-pod-cpu-throttled";
import { crossNamespaceServiceFqdnMissing } from "./cross-namespace-service-fqdn-missing";
import { crossRegionLatencyMistakenForOutage } from "./cross-region-latency-mistaken-for-outage";
import { defaultBackendCatchingEverything } from "./default-backend-catching-everything";
import { defaultDenyBlocksDnsEgress } from "./default-deny-blocks-dns-egress";
import { defaultDenyBlocksExternalApi } from "./default-deny-blocks-external-api";
import { dnsRoundRobinCachingSingleIp } from "./dns-round-robin-caching-single-ip";
import { dnsSearchAppendedToFqdn } from "./dns-search-appended-to-fqdn";
import { dualStackIpv6OnlyClientFails } from "./dual-stack-ipv6-only-client-fails";
import { egressAllowCidrDrifted } from "./egress-allow-cidr-drifted";
import { egressCidrTypoBlockedEverything } from "./egress-cidr-typo-blocked-everything";
import { externalnameServiceStaleHost } from "./externalname-service-stale-host";
import { hairpinNatLoopbackFailure } from "./hairpin-nat-loopback-failure";
import { healthyPodsFailingLbHealthCheck } from "./healthy-pods-failing-lb-health-check";
import { heapCapVsContainerCap } from "./heap-cap-vs-container-cap";
import { hostnameTypoInTheUpstream } from "./hostname-typo-in-the-upstream";
import { http2MultiplexingHotspot } from "./http2-multiplexing-hotspot";
import { ingressAnnotationTypoIgnored } from "./ingress-annotation-typo-ignored";
import { ingressBodySizeTooSmall } from "./ingress-body-size-too-small";
import { ingressTimeoutTooShortForReport } from "./ingress-timeout-too-short-for-report";
import { irateVsRateMismatch } from "./irate-vs-rate-mismatch";
import { loadbalancerStuckPendingQuota } from "./loadbalancer-stuck-pending-quota";
import { mismatchedSidecarVersionsMtls } from "./mismatched-sidecar-versions-mtls";
import { missingCrossNamespaceEgressRule } from "./missing-cross-namespace-egress-rule";
import { movingTargetRevisionTypo } from "./moving-target-revision-typo";
import { negativeDnsCacheBlocksNewRecord } from "./negative-dns-cache-blocks-new-record";
import { negativeModuloSurprise } from "./negative-modulo-surprise";
import { netpolAllowsButSecuritygroupBlocks } from "./netpol-allows-but-securitygroup-blocks";
import { networkpolicyOrderBlocksMonitoring } from "./networkpolicy-order-blocks-monitoring";
import { networkpolicyPodselectorTypo } from "./networkpolicy-podselector-typo";
import { nodeportCalledFromInsideCluster } from "./nodeport-called-from-inside-cluster";
import { prestopMissingConnectionDrain } from "./prestop-missing-connection-drain";
import { proxyProtocolMismatchWrongClientIp } from "./proxy-protocol-mismatch-wrong-client-ip";
import { proxyProtocolNotEnabled } from "./proxy-protocol-not-enabled";
import { securityGroupAllowsButNetpolBlocks } from "./security-group-allows-but-netpol-blocks";
import { serviceSelectorLabelTypo } from "./service-selector-label-typo";
import { serviceSelectorMissingVersionLabel } from "./service-selector-missing-version-label";
import { sessionAffinityCookiePinnedToDeadPod } from "./session-affinity-cookie-pinned-to-dead-pod";
import { sidecarRewritesHostHeader } from "./sidecar-rewrites-host-header";
import { sniRoutesToTheWrongBackend } from "./sni-routes-to-the-wrong-backend";
import { stringReferenceEqualityTrap } from "./string-reference-equality-trap";
import { syncWindowLocksTheGate } from "./sync-window-locks-the-gate";
import { tcpVsHttpHealthCheckMismatch } from "./tcp-vs-http-health-check-mismatch";
import { theActuatorPortCollision } from "./the-actuator-port-collision";
import { theAdaptiveSamplerBlindSpot } from "./the-adaptive-sampler-blind-spot";
import { theAdmissionWebhookCascadeFailure } from "./the-admission-webhook-cascade-failure";
import { theAlertThatShoutedIntoTheVoid } from "./the-alert-that-shouted-into-the-void";
import { theAliasedGraph } from "./the-aliased-graph";
import { theAllThatWasntAll } from "./the-all-that-wasnt-all";
import { theAnalysisTemplateBadQuery } from "./the-analysis-template-bad-query";
import { theAnnotationInTheWrongPlace } from "./the-annotation-in-the-wrong-place";
import { theAnnotationOnTheWrongObject } from "./the-annotation-on-the-wrong-object";
import { theAnnotationThatNeededAControllerRestart } from "./the-annotation-that-needed-a-controller-restart";
import { theAnnotationThatWasntInherited } from "./the-annotation-that-wasnt-inherited";
import { theApiThatVanished } from "./the-api-that-vanished";
import { theAppOfAppsLoop } from "./the-app-of-apps-loop";
import { theAppStuckInProgressing } from "./the-app-stuck-in-progressing";
import { theAppWithNoOwner } from "./the-app-with-no-owner";
import { theApplicationThatWouldntDelete } from "./the-application-that-wouldnt-delete";
import { theAppprojectRepoAllowlist } from "./the-appproject-repo-allowlist";
import { theAppsetTemplatePatchBug } from "./the-appset-template-patch-bug";
import { theArrayThatRejectedItsOwnType } from "./the-array-that-rejected-its-own-type";
import { theAsyncAppenderThatDroppedLines } from "./the-async-appender-that-dropped-lines";
import { theAverageThatHidTheTotal } from "./the-average-that-hid-the-total";
import { theBatchThatNeverFlushed } from "./the-batch-that-never-flushed";
import { theBlockingJdbcInWebflux } from "./the-blocking-jdbc-in-webflux";
import { theBlockingPostconstruct } from "./the-blocking-postconstruct";
import { theBranchThatGotForcePushed } from "./the-branch-that-got-force-pushed";
import { theBreakerThatNeverTripped } from "./the-breaker-that-never-tripped";
import { theBrowserTimezoneMismatch } from "./the-browser-timezone-mismatch";
import { theBucketBoundaryLie } from "./the-bucket-boundary-lie";
import { theBufferThatGaveUp } from "./the-buffer-that-gave-up";
import { theBuilderEveryoneShared } from "./the-builder-everyone-shared";
import { theBulkheadTooTight } from "./the-bulkhead-too-tight";
import { theBurnRateThatFlapped } from "./the-burn-rate-that-flapped";
import { theCacheKeyThatNeverMatched } from "./the-cache-key-that-never-matched";
import { theCacheStampedeAtMidnight } from "./the-cache-stampede-at-midnight";
import { theCacheThatRememberedFailure } from "./the-cache-that-remembered-failure";
import { theCanaryThatAnalyzedNothing } from "./the-canary-that-analyzed-nothing";
import { theCascadingNodeDrainDeadlock } from "./the-cascading-node-drain-deadlock";
import { theCascadingPruneAcrossApps } from "./the-cascading-prune-across-apps";
import { theCastThatWorkedUntilItDidnt } from "./the-cast-that-worked-until-it-didnt";
import { theCatchThatSaidNothing } from "./the-catch-that-said-nothing";
import { theCdsArchiveDrift } from "./the-cds-archive-drift";
import { theCertRotationDropout } from "./the-cert-rotation-dropout";
import { theChannelThatStoppedListening } from "./the-channel-that-stopped-listening";
import { theChartDependencyThatDrifted } from "./the-chart-dependency-that-drifted";
import { theChildAppWithNoPath } from "./the-child-app-with-no-path";
import { theCliSyncThatDiverged } from "./the-cli-sync-that-diverged";
import { theCloseThatHidTheRealError } from "./the-close-that-hid-the-real-error";
import { theClusterGeneratorWithNoLabel } from "./the-cluster-generator-with-no-label";
import { theClusterResourceWhitelistGap } from "./the-cluster-resource-whitelist-gap";
import { theClusterSecretWithNoLabel } from "./the-cluster-secret-with-no-label";
import { theClusterThatLostItsLabel } from "./the-cluster-that-lost-its-label";
import { theCmpWithATypo } from "./the-cmp-with-a-typo";
import { theComparableThatDisagreedWithEquals } from "./the-comparable-that-disagreed-with-equals";
import { theConditionalBeanThatFlipped } from "./the-conditional-bean-that-flipped";
import { theConfigRefreshThatDidntStick } from "./the-config-refresh-that-didnt-stick";
import { theConfigmapHashSuffixMismatch } from "./the-configmap-hash-suffix-mismatch";
import { theConfigmapKeyRename } from "./the-configmap-key-rename";
import { theConfigmapSyncDelayFlap } from "./the-configmap-sync-delay-flap";
import { theConfigmapThatOutlivedItsApp } from "./the-configmap-that-outlived-its-app";
import { theConnectionThatNeverCameBack } from "./the-connection-that-never-came-back";
import { theCounterThatAppearedToCrash } from "./the-counter-that-appeared-to-crash";
import { theCpuQuotaInvisibleToTheJvm } from "./the-cpu-quota-invisible-to-the-jvm";
import { theCrashingSidecarCommand } from "./the-crashing-sidecar-command";
import { theCrdThatNeededValidateFalse } from "./the-crd-that-needed-validate-false";
import { theCreateNamespaceToggle } from "./the-create-namespace-toggle";
import { theCronjobDoubleRun } from "./the-cronjob-double-run";
import { theCsiAttachStall } from "./the-csi-attach-stall";
import { theDaemonsetThatSkippedANode } from "./the-daemonset-that-skipped-a-node";
import { theDashboardThatNeverUpdated } from "./the-dashboard-that-never-updated";
import { theDatasourceThatAssumedWrong } from "./the-datasource-that-assumed-wrong";
import { theDeadlineThatEvaporated } from "./the-deadline-that-evaporated";
import { theDebugContainerMixup } from "./the-debug-container-mixup";
import { theDecimalThatSpokeGerman } from "./the-decimal-that-spoke-german";
import { theDecommissionedEndpointCache } from "./the-decommissioned-endpoint-cache";
import { theDefensiveCopyThatWasnt } from "./the-defensive-copy-that-wasnt";
import { theDiamondThatWasntResolved } from "./the-diamond-that-wasnt-resolved";
import { theDiffThatTookTooLong } from "./the-diff-that-took-too-long";
import { theDiskThatFilledWithLogs } from "./the-disk-that-filled-with-logs";
import { theDoubleFireScheduledJob } from "./the-double-fire-scheduled-job";
import { theDoubleThatCouldntCountMoney } from "./the-double-that-couldnt-count-money";
import { theEmptyProfileFallback } from "./the-empty-profile-fallback";
import { theEmptydirAmnesia } from "./the-emptydir-amnesia";
import { theEnumThatForgotItsOrder } from "./the-enum-that-forgot-its-order";
import { theEvaluationIntervalThatBlinked } from "./the-evaluation-interval-that-blinked";
import { theExemplarThatPointedNowhere } from "./the-exemplar-that-pointed-nowhere";
import { theExpiredDeployKey } from "./the-expired-deploy-key";
import { theExpiredIntegrationKey } from "./the-expired-integration-key";
import { theExpiredPullSecret } from "./the-expired-pull-secret";
import { theFederationGap } from "./the-federation-gap";
import { theFieldManagerStandoff } from "./the-field-manager-standoff";
import { theFinalizerThatBlockedCleanup } from "./the-finalizer-that-blocked-cleanup";
import { theFinallyThatAteTheException } from "./the-finally-that-ate-the-exception";
import { theFirewallRuleThatExpired } from "./the-firewall-rule-that-expired";
import { theFiveMinutePoll } from "./the-five-minute-poll";
import { theFlappingAlertWithNoForClause } from "./the-flapping-alert-with-no-for-clause";
import { theForClauseThatWaitedTooLong } from "./the-for-clause-that-waited-too-long";
import { theForbiddenController } from "./the-forbidden-controller";
import { theForgottenServerPort } from "./the-forgotten-server-port";
import { theFormatterEveryoneShared } from "./the-formatter-everyone-shared";
import { theFqdnThatShouldHaveHadADot } from "./the-fqdn-that-should-have-had-a-dot";
import { theFreezeWindowNobodyRemembered } from "./the-freeze-window-nobody-remembered";
import { theFsgroupMismatch } from "./the-fsgroup-mismatch";
import { theG1ThreadCountIllusion } from "./the-g1-thread-count-illusion";
import { theGeneratorPathThatMoved } from "./the-generator-path-that-moved";
import { theGenericArrayThatCouldntExist } from "./the-generic-array-that-couldnt-exist";
import { theGpuSchedulingGap } from "./the-gpu-scheduling-gap";
import { theGracefulShutdownThatWasnt } from "./the-graceful-shutdown-that-wasnt";
import { theGracefulShutdownTimeoutTooShort } from "./the-graceful-shutdown-timeout-too-short";
import { theGrokPatternThatGaveUp } from "./the-grok-pattern-that-gave-up";
import { theHardcodedJobLabel } from "./the-hardcoded-job-label";
import { theHashmapThatForgotItsOrder } from "./the-hashmap-that-forgot-its-order";
import { theHeadlessDnsRace } from "./the-headless-dns-race";
import { theHeadlessServiceThatWasntHeadless } from "./the-headless-service-that-wasnt-headless";
import { theHealthCheckThatOutranTheApp } from "./the-health-check-that-outran-the-app";
import { theHealthCheckThatSaidHealthy } from "./the-health-check-that-said-healthy";
import { theHeatmapThatHidTheSpike } from "./the-heatmap-that-hid-the-spike";
import { theHelmLookupThatFailed } from "./the-helm-lookup-that-failed";
import { theHistogramThatLied } from "./the-histogram-that-lied";
import { theHookDeletePolicySurprise } from "./the-hook-delete-policy-surprise";
import { theHostnetworkPortCollision } from "./the-hostnetwork-port-collision";
import { theHostpathPermissionWall } from "./the-hostpath-permission-wall";
import { theHpaMetricsServerGap } from "./the-hpa-metrics-server-gap";
import { theHpaReplicaDiffNoise } from "./the-hpa-replica-diff-noise";
import { theHpaSelfhealStandoff } from "./the-hpa-selfheal-standoff";
import { theHpaTugOfWar } from "./the-hpa-tug-of-war";
import { theIdleProxyHangup } from "./the-idle-proxy-hangup";
import { theIdleTimeoutMismatch } from "./the-idle-timeout-mismatch";
import { theIgnoreDifferencesTypo } from "./the-ignore-differences-typo";
import { theIlmPolicyThatAteYesterday } from "./the-ilm-policy-that-ate-yesterday";
import { theImageUpdaterPickedWrong } from "./the-image-updater-picked-wrong";
import { theImmutableConfigmapStandoff } from "./the-immutable-configmap-standoff";
import { theImpatientInitContainer } from "./the-impatient-init-container";
import { theInPlaceResizeRejection } from "./the-in-place-resize-rejection";
import { theInconsistentRefresh } from "./the-inconsistent-refresh";
import { theIncreaseThatOvercounted } from "./the-increase-that-overcounted";
import { theIngressPathOrderShadowedARoute } from "./the-ingress-path-order-shadowed-a-route";
import { theIngressRewriteTargetMismatch } from "./the-ingress-rewrite-target-mismatch";
import { theIngressTlsBlockMissingHost } from "./the-ingress-tls-block-missing-host";
import { theIngressWithTwoHostsOneWrongTls } from "./the-ingress-with-two-hosts-one-wrong-tls";
import { theInhibitionRuleThatWentTooFar } from "./the-inhibition-rule-that-went-too-far";
import { theInitContainerRace } from "./the-init-container-race";
import { theInternedStringThatWasnt } from "./the-interned-string-that-wasnt";
import { theIteratorThatSkippedARecord } from "./the-iterator-that-skipped-a-record";
import { theJacksonTimezoneRegression } from "./the-jackson-timezone-regression";
import { theJobParallelismPvcCollision } from "./the-job-parallelism-pvc-collision";
import { theJobThatGaveUp } from "./the-job-that-gave-up";
import { theJobThatNeverCompleted } from "./the-job-that-never-completed";
import { theJsonnetImportError } from "./the-jsonnet-import-error";
import { theKeepAliveVsLbIdleFlap } from "./the-keep-alive-vs-lb-idle-flap";
import { theKeepaliveThatOutlivedTheServer } from "./the-keepalive-that-outlived-the-server";
import { theKeyThatChangedItsMind } from "./the-key-that-changed-its-mind";
import { theLambdaThatRememberedTheWrongValue } from "./the-lambda-that-remembered-the-wrong-value";
import { theLazyBeanThatWasntLazyEnough } from "./the-lazy-bean-that-wasnt-lazy-enough";
import { theLbThatRoundRobinsWrong } from "./the-lb-that-round-robins-wrong";
import { theLeaderElectionLeaseExpiryStorm } from "./the-leader-election-lease-expiry-storm";
import { theLeaseSplitBrain } from "./the-lease-split-brain";
import { theLimitrangeDefaultTrap } from "./the-limitrange-default-trap";
import { theListThatChangedUnderneath } from "./the-list-that-changed-underneath";
import { theListThatWouldntGrow } from "./the-list-that-wouldnt-grow";
import { theListenerThatNeverScaled } from "./the-listener-that-never-scaled";
import { theLivenessProbeTouchingASlowBean } from "./the-liveness-probe-touching-a-slow-bean";
import { theLogAgentThatFilledTheDisk } from "./the-log-agent-that-filled-the-disk";
import { theLoggerSetToQuiet } from "./the-logger-set-to-quiet";
import { theLuaScriptThatLied } from "./the-lua-script-that-lied";
import { theManualGcCall } from "./the-manual-gc-call";
import { theMapThatNeverMatched } from "./the-map-that-never-matched";
import { theMappingExplosion } from "./the-mapping-explosion";
import { theMatrixThatMultiplied } from "./the-matrix-that-multiplied";
import { theMemoryLimitThatWasntEnough } from "./the-memory-limit-that-wasnt-enough";
import { theMemoryLimiterThatDroppedSilently } from "./the-memory-limiter-that-dropped-silently";
import { theMemoryQuotaWall } from "./the-memory-quota-wall";
import { theMeshEgressGatewayBypassed } from "./the-mesh-egress-gateway-bypassed";
import { theMessageThatLostItsTrace } from "./the-message-that-lost-its-trace";
import { theMetricsBlindSpot } from "./the-metrics-blind-spot";
import { theMetricsCardinalityExplosion } from "./the-metrics-cardinality-explosion";
import { theMinorBumpThatFlippedADefault } from "./the-minor-bump-that-flipped-a-default";
import { theMismatchedScrapeIntervals } from "./the-mismatched-scrape-intervals";
import { theMissedCronWindow } from "./the-missed-cron-window";
import { theMissingImageTag } from "./the-missing-image-tag";
import { theMissingValuesFile } from "./the-missing-values-file";
import { theModuleThatSaidNo } from "./the-module-that-said-no";
import { theMultiAppPdbStandoff } from "./the-multi-app-pdb-standoff";
import { theMultipartSizeLimit } from "./the-multipart-size-limit";
import { theMutatingWebhookTimeout } from "./the-mutating-webhook-timeout";
import { theNamespaceThatNeverAppeared } from "./the-namespace-that-never-appeared";
import { theNativeImageMissingReflection } from "./the-native-image-missing-reflection";
import { theNativeSidecarTerminationBlock } from "./the-native-sidecar-termination-block";
import { theNdotsTax } from "./the-ndots-tax";
import { theNetworkPartitionAttachDeadlock } from "./the-network-partition-attach-deadlock";
import { theNodeAffinityStalePoolLabel } from "./the-node-affinity-stale-pool-label";
import { theNodeLocalDnsCacheStale } from "./the-node-local-dns-cache-stale";
import { theNodePressureCascade } from "./the-node-pressure-cascade";
import { theNodeSelectorLabelDrift } from "./the-node-selector-label-drift";
import { theNotificationOnTheWrongEvent } from "./the-notification-on-the-wrong-event";
import { theNotificationThatNeverFired } from "./the-notification-that-never-fired";
import { theNullThatBrokeThePattern } from "./the-null-that-broke-the-pattern";
import { theOneInAThousandTrace } from "./the-one-in-a-thousand-trace";
import { theOptionalFieldThatHeldNull } from "./the-optional-field-that-held-null";
import { theOptionalOfNullableMixup } from "./the-optional-of-nullable-mixup";
import { theOrphanNobodyPruned } from "./the-orphan-nobody-pruned";
import { theOrphanedFinalizer } from "./the-orphaned-finalizer";
import { theOrphanedResourcesWarning } from "./the-orphaned-resources-warning";
import { theOvercommittedNode } from "./the-overcommitted-node";
import { theOverlayThatWasntIncluded } from "./the-overlay-that-wasnt-included";
import { theOwnershipMigrationThatBroke } from "./the-ownership-migration-that-broke";
import { thePatchThatAppliedFirst } from "./the-patch-that-applied-first";
import { thePathThatWorkedOnMyMachine } from "./the-path-that-worked-on-my-machine";
import { thePathmatchStrategyFlip } from "./the-pathmatch-strategy-flip";
import { thePatternVariableThatLeaked } from "./the-pattern-variable-that-leaked";
import { thePercentageThatWasntEnough } from "./the-percentage-that-wasnt-enough";
import { thePinnedChartVersion } from "./the-pinned-chart-version";
import { thePluginSidecarThatCrashed } from "./the-plugin-sidecar-that-crashed";
import { thePluginWithNoEnv } from "./the-plugin-with-no-env";
import { thePodsThatWouldntCleanUp } from "./the-pods-that-wouldnt-clean-up";
import { thePolicyCsvLockout } from "./the-policy-csv-lockout";
import { thePolicyCsvOvergrant } from "./the-policy-csv-overgrant";
import { thePostRendererThatBrokeOutput } from "./the-post-renderer-that-broke-output";
import { thePosthookThatNeverFinished } from "./the-posthook-that-never-finished";
import { thePostsyncFailurePolicy } from "./the-postsync-failure-policy";
import { thePreemptionPriorityInversion } from "./the-preemption-priority-inversion";
import { thePrestopHookHang } from "./the-prestop-hook-hang";
import { thePriorityEvictionSurprise } from "./the-priority-eviction-surprise";
import { thePriorityQueueSurprise } from "./the-priority-queue-surprise";
import { theProbeThatAlwaysSaidYes } from "./the-probe-that-always-said-yes";
import { thePruneThatTookANeighbor } from "./the-prune-that-took-a-neighbor";
import { thePullRequestGeneratorGoneStale } from "./the-pull-request-generator-gone-stale";
import { theQueueThatQuietlyDroppedSamples } from "./the-queue-that-quietly-dropped-samples";
import { theQuietConcurrentModification } from "./the-quiet-concurrentmodification";
import { theQuotaCpuLimitWall } from "./the-quota-cpu-limit-wall";
import { theRandomThatCollided } from "./the-random-that-collided";
import { theReadOnlyFilesystemSurprise } from "./the-read-only-filesystem-surprise";
import { theReadinessProbeThatAskedTooMuch } from "./the-readiness-probe-that-asked-too-much";
import { theRebalanceStorm } from "./the-rebalance-storm";
import { theReconcileLoopStorm } from "./the-reconcile-loop-storm";
import { theRecordThatNeverEqualedItself } from "./the-record-that-never-equaled-itself";
import { theRefreshScopeOnTheWrongBean } from "./the-refresh-scope-on-the-wrong-bean";
import { theRegexThatCaughtTooMuch } from "./the-regex-that-caught-too-much";
import { theRegexThatFellBehind } from "./the-regex-that-fell-behind";
import { theRegexThatSplitWrong } from "./the-regex-that-split-wrong";
import { theRelabelRegexThatMissedTheRename } from "./the-relabel-regex-that-missed-the-rename";
import { theRelabelRuleThatDroppedTooMuch } from "./the-relabel-rule-that-dropped-too-much";
import { theRenamedPropertyThatStillWorked } from "./the-renamed-property-that-still-worked";
import { theRepoServerCertThatExpired } from "./the-repo-server-cert-that-expired";
import { theResourceExclusionNobodyRemembered } from "./the-resource-exclusion-nobody-remembered";
import { theRetentionCliff } from "./the-retention-cliff";
import { theRetryThatNeverRetried } from "./the-retry-that-never-retried";
import { theRootOnlyImage } from "./the-root-only-image";
import { theRotatedCertNobodyTrusted } from "./the-rotated-cert-nobody-trusted";
import { theRotatedDeployKey } from "./the-rotated-deploy-key";
import { theRoundingThatDidntMatch } from "./the-rounding-that-didnt-match";
import { theRouteNobodyMatched } from "./the-route-nobody-matched";
import { theRuleThatOutlivedTheMetric } from "./the-rule-that-outlived-the-metric";
import { theSamplerThatHatedErrors } from "./the-sampler-that-hated-errors";
import { theSavedSearchWithAMemory } from "./the-saved-search-with-a-memory";
import { theScaleMismatch } from "./the-scale-mismatch";
import { theScaledToZeroMystery } from "./the-scaled-to-zero-mystery";
import { theScalingTugOfWar } from "./the-scaling-tug-of-war";
import { theSearchDomainShadow } from "./the-search-domain-shadow";
import { theSecretRotationEnvMismatch } from "./the-secret-rotation-env-mismatch";
import { theSecretThatWasntMountedForTls } from "./the-secret-that-wasnt-mounted-for-tls";
import { theSelfhealThatRevertedTheFix } from "./the-selfheal-that-reverted-the-fix";
import { theSemverConstraintThatWasnt } from "./the-semver-constraint-that-wasnt";
import { theServiceMeshRetryStorm } from "./the-service-mesh-retry-storm";
import { theSessionIdThatAtePrometheus } from "./the-session-id-that-ate-prometheus";
import { theShallowCloneSurprise } from "./the-shallow-clone-surprise";
import { theShardThatStayedHome } from "./the-shard-that-stayed-home";
import { theSharedCacheCountedThrice } from "./the-shared-cache-counted-thrice";
import { theSidecarMemoryTax } from "./the-sidecar-memory-tax";
import { theSidecarThatStartedFirst } from "./the-sidecar-that-started-first";
import { theSidecarWithTheMicrophone } from "./the-sidecar-with-the-microphone";
import { theSilenceThatOutlivedTheIncident } from "./the-silence-that-outlived-the-incident";
import { theSortThatBrokeItself } from "./the-sort-that-broke-itself";
import { theStackTraceThatShattered } from "./the-stack-trace-that-shattered";
import { theStaleLabelScheduler } from "./the-stale-label-scheduler";
import { theStartupThatWaitedOnDns } from "./the-startup-that-waited-on-dns";
import { theStatefulsetScaleDownPdbMiscalc } from "./the-statefulset-scale-down-pdb-miscalc";
import { theStatefulsetStartupJam } from "./the-statefulset-startup-jam";
import { theStatefulsetStorageclassMismatch } from "./the-statefulset-storageclass-mismatch";
import { theStatefulsetWaitForFirstConsumerTrap } from "./the-statefulset-wait-for-first-consumer-trap";
import { theStaticFieldThatLoadedTooEarly } from "./the-static-field-that-loaded-too-early";
import { theStatusSubresourceDiffLoop } from "./the-status-subresource-diff-loop";
import { theStreamSelectorThatMissedEverything } from "./the-stream-selector-that-missed-everything";
import { theStreamThatNeverRan } from "./the-stream-that-never-ran";
import { theStreamYouCantReuse } from "./the-stream-you-cant-reuse";
import { theStringDuplicationBloat } from "./the-string-duplication-bloat";
import { theStructuredConcurrencyOrphan } from "./the-structured-concurrency-orphan";
import { theSubmoduleRepoServerCouldntSee } from "./the-submodule-repo-server-couldnt-see";
import { theSubpathTypo } from "./the-subpath-typo";
import { theSuppressedExceptionThatHidTheTruth } from "./the-suppressed-exception-that-hid-the-truth";
import { theSurgeReadinessGateStall } from "./the-surge-readiness-gate-stall";
import { theSvcPortThatDidntMatchTargetPort } from "./the-svc-port-that-didnt-match-target-port";
import { theSwitchThatFellThrough } from "./the-switch-that-fell-through";
import { theSwitchThatThoughtItWasComplete } from "./the-switch-that-thought-it-was-complete";
import { theSyncWaveDeadlock } from "./the-sync-wave-deadlock";
import { theSyntheticCheckInTheWrongRegion } from "./the-synthetic-check-in-the-wrong-region";
import { theTagStrategyMismatch } from "./the-tag-strategy-mismatch";
import { theTagThatBecameABranch } from "./the-tag-that-became-a-branch";
import { theTaintThatEvictedYouLater } from "./the-taint-that-evicted-you-later";
import { theTerminatingNamespaceFinalizerStall } from "./the-terminating-namespace-finalizer-stall";
import { theTextBlockThatLostItsIndentation } from "./the-text-block-that-lost-its-indentation";
import { theThreadPoolDrainedBySilence } from "./the-thread-pool-drained-by-silence";
import { theThreadThatRemembered } from "./the-thread-that-remembered";
import { theTimeFieldThatWasnt } from "./the-time-field-that-wasnt";
import { theTopologyAwareHintsFailure } from "./the-topology-aware-hints-failure";
import { theTopologySpreadIllusion } from "./the-topology-spread-illusion";
import { theTopologySpreadVolumeConflict } from "./the-topology-spread-volume-conflict";
import { theTostringThatNeverStopped } from "./the-tostring-that-never-stopped";
import { theTrackingLabelMismatch } from "./the-tracking-label-mismatch";
import { theTransactionalPropagationSurprise } from "./the-transactional-propagation-surprise";
import { theTruncatedAverage } from "./the-truncated-average";
import { theTruncatedSpan } from "./the-truncated-span";
import { theTurkishIProblem } from "./the-turkish-i-problem";
import { theTwoHooksSameWave } from "./the-two-hooks-same-wave";
import { theTwoSchedulersRace } from "./the-two-schedulers-race";
import { theTwoSourcesThatDisagreed } from "./the-two-sources-that-disagreed";
import { theTypoInTheProfileVar } from "./the-typo-in-the-profile-var";
import { theUiSyncThatGitForgot } from "./the-ui-sync-that-git-forgot";
import { theUncheckedCastThatCameBack } from "./the-unchecked-cast-that-came-back";
import { theUnexpectedEnum } from "./the-unexpected-enum";
import { theUnquotedSyncWave } from "./the-unquoted-sync-wave";
import { theUnsignedCommit } from "./the-unsigned-commit";
import { theUpMetricThatLied } from "./the-up-metric-that-lied";
import { theValidationMessageThatPointedElsewhere } from "./the-validation-message-that-pointed-elsewhere";
import { theValueFrozenAtBoot } from "./the-value-frozen-at-boot";
import { theValuesFileThatLost } from "./the-values-file-that-lost";
import { theVanishingRollback } from "./the-vanishing-rollback";
import { theVarargsThatPickedWrong } from "./the-varargs-that-picked-wrong";
import { theVariablePointedElsewhere } from "./the-variable-pointed-elsewhere";
import { theVersionThatCouldntDeserialize } from "./the-version-that-couldnt-deserialize";
import { theVpaHpaFight } from "./the-vpa-hpa-fight";
import { theVpaOomLoop } from "./the-vpa-oom-loop";
import { theWalThatLostAnHour } from "./the-wal-that-lost-an-hour";
import { theWebclientWithNoTimeout } from "./the-webclient-with-no-timeout";
import { theWebhookSilentMutation } from "./the-webhook-silent-mutation";
import { theWebhookThatRejectedEverything } from "./the-webhook-that-rejected-everything";
import { theWebhookThatStoppedArriving } from "./the-webhook-that-stopped-arriving";
import { theWildcardThatGotTooClever } from "./the-wildcard-that-got-too-clever";
import { theWrongClusterContext } from "./the-wrong-cluster-context";
import { theWrongContentTypeResponse } from "./the-wrong-content-type-response";
import { theYamlListThatBecameAString } from "./the-yaml-list-that-became-a-string";
import { twoServicesSameSelector } from "./two-services-same-selector";
import { whyWontItJustSync } from "./why-wont-it-just-sync";
import { wildcardRecordShadowsSpecific } from "./wildcard-record-shadows-specific";
import { wrongIngressClassPickedUpNothing } from "./wrong-ingress-class-picked-up-nothing";

export * from "./types";

const DIFFICULTY_ORDER: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

export const scenarios: Scenario[] = [
  stuckAt3am,
  zombiePods,
  driftInTheDark,
  lockedOut,
  helmGoneWrong,
  hookThatWouldntDie,
  silentFailure,
  sigtermNeverArrived,
  virtualThreadsRealProblems,
  heapThatWasntTheProblem,
  noDataKnowProblem,
  alertThatNeverFired,
  tooManySeries,
  whereDidTheLogsGo,
  blockedAtTheBorder,
  theIngressThatWasnt,
  theFiveSecondDelay,
  theSandboxThatWasnt,
  eightToTwentyFive,
  theCacheThatForgot,
  theConfigmapThatLied,
  deathByLivenessProbe,
  thePvcThatFollowedYou,
  quotaOfSilence,
  theWrongToleration,
  initContainerPurgatory,
  poddisruptionbudgetDeadlock,
  theAntiAffinityTrap,
  theScalingSeesaw,
  theSidecarThatWouldntDie,
  theAppThatSyncedTwice,
  healthCheckBlindSpot,
  thePruneThatWasnt,
  syncWavesOutOfOrder,
  theRepoServerTimeout,
  clusterSecretDrift,
  theIgnoredDiff,
  appsetMultiplication,
  theProbeThatStartedTooSoon,
  theAotCacheMismatch,
  zgcPausesInDisguise,
  theClassloaderLeak,
  theStartupProbeRace,
  theNonRootUploadFailure,
  configServerThunderingHerd,
  theProfileThatWasntPackaged,
  theTraceThatWentNowhere,
  doubleCounted,
  theBlindSpotBehindTheSidecar,
  recordingRuleRoulette,
  theKibanaTimeFilterTrap,
  syntheticButNotReally,
  theAlertThatPagedTheWrongTeam,
  logSamplingBlindness,
  theStaleEndpoint,
  eastWestMtlsRejected,
  theLoadBalancerThatWasntBalancing,
  theNegativeCacheThatOutlivedTheProblem,
  theMtuMismatch,
  theLoadBalancerIdleTimeout,
  egressPortExhaustion,
  splitBrainDns,
  theSilentTruncation,
  theAutoboxingTrap,
  theFinalizerThatWouldntLetGo,
  timeZoneDrift,
  theSerializationTimeBomb,
  offTheCharsetPath,
  theOptionalThatWasnt,
  theRecordsThatWouldntUpdate,
  certManagerRenewalSilentlyFailing,
  clusteripUsedExternallyFails,
  connectionPoolVsServerIdleClose,
  corednsPodCpuThrottled,
  crossNamespaceServiceFqdnMissing,
  crossRegionLatencyMistakenForOutage,
  defaultBackendCatchingEverything,
  defaultDenyBlocksDnsEgress,
  defaultDenyBlocksExternalApi,
  dnsRoundRobinCachingSingleIp,
  dnsSearchAppendedToFqdn,
  dualStackIpv6OnlyClientFails,
  egressAllowCidrDrifted,
  egressCidrTypoBlockedEverything,
  externalnameServiceStaleHost,
  hairpinNatLoopbackFailure,
  healthyPodsFailingLbHealthCheck,
  heapCapVsContainerCap,
  hostnameTypoInTheUpstream,
  http2MultiplexingHotspot,
  ingressAnnotationTypoIgnored,
  ingressBodySizeTooSmall,
  ingressTimeoutTooShortForReport,
  irateVsRateMismatch,
  loadbalancerStuckPendingQuota,
  mismatchedSidecarVersionsMtls,
  missingCrossNamespaceEgressRule,
  movingTargetRevisionTypo,
  negativeDnsCacheBlocksNewRecord,
  negativeModuloSurprise,
  netpolAllowsButSecuritygroupBlocks,
  networkpolicyOrderBlocksMonitoring,
  networkpolicyPodselectorTypo,
  nodeportCalledFromInsideCluster,
  prestopMissingConnectionDrain,
  proxyProtocolMismatchWrongClientIp,
  proxyProtocolNotEnabled,
  securityGroupAllowsButNetpolBlocks,
  serviceSelectorLabelTypo,
  serviceSelectorMissingVersionLabel,
  sessionAffinityCookiePinnedToDeadPod,
  sidecarRewritesHostHeader,
  sniRoutesToTheWrongBackend,
  stringReferenceEqualityTrap,
  syncWindowLocksTheGate,
  tcpVsHttpHealthCheckMismatch,
  theActuatorPortCollision,
  theAdaptiveSamplerBlindSpot,
  theAdmissionWebhookCascadeFailure,
  theAlertThatShoutedIntoTheVoid,
  theAliasedGraph,
  theAllThatWasntAll,
  theAnalysisTemplateBadQuery,
  theAnnotationInTheWrongPlace,
  theAnnotationOnTheWrongObject,
  theAnnotationThatNeededAControllerRestart,
  theAnnotationThatWasntInherited,
  theApiThatVanished,
  theAppOfAppsLoop,
  theAppStuckInProgressing,
  theAppWithNoOwner,
  theApplicationThatWouldntDelete,
  theAppprojectRepoAllowlist,
  theAppsetTemplatePatchBug,
  theArrayThatRejectedItsOwnType,
  theAsyncAppenderThatDroppedLines,
  theAverageThatHidTheTotal,
  theBatchThatNeverFlushed,
  theBlockingJdbcInWebflux,
  theBlockingPostconstruct,
  theBranchThatGotForcePushed,
  theBreakerThatNeverTripped,
  theBrowserTimezoneMismatch,
  theBucketBoundaryLie,
  theBufferThatGaveUp,
  theBuilderEveryoneShared,
  theBulkheadTooTight,
  theBurnRateThatFlapped,
  theCacheKeyThatNeverMatched,
  theCacheStampedeAtMidnight,
  theCacheThatRememberedFailure,
  theCanaryThatAnalyzedNothing,
  theCascadingNodeDrainDeadlock,
  theCascadingPruneAcrossApps,
  theCastThatWorkedUntilItDidnt,
  theCatchThatSaidNothing,
  theCdsArchiveDrift,
  theCertRotationDropout,
  theChannelThatStoppedListening,
  theChartDependencyThatDrifted,
  theChildAppWithNoPath,
  theCliSyncThatDiverged,
  theCloseThatHidTheRealError,
  theClusterGeneratorWithNoLabel,
  theClusterResourceWhitelistGap,
  theClusterSecretWithNoLabel,
  theClusterThatLostItsLabel,
  theCmpWithATypo,
  theComparableThatDisagreedWithEquals,
  theConditionalBeanThatFlipped,
  theConfigRefreshThatDidntStick,
  theConfigmapHashSuffixMismatch,
  theConfigmapKeyRename,
  theConfigmapSyncDelayFlap,
  theConfigmapThatOutlivedItsApp,
  theConnectionThatNeverCameBack,
  theCounterThatAppearedToCrash,
  theCpuQuotaInvisibleToTheJvm,
  theCrashingSidecarCommand,
  theCrdThatNeededValidateFalse,
  theCreateNamespaceToggle,
  theCronjobDoubleRun,
  theCsiAttachStall,
  theDaemonsetThatSkippedANode,
  theDashboardThatNeverUpdated,
  theDatasourceThatAssumedWrong,
  theDeadlineThatEvaporated,
  theDebugContainerMixup,
  theDecimalThatSpokeGerman,
  theDecommissionedEndpointCache,
  theDefensiveCopyThatWasnt,
  theDiamondThatWasntResolved,
  theDiffThatTookTooLong,
  theDiskThatFilledWithLogs,
  theDoubleFireScheduledJob,
  theDoubleThatCouldntCountMoney,
  theEmptyProfileFallback,
  theEmptydirAmnesia,
  theEnumThatForgotItsOrder,
  theEvaluationIntervalThatBlinked,
  theExemplarThatPointedNowhere,
  theExpiredDeployKey,
  theExpiredIntegrationKey,
  theExpiredPullSecret,
  theFederationGap,
  theFieldManagerStandoff,
  theFinalizerThatBlockedCleanup,
  theFinallyThatAteTheException,
  theFirewallRuleThatExpired,
  theFiveMinutePoll,
  theFlappingAlertWithNoForClause,
  theForClauseThatWaitedTooLong,
  theForbiddenController,
  theForgottenServerPort,
  theFormatterEveryoneShared,
  theFqdnThatShouldHaveHadADot,
  theFreezeWindowNobodyRemembered,
  theFsgroupMismatch,
  theG1ThreadCountIllusion,
  theGeneratorPathThatMoved,
  theGenericArrayThatCouldntExist,
  theGpuSchedulingGap,
  theGracefulShutdownThatWasnt,
  theGracefulShutdownTimeoutTooShort,
  theGrokPatternThatGaveUp,
  theHardcodedJobLabel,
  theHashmapThatForgotItsOrder,
  theHeadlessDnsRace,
  theHeadlessServiceThatWasntHeadless,
  theHealthCheckThatOutranTheApp,
  theHealthCheckThatSaidHealthy,
  theHeatmapThatHidTheSpike,
  theHelmLookupThatFailed,
  theHistogramThatLied,
  theHookDeletePolicySurprise,
  theHostnetworkPortCollision,
  theHostpathPermissionWall,
  theHpaMetricsServerGap,
  theHpaReplicaDiffNoise,
  theHpaSelfhealStandoff,
  theHpaTugOfWar,
  theIdleProxyHangup,
  theIdleTimeoutMismatch,
  theIgnoreDifferencesTypo,
  theIlmPolicyThatAteYesterday,
  theImageUpdaterPickedWrong,
  theImmutableConfigmapStandoff,
  theImpatientInitContainer,
  theInPlaceResizeRejection,
  theInconsistentRefresh,
  theIncreaseThatOvercounted,
  theIngressPathOrderShadowedARoute,
  theIngressRewriteTargetMismatch,
  theIngressTlsBlockMissingHost,
  theIngressWithTwoHostsOneWrongTls,
  theInhibitionRuleThatWentTooFar,
  theInitContainerRace,
  theInternedStringThatWasnt,
  theIteratorThatSkippedARecord,
  theJacksonTimezoneRegression,
  theJobParallelismPvcCollision,
  theJobThatGaveUp,
  theJobThatNeverCompleted,
  theJsonnetImportError,
  theKeepAliveVsLbIdleFlap,
  theKeepaliveThatOutlivedTheServer,
  theKeyThatChangedItsMind,
  theLambdaThatRememberedTheWrongValue,
  theLazyBeanThatWasntLazyEnough,
  theLbThatRoundRobinsWrong,
  theLeaderElectionLeaseExpiryStorm,
  theLeaseSplitBrain,
  theLimitrangeDefaultTrap,
  theListThatChangedUnderneath,
  theListThatWouldntGrow,
  theListenerThatNeverScaled,
  theLivenessProbeTouchingASlowBean,
  theLogAgentThatFilledTheDisk,
  theLoggerSetToQuiet,
  theLuaScriptThatLied,
  theManualGcCall,
  theMapThatNeverMatched,
  theMappingExplosion,
  theMatrixThatMultiplied,
  theMemoryLimitThatWasntEnough,
  theMemoryLimiterThatDroppedSilently,
  theMemoryQuotaWall,
  theMeshEgressGatewayBypassed,
  theMessageThatLostItsTrace,
  theMetricsBlindSpot,
  theMetricsCardinalityExplosion,
  theMinorBumpThatFlippedADefault,
  theMismatchedScrapeIntervals,
  theMissedCronWindow,
  theMissingImageTag,
  theMissingValuesFile,
  theModuleThatSaidNo,
  theMultiAppPdbStandoff,
  theMultipartSizeLimit,
  theMutatingWebhookTimeout,
  theNamespaceThatNeverAppeared,
  theNativeImageMissingReflection,
  theNativeSidecarTerminationBlock,
  theNdotsTax,
  theNetworkPartitionAttachDeadlock,
  theNodeAffinityStalePoolLabel,
  theNodeLocalDnsCacheStale,
  theNodePressureCascade,
  theNodeSelectorLabelDrift,
  theNotificationOnTheWrongEvent,
  theNotificationThatNeverFired,
  theNullThatBrokeThePattern,
  theOneInAThousandTrace,
  theOptionalFieldThatHeldNull,
  theOptionalOfNullableMixup,
  theOrphanNobodyPruned,
  theOrphanedFinalizer,
  theOrphanedResourcesWarning,
  theOvercommittedNode,
  theOverlayThatWasntIncluded,
  theOwnershipMigrationThatBroke,
  thePatchThatAppliedFirst,
  thePathThatWorkedOnMyMachine,
  thePathmatchStrategyFlip,
  thePatternVariableThatLeaked,
  thePercentageThatWasntEnough,
  thePinnedChartVersion,
  thePluginSidecarThatCrashed,
  thePluginWithNoEnv,
  thePodsThatWouldntCleanUp,
  thePolicyCsvLockout,
  thePolicyCsvOvergrant,
  thePostRendererThatBrokeOutput,
  thePosthookThatNeverFinished,
  thePostsyncFailurePolicy,
  thePreemptionPriorityInversion,
  thePrestopHookHang,
  thePriorityEvictionSurprise,
  thePriorityQueueSurprise,
  theProbeThatAlwaysSaidYes,
  thePruneThatTookANeighbor,
  thePullRequestGeneratorGoneStale,
  theQueueThatQuietlyDroppedSamples,
  theQuietConcurrentModification,
  theQuotaCpuLimitWall,
  theRandomThatCollided,
  theReadOnlyFilesystemSurprise,
  theReadinessProbeThatAskedTooMuch,
  theRebalanceStorm,
  theReconcileLoopStorm,
  theRecordThatNeverEqualedItself,
  theRefreshScopeOnTheWrongBean,
  theRegexThatCaughtTooMuch,
  theRegexThatFellBehind,
  theRegexThatSplitWrong,
  theRelabelRegexThatMissedTheRename,
  theRelabelRuleThatDroppedTooMuch,
  theRenamedPropertyThatStillWorked,
  theRepoServerCertThatExpired,
  theResourceExclusionNobodyRemembered,
  theRetentionCliff,
  theRetryThatNeverRetried,
  theRootOnlyImage,
  theRotatedCertNobodyTrusted,
  theRotatedDeployKey,
  theRoundingThatDidntMatch,
  theRouteNobodyMatched,
  theRuleThatOutlivedTheMetric,
  theSamplerThatHatedErrors,
  theSavedSearchWithAMemory,
  theScaleMismatch,
  theScaledToZeroMystery,
  theScalingTugOfWar,
  theSearchDomainShadow,
  theSecretRotationEnvMismatch,
  theSecretThatWasntMountedForTls,
  theSelfhealThatRevertedTheFix,
  theSemverConstraintThatWasnt,
  theServiceMeshRetryStorm,
  theSessionIdThatAtePrometheus,
  theShallowCloneSurprise,
  theShardThatStayedHome,
  theSharedCacheCountedThrice,
  theSidecarMemoryTax,
  theSidecarThatStartedFirst,
  theSidecarWithTheMicrophone,
  theSilenceThatOutlivedTheIncident,
  theSortThatBrokeItself,
  theStackTraceThatShattered,
  theStaleLabelScheduler,
  theStartupThatWaitedOnDns,
  theStatefulsetScaleDownPdbMiscalc,
  theStatefulsetStartupJam,
  theStatefulsetStorageclassMismatch,
  theStatefulsetWaitForFirstConsumerTrap,
  theStaticFieldThatLoadedTooEarly,
  theStatusSubresourceDiffLoop,
  theStreamSelectorThatMissedEverything,
  theStreamThatNeverRan,
  theStreamYouCantReuse,
  theStringDuplicationBloat,
  theStructuredConcurrencyOrphan,
  theSubmoduleRepoServerCouldntSee,
  theSubpathTypo,
  theSuppressedExceptionThatHidTheTruth,
  theSurgeReadinessGateStall,
  theSvcPortThatDidntMatchTargetPort,
  theSwitchThatFellThrough,
  theSwitchThatThoughtItWasComplete,
  theSyncWaveDeadlock,
  theSyntheticCheckInTheWrongRegion,
  theTagStrategyMismatch,
  theTagThatBecameABranch,
  theTaintThatEvictedYouLater,
  theTerminatingNamespaceFinalizerStall,
  theTextBlockThatLostItsIndentation,
  theThreadPoolDrainedBySilence,
  theThreadThatRemembered,
  theTimeFieldThatWasnt,
  theTopologyAwareHintsFailure,
  theTopologySpreadIllusion,
  theTopologySpreadVolumeConflict,
  theTostringThatNeverStopped,
  theTrackingLabelMismatch,
  theTransactionalPropagationSurprise,
  theTruncatedAverage,
  theTruncatedSpan,
  theTurkishIProblem,
  theTwoHooksSameWave,
  theTwoSchedulersRace,
  theTwoSourcesThatDisagreed,
  theTypoInTheProfileVar,
  theUiSyncThatGitForgot,
  theUncheckedCastThatCameBack,
  theUnexpectedEnum,
  theUnquotedSyncWave,
  theUnsignedCommit,
  theUpMetricThatLied,
  theValidationMessageThatPointedElsewhere,
  theValueFrozenAtBoot,
  theValuesFileThatLost,
  theVanishingRollback,
  theVarargsThatPickedWrong,
  theVariablePointedElsewhere,
  theVersionThatCouldntDeserialize,
  theVpaHpaFight,
  theVpaOomLoop,
  theWalThatLostAnHour,
  theWebclientWithNoTimeout,
  theWebhookSilentMutation,
  theWebhookThatRejectedEverything,
  theWebhookThatStoppedArriving,
  theWildcardThatGotTooClever,
  theWrongClusterContext,
  theWrongContentTypeResponse,
  theYamlListThatBecameAString,
  twoServicesSameSelector,
  whyWontItJustSync,
  wildcardRecordShadowsSpecific,
  wrongIngressClassPickedUpNothing,
].sort((a, b) => (DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty]) || a.id.localeCompare(b.id));

export function getScenario(id: string): Scenario | undefined {
  return scenarios.find((s) => s.id === id);
}
