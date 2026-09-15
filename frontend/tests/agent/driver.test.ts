import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRIVER = path.join(HERE, "..", "..", "src", "agent", "lib", "driver.ts");

describe("the driver seam", () => {
  it("declares the interface without importing any vendor package", () => {
    // §5.7's load-bearing property, asserted on the SOURCE rather than on
    // behaviour: driver.ts is the file a second provider's adapter is written
    // against, so a vendor import here would make the "interface" Anthropic's
    // shape wearing a neutral name. `assert-agent-boundary` guards loop.ts;
    // this guards the file that must stay clean even though the guard permits
    // nothing there either.
    const source = fs.readFileSync(DRIVER, "utf8");

    expect(source).toContain('import "server-only"');
    expect(source).not.toMatch(/@anthropic-ai\/sdk/);
    expect(source).not.toMatch(/from ["']ai["']/);
    expect(source).not.toMatch(/@ai-sdk\//);
  });

  it("exports types only — no runtime behaviour to drift", async () => {
    // A seam that grows a function grows a place for provider-shaped logic to
    // hide. `contracts/context.ts` makes the same argument for the same reason.
    const module = await import("@/agent/lib/driver");

    expect(Object.keys(module)).toHaveLength(0);
  });
});
