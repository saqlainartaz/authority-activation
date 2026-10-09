import { describe, expect, it } from "vitest";

import { LEGACY_OFFICE_COPY, TOO_LARGE_COPY, uploadIssue } from "@/lib/upload-contract";
import { uploadBatch } from "@/refined/knowledge-upload";

/**
 * Cycle 5 P7.3 (spec §7.1, A19): a batch keeps its successes. Every file is
 * judged on its own; a refused file gets its own line and the files after it
 * are still checked and sent.
 */

const MB = 1024 * 1024;
const file = (name: string, size: number, type = "") => ({ name, size, type }) as unknown as File;

describe("one batch through Add files (A19)", () => {
  it("uploads the two good files of [good.pdf, old.doc, huge.pdf, good.docx] and refuses the other two, each with its own message", async () => {
    const sent: string[] = [];
    const batch = [
      file("good.pdf", 2 * MB, "application/pdf"),
      file("old.doc", 1 * MB, "application/msword"),
      file("huge.pdf", 21 * MB, "application/pdf"),
      file("good.docx", 1 * MB, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ];

    const result = await uploadBatch(batch, uploadIssue, async item => { sent.push(item.name); return { added: true }; });

    expect(sent).toEqual(["good.pdf", "good.docx"]);
    expect(result.added).toBe(2);
    expect(result.issues).toEqual([
      `old.doc: ${LEGACY_OFFICE_COPY}`,
      `huge.pdf: ${TOO_LARGE_COPY}`,
    ]);
    expect(result.issues[0]).toContain("Save it as .docx / .xlsx / .pptx and upload again.");
  });

  it("keeps going after the server refuses one file, and names only that file", async () => {
    const sent: string[] = [];
    const result = await uploadBatch(
      [file("a.pdf", MB), file("b.pdf", MB), file("c.pdf", MB)],
      () => null,
      async item => {
        sent.push(item.name);
        if (item.name === "b.pdf") throw new Error("Not accepted. This month's upload limit is reached.");
        return { added: true };
      },
    );

    expect(sent).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    expect(result).toEqual({ added: 2, issues: ["b.pdf: Not accepted. This month's upload limit is reached."] });
  });

  it("shows a duplicate beside its file without counting it as added", async () => {
    const result = await uploadBatch([file("same.pdf", MB)], () => null,
      async () => ({ added: false, note: "Already in your sources. It was not added or counted again." }));

    expect(result).toEqual({ added: 0, issues: ["same.pdf: Already in your sources. It was not added or counted again."] });
  });
});
