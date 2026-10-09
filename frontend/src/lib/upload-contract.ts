// The knowledge-engine upload contract, decided by the operator as D08 (Cycle 5
// P7.3; spec §7.1, A19). ONE constant: the uploader's `accept` list, the
// screen's wording, the browser's check before sending and the BFF's check
// before forwarding all read it, so what the screen advertises is exactly what
// is enforced. Client-safe and pure.
//
// - Types: PDF, DOCX, PPTX, XLSX, TXT, MD, CSV, SRT, VTT, PNG and JPG. HEIC and
//   HTML are read by the engine but not advertised (D08).
// - Legacy Office files (.doc, .xls, .ppt) are refused before upload with the
//   operator's own sentence.
// - Up to 20 MB per file, checked before sending. The ~13-page (or 40-minute)
//   content limit is checked after upload by the engine's `source_size` stage; a
//   file over it shows "Too long — split it into smaller files" on its row
//   (`knowledge-status.ts`).
//
// Under M1 nothing here applies: M1's uploader keeps its own list and copy
// (`refined/documents.ts`), unchanged.

export type UploadType = {
  /** What the screen calls it. */
  name: string;
  /** Lower-case extensions, with the dot. */
  extensions: readonly string[];
  /** MIME types a browser reports for it. An empty type, or the generic
   *  `application/octet-stream`, is judged by the extension alone. */
  mimeTypes: readonly string[];
};

export const KNOWLEDGE_UPLOAD_TYPES: readonly UploadType[] = [
  { name: "PDF", extensions: [".pdf"], mimeTypes: ["application/pdf"] },
  { name: "DOCX", extensions: [".docx"], mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"] },
  { name: "PPTX", extensions: [".pptx"], mimeTypes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"] },
  { name: "XLSX", extensions: [".xlsx"], mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] },
  { name: "TXT", extensions: [".txt"], mimeTypes: ["text/plain"] },
  { name: "MD", extensions: [".md"], mimeTypes: ["text/markdown", "text/x-markdown", "text/plain"] },
  // Windows reports a CSV as Excel's type when Excel is installed.
  { name: "CSV", extensions: [".csv"], mimeTypes: ["text/csv", "application/vnd.ms-excel", "text/plain"] },
  { name: "SRT", extensions: [".srt"], mimeTypes: ["application/x-subrip", "text/srt", "text/plain"] },
  { name: "VTT", extensions: [".vtt"], mimeTypes: ["text/vtt", "text/plain"] },
  { name: "PNG", extensions: [".png"], mimeTypes: ["image/png"] },
  // A JPG is often saved as .jpeg; the engine reads both as one format.
  { name: "JPG", extensions: [".jpg", ".jpeg"], mimeTypes: ["image/jpeg"] },
];

export const KNOWLEDGE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

/** The legacy Office formats D08 refuses before upload, and what to save them as. */
export const LEGACY_OFFICE_EXTENSIONS: readonly string[] = [".doc", ".xls", ".ppt"];

/** The `accept` attribute: every extension and MIME type above. */
export const KNOWLEDGE_UPLOAD_ACCEPT = [
  ...new Set(KNOWLEDGE_UPLOAD_TYPES.flatMap(type => [...type.extensions, ...type.mimeTypes])),
].join(",");

/** "PDF, DOCX, PPTX, XLSX, TXT, MD, CSV, SRT, VTT, PNG or JPG". */
export const KNOWLEDGE_UPLOAD_TYPE_NAMES = (() => {
  const names = KNOWLEDGE_UPLOAD_TYPES.map(type => type.name);
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
})();

// ---- copy (D08, verbatim where the operator gave it) ------------------------

/** What the screen says about size, verbatim from D08. */
export const UPLOAD_LIMITS_COPY = "Up to about 13 pages (or a 40-minute transcript) per file, and up to 20 MB.";
/** What the screen says about types. */
export const UPLOAD_TYPES_COPY = `${KNOWLEDGE_UPLOAD_TYPE_NAMES} files.`;

const NOT_ACCEPTED = "Not accepted.";
/** A legacy Office file, refused before upload: the operator's sentence, verbatim. */
export const LEGACY_OFFICE_REMEDY = "Save it as .docx / .xlsx / .pptx and upload again.";
export const LEGACY_OFFICE_COPY = `${NOT_ACCEPTED} ${LEGACY_OFFICE_REMEDY}`;
export const UNSUPPORTED_TYPE_COPY = `${NOT_ACCEPTED} This file type isn't supported. Add a ${KNOWLEDGE_UPLOAD_TYPE_NAMES} file.`;
export const TOO_LARGE_COPY = `${NOT_ACCEPTED} This file is over 20 MB. Files can be up to 20 MB.`;
export const EMPTY_FILE_COPY = `${NOT_ACCEPTED} This file is empty.`;

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
};

/** The contract's type for this file name, or null. */
export function uploadTypeOf(name: string): UploadType | null {
  const extension = extensionOf(name);
  return KNOWLEDGE_UPLOAD_TYPES.find(type => type.extensions.includes(extension)) ?? null;
}

const GENERIC_MIME = new Set(["", "application/octet-stream"]);

export type UploadIssueCode = "legacy_office" | "unsupported_type" | "too_large" | "empty";

/** Why this file is refused before upload, or null when the contract accepts it. */
export function uploadIssueCode(file: { name: string; size: number; type?: string }): UploadIssueCode | null {
  if (LEGACY_OFFICE_EXTENSIONS.includes(extensionOf(file.name))) return "legacy_office";
  const type = uploadTypeOf(file.name);
  const mime = (file.type ?? "").toLowerCase().split(";")[0].trim();
  if (!type || (!GENERIC_MIME.has(mime) && !type.mimeTypes.includes(mime))) return "unsupported_type";
  if (!file.size) return "empty";
  if (file.size > KNOWLEDGE_UPLOAD_MAX_BYTES) return "too_large";
  return null;
}

const ISSUE_COPY: Record<UploadIssueCode, string> = {
  legacy_office: LEGACY_OFFICE_COPY,
  unsupported_type: UNSUPPORTED_TYPE_COPY,
  too_large: TOO_LARGE_COPY,
  empty: EMPTY_FILE_COPY,
};

/** The sentence for a file refused before upload, or null when it is accepted. */
export function uploadIssue(file: { name: string; size: number; type?: string }): string | null {
  const code = uploadIssueCode(file);
  return code ? ISSUE_COPY[code] : null;
}

/** How a source's type reads on its row: the contract's name, or "File". */
export function uploadTypeName(name: string): string {
  return uploadTypeOf(name)?.name ?? "File";
}
