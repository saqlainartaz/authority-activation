"use client";

import { useCallback, useEffect, useState } from "react";
import { Send } from "lucide-react";

import { Button, Card } from "@/components/ui/primitives";
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
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : "Unable to load held drafts."));
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to release held draft.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold tracking-tight text-ink">Held drafts</h3>
          <p className="mt-1 text-sm text-muted">Review why a draft was held before releasing it.</p>
        </div>
        {queue && <span className="rounded-full bg-surface-3 px-3 py-1 text-xs font-bold text-ink">{queue.held_count} held · {queue.system_fault_count} system faults</span>}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-muted">{error}</p>}
      {queue === null ? (
        <div className="mt-5"><LoadingRegion><Skeleton className="h-24 rounded-[12px]" /></LoadingRegion></div>
      ) : queue.items.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm font-semibold text-ink">No held drafts</p>
          <p className="mt-1 text-sm text-muted">Drafts that need a look before the client sees them appear here.</p>
        </div>
      ) : (
        <ul className="mt-5 divide-y divide-border">
          {queue.items.map((item) => (
            <li key={item.content_item_id} className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <dl className="grid gap-2 text-sm">
                    <div><dt className="inline text-muted">Hold origin: </dt><dd className="inline font-semibold text-ink">{ORIGIN_LABEL[item.hold_origin]}</dd></div>
                    <div><dt className="inline text-muted">System fault count: </dt><dd className="inline font-semibold text-ink">{item.hold_origin === "system" ? queue.system_fault_count : 0}</dd></div>
                    {item.rejection_kind && <div><dt className="inline text-muted">Rejection kind: </dt><dd className="inline font-semibold text-ink break-words">{item.rejection_kind}</dd></div>}
                    {item.first_rejection_kind && item.first_rejection_kind !== item.rejection_kind && <div><dt className="inline text-muted">First rejection: </dt><dd className="inline font-semibold text-ink break-words">{item.first_rejection_kind}</dd></div>}
                  </dl>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-ink">{item.body}</p>
                </div>
                <Button size="sm" disabled={busyId !== null} onClick={() => void release(item)}><Send className="h-4 w-4" />{busyId === item.content_item_id ? "Releasing…" : "Release to client"}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
