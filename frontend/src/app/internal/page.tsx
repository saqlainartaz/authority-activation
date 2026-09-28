"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  ChevronRight,
  FileText,
  KeyRound,
  LayoutDashboard,
  Menu,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";

import { Button, Card, Eyebrow, Field, LogoMark } from "@/components/ui/primitives";
import { Button as DesignButton } from "@/components/ui/button";
import { Card as DesignCard, CardContent as DesignCardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);

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

  useEffect(() => {
    if (!passcode) return;
    let active = true;
    void api<Client[]>("/api/internal/clients")
      .then((unsortedRows) => {
        if (!active) return;
        const rows = unsortedRows;
        const params = new URL(window.location.href).searchParams;
        const requestedClient = params.get("client");
        const requestedSection = params.get("module") as InternalSection | null;
        setClients((current) => [...rows, ...(current ?? []).filter((existing) => !rows.some((row) => row.id === existing.id))]);
        setDirectoryError(null);
        setSelectedId((current) => current ?? rows.find((row) => row.id === requestedClient)?.id ?? null);
        if (requestedSection && SECTION_IDS.has(requestedSection)) setSection(requestedSection);
      })
      .catch((reason) => {
        if (!active) return;
        setDirectoryError(reason instanceof Error ? reason.message : "Unable to load clients.");
        setClients((current) => current ?? []);
      });
    return () => { active = false; };
  }, [api, passcode]);

  const selected = clients?.find((client) => client.id === selectedId) ?? null;
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (clients ?? []).filter((client) => !needle || client.name.toLowerCase().includes(needle)).sort((left, right) => left.name.localeCompare(right.name));
  }, [clients, filter]);
  const activeSection = SECTIONS.find((candidate) => candidate.id === section) ?? SECTIONS[0];

  function chooseClient(id: string) {
    setSelectedId(id);
    setSection("overview");
    replaceWorkspaceUrl(id, "overview");
    setCreating(false);
    setError(null);
    setNotice(null);
    setMobileMenu(false);
  }

  function backToClients() {
    setSelectedId(null);
    setCreating(false);
    setSection("overview");
    setMobileMenu(false);
    setError(null);
    setNotice(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("client");
    url.searchParams.delete("module");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  }

  function navigate(nextSection: InternalSection) {
    setSection(nextSection);
    setMobileMenu(false);
    if (selectedId) replaceWorkspaceUrl(selectedId, nextSection);
  }

  async function retryDirectory() {
    setClients(null);
    setDirectoryError(null);
    try {
      setClients(await api<Client[]>("/api/internal/clients"));
    } catch (reason) {
      setClients([]);
      setDirectoryError(reason instanceof Error ? reason.message : "Unable to load clients.");
    }
  }

  function replaceWorkspaceUrl(clientId: string, nextSection: InternalSection) {
    const url = new URL(window.location.href);
    url.searchParams.set("client", clientId);
    url.searchParams.set("module", nextSection);
    window.history.replaceState(window.history.state, "", `${url.pathname}?${url.searchParams.toString()}`);
  }

  if (!passcode) return <PasscodeGate onUnlock={setPasscode} />;

  const inClient = Boolean(selected && !creating);
  const pageTitle = creating ? "Add client" : selected ? activeSection.label : "Clients";
  const pageDescription = creating
    ? "Create a workspace and its first contact."
    : selected
      ? ({
          overview: `The work and client progress for ${selected.name}.`,
          people: "Manage the people who can access this client workspace.",
          sources: "Ingest material, inspect processing, and retain its origin.",
          knowledge: "Search client knowledge and review extracted records.",
          profile: "Build, review, and approve an exact voice profile version.",
          access: "Create client login links and track their use and revocation.",
          held: "Review held drafts before releasing them to the client.",
        } as Record<InternalSection, string>)[section]
      : "Select a client to manage their workspace.";

  return (
    <div className={`idc ${inClient ? "idc-client" : ""}`}>
      <div className="idc-layout">
        <aside className="idc-global" aria-label="Portfolio navigation">
          <div className="idc-brand"><span className="idc-mark">PP</span><div><div className="idc-brand-name">Promo Partner</div><p className="idc-brand-sub">Operator console</p></div></div>
          <nav aria-label="Main">
            <button type="button" className="idc-nav" data-active={!creating} onClick={backToClients} aria-label="Clients"><Users /><span>Clients</span><small className="idc-nav-count">{clients?.length ?? 0}</small></button>
          </nav>
          <DesignButton variant="outline" size="sm" className="idc-mobile-menu" onClick={() => setMobileMenu(true)} aria-label="Open navigation"><Menu size={17} /></DesignButton>
          <div className="idc-operator"><div className="idc-nav" aria-label="Operator access uses a shared passcode"><span className="idc-avatar">OP</span><span><strong>Operator access</strong><small>Shared passcode</small></span></div></div>
        </aside>
        {inClient && selected ? <aside className="idc-context" aria-label="Client workspace navigation">
          <DesignButton variant="ghost" className="idc-back" onClick={backToClients}><ArrowLeft size={14} /> All clients</DesignButton>
          <div className="idc-identity"><span className="idc-identity-mark">{selected.name[0]}</span><div><strong>{selected.name}</strong><p>{selected.status}</p><button type="button" onClick={backToClients}>Switch client</button></div></div>
          {[{ label: "Client", links: SECTIONS.slice(0, 1) }, { label: "Prepare", links: SECTIONS.slice(1, 5) }, { label: "Operate", links: SECTIONS.slice(5) }].map((group) => <nav className="idc-context-group" aria-label={group.label} key={group.label}><p className="idc-nav-label">{group.label}</p>{group.links.map((item) => <button type="button" className="idc-nav" key={item.id} data-active={section === item.id} aria-current={section === item.id ? "page" : undefined} onClick={() => navigate(item.id)}>{item.label}</button>)}</nav>)}
        </aside> : null}
        <div className="idc-stage">
          <header className="idc-top">
            <div className="idc-breadcrumb">{inClient && selected ? <><button type="button" onClick={backToClients}>Clients</button><ChevronRight size={14} /><button type="button" onClick={() => navigate("overview")}>{selected.name}</button><ChevronRight size={14} /><b>{activeSection.label}</b></> : <b>{creating ? "New client" : "Clients"}</b>}</div>
            <div className="idc-top-right">{inClient ? <DesignButton variant="outline" size="sm" className="idc-search-trigger" onClick={backToClients}><Search size={15} /><span>Find a client</span></DesignButton> : null}<span className="idc-avatar" aria-label="Operator access uses a shared passcode">OP</span></div>
          </header>
          <main className="idc-content">
            {inClient && selected ? <label className="idc-field idc-mobile-section">Client section · {selected.name}<select className="idc-native-select" aria-label="Client section" value={section} onChange={(event) => navigate(event.target.value as InternalSection)}>{SECTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label> : null}
            {error && error !== CLIENT_401_SENTENCE ? <p role="alert" className="idc-note bad">{error}</p> : null}
            {!selected && !creating && directoryError ? <p role="alert" className="idc-note bad">{directoryError}</p> : null}
            {notice ? <p role="status" className="idc-muted-panel" style={{ marginBottom: 20 }}>{notice}</p> : null}
            {creating ? <div className="idc-form-screen"><div className="idc-pagehead"><div><h1>{pageTitle}</h1><p>{pageDescription}</p></div></div><CreateWorkspace api={api} onCancel={backToClients} onComplete={(client) => { setClients((rows) => [...(rows ?? []).filter((row) => row.id !== client.id), client]); setDirectoryError(null); setCreating(false); setSelectedId(client.id); setSection("overview"); replaceWorkspaceUrl(client.id, "overview"); setNotice("Workspace and first person created. Add source material next."); }} onPartial={(client, message) => { setClients((rows) => [...(rows ?? []).filter((row) => row.id !== client.id), client]); setDirectoryError(null); setCreating(false); setSelectedId(client.id); setSection("people"); replaceWorkspaceUrl(client.id, "people"); setError(message); }} /></div>
            : selected ? <><div className="idc-pagehead"><div><p className="idc-eyebrow">Client workspace</p><h1>{pageTitle}</h1><p>{pageDescription}</p></div></div><ClientDetail key={selected.id} clientId={selected.id} api={api} section={section} onNavigate={navigate} /></>
            : <div className="idc-directory-screen"><div className="idc-pagehead"><div><h1>Clients</h1><p>{pageDescription}</p></div><div className="idc-pageactions"><DesignButton onClick={() => { setCreating(true); setFilter(""); setError(null); setNotice(null); }}><Plus size={16} /> Add client</DesignButton></div></div><div className="idc-directory-search"><Search size={18} /><input className="idc-input" type="search" aria-label="Search clients" placeholder="Search clients" value={filter} onChange={(event) => setFilter(event.target.value)} /></div><div className="idc-directory-heading" aria-live="polite"><span>{clients === null ? "Loading clients" : directoryError ? "Directory unavailable" : filter.trim() ? `${shown.length} matching ${shown.length === 1 ? "client" : "clients"}` : `${clients.length} ${clients.length === 1 ? "client" : "clients"}`}</span></div><div className="idc-card">{clients === null ? <LoadingClients /> : directoryError ? <div className="idc-empty">Client directory could not be loaded.<div className="mt-4"><DesignButton variant="outline" size="sm" onClick={() => void retryDirectory()}>Try again</DesignButton></div></div> : shown.length ? shown.map((client) => <button type="button" className="idc-client-row" key={client.id} onClick={() => chooseClient(client.id)} aria-label={`Open ${client.name}`}><span className="idc-client-row-leading"><span className="idc-client-monogram">{client.name[0]}</span><span className="idc-client-row-text"><strong>{client.name}</strong><small title={client.timezone}>Time zone · {client.timezone.split("/").pop()?.replaceAll("_", " ") ?? client.timezone}</small></span></span><span className="idc-client-row-action">Open <ArrowRight size={16} /></span></button>) : <div className="idc-empty">{clients.length === 0 ? "No client workspaces yet." : "No clients match that name."}</div>}</div></div>}
          </main>
        </div>
      </div>
      <Dialog open={mobileMenu} onOpenChange={setMobileMenu}><DialogContent className="idc-dialog"><DialogHeader><DialogTitle>Navigate</DialogTitle><DialogDescription>Choose a destination in the operator console.</DialogDescription></DialogHeader><div className="idc-rows"><div className="idc-row"><div className="idc-row-main"><strong>Clients</strong></div><DesignButton variant="outline" size="sm" onClick={backToClients}>Open <ArrowRight size={14} /></DesignButton></div></div></DialogContent></Dialog>
    </div>
  );
}

function CreateWorkspace({
  api,
  onCancel,
  onComplete,
  onPartial,
}: {
  api: InternalApi;
  onCancel: () => void;
  onComplete: (client: Client) => void;
  onPartial: (client: Client, message: string) => void;
}) {
  const [clientName, setClientName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [profession, setProfession] = useState("");
  const [timezone, setTimezone] = useState("America/New_York");
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
        body: JSON.stringify({ name: clientName.trim(), timezone: timezone.trim() }),
      });
      await api(`/api/internal/clients/${client.id}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), display_name: displayName.trim(), profession: profession.trim() || null }),
      });
      onComplete(client);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to create this workspace.";
      if (client) onPartial(client, `The client workspace was created, but the person was not: ${message} Finish adding them in People.`);
      else setError(message);
    } finally {
      setBusy(false);
    }
  }

  const ready = clientName.trim() && displayName.trim() && email.trim() && timezone.trim();

  return <><DesignCard className="idc-card idc-card-pad"><DesignCardContent><form className="idc-form" onSubmit={create}>
    <fieldset className="idc-form-section"><legend>Client</legend><label className="idc-field">Client name<input className="idc-input" required value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder="Juniper Studio" /></label><label className="idc-field">Time zone<input className="idc-input" required list="idc-timezones" value={timezone} onChange={(event) => setTimezone(event.target.value)} /><span className="font-normal text-muted">Use the client&apos;s IANA time zone for scheduling.</span></label><datalist id="idc-timezones"><option value="Europe/London" /><option value="Europe/Warsaw" /><option value="America/New_York" /><option value="America/Chicago" /><option value="America/Los_Angeles" /><option value="Asia/Dubai" /><option value="Asia/Kolkata" /><option value="Asia/Singapore" /><option value="Australia/Sydney" /></datalist></fieldset>
    <fieldset className="idc-form-section"><legend>First contact</legend><div className="idc-form-grid"><label className="idc-field">Name<input className="idc-input" required value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Full name" /></label><label className="idc-field">Email<input className="idc-input" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.example" /></label></div><label className="idc-field">Profession (optional)<input className="idc-input" value={profession} onChange={(event) => setProfession(event.target.value)} /></label></fieldset>
    {error ? <p role="alert" className="idc-note bad">{error}</p> : null}
    <div className="idc-form-actions"><DesignButton type="button" variant="outline" onClick={onCancel}>Cancel</DesignButton><DesignButton type="submit" disabled={busy || !ready}>{busy ? "Creating…" : "Create client and person"}</DesignButton></div>
  </form></DesignCardContent></DesignCard><div className="idc-form-note"><strong>If the first contact cannot be added</strong><p>The client remains in the directory. Open People to complete setup.</p></div></>;
}
