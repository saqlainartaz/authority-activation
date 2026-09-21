import { describe, expect, it } from "vitest";

import { buildToolSpecs, TOOL_INPUT_SCHEMAS } from "@/agent/lib/tool-schemas";
import { TOOL_NAMES } from "@/agent/profile";

describe("the model-facing tool schemas", () => {
  it("covers exactly the five sanctioned tools", () => {
    expect(Object.keys(TOOL_INPUT_SCHEMAS).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("serialises byte-identically twice, because tools are in the cached prefix", () => {
    // §5.8's first trap. Tools render BEFORE system, so unstable key order in
    // the generated JSON Schema means the cache never hits — silently, with no
    // error anywhere. Two builds compared as strings is the only honest check.
    const first = JSON.stringify(buildToolSpecs(TOOL_NAMES));
    const second = JSON.stringify(buildToolSpecs(TOOL_NAMES));

    expect(first).toBe(second);
  });

  it("emits tools in a fixed order regardless of the order requested", () => {
    // Same trap, different route in: a caller that shuffles the allowlist would
    // otherwise reorder the cached prefix.
    const forward = buildToolSpecs(TOOL_NAMES).map((tool) => tool.name);
    const reversed = buildToolSpecs([...TOOL_NAMES].reverse()).map((tool) => tool.name);

    expect(reversed).toEqual(forward);
  });

  it("has no locator-shaped field at any depth", () => {
    // §4.6 / PROV-01: the model must have NOWHERE to put a locator, not merely
    // be told not to. Receipts are server-written.
    const serialised = JSON.stringify(buildToolSpecs(TOOL_NAMES));

    for (const banned of ["timecode", "document_id", "\"line\"", "source_locator", "\"url\""]) {
      expect(serialised).not.toContain(banned);
    }
  });

  it("has no idempotency_key in any input schema", () => {
    // A11: a tool's inputSchema is what the MODEL fills in, so anything that
    // must be true rather than claimed cannot live there. The runtime derives
    // keys from (turnId, tool, attempt).
    expect(JSON.stringify(buildToolSpecs(TOOL_NAMES))).not.toContain("idempotency");
  });

  it("requires explicit subject and retrieval intent for every preparation", () => {
    const schema = TOOL_INPUT_SCHEMAS.prepare_generation;

    expect(schema.safeParse({ message: "Write the strongest post you can.", operation: "generate" }).success).toBe(false);
    expect(schema.safeParse({
      message: "Write the strongest post you can.",
      operation: "generate",
      subject: "the strongest grounded lesson in the client's available knowledge",
      retrieval_query: "strong client lessons, proof points, objections, and quotable stories",
    }).success).toBe(true);

    const tool = buildToolSpecs(TOOL_NAMES).find((candidate) => candidate.name === "prepare_generation");
    expect((tool?.inputSchema.required as string[]).sort()).toEqual([
      "message",
      "operation",
      "retrieval_query",
      "subject",
    ]);
  });

  it("makes submit_draft cite by handle, never by uuid", () => {
    // §4.7 mechanism 1. If the schema asked for atom_id the model would
    // transcribe uuids, which is the silent-corruption failure the handles
    // exist to prevent.
    const submit = buildToolSpecs(TOOL_NAMES).find((tool) => tool.name === "submit_draft");
    const serialised = JSON.stringify(submit);

    expect(serialised).toContain("handle");
    // Quoted on purpose: the schema's own field is `cited_atom_ids`, so the
    // bare substring `atom_id` is always present and the assertion could never
    // pass. What must be absent is an atom_id PROPERTY — a JSON key — and
    // `"atom_id"` with its quotes is exactly that and nothing else.
    expect(serialised).not.toContain('"atom_id"');
  });
});
