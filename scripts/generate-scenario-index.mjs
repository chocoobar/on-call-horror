#!/usr/bin/env node
// Regenerates lib/scenarios/generated.ts from the files under lib/scenarios/<topic>/*.ts.
//
// Scenario files are grouped into one folder per topic instead of a single flat
// directory, and this script is the only place that turns "every .ts file under
// lib/scenarios/<topic>/" into the explicit import list Next.js needs to bundle
// them. Adding, removing, or moving a scenario is just a filesystem change -
// run `npm run generate:scenarios` (or `npm run dev` / `npm run build`, which do
// it automatically) and lib/scenarios/generated.ts is rewritten to match.
//
// Do not hand-edit lib/scenarios/generated.ts - it's overwritten every run.

import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scenariosDir = join(repoRoot, "lib", "scenarios");
const topicsFile = join(repoRoot, "lib", "topics.ts");
const outFile = join(scenariosDir, "generated.ts");

function fail(message) {
  console.error(`generate-scenario-index: ${message}`);
  process.exit(1);
}

// lib/topics.ts is the single source of truth for which topic ids (and therefore
// which lib/scenarios/<id>/ folders) are allowed to exist.
const topicsSource = readFileSync(topicsFile, "utf-8");
const topicsArrayMatch = topicsSource.match(/TOPICS:\s*Topic\[\]\s*=\s*\[([\s\S]*?)\n\];/);
if (!topicsArrayMatch) fail("couldn't find `TOPICS: Topic[] = [...]` in lib/topics.ts");
const validTopics = new Set([...topicsArrayMatch[1].matchAll(/id:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]));
if (validTopics.size === 0) fail("parsed zero topic ids out of lib/topics.ts");

const entries = []; // { topic, id, exportName, importPath }
const seenIds = new Map();
const seenExportNames = new Map();

const topLevelEntries = readdirSync(scenariosDir, { withFileTypes: true });
for (const entry of topLevelEntries) {
  if (!entry.isDirectory()) continue;
  const topic = entry.name;
  if (!validTopics.has(topic)) {
    fail(`lib/scenarios/${topic}/ doesn't match any topic id in lib/topics.ts (valid: ${[...validTopics].join(", ")})`);
  }

  const dir = join(scenariosDir, topic);
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts")) continue;
    const path = join(dir, file);
    const id = file.slice(0, -".ts".length);
    const source = readFileSync(path, "utf-8");

    const exportMatch = source.match(/export const (\w+): Scenario\b/);
    if (!exportMatch) fail(`lib/scenarios/${topic}/${file} has no \`export const NAME: Scenario\``);
    const exportName = exportMatch[1];

    const idMatch = source.match(/\bid:\s*"([^"]+)"/);
    if (!idMatch) fail(`lib/scenarios/${topic}/${file} has no \`id:\` field`);
    if (idMatch[1] !== id) {
      fail(`lib/scenarios/${topic}/${file}: id field "${idMatch[1]}" must match the filename ("${id}")`);
    }

    const topicMatch = source.match(/\btopic:\s*"([^"]+)"/);
    if (!topicMatch) fail(`lib/scenarios/${topic}/${file} has no \`topic:\` field`);
    if (topicMatch[1] !== topic) {
      fail(`lib/scenarios/${topic}/${file}: topic field "${topicMatch[1]}" must match its folder ("${topic}")`);
    }

    if (seenIds.has(id)) fail(`duplicate scenario id "${id}": lib/scenarios/${topic}/${file} and ${seenIds.get(id)}`);
    seenIds.set(id, `lib/scenarios/${topic}/${file}`);
    if (seenExportNames.has(exportName)) {
      fail(`duplicate export name "${exportName}": lib/scenarios/${topic}/${file} and ${seenExportNames.get(exportName)}`);
    }
    seenExportNames.set(exportName, `lib/scenarios/${topic}/${file}`);

    entries.push({ topic, id, exportName, importPath: `./${topic}/${id}` });
  }
}

if (entries.length === 0) fail("found zero scenario files under lib/scenarios/<topic>/");

entries.sort((a, b) => a.id.localeCompare(b.id));

const header = `// GENERATED FILE - do not edit by hand.
// Produced by \`npm run generate:scenarios\` (scripts/generate-scenario-index.mjs)
// from every lib/scenarios/<topic>/*.ts file. Add, remove, or move a scenario
// file and re-run that script (or \`npm run dev\` / \`npm run build\`) instead of
// editing this file directly - your changes will be overwritten.

import type { Scenario } from "./types";
`;

const imports = entries.map((e) => `import { ${e.exportName} } from "${e.importPath}";`).join("\n");
const arrayBody = entries.map((e) => `  ${e.exportName},`).join("\n");

const output = `${header}
${imports}

export const allScenarios: Scenario[] = [
${arrayBody}
];
`;

writeFileSync(outFile, output);

const perTopic = {};
for (const e of entries) perTopic[e.topic] = (perTopic[e.topic] ?? 0) + 1;
console.log(`generate-scenario-index: wrote ${entries.length} scenarios to lib/scenarios/generated.ts`);
for (const topic of [...validTopics].sort()) {
  console.log(`  ${topic}: ${perTopic[topic] ?? 0}`);
}
