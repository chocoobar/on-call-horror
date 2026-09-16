import type { Scenario } from "./types";

export const crossNamespaceServiceFqdnMissing: Scenario = {
  id: "cross-namespace-service-fqdn-missing",
  title: "The Short Name That Only Worked By Accident",
  subtitle: "it worked in staging for six months. it's never worked in production, not even once.",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["dns", "namespaces", "service-discovery"],
  briefing: `"referral-tracker" was just promoted from staging to production. In
staging, it's always successfully called "user-accounts" using just that
short, unqualified hostname. In production, every call fails with a DNS
resolution error - the exact same code, the exact same short hostname,
apparently never working at all.`,
  constraints: [
    "user-accounts is confirmed healthy and running in production, just in a different namespace than referral-tracker.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "referral-tracker", namespace: "growth", labels: { app: "referral-tracker" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "30m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "referral-tracker-3f4g5h-i6j7k", namespace: "growth", labels: { app: "referral-tracker" } },
        status: { phase: "Running", containerStatuses: [{ name: "referral-tracker", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "referral-tracker": [
            "2026-09-15T09:45:01.010Z ERROR c.e.growth.AccountsClient - java.net.UnknownHostException: user-accounts",
          ],
        },
        age: "30m",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "user-accounts", namespace: "identity2", labels: { app: "user-accounts" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "user-accounts", namespace: "identity2" },
        spec: { type: "ClusterIP", clusterIP: "10.96.33.9", selector: { app: "user-accounts" }, ports: [{ port: 443 }] },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "namespace-topology-notes", namespace: "growth" },
        spec: {
          data: {
            "notes.md":
              "In staging, referral-tracker and user-accounts happen to both run in\nthe same shared namespace, `staging`, due to how that environment was\noriginally set up years ago - a bare, unqualified hostname like\n`user-accounts` resolves correctly there because Kubernetes DNS search-\ndomain expansion always tries the pod's own namespace first, and finds a\nreal match immediately. In production, services are properly split\nacross dedicated namespaces per team: referral-tracker lives in `growth`,\nuser-accounts lives in `identity2`. A bare `user-accounts` hostname in\nproduction only ever gets tried against `growth`'s own namespace suffix\n(and a couple of cluster-wide ones) - it never has any reason to try\n`identity2` at all, since nothing tells the resolver to look there, so\nit fails to resolve, full stop.\n",
          },
        },
        age: "30m",
      },
    ],
  },
  hints: [
    "user-accounts is confirmed healthy in production - just check which namespace it actually lives in versus which namespace referral-tracker lives in.",
    "The exact same short hostname worked in staging - what's structurally different about how staging and production are organized?",
    "`kubectl get configmap namespace-topology-notes -n growth -o yaml` - a bare, unqualified hostname's DNS search list tries the calling pod's *own* namespace (and a couple of cluster-wide suffixes) - does it ever have a reason to try a completely different namespace on its own?",
  ],
  options: [
    {
      id: "bare-hostname-never-worked-cross-namespace-by-design",
      label:
        "referral-tracker's use of the bare, unqualified hostname `user-accounts` only ever worked in staging because both services happen to share the same namespace there, letting Kubernetes DNS search-domain expansion find a real match in the pod's own namespace; in production, the two services are properly split across separate namespaces (`growth` and `identity2`), and a bare hostname's search list never has any reason to try a namespace other than the caller's own - it isn't that anything is newly broken in production, it's that the short-hostname pattern was only ever going to work by the coincidence of staging's shared-namespace layout, which production was never going to replicate.",
      explanation:
        "`namespace-topology-notes` explains the structural difference directly: staging's shared-namespace setup means a bare hostname's default search order (starting with the pod's own namespace) happens to land on a real match, while production's properly-separated namespaces mean the same bare hostname's search order never includes `identity2` at all. user-accounts is confirmed healthy in production - it's simply unreachable by an unqualified name from a different namespace, which was never going to work regardless of anything about the production deployment itself being wrong.",
    },
    {
      id: "production-networkpolicy-blocking-identity2",
      label: "A production-only NetworkPolicy is blocking growth's egress to identity2.",
      explanation:
        "The error is a DNS resolution failure (`UnknownHostException`), occurring before any connection attempt or NetworkPolicy enforcement would even be relevant - a NetworkPolicy block would produce a connection timeout against a successfully-resolved address, not a failure to resolve the name in the first place.",
    },
    {
      id: "user-accounts-not-actually-deployed-in-prod",
      label: "user-accounts isn't actually deployed in production yet.",
      explanation:
        "user-accounts is explicitly confirmed healthy and running in production, with 3/3 ready replicas in the `identity2` namespace - it's fully deployed and available; the issue is purely that referral-tracker's bare hostname has no way to find it there.",
    },
    {
      id: "coredns-not-configured-for-production",
      label: "CoreDNS itself isn't properly configured for the production cluster.",
      explanation:
        "There's no indication CoreDNS is misconfigured cluster-wide - this is a standard, expected consequence of Kubernetes' own default DNS search-order behavior (namespace-scoped by default) applied correctly to a namespace topology where the two services simply don't share a namespace, not a CoreDNS configuration defect.",
    },
  ],
  correctOptionId: "bare-hostname-never-worked-cross-namespace-by-design",
  resolution: `\`namespace-topology-notes\` lays out the structural difference plainly:
staging happens to run both referral-tracker and user-accounts in the
same shared namespace (a historical artifact of how that environment was
originally set up), so a bare, unqualified hostname like \`user-accounts\`
resolves correctly there - Kubernetes' default DNS search-domain
expansion always tries the calling pod's own namespace first, and in
staging that's a genuine, real match. Production properly separates
services into dedicated per-team namespaces: referral-tracker in
\`growth\`, user-accounts in \`identity2\`. A bare hostname's search order
never has any reason to try a namespace other than the caller's own (plus
a couple of fixed cluster-wide suffixes), so it never even attempts
\`identity2\` and fails outright. user-accounts itself is fully healthy and
correctly deployed in production - the short-hostname pattern was simply
never going to work across genuinely separate namespaces, regardless of
anything about the production rollout being wrong.

The fix is using the fully-qualified Service name, which works
identically and correctly in both environments:

\`\`\`java
String accountsHost = "user-accounts.identity2.svc.cluster.local";
\`\`\`

This is also worth flagging as a gap in the staging environment's own
fidelity to production: relying on a bare hostname that only works
because of a shared-namespace coincidence in staging means staging isn't
actually validating the real, production-shaped service discovery path
at all. Fully-qualified Service names avoid this trap entirely and
should be the default for any cross-service call that isn't guaranteed
to always share a namespace with its caller.`,
};
