// A knowledge source's popup on the rehaul engine (Cycle 5 P7.2; spec §7.1-7.3,
// A17, A20, A21). It follows the Library popup (`Library.tsx`, the post peek):
// one dialog, a heading with the name, a column of properties, the actions in
// its footer. There is no file preview and no download (D07).
//
// - Identity: name, type, date added, and the business labels.
// - Status: the §7.2 label with its line (when it continues, or the stage) and,
//   when there is one, the fuller reason (a file too long: how to split it).
// - Use this source: the client's switch (P7.1), with a browser intent key and
//   the revision last read; "Pending" until the change is enforced. A withdrawn
//   or replaced source (`closed`) has no switch: it is not the same thing as Off,
//   and the popup says why in plain words (P7 review C-1): our team stopped it,
//   or a newer upload replaced it.
// - Any open question about this source, answered inline on the shared card
//   (P6.6) from `surface=source:{id}`. Nothing is stacked over this dialog: View
//   usage closes it first.
// - Delete file (Cycle 5 P8.3): for a signed-in member only (D05; the backend
//   refuses a link anyway). It asks first, in this same dialog (nothing stacked):
//   "Delete this file?", then sends the delete with a browser intent key, reused
//   on a retry, against the revision last read. The list then shows the file as
//   Deleting until its purge finishes. A file already being deleted offers nothing.
// Under M1, or before the engine is known, this renders nothing.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { REPLACED_DETAIL, type SourceUse } from '@/lib/knowledge-status';
import { deleteSource, readSourceUse, SWITCH_READ_FAILED, switchSource, waitUntilEnforced } from '@/lib/source-switch';
import { useIntentKey } from '@/lib/use-intent-key';
import { uploadTypeName } from '@/lib/upload-contract';
import { utcDay } from '@/lib/utc-reset';
import { showsKnowledgeStatus, sourceLabelNames, sourceName, type Engine, type ServerDocument } from './knowledge-view';
import { SourceLabels } from './KnowledgeSource';
import QuestionsPanel from './QuestionsPanel';

export const USE_THIS_SOURCE = 'Use this source';
export const USE_OFF_NOTE = 'Off keeps the file, but its information is not used for your knowledge or writing. You can turn it back on.';
/** A withdrawn source: staff stopped it (the operator's Stop processing), so the switch cannot act on it. */
export const CLOSED_USE_COPY = 'Our team stopped using this file, so this switch cannot turn it on. Contact us if it should be used again.';
/** A superseded source: a newer upload replaced it. */
export const REPLACED_USE_COPY = 'A newer upload replaced this file, so this switch cannot turn it on.';

/** Why a closed source has no switch, in plain words. */
export function closedUseCopy(document: ServerDocument): string {
  return document.knowledge?.detail === REPLACED_DETAIL ? REPLACED_USE_COPY : CLOSED_USE_COPY;
}
export const SOURCE_QUESTION_TITLE = 'A question about this file';
export const SOURCE_KIND = 'Knowledge source';
export const DELETE_FILE = 'Delete file';
export const DELETE_TITLE = 'Delete this file?';

/** The confirmation's body (D12 wording): what goes, what stays, and that it is final. */
export function deleteConfirmBody(name: string): string {
  return `“${name}” and its earlier versions, and everything learned only from them, will be removed from your workspace. Saved posts stay as they are. This can't be undone, and the upload still counts toward this month's allowance.`;
}

/** The fresh read a delete needs failed: said in the confirmation itself, not only behind it (P8 gate sweep, M-12). */
export const DELETE_READ_FAILED = "We couldn't check this file. Close and reopen it to try again.";

/** The confirmation's note: the delete's own answer first, else why Delete file cannot be pressed. */
export function deleteConfirmNote(deleteNote: string | null, readFailed: boolean): string | null {
  return deleteNote ?? (readFailed ? DELETE_READ_FAILED : null);
}

type ConfirmProps = { name: string; busy: boolean; note: string | null; onCancel: () => void; onConfirm: () => void };

/** "Delete this file?" with Cancel and Delete file. Rendered in the popup's own dialog. */
export function DeleteConfirmView({ name, busy, note, onCancel, onConfirm }: ConfirmProps) {
  return <>
    <div className="rf-peek-info">
      <DialogHeader className="rf-peek-heading">
        <DialogTitle>{DELETE_TITLE}</DialogTitle>
        <DialogDescription>{deleteConfirmBody(name)}</DialogDescription>
      </DialogHeader>
      {note && <p className="rf-peek-note rf-source-use-note" role="alert">{note}</p>}
    </div>
    <DialogFooter className="rf-peek-actions">
      <div className="rf-peek-main-actions">
        <Button variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button variant="destructive" disabled={busy} onClick={onConfirm}>{DELETE_FILE}</Button>
      </div>
    </DialogFooter>
  </>;
}

/** What the switch says beside itself. */
export function switchStateText(use: SourceUse | null): string {
  if (!use) return 'Checking…';
  if (use.state === 'pending') return use.requested === 'on' ? 'Pending · turning on' : 'Pending · turning off';
  return use.state === 'on' ? 'On' : 'Off';
}

type DetailsProps = {
  document: ServerDocument;
  engine: Engine;
  use: SourceUse | null;
  busy: boolean;
  note: string | null;
  onToggle: (wanted: 'on' | 'off') => void;
  /** The inline question, when there is a place for one. */
  question?: ReactNode;
};

/** The popup's body: identity, status, Use this source, and the inline question.
 *  Free of dialog primitives, so it renders (and is tested) on its own. */
export function SourceDetails({ document, engine, use, busy, note, onToggle, question }: DetailsProps) {
  if (!showsKnowledgeStatus(engine, document)) return null;
  const { label, tone, detail, reason } = document.knowledge;
  const labels = sourceLabelNames(document);
  const checked = use ? use.state === 'on' || (use.state === 'pending' && use.requested === 'on') : false;
  return <>
    <div className="rf-peek-properties">
      <div className="rf-peek-property"><span>Status</span><div className="rf-peek-property-value rf-peek-date"><b data-tone={tone}>{label}</b>{detail && <small>{detail}</small>}{reason && <small className="rf-source-reason">{reason}</small>}</div></div>
      <div className="rf-peek-property"><span>Type</span><p className="rf-peek-property-value">{uploadTypeName(sourceName(document))}</p></div>
      <div className="rf-peek-property"><span>Added</span><p className="rf-peek-property-value">{utcDay(document.created_at, { year: true })}</p></div>
      {labels.length > 0 && <div className="rf-peek-property"><span>About</span><div className="rf-peek-property-value"><SourceLabels names={labels} /></div></div>}
      {document.closed
        ? <div className="rf-peek-property"><span>{USE_THIS_SOURCE}</span><p className="rf-peek-property-value">{closedUseCopy(document)}</p></div>
        : <div className="rf-peek-property rf-source-use"><span>{USE_THIS_SOURCE}</span><div className="rf-peek-property-value">
          <Switch aria-label={USE_THIS_SOURCE} checked={checked} disabled={busy || !use || use.state === 'pending'}
            onCheckedChange={value => onToggle(value ? 'on' : 'off')} />
          <span role="status">{switchStateText(use)}</span>
        </div></div>}
    </div>
    {!document.closed && <p className="rf-peek-note">{USE_OFF_NOTE}</p>}
    {note && <p className="rf-peek-note rf-source-use-note" role="alert">{note}</p>}
    {question}
  </>;
}

type ViewProps = DetailsProps & {
  onViewUsage?: () => void;
  onClose: () => void;
  /** Delete file is offered (a signed-in member, a file not already being deleted). */
  onDelete?: () => void;
  /** The confirmation, when Delete file was pressed. */
  confirm?: Omit<ConfirmProps, 'name'> | null;
};

export function SourcePopupView({ onViewUsage, onClose, onDelete, confirm, ...details }: ViewProps) {
  const { document, engine } = details;
  if (!showsKnowledgeStatus(engine, document)) return null;
  if (confirm) {
    return <DialogContent className="rf-peek rf-source-peek rf-source-delete">
      <DeleteConfirmView name={sourceName(document)} {...confirm} />
    </DialogContent>;
  }
  return <DialogContent className="rf-peek rf-source-peek">
    <div className="rf-peek-info">
      <DialogHeader className="rf-peek-heading">
        <DialogDescription>{SOURCE_KIND}</DialogDescription>
        <DialogTitle>{sourceName(document)}</DialogTitle>
      </DialogHeader>
      <SourceDetails {...details} />
    </div>
    <SourcePopupActions document={document} onDelete={onDelete} onViewUsage={onViewUsage} onClose={onClose} />
  </DialogContent>;
}

/** The popup's footer: Delete file (a signed-in member, a file not being deleted), View usage, Close. */
export function SourcePopupActions({ document, onDelete, onViewUsage, onClose }: {
  document: ServerDocument; onDelete?: () => void; onViewUsage?: () => void; onClose: () => void;
}) {
  return <DialogFooter className="rf-peek-actions">
    {onDelete && !document.deleting && <Button variant="ghost" className="rf-source-delete-open" onClick={onDelete}>{DELETE_FILE}</Button>}
    <div className="rf-peek-main-actions">
      {document.knowledge?.usage_limited && onViewUsage && <Button variant="outline" onClick={onViewUsage}>View usage</Button>}
      <Button variant="outline" onClick={onClose}>Close</Button>
    </div>
  </DialogFooter>;
}

type Props = {
  document: ServerDocument;
  engine: Engine;
  onClose: () => void;
  /** The source changed (switched): read the list and this source again. */
  onChanged: () => void;
  onViewUsage?: () => void;
  /** A signed-in member (P8.3): Delete file is offered. */
  canDelete?: boolean;
  /** The delete was recorded: the file is now Deleting. */
  onDeleted?: (documentId: string) => void;
};

export default function SourcePopup({ document, engine, onClose, onChanged, onViewUsage, canDelete = false, onDeleted }: Props) {
  const [use, setUse] = useState<SourceUse | null>(document.closed ? null : document.use ?? null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // The switch waits for its own fresh read: the revision it sends is the newest.
  const [fresh, setFresh] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const holder = useIntentKey();
  // Delete file's own key: the same one for every retry of one delete (P8.3).
  const deleteHolder = useIntentKey();
  const [confirming, setConfirming] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteNote, setDeleteNote] = useState<string | null>(null);
  const alive = useRef(true);
  const id = document.id;
  const closed = Boolean(document.closed);
  const deletable = canDelete && !document.deleting;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // The revision to send is read fresh when the source is opened (a closed source
  // too when it may be deleted: a delete sends the revision it read).
  useEffect(() => {
    if (closed && !deletable) return;
    let live = true;
    readSourceUse(id)
      .then(current => { if (live) { setUse(current); setFresh(true); } })
      .catch(() => { if (live) { setNote(SWITCH_READ_FAILED); setReadFailed(true); } });
    return () => { live = false; };
  }, [id, closed, deletable]);

  const confirmDelete = async () => {
    if (!use || !fresh || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteNote(null);
    try {
      const result = await deleteSource(id, use, deleteHolder);
      if (!alive.current) return;
      if (result.kind === 'deleting') { onDeleted?.(id); return; }
      if (result.kind === 'reloaded') setUse(result.use);
      setDeleteNote(result.message);
      onChanged();
    } catch (error) {
      if (alive.current) setDeleteNote(error instanceof Error ? error.message : 'The file was not deleted. Try again.');
    } finally {
      if (alive.current) setDeleteBusy(false);
    }
  };

  const toggle = async (wanted: 'on' | 'off') => {
    if (!use || !fresh || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await switchSource(id, wanted, use, holder);
      if (!alive.current) return;
      if (result.kind === 'refused') { setNote(result.message); onChanged(); return; }
      setUse(result.use);
      if (result.kind === 'reloaded') { setNote(result.message); onChanged(); return; }
      if (result.use.state === 'pending') {
        const settled = await waitUntilEnforced(id, { stop: () => !alive.current });
        if (!alive.current) return;
        if (settled) setUse(settled);
      }
      onChanged();
    } catch (error) {
      if (alive.current) setNote(error instanceof Error ? error.message : 'Your change was not saved. Try again.');
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const question = closed ? null : <QuestionsPanel surface={`source:${id}`} quiet title={SOURCE_QUESTION_TITLE} />;
  const confirm = confirming ? {
    busy: deleteBusy || !fresh, note: deleteConfirmNote(deleteNote, readFailed),
    onCancel: () => { setConfirming(false); setDeleteNote(null); },
    onConfirm: () => void confirmDelete(),
  } : null;
  return <SourcePopupView document={document} engine={engine} use={use} busy={busy || !fresh} note={note}
    onToggle={wanted => void toggle(wanted)} question={question} onViewUsage={onViewUsage} onClose={onClose}
    onDelete={deletable ? () => setConfirming(true) : undefined} confirm={confirm} />;
}
