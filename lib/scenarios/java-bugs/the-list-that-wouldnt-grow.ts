import type { Scenario } from "../types";

export const theListThatWouldntGrow: Scenario = {
  id: "the-list-that-wouldnt-grow",
  title: "The List That Wouldn't Grow",
  subtitle: "adding a promo item to the cart throws an exception, but only for carts built from a saved wishlist",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 12,
  tags: ["java25", "collections", "immutability"],
  briefing: `Customers who start checkout from a saved wishlist get a 500 error the
moment a free promotional item is auto-added to their cart. Customers
who build a cart from scratch by browsing never hit this - the
promo-item logic itself hasn't changed in months.`,
  constraints: [
    "The promo-item logic that decides *whether* to add a free item is confirmed correct and unchanged - the failure happens only when it actually tries to add the item to the cart's item list.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "cart-service", namespace: "cart", labels: { app: "cart-service" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "5mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "cart-service-7e8f9g0h1-i2j3k", namespace: "cart", labels: { app: "cart-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "cart-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "cart-service": [
            "2026-09-15T13:05:22.114Z ERROR c.e.cart.PromoItemInjector - java.lang.UnsupportedOperationException",
            "    at java.base/java.util.ImmutableCollections$AbstractImmutableCollection.add(ImmutableCollections.java:114)",
            "    at app//com.example.cart.PromoItemInjector.addFreeItem(PromoItemInjector.java:19)",
          ],
        },
        age: "5mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "cart-service-notes", namespace: "cart" },
        spec: {
          data: {
            "WishlistCartBuilder.java.excerpt":
              "public Cart buildFromWishlist(Wishlist wishlist) {\n    List<CartItem> items = List.of(wishlist.toCartItems());   // List.of() -\n    // returns a fixed-size, immutable list, used here because it was\n    // convenient and no mutation was expected at construction time\n    return new Cart(items);\n}\n",
            "PromoItemInjector.java.excerpt":
              "public void addFreeItem(Cart cart, CartItem freeItem) {\n    cart.getItems().add(freeItem);   // mutates the cart's existing item list in place\n}\n",
          },
        },
        age: "5mo",
      },
    ],
  },
  hints: [
    "`kubectl logs cart-service-7e8f9g0h1-i2j3k -n cart` - the exception is `UnsupportedOperationException`, thrown from inside the JDK's own immutable collections implementation.",
    "`kubectl get configmap cart-service-notes -n cart -o yaml` - compare how a cart built from a wishlist constructs its item list versus what `addFreeItem` assumes it can do with that list.",
    "`List.of(...)` returns a genuinely immutable list - calling `.add()` on it throws, always, regardless of how the list was populated or how many elements it has.",
  ],
  options: [
    {
      id: "immutable-list-of-then-mutated",
      label:
        "`buildFromWishlist` constructs the cart's item list with `List.of(...)`, which returns a fixed-size, genuinely immutable list - `addFreeItem` then calls `.add()` on that same list to inject the promo item, which throws `UnsupportedOperationException` every time, because `List.of()` lists reject any structural modification regardless of context, while carts built by browsing use a mutable `ArrayList` from the start and never hit this.",
      explanation:
        "The stack trace shows `UnsupportedOperationException` thrown from inside the JDK's `ImmutableCollections` implementation, at the exact call site inside `addFreeItem`'s `.add()` call. `WishlistCartBuilder.java.excerpt` confirms wishlist-based carts are built using `List.of(...)`, which is documented to return an immutable, fixed-size list - any later attempt to `.add()` to it throws unconditionally. Carts built from browsing presumably use a mutable list type from the start, which is exactly why only wishlist-originated carts hit this failure.",
    },
    {
      id: "promo-item-injector-called-twice",
      label: "`addFreeItem` is being called twice for the same cart, and the second call fails.",
      explanation:
        "The exception is `UnsupportedOperationException`, the specific exception the JDK's immutable collections throw for *any* mutation attempt, including the very first one - it isn't a duplicate-item or already-added kind of failure, which would look completely different (and wouldn't be this exception type at all).",
    },
    {
      id: "wishlist-items-null",
      label: "`wishlist.toCartItems()` is returning null for some wishlists, causing a downstream failure.",
      explanation:
        "The stack trace points directly at `ImmutableCollections$AbstractImmutableCollection.add`, the JDK's own immutable-list rejection path - a null items array would produce a `NullPointerException` somewhere entirely different, not this specific, well-known immutable-collection exception.",
    },
    {
      id: "concurrent-cart-modification",
      label: "Two requests are modifying the same wishlist-derived cart concurrently.",
      explanation:
        "This exception is thrown unconditionally and deterministically by any single attempt to mutate a `List.of(...)`-backed list, with no dependency on concurrent access at all - it reproduces on the very first, solitary call to `addFreeItem` against a wishlist-built cart.",
    },
  ],
  correctOptionId: "immutable-list-of-then-mutated",
  resolution: `The stack trace names the exact failure: \`UnsupportedOperationException\`
thrown from inside the JDK's own \`ImmutableCollections\` implementation,
at the line inside \`addFreeItem\` that calls \`.add()\`.
\`WishlistCartBuilder.java.excerpt\` shows wishlist-based carts are built
with \`List.of(wishlist.toCartItems())\` - \`List.of(...)\` is documented to
return a fixed-size, genuinely immutable list, chosen here because at
construction time nobody expected the list would ever need to change
later. \`PromoItemInjector.java.excerpt\` then calls \`cart.getItems().add(freeItem)\`
to inject a free promotional item directly into that same list - an
operation \`List.of(...)\`'s implementation rejects unconditionally,
regardless of the list's contents or how it was populated. Carts built
from browsing presumably start life as a mutable \`ArrayList\` and never
hit this at all, which is exactly why the bug only ever shows up for
wishlist-originated carts.

The fix is building the wishlist cart's item list as a genuinely mutable
collection from the start, since it's known to need later mutation:

\`\`\`java
public Cart buildFromWishlist(Wishlist wishlist) {
    List<CartItem> items = new ArrayList<>(wishlist.toCartItems());   // mutable copy
    return new Cart(items);
}
\`\`\`

The general rule: \`List.of()\`, \`Map.of()\`, \`Collections.unmodifiableList()\`,
and similar factory methods return collections that reject any
structural mutation - reach for them only when a list is genuinely meant
to be immutable for its entire lifetime, and use a mutable collection
type anywhere downstream code is expected to add or remove elements
later.`,
};
