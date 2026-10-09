import { describe, expect, it } from "vitest";

import { buildToolSpecs, inputSchemaFor } from "@/agent/lib/tool-schemas";
import { C4_TOOL_NAMES, TOOL_NAMES } from "@/agent/profile";

describe("the model-facing tool schemas", () => {
  it("covers exactly the sanctioned tools, v1 and c4", () => {
    // The closed set is the guard: a schema without a name, or a name without
    // a schema, is a tool the model can see and the runtime cannot serve.
    // C4 adds `read_knowledge`, so the c4 list is what the schema map must
    // match — and the v1 list is asserted separately below, because the
    // whole point of a second profile is that the first one did not change.
    //
    // CHANGED EXPECTATION: the schemas cover every tool EITHER profile grants.
    // c4 no longer carries `schedule` -- it PROPOSES instead (operator ruling,
    // 2026-09-24) -- while v1 keeps it, so neither list alone is the closed set.
    //
    // CHANGED FORM, review 5 (B1): the table is module-private now, since the
    // executor's check against it was the defect and no production code reads
    // it directly. "A name without a schema" is checked here, through the
    // accessor production uses; "a schema without a name" is the table's type,
    // `Record<ToolName, ...>`, which the typecheck gate enforces -- an extra key
    // is a compile error.
    const granted = [...new Set([...TOOL_NAMES, ...C4_TOOL_NAMES])];
    for (const name of granted) {
      expect(inputSchemaFor(name), name).toBeDefined();
      expect(inputSchemaFor(name, "c4"), name).toBeDefined();
    }
  });

  it("leaves the v1 tool set at exactly the five it always had", () => {
    expect([...TOOL_NAMES].sort()).toEqual([
      "get_variant_sources",
      "prepare_generation",
      "propose_durable_fact",
      "schedule",
      "submit_draft",
    ]);
    expect(TOOL_NAMES).not.toContain("read_knowledge");
  });

  it("builds the v1 spec byte-identically to the set it always emitted", () => {
    // A v1 session's cached prefix must not move. If `buildToolSpecs` began
    // emitting the c4 tool for a v1 allowlist, every existing session would
    // miss its cache and see a tool it cannot use.
    const v1 = JSON.stringify(buildToolSpecs(TOOL_NAMES));
    expect(v1).not.toContain("read_knowledge");
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
    const schema = inputSchemaFor("prepare_generation");

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
