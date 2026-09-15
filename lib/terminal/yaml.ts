function needsQuotes(s: string): boolean {
  if (s === "") return true;
  if (/^[\s]|[\s]$/.test(s)) return true;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s)) return true;
  if (/: |:$/.test(s)) return true;
  if (/^(true|false|null|~|\d+(\.\d+)?)$/i.test(s)) return true;
  return false;
}

function scalarToYaml(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  const s = String(v);
  return needsQuotes(s) ? JSON.stringify(s) : s;
}

export function toYamlLines(obj: unknown, indent = 0): string[] {
  const pad = "  ".repeat(indent);
  const lines: string[] = [];

  if (Array.isArray(obj)) {
    if (obj.length === 0) return [`${pad}[]`];
    for (const item of obj) {
      if (item !== null && typeof item === "object") {
        const sub = toYamlLines(item, indent + 1);
        lines.push(`${pad}- ${sub[0]?.trimStart() ?? ""}`, ...sub.slice(1));
      } else {
        lines.push(`${pad}- ${scalarToYaml(item)}`);
      }
    }
    return lines;
  }

  if (obj !== null && typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return [`${pad}{}`];
    for (const [k, v] of entries) {
      if (v === null || v === undefined) {
        lines.push(`${pad}${k}: null`);
      } else if (Array.isArray(v)) {
        if (v.length === 0) {
          lines.push(`${pad}${k}: []`);
        } else {
          lines.push(`${pad}${k}:`);
          lines.push(...toYamlLines(v, indent + 1));
        }
      } else if (typeof v === "object") {
        if (Object.keys(v).length === 0) {
          lines.push(`${pad}${k}: {}`);
        } else {
          lines.push(`${pad}${k}:`);
          lines.push(...toYamlLines(v, indent + 1));
        }
      } else {
        lines.push(`${pad}${k}: ${scalarToYaml(v)}`);
      }
    }
    return lines;
  }

  return [`${pad}${scalarToYaml(obj)}`];
}
