import { describe, expect, it } from "vitest";

import contextSchema from "@/agent/contracts/context-schema.json";
import draftSchema from "@/agent/contracts/draft-schema.json";
import type { ContextV1 } from "@/agent/contracts/context";
import type { Draft } from "@/agent/contracts/draft";
import { FORBIDDEN_LOCATOR_FIELDS } from "../../scripts/lib/forbidden-locator-fields.mjs";

describe("the vendored contracts", () => {
  it("carries every top-level context.v1 field the mirror declares", () => {
    // The TS type is hand-written and erased at runtime, so a test cannot read
    // its keys directly. What it CAN do is assert a value typed as ContextV1
    // satisfies the compiler AND that every key of that value exists in the
    // vendored schema. Compilation covers the mirror; this covers the schema.
    const sample: ContextV1 = {
      contract_version: "context.v1",
      snapshot_id: "5b1f9a2c-0000-4000-8000-000000000001",
      platform: "linkedin",
      status: "ready",
      question: null,
      subject: "Leadership Programme",
      task: "write a post about the launch",
      voice: { tone: ["direct"], audience: null, do_phrases: [], avoid_phrases: [] },
      material: [],
      background: [],
      banned_phrases: [],
      gaps: [],
      conflicts: [],
    };

    const declared = Object.keys(contextSchema.properties);

    for (const key of Object.keys(sample)) {
      expect(declared, `${key} is in the mirror but not in the schema`).toContain(key);
    }
  });

  it("declares no context.v1 field the mirror has silently dropped", () => {
    // The other direction, and the one that matters more: Python adding a field
    // the mirror never learned about means the agent is blind to it.
    const mirrored = new Set([
      "contract_version", "snapshot_id", "platform", "status", "question",
      "subject", "task", "voice", "material", "background", "banned_phrases",
      "gaps", "conflicts",
    ]);

    for (const key of Object.keys(contextSchema.properties)) {
      expect(mirrored, `${key} reached context.v1 and the mirror does not have it`).toContain(key);
    }
  });

  it("pins the Draft shape the payload builder must produce", () => {
    const sample: Draft = {
      body: "a post",
      cited_atom_ids: [
        { atom_id: "5b1f9a2c-0000-4000-8000-000000000002", quoted_span: "a", claim_text: "b" },
      ],
    };

    expect(Object.keys(draftSchema.properties).sort()).toEqual(Object.keys(sample).sort());
    expect(Object.keys(draftSchema.$defs.Citation.properties).sort()).toEqual(
      ["atom_id", "claim_text", "quoted_span"],
    );
  });

  it("carries no locator-shaped field at any depth, in either contract", () => {
    // PROV-01 across the language boundary. §4.4 excludes these because a
    // locator invites "as I said at 14:32" in the post body — a fabrication no
    // grounding check catches, because it is prose and not a citation.
    //
    // Imports FORBIDDEN_LOCATOR_FIELDS rather than re-typing the list: this
    // test used to carry its own inline copy, which is exactly the
    // divergence scripts/lib/forbidden-locator-fields.mjs was created to end
    // (B1's ruling named this test's list as one of the two call sites to
    // unify; only the two .mjs guards were actually converted, leaving this
    // one — a false comment on the module itself until this fix).
    const both = JSON.stringify(contextSchema) + JSON.stringify(draftSchema);

    for (const name of FORBIDDEN_LOCATOR_FIELDS) {
      expect(both, `${name} reached a vendored contract`).not.toContain(`"${name}"`);
    }
  });
});
