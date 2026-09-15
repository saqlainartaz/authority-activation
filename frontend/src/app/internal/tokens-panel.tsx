"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import ConfirmDialog from "@/components/decide/ConfirmDialog";
import { Button, Card } from "@/components/ui/primitives";
import { LoadingRegion, Skeleton } from "@/components/ui/admin-skeleton";
import type { InternalApi } from "./page";

type Person = { id: string; email: string; display_name: string };
type OnboardingToken = {
  id: string;
  user_id: string;
  issued_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  // Added alongside the console's invite/reset picker (fix wave, 2026-08-22,
  // F1-console) so this list can tell the three kinds apart.
  purpose: "onboarding" | "invite" | "reset";
};

const PURPOSE_LABEL: Record<OnboardingToken["purpose"], string> = {
  onboarding: "Magic link",
  invite: "Invite",
  reset: "Password reset",
};

function PanelLoading() {
  return <LoadingRegion><Skeleton className="h-24 rounded-[12px]" /></LoadingRegion>;
}

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Not recorded";
}

export function TokensPanel({ clientId, api }: { clientId: string; api: InternalApi }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [tokens, setTokens] = useState<OnboardingToken[] | null>(null);
  const [selected, setSelected] = useState<OnboardingToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextPeople, nextTokens] = await Promise.all([
        api<Person[]>(`/api/internal/clients/${clientId}/users`),
        api<OnboardingToken[]>(`/api/internal/clients/${clientId}/onboarding-tokens`),
      ]);
      setPeople(nextPeople);
      setTokens(nextTokens);
      setError(null);
    } catch (caught) {
      setPeople([]);
      setTokens([]);
      setError(caught instanceof Error ? caught.message : "Unable to load issued links.");
    }
  }, [api, clientId]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api<Person[]>(`/api/internal/clients/${clientId}/users`),
      api<OnboardingToken[]>(`/api/internal/clients/${clientId}/onboarding-tokens`),
    ]).then(([nextPeople, nextTokens]) => {
      if (!active) return;
      setPeople(nextPeople);
      setTokens(nextTokens);
    }).catch((caught) => {
      if (!active) return;
      setPeople([]);
      setTokens([]);
      setError(caught instanceof Error ? caught.message : "Unable to load issued links.");
    });
    return () => { active = false; };
  }, [api, clientId]);

  const peopleById = useMemo(() => new Map((people ?? []).map((person) => [person.id, person])), [people]);

  async function revoke() {
    if (!selected || busyId !== null) return;
    setBusyId(selected.id);
    setError(null);
    try {
      await api(`/api/internal/clients/${clientId}/onboarding-tokens/${selected.id}/revoke`, { method: "POST" });
      setSelected(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to revoke this link.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="p-5">
      <h3 className="text-base font-bold tracking-tight text-ink">Issued login links</h3>
      <p className="mt-1 text-sm text-muted">Links do not expire automatically. Revoke is the only reachable kill switch.</p>
      {error && <p role="alert" className="mt-3 break-words text-sm text-danger">{error}</p>}
      {tokens === null || people === null ? <div className="mt-5"><PanelLoading /></div> : error ? null : tokens.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm font-semibold text-ink">No links issued</p>
          <p className="mt-1 text-sm text-muted">Prepare a person, then mint a login link for them.</p>
        </div>
      ) : (
        <ul className="mt-5 divide-y divide-border">
          {tokens.map((token) => {
            const person = peopleById.get(token.user_id);
            return <li key={token.id} className="py-4"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><p className="font-semibold text-ink break-words">{person?.display_name ?? "Person unavailable"}</p><p className="mt-1 break-words text-sm text-muted">{person?.email ?? token.user_id}</p><dl className="mt-3 grid gap-1 text-sm"><div><dt className="inline text-muted">Kind: </dt><dd className="inline font-semibold text-ink">{PURPOSE_LABEL[token.purpose] ?? token.purpose}</dd></div><div><dt className="inline text-muted">Issued: </dt><dd className="inline font-semibold text-ink">{dateTime(token.issued_at)}</dd></div><div><dt className="inline text-muted">Last used: </dt><dd className="inline font-semibold text-ink">{dateTime(token.last_used_at)}</dd></div><div><dt className="inline text-muted">Status: </dt><dd className="inline font-semibold text-ink">{token.revoked_at ? `Revoked ${dateTime(token.revoked_at)}` : "Active"}</dd></div></dl></div>{token.revoked_at ? null : <Button size="sm" variant="secondary" disabled={busyId !== null} onClick={() => setSelected(token)}>{busyId === token.id ? "Revoking…" : "Revoke this link"}</Button>}</div></li>;
          })}
        </ul>
      )}
      {selected && <ConfirmDialog intent="destructive" title="Revoke this link?" consequence="The next authenticated use of this link will be refused. Recovery requires minting a new link." confirmLabel="Revoke this link" cancelLabel="Keep this link" onConfirm={() => void revoke()} onCancel={() => setSelected(null)} busy={busyId !== null} error={error} />}
    </Card>
  );
}
