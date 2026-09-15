"use client";

import { FormEvent, useState } from "react";

import { Button, Card, Field } from "@/components/ui/primitives";
import { LoadingRegion, Skeleton } from "@/components/ui/admin-skeleton";
import type { InternalApi } from "./page";

type SearchHit = {
  id: string;
  atom_type: string;
  text: string;
  status: string;
  trust: "untrusted";
  score: number;
  source: { document_id: string; source_type: string; source_authority: string };
};

export function SearchPanel({ clientId, api }: { clientId: string; api: InternalApi }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<string | null>(null);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = query.trim();
    if (busy || !nextQuery) return;
    setBusy(true);
    setError(null);
    setHits(null);
    try {
      const next = await api<SearchHit[]>(`/api/internal/clients/${clientId}/search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: nextQuery, type, limit: 20 }) });
      setHits(next);
    } catch (caught) {
      setHits([]);
      setError(caught instanceof Error ? caught.message : "Unable to search this corpus.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <h3 className="text-base font-bold tracking-tight text-ink">Corpus search</h3>
      <p className="mt-1 text-sm text-muted">Search the fused corpus results available for this client.</p>
      <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={search}><Field label="Search material" className="min-w-0 flex-1" value={query} onChange={(event) => setQuery(event.target.value)} /><label className="block"><span className="mb-2 block text-[14px] text-muted">Type</span><select className="rounded-[10px] border border-line bg-surface px-4 py-[13px] text-[15px] text-ink outline-none transition-colors focus:border-accent" value={type ?? ""} onChange={(event) => setType(event.target.value || null)}><option value="">All types</option><option value="tldr">Business model</option><option value="insight">Brand strategy</option><option value="proof_point">Evidence</option><option value="pain_point">Audience</option><option value="objection">Sales strategy</option><option value="quote">Voice</option><option value="terminology">Products & offers</option></select></label><Button type="submit" size="sm" disabled={busy || !query.trim()}>{busy ? "Searching…" : "Search corpus"}</Button></form>
      {error && <p role="alert" className="mt-3 break-words text-sm text-danger">{error}</p>}
      {hits === null && busy ? <div className="mt-5"><LoadingRegion><Skeleton className="h-24 rounded-[12px]" /></LoadingRegion></div> : error ? null : hits !== null && hits.length === 0 ? <div className="mt-5 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">No matching material found.</div> : hits ? <ul className="mt-5 divide-y divide-border">{hits.map((hit) => <li key={hit.id} className="py-4"><p className="text-xs font-bold text-muted">{hit.atom_type} · {hit.status} · {hit.source.source_type}</p><p className="mt-1 break-words text-sm text-ink">{hit.text}</p><p className="mt-2 break-words text-sm text-muted">{hit.source.source_authority}</p></li>)}</ul> : null}
    </Card>
  );
}
