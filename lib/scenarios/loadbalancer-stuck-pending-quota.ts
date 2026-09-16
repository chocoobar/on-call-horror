import type { Scenario } from "./types";

export const loadbalancerStuckPendingQuota: Scenario = {
  id: "loadbalancer-stuck-pending-quota",
  title: "The LoadBalancer That Never Got An IP",
  subtitle: "the Service has existed for twenty minutes. EXTERNAL-IP still says <pending>",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 10,
  tags: ["loadbalancer", "cloud", "quota"],
  briefing: `A new public-facing Service, "webhook-receiver," was created as type
LoadBalancer twenty minutes ago so partners can start sending webhooks.
It's still showing \`<pending>\` for its external IP. Two other
LoadBalancer Services in neighboring namespaces were created successfully
just last week with no issue.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "webhook-receiver", namespace: "webhooks", labels: { app: "webhook-receiver" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "22m",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "webhook-receiver", namespace: "webhooks" },
        spec: { type: "LoadBalancer", selector: { app: "webhook-receiver" }, ports: [{ port: 443, targetPort: 8443 }] },
        status: { loadBalancer: {} },
        age: "20m",
        events: [
          { type: "Warning", reason: "SyncLoadBalancerFailed", age: "18m", message: "Error syncing load balancer: failed to ensure load balancer: googleapi: Error 403: Quota 'IN_USE_ADDRESSES' exceeded. Limit: 8.0 in region us-central1." },
          { type: "Warning", reason: "SyncLoadBalancerFailed", age: "3m", message: "Error syncing load balancer: failed to ensure load balancer: googleapi: Error 403: Quota 'IN_USE_ADDRESSES' exceeded. Limit: 8.0 in region us-central1." },
        ],
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "public-gateway", namespace: "gateway" },
        spec: { type: "LoadBalancer", selector: { app: "public-gateway" }, ports: [{ port: 443, targetPort: 8443 }] },
        status: { loadBalancer: { ingress: [{ ip: "34.120.44.10" }] } },
        age: "8d",
      },
    ],
  },
  hints: [
    "`kubectl describe svc webhook-receiver -n webhooks` - what do the events at the bottom actually say?",
    "The failure is repeating, not one-time, and mentions a specific cloud API error - not anything about pod health or Service configuration.",
    "'IN_USE_ADDRESSES' quota is a per-region limit on how many static/reserved external IP addresses a cloud project can hold at once - what happens when a new LoadBalancer tries to allocate one past that limit?",
  ],
  options: [
    {
      id: "cloud-ip-quota-exceeded",
      label:
        "The cloud project has hit its regional quota for in-use external IP addresses (limit of 8, already reached by existing LoadBalancer Services and reserved IPs) - every attempt to provision `webhook-receiver`'s LoadBalancer fails at the cloud provider's API level with a 403 quota error, so Kubernetes can never get an external IP assigned, no matter how long it waits or retries.",
      explanation:
        "The Service's own events show it directly and repeatedly: `Quota 'IN_USE_ADDRESSES' exceeded. Limit: 8.0 in region us-central1`. This is a cloud-provider-level allocation failure, not a Kubernetes scheduling or networking issue inside the cluster - the cloud controller manager keeps retrying and keeps hitting the same 403, which is exactly why the Service just sits at `<pending>` indefinitely rather than eventually succeeding or failing outright.",
    },
    {
      id: "webhook-receiver-pods-unhealthy",
      label: "webhook-receiver's pods aren't passing health checks, so the load balancer won't provision.",
      explanation:
        "The Deployment shows 2/2 ready, healthy replicas - pod health has no bearing on whether a cloud provider can allocate an external IP address in the first place; that step happens independently, before any health checking of backends would even begin.",
    },
    {
      id: "firewall-blocking-lb-provisioning",
      label: "A cloud firewall rule is blocking the load balancer controller from provisioning the resource.",
      explanation:
        "The Service's own events show a specific, named quota error from the cloud API (a 403 on IN_USE_ADDRESSES), not a generic connectivity or permissions failure that a firewall block would typically produce - the cause is explicitly stated as a quota limit, not a network-level block.",
    },
    {
      id: "wrong-service-type-annotation",
      label: "The Service is missing a cloud-provider-specific annotation needed to select the right load balancer type.",
      explanation:
        "The Service is successfully reaching the cloud provider's API and getting a real, specific response back (a quota error) - it isn't being ignored or misrouted due to a missing annotation, which would typically produce no events or a different kind of failure entirely.",
    },
  ],
  correctOptionId: "cloud-ip-quota-exceeded",
  resolution: `The Service's own events state the cause explicitly, twice:
\`Quota 'IN_USE_ADDRESSES' exceeded. Limit: 8.0 in region us-central1\`.
The cloud project has already reached its regional limit on in-use
external IP addresses - between existing LoadBalancer Services (like
\`public-gateway\`) and any other reserved static IPs in the project, the
region has no more addresses left to allocate. The cloud controller
manager keeps retrying the provisioning request on webhook-receiver's
behalf and keeps getting the same 403 back, which is why the Service just
sits at \`<pending>\` indefinitely rather than failing outright with a
clear error surfaced anywhere obvious - it only shows up in
\`kubectl describe\`'s event list.

The fix is outside the cluster, at the cloud project level - either
requesting a quota increase for \`IN_USE_ADDRESSES\` in the region, or
freeing up an existing address (releasing an unused reserved static IP,
or decommissioning an old LoadBalancer Service no longer in use):

\`\`\`bash
gcloud compute project-info describe --project my-project \\
  --format="value(quotas)"
# then, after getting the increase approved:
gcloud compute regions describe us-central1 --project my-project
\`\`\`

Once quota is available, the existing Service doesn't need to be
recreated - the cloud controller manager will pick up the next
provisioning attempt automatically and populate \`EXTERNAL-IP\` shortly
after. Worth flagging for the team: address quota is easy to reach
silently as more LoadBalancer Services accumulate, and it's worth
alerting on quota headroom before it blocks a launch like this one.`,
};
