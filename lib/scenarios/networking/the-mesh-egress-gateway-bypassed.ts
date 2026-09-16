import type { Scenario } from "../types";

export const theMeshEgressGatewayBypassed: Scenario = {
  id: "the-mesh-egress-gateway-bypassed",
  title: "The Traffic That Skipped The Gateway",
  subtitle: "every other service's external calls show up in the audit log. this one's don't exist at all.",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["service-mesh", "egress-gateway", "compliance"],
  briefing: `The mesh is configured so all external traffic must route through a
dedicated egress gateway for centralized audit logging and TLS
inspection, required for a compliance certification. A security audit
just discovered that "claims-processor"'s calls to an external
verification API never show up in the egress gateway's logs at all - yet
the calls are clearly succeeding, since claims are being processed
normally.`,
  constraints: [
    "Every other service in the mesh calling external APIs is confirmed to route through the egress gateway correctly, with matching entries in its audit log.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: {
          name: "claims-processor",
          namespace: "claims",
          labels: { app: "claims-processor" },
          annotations: {},
        },
        spec: {
          replicas: 2,
          template: { metadata: { annotations: { "sidecar.istio.io/inject": "false" } } },
        },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "40d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "mesh-egress-policy-notes", namespace: "claims" },
        spec: {
          data: {
            "notes.md":
              "Mandatory routing through the egress gateway is enforced entirely by\nthe per-pod Envoy sidecar's own outbound traffic interception (an\niptables redirect installed by the sidecar injector at pod startup) -\nany pod that never gets a sidecar injected in the first place has\nnothing intercepting or redirecting its outbound traffic at all, and it\nconnects directly to the public internet exactly as it would outside the\nmesh entirely, invisible to the egress gateway's own audit logging.\nclaims-processor's Deployment has\n`sidecar.istio.io/inject: \"false\"` explicitly set on its pod template -\nadded roughly 40 days ago by an engineer working around an unrelated,\nsince-resolved sidecar resource-limit issue during a previous incident,\nand never removed afterward.\n",
          },
        },
        age: "40d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "claims-processor-4q5r6s-t7u8v", namespace: "claims", labels: { app: "claims-processor" } },
        status: { phase: "Running", containerStatuses: [{ name: "claims-processor", ready: true, restartCount: 0, state: { running: {} } }] },
        age: "5d",
      },
    ],
  },
  hints: [
    "How does mandatory egress-gateway routing actually get enforced for a given pod - what component is responsible for intercepting and redirecting its outbound traffic in the first place?",
    "`kubectl get deploy claims-processor -n claims -o yaml` - does its pod template have a sidecar injection annotation, and what's it set to?",
    "`kubectl get configmap mesh-egress-policy-notes -n claims -o yaml` - what happens to a pod's outbound traffic if it never gets a sidecar injected into it at all?",
  ],
  options: [
    {
      id: "sidecar-injection-disabled-bypasses-egress-gateway",
      label:
        "claims-processor's pod template has `sidecar.istio.io/inject: \"false\"` explicitly set, left over from an unrelated incident workaround 40 days ago - since mandatory egress-gateway routing is enforced entirely by the per-pod sidecar's own outbound traffic interception, a pod with no sidecar injected has nothing redirecting its outbound calls at all, so it connects directly to the external API exactly as it would outside the mesh, completely invisible to the egress gateway's audit logging even though the calls themselves succeed normally.",
      explanation:
        "`mesh-egress-policy-notes` explains the enforcement mechanism directly: mandatory egress routing depends entirely on each pod's own sidecar intercepting its outbound traffic, and confirms claims-processor's Deployment has had sidecar injection explicitly disabled for 40 days, left over from an unrelated, already-resolved incident workaround. With no sidecar, there's nothing to redirect claims-processor's traffic through the egress gateway at all - it goes straight to the internet, succeeding normally but leaving zero trace in the gateway's audit log, exactly matching what the security audit found.",
    },
    {
      id: "egress-gateway-log-retention-too-short",
      label: "The egress gateway's own log retention period is too short and the entries simply rolled off.",
      explanation:
        "Every other service's calls are confirmed present in the egress gateway's audit log without issue - retention isn't generally too short, since comparable historical traffic from other services is still visible; the gap is specific to claims-processor never appearing at all, at any point, not a retention window cutting off otherwise-present entries.",
    },
    {
      id: "claims-verification-api-not-covered-by-egress-policy",
      label: "The external verification API's domain isn't covered by the mesh's egress gateway routing policy.",
      explanation:
        "Every other service calling external APIs is confirmed to route through the egress gateway correctly - if a specific destination domain weren't covered by the routing policy, that would affect any service calling it, not be isolated specifically to claims-processor's traffic to that destination.",
    },
    {
      id: "claims-processor-using-different-namespace-policy",
      label: "The `claims` namespace has its own mesh configuration that exempts it from the egress gateway requirement.",
      explanation:
        "There's no namespace-wide mesh policy override described here - the specific, direct cause is the sidecar injection annotation on claims-processor's own pod template, a per-workload setting, not any namespace-level exemption from the egress routing requirement.",
    },
  ],
  correctOptionId: "sidecar-injection-disabled-bypasses-egress-gateway",
  resolution: `\`mesh-egress-policy-notes\` explains exactly how mandatory egress-gateway
routing is enforced: entirely through each pod's own Envoy sidecar,
which installs an iptables redirect at pod startup to intercept outbound
traffic and route it through the gateway. A pod with no sidecar injected
has absolutely nothing performing that interception - its outbound
traffic behaves exactly as it would outside the mesh entirely, going
straight to the public internet. claims-processor's Deployment has had
\`sidecar.istio.io/inject: "false"\` explicitly set on its pod template for
40 days, a leftover workaround from an unrelated, already-resolved
sidecar resource-limit incident that nobody removed afterward. The
calls to the external verification API succeed completely normally
(there's no mesh policy blocking them, since there's no sidecar to
enforce any mesh policy at all) - they're just entirely invisible to the
egress gateway's audit logging, exactly matching what the compliance
audit surfaced.

The fix is removing the stale injection-disable annotation so
claims-processor gets a sidecar like every other workload in the mesh:

\`\`\`yaml
spec:
  template:
    metadata:
      annotations:
        sidecar.istio.io/inject: "true"   # or remove the annotation entirely
\`\`\`

After redeploying with the sidecar restored, it's worth confirming
claims-processor's calls do start appearing in the egress gateway's
audit log, and separately revisiting whatever resource-limit issue
originally prompted disabling the sidecar (likely resolvable now with
proper resource requests/limits on the sidecar container itself, rather
than disabling it outright). Any workaround that disables a
security/compliance-enforcing mechanism like mesh sidecar injection
needs an explicit expiration or follow-up ticket - left in place
indefinitely, it silently and completely exempts that one workload from
controls everything else in the mesh is still subject to.`,
};
