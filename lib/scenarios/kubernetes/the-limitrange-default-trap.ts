import type { Scenario } from "../types";

export const theLimitrangeDefaultTrap: Scenario = {
  id: "the-limitrange-default-trap",
  title: "The LimitRange Default Trap",
  subtitle: "a brand-new Deployment in `analytics-dev` gets OOMKilled within seconds, every time",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "limitrange", "resources"],
  briefing: `A data scientist deployed a new Spark driver pod ("spark-driver-adhoc")
into the "analytics-dev" namespace to run a one-off job. It gets OOMKilled
within seconds every time, despite the same container image running fine
with much less memory in other environments. Their manifest doesn't
specify any resource limits at all - intentionally, since it's a
throwaway job.`,
  constraints: [
    "The container image and command are confirmed identical to a version that runs successfully elsewhere with no resource issues.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "spark-driver-adhoc", namespace: "analytics-dev", labels: { app: "spark-driver-adhoc" } },
        spec: { containers: [{ name: "spark-driver-adhoc", image: "registry.internal/spark-runner:3.4.0" }] },
        status: { phase: "Running", containerStatuses: [{ name: "spark-driver-adhoc", ready: false, restartCount: 4, state: { waiting: { reason: "CrashLoopBackOff" } }, lastState: { terminated: { reason: "OOMKilled", exitCode: 137 } } }] },
        age: "3m",
      },
      {
        apiVersion: "v1",
        kind: "LimitRange",
        metadata: { name: "analytics-dev-defaults", namespace: "analytics-dev" },
        spec: {
          limits: [
            { type: "Container", default: { memory: "256Mi", cpu: "250m" }, defaultRequest: { memory: "128Mi", cpu: "100m" } },
          ],
        },
        age: "8mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "analytics-dev-limitrange-notes", namespace: "analytics-dev" },
        spec: {
          data: {
            "notes.md":
              "`analytics-dev-defaults` LimitRange was added 8 months ago as a safety\nnet for the shared dev namespace, so that pods submitted *without* any\nresource limits still get something reasonable instead of being\nunbounded. Any container that doesn't specify its own\n`resources.limits`/`requests` silently receives these defaults\n(256Mi memory limit) at admission time - the pod spec on record never\nshows this happening unless you look at the live object, since it's\napplied automatically, not something the submitter typed.\n\nspark-driver-adhoc genuinely needs around 3-4Gi of memory to run - fine\nin other namespaces that don't have this LimitRange, but silently capped\nhere.\n",
          },
        },
        age: "8mo",
      },
    ],
  },
  hints: [
    "`kubectl get pod spark-driver-adhoc -n analytics-dev -o yaml` - check its actual live `resources` block. Does it match what the data scientist submitted (nothing at all)?",
    "`kubectl get limitrange -n analytics-dev -o yaml` - a namespace-level LimitRange can silently fill in resource limits/requests for any pod that doesn't specify its own.",
    "The image runs fine elsewhere with more memory available - what's different about how much memory this specific namespace is letting the container have?",
  ],
  options: [
    {
      id: "limitrange-silently-injects-256mi-default",
      label:
        "`analytics-dev-defaults`, a namespace LimitRange, automatically injects a 256Mi memory limit onto any container that doesn't specify its own resources - since the submitted pod spec had no `resources` block at all (intentional, since it's a throwaway job), it silently received this default, which is far below the ~3-4Gi spark-driver-adhoc actually needs, so it OOMKills almost immediately despite the manifest itself never mentioning a memory limit.",
      explanation:
        "`analytics-dev-limitrange-notes` explains the exact mechanism: the LimitRange fills in `default.memory: 256Mi` for any container missing its own limit, applied silently at admission time - it never shows up in the submitted manifest, only in the live object. The pod's own `lastState.terminated.reason: OOMKilled` confirms a memory kill, and the note directly states spark-driver-adhoc needs 3-4Gi, which this default is nowhere close to covering - explaining why the identical image runs fine in namespaces without this LimitRange.",
    },
    {
      id: "resourcequota-blocking-higher-limit",
      label: "A ResourceQuota in `analytics-dev` is preventing the pod from getting more memory.",
      explanation:
        "There's no ResourceQuota object present in this namespace at all - the resource ceiling here comes specifically from a LimitRange's *default* values applied to a container that specified none, a distinct mechanism from a quota, which would reject a request exceeding a cap rather than silently filling in a default for an absent one.",
    },
    {
      id: "spark-driver-memory-leak",
      label: "spark-driver-adhoc has a memory leak that only manifests in this namespace.",
      explanation:
        "The exact same image and command run successfully elsewhere with more memory available, per the scenario's own constraint - there's no evidence of a leak specific to this namespace; the difference is how much memory the container is actually permitted to use here, not a code-level behavioral difference.",
    },
    {
      id: "node-memory-pressure-in-analytics-dev",
      label: "Nodes serving `analytics-dev` are under memory pressure, causing early eviction.",
      explanation:
        "The pod's own container status shows `OOMKilled` with exit code 137 - a per-container cgroup limit kill, not a node-level eviction (which would show as `phase: Failed, reason: Evicted` on the pod itself, a different status entirely). The container is being killed for exceeding its own, LimitRange-assigned ceiling.",
    },
  ],
  correctOptionId: "limitrange-silently-injects-256mi-default",
  resolution: `\`analytics-dev-limitrange-notes\` explains the trap directly: the
\`analytics-dev-defaults\` LimitRange injects a 256Mi memory limit onto any
container that doesn't declare its own - which spark-driver-adhoc's
manifest deliberately didn't, since it was meant to be a lightweight,
throwaway job with no resource config to maintain. That default is
applied silently at admission time; it never appears in the submitted
YAML, only in the live pod object, which is exactly why comparing "what
I submitted" against "what's actually running" looked identical at a
glance but wasn't. The pod's \`OOMKilled\` termination confirms it hit a
memory ceiling, and the notes confirm spark-driver-adhoc genuinely needs
3-4Gi - the same image works fine anywhere without this LimitRange simply
because nothing there is silently capping it to 256Mi.

The fix is explicit: give the pod real resource requests/limits that
match what it actually needs, rather than relying on the namespace's
generic safety-net default:

\`\`\`yaml
resources:
  requests: { memory: 3Gi, cpu: 1 }
  limits: { memory: 4Gi, cpu: 2 }
\`\`\`

More broadly, this is worth flagging to anyone working in
\`analytics-dev\`: a LimitRange default is a reasonable safety net for
truly small, unspecified workloads, but it's an easy trap for anything
memory-hungry submitted "as-is" without realizing the namespace will
quietly fill in a value on its behalf - checking \`kubectl get limitrange\`
in a new namespace before assuming "no resources specified" means
"unbounded" would have caught this before the first run.`,
};
