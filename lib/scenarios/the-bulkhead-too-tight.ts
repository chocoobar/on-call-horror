import type { Scenario } from "./types";

export const theBulkheadTooTight: Scenario = {
  id: "the-bulkhead-too-tight",
  title: "The Bulkhead Too Tight",
  subtitle: "appointment-scheduler starts rejecting perfectly normal booking bursts and blaming a downstream that's actually fine",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 18,
  tags: ["java25", "resilience4j", "spring-boot"],
  briefing: `"appointment-scheduler" started rejecting a noticeable share of booking
requests with a generic "service temporarily unavailable" error, always
during predictable morning and evening rush windows when a lot of people
book appointments at once. The team's alerting fired for the downstream
calendar-sync service, but that service's own dashboards show it healthy
and responsive the entire time.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "appointment-scheduler", namespace: "scheduling", labels: { app: "appointment-scheduler" } },
        spec: { replicas: 3, template: { spec: { containers: [{ name: "appointment-scheduler", image: "registry.internal/appointment-scheduler:4.6.0" }] } } },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "22d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "appointment-scheduler-3i4j5k6l7-m8n9o", namespace: "scheduling", labels: { app: "appointment-scheduler" } },
        status: { phase: "Running", containerStatuses: [{ name: "appointment-scheduler", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "appointment-scheduler": [
            "2026-09-15T08:15:02.884Z WARN  i.g.r.b.i.SemaphoreBulkhead - Bulkhead 'calendarSync' is full, rejecting call",
            "2026-09-15T08:15:02.886Z INFO  c.e.scheduling.BookingController - booking req-55210 rejected: calendar sync temporarily unavailable",
          ],
        },
        age: "22d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "appointment-scheduler-notes", namespace: "scheduling" },
        spec: {
          data: {
            "application.yaml.excerpt":
              "resilience4j:\n  bulkhead:\n    instances:\n      calendarSync:\n        max-concurrent-calls: 8\n        max-wait-duration: 0ms\n",
            "notes.md":
              "`calendarSync` calls take roughly 150-300ms each under normal\nconditions. `max-concurrent-calls: 8` was set a long time ago, when this\nservice ran at a fraction of its current booking volume. Morning and\nevening rush windows now regularly produce 25-40 concurrent booking\nrequests, each needing its own calendar-sync call - well beyond what 8\nconcurrent slots with zero wait tolerance (`max-wait-duration: 0ms`) can\nabsorb, even though calendar-sync itself has plenty of real capacity to\nhandle that volume.",
          },
        },
        age: "22d",
      },
    ],
  },
  hints: [
    "`kubectl logs appointment-scheduler-3i4j5k6l7-m8n9o -n scheduling` - `Bulkhead 'calendarSync' is full, rejecting call`. A bulkhead rejecting calls isn't the same thing as the downstream service itself failing - what's actually full?",
    "`kubectl get configmap appointment-scheduler-notes -n scheduling -o yaml` - how many concurrent calls does the bulkhead actually allow, and how does that compare to real booking volume during a rush window?",
    "`max-wait-duration: 0ms` means a call that can't get a bulkhead slot immediately is rejected instantly rather than queuing briefly - is 8 concurrent slots, with zero tolerance for a brief queue, sized for today's actual traffic?",
  ],
  options: [
    {
      id: "bulkhead-concurrency-limit-not-scaled-with-real-traffic",
      label:
        "`calendarSync`'s bulkhead was configured with `max-concurrent-calls: 8` and `max-wait-duration: 0ms` a long time ago, when booking volume was much lower - it was never revisited as real traffic grew, and now regularly-occurring rush-window bursts of 25-40 concurrent bookings far exceed those 8 slots with zero tolerance for even a brief queue, so the bulkhead itself is what's rejecting the excess calls, not any actual unavailability or slowness in calendar-sync, which has real spare capacity the whole time.",
      explanation:
        "The log is explicit about the mechanism: `Bulkhead 'calendarSync' is full, rejecting call` - a client-side concurrency limiter rejecting calls locally, not an error or timeout coming back from calendar-sync itself. `appointment-scheduler-notes` explains why it's full during exactly these windows: `max-concurrent-calls: 8` was sized for booking volume from a long time ago and never revisited, while rush-window traffic now regularly produces 25-40 concurrent calendar-sync calls at once - far more than 8 slots can hold, and with `max-wait-duration: 0ms`, any call that arrives when all 8 slots are occupied is rejected instantly rather than briefly queuing, even while calendar-sync itself remains healthy and has real spare capacity to serve the excess.",
    },
    {
      id: "calendar-sync-has-a-hidden-capacity-problem",
      label: "calendar-sync has a real, hidden capacity problem its own dashboards simply aren't catching.",
      explanation:
        "The rejections are happening entirely on appointment-scheduler's own side, at the bulkhead, before any call to calendar-sync is even attempted for the rejected requests - calendar-sync's dashboards showing it healthy is consistent with it genuinely being healthy and simply never receiving these particular, locally-rejected calls at all.",
    },
    {
      id: "three-replicas-not-enough-overall",
      label: "Three replicas isn't enough overall capacity to handle rush-window booking volume.",
      explanation:
        "The bulkhead's `max-concurrent-calls: 8` is a per-pod limit specific to calls into calendar-sync - the rejection is happening at that per-pod concurrency ceiling, not because the fleet as a whole lacks capacity to accept and process incoming booking requests in general.",
    },
    {
      id: "network-congestion-during-rush-windows",
      label: "Network congestion during rush windows is slowing calls to calendar-sync enough to trigger rejections.",
      explanation:
        "The log shows an immediate, local rejection by the bulkhead itself (`is full, rejecting call`) rather than a timeout or slow-response pattern - a bulkhead rejects based on how many concurrent calls are already in flight against its configured limit, independent of whether network conditions to the downstream are good or bad.",
    },
  ],
  correctOptionId: "bulkhead-concurrency-limit-not-scaled-with-real-traffic",
  resolution: `The log names the exact mechanism: \`Bulkhead 'calendarSync' is full,
rejecting call\` - a local, client-side concurrency limiter rejecting the
call outright, before any request to calendar-sync is even attempted.
That's consistent with calendar-sync's own dashboards showing it healthy
the whole time: it genuinely never sees these particular requests at all.

\`appointment-scheduler-notes\` explains why the bulkhead fills up
specifically during rush windows: \`max-concurrent-calls: 8\` was set a
long time ago, sized for booking volume from back then, and never
revisited as the service's real traffic grew. Rush-window bursts now
regularly produce 25-40 concurrent booking requests, each needing its own
calendar-sync call - several times more than 8 slots can hold at once.
\`max-wait-duration: 0ms\` compounds this: rather than letting an excess
call briefly queue for a slot to free up (each call only takes 150-300ms,
so a short queue would usually clear quickly), any call arriving when all
8 slots are occupied is rejected immediately. The bulkhead is working
exactly as configured - it's just configured for a traffic level this
service outgrew a while ago.

The fix is resizing the bulkhead to match real, current concurrency needs,
and giving it a small amount of queuing tolerance for brief bursts:

\`\`\`yaml
resilience4j:
  bulkhead:
    instances:
      calendarSync:
        max-concurrent-calls: 40
        max-wait-duration: 200ms
\`\`\`

A bulkhead's whole purpose is protecting a downstream from being
overwhelmed by too much concurrent load from one caller - but its
concurrency limit has to be periodically checked against actual traffic
growth, the same as any other capacity setting, or it eventually starts
protecting a perfectly healthy downstream from traffic it could easily
handle.`,
};
