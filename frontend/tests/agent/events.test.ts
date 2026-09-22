import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { AgentEvent } from "@/agent/events";
import { EVENT_NAMES } from "@/agent/events";
import { PROFILES, resolveProfile, TOOL_NAMES } from "@/agent/profile";

describe("the event union", () => {
  it("names exactly the five events §5.3 specifies", () => {
    expect([...EVENT_NAMES].sort()).toEqual([
      "activity", "draft.ready", "message.delta", "terminal", "turn.end",
    ]);
  });

  it("gives draft.ready an id and nowhere to put a body", () => {
    // §5.3, and the reason stated once: if the body streamed into the card,
    // then at the instant the last token lands the card holds a post that has
    // passed zero checks and whose receipt cannot exist yet. The union has no
    // field for a body AT ANY DEPTH — the same technique `wire.py` uses for
    // locators. Not "we don't send it" but "there is nowhere to put it".
    const event: AgentEvent = {
      type: "draft.ready",
      variant_id: "5b1f9a2c-0000-4000-8000-000000000001",
    };

    expect(Object.keys(event).sort()).toEqual(["type", "variant_id"]);
  });

  it("lets turn.end be constructed as a plain object literal", () => {
    // R15 (Task 5's review): `Event<T, Extra>`'s old default,
    // `Record<string, never>`, made a zero-extra member like `turn.end`
    // un-constructible as an object literal — its index signature required
    // `type` to be assignable to `never`, which a string literal never is.
    // `src/agent/lib/turn.ts`'s `events.push({ type: "turn.end" })` was the
    // first code ever to try, and this pins the fix (`Extra` now defaults to
    // `Record<never, never>`, which carries no index signature) independently
    // of that call site happening to compile.
    const event: AgentEvent = { type: "turn.end" };

    expect(event.type).toBe("turn.end");
  });

  it("carries a free-form activity label", () => {
    // The vocabulary is a step-4/5 concern. The FIELD is here so the shape does
    // not change when the labels get written.
    //
    // `AgentEvent` is a discriminated union, so annotating the literal with the
    // union type itself would widen it and make `event.label` a compile error.
    // Narrowing with this `if` (rather than an `Extract<...>` annotation, an
    // index signature, or an `any` cast) keeps the union exactly as tight as
    // §5.3 specifies while still letting this test reach the field.
    const event: AgentEvent = { type: "activity", label: "Reading your material" };
    if (event.type !== "activity") throw new Error("unreachable");

    expect(event.label).toBe("Reading your material");
  });
});

describe("the capability-profile registry", () => {
  it("has exactly the four supported social platforms", () => {
    expect(Object.keys(PROFILES)).toEqual(["linkedin", "instagram", "x", "facebook"]);
    expect(Object.values(PROFILES).map(profile => profile.skill)).toEqual([
      "linkedin-post", "instagram-post", "x-post", "facebook-post",
    ]);
  });

  it("resolves the platform deterministically, never by asking the model", () => {
    // A6: the platform is already known upstream from the route, so asking the
    // model to re-derive it converts a certainty into a probability for nothing.
    expect(resolveProfile("linkedin").skill).toBe("linkedin-post");
  });

  it("refuses an unknown platform rather than defaulting", () => {
    expect(() => resolveProfile("threads")).toThrow(/threads/);
  });

  it("allows exactly the five sanctioned tools", () => {
    expect([...TOOL_NAMES].sort()).toEqual([
      "get_variant_sources", "prepare_generation", "propose_durable_fact",
      "schedule", "submit_draft",
    ]);
  });

  it("grants the linkedin profile no tool outside that set", () => {
    for (const tool of resolveProfile("linkedin").tools) {
      expect(TOOL_NAMES).toContain(tool);
    }
  });

  it("refuses to let an unreviewed platform be added at runtime — PROFILES is frozen", () => {
    // E3, 2026-08-24. `Record<string, CapabilityProfile>`'s index signature
    // makes `PROFILES.threads = {...}` TYPE-LEGAL, and it would have silently
    // broken the "exactly one entry this cycle" invariant above. Proved with
    // the reviewer's own exact mutation.
    expect(() => {
      // Type-legal, per `Record<string, CapabilityProfile>`'s index
      // signature — no `@ts-expect-error` needed, which is exactly the
      // problem: the compiler does not see this as a mistake.
      PROFILES.threads = { platform: "threads", skill: "threads-post", tools: [] };
    }).toThrow(TypeError);
    expect(Object.keys(PROFILES)).toEqual(["linkedin", "instagram", "x", "facebook"]);
  });
});

describe("the event union is importable from the browser", () => {
  const clientSafe = path.join(process.cwd(), "src/lib/agent-events.ts");

  it("lives in a module the client may import", () => {
    expect(fs.existsSync(clientSafe)).toBe(true);
    // Tests the invariant that matters: no server-only IMPORT (which is what
    // would break client bundling), not merely no mention. The looser substring
    // check forced this file's own doc comment to stop naming the guard that
    // motivates it, which costs a future reader the one grep they need.
    expect(fs.readFileSync(clientSafe, "utf8")).not.toMatch(/^\s*import\s+["']server-only["']/m);
  });

  it("is defined once, not mirrored", () => {
    const agentModule = fs.readFileSync(
      path.join(process.cwd(), "src/agent/events.ts"),
      "utf8",
    );
    // The server-side module re-exports; it must not carry a second copy of
    // the union, which is the drift this arrangement exists to prevent.
    expect(agentModule).toContain('export * from "@/lib/agent-events"');
    expect(agentModule).not.toContain('Event<"message.delta"');
  });

  it("still opens with server-only, so check:agent-server-only holds", () => {
    const agentModule = fs.readFileSync(
      path.join(process.cwd(), "src/agent/events.ts"),
      "utf8",
    );
    expect(agentModule).toContain('import "server-only"');
  });
});
