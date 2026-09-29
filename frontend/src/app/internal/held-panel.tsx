"use client";

import { useCallback, useEffect, useState } from "react";
import { Send } from "lucide-react";

import { Button, Card } from "@/components/ui/primitives";
import ConfirmDialog from "@/components/decide/ConfirmDialog";
import { LoadingRegion, Skeleton } from "@/components/ui/admin-skeleton";
import type { HeldDraft, HeldQueue } from "@/lib/product";
import type { InternalApi } from "./page";

const ORIGIN_LABEL: Record<HeldDraft["hold_origin"], string> = {
  content: "Content hold",
  system: "System fault hold",
  unknown: "Origin not recorded",
};

export default function HeldPanel({
  clientId,
  api,
  onChanged,
}: {
  clientId: string;
  api: InternalApi;
  onChanged: () => void;
}) {
  const [queue, setQueue] = useState<HeldQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<HeldDraft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api<HeldQueue>(`/api/internal/clients/${clientId}/held`);
      setQueue(next);
      setError(null);
    } catch (caught) {
      setQueue({ client_id: clientId, held_count: 0, system_fault_count: 0, items: [], generated_at: "" });
      setError(caught instanceof Error ? caught.message : "Unable to load held drafts.");
    }
  }, [api, clientId]);

  useEffect(() => {
    let active = true;
    void api<HeldQueue>(`/api/internal/clients/${clientId}/held`)
      .then((next) => active && setQueue(next))
      .catch((caught) => { if (active) { setQueue({ client_id: clientId, held_count: 0, system_fault_count: 0, items: [], generated_at: "" }); setError(caught instanceof Error ? caught.message : "Unable to load held drafts."); } });
    return () => { active = false; };
  }, [api, clientId]);

  async function release(item: HeldDraft) {
    if (busyId !== null) return;
    setBusyId(item.content_item_id);
    setError(null);
    try {
      // The operator route deliberately has no body: its held-state precondition
      // makes a duplicate release a clean refusal rather than a second write.
      await api(`/api/internal/clients/${clientId}/held/${item.content_item_id}/release`, { method: "POST" });
      await load();
      onChanged();
      setPending(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to release held draft.");
    } finally {
      setBusyId(null);
    }
  }

  const selected = queue?.items.find((item) => item.content_item_id === selectedId) ?? queue?.items[0];

  return <div>
    {error && <p role="alert" className="idc-note bad">{error}</p>}
    {queue === null ? <LoadingRegion><Skeleton className="h-24 rounded-[12px]" /></LoadingRegion> : error ? null : queue.items.length === 0 ? <Card className="idc-card idc-empty-card idc-compact-screen text-center"><h2 className="text-lg font-semibold text-ink">No held drafts</h2><p className="mt-2 text-sm text-muted">Drafts that need operator review appear here.</p></Card> : <div className="idc-detail-layout">
      <Card className="idc-card overflow-hidden"><div className="border-b border-line px-5 py-4"><h2 className="text-lg font-semibold text-ink">Awaiting review</h2><p className="mt-1 text-sm text-muted">{queue.held_count} held · {queue.system_fault_count} system faults</p></div><div className="idc-rows">{queue.items.map((item) => <button type="button" key={item.content_item_id} className={`idc-selectrow ${selected?.content_item_id === item.content_item_id ? "selected" : ""}`} onClick={() => setSelectedId(item.content_item_id)}><span className="idc-row-main"><strong>{ORIGIN_LABEL[item.hold_origin]}</strong><small>{item.body.slice(0, 110)}{item.body.length > 110 ? "…" : ""}</small></span></button>)}</div></Card>
      {selected && <Card className="idc-card overflow-hidden"><div className="border-b border-line px-5 py-4"><h2 className="text-lg font-semibold text-ink">Draft review</h2><p className="mt-1 text-sm text-muted">{ORIGIN_LABEL[selected.hold_origin]}</p></div><div className="idc-detail-content"><dl><dt>Reason</dt><dd>{selected.rejection_kind ?? "Not recorded"}</dd><dt>First reason</dt><dd>{selected.first_rejection_kind ?? "Not recorded"}</dd><dt>Held</dt><dd>{new Date(selected.held_at).toLocaleString()}</dd></dl><p className="whitespace-pre-wrap break-words">{selected.body}</p></div><div className="idc-detail-footer"><Button size="sm" disabled={busyId !== null} onClick={() => setPending(selected)}><Send className="h-4 w-4" />Review release</Button></div></Card>}
    </div>}
    {pending && <ConfirmDialog intent="destructive" title="Release this draft to the client?" consequence="This moves the held draft into the client's visible work. Check the draft and hold reason before continuing." confirmLabel="Release to client" cancelLabel="Keep held" onConfirm={() => void release(pending)} onCancel={() => setPending(null)} busy={busyId !== null} error={error} />}
  </div>;
}
