"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { labelForAtomType } from "@/lib/atom-labels";
import { questionsForGaps } from "@/lib/onboarding-catalogue";
import { Button, Card, Field } from "@/components/ui/primitives";
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
}: {
  clientId: string;
  api: InternalApi;
  onChanged: () => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [profession, setProfession] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api<Person[]>(`/api/internal/clients/${clientId}/users`);
      setPeople(next);
      setError(null);
    } catch (caught) {
      setPeople([]);
      setError(caught instanceof Error ? caught.message : "Unable to load people.");
    }
  }, [api, clientId]);

  useEffect(() => {
    let active = true;
    void api<Person[]>(`/api/internal/clients/${clientId}/users`)
      .then((next) => active && setPeople(next))
      .catch((caught) => active && (setPeople([]), setError(caught instanceof Error ? caught.message : "Unable to load people.")));
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create person.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <h3 className="text-base font-bold tracking-tight text-ink">People</h3>
      <p className="mt-1 text-sm text-muted">Create the real person who will use this client&apos;s login link.</p>
      <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={createPerson}>
        <Field label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <Field label="Display name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        <Field label="Profession" className="sm:col-span-2" value={profession} onChange={(event) => setProfession(event.target.value)} />
        <div className="sm:col-span-2"><Button type="submit" size="sm" disabled={busy}>{busy ? "Creating…" : "Create person"}</Button></div>
      </form>
      <Message>{error}</Message>
      {people === null ? <div className="mt-5"><PanelLoading /></div> : error ? null : people.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm font-semibold text-ink">No people yet</p>
          <p className="mt-1 text-sm text-muted">Create a person before minting their login link.</p>
        </div>
      ) : (
        <ul className="mt-5 divide-y divide-border">
          {people.map((person) => <li key={person.id} className="py-3 text-sm"><p className="font-semibold text-ink break-words">{person.display_name}</p><p className="mt-1 break-words text-muted">{person.email}{person.profession ? ` · ${person.profession}` : ""}</p></li>)}
        </ul>
      )}
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
