"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { labelForAtomType } from "@/lib/atom-labels";
import { questionsForGaps } from "@/lib/onboarding-catalogue";
import { Button, Card, Field } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadingRegion, Skeleton } from "@/components/ui/admin-skeleton";
import type { InternalApi } from "./page";

type Person = {
  id: string;
  email: string;
  display_name: string;
  profession: string | null;
  status: string;
  created_at: string;
};

function PanelLoading() {
  return <LoadingRegion><Skeleton className="h-20 rounded-[12px]" /></LoadingRegion>;
}

function Message({ children }: { children: string | null }) {
  return children ? <p role="alert" className="mt-3 break-words text-sm text-danger">{children}</p> : null;
}

export function PeoplePanel({
  clientId,
  api,
  onChanged,
  onCreateAccessLink,
}: {
  clientId: string;
  api: InternalApi;
  onChanged: () => void;
  onCreateAccessLink: (personId: string) => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [profession, setProfession] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api<Person[]>(`/api/internal/clients/${clientId}/users`);
      setPeople(next);
      setLoadError(null);
    } catch (caught) {
      setPeople([]);
      setLoadError(caught instanceof Error ? caught.message : "Unable to load people.");
    }
  }, [api, clientId]);

  useEffect(() => {
    let active = true;
    void api<Person[]>(`/api/internal/clients/${clientId}/users`)
      .then((next) => active && setPeople(next))
      .catch((caught) => active && (setPeople([]), setLoadError(caught instanceof Error ? caught.message : "Unable to load people.")));
    return () => { active = false; };
  }, [api, clientId]);

  async function createPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const trimmedEmail = email.trim();
    const trimmedName = displayName.trim();
    if (!trimmedEmail || !trimmedName) {
      setError("Email and display name are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api<Person>(`/api/internal/clients/${clientId}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          display_name: trimmedName,
          profession: profession.trim() || null,
        }),
      });
      setEmail("");
      setDisplayName("");
      setProfession("");
      await load();
      onChanged();
      setAdding(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create person.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="idc-card idc-compact-screen overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-5">
        <div><h2 className="text-lg font-semibold tracking-tight text-ink">Client people</h2><p className="mt-1 text-sm text-muted">Contacts who can receive an access link.</p></div>
        <Button type="button" size="sm" onClick={() => { setError(null); setAdding(true); }}>Add person</Button>
      </div>
      <Message>{loadError}</Message>
      {people === null ? <div className="mt-5"><PanelLoading /></div> : loadError ? null : people.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm font-semibold text-ink">No people yet</p>
          <p className="mt-1 text-sm text-muted">Create a person before minting their login link.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {people.map((person) => <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm"><div><p className="font-semibold text-ink break-words">{person.display_name}</p><p className="mt-1 break-words text-muted">{person.email}{person.profession ? ` · ${person.profession}` : ""}</p></div><Button type="button" size="sm" variant="secondary" onClick={() => onCreateAccessLink(person.id)}>Create access link</Button></li>)}
        </ul>
      )}
      <Dialog open={adding} onOpenChange={(open) => { if (!busy) setAdding(open); }}><DialogContent className="idc-dialog"><DialogHeader><DialogTitle>Add a person</DialogTitle><DialogDescription>Add a contact to this client workspace before creating their access link.</DialogDescription></DialogHeader><form className="mt-4 grid gap-4" onSubmit={createPerson}><Field label="Display name" required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /><Field label="Email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /><Field label="Profession (optional)" value={profession} onChange={(event) => setProfession(event.target.value)} /><Message>{error}</Message><div className="idc-form-actions"><Button type="button" variant="secondary" onClick={() => setAdding(false)} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Creating…" : "Add person"}</Button></div></form></DialogContent></Dialog>
    </Card>
  );
}

export function PrepareOnboardingCard({ missingAtomTypes }: { missingAtomTypes: readonly string[] | null }) {
  const questions = useMemo(() => questionsForGaps(missingAtomTypes ?? []), [missingAtomTypes]);
  return (
    <Card className="p-5">
      <h3 className="text-base font-bold tracking-tight text-ink">Prepare onboarding</h3>
      <p className="mt-1 text-sm text-muted">The selected play&apos;s missing material maps to the shared onboarding catalogue.</p>
      {missingAtomTypes === null ? <div className="mt-5"><PanelLoading /></div> : questions.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">No onboarding questions are needed for the selected play.</div>
      ) : (
        <ul className="mt-5 divide-y divide-border">
          {questions.map((question) => <li key={question.atomType} className="py-4"><p className="text-xs font-bold text-muted">{labelForAtomType(question.atomType)} · writes to {question.writeBackField}</p><p className="mt-1 break-words text-sm font-semibold text-ink">{question.prompt}</p><p className="mt-1 break-words text-sm text-muted">{question.help}</p></li>)}
        </ul>
      )}
    </Card>
  );
}
