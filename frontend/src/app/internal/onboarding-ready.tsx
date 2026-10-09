"use client";

// The operator's Ready to onboard (Cycle 5 P6.5; spec 4.1). Rehaul engine only:
// the overview shows it only when the deployment runs the new engine.
//
// One button that starts the client's onboarding questions: the backend
// creates the client's one packet (or reuses it, by its own intent key, so a
// double click makes one), queues its generation once, and starts the monthly
// questions once. A failed packet can be started again here (Try again), which
// re-queues it under the normal budget; System health lists it until then. (The
// cap of three retries, each with a fresh call allowance, was removed as
// over-engineered, 2026-10-08.) It never sends the client an invitation. A
// client who finished the earlier questionnaire is told so (M-7).

import { useCallback, useEffect, useState } from "react";

import { Button, Card } from "@/components/ui/primitives";
import { LoadingRegion, Skeleton } from "@/components/ui/admin-skeleton";
import type { InternalApi } from "./internal-api";

export type OnboardingPacketState = {
  state: "preparing" | "generating" | "failed" | "ready" | "complete";
  packet_id: string | null;
  total: number;
  remaining: number;
};

/** What the operator reads for each state, and whether the button acts. */
export function onboardingReadyView(packet: OnboardingPacketState): { status: string; action: string | null } {
  switch (packet.state) {
    case "preparing":
      return packet.packet_id
        ? { status: "Preparing the questions.", action: null }
        : { status: "Not started. Add the client's documents first, then start onboarding.", action: "Ready to onboard" };
    case "generating":
      return { status: "Preparing the questions. The client sees a preparation screen until they are ready.", action: null };
    case "failed":
      return { status: "The questions could not be prepared. The client is told; nothing is lost.", action: "Try again" };
    case "ready":
      return { status: `${packet.total - packet.remaining} of ${packet.total} questions answered.`, action: null };
    default:
      // M-7: complete with no packet means the client finished the earlier questionnaire.
      if (!packet.packet_id) return { status: "Onboarded with the earlier questionnaire. Ready to onboard starts the new questions.", action: "Ready to onboard" };
      return { status: packet.total ? `Onboarding complete (${packet.total} questions).` : "Onboarding complete (no questions were needed).", action: null };
  }
}

export function OnboardingReadyPanel({ clientId, api }: { clientId: string; api: InternalApi }) {
  const [packet, setPacket] = useState<OnboardingPacketState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const path = `/api/internal/clients/${clientId}/onboarding-ready`;

  const load = useCallback(async () => {
    try {
      setPacket(await api<OnboardingPacketState>(path));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to read onboarding.");
    }
  }, [api, path]);

  useEffect(() => { void load(); }, [load]);

  async function ready() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setPacket(await api<OnboardingPacketState>(path, { method: "POST" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Onboarding was not started. Try again.");
      void load(); // a refusal changes what the card shows
    } finally {
      setBusy(false);
    }
  }

  const view = packet ? onboardingReadyView(packet) : null;
  return (
    <Card className="idc-card idc-onboarding-ready p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold tracking-tight text-ink">Onboarding questions</h3>
          {view ? <p className="mt-1 text-sm text-muted" role="status">{view.status}</p> : null}
        </div>
        {view?.action ? <Button type="button" size="sm" disabled={busy} onClick={() => void ready()}>{busy ? "Starting…" : view.action}</Button> : null}
      </div>
      {!packet && !error ? <div className="mt-4"><LoadingRegion><Skeleton className="h-10 rounded-[12px]" /></LoadingRegion></div> : null}
      {error ? <p role="alert" className="mt-3 break-words text-sm text-danger">{error}</p> : null}
    </Card>
  );
}
