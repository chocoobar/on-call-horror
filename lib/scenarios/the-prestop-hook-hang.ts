import type { Scenario } from "./types";

export const thePrestopHookHang: Scenario = {
  id: "the-prestop-hook-hang",
  title: "The preStop Hook Hang",
  subtitle: "every rollout of notification-gateway takes exactly 30 seconds longer per pod than it used to",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "lifecycle", "termination"],
  briefing: `Rollouts of "notification-gateway" used to finish in about 2 minutes.
Since a \`preStop\` hook was added two weeks ago (to deregister from an
external load balancer before shutdown, avoiding dropped connections),
every rollout now takes over 6 minutes - each pod seems to sit
"terminating" for exactly 30 seconds longer than before, every single
time, without fail.`,
  constraints: [
    "The external load balancer deregistration the preStop hook performs is confirmed to actually complete successfully, generally within a second or two.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "notification-gateway", namespace: "notifications", labels: { app: "notification-gateway" } },
        spec: {
          replicas: 6,
          template: {
            spec: {
              terminationGracePeriodSeconds: 30,
              containers: [
                {
                  name: "notification-gateway",
                  image: "registry.internal/notification-gateway:2.3.0",
                  lifecycle: { preStop: { exec: { command: ["/bin/sh", "-c", "curl -s -X POST http://lb-admin.internal/deregister?host=$HOSTNAME"] } } },
                },
              ],
            },
          },
        },
        status: { readyReplicas: 6, updatedReplicas: 6, availableReplicas: 6 },
        age: "2w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "notification-gateway-shutdown-notes", namespace: "notifications" },
        spec: {
          data: {
            "notes.md":
              "The `curl` call in the preStop hook itself completes in 1-2 seconds\nunder normal conditions, confirmed by lb-admin's own access logs\nshowing a fast 200 response for every deregistration request. But the\npreStop hook's shell command has no explicit timeout, and per\nKubernetes' documented behavior, a pod's SIGTERM to the main container\nis only sent *after* its preStop hook fully returns - if curl's own\ndefault DNS-resolution or connect timeout is ever hit due to any brief\nnetwork blip (rare, but has happened at least twice in the last two\nweeks per lb-admin's access logs showing gaps), the hook can hang for\nits full default curl timeout window before giving up, which observed\nlogs show lines up with roughly 30 extra seconds - directly delaying\nwhen SIGTERM (and the whole rest of shutdown) even begins, on top of\nwhatever `terminationGracePeriodSeconds` was already budgeted for actual\ngraceful shutdown afterward.\n",
          },
        },
        age: "2w",
      },
    ],
  },
  hints: [
    "A pod's SIGTERM to its main container isn't sent until any `preStop` hook fully finishes - what happens if that hook itself doesn't finish quickly?",
    "`kubectl get deployment notification-gateway -n notifications -o yaml` - check the preStop hook's exact command. Does it have any timeout of its own?",
    "`kubectl get configmap notification-gateway-shutdown-notes -n notifications -o yaml` - is the deregistration call itself normally fast, or is something else adding the delay?",
  ],
  options: [
    {
      id: "prestop-no-timeout-delays-sigterm",
      label:
        "The preStop hook's `curl` command has no explicit timeout, and a pod's SIGTERM to its main container isn't sent until the preStop hook fully returns - normally the deregistration call finishes in 1-2 seconds, but on the occasional network blip, curl's own default timeout kicks in and the hook hangs for roughly 30 seconds before giving up, which delays the start of the actual shutdown sequence by that same 30 seconds on top of everything `terminationGracePeriodSeconds` already budgets, exactly matching the consistent extra delay observed.",
      explanation:
        "`notification-gateway-shutdown-notes` explains the mechanism precisely: preStop normally completes in 1-2 seconds (confirmed by the load balancer's own access logs), but has no explicit timeout of its own, and Kubernetes withholds SIGTERM to the main container until preStop fully finishes - so on the rare occasions the underlying curl call hangs (a documented handful of times over two weeks, matching real, if infrequent, network blips), the entire termination sequence is delayed by however long curl's own default timeout takes before giving up, which lines up with the observed extra ~30 seconds.",
    },
    {
      id: "terminationgraceperiod-doubled",
      label: "`terminationGracePeriodSeconds` was doubled when the preStop hook was added.",
      explanation:
        "`terminationGracePeriodSeconds` is confirmed still set to 30, unchanged - the extra delay isn't coming from a larger grace period budget, it's coming from time consumed *before* the grace period's shutdown sequence (SIGTERM and the app's own response to it) even begins, while the preStop hook itself is still running.",
    },
    {
      id: "load-balancer-deregistration-always-slow",
      label: "The external load balancer's deregistration endpoint always takes about 30 seconds to respond.",
      explanation:
        "`lb-admin`'s own access logs confirm deregistration calls normally complete in 1-2 seconds with a fast 200 response - the endpoint itself isn't slow. The delay is specifically tied to occasional network blips causing the hook to hang until a timeout, not a consistently slow backend.",
    },
    {
      id: "readinessprobe-failing-during-shutdown",
      label: "The pod's readiness probe is failing during shutdown, adding extra delay before termination.",
      explanation:
        "There's no readiness probe interaction with pod termination timing described here at all - the delay is specifically located in the preStop hook's execution window, before SIGTERM is even sent, which is a distinct phase from readiness probing during normal pod lifetime.",
    },
  ],
  correctOptionId: "prestop-no-timeout-delays-sigterm",
  resolution: `\`notification-gateway-shutdown-notes\` explains both the mechanism and
why it's intermittent-but-consistent-enough to matter: the load
balancer's own access logs confirm deregistration normally completes in
1-2 seconds, but the preStop hook's \`curl\` command has no explicit
timeout of its own. Kubernetes withholds SIGTERM to the main container
until the preStop hook fully returns - so whenever curl hits a brief
network blip and falls back to its own default timeout before giving up,
the entire shutdown sequence is delayed by that same amount before it
even starts, independent of and on top of the 30-second
\`terminationGracePeriodSeconds\` already budgeted for the app's own
graceful shutdown afterward. The two extra numbers (a roughly 30-second
default curl timeout, once for however many of the 6 pods per rollout
happen to hit it) plausibly compound to explain the consistent per-pod
delay observed across every rollout since the hook was added.

The fix is bounding the preStop hook with its own explicit, short
timeout, so a rare network blip can't inflate every single termination:

\`\`\`yaml
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "curl -s -m 3 -X POST http://lb-admin.internal/deregister?host=$HOSTNAME || true"]
\`\`\`

The \`-m 3\` caps curl at 3 seconds, and \`|| true\` ensures the hook exits
successfully (allowing shutdown to proceed promptly) even if
deregistration genuinely fails - a slightly stale load-balancer
registration during a rare failure is a much smaller cost than every
rollout being delayed by 30 seconds per affected pod. A preStop hook is
in the critical path of every single pod termination; anything it calls
out to should always have an explicit, deliberately short timeout rather
than relying on whatever default the underlying tool happens to use.`,
};
