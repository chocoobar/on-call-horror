import type { K8sObject } from "@/lib/scenarios/types";

export function col(values: string[][]): string[] {
  if (values.length === 0) return [];
  const widths = values[0].map((_, i) => Math.max(...values.map((row) => row[i].length)) + 2);
  return values.map((row) => row.map((cell, i) => cell.padEnd(widths[i])).join("").trimEnd());
}

function age(o: K8sObject): string {
  return o.age ?? "1h";
}

function podStatus(o: K8sObject): { ready: string; status: string; restarts: string } {
  const statuses = (o.status?.containerStatuses as Array<{
    ready?: boolean;
    restartCount?: number;
    state?: { waiting?: { reason?: string }; terminated?: { reason?: string }; running?: unknown };
  }>) ?? [];
  const total = statuses.length || 1;
  const readyCount = statuses.filter((c) => c.ready).length;
  const restarts = statuses.reduce((sum, c) => sum + (c.restartCount ?? 0), 0);

  let status = String(o.status?.phase ?? "Unknown");
  const waiting = statuses.find((c) => c.state?.waiting?.reason)?.state?.waiting?.reason;
  const terminated = statuses.find((c) => c.state?.terminated?.reason)?.state?.terminated?.reason;
  if (waiting) status = waiting;
  else if (terminated && status !== "Running") status = terminated;

  return { ready: `${readyCount}/${total}`, status, restarts: String(restarts) };
}

export function renderTable(kind: string, items: K8sObject[], opts: { showNamespace?: boolean } = {}): string[] {
  const nsCol = opts.showNamespace ? ["NAMESPACE"] : [];
  const nsVal = (o: K8sObject) => (opts.showNamespace ? [o.metadata.namespace ?? "default"] : []);

  switch (kind) {
    case "Pod": {
      const header = [...nsCol, "NAME", "READY", "STATUS", "RESTARTS", "AGE"];
      const rows = items.map((o) => {
        const { ready, status, restarts } = podStatus(o);
        return [...nsVal(o), o.metadata.name, ready, status, restarts, age(o)];
      });
      return col([header, ...rows]);
    }
    case "Deployment": {
      const header = [...nsCol, "NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE"];
      const rows = items.map((o) => {
        const desired = Number(o.spec?.replicas ?? 0);
        const ready = Number(o.status?.readyReplicas ?? 0);
        const updated = Number(o.status?.updatedReplicas ?? 0);
        const available = Number(o.status?.availableReplicas ?? 0);
        return [...nsVal(o), o.metadata.name, `${ready}/${desired}`, String(updated), String(available), age(o)];
      });
      return col([header, ...rows]);
    }
    case "Service": {
      const header = [...nsCol, "NAME", "TYPE", "CLUSTER-IP", "EXTERNAL-IP", "PORT(S)", "AGE"];
      const rows = items.map((o) => {
        const ports = (o.spec?.ports as Array<{ port: number; targetPort?: number }>) ?? [];
        const portStr = ports.map((p) => `${p.port}/TCP`).join(",") || "<none>";
        return [...nsVal(o), o.metadata.name, String(o.spec?.type ?? "ClusterIP"), String(o.spec?.clusterIP ?? "10.96.0.1"), "<none>", portStr, age(o)];
      });
      return col([header, ...rows]);
    }
    case "ConfigMap": {
      const header = [...nsCol, "NAME", "DATA", "AGE"];
      const rows = items.map((o) => {
        const data = (o.spec?.data as Record<string, string> | undefined) ?? {};
        return [...nsVal(o), o.metadata.name, String(Object.keys(data).length), age(o)];
      });
      return col([header, ...rows]);
    }
    case "Application": {
      const header = [...nsCol, "NAME", "SYNC STATUS", "HEALTH STATUS", "REVISION", "AGE"];
      const rows = items.map((o) => {
        const sync = (o.status?.sync as { status?: string; revision?: string } | undefined) ?? {};
        const health = (o.status?.health as { status?: string } | undefined) ?? {};
        return [...nsVal(o), o.metadata.name, sync.status ?? "Unknown", health.status ?? "Unknown", (sync.revision ?? "").slice(0, 7) || "-", age(o)];
      });
      return col([header, ...rows]);
    }
    case "AppProject": {
      const header = [...nsCol, "NAME", "AGE"];
      const rows = items.map((o) => [...nsVal(o), o.metadata.name, age(o)]);
      return col([header, ...rows]);
    }
    case "Job": {
      const header = [...nsCol, "NAME", "COMPLETIONS", "DURATION", "AGE"];
      const rows = items.map((o) => {
        const succeeded = Number(o.status?.succeeded ?? 0);
        const completions = Number(o.spec?.completions ?? 1);
        return [...nsVal(o), o.metadata.name, `${succeeded}/${completions}`, String(o.status?.duration ?? age(o)), age(o)];
      });
      return col([header, ...rows]);
    }
    default: {
      const header = [...nsCol, "NAME", "AGE"];
      const rows = items.map((o) => [...nsVal(o), o.metadata.name, age(o)]);
      return col([header, ...rows]);
    }
  }
}

/** `kubectl get events` - flattens every resource's own `events` list into one table, like the real command. */
export function renderEvents(items: K8sObject[], opts: { showNamespace?: boolean } = {}): string[] {
  const nsCol = opts.showNamespace ? ["NAMESPACE"] : [];
  const rows: string[][] = [];
  for (const o of items) {
    for (const e of o.events ?? []) {
      const nsVal = opts.showNamespace ? [o.metadata.namespace ?? "default"] : [];
      const object = `${o.kind.toLowerCase()}/${o.metadata.name}`;
      rows.push([...nsVal, e.age, e.type, e.reason, object, e.message]);
    }
  }
  if (rows.length === 0) return [];
  const header = [...nsCol, "LAST SEEN", "TYPE", "REASON", "OBJECT", "MESSAGE"];
  return col([header, ...rows]);
}

function dumpSection(title: string, value: Record<string, unknown> | undefined): string[] {
  if (!value || Object.keys(value).length === 0) return [`${title}:  <none>`];
  const lines: string[] = [`${title}:`];
  for (const [k, v] of Object.entries(value)) {
    lines.push(...dumpKeyValue(k, v, 1));
  }
  return lines;
}

function dumpKeyValue(key: string, value: unknown, indent: number): string[] {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) return [`${pad}${key}:  <none>`];
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}${key}:  []`];
    if (value.every((v) => v === null || typeof v !== "object")) {
      return [`${pad}${key}:  ${value.join(", ")}`];
    }
    const lines = [`${pad}${key}:`];
    value.forEach((item, i) => {
      lines.push(`${pad}  [${i}]`);
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        lines.push(...dumpKeyValue(k, v, indent + 2));
      }
    });
    return lines;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return [`${pad}${key}:  {}`];
    const lines = [`${pad}${key}:`];
    for (const [k, v] of entries) lines.push(...dumpKeyValue(k, v, indent + 1));
    return lines;
  }
  return [`${pad}${key}:  ${value}`];
}

export function describeObject(o: K8sObject): string[] {
  const lines: string[] = [];
  lines.push(`Name:         ${o.metadata.name}`);
  if (o.metadata.namespace) lines.push(`Namespace:    ${o.metadata.namespace}`);
  const labels = o.metadata.labels ?? {};
  lines.push(`Labels:       ${Object.keys(labels).length ? Object.entries(labels).map(([k, v]) => `${k}=${v}`).join("\n              ") : "<none>"}`);
  const annotations = o.metadata.annotations ?? {};
  lines.push(`Annotations:  ${Object.keys(annotations).length ? Object.entries(annotations).map(([k, v]) => `${k}: ${v}`).join("\n              ") : "<none>"}`);
  lines.push("");
  lines.push(...dumpSection("Spec", o.spec));
  lines.push("");
  lines.push(...dumpSection("Status", o.status));
  lines.push("");

  if (o.events && o.events.length > 0) {
    lines.push("Events:");
    lines.push(...col([
      ["Type", "Reason", "Age", "Message"],
      ...o.events.map((e) => [e.type, e.reason, e.age, e.message]),
    ]));
  } else {
    lines.push("Events:  <none>");
  }
  return lines;
}
