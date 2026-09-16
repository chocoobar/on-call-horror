import type { Scenario } from "../types";

export const theDiamondThatWasntResolved: Scenario = {
  id: "the-diamond-that-wasnt-resolved",
  title: "The Diamond That Wasn't Resolved",
  subtitle: "a shipping-cost estimator plugin behaves completely differently depending on which two interfaces happen to be listed first",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 22,
  tags: ["java25", "default-methods", "interfaces"],
  briefing: `A new \`PremiumShipping\` class was written to combine behavior from two
existing interfaces, \`Discountable\` and \`Taxable\`, both of which happen
to define their own default \`adjust(double)\` method for slightly
different reasons. The class compiled without any visible error, but its
shipping cost adjustment quietly applies the wrong interface's logic in
production.`,
  constraints: [
    "Both `Discountable.adjust(...)` and `Taxable.adjust(...)`'s own individual logic are confirmed correct in isolation - the problem is entirely in which one `PremiumShipping` actually ends up using.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "shipping-estimator", namespace: "shipping", labels: { app: "shipping-estimator" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "2mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "shipping-estimator-3f4g5h6i7-j8k9l", namespace: "shipping", labels: { app: "shipping-estimator" } },
        status: { phase: "Running", containerStatuses: [{ name: "shipping-estimator", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "shipping-estimator": [
            "2026-09-15T08:15:02.114Z DEBUG c.e.shipping.PremiumShipping - base cost=20.00",
            "2026-09-15T08:15:02.116Z INFO  c.e.shipping.PremiumShipping - adjusted cost=18.00 (applied: Taxable.adjust, expected: Discountable.adjust)",
          ],
        },
        age: "2mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "premium-shipping-notes", namespace: "shipping" },
        spec: {
          data: {
            "PremiumShipping.java.excerpt":
              "public interface Discountable {\n    default double adjust(double base) {\n        return base * 0.9;   // 10% discount\n    }\n}\n\npublic interface Taxable {\n    default double adjust(double base) {\n        return base * 0.9;   // coincidentally also 9x0.1 shaped, but means\n                              // 'apply this region's 10% surcharge deduction'\n                              // for an entirely different business reason\n    }\n}\n\n// PremiumShipping.java:\npublic class PremiumShipping implements Discountable, Taxable {\n    @Override\n    public double adjust(double base) {\n        return Taxable.super.adjust(base);   // explicitly resolved here,\n            // but to the WRONG interface for this class's intended behavior\n    }\n}\n",
          },
        },
        age: "2mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap premium-shipping-notes -n shipping -o yaml` - both `Discountable` and `Taxable` declare a default `adjust(double)` method. Does `PremiumShipping` even compile without resolving that conflict explicitly?",
    "When a class implements two interfaces that both declare the same default method signature, Java refuses to compile unless the class overrides that method itself - resolving the 'diamond' by explicitly choosing (or combining) one or both via `InterfaceName.super.method(...)`.",
    "`PremiumShipping` does override `adjust` explicitly, calling `Taxable.super.adjust(base)` - is that the interface the class's actual intended business behavior needed?",
  ],
  options: [
    {
      id: "explicit-super-call-resolved-to-wrong-interface",
      label:
        "`PremiumShipping` implements both `Discountable` and `Taxable`, which both declare a conflicting default `adjust(double)` method - Java requires the class to explicitly override `adjust` and resolve the conflict, which it does, but the override explicitly calls `Taxable.super.adjust(base)` when the class's actual intended behavior was `Discountable`'s discount logic, so it compiles cleanly and resolves the diamond, just to the wrong interface's implementation.",
      explanation:
        "The log shows `adjusted cost=18.00 (applied: Taxable.adjust, expected: Discountable.adjust)` - the calculation itself succeeded, using a real, valid default method, just the wrong one. `PremiumShipping.java.excerpt` shows both interfaces declare their own `adjust(double)` default method, which forces `PremiumShipping` to override `adjust` explicitly and resolve the conflict via `InterfaceName.super.adjust(...)` - which it does, but the specific interface chosen, `Taxable.super.adjust(base)`, isn't the one the class's actual intended behavior (a discount, not a tax adjustment) needed. This is a deliberate, compiling, syntactically-correct diamond resolution - just resolved to the semantically wrong default method for this class's purpose.",
    },
    {
      id: "discountable-adjust-method-has-wrong-math",
      label: "`Discountable.adjust(...)`'s own discount calculation formula is incorrect.",
      explanation:
        "Both interfaces' individual `adjust` implementations are confirmed correct in isolation - `Discountable.adjust`'s formula is exactly the 10% discount it's meant to be; `PremiumShipping` simply never calls it at all, calling `Taxable.super.adjust(...)` instead.",
    },
    {
      id: "diamond-inheritance-causes-undefined-behavior",
      label: "Java's handling of the diamond problem for default methods is inherently non-deterministic here.",
      explanation:
        "Java's resolution of default method conflicts is fully deterministic and well-specified - a class implementing two interfaces with a conflicting default method simply fails to compile unless it explicitly overrides the method, and the code here does compile, meaning the conflict was explicitly (if incorrectly) resolved by the developer, not left to any runtime ambiguity.",
    },
    {
      id: "premiumshipping-missing-override-annotation",
      label: "`PremiumShipping`'s `adjust` method is missing the `@Override` annotation, causing it to be ignored.",
      explanation:
        "The excerpt clearly shows `@Override` present on `PremiumShipping.adjust`, and the method is genuinely being called and executed (its result is what's logged) - the annotation's presence or absence doesn't determine which interface's default logic gets invoked from inside the method body.",
    },
  ],
  correctOptionId: "explicit-super-call-resolved-to-wrong-interface",
  resolution: `The log shows the calculation completing successfully, just against the
wrong logic: \`adjusted cost=18.00 (applied: Taxable.adjust, expected:
Discountable.adjust)\`. \`PremiumShipping.java.excerpt\` shows why this is
possible at all: both \`Discountable\` and \`Taxable\` declare their own
default \`adjust(double)\` method. When a class implements two interfaces
that both provide a default implementation of the same method signature,
Java's compiler refuses to compile the class unless it explicitly
overrides that method itself - there's no automatic "pick one" or
"merge them" behavior, which is exactly the safety net that stopped this
from silently compiling with ambiguous behavior. \`PremiumShipping\` does
override \`adjust\`, correctly resolving the diamond conflict by calling
\`Taxable.super.adjust(base)\` - syntactically and semantically valid Java,
fully deterministic, and not a compiler bug or limitation at all. The
actual mistake is a plain business-logic error: the developer resolving
this diamond picked \`Taxable\`'s default method when the class's actual
intended purpose needed \`Discountable\`'s.

The fix is calling the correct interface's default method (or, if both
adjustments are genuinely needed, deliberately combining them):

\`\`\`java
public class PremiumShipping implements Discountable, Taxable {
    @Override
    public double adjust(double base) {
        return Discountable.super.adjust(base);   // the interface this
                                                    // class actually needs
    }
}
\`\`\`

The general rule: implementing two interfaces with a colliding default
method forces an explicit resolution via \`InterfaceName.super.method(...)\`
- the compiler guarantees *that* choice is made deliberately, but it has
no way to verify *which* interface was chosen is the semantically
correct one for the implementing class's actual purpose; that's a
business-logic decision the type system can't catch on its own, so it's
worth double-checking explicitly whenever two same-named default methods
happen to collide.`,
};
