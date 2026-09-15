import type { K8sObject } from "@/lib/scenarios/types";

export function formatArgocdAppGet(app: K8sObject): string[] {
  const spec = app.spec as {
    project?: string;
    source?: { repoURL?: string; targetRevision?: string; path?: string; helm?: { parameters?: { name: string; value: string }[] } };
    destination?: { server?: string; namespace?: string };
    syncPolicy?: { automated?: { prune?: boolean; selfHeal?: boolean } };
  } | undefined;
  const status = app.status as { sync?: { status?: string }; health?: { status?: string } } | undefined;

  const lines: string[] = [];
  lines.push(`Name:               ${app.metadata.namespace ?? "argocd"}/${app.metadata.name}`);
  lines.push(`Project:            ${spec?.project ?? "default"}`);
  lines.push(`Server:             ${spec?.destination?.server ?? "https://kubernetes.default.svc"}`);
  lines.push(`Namespace:          ${spec?.destination?.namespace ?? "-"}`);
  lines.push(`URL:                https://localhost:8080/applications/${app.metadata.name}`);
  lines.push(`Repo:               ${spec?.source?.repoURL ?? "-"}`);
  lines.push(`Target:             ${spec?.source?.targetRevision ?? "-"}`);
  lines.push(`Path:               ${spec?.source?.path ?? "-"}`);
  if (spec?.source?.helm?.parameters?.length) {
    lines.push(`Helm Parameters:`);
    for (const p of spec.source.helm.parameters) lines.push(`  ${p.name}=${p.value}`);
  }
  lines.push(`SyncPolicy:         ${spec?.syncPolicy?.automated ? `Automated (Prune=${spec.syncPolicy.automated.prune ?? false}, SelfHeal=${spec.syncPolicy.automated.selfHeal ?? false})` : "Manual"}`);
  lines.push(`Sync Status:        ${status?.sync?.status ?? "Unknown"}`);
  lines.push(`Health Status:      ${status?.health?.status ?? "Unknown"}`);
  return lines;
}

export function formatArgocdAppDiff(app: K8sObject, diffText: string | undefined): string[] {
  const status = app.status as { sync?: { status?: string } } | undefined;
  if (!diffText) {
    if (status?.sync?.status === "Synced") {
      return [`Application '${app.metadata.name}' is Synced - live state matches git. No diff.`];
    }
    return [`Application '${app.metadata.name}' is ${status?.sync?.status ?? "Unknown"}, but no field-level diff is available for this failure mode.`, "Try 'kubectl describe application' for the underlying condition/error instead."];
  }
  return diffText.split("\n");
}
