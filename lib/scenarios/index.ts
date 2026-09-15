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
].sort((a, b) => (DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty]) || a.id.localeCompare(b.id));

export function getScenario(id: string): Scenario | undefined {
  return scenarios.find((s) => s.id === id);
}
