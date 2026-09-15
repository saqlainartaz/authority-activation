import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** Source-level assertions, matching how `tests/agent/*.test.ts` pin route
 *  shapes in this repo: the BFF route reads a cookie jar and calls Python, so
 *  there is nothing to unit-call without a full `Request` harness. */
const route = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/client/chat/sessions/route.ts"),
  "utf8",
);
const product = fs.readFileSync(path.join(process.cwd(), "src/lib/product.ts"), "utf8");

describe("the agent bootstrap", () => {
  it("keeps the exact-keys allowlist", () => {
    expect(route).toContain("Object.keys(raw).some");
  });

  it("no longer requires a message to create a session", () => {
    // The combined guard this replaced: `typeof raw.message !== "string" ||
    // typeof raw.idempotency_key !== "string"`. Forbidding the message clause's
    // `||` continuation is what makes this a tripwire rather than a restatement —
    // it matches the old shape and not the new one.
    expect(route).not.toMatch(/typeof raw\.message !== "string"\s*\|\|/);
    expect(route).toContain('raw.message !== undefined && typeof raw.message !== "string"');
  });

  it("declares message optional on the wire type", () => {
    expect(product).toContain("message?: string;");
  });
});
