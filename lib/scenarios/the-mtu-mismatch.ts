import type { Scenario } from "./types";

export const theMtuMismatch: Scenario = {
  id: "the-mtu-mismatch",
  title: "The MTU Mismatch",
  subtitle: "small API calls work fine. anything returning a big payload just hangs.",
  difficulty: "hard",
  type: "fix",
  topic: "networking",
  timeMinutes: 25,
  tags: ["networking", "mtu", "vpn"],
  briefing: `"reports-api" was just moved behind a new site-to-site VPN tunnel to a
partner's network for a new integration. Small requests (status checks,
single-record lookups) work perfectly. Any request that returns a large
response - a bulk export, a big report - just hangs forever and eventually
times out.`,
  constraints: [
    "The application itself is confirmed healthy and generating the full response correctly on its end - packet captures show the response leaving reports-api's pod.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "reports-api", namespace: "reports", labels: { app: "reports-api" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "vpn-tunnel-notes", namespace: "reports" },
        spec: {
          data: {
            "notes.md":
              "The new site-to-site VPN tunnel to the partner network encapsulates\ntraffic (IPsec), which adds overhead per packet and reduces the tunnel's\neffective MTU to 1400 bytes - lower than the normal 1500-byte Ethernet\ndefault used everywhere else on this network. The partner's firewall, as\na hardening measure, blocks inbound ICMP entirely, including\n'Fragmentation Needed' (Path MTU Discovery) messages.\n\nSmall responses fit in a single packet under either MTU and are\nunaffected. A large response gets broken into full-size (1500-byte)\npackets by reports-api's own host, which then can't fit through the\n1400-byte tunnel; normally the sender would receive an ICMP\n'Fragmentation Needed' message and resend at a smaller size (Path MTU\nDiscovery) - but with ICMP blocked, that message never arrives, and the\noversized packets are simply dropped with no error on either side.\n",
          },
        },
        age: "3d",
      },
    ],
  },
  hints: [
    "`kubectl get configmap vpn-tunnel-notes -n reports -o yaml` - what's the tunnel's effective MTU, and how does that compare to the normal network's MTU?",
    "Small requests/responses fit in one packet regardless of MTU differences - large ones don't. What mechanism normally handles a sender discovering a smaller MTU partway along a path, and what happens if that mechanism is blocked?",
    "A response confirmed to leave the server successfully, that then simply vanishes with no error on either side, is a classic sign of packets being silently dropped somewhere in the middle - not a problem with either endpoint itself.",
  ],
  options: [
    {
      id: "pmtud-blackholed-by-blocked-icmp",
      label:
        "The VPN tunnel's effective MTU (1400 bytes) is smaller than the normal network's 1500-byte MTU, so large responses get sent as oversized packets that don't fit through the tunnel - normally the sender would receive an ICMP 'Fragmentation Needed' message and resend smaller (Path MTU Discovery), but the partner's firewall blocks inbound ICMP entirely, so that message never arrives, the oversized packets are silently dropped, and the connection just hangs with no error on either side.",
      explanation:
        "`vpn-tunnel-notes` lays out exactly this chain: a smaller tunnel MTU, oversized packets for anything beyond a small response, and ICMP blocked at the partner's firewall - which is specifically what breaks Path MTU Discovery, the mechanism that would otherwise let the sender adapt automatically. This produces exactly the observed pattern: small payloads (single packets under any reasonable MTU) work perfectly, while large payloads (needing full-size packets that don't fit the tunnel) vanish with no error, because the packets are dropped in the middle of the path with no feedback ever reaching either endpoint to explain why.",
    },
    {
      id: "vpn-bandwidth-too-low",
      label: "The VPN tunnel simply doesn't have enough bandwidth for large responses.",
      explanation:
        "A bandwidth limitation would produce a slow-but-eventually-completing transfer, not a total, indefinite hang - the described symptom is total silence on large payloads, not degraded throughput, which points at packets being dropped entirely rather than merely rate-limited.",
    },
    {
      id: "reports-api-timeout-too-short",
      label: "reports-api's own response timeout is configured too short for large payloads.",
      explanation:
        "Packet captures confirm the full response is already leaving reports-api's pod successfully - the application isn't giving up early or timing out on its own end, the response is being generated and sent in full; something between the two ends is failing to deliver it.",
    },
    {
      id: "partner-api-gateway-payload-limit",
      label: "The partner's API gateway has a maximum payload size limit that's rejecting large responses.",
      explanation:
        "A payload-size rejection at an API gateway would typically produce an explicit HTTP-level error response, not a silent, total hang with no response of any kind reaching the caller - the symptom here is consistent with packets vanishing in transit, not a gateway actively rejecting an oversized request.",
    },
  ],
  correctOptionId: "pmtud-blackholed-by-blocked-icmp",
  resolution: `\`vpn-tunnel-notes\` lays out the classic "PMTUD black hole" scenario end
to end. The new IPsec tunnel's encapsulation overhead drops its effective
MTU to 1400 bytes, below the network's normal 1500-byte default. Small
requests and responses fit comfortably in a single packet under either
MTU and are completely unaffected - exactly matching what's observed.
Large responses get segmented by reports-api's own host into full,
1500-byte packets (it has no reason to know about the tunnel's smaller
MTU further along the path), which then can't fit through the tunnel.

Normally, this self-corrects automatically: a router along the path that
can't forward an oversized packet sends back an ICMP "Fragmentation
Needed" message, and the sending host uses that to discover the smaller
MTU and resend at the right size - this is Path MTU Discovery, and it's
supposed to make MTU differences along a path invisible to applications
entirely. The partner's firewall blocking all inbound ICMP, including
that specific message, breaks the one feedback mechanism that would have
made this self-healing. Oversized packets are simply dropped in the
tunnel with no error reaching either end - the sender never learns it
needs to resend smaller, and the receiver never sees anything arrive at
all.

There's no fix available for the partner's own firewall policy from this
side, but the standard mitigation is clamping the effective MSS
(Maximum Segment Size) at the tunnel endpoint, so packets never get built
larger than the tunnel can actually carry in the first place:

\`\`\`bash
# on the VPN gateway/router terminating the tunnel
iptables -t mangle -A FORWARD -o tun0 -p tcp --tcp-flags SYN,RST SYN \\
  -j TCPMSS --clamp-mss-to-pmtu
\`\`\`

MSS clamping sidesteps the need for ICMP-based Path MTU Discovery
entirely by making sure TCP never negotiates a segment size larger than
what the tunnel can actually deliver - a standard, common fix for exactly
this class of "small requests work, big payloads silently hang" problem
whenever a tunnel or overlay network reduces effective MTU along part of
a path.`,
};
