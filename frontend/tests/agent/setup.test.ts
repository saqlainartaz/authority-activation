import { describe, expect, it } from "vitest";

describe("the test runner can import server-only modules", () => {
  it("resolves `server-only` to its empty react-server entry", async () => {
    // Without `ssr.resolve.conditions: ["react-server"]` in vitest.config.ts
    // this import throws before any assertion runs, because the package's
    // DEFAULT entry is a bare `throw new Error(...)`. The top-level
    // `resolve.conditions` is INERT here — verified empirically, see
    // vitest.config.ts's own comment — `ssr.resolve.conditions` is the key
    // that is actually load-bearing for a `test.environment: "node"` suite.
    // §7.3 requires every agent file to import `server-only`; §7.5 requires
    // vitest to test those same files. This test is the seam between the two,
    // and it is the reason the config option is not decoration (amendment 1).
    //
    // §9 step 4 replaced `loop.ts`'s step-1 shell (`loopIsNotBuiltYet`, which
    // this test used to assert against) with the real Anthropic driver. The
    // shell's job was only ever to prove the import resolves under vitest —
    // that invariant is unchanged, so the assertion now targets a real export
    // (`anthropicDriver`) instead of the retired placeholder. `loop.test.ts`
    // owns coverage of the driver's actual behaviour; this file owns only the
    // server-only resolution mechanism.
    const loop = await import("@/agent/lib/loop");

    expect(typeof loop.anthropicDriver.runTurn).toBe("function");
  });
});
