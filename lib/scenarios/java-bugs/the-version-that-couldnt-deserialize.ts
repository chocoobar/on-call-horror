import type { Scenario } from "../types";

export const theVersionThatCouldntDeserialize: Scenario = {
  id: "the-version-that-couldnt-deserialize",
  title: "The Version That Couldn't Deserialize",
  subtitle: "cached shopping carts start vanishing for a chunk of users during every rolling deploy, only during the deploy window",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 22,
  tags: ["java25", "serialization", "rolling-deploy"],
  briefing: `"cart-cache" stores each customer's shopping cart as a Java-serialized
object in a shared cache, read and written by whichever pod handles
each request. During every rolling deploy, a chunk of customers briefly
see an empty cart mid-session, even though nothing about the cart data
itself changed - it comes back once the deploy finishes.`,
  constraints: [
    "The cart data written to the cache immediately before the deploy is confirmed present and byte-complete in the cache store throughout the deploy window - it isn't evicted or expired.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "cart-cache", namespace: "cart", labels: { app: "cart-cache" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 4, updatedReplicas: 2, availableReplicas: 4 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "cart-cache-4g5h6i7j8-k9l0m", namespace: "cart", labels: { app: "cart-cache" } },
        status: { phase: "Running", containerStatuses: [{ name: "cart-cache", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "cart-cache": [
            "2026-09-15T16:00:02.114Z WARN  c.e.cart.CartCache - java.io.InvalidClassException: com.example.cart.Cart; local class incompatible: stream classdesc serialVersionUID = 4821096603336723456, local class serialVersionUID = 7719203381004415221",
            "2026-09-15T16:00:02.116Z INFO  c.e.cart.CartCache - deserialization failed for customer cust-2201, returning empty cart",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "cart-cache-notes", namespace: "cart" },
        spec: {
          data: {
            "Cart.java.excerpt":
              "public class Cart implements Serializable {\n    // no explicit serialVersionUID declared anywhere in this class\n    private List<CartItem> items;\n    private String promoCode;   // field added in this release\n}\n",
            "notes.md":
              "Without an explicit `serialVersionUID` field, the JVM computes one\nautomatically at class-load time, derived from the class's structure -\nfield names, types, method signatures, and more. Adding a new field to\na class changes that computed structure, which changes the\nauto-derived serialVersionUID, even though the change itself (a new,\noptional field) would otherwise be a harmless, backward-compatible\naddition.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl logs cart-cache-4g5h6i7j8-k9l0m -n cart` - `InvalidClassException` names two different `serialVersionUID` values for the exact same class. During a rolling deploy, is every pod necessarily running the exact same code?",
    "`kubectl get configmap cart-cache-notes -n cart -o yaml` - `Cart` doesn't declare an explicit `serialVersionUID`. What determines the UID Java uses for serialization compatibility checks when it isn't declared explicitly?",
    "During a rolling deploy, old-version pods and new-version pods run side by side for a while - a cart serialized by an old-version pod (with the old class structure's auto-derived UID) can't be deserialized by a new-version pod expecting the new structure's different auto-derived UID, and vice versa.",
  ],
  options: [
    {
      id: "missing-serialversionuid-rolling-deploy-mismatch",
      label:
        "`Cart` never declares an explicit `serialVersionUID`, so the JVM auto-derives one from the class's structure at load time - adding the new `promoCode` field this release changed that structure, which changed the auto-derived UID; during the rolling deploy, old-version pods (old UID) and new-version pods (new UID) run simultaneously, so any cart serialized by one version and read back by a pod running the other version fails `InvalidClassException` and falls back to an empty cart, purely because of which two specific pods happened to handle a given customer's requests during the deploy window.",
      explanation:
        "The warning log shows exactly this: `InvalidClassException` reporting two different `serialVersionUID` values for the same `Cart` class - one from the serialized stream, one from the currently-loaded class. `Cart.java.excerpt` confirms no explicit `serialVersionUID` is declared, and `cart-cache-notes` explains that without one, the JVM computes it automatically from the class's structure - which the new release's added `promoCode` field changed, producing a different auto-derived UID than the previous version had. Since a rolling deploy runs old and new pod versions side by side for a period, any customer whose cart was serialized by one version and later read back by a pod running the other version hits exactly this mismatch - explaining why it only ever happens during the deploy window, briefly, for a subset of customers, and resolves itself once the rollout completes and every pod is running the same version again.",
    },
    {
      id: "cache-eviction-policy-triggered-by-deploy",
      label: "The cache's eviction policy is triggered by pod restarts during the deploy, clearing entries.",
      explanation:
        "The constraint confirms the cart data is present and byte-complete in the cache store throughout the deploy window - it isn't evicted or missing at all; the cache read succeeds in retrieving bytes, it's the deserialization of those retrieved bytes into a `Cart` object that fails.",
    },
    {
      id: "cart-item-list-corrupted-during-deploy",
      label: "The `CartItem` list within the cart is being corrupted by concurrent writes during the deploy.",
      explanation:
        "`InvalidClassException` is thrown before any field values are even read - it's a structural compatibility check on the class definition itself, failing before deserialization gets far enough to touch individual field contents like the item list.",
    },
    {
      id: "load-balancer-routing-to-wrong-pod-version",
      label: "The load balancer is routing requests to pods running an incompatible, unrelated older release.",
      explanation:
        "This is normal, expected rolling deploy behavior - routing requests across a mix of both the old and new (both currently valid, intentionally deployed) pod versions during a rollout is by design, not a routing misconfiguration; the actual problem is that the two versions can't read each other's serialized cart data.",
    },
  ],
  correctOptionId: "missing-serialversionuid-rolling-deploy-mismatch",
  resolution: `The warning log names the exact mechanism: \`InvalidClassException\`,
reporting two different \`serialVersionUID\` values for the same \`Cart\`
class - one belonging to the serialized bytes being read, one belonging
to the class currently loaded in that pod's JVM. \`Cart.java.excerpt\`
confirms \`Cart\` never declares an explicit \`serialVersionUID\` field, and
\`cart-cache-notes\` explains what that means: without one, the JVM
computes a UID automatically at class-load time, derived from the
class's structure - its fields, their types, and more. This release
added a new \`promoCode\` field, which is otherwise a harmless, additive,
backward-compatible change from a business logic perspective - but it
changed the class's structure enough to produce a *different*
auto-derived UID than the previous version's \`Cart\` class had. During a
rolling deploy, old-version and new-version pods run side by side for a
period of time by design. Any customer whose cart was serialized by a
pod running one version and later deserialized by a pod running the
other version hits a UID mismatch and \`InvalidClassException\`, which
\`CartCache\` handles by silently returning an empty cart - explaining
precisely why this only ever happens during the deploy window, briefly,
for whichever customers' requests happen to cross between old- and
new-version pods, and resolves itself the moment the rollout finishes.

The fix is declaring an explicit, stable \`serialVersionUID\` and only
changing it deliberately, when a genuinely incompatible change is made:

\`\`\`java
public class Cart implements Serializable {
    private static final long serialVersionUID = 1L;   // stable across
                                                          // additive changes
    private List<CartItem> items;
    private String promoCode;
}
\`\`\`

With an explicit, unchanged UID, adding an optional field like
\`promoCode\` no longer breaks compatibility between versions during a
rolling deploy - Java's default deserialization handles a genuinely
missing field gracefully as long as the UID itself still matches. The
general rule: any \`Serializable\` class whose instances might be stored
or transmitted across a deploy boundary needs an explicit, deliberately
managed \`serialVersionUID\` - relying on the auto-derived default makes
every structural change, however harmless, a silent compatibility break
during rolling deploys.`,
};
