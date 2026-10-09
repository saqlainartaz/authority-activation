// One batch of files added through Add files (Cycle 5 P7.3; spec §7.1, A19).
// React-free, so the batch rule is tested exactly as the screen runs it:
// every file is judged on its own. A file refused before upload (`check`) or by
// the server (`send` throws) gets its own line, "name: reason", and the files
// after it are still checked and sent, so one refusal never costs the others
// their upload. Under M1 and the demo the screen runs this same loop with its
// own check, so its behaviour there is what it always was.

export type SendOutcome = {
  /** The file became (or, in the demo, was stored as) a new source. */
  added: boolean;
  /** A line to show beside it anyway (a duplicate: nothing new was added). */
  note?: string;
};

export type BatchResult = { added: number; issues: string[] };

export async function uploadBatch(
  files: readonly File[],
  check: (file: File) => string | null,
  send: (file: File) => Promise<SendOutcome>,
): Promise<BatchResult> {
  let added = 0;
  const issues: string[] = [];
  for (const file of files) {
    const issue = check(file);
    if (issue) {
      issues.push(`${file.name}: ${issue}`);
      continue;
    }
    try {
      const outcome = await send(file);
      if (outcome.note) issues.push(`${file.name}: ${outcome.note}`);
      if (outcome.added) added++;
    } catch (reason) {
      issues.push(`${file.name}: ${reason instanceof Error ? reason.message : 'Could not upload.'}`);
    }
  }
  return { added, issues };
}
