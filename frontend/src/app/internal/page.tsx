"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpenCheck,
  ChevronRight,
  FileText,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";

import { Avatar, Button, Card, Eyebrow, Field, LogoMark } from "@/components/ui/primitives";
import { LoadingRegion, Skeleton } from "@/components/ui/admin-skeleton";
import type { EngineClient } from "@/lib/engine";
import { ClientDetail, type InternalSection } from "./panels";

type Client = EngineClient;

type ApiFailure = Error & { status?: number };

const CLIENT_401_SENTENCE = "This link has expired — ask us for a new one";

const SECTIONS: Array<{
  id: InternalSection;
  label: string;
  short: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "overview", label: "Overview", short: "Readiness and next steps", icon: LayoutDashboard },
  { id: "people", label: "People", short: "Client identities", icon: Users },
  { id: "sources", label: "Sources", short: "Documents and processing", icon: FileText },
  { id: "knowledge", label: "Knowledge", short: "Search and review", icon: BookOpenCheck },
  { id: "profile", label: "Voice profile", short: "Build and approve", icon: Sparkles },
  { id: "access", label: "Access", short: "Login links and revocation", icon: KeyRound },
  { id: "held", label: "Held drafts", short: "Operator intervention", icon: ShieldAlert },
];

const SECTION_IDS = new Set<InternalSection>(SECTIONS.map((section) => section.id));

function failureFrom(response: Response): Promise<ApiFailure> {
  return response.json().catch(() => ({})).then((body: { error?: unknown; detail?: unknown }) => {
    const error = new Error(
      typeof body.error === "string" ? body.error : `Request failed (${response.status}).`,
    ) as ApiFailure;
    error.status = response.status;
    return error;
  });
}

function LoadingClients() {
  return (
    <LoadingRegion>
      <div className="space-y-2 px-3">
        {[0, 1, 2].map((item) => <Skeleton key={item} className="h-12 rounded-[10px]" />)}
      </div>
    </LoadingRegion>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

function newestFirst(clients: Client[]) {
  return [...clients].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
}

function PasscodeGate({ onUnlock }: { onUnlock: (passcode: string) => void }) {
  const [passcode, setPasscode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/internal/clients", {
        headers: { "x-internal-passcode": passcode },
        cache: "no-store",
      });
      if (!response.ok) throw await failureFrom(response);
      onUnlock(passcode);
    } catch (reason) {
      const error = reason as ApiFailure;
      setMessage(error.status === 401 ? "That passcode is not valid." : error.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="grid min-h-screen place-items-center bg-surface-3 px-5 py-12">
      <Card className="w-full max-w-[430px] overflow-hidden p-0 shadow-[0_30px_80px_rgba(0,0,0,0.18)]">
        <div className="border-b border-line bg-surface px-7 py-6">
          <div className="flex items-center gap-3"><LogoMark size={36} /><div><p className="text-[17px] font-bold">Promo Partner</p><p className="text-xs text-muted">Operator workspace</p></div></div>
        </div>
        <form className="p-7" onSubmit={submit}>
          <Eyebrow>TEAM ONLY</Eyebrow>
          <h1 className="mt-3 text-[30px] font-bold tracking-[-0.03em]">Open the client console</h1>
          <p className="mt-2 text-sm leading-6 text-muted">Manage client readiness, source material, voice profiles, access, and held work from one place.</p>
          <Field label="Internal passcode" type="password" value={passcode} onChange={(event) => setPasscode(event.target.value)} className="mt-6" />
          {message ? <p role="alert" className="mt-3 text-sm text-danger">{message}</p> : null}
          <Button type="submit" className="mt-5 w-full" disabled={submitting || !passcode.trim()}>{submitting ? "Checking…" : "Open workspace"}</Button>
        </form>
      </Card>
    </section>
  );
}

export type InternalApi = <T>(path: string, init?: RequestInit) => Promise<T>;

export default function InternalPage() {
  const [passcode, setPasscode] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [section, setSection] = useState<InternalSection>("overview");
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const api = useCallback<InternalApi>(
    async <T,>(path: string, init: RequestInit = {}) => {
      const response = await fetch(path, {
        ...init,
        headers: { "x-internal-passcode": passcode ?? "", ...(init.headers ?? {}) },
        cache: "no-store",
      });
      if (!response.ok) throw await failureFrom(response);
      if (response.status === 204) return undefined as T;
      return response.json() as Promise<T>;
    },
    [passcode],
  );

  const loadClients = useCallback(async (preferredId?: string) => {
    if (!passcode) return [] as Client[];
    const rows = newestFirst(await api<Client[]>("/api/internal/clients"));
    setClients(rows);
    const requested = new URL(window.location.href).searchParams.get("client");
    setSelectedId((current) => preferredId ?? current ?? rows.find((row) => row.id === requested)?.id ?? rows[0]?.id ?? null);
    return rows;
  }, [api, passcode]);

  useEffect(() => {
    if (!passcode) return;
    let active = true;
    void api<Client[]>("/api/internal/clients")
      .then((unsortedRows) => {
        if (!active) return;
        const rows = newestFirst(unsortedRows);
        const params = new URL(window.location.href).searchParams;
        const requestedClient = params.get("client");
        const requestedSection = params.get("module") as InternalSection | null;
        setClients(rows);
        setSelectedId((current) => current ?? rows.find((row) => row.id === requestedClient)?.id ?? rows[0]?.id ?? null);
        if (requestedSection && SECTION_IDS.has(requestedSection)) setSection(requestedSection);
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Unable to load clients.");
        setClients([]);
      });
    return () => { active = false; };
  }, [api, passcode]);

  const selected = clients?.find((client) => client.id === selectedId) ?? null;
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (clients ?? []).filter((client) => !needle || client.name.toLowerCase().includes(needle));
  }, [clients, filter]);
  const activeSection = SECTIONS.find((candidate) => candidate.id === section) ?? SECTIONS[0];

  function chooseClient(id: string) {
    setSelectedId(id);
    setSection("overview");
    replaceWorkspaceUrl(id, "overview");
    setCreating(false);
    setError(null);
    setNotice(null);
  }

  function navigate(nextSection: InternalSection) {
    setSection(nextSection);
    if (selectedId) replaceWorkspaceUrl(selectedId, nextSection);
  }

  function replaceWorkspaceUrl(clientId: string, nextSection: InternalSection) {
    const url = new URL(window.location.href);
    url.searchParams.set("client", clientId);
    url.searchParams.set("module", nextSection);
    window.history.replaceState(window.history.state, "", `${url.pathname}?${url.searchParams.toString()}`);
  }

  if (!passcode) return <PasscodeGate onUnlock={setPasscode} />;

  return (
    <div className="internal-shell min-h-screen bg-surface-3">
      <aside className="internal-sidebar border-b border-line bg-surface">
        <div className="internal-sidebar-inner flex h-full flex-col">
          <div className="internal-brand flex items-center justify-between border-b border-line px-5 py-5">
            <div className="flex items-center gap-3"><LogoMark size={34} /><div><p className="text-[16px] font-bold">Promo Partner</p><p className="text-[11px] font-medium tracking-[0.12em] text-muted uppercase">Operator</p></div></div>
            <span title="Shared-passcode workspace"><LockKeyhole size={16} className="text-muted" /></span>
          </div>

          <div className="internal-client-tools border-b border-line p-4">
            <Button size="sm" className="w-full" onClick={() => { setCreating(true); setSelectedId(null); setFilter(""); setError(null); setNotice(null); }}><Plus size={15} />Add client + person</Button>
            <label className="mt-3 flex items-center gap-2 rounded-[9px] border border-line bg-surface-2 px-3 py-2.5">
              <Search size={15} className="shrink-0 text-muted" />
              <span className="sr-only">Search clients</span>
              <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Find a client" className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted" />
            </label>
          </div>

          <div className="internal-client-list border-b border-line py-3">
            <p className="px-5 pb-2 text-[10px] font-bold tracking-[0.16em] text-muted uppercase">Clients</p>
            {clients === null ? <LoadingClients /> : shown.length === 0 ? <p className="px-5 py-6 text-center text-sm text-muted">{clients.length === 0 ? "No client workspaces yet." : "No clients match that search."}</p> : (
              <ul className={`${selected ? "max-h-[72px]" : "max-h-[260px]"} space-y-1 overflow-y-auto px-3`}>
                {shown.map((client) => (
                  <li key={client.id}>
                    <button type="button" onClick={() => chooseClient(client.id)} className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors ${selectedId === client.id ? "bg-surface-3 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink"}`}>
                      <Avatar initials={initials(client.name)} size={34} />
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{client.name}</span><span className="block truncate text-[11px]">{client.timezone}</span></span>
                      <ChevronRight size={15} className={selectedId === client.id ? "text-accent" : "text-muted"} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

          </div>

          {selected ? (
              <nav aria-label="Client modules" className="internal-module-nav min-h-0 flex-1 overflow-y-auto px-3 py-4">
                <p className="px-2 pb-2 text-[10px] font-bold tracking-[0.16em] text-muted uppercase">Workspace</p>
                <ul className="space-y-1">
                  {SECTIONS.map((item) => {
                    const Icon = item.icon;
                    const active = item.id === section;
                    return (
                      <li key={item.id}>
                        <button type="button" aria-current={active ? "page" : undefined} onClick={() => navigate(item.id)} className={`group flex w-full items-center gap-3 rounded-[9px] px-3 py-2 text-left transition-colors ${active ? "bg-accent/10 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink"}`}>
                          <Icon size={16} className={active ? "text-accent" : "text-muted group-hover:text-ink"} />
                          <span className="text-sm font-semibold">{item.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            ) : <div className="min-h-0 flex-1" />}

          <div className="internal-sidebar-footer border-t border-line px-5 py-2.5"><p className="text-[11px] font-semibold text-muted">Team-only · shared passcode</p></div>
        </div>
      </aside>

      <main className="internal-main min-w-0">
        <header className="internal-main-header border-b border-line bg-surface/95 px-5 py-5 backdrop-blur sm:px-8">
          {creating ? (
            <div><Eyebrow>NEW WORKSPACE</Eyebrow><h1 className="mt-2 text-[28px] font-bold tracking-[-0.03em]">Prepare a client and their first person</h1></div>
          ) : selected ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div><p className="text-xs font-semibold text-muted">{selected.name} / {activeSection.label}</p><h1 className="mt-1 text-[28px] font-bold tracking-[-0.03em]">{activeSection.label}</h1><p className="mt-1 text-sm text-muted">{activeSection.short}</p></div>
              <div className="internal-client-chip flex items-center gap-3 rounded-full border border-line bg-surface-2 py-1.5 pr-4 pl-1.5"><Avatar initials={initials(selected.name)} size={32} /><div><p className="max-w-48 truncate text-xs font-bold text-ink">{selected.name}</p><p className="text-[10px] text-muted">{selected.status}</p></div></div>
            </div>
          ) : (
            <div><Eyebrow>OPERATOR CONSOLE</Eyebrow><h1 className="mt-2 text-[28px] font-bold tracking-[-0.03em]">Choose a client workspace</h1></div>
          )}
        </header>

        <div className="internal-content mx-auto w-full max-w-[1180px] px-5 py-7 sm:px-8 sm:py-9">
          {error && error !== CLIENT_401_SENTENCE ? <p role="alert" className="mb-6 rounded-[12px] border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p> : null}
          {notice ? <p role="status" className="mb-6 rounded-[12px] border border-line bg-surface px-4 py-3 text-sm text-ink">{notice}</p> : null}
          {creating ? (
            <CreateWorkspace api={api} loadClients={loadClients} onComplete={(clientId) => { setCreating(false); setSelectedId(clientId); setSection("overview"); replaceWorkspaceUrl(clientId, "overview"); setNotice("Workspace and first person created. Add source material next."); }} onPartial={(clientId, message) => { void loadClients(clientId); setCreating(false); setSelectedId(clientId); setSection("people"); replaceWorkspaceUrl(clientId, "people"); setError(message); }} />
          ) : selected ? (
            <ClientDetail clientId={selected.id} api={api} section={section} onNavigate={navigate} />
          ) : clients?.length === 0 ? (
            <EmptyWorkspace onCreate={() => setCreating(true)} />
          ) : (
            <Card className="grid min-h-[420px] place-items-center border-dashed p-8 text-center"><div><p className="text-[18px] font-bold">Select a client from the sidebar</p><p className="mt-2 text-sm text-muted">Their readiness, people, sources, knowledge, profile, access, and held work will appear here.</p></div></Card>
          )}
        </div>
      </main>
    </div>
  );
}

function CreateWorkspace({
  api,
  loadClients,
  onComplete,
  onPartial,
}: {
  api: InternalApi;
  loadClients: (preferredId?: string) => Promise<Client[]>;
  onComplete: (clientId: string) => void;
  onPartial: (clientId: string, message: string) => void;
}) {
  const [clientName, setClientName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [profession, setProfession] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    let client: Client | null = null;
    try {
      client = await api<Client>("/api/internal/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: clientName.trim() }),
      });
      await api(`/api/internal/clients/${client.id}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), display_name: displayName.trim(), profession: profession.trim() || null }),
      });
      await loadClients(client.id);
      onComplete(client.id);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to create this workspace.";
      if (client) onPartial(client.id, `The client workspace was created, but the person was not: ${message} Finish adding them in People.`);
      else setError(message);
    } finally {
      setBusy(false);
    }
  }

  const ready = clientName.trim() && displayName.trim() && email.trim();

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="p-6 sm:p-8">
        <div className="max-w-2xl"><Eyebrow>CLIENT + PERSON</Eyebrow><h2 className="mt-3 text-[24px] font-bold tracking-[-0.025em]">Create one usable workspace</h2><p className="mt-2 text-sm leading-6 text-muted">The client is the data boundary. The person is who signs in. This flow prepares both together so you do not have to hunt through separate modules.</p></div>
        <form className="mt-7 grid gap-5 sm:grid-cols-2" onSubmit={create}>
          <Field label="Client or company name" value={clientName} onChange={(event) => setClientName(event.target.value)} className="sm:col-span-2" />
          <Field label="Person name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          <Field label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          <Field label="Profession (optional)" value={profession} onChange={(event) => setProfession(event.target.value)} className="sm:col-span-2" />
          {error ? <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p> : null}
          <div className="sm:col-span-2"><Button type="submit" disabled={busy || !ready}>{busy ? "Preparing workspace…" : "Create client + person"}</Button></div>
        </form>
      </Card>
      <Card className="p-6">
        <Eyebrow>WHAT HAPPENS NEXT</Eyebrow>
        <ol className="mt-5 space-y-5">
          {[
            ["1", "Workspace", "Creates the isolated client record."],
            ["2", "Person", "Adds the first real user identity."],
            ["3", "Sources", "You upload the material that grounds generation."],
            ["4", "Access", "You mint a login only when the workspace is ready."],
          ].map(([number, title, detail]) => <li key={number} className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-2 text-xs font-bold text-muted">{number}</span><div><p className="text-sm font-bold text-ink">{title}</p><p className="mt-0.5 text-xs leading-5 text-muted">{detail}</p></div></li>)}
        </ol>
      </Card>
    </div>
  );
}

function EmptyWorkspace({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="grid min-h-[440px] place-items-center border-dashed p-8 text-center">
      <div className="max-w-md"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent"><Plus size={21} /></div><h2 className="mt-5 text-[22px] font-bold">Prepare your first client workspace</h2><p className="mt-2 text-sm leading-6 text-muted">Create the client and first person together, then the dashboard guides you through sources, knowledge, voice, and access.</p><Button className="mt-6" onClick={onCreate}>Add client + person</Button></div>
    </Card>
  );
}
