"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, CircleAlert, CircleHelp, Copy, Loader2, Sparkles } from "lucide-react";

import { Button, Card } from "@/components/ui/primitives";
import { Button as DesignButton } from "@/components/ui/button";
import { Card as DesignCard, CardContent as DesignCardContent, CardDescription as DesignCardDescription, CardHeader as DesignCardHeader } from "@/components/ui/card";
import { LoadingRegion, Skeleton } from "@/components/ui/admin-skeleton";
import ConfirmDialog from "@/components/decide/ConfirmDialog";
import { labelForAtomType } from "@/lib/atom-labels";
import { copyText } from "@/lib/clipboard";
import { computeGroundingGap } from "@/lib/grounding-gap";
import type { InternalApi } from "./page";
import { DocumentsPanel } from "./documents-panel";
import HeldPanel from "./held-panel";
import { PeoplePanel, PrepareOnboardingCard } from "./people-panel";
import { SearchPanel } from "./search-panel";
import { TokensPanel } from "./tokens-panel";

export type InternalSection =
  | "overview"
  | "people"
  | "sources"
  | "knowledge"
  | "profile"
  | "access"
  | "held";

type Summary = {
  atom_counts: Record<string, number>;
  plays: Array<{ play_id: string; missing_atom_types: string[] }>;
  selected_play_id: string;
  voice_profile: { latest_version: number | null; approved_version: number | null };
  generated_at: string;
};

type VoiceProfile = {
  version: number;
  status: string;
  built_by: string;
  created_at: string;
  payload?: Record<string, unknown>;
  corpus?: { document_ids?: string[]; atom_count?: number };
  diff?: { changed_sections?: string[]; previous_version?: number | null };
};

type Atom = {
  id: string;
  document_id: string;
  atom_type: string;
  status: "provisional" | "confirmed" | "deprecated";
  text: string;
  evidence_kind?: string;
  provenance?: Record<string, unknown>;
};

type Person = { id: string };
type OnboardingToken = { revoked_at: string | null };

function PanelLoading() {
  return <LoadingRegion><Skeleton className="h-24 rounded-[12px]" /></LoadingRegion>;
}

function Message({ children }: { children: string | null }) {
  return children ? <p role="alert" className="mt-4 text-sm text-danger">{children}</p> : null;
}

function OverviewPanel({
  clientId,
  api,
  refreshToken,
  onNavigate,
}: {
  clientId: string;
  api: InternalApi;
  refreshToken: number;
  onNavigate: (section: InternalSection) => void;
}) {
  type DocumentState = { id: string; status: string };
  type HeldState = { held_count: number };
  const [overview, setOverview] = useState<{
    summary: Summary; people: Person[]; tokens: Array<OnboardingToken & { last_used_at?: string | null }>;
    documents: DocumentState[]; atoms: Atom[]; held: HeldState;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setOverview(null);
    setError(null);
    void Promise.all([
      api<Summary>(`/api/internal/clients/${clientId}/summary`),
      api<Person[]>(`/api/internal/clients/${clientId}/users`),
      api<Array<OnboardingToken & { last_used_at?: string | null }>>(`/api/internal/clients/${clientId}/onboarding-tokens`),
      api<DocumentState[]>(`/api/internal/clients/${clientId}/documents`),
      api<Atom[]>(`/api/internal/clients/${clientId}/atoms`),
      api<HeldState>(`/api/internal/clients/${clientId}/held`),
    ]).then(([summary, people, tokens, documents, atoms, held]) => {
      if (!active) return;
      setOverview({ summary, people, tokens, documents, atoms, held });
    }).catch((reason) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : "Unable to load the workspace overview.");
    });
    return () => { active = false; };
  }, [api, clientId, refreshToken]);

  if (!overview && !error) return <PanelLoading />;
  if (error) return <Card className="p-6"><Message>{error}</Message></Card>;
  const { summary, people, tokens, documents, atoms, held } = overview!;
  const failedDocuments = documents.filter((item) => item.status === "failed").length;
  const processingDocuments = documents.filter((item) => !["atomised", "failed"].includes(item.status)).length;
  const readyDocuments = documents.filter((item) => item.status === "atomised").length;
  const reviewAtoms = atoms.filter((item) => item.status === "provisional").length;
  const confirmedAtoms = atoms.filter((item) => item.status === "confirmed").length;
  const latestVersion = summary.voice_profile.latest_version;
  const approvedVersion = summary.voice_profile.approved_version;
  const selectedPlay = summary.plays.find((play) => play.play_id === summary.selected_play_id);
  const missing = selectedPlay?.missing_atom_types ?? [];
  const activeLinks = tokens.filter((item) => item.revoked_at === null).length;
  const usedLinks = tokens.filter((item) => item.last_used_at).length;
  const prepare: Array<{ label: string; detail: string; done: boolean; section: InternalSection }> = [
    { label: "People", detail: people.length ? `${people.length} client ${people.length === 1 ? "person" : "people"} added.` : "Add the first client person.", done: people.length > 0, section: "people" },
    { label: "Sources", detail: failedDocuments ? `${failedDocuments} ${failedDocuments === 1 ? "source has" : "sources have"} failed and ${failedDocuments === 1 ? "needs" : "need"} review.` : processingDocuments ? `${processingDocuments} source ${processingDocuments === 1 ? "is" : "are"} processing.` : readyDocuments ? `${readyDocuments} source ${readyDocuments === 1 ? "is" : "are"} ready.` : "Add source material.", done: readyDocuments > 0 && failedDocuments === 0 && processingDocuments === 0, section: "sources" },
    { label: "Knowledge", detail: reviewAtoms ? `${reviewAtoms} knowledge ${reviewAtoms === 1 ? "item needs" : "items need"} review.` : confirmedAtoms ? `${confirmedAtoms} confirmed knowledge ${confirmedAtoms === 1 ? "item" : "items"}.` : "Review extracted records when available.", done: confirmedAtoms > 0 && reviewAtoms === 0, section: "knowledge" },
    { label: "Voice profile", detail: latestVersion !== null && latestVersion !== approvedVersion ? `Review v${latestVersion}; approved ${approvedVersion === null ? "none" : `v${approvedVersion}`}.` : approvedVersion !== null ? `Approved v${approvedVersion}.` : "Build a version after knowledge review.", done: latestVersion !== null && latestVersion === approvedVersion, section: "profile" },
    { label: "Held drafts", detail: held.held_count ? `${held.held_count} ${held.held_count === 1 ? "draft" : "drafts"} waiting for review.` : "No drafts waiting for review.", done: held.held_count === 0, section: "held" },
  ];
  const clientSteps: Array<{ label: string; detail: string; done: boolean; section?: InternalSection }> = [
    { label: "Client access", detail: usedLinks ? `${usedLinks} issued ${usedLinks === 1 ? "link has" : "links have"} been used.` : activeLinks ? `${activeLinks} active ${activeLinks === 1 ? "link" : "links"}; use is not yet recorded.` : "Issue a link for a selected person.", done: usedLinks > 0, section: "access" },
    { label: "Onboarding answers", detail: "Completion is not available through the operator API yet.", done: false },
  ];
  return <div>
    <div className="idc-track">
      {[{ title: "Your side", description: "Prepare and review what the client will use.", steps: prepare }, { title: "Client side", description: "Track access and onboarding progress.", steps: clientSteps }].map((group) =>
        <DesignCard className="idc-card" key={group.title}>
          <DesignCardHeader><h2 className="idc-track-title">{group.title}</h2><DesignCardDescription>{group.description}</DesignCardDescription></DesignCardHeader>
          <DesignCardContent><div className="idc-track-items">{group.steps.map((step) =>
            <div className="idc-track-item" key={step.label}><span className={`idc-track-icon ${step.section ? step.done ? "" : "pending" : "unknown"}`}>{step.done ? <Check size={14} /> : step.section ? <CircleAlert size={14} /> : <CircleHelp size={14} />}</span><div className="idc-track-body"><strong>{step.label}</strong><p>{step.detail}</p></div>{step.section ? <DesignButton variant="outline" size="sm" className="idc-button idc-small" onClick={() => onNavigate(step.section!)}>View <ArrowRight size={14} /></DesignButton> : null}</div>
          )}</div></DesignCardContent>
        </DesignCard>
      )}
    </div>
    {selectedPlay && missing.length > 0 ? <div className="idc-overview-onboarding"><PrepareOnboardingCard missingAtomTypes={missing} /></div> : null}
  </div>;
}

export function VoiceProfilePanel({ clientId, api, onChanged }: { clientId: string; api: InternalApi; onChanged: () => void }) {
  const [profile, setProfile] = useState<VoiceProfile | null | undefined>(undefined);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [queuedAfterVersion, setQueuedAfterVersion] = useState<number | undefined>(undefined);
  const [buildMessage, setBuildMessage] = useState<string | null>(null);
  const pollStartedAt = useRef(0);

  const load = useCallback(async () => {
    const [nextProfile, nextSummary] = await Promise.all([
      api<VoiceProfile | null>(`/api/internal/voice-profile?clientId=${clientId}&full=1`),
      api<Summary>(`/api/internal/clients/${clientId}/summary`),
    ]);
    setProfile(nextProfile);
    setSummary(nextSummary);
    setError(null);
    return { profile: nextProfile, summary: nextSummary };
  }, [api, clientId]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(load).catch((reason) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : "Unable to load voice profile.");
      setProfile(null);
    });
    return () => { active = false; };
  }, [load]);

  useEffect(() => {
    if (queuedAfterVersion === undefined) return;
    let active = true;
    let timer: number | undefined;
    pollStartedAt.current = Date.now();

    const poll = async () => {
      try {
        const next = await load();
        const latest = next.summary.voice_profile.latest_version ?? 0;
        if (!active) return;
        if (latest > queuedAfterVersion) {
          setQueuedAfterVersion(undefined);
          setBuildMessage(`Voice profile v${latest} is ready to review.`);
          onChanged();
          return;
        }
        if (Date.now() - pollStartedAt.current >= 120_000) {
          setQueuedAfterVersion(undefined);
          setBuildMessage("The build is still running in the background. You can leave this section and return later.");
          return;
        }
        timer = window.setTimeout(() => { void poll(); }, 1500);
      } catch (reason) {
        if (!active) return;
        setQueuedAfterVersion(undefined);
        setError(reason instanceof Error ? reason.message : "Unable to check the voice-profile build.");
      }
    };

    timer = window.setTimeout(() => { void poll(); }, 600);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [load, onChanged, queuedAfterVersion]);

  async function act(action: "build" | "approve") {
    setBusy(true);
    setError(null);
    setBuildMessage(null);
    try {
      await api("/api/internal/voice-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "approve" ? { clientId, action, version: profile?.version } : { clientId, action }),
      });
      if (action === "build") {
        setQueuedAfterVersion(summary?.voice_profile.latest_version ?? 0);
        setBuildMessage("Build queued. This page will update when the new version is ready.");
      } else {
        await load();
        setBuildMessage(`Voice profile v${profile?.version} approved.`);
        onChanged();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update voice profile.");
    } finally {
      setBusy(false);
    }
  }

  const latestVersion = summary?.voice_profile.latest_version ?? null;
  const approvedVersion = summary?.voice_profile.approved_version ?? null;
  const atomCount = summary ? computeGroundingGap(summary.atom_counts).atom_count : 0;
  const building = queuedAfterVersion !== undefined;

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Latest profile</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">Build from client knowledge, review the resulting profile, and approve an exact version.</p>
        </div>
        <Button size="sm" disabled={busy || building || atomCount === 0} onClick={() => void act("build")}>
          {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {building ? "Building…" : latestVersion === null ? "Build profile" : "Rebuild profile"}
        </Button>
      </div>

      {profile === undefined && error === null ? <div className="mt-6"><PanelLoading /></div> : null}
      {profile === null && error === null ? (
        <div className="mt-6 rounded-xl border border-dashed border-line-2 px-5 py-8 text-center">
          <p className="text-sm font-semibold text-ink">No profile yet</p>
          <p className="mt-1 text-sm text-muted">{atomCount === 0 ? "Add and process source material before building." : "The knowledge base is ready for its first build."}</p>
        </div>
      ) : null}
      {profile ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <ProfileFact label="Latest version" value={`v${latestVersion ?? profile.version}`} />
          <ProfileFact label="Approved version" value={approvedVersion === null ? "Not approved" : `v${approvedVersion}`} />
          <ProfileFact label="Knowledge used" value={`${profile.corpus?.atom_count ?? "Unknown"} items · ${profile.corpus?.document_ids?.length ?? "unknown"} sources`} />
        </div>
      ) : null}
      {profile ? <div className="mt-5 rounded-xl border border-line bg-surface p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-base font-semibold text-ink">Review v{profile.version}</h3><span className="text-sm text-muted">Built {new Date(profile.created_at).toLocaleString()}</span></div>{profile.diff?.changed_sections?.length ? <p className="mt-2 text-sm text-muted">Changed: {profile.diff.changed_sections.map((part) => part.replaceAll("_", " ")).join(", ")}</p> : null}{typeof profile.payload?.executive_summary === "string" ? <p className="mt-4 whitespace-pre-wrap text-[15px] leading-7 text-ink">{profile.payload.executive_summary}</p> : null}{profile.payload ? <div className="mt-4 divide-y divide-line">{Object.entries(profile.payload).filter(([key]) => key !== "executive_summary").map(([key, value]) => <details key={key} className="py-3"><summary className="cursor-pointer text-sm font-semibold capitalize text-ink">{key.replaceAll("_", " ")}</summary><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-3 p-4 text-sm leading-6 text-ink">{JSON.stringify(value, null, 2)}</pre></details>)}</div> : <p className="mt-3 text-sm text-muted">The profile content is unavailable. Reload before approving.</p>}</div> : null}
      {latestVersion !== null && latestVersion !== approvedVersion && profile ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-3 p-4">
          <p className="text-sm text-muted">{profile.version === latestVersion ? `Approve v${latestVersion} to make this exact version available to generation.` : "The latest profile is updating. Reload this section before approval."}</p>
          <Button size="sm" variant="secondary" disabled={busy || building || !profile.payload || profile.version !== latestVersion} onClick={() => void act("approve")}>Approve v{latestVersion}</Button>
        </div>
      ) : null}
      {buildMessage ? <p role="status" className="mt-4 rounded-[10px] border border-line bg-surface-3 px-4 py-3 text-sm text-ink">{buildMessage}</p> : null}
      <Message>{error}</Message>
    </Card>
  );
}

function ProfileFact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-surface-3 p-4"><p className="text-xs font-semibold text-muted">{label}</p><p className="mt-2 break-words text-sm font-bold text-ink">{value}</p></div>;
}

// The three kinds this panel can ask the route to mint (fix wave, 2026-08-22,
// F1-console). Mirrors `OnboardingTokenPurpose` in `@/lib/product` exactly —
// not imported, because that module opens with `import "server-only"` and
// this is a client component; the three literals are compared byte for byte
// with that type rather than left to drift, the same discipline this repo's
// duplicated-sentence constants already follow.
type LinkPurpose = "onboarding" | "invite" | "reset";

const PURPOSE_OPTIONS: Array<[LinkPurpose, string]> = [
  ["onboarding", "Magic link (sign in)"],
  ["invite", "Invitation (set password)"],
  ["reset", "Password reset"],
];

function LoginLinkPanel({ clientId, api, recipientId, onIssued }: { clientId: string; api: InternalApi; recipientId: string; onIssued: () => void }) {
  const [purpose, setPurpose] = useState<LinkPurpose>("onboarding");
  const [people, setPeople] = useState<Array<{ id: string; display_name: string; email: string }> | null>(null);
  const [selectedPerson, setSelectedPerson] = useState(recipientId);
  const [url, setUrl] = useState<string | null>(null);
  const [issuedLabel, setIssuedLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    let active = true;
    void api<Array<{ id: string; display_name: string; email: string }>>(`/api/internal/clients/${clientId}/users`)
      .then((rows) => { if (active) setPeople(rows); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Unable to load client people."); });
    return () => { active = false; };
  }, [api, clientId]);

  useEffect(() => { setSelectedPerson(recipientId); }, [recipientId]);

  async function mint() {
    if (!selectedPerson) { setError("Choose a recipient first."); return; }
    setBusy(true);
    setError(null);
    setCopyState("idle");
    try {
      const response = await api<{ url: string }>("/api/internal/client-login-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, userId: selectedPerson, purpose }),
      });
      setUrl(response.url);
      const recipient = people?.find((person) => person.id === selectedPerson);
      setIssuedLabel(`${recipient?.display_name ?? selectedPerson} · ${PURPOSE_OPTIONS.find(([kind]) => kind === purpose)?.[1] ?? purpose}`);
      setCopyState("idle");
      onIssued();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to mint login link.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url || copyState === "copied") return;
    setCopyState("idle");
    try {
      await copyText(url);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-[20px] font-bold tracking-[-0.02em]">Create a client login</h2>
      <p className="mt-1 text-sm text-muted">The link is shown once and is never saved in this browser.</p>
      <label className="mt-5 block"><span className="mb-2 block text-[14px] text-muted">Recipient</span><select aria-label="Recipient" className="w-full rounded-[10px] border border-line bg-surface px-4 py-[13px] text-[15px] text-ink outline-none transition-colors focus:border-accent" value={selectedPerson} onChange={(event) => setSelectedPerson(event.target.value)}><option value="">Choose a person</option>{people?.map((person) => <option key={person.id} value={person.id}>{person.display_name} · {person.email}</option>)}</select></label>
      <label className="mt-5 block">
        <span className="mb-2 block text-[14px] text-muted">Kind of link</span>
        <select
          aria-label="Kind of link"
          className="w-full rounded-[10px] border border-line bg-surface px-4 py-[13px] text-[15px] text-ink outline-none transition-colors focus:border-accent"
          value={purpose}
          onChange={(event) => setPurpose(event.target.value as LinkPurpose)}
        >
          {PURPOSE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <Button size="sm" className="mt-5" disabled={busy || !selectedPerson} onClick={() => void mint()}>{busy ? "Generating…" : "Generate link"}</Button>
      <Message>{error}</Message>
      {url ? <div className="mt-4 rounded-xl bg-surface-3 p-4"><p className="mb-2 text-sm font-semibold text-ink">Last generated for {issuedLabel}</p><p className="break-all text-sm text-ink">{url}</p><Button size="sm" variant="secondary" className="mt-3" onClick={() => void copy()} disabled={copyState === "copied"}>{copyState === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copyState === "copied" ? "Copied" : "Copy link"}</Button>{copyState === "error" ? <p role="alert" className="mt-3 text-sm text-danger">Could not access the clipboard. Select and copy the link above.</p> : null}<span className="sr-only" aria-live="polite">{copyState === "copied" ? "Login link copied to clipboard." : ""}</span></div> : null}
    </Card>
  );
}

function AtomsPanel({ clientId, api, onChanged }: { clientId: string; api: InternalApi; onChanged: () => void }) {
  const [atoms, setAtoms] = useState<Atom[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<Atom | null>(null);

  const load = useCallback(async () => {
    try {
      setAtoms(await api<Atom[]>(`/api/internal/clients/${clientId}/atoms`));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load knowledge items.");
      setAtoms([]);
    }
  }, [api, clientId]);

  useEffect(() => {
    let active = true;
    void api<Atom[]>(`/api/internal/clients/${clientId}/atoms`)
      .then((value) => active && setAtoms(value))
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "Unable to load knowledge items."));
    return () => { active = false; };
  }, [api, clientId]);

  async function decide(atom: Atom, decision: "confirm" | "deprecate") {
    if (busyId !== null) return;
    setBusyId(atom.id);
    setError(null);
    try {
      await api(`/api/internal/clients/${clientId}/atoms/${atom.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      await load();
      onChanged();
      setPendingRemoval(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update knowledge item.");
    } finally {
      setBusyId(null);
    }
  }

  const selected = atoms?.find((atom) => atom.id === selectedId) ?? atoms?.[0];
  const sourceId = selected?.document_id ?? null;
  const sourceLine = selected && typeof selected.provenance?.line === "number" ? selected.provenance.line : null;
  const speaker = selected && typeof selected.provenance?.speaker === "string" ? selected.provenance.speaker : null;

  return <div>
    <Message>{error}</Message>
    {atoms === null && error === null ? <PanelLoading /> : atoms?.length === 0 ? <Card className="idc-card idc-empty-card idc-compact-screen text-center"><h2 className="text-lg font-semibold text-ink">No knowledge items yet</h2><p className="mt-2 text-sm text-muted">Processed sources will add reviewable knowledge here.</p></Card> : <div className="idc-detail-layout"><Card className="idc-card overflow-hidden"><div className="border-b border-line px-5 py-4"><h2 className="text-lg font-semibold text-ink">Review items</h2><p className="mt-1 text-sm text-muted">Confirm or remove extracted material.</p></div><div className="idc-rows">{atoms?.map((atom) => <button type="button" key={atom.id} className={`idc-selectrow ${selected?.id === atom.id ? "selected" : ""}`} onClick={() => setSelectedId(atom.id)}><span className="idc-row-main"><strong>{labelForAtomType(atom.atom_type)}</strong><small>{atom.text.slice(0, 110)}{atom.text.length > 110 ? "…" : ""}</small></span><span className={`idc-badge ${atom.status === "confirmed" ? "ok" : atom.status === "deprecated" ? "neutral" : "warn"}`}>{atom.status}</span></button>)}</div></Card>{selected && <Card className="idc-card overflow-hidden"><div className="border-b border-line px-5 py-4"><h2 className="text-lg font-semibold text-ink">{labelForAtomType(selected.atom_type)}</h2><p className="mt-1 text-sm text-muted">{selected.status}</p></div><div className="idc-detail-content"><p className="whitespace-pre-wrap break-words">{selected.text}</p><dl><dt>Evidence</dt><dd>{selected.evidence_kind ?? "Not recorded"}</dd><dt>Source ID</dt><dd className="break-all">{sourceId ?? "Not recorded"}</dd>{sourceLine !== null && <><dt>Line</dt><dd>{sourceLine}</dd></>}{speaker && <><dt>Speaker</dt><dd>{speaker}</dd></>}</dl></div>{selected.status !== "deprecated" && <div className="idc-detail-footer">{selected.status !== "confirmed" ? <Button size="sm" variant="secondary" disabled={busyId !== null} onClick={() => void decide(selected, "confirm")}>Confirm</Button> : null}<Button size="sm" variant="secondary" disabled={busyId !== null} onClick={() => setPendingRemoval(selected)}>Remove from use</Button></div>}</Card>}</div>}
    {pendingRemoval && <ConfirmDialog intent="destructive" title="Remove this knowledge item from use?" consequence="This item will be deprecated and excluded from future retrieval and generation." confirmLabel="Remove from use" cancelLabel="Keep item" onConfirm={() => void decide(pendingRemoval, "deprecate")} onCancel={() => setPendingRemoval(null)} busy={busyId !== null} error={error} />}
  </div>;
}

export function ClientDetail({
  clientId,
  api,
  section,
  onNavigate,
}: {
  clientId: string;
  api: InternalApi;
  section: InternalSection;
  onNavigate: (section: InternalSection) => void;
}) {
  const [refreshToken, setRefreshToken] = useState(0);
  const [recipientId, setRecipientId] = useState("");
  const [knowledgeTab, setKnowledgeTab] = useState<"review" | "search">("review");
  const changed = useCallback(() => setRefreshToken((value) => value + 1), []);

  return (
    <div key={`${clientId}:${section}`} className="rise">
      {section === "overview" ? <OverviewPanel clientId={clientId} api={api} refreshToken={refreshToken} onNavigate={onNavigate} /> : null}
      {section === "people" ? <PeoplePanel clientId={clientId} api={api} onChanged={changed} onCreateAccessLink={(personId) => { setRecipientId(personId); onNavigate("access"); }} /> : null}
      {section === "sources" ? <DocumentsPanel clientId={clientId} api={api} onChanged={changed} /> : null}
      {section === "knowledge" ? <div className="idc-compact-screen"><div className="idc-tabs" role="tablist" aria-label="Knowledge views"><button type="button" role="tab" aria-selected={knowledgeTab === "review"} className="idc-tab" data-active={knowledgeTab === "review"} onClick={() => setKnowledgeTab("review")}>Review knowledge</button><button type="button" role="tab" aria-selected={knowledgeTab === "search"} className="idc-tab" data-active={knowledgeTab === "search"} onClick={() => setKnowledgeTab("search")}>Search corpus</button></div>{knowledgeTab === "review" ? <AtomsPanel clientId={clientId} api={api} onChanged={changed} /> : <SearchPanel clientId={clientId} api={api} />}</div> : null}
      {section === "profile" ? <VoiceProfilePanel clientId={clientId} api={api} onChanged={changed} /> : null}
      {section === "access" ? <div className="space-y-5"><div className="idc-grid-2"><LoginLinkPanel clientId={clientId} api={api} recipientId={recipientId} onIssued={changed} /><DesignCard className="idc-card idc-access-guide"><DesignCardHeader><h2 className="text-lg font-semibold">How access works</h2><DesignCardDescription>Each link is for one selected person and one purpose.</DesignCardDescription></DesignCardHeader><DesignCardContent className="space-y-4 text-sm leading-6 text-muted"><p>Choose a recipient and generate the link. Copy it now: its full URL appears only once.</p><p>The person opens it to continue their client access flow. You can check issued links below and revoke a link that should no longer work.</p><p>Links listed below do not expose their original URL.</p></DesignCardContent></DesignCard></div><TokensPanel key={refreshToken} clientId={clientId} api={api} /></div> : null}
      {section === "held" ? <HeldPanel clientId={clientId} api={api} onChanged={changed} /> : null}
    </div>
  );
}
