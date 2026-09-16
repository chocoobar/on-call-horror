export type Difficulty = "easy" | "medium" | "hard";
export type ScenarioType = "fix" | "do" | "hack";

export interface K8sEvent {
  type: "Normal" | "Warning";
  reason: string;
  age: string;
  message: string;
}

export interface K8sObject {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    finalizers?: string[];
    deletionTimestamp?: string;
  };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  /** Rendered by `describe` as the trailing Events: table. */
  events?: K8sEvent[];
  /** Container log lines, keyed by container name (or "default" for single-container). */
  logs?: Record<string, string[]>;
  /** Log lines for a previous (crashed) instance of the container, for `--previous`. */
  previousLogs?: Record<string, string[]>;
  /** Age shown in `get` table output, e.g. "14m". */
  age?: string;
}

export interface DiagnosisOption {
  id: string;
  label: string;
  /** Shown after submitting, regardless of correctness. */
  explanation: string;
}

export interface ScenarioWorld {
  /** The mock resources that exist when the scenario starts. */
  resources: K8sObject[];
  /** Static text for `argocd app diff <name>`, if this scenario has live/git drift worth showing. */
  argocdDiff?: Record<string, string>;
}

export interface Scenario {
  id: string;
  title: string;
  subtitle: string;
  difficulty: Difficulty;
  type: ScenarioType;
  /** Matches a `Topic["id"]` from `lib/topics.ts`; drives the side nav grouping. */
  topic: string;
  timeMinutes: number;
  tags: string[];
  /** Story-style incident description, shown before/while investigating. */
  briefing: string;
  constraints: string[];
  world: ScenarioWorld;
  hints: string[];
  options: DiagnosisOption[];
  correctOptionId: string;
  /** Shown after a correct diagnosis - the full "how it actually got fixed" walkthrough. */
  resolution: string;
}
