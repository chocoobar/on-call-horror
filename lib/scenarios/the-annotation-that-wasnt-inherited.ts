import type { Scenario } from "./types";

export const theAnnotationThatWasntInherited: Scenario = {
  id: "the-annotation-that-wasnt-inherited",
  title: "The Annotation That Wasn't Inherited",
  subtitle: "the audit-logging aspect fires for every service method except the ones on a brand-new interface-based service",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "annotations", "reflection"],
  briefing: `A custom `@Auditable` annotation on a base class triggers an audit-log
entry for every subclass's method calls, handled by a reflection-based
interceptor. A new payment adjustment feature was built as an interface
implementation instead of a subclass, following a team style
preference - and none of its method calls are showing up in the audit
log at all, a compliance problem nobody noticed until a routine audit.`,
  constraints: [
    "The reflection-based interceptor itself is confirmed to correctly detect and act on `@Auditable` for every other, class-inheritance-based service in the codebase - this is not a bug in the interceptor's general logic.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "payment-adjustment-service", namespace: "payments", labels: { app: "payment-adjustment-service" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "3w",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "payment-adjustment-service-5r6s7t8u9-v0w1x", namespace: "payments", labels: { app: "payment-adjustment-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "payment-adjustment-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "payment-adjustment-service": [
            "2026-09-15T13:10:02.114Z DEBUG c.e.payments.AuditInterceptor - checking isAnnotationPresent(Auditable.class) for AdjustmentServiceImpl.applyAdjustment -> false",
            "2026-09-15T13:10:02.116Z INFO  c.e.payments.AdjustmentServiceImpl - adjustment applied, no audit entry created",
          ],
        },
        age: "3w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "audit-interceptor-notes", namespace: "payments" },
        spec: {
          data: {
            "Auditable.java.excerpt":
              "@Retention(RetentionPolicy.RUNTIME)\n@Inherited   // makes the annotation propagate from a superclass to its subclasses\n@Target(ElementType.TYPE)\npublic @interface Auditable {}\n\n// BaseAuditableService.java - existing pattern, used by most services:\n@Auditable\npublic abstract class BaseAuditableService { }\n\n// AdjustmentService.java - the interface the new service implements instead:\n@Auditable\npublic interface AdjustmentService { void applyAdjustment(); }\n\npublic class AdjustmentServiceImpl implements AdjustmentService {\n    public void applyAdjustment() { /* ... */ }\n}\n",
          },
        },
        age: "3w",
      },
    ],
  },
  hints: [
    "`kubectl get configmap audit-interceptor-notes -n payments -o yaml` - `@Auditable` is declared `@Inherited`. Does `@Inherited` apply when an annotation is placed on an interface, the same way it does on a superclass?",
    "The JDK documentation for `@Inherited` is specific: it only causes annotation inheritance from a superclass to a subclass - it explicitly has no effect on annotations placed on an implemented interface.",
    "`AdjustmentServiceImpl` implements `AdjustmentService`, which carries `@Auditable` - but is `@Auditable` actually present on `AdjustmentServiceImpl.class` itself, from the reflection API's point of view?",
  ],
  options: [
    {
      id: "inherited-annotation-does-not-propagate-from-interfaces",
      label:
        "`@Auditable` is declared `@Inherited`, which - per the JDK's own documentation - only causes an annotation to propagate from a superclass down to its subclasses; it explicitly has no effect when the annotation is placed on an interface instead, so `AdjustmentServiceImpl`, which implements `AdjustmentService` (which itself carries `@Auditable`), does not actually have `@Auditable` present on it from `isAnnotationPresent`'s point of view, even though every existing subclass-based service correctly inherits the annotation from its `@Auditable`-annotated base class.",
      explanation:
        "The debug log shows `isAnnotationPresent(Auditable.class)` returning `false` for `AdjustmentServiceImpl.applyAdjustment`, despite `@Auditable` being present on `AdjustmentService`, the interface it implements. `Auditable.java.excerpt` confirms the annotation is declared `@Inherited` - but the JDK's own documentation for `@Inherited` is explicit that it only causes annotation inheritance from a superclass to subclasses via `Class.isAnnotationPresent`/`getAnnotation`; it has no effect at all for annotations placed on an interface that a class implements. `BaseAuditableService`, an actual superclass, correctly propagates `@Auditable` to its subclasses via this mechanism - but `AdjustmentService`, an interface, does not propagate it to its implementing classes at all, which is exactly why every other, class-inheritance-based service audits correctly while this new interface-based one silently doesn't.",
    },
    {
      id: "auditinterceptor-only-scans-specific-package",
      label: "`AuditInterceptor` is only configured to scan a specific package that doesn't include the new service.",
      explanation:
        "The interceptor is confirmed to correctly detect `@Auditable` for every other service in the codebase, including this one's own package - the debug log shows it's actively checking `AdjustmentServiceImpl` specifically and finding the annotation absent, not skipping it due to any package-scoping configuration.",
    },
    {
      id: "adjustmentserviceimpl-missing-explicit-annotation",
      label: "`AdjustmentServiceImpl` simply forgot to have `@Auditable` applied directly to it as an oversight, unrelated to `@Inherited` semantics.",
      explanation:
        "The class was deliberately built to inherit auditability through implementing the annotated `AdjustmentService` interface, following the existing `@Inherited` pattern used for superclasses elsewhere - the omission is a direct, well-documented consequence of how `@Inherited` specifically does not apply to interfaces, not an arbitrary oversight of forgetting to add the annotation somewhere.",
    },
    {
      id: "retention-policy-set-incorrectly",
      label: "`@Auditable`'s `@Retention` policy is set incorrectly, making it unavailable at runtime.",
      explanation:
        "`Auditable.java.excerpt` shows `@Retention(RetentionPolicy.RUNTIME)`, the correct retention policy for reflection-based detection - and the interceptor correctly detects the annotation for every other, class-based service using the exact same retention policy, confirming retention itself isn't the issue.",
    },
  ],
  correctOptionId: "inherited-annotation-does-not-propagate-from-interfaces",
  resolution: `The debug log shows \`isAnnotationPresent(Auditable.class)\` returning
\`false\` for \`AdjustmentServiceImpl\`, even though \`@Auditable\` is clearly
present on \`AdjustmentService\`, the interface it implements.
\`Auditable.java.excerpt\` shows the annotation is declared \`@Inherited\` -
which sounds like it should solve exactly this problem, but the JDK's
own documentation for \`@Inherited\` is specific and easy to
misremember: it only causes an annotation to be treated as present on a
subclass when it's declared on that subclass's *superclass*. It has no
effect whatsoever on annotations declared on an *interface* that a class
implements - this is explicitly called out in \`java.lang.annotation.Inherited\`'s
own Javadoc, precisely because interface annotation inheritance would
have much more complicated multiple-inheritance implications that the
JDK deliberately doesn't attempt to resolve automatically.
\`BaseAuditableService\`, an actual class serving as a superclass,
correctly propagates \`@Auditable\` down to every subclass via this
mechanism, which is why every existing, class-inheritance-based service
audits correctly - but \`AdjustmentService\` is an interface, and
`@Inherited` simply doesn't reach implementing classes at all, leaving
`AdjustmentServiceImpl` with no detectable `@Auditable` annotation from
reflection's point of view.

The fix is applying the annotation directly to the implementing class
(since `@Inherited` can't bridge the interface gap automatically), or
having the interceptor also check implemented interfaces explicitly:

\`\`\`java
@Auditable   // applied directly, since @Inherited doesn't reach through interfaces
public class AdjustmentServiceImpl implements AdjustmentService {
    public void applyAdjustment() { /* ... */ }
}
\`\`\`

A more systemic fix is updating \`AuditInterceptor\` to also check each
implemented interface for \`@Auditable\` explicitly, rather than relying
solely on \`isAnnotationPresent\`'s built-in (superclass-only) inheritance
behavior. The general rule: \`@Inherited\` only ever propagates an
annotation from a superclass to its subclasses - it is documented to have
no effect on interfaces at all, a frequently-misunderstood limitation
worth checking explicitly whenever an annotation-driven behavior seems
to silently skip an interface-based implementation.`,
};
