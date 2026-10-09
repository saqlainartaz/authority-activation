import { describe, expect, it } from "vitest";

import {
  EMPTY_FILE_COPY, KNOWLEDGE_UPLOAD_ACCEPT, KNOWLEDGE_UPLOAD_MAX_BYTES, KNOWLEDGE_UPLOAD_TYPES, LEGACY_OFFICE_COPY,
  TOO_LARGE_COPY, UNSUPPORTED_TYPE_COPY, UPLOAD_LIMITS_COPY, UPLOAD_TYPES_COPY, uploadIssue, uploadIssueCode, uploadTypeName,
} from "@/lib/upload-contract";
import * as uploadErrors from "@/lib/upload-errors";

/**
 * Cycle 5 P7.3 (D08; spec §7.1): the knowledge-engine uploader advertises and
 * enforces ONE contract. Exactly PDF, DOCX, PPTX, XLSX, TXT, MD, CSV, SRT, VTT,
 * PNG and JPG; legacy .doc/.xls/.ppt refused before upload with the operator's
 * sentence; HEIC and HTML not advertised; up to 20 MB.
 */

const D08 = [".pdf", ".docx", ".pptx", ".xlsx", ".txt", ".md", ".csv", ".srt", ".vtt", ".png", ".jpg"];
const KB = 1024;
const file = (name: string, size = 10 * KB, type = "") => ({ name, size, type });

describe("the D08 contract", () => {
  it("lists exactly the agreed types, and the accept attribute is built from them", () => {
    const extensions = KNOWLEDGE_UPLOAD_TYPES.flatMap(type => type.extensions);
    // .jpeg is the same JPG format, under its other extension.
    expect(new Set(extensions)).toEqual(new Set([...D08, ".jpeg"]));
    expect(KNOWLEDGE_UPLOAD_TYPES.map(type => type.name)).toEqual(
      ["PDF", "DOCX", "PPTX", "XLSX", "TXT", "MD", "CSV", "SRT", "VTT", "PNG", "JPG"]);
    const accept = KNOWLEDGE_UPLOAD_ACCEPT.split(",");
    for (const extension of [...D08, ".jpeg"]) expect(accept).toContain(extension);
    for (const type of KNOWLEDGE_UPLOAD_TYPES) for (const mime of type.mimeTypes) expect(accept).toContain(mime);
    for (const absent of [".doc", ".xls", ".ppt", ".heic", ".html", ".htm", "image/heic", "text/html", "application/msword"]) {
      expect(accept).not.toContain(absent);
    }
  });

  it("says the limits in the operator's words", () => {
    expect(UPLOAD_LIMITS_COPY).toBe("Up to about 13 pages (or a 40-minute transcript) per file, and up to 20 MB.");
    expect(UPLOAD_TYPES_COPY).toBe("PDF, DOCX, PPTX, XLSX, TXT, MD, CSV, SRT, VTT, PNG or JPG files.");
    expect(`${UPLOAD_TYPES_COPY} ${UPLOAD_LIMITS_COPY}`).not.toMatch(/HEIC|HTML|Word|\bDOC\b|XLS\b|PPT\b|each/);
  });

  it("accepts every agreed type, with its own or a generic MIME type", () => {
    for (const type of KNOWLEDGE_UPLOAD_TYPES) {
      for (const extension of type.extensions) {
        expect(uploadIssue(file(`notes${extension}`))).toBeNull();
        expect(uploadIssue(file(`NOTES${extension.toUpperCase()}`, 10 * KB, "application/octet-stream"))).toBeNull();
        for (const mime of type.mimeTypes) expect(uploadIssue(file(`notes${extension}`, 10 * KB, mime))).toBeNull();
      }
    }
  });

  it("refuses legacy Office files before upload with the save-as sentence, verbatim", () => {
    for (const name of ["old.doc", "budget.XLS", "deck.ppt"]) {
      expect(uploadIssueCode(file(name))).toBe("legacy_office");
      expect(uploadIssue(file(name))).toBe(LEGACY_OFFICE_COPY);
    }
    expect(LEGACY_OFFICE_COPY).toBe("Not accepted. Save it as .docx / .xlsx / .pptx and upload again.");
  });

  it("refuses what is not advertised, including HEIC and HTML", () => {
    for (const name of ["photo.heic", "page.html", "archive.zip", "README", "notes.rtf"]) {
      expect(uploadIssue(file(name))).toBe(UNSUPPORTED_TYPE_COPY);
    }
    // A name that says PDF but a browser type that says otherwise.
    expect(uploadIssue(file("report.pdf", 10 * KB, "image/png"))).toBe(UNSUPPORTED_TYPE_COPY);
    expect(UNSUPPORTED_TYPE_COPY).toBe(
      "Not accepted. This file type isn't supported. Add a PDF, DOCX, PPTX, XLSX, TXT, MD, CSV, SRT, VTT, PNG or JPG file.");
  });

  it("blocks a file over 20 MB, and an empty one, before sending", () => {
    expect(KNOWLEDGE_UPLOAD_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(uploadIssue(file("big.pdf", KNOWLEDGE_UPLOAD_MAX_BYTES))).toBeNull();
    expect(uploadIssue(file("big.pdf", KNOWLEDGE_UPLOAD_MAX_BYTES + 1))).toBe(TOO_LARGE_COPY);
    expect(uploadIssue(file("empty.txt", 0))).toBe(EMPTY_FILE_COPY);
    expect(TOO_LARGE_COPY).toBe("Not accepted. This file is over 20 MB. Files can be up to 20 MB.");
  });

  it("is the copy the backend's own 413 and 415 read as, so no stale 20 MB sentence is left", () => {
    expect(uploadErrors.TOO_LARGE_COPY).toBe(TOO_LARGE_COPY);
    expect(uploadErrors.UNSUPPORTED_TYPE_COPY).toBe(UNSUPPORTED_TYPE_COPY);
    expect(uploadErrors.uploadErrorCopy(413, {})).toBe(TOO_LARGE_COPY);
    expect(uploadErrors.uploadErrorCopy(415, {})).toBe(UNSUPPORTED_TYPE_COPY);
    for (const copy of [TOO_LARGE_COPY, UNSUPPORTED_TYPE_COPY, LEGACY_OFFICE_COPY]) {
      expect(copy).not.toMatch(/Up to 20 MB each|20 MB or smaller|Word, text, spreadsheet/);
    }
  });

  it("names a source's type from its file name", () => {
    expect(uploadTypeName("Brand story.PDF")).toBe("PDF");
    expect(uploadTypeName("call.vtt")).toBe("VTT");
    expect(uploadTypeName("photo.jpeg")).toBe("JPG");
    expect(uploadTypeName("legacy.doc")).toBe("File");
  });
});
