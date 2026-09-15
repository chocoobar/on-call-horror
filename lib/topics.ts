/**
 * Topics group scenarios in the side nav. To add a new topic (beyond
 * Kubernetes/ArgoCD), add an entry here and set matching `topic` ids on
 * scenarios in `lib/scenarios/*.ts` - the side nav and `/topic/[topic]`
 * route pick it up automatically via `generateStaticParams`.
 */
export interface Topic {
  id: string;
  label: string;
  description: string;
}

export const TOPICS: Topic[] = [
  {
    id: "kubernetes",
    label: "Kubernetes",
    description: "Pod, Deployment, and Service failures - no GitOps tooling involved.",
  },
  {
    id: "argocd",
    label: "Argo CD",
    description: "Sync, drift, RBAC, and Helm incidents in an ArgoCD-managed cluster.",
  },
  {
    id: "spring-boot",
    label: "Spring Boot",
    description: "JVM-in-a-container incidents on Java 25 - signal handling, virtual threads, and memory limits.",
  },
  {
    id: "observability",
    label: "Observability",
    description: "Prometheus, Grafana, and the ELK stack lying to you in new and exciting ways.",
  },
  {
    id: "networking",
    label: "Networking",
    description: "NetworkPolicies, Ingress routing, and DNS - the layer everything else silently depends on.",
  },
  {
    id: "java-bugs",
    label: "Java Bugs",
    description: "Language and runtime bugs - broken equals()/hashCode() contracts, and upgrades that break in production.",
  },
];

export function getTopic(id: string): Topic | undefined {
  return TOPICS.find((t) => t.id === id);
}
