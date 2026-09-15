"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Copy, Loader2, Sparkles } from "lucide-react";

import { Button, Card } from "@/components/ui/primitives";
import { LoadingRegion, Skeleton } from "@/components/ui/admin-skeleton";
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
};

type Atom = {
  id: string;
  atom_type: string;
  status: "provisional" | "confirmed" | "deprecated";
  text: string;
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
  const [overview, setOverview] = useState<{ summary: Summary; people: Person[]; tokens: OnboardingToken[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api<Summary>(`/api/internal/clients/${clientId}/summary`),
      api<Person[]>(`/api/internal/clients/${clientId}/users`),
      api<OnboardingToken[]>(`/api/internal/clients/${clientId}/onboarding-tokens`),
    ])
      .then(([summary, people, tokens]) => {
        if (!active) return;
        setOverview({ summary, people, tokens });
        setError(null);
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Unable to load the workspace summary.");
      });
    return () => { active = false; };
  }, [api, clientId, refreshToken]);

  if (overview === null && error === null) return <PanelLoading />;
  if (error) return <Card className="p-6"><Message>{error}</Message></Card>;

  const { summary, people, tokens } = overview!;
  const grounding = computeGroundingGap(summary!.atom_counts);
  const selectedPlay = summary!.plays.find((play) => play.play_id === summary!.selected_play_id);
  const missing = selectedPlay?.missing_atom_types ?? [];
  const latestVersion = summary!.voice_profile.latest_version;
  const approvedVersion = summary!.voice_profile.approved_version;
  const profileReady = latestVersion !== null;
  const latestApproved = latestVersion !== null && latestVersion === approvedVersion;
  const actions: Array<{
    title: string;
    detail: string;
    complete: boolean;
    section: InternalSection;
  }> = [
    {
      title: "Prepare the person",
      detail: "Add the person who will receive this workspace.",
      complete: people.length > 0,
      section: "people",
    },
    {
      title: "Add source material",
      detail: grounding.atom_count > 0 ? `${grounding.atom_count} knowledge items available.` : "Upload calls, notes, or brand material.",
      complete: grounding.atom_count > 0,
      section: "sources",
    },
    {
      title: "Review extracted knowledge",
      detail: missing.length === 0 ? "The selected play has full knowledge coverage." : `${missing.length} knowledge types still need evidence.`,
      complete: grounding.atom_count > 0 && missing.length === 0,
      section: "knowledge",
    },
    {
      title: "Build and approve voice",
      detail: latestApproved
        ? `Voice profile v${latestVersion} is approved.`
        : approvedVersion !== null && latestVersion !== null
          ? `Voice profile v${approvedVersion} is approved; v${latestVersion} awaits approval.`
          : profileReady
            ? "A draft profile is ready for approval."
            : "Build a profile from reviewed material.",
      complete: latestApproved,
      section: "profile",
    },
    {
      title: "Invite the client",
      detail: tokens.some((token) => token.revoked_at === null) ? "A live client login is available." : "Mint a login link after the workspace is ready.",
      complete: tokens.some((token) => token.revoked_at === null),
      section: "access",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Knowledge items" value={String(grounding.atom_count)} detail="live atoms" onClick={() => onNavigate("knowledge")} />
        <Metric label="Grounding coverage" value={`${grounding.completeness_percent}%`} detail={`${grounding.grounded_type_count}/${grounding.total_type_count} types`} onClick={() => onNavigate("knowledge")} />
        <Metric
          label="Voice profile"
          value={profileReady ? `v${latestVersion}` : "Not built"}
          detail={latestApproved ? "approved" : profileReady ? "awaiting approval" : grounding.atom_count > 0 ? "ready to build" : "needs material"}
          onClick={() => onNavigate("profile")}
        />
        <Metric label="Selected play" value={missing.length === 0 ? "Ready" : `${missing.length} gaps`} detail={summary!.selected_play_id} onClick={() => onNavigate("knowledge")} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-line px-6 py-5">
            <p className="eyebrow">Workspace path</p>
            <h2 className="mt-2 text-[22px] font-bold tracking-[-0.02em]">Move this client from material to publishing</h2>
          </div>
          <ol className="divide-y divide-line">
            {actions.map((action, index) => (
              <li key={action.title}>
                <button type="button" onClick={() => onNavigate(action.section)} className="group flex w-full items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-surface-3">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${action.complete ? "border-accent bg-accent text-accent-ink" : "border-line-2 text-muted"}`}>
                    {action.complete ? <Check size={15} strokeWidth={2.4} /> : index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold text-ink">{action.title}</span>
                    <span className="mt-0.5 block text-[13px] text-muted">{action.detail}</span>
                  </span>
                  <ArrowRight size={17} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
                </button>
              </li>
            ))}
          </ol>
        </Card>

        <div className="space-y-6">
          <PrepareOnboardingCard missingAtomTypes={missing} />
          {missing.length > 0 ? (
            <Card className="p-5">
              <p className="eyebrow">Highest leverage gaps</p>
              <ul className="mt-4 space-y-2 text-sm text-ink">
                {missing.slice(0, 5).map((type) => <li key={type} className="rounded-[9px] bg-surface-3 px-3 py-2">{labelForAtomType(type)}</li>)}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, detail, onClick }: { label: string; value: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-[14px] border border-line bg-surface-2 p-5 text-left transition-colors hover:border-line-2 hover:bg-surface">
      <span className="block text-[13px] font-semibold text-muted">{label}</span>
      <span className="mt-3 block text-[25px] font-bold tracking-[-0.025em] text-ink">{value}</span>
      <span className="mt-1 block truncate text-[12px] text-muted">{detail}</span>
    </button>
  );
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
          <p className="eyebrow">Voice system</p>
          <h2 className="mt-2 text-[22px] font-bold tracking-[-0.02em]">Voice profile</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">Build a cited profile from this client&apos;s live knowledge, then approve the exact version used by generation.</p>
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
          <ProfileFact label="Built" value={new Date(profile.created_at).toLocaleString()} />
        </div>
      ) : null}
      {latestVersion !== null && latestVersion !== approvedVersion && profile ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-3 p-4">
          <p className="text-sm text-muted">Review complete? Approve v{latestVersion} to make it available to generation.</p>
          <Button size="sm" variant="secondary" disabled={busy || building} onClick={() => void act("approve")}>Approve v{latestVersion}</Button>
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
  ["onboarding", "Magic link (existing behaviour)"],
  ["invite", "Invite — set a password for the first time"],
  ["reset", "Reset — replace a forgotten password"],
];

function LoginLinkPanel({ clientId, api }: { clientId: string; api: InternalApi }) {
  const [purpose, setPurpose] = useState<LinkPurpose>("onboarding");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  async function mint() {
    setBusy(true);
    setError(null);
    setUrl(null);
    try {
      const response = await api<{ url: string }>("/api/internal/client-login-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, purpose }),
      });
      setUrl(response.url);
      setCopyState("idle");
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
      <Button size="sm" className="mt-5" disabled={busy} onClick={() => void mint()}>{busy ? "Minting…" : "Mint login link"}</Button>
      <Message>{error}</Message>
      {url ? <div className="mt-4 rounded-xl bg-surface-3 p-4"><p className="break-all text-sm text-ink">{url}</p><Button size="sm" variant="secondary" className="mt-3" onClick={() => void copy()} disabled={copyState === "copied"}>{copyState === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copyState === "copied" ? "Copied" : "Copy link"}</Button>{copyState === "error" ? <p role="alert" className="mt-3 text-sm text-danger">Could not access the clipboard. Select and copy the link above.</p> : null}<span className="sr-only" aria-live="polite">{copyState === "copied" ? "Login link copied to clipboard." : ""}</span></div> : null}
    </Card>
  );
}

function AtomsPanel({ clientId, api, onChanged }: { clientId: string; api: InternalApi; onChanged: () => void }) {
  const [atoms, setAtoms] = useState<Atom[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update knowledge item.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-[20px] font-bold tracking-[-0.02em]">Knowledge review</h2>
      <p className="mt-1 text-sm text-muted">Confirm useful material or remove it from future generation.</p>
      <Message>{error}</Message>
      {atoms === null && error === null ? <div className="mt-5"><PanelLoading /></div> : atoms !== null && atoms.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-line-2 px-4 py-8 text-center text-sm text-muted">No knowledge items yet.</div>
      ) : (
        <ul className="mt-5 divide-y divide-line">
          {atoms?.map((atom) => (
            <li key={atom.id} className="flex flex-wrap items-start justify-between gap-4 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-muted">{labelForAtomType(atom.atom_type)} · {atom.status}</p>
                <p className="mt-1 break-words text-sm leading-6 text-ink">{atom.text}</p>
              </div>
              {atom.status !== "deprecated" ? <div className="flex gap-2">{atom.status !== "confirmed" ? <Button size="sm" variant="secondary" disabled={busyId !== null} onClick={() => void decide(atom, "confirm")}>Confirm</Button> : null}<Button size="sm" variant="secondary" disabled={busyId !== null} onClick={() => void decide(atom, "deprecate")}>Remove</Button></div> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
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
  const changed = useCallback(() => setRefreshToken((value) => value + 1), []);

  return (
    <div key={`${clientId}:${section}`} className="rise">
      {section === "overview" ? <OverviewPanel clientId={clientId} api={api} refreshToken={refreshToken} onNavigate={onNavigate} /> : null}
      {section === "people" ? <PeoplePanel clientId={clientId} api={api} onChanged={changed} /> : null}
      {section === "sources" ? <DocumentsPanel clientId={clientId} api={api} onChanged={changed} /> : null}
      {section === "knowledge" ? <div className="space-y-6"><SearchPanel clientId={clientId} api={api} /><AtomsPanel clientId={clientId} api={api} onChanged={changed} /></div> : null}
      {section === "profile" ? <VoiceProfilePanel clientId={clientId} api={api} onChanged={changed} /> : null}
      {section === "access" ? <div className="space-y-6"><LoginLinkPanel clientId={clientId} api={api} /><TokensPanel clientId={clientId} api={api} /></div> : null}
      {section === "held" ? <HeldPanel clientId={clientId} api={api} onChanged={changed} /> : null}
    </div>
  );
}
