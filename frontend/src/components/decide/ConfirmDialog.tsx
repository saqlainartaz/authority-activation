"use client";

import Link from "next/link";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { CONSTRAINTS_HREF } from "@/lib/routes";

export const NEVER_SAY_THIS_AGAIN_CONFIRM = {
  intent: "destructive",
  title: "Never say this again?",
  consequence: (
    <>
      We&apos;ll keep this claim out of every future post. You can lift it later in{" "}
      <Link href={CONSTRAINTS_HREF}>Train Your AI → Constraints</Link>, or email{" "}
      <a href="mailto:sd@insidesuccess.com">sd@insidesuccess.com</a>.
    </>
  ),
  confirmLabel: "Never say this again",
  cancelLabel: "Keep it",
} as const;

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Trap focus and return it to the control that opened the dialog when it closes. */
export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  active = true,
) {
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    if (!active) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || ref.current === null) return;
      const focusable = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  }, [active, onClose, ref]);
}

export default function ConfirmDialog({
  intent,
  title,
  consequence,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  busy = false,
  error,
}: {
  intent: "destructive" | "neutral";
  title: string;
  consequence: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useFocusTrap(dialogRef, onCancel);

  useEffect(() => cancelRef.current?.focus(), []);

  const destructive = intent === "destructive";
  const consequenceClass = destructive ? "text-danger" : "text-ink";
  const errorClass = destructive ? "text-danger" : "text-ink";
  const cancelClass = destructive
    ? "bg-accent text-accent-ink hover:bg-accent-hover"
    : "border border-line text-ink hover:bg-surface-2";
  const confirmClass = destructive
    ? "border border-danger text-danger hover:bg-danger-soft"
    : "bg-accent text-accent-ink hover:bg-accent-hover";

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Keep it"
        onClick={onCancel}
        className="absolute inset-0 bg-black/50"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="rise relative w-full max-w-[460px] rounded-t-[16px] border border-line bg-surface sm:rounded-[16px]"
      >
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 id={titleId} className="text-[18px] font-bold text-ink">
            {title}
          </h2>
          <button type="button" onClick={onCancel} aria-label="Close" className="rounded-[8px] p-1.5 text-muted hover:bg-surface-2 hover:text-ink">
            <X size={18} strokeWidth={1.8} />
          </button>
        </header>
        <div className="px-6 py-5">
          <p className={`break-words text-[15px] leading-relaxed ${consequenceClass}`}>{consequence}</p>
          {error ? <p role="alert" className={`mt-3 break-words text-[14px] leading-relaxed ${errorClass}`}>{error}</p> : null}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className={`rounded-[10px] px-6 py-[13px] text-[15px] font-bold disabled:opacity-45 ${cancelClass}`}>
              {cancelLabel}
            </button>
            <button type="button" onClick={onConfirm} disabled={busy} className={`inline-flex items-center gap-2 rounded-[10px] px-6 py-[13px] text-[15px] font-bold disabled:opacity-45 ${confirmClass}`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
