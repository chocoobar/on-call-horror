# On-Call Horror

A deductive investigation game for ArgoCD/Kubernetes on-call incidents - played
entirely in your browser, with no real cluster, no Docker, and no backend.

Each scenario gives you a mocked `kubectl`/`argocd` console pre-loaded with a
broken (but realistic-looking) cluster state. You investigate with read-only
commands (`get`, `describe`, `logs`, `argocd app get`/`diff`), gather clues,
then submit a diagnosis - like a detective game, but for on-call incidents.

Inspired by [sadservers.com](https://sadservers.com), but scoped to
ArgoCD/Kubernetes GitOps incidents and built as a static client-side app
instead of provisioning real infrastructure.

## Run it locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

## Build

```bash
npm run build
```

Configured as a static export (`output: "export"` in `next.config.mjs`) -
the build produces a fully static `out/` directory with no server required,
deployable to GitHub Pages, Netlify, or any static host.

## How it works

- `lib/scenarios/<topic>/*.ts` - one file per scenario, grouped into a folder
  per topic (`kubernetes/`, `argocd/`, `spring-boot/`, `observability/`,
  `networking/`, `java-bugs/`): briefing, constraints, a mock cluster state
  (`world.resources`, a list of `K8sObject`s shaped like real Kubernetes/
  ArgoCD API objects), progressive hints, and a multiple-choice diagnosis
  (one correct option, three plausible wrong ones, each with an
  explanation). `lib/scenarios/generated.ts` (gitignored, rebuilt by `npm run
  generate:scenarios` / `dev` / `build`) is the single generated list of
  every scenario file - nothing needs to be registered by hand.
- `lib/terminal/` - a small mock `kubectl`/`argocd` interpreter: parses the
  typed command, looks resources up in the current scenario's `world`, and
  renders realistic `get` tables, `describe` output, and `logs`. Mutating
  verbs (`apply`, `edit`, `patch`, `scale`, `argocd app sync`, etc.) are
  recognized and explicitly blocked with an in-character message - this is a
  read-only forensics console, not a live cluster.
- `components/Terminal.tsx` - the terminal UI (command history, arrow-key
  recall) that calls into `lib/terminal/run.ts`.
- `components/DiagnosisPanel.tsx` - the multiple-choice submission UI; grades
  instantly against `scenario.correctOptionId` and shows the full resolution
  on a correct answer.
- `lib/progress.ts` - solved-scenario tracking in `localStorage` (per-browser,
  nothing sent anywhere).

Scenarios are grouped into topics (Kubernetes, Argo CD, ...) shown as a side
nav on the catalog page. `lib/topics.ts` defines the topic list, and each
scenario's `topic` field (in `lib/scenarios/types.ts`) picks which one it
belongs to; `app/topic/[topic]/page.tsx` renders each topic's scenarios as
its own static page.

## Adding a new scenario

Add a new file under `lib/scenarios/<topic>/` (filename and the scenario's
`id` field must match, e.g. `lib/scenarios/kubernetes/the-thing.ts` needs
`id: "the-thing"`) following the `Scenario` type in `lib/scenarios/types.ts`.
That's it - no separate registration step. `npm run generate:scenarios`
(which `dev`/`build` also run automatically) scans every topic folder and
regenerates `lib/scenarios/generated.ts`; it fails loudly if a file's `id`
doesn't match its filename, its `topic` field doesn't match its folder, or
two scenarios collide on `id` or export name. Use an existing scenario
(e.g. `lib/scenarios/argocd/stuck-at-3am.ts`) as a template:

- `topic` - which side nav section it belongs to, and which folder the file
  lives in (an id from `lib/topics.ts`). To add a whole new topic, add an
  entry to `TOPICS` in `lib/topics.ts` and create the matching
  `lib/scenarios/<id>/` folder first.
- `world.resources` - the mock objects that exist when the scenario starts.
  Only `apiVersion`/`kind`/`metadata`/`spec`/`status` are ever shown to the
  player (via `-o yaml`/`-o json`/`describe`); `age`, `events`, `logs`, and
  `previousLogs` are mock-engine bookkeeping used by the table/describe/logs
  renderers.
- `options` - exactly one entry's `id` should match `correctOptionId`; write
  a real explanation for every option (shown after submission, right or
  wrong).
- `hints` - revealed one at a time, most subtle first.
- `resolution` - shown after a correct diagnosis; supports Markdown (used
  for inline `code` and fenced code blocks).

## License

MIT - see [LICENSE](LICENSE).
