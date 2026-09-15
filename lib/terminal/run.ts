import type { K8sObject, ScenarioWorld } from "@/lib/scenarios/types";
import { tokenize, parseArgs, normalizeKind, matchesSelector } from "./parse";
import { renderTable, describeObject } from "./format";
import { toYamlLines } from "./yaml";
import { formatArgocdAppGet, formatArgocdAppDiff } from "./argocd";

export interface CommandOutput {
  lines: string[];
  isError?: boolean;
}

const ok = (lines: string[]): CommandOutput => ({ lines });
const err = (lines: string[]): CommandOutput => ({ lines, isError: true });

const BLOCKED_KUBECTL_VERBS = new Set([
  "apply", "edit", "patch", "delete", "scale", "create", "replace", "rollout",
  "exec", "port-forward", "cp", "set", "annotate", "label", "cordon", "drain", "taint", "run",
]);

const BLOCKED_ARGOCD_VERBS = new Set([
  "sync", "terminate-op", "set", "patch", "delete", "rollback", "resource",
]);

function findByKindNameNs(world: ScenarioWorld, kind: string, name: string, namespace?: string): K8sObject | undefined {
  return world.resources.find(
    (r) => r.kind === kind && r.metadata.name === name && (!namespace || (r.metadata.namespace ?? "default") === namespace)
  );
}

function kubectlGet(args: string[], world: ScenarioWorld): CommandOutput {
  const parsed = parseArgs(args);
  const [kindRaw, nameArg] = parsed.positional;
  if (!kindRaw) return err(["error: you must specify the type of resource to get"]);
  const kind = normalizeKind(kindRaw);

  let matches = world.resources.filter((r) => r.kind === kind);
  if (!parsed.allNamespaces && parsed.namespace) {
    matches = matches.filter((r) => (r.metadata.namespace ?? "default") === parsed.namespace);
  }
  if (nameArg) matches = matches.filter((r) => r.metadata.name === nameArg);
  if (parsed.selector) matches = matches.filter((r) => matchesSelector(r.metadata.labels, parsed.selector));

  if (matches.length === 0) {
    if (nameArg) {
      return err([`Error from server (NotFound): ${kind.toLowerCase()}s "${nameArg}" not found`]);
    }
    return ok([`No resources found${parsed.namespace ? ` in ${parsed.namespace} namespace` : ""}.`]);
  }

  if (parsed.output === "yaml") {
    const chunks = matches.map((m) => toYamlLines(m));
    return ok(chunks.flatMap((c, i) => (i < chunks.length - 1 ? [...c, "---"] : c)));
  }
  if (parsed.output === "json") {
    return ok([JSON.stringify(matches.length === 1 ? matches[0] : { items: matches }, null, 2)]);
  }

  return ok(renderTable(kind, matches, { showNamespace: parsed.allNamespaces }));
}

function kubectlDescribe(args: string[], world: ScenarioWorld): CommandOutput {
  const parsed = parseArgs(args);
  const [kindRaw, nameArg] = parsed.positional;
  if (!kindRaw) return err(["error: you must specify the type of resource to describe"]);
  const kind = normalizeKind(kindRaw);

  let matches = world.resources.filter((r) => r.kind === kind);
  if (parsed.namespace) matches = matches.filter((r) => (r.metadata.namespace ?? "default") === parsed.namespace);
  if (nameArg) matches = matches.filter((r) => r.metadata.name === nameArg);
  if (parsed.selector) matches = matches.filter((r) => matchesSelector(r.metadata.labels, parsed.selector));

  if (matches.length === 0) {
    return err([`Error from server (NotFound): ${kind.toLowerCase()}s "${nameArg ?? ""}" not found`]);
  }

  return ok(matches.flatMap((m, i) => [...describeObject(m), ...(i < matches.length - 1 ? ["", "-".repeat(60), ""] : [])]));
}

function kubectlLogs(args: string[], world: ScenarioWorld): CommandOutput {
  const parsed = parseArgs(args);
  let pods = world.resources.filter((r) => r.kind === "Pod");

  const [nameArg] = parsed.positional;
  if (parsed.namespace) pods = pods.filter((r) => (r.metadata.namespace ?? "default") === parsed.namespace);
  if (nameArg) pods = pods.filter((r) => r.metadata.name === nameArg);
  if (parsed.selector) pods = pods.filter((r) => matchesSelector(r.metadata.labels, parsed.selector));

  if (pods.length === 0) {
    return err([`Error from server (NotFound): pods "${nameArg ?? ""}" not found`]);
  }

  const lines: string[] = [];
  pods.forEach((pod, i) => {
    const logSource = parsed.previous ? pod.previousLogs : pod.logs;
    if (!logSource) {
      if (parsed.previous) {
        lines.push(`Error from server (BadRequest): previous terminated container "${pod.metadata.name}" not found`);
      } else {
        lines.push(`(no logs available for ${pod.metadata.name})`);
      }
      return;
    }
    const containerName = parsed.container ?? Object.keys(logSource)[0];
    const containerLogs = logSource[containerName];
    if (!containerLogs) {
      lines.push(`Error from server (BadRequest): container "${parsed.container}" not found in pod ${pod.metadata.name}`);
      return;
    }
    if (pods.length > 1) lines.push(`==> ${pod.metadata.name} <==`);
    lines.push(...containerLogs);
    if (i < pods.length - 1) lines.push("");
  });

  return ok(lines);
}

function runKubectl(args: string[], world: ScenarioWorld): CommandOutput {
  const [verb, ...rest] = args;
  if (!verb) return err(["error: you must specify a verb (get, describe, logs)"]);
  if (BLOCKED_KUBECTL_VERBS.has(verb)) {
    return err([
      `'kubectl ${verb}' is disabled in this investigation console.`,
      "This is a read-only forensics session - gather evidence with get/describe/logs, then submit your diagnosis below.",
    ]);
  }
  switch (verb) {
    case "get":
      return kubectlGet(rest, world);
    case "describe":
      return kubectlDescribe(rest, world);
    case "logs":
      return kubectlLogs(rest, world);
    default:
      return err([`error: unknown command "kubectl ${verb}"`, "supported: get, describe, logs"]);
  }
}

function runArgocd(args: string[], world: ScenarioWorld): CommandOutput {
  const [group, verb, ...rest] = args;
  if (group !== "app") {
    return err([`error: unknown command "argocd ${group ?? ""}"`, "supported: argocd app get|diff <name>"]);
  }
  if (!verb) return err(["error: argocd app requires a subcommand (get, diff)"]);
  if (BLOCKED_ARGOCD_VERBS.has(verb)) {
    return err([
      `'argocd app ${verb}' is disabled in this investigation console.`,
      "Investigate with 'argocd app get' / 'argocd app diff', then submit your diagnosis below.",
    ]);
  }
  const name = rest.find((t) => !t.startsWith("-"));
  if (!name) return err(["error: argocd app requires an application name"]);
  const app = findByKindNameNs(world, "Application", name);
  if (!app) return err([`application '${name}' not found`]);

  switch (verb) {
    case "get":
      return ok(formatArgocdAppGet(app));
    case "diff":
      return ok(formatArgocdAppDiff(app, world.argocdDiff?.[name]));
    default:
      return err([`error: unknown command "argocd app ${verb}"`, "supported: get, diff"]);
  }
}

const HELP_TEXT = [
  "Available commands (read-only investigation console):",
  "",
  "  kubectl get <kind> [name] [-n namespace] [-A] [-l selector] [-o yaml|json]",
  "  kubectl describe <kind> <name> [-n namespace]",
  "  kubectl logs <pod> [-n namespace] [-c container] [--previous]",
  "  argocd app get <name>",
  "  argocd app diff <name>",
  "  clear",
  "  help",
  "",
  "Kinds: pod, deployment, service, configmap, application, appproject, job",
  "'k' works as a shorthand for 'kubectl'.",
];

export function runCommand(input: string, world: ScenarioWorld): CommandOutput {
  const trimmed = input.trim();
  if (!trimmed) return ok([]);
  const tokens = tokenize(trimmed);
  const bin = tokens[0];

  if (bin === "help") return ok(HELP_TEXT);
  if (bin === "kubectl" || bin === "k") return runKubectl(tokens.slice(1), world);
  if (bin === "argocd") return runArgocd(tokens.slice(1), world);

  return err([`command not found: ${bin}`, "Type 'help' to see what's available."]);
}
