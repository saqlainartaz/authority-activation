"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Upload } from "lucide-react";

import ConfirmDialog from "@/components/decide/ConfirmDialog";
import { Button, Card, Field, TextArea } from "@/components/ui/primitives";
import { LoadingRegion, Skeleton } from "@/components/ui/admin-skeleton";
import type { InternalApi } from "./page";

const SOURCE_TYPES = [
  ["other", "Other material"],
  ["meeting_transcript", "Meeting transcript"],
  ["sales_call_transcript", "Sales call transcript"],
  ["brand_doc", "Brand document"],
  ["onboarding_form", "Onboarding form"],
] as const;

type SourceType = (typeof SOURCE_TYPES)[number][0];
type Document = { id: string; source_type: string; source_authority: string; status: string };
type PipelineStage = {
  stage: "parse" | "clean" | "atomise" | "embed";
  actor: string;
  completed_at: string;
};
type DocumentDetail = Document & {
  pipeline_version: number;
  created_at: string;
  atom_count: number;
  pipeline_stages: PipelineStage[];
};

const PIPELINE_LABELS = {
  parse: "Parsed",
  clean: "Cleaned",
  atomise: "Atomised",
  embed: "Embedded",
} as const;

function inferredSourceType(file: File | null): SourceType {
  return file && /\.(?:srt|vtt)$/i.test(file.name) ? "meeting_transcript" : "other";
}

function PanelLoading() {
  return <LoadingRegion><Skeleton className="h-20 rounded-[12px]" /></LoadingRegion>;
}

export function DocumentsPanel({ clientId, api, onChanged }: { clientId: string; api: InternalApi; onChanged: () => void }) {
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [paste, setPaste] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sourceType, setSourceType] = useState<SourceType>("other");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api<Document[]>(`/api/internal/clients/${clientId}/documents`);
      setDocuments(next);
      setListError(null);
    } catch (caught) {
      setDocuments([]);
      setListError(caught instanceof Error ? caught.message : "Unable to load documents.");
    }
  }, [api, clientId]);

  const loadDetail = useCallback(async (documentId: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const next = await api<DocumentDetail>(`/api/internal/clients/${clientId}/documents/${documentId}`);
      setDetail(next);
      setDetailError(null);
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : "Unable to load document detail.");
    } finally {
      setDetailLoading(false);
    }
  }, [api, clientId]);

  useEffect(() => {
    let active = true;
    void api<Document[]>(`/api/internal/clients/${clientId}/documents`).then((next) => active && setDocuments(next)).catch((caught) => {
      if (!active) return;
      setDocuments([]);
      setListError(caught instanceof Error ? caught.message : "Unable to load documents.");
    });
    return () => { active = false; };
  }, [api, clientId]);

  useEffect(() => {
    if (!selectedId || !detail || ["atomised", "failed"].includes(detail.status)) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void api<DocumentDetail>(
        `/api/internal/clients/${clientId}/documents/${selectedId}`,
      ).then((next) => {
        if (!active) return;
        setDetail(next);
        setDocuments((current) => current?.map((document) => (
          document.id === next.id ? { ...document, status: next.status } : document
        )) ?? current);
      }).catch((caught) => {
        if (active) {
          setDetailError(caught instanceof Error ? caught.message : "Unable to refresh document progress.");
        }
      });
    }, 750);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, clientId, detail, selectedId]);

  async function ingest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || (!file && !paste.trim())) return;
    setBusy(true);
    setListError(null);
    const body = new FormData();
    body.append("file", file ?? new File([paste.trim()], "pasted-material.txt", { type: "text/plain" }));
    body.append("source_type", sourceType);
    // The backend stores the filename from the multipart file itself. This
    // field is its controlled trust classification, not a display label.
    body.append("source_authority", "CONVERSATIONAL");
    try {
      const uploaded = await api<Document>(`/api/internal/clients/${clientId}/documents`, { method: "POST", body });
      setFile(null);
      setPaste("");
      setSourceType("other");
      setSelectedId(uploaded.id);
      await Promise.all([load(), loadDetail(uploaded.id)]);
      onChanged();
    } catch (caught) {
      setListError(caught instanceof Error ? caught.message : "Unable to ingest document.");
    } finally {
      setBusy(false);
    }
  }

  async function reprocess() {
    if (!selectedId || busy) return;
    setBusy(true);
    setDetailError(null);
    try {
      await api<{ status: "queued" }>(`/api/internal/clients/${clientId}/documents/${selectedId}`, { method: "POST" });
      await loadDetail(selectedId);
      onChanged();
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : "Unable to reprocess document.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selectedId || busy) return;
    setBusy(true);
    setDetailError(null);
    try {
      await api(`/api/internal/clients/${clientId}/documents/${selectedId}`, {
        method: "DELETE",
      });
      setRemoveOpen(false);
      setSelectedId(null);
      setDetail(null);
      await load();
      onChanged();
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : "Unable to remove this source.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <h3 className="text-base font-bold tracking-tight text-ink">Documents</h3>
      <p className="mt-1 text-sm text-muted">Upload a file or paste material into this client&apos;s corpus.</p>
      <form onSubmit={ingest} className="mt-4 space-y-4">
        <Field
          label="Upload a file"
          type="file"
          onChange={(event) => {
            const nextFile = event.target.files?.[0] ?? null;
            setFile(nextFile);
            setSourceType(inferredSourceType(nextFile));
          }}
        />
        <label className="block">
          <span className="mb-2 block text-[14px] text-muted">Source type</span>
          <select
            aria-label="Source type"
            className="w-full rounded-[10px] border border-line bg-surface px-4 py-[13px] text-[15px] text-ink outline-none transition-colors focus:border-accent"
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value as SourceType)}
          >
            {SOURCE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <TextArea aria-label="Paste material" value={paste} onChange={(event) => setPaste(event.target.value)} placeholder="Paste material" rows={4} />
        <Button type="submit" size="sm" disabled={busy || (!file && !paste.trim())}><Upload className="h-4 w-4" />{busy ? "Ingesting…" : "Ingest material"}</Button>
      </form>
       {listError && <p role="alert" className="mt-3 break-words text-sm text-danger">{listError}</p>}
       {documents === null ? <div className="mt-5"><PanelLoading /></div> : listError ? null : documents.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-border px-4 py-8 text-center"><p className="text-sm font-semibold text-ink">Nothing ingested yet</p><p className="mt-1 text-sm text-muted">Upload or paste this client&apos;s material to start the corpus.</p></div>
      ) : <ul className="mt-5 divide-y divide-border">{documents.map((document) => <li key={document.id} className="py-3"><button type="button" className="w-full text-left" onClick={() => { setSelectedId(document.id); void loadDetail(document.id); }}><p className="font-semibold text-ink break-words">{document.source_authority}</p><p className="mt-1 text-sm text-muted">{document.source_type} · {document.status}</p></button></li>)}</ul>}
       {selectedId && <section className="mt-5 rounded-xl bg-surface-3 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="text-sm font-bold text-ink">Document detail</h4><p className="mt-1 text-sm text-muted">The progress below is read from persisted pipeline history.</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={busy || detailLoading} onClick={() => void reprocess()}>{busy ? "Working…" : "Reprocess document"}</Button><Button size="sm" variant="secondary" disabled={busy || detailLoading} onClick={() => setRemoveOpen(true)}>Remove source</Button></div></div>{detailError && <p role="alert" className="mt-3 break-words text-sm text-danger">{detailError}</p>}{detailLoading ? <div className="mt-4"><PanelLoading /></div> : detail ? <div className="mt-4 space-y-4"><dl className="grid gap-2 text-sm"><div><dt className="inline text-muted">Source type: </dt><dd className="inline font-semibold text-ink">{detail.source_type}</dd></div><div><dt className="inline text-muted">Source authority: </dt><dd className="inline font-semibold text-ink break-words">{detail.source_authority}</dd></div><div><dt className="inline text-muted">Status: </dt><dd className="inline font-semibold text-ink">{detail.status}</dd></div><div><dt className="inline text-muted">Pipeline version: </dt><dd className="inline font-semibold text-ink">{detail.pipeline_version}</dd></div></dl><ol aria-label="Document processing pipeline" className="grid gap-2 sm:grid-cols-5"><li className="rounded-lg border border-line bg-surface px-3 py-2"><p className="text-sm font-semibold text-ink">Uploaded</p><p className="mt-1 text-xs text-muted">{new Date(detail.created_at).toLocaleString()}</p></li>{(["parse", "clean", "atomise", "embed"] as const).map((stageName) => { const stage = detail.pipeline_stages.find((candidate) => candidate.stage === stageName); return <li key={stageName} className="rounded-lg border border-line bg-surface px-3 py-2"><p className="text-sm font-semibold text-ink">{PIPELINE_LABELS[stageName]}</p><p className="mt-1 text-xs text-muted">{stage ? `${new Date(stage.completed_at).toLocaleString()} · ${stage.actor}` : "Waiting"}</p></li>; })}</ol><p className="text-sm font-semibold text-ink">{detail.atom_count} active knowledge {detail.atom_count === 1 ? "item" : "items"} extracted from this source.</p></div> : null}</section>}
      {removeOpen && <ConfirmDialog intent="destructive" title="Remove this source?" consequence="This removes the source and its extracted knowledge from future generation. Existing citation history is retained for audit, and uploading the same file again restores it." confirmLabel="Remove source" cancelLabel="Keep source" onConfirm={() => void remove()} onCancel={() => setRemoveOpen(false)} busy={busy} error={detailError} />}
    </Card>
  );
}
