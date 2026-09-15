export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of input.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

export interface ParsedArgs {
  positional: string[];
  namespace?: string;
  output?: string;
  selector?: string;
  container?: string;
  previous?: boolean;
  allNamespaces?: boolean;
}

export function parseArgs(tokens: string[]): ParsedArgs {
  const positional: string[] = [];
  const out: ParsedArgs = { positional };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.startsWith("-")) {
      positional.push(t);
      continue;
    }
    const eqIdx = t.indexOf("=");
    const flag = eqIdx >= 0 ? t.slice(0, eqIdx) : t;
    const inlineVal = eqIdx >= 0 ? t.slice(eqIdx + 1) : undefined;
    const takeValue = () => (inlineVal !== undefined ? inlineVal : tokens[++i]);

    switch (flag) {
      case "-n":
      case "--namespace":
        out.namespace = takeValue();
        break;
      case "-o":
      case "--output":
        out.output = takeValue();
        break;
      case "-l":
      case "--selector":
        out.selector = takeValue();
        break;
      case "-c":
      case "--container":
        out.container = takeValue();
        break;
      case "--previous":
        out.previous = true;
        break;
      case "-A":
      case "--all-namespaces":
        out.allNamespaces = true;
        break;
      case "--context":
        takeValue(); // accepted, ignored - this mock world has exactly one context
        break;
      default:
        // unrecognized flag: ignore rather than error, keeps the console forgiving
        if (inlineVal === undefined && !t.includes("=")) {
          // could be a boolean flag we don't model; don't consume the next token
        }
        break;
    }
  }
  return out;
}

const KIND_ALIASES: Record<string, string> = {
  po: "Pod",
  pod: "Pod",
  pods: "Pod",
  deploy: "Deployment",
  deployment: "Deployment",
  deployments: "Deployment",
  svc: "Service",
  service: "Service",
  services: "Service",
  cm: "ConfigMap",
  configmap: "ConfigMap",
  configmaps: "ConfigMap",
  app: "Application",
  apps: "Application",
  application: "Application",
  applications: "Application",
  appproject: "AppProject",
  appprojects: "AppProject",
  proj: "AppProject",
  projects: "AppProject",
  job: "Job",
  jobs: "Job",
};

export function normalizeKind(raw: string): string {
  return KIND_ALIASES[raw.toLowerCase()] ?? raw;
}

export function matchesSelector(labels: Record<string, string> | undefined, selector?: string): boolean {
  if (!selector) return true;
  if (!labels) return false;
  return selector.split(",").every((pair) => {
    const [k, v] = pair.split("=");
    return labels[k] === v;
  });
}
