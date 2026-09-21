import type { Para, Source, Version } from '@/shared/data';

export type ReceiptClaim = {
  ordinal: number;
  claim_text: string;
  quoted_span: string | null;
  body_start: number;
  body_end: number | null;
  source_label: string;
  line: number | null;
  timecode: string | null;
  speaker: string | null;
};

const count = (body: string) => `${Array.from(body).length.toLocaleString()} / 3,000`;

function paragraphRanges(chars: string[]) {
  const ranges: Array<{ start: number; end: number }> = [];
  let start = 0;
  let index = 0;
  while (index < chars.length) {
    if (chars[index] !== '\n') { index += 1; continue; }
    let next = index + 1;
    if (chars[next] === '\r') next += 1;
    if (chars[next] !== '\n') { index += 1; continue; }
    let end = index;
    if (chars[end - 1] === '\r') end -= 1;
    if (end > start) ranges.push({ start, end });
    start = next + 1;
    while (chars[start] === '\r' || chars[start] === '\n') start += 1;
    index = start;
  }
  let end = chars.length;
  while (end > start && (chars[end - 1] === '\r' || chars[end - 1] === '\n')) end -= 1;
  if (end > start || ranges.length === 0) ranges.push({ start, end });
  return ranges;
}

function locator(claim: ReceiptClaim) {
  return [claim.speaker, claim.timecode, claim.line === null ? null : `line ${claim.line}`]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

export function versionFromBody(body: string, sources: Array<{ source_label: string; locator?: string }> = []): Version {
  return {
    paras: body.split(/\r?\n\r?\n/).map(text => ({ g: '', segs: [{ t: text }] })),
    sources: sources.map((source, index) => ({ n: String(index + 1), t: source.source_label, loc: source.locator || '' })),
    count: count(body),
  };
}

export function versionFromVariant(variant: {
  body: string;
  sources?: Array<{ source_label: string; locator?: string }>;
  receipt?: ReceiptClaim[];
}): Version {
  return variant.receipt?.length
    ? versionFromReceipt(variant.body, variant.receipt)
    : versionFromBody(variant.body, variant.sources ?? []);
}

export function versionFromReceipt(body: string, receipt: ReceiptClaim[]): Version {
  const chars = Array.from(body);
  const claims = receipt
    .map(claim => ({ ...claim, start: Math.max(0, Math.min(chars.length, claim.body_start)), end: Math.max(0, Math.min(chars.length, claim.body_end ?? chars.length)) }))
    .filter(claim => claim.end > claim.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const paras: Para[] = paragraphRanges(chars).map(range => {
    const segs: Para['segs'] = [];
    let cursor = range.start;
    for (const claim of claims) {
      if (claim.end <= range.start || claim.start >= range.end) continue;
      const start = Math.max(cursor, range.start, claim.start);
      const end = Math.min(range.end, claim.end);
      if (start > cursor) segs.push({ t: chars.slice(cursor, start).join('') });
      if (end > start) segs.push({ t: chars.slice(start, end).join(''), claim: { n: String(claim.ordinal) } });
      cursor = Math.max(cursor, end);
    }
    if (cursor < range.end) segs.push({ t: chars.slice(cursor, range.end).join('') });
    if (segs.length === 0) segs.push({ t: chars.slice(range.start, range.end).join('') });
    return { g: segs.some(segment => segment.claim) ? 'c' : '', segs };
  });

  const sources = new Map<string, Source>();
  for (const claim of receipt) {
    const n = String(claim.ordinal);
    if (!sources.has(n)) sources.set(n, {
      n,
      t: claim.source_label,
      loc: locator(claim),
      quote: claim.quoted_span || undefined,
    });
  }
  return { paras, sources: [...sources.values()], count: count(body) };
}
