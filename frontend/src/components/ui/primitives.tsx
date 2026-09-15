"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/* -------------------------------------------------------------------------- */
/* Brand                                                                       */
/* -------------------------------------------------------------------------- */

export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-[9px] bg-accent text-[9px] font-semibold tracking-[-0.03em] text-accent-ink"
      style={{ width: size, height: size }}
    >
      AA
    </span>
  );
}

/** The panel glyph used to show and hide the sidebar. */
export function PanelIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={cx("h-[18px] w-[18px]", className)}>
      <rect
        x="1.75"
        y="3.75"
        width="16.5"
        height="12.5"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M7.25 4.45v11.1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <rect x="2.45" y="4.45" width="4.8" height="11.1" fill="currentColor" opacity="0.28" />
    </svg>
  );
}

export function Wordmark({
  label,
  size = 34,
  className,
}: {
  label: string;
  size?: number;
  className?: string;
}) {
  return (
    <span className={cx("inline-flex items-center gap-3", className)}>
      <LogoMark size={size} />
      <span className="text-[17px] font-bold tracking-[-0.01em]">{label}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Buttons                                                                     */
/* -------------------------------------------------------------------------- */

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "sm";

const base =
  "inline-flex items-center justify-center gap-2 rounded-[9px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover",
  secondary:
    "border border-line-2 text-ink hover:border-ink-2 hover:bg-surface-2",
  ghost: "text-muted hover:text-ink",
};

const sizes: Record<Size, string> = {
  md: "px-6 py-[13px] text-[15px]",
  sm: "px-4 py-2 text-[13px]",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={cx(base, variants[variant], sizes[size], className)}
      {...props}
    />
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return (
    <Link
      className={cx(base, variants[variant], sizes[size], className)}
      {...props}
    />
  );
}

/** The quiet brass text link used for "Switch to chat", "Open in Train Your AI". */
export function AccentAction({
  className,
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      className={cx(
        "text-[15px] font-semibold text-accent transition-opacity hover:opacity-75",
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                    */
/* -------------------------------------------------------------------------- */

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-[14px] border border-line bg-surface-2 dark:bg-surface-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <p className={cx("eyebrow", className)}>{children}</p>;
}

export function Avatar({
  initials,
  size = 40,
}: {
  initials: string;
  size?: number;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-surface-3 font-bold text-ink-2"
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {initials}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                    */
/* -------------------------------------------------------------------------- */

export function CheckMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] border transition-colors",
        checked ? "border-accent bg-accent" : "border-line-2 bg-transparent",
      )}
    >
      {checked && (
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none">
          <path
            d="M3 8.5 6.2 11.5 13 4.8"
            stroke="var(--app-accent-ink)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

export function RadioDot({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "flex h-[21px] w-[21px] shrink-0 items-center justify-center rounded-full border transition-colors",
        checked ? "border-accent" : "border-line-2",
      )}
    >
      {checked && <span className="block h-[9px] w-[9px] rounded-full bg-accent" />}
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-[26px] w-[48px] shrink-0 rounded-full border transition-colors",
        checked ? "border-accent bg-accent" : "border-line-2 bg-surface-3",
      )}
    >
      <span
        className={cx(
          "absolute top-[3px] block h-[18px] w-[18px] rounded-full transition-all",
          checked ? "left-[26px] bg-accent-ink" : "left-[3px] bg-muted",
        )}
      />
    </button>
  );
}

/** A selectable row: the checkbox / radio card used across onboarding. */
export function OptionRow({
  selected,
  onClick,
  control,
  title,
  detail,
  trailing,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  control: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        "flex w-full items-center gap-3 rounded-[12px] border px-4 py-[14px] text-left transition-colors sm:px-5 sm:py-4",
        selected
          ? "border-accent bg-surface-2"
          : "border-line bg-surface-2 hover:border-line-2",
        className,
      )}
    >
      {control}
      <span className="min-w-0 flex-1">
        {/* `trailing` is an aside to the title, so it sits alongside once there
            is room. `detail` always reads as a second line under it. */}
        {trailing ? (
          <span className="sm:flex sm:items-start sm:gap-4">
            <span className="block min-w-0 flex-1 text-[16px] font-bold sm:text-[17px]">
              {title}
            </span>
            <span className="mt-1 block text-[14px] leading-[1.4] text-muted sm:mt-[2px] sm:max-w-[240px] sm:shrink-0 sm:text-left">
              {trailing}
            </span>
          </span>
        ) : (
          <span className="block text-[16px] font-bold sm:text-[17px]">
            {title}
          </span>
        )}
        {detail && (
          <span className="mt-1 block text-[14px] leading-[1.45] text-muted">{detail}</span>
        )}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  className,
  ...props
}: ComponentProps<"input"> & { label: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-2 block text-[14px] text-muted">{label}</span>
      <input
        className="w-full rounded-[10px] border border-line bg-surface px-4 py-[13px] text-[15px] text-ink outline-none transition-colors focus:border-accent"
        {...props}
      />
    </label>
  );
}

export function TextArea({
  className,
  ...props
}: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cx(
        "w-full resize-none rounded-[12px] border border-line bg-surface-2 px-5 py-4 text-[16px] leading-[1.55] text-ink outline-none transition-colors focus:border-accent",
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Indicators                                                                  */
/* -------------------------------------------------------------------------- */

export function StepBars({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex items-center gap-2" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cx(
            "block h-[3px] w-[40px] rounded-full transition-colors sm:w-[64px]",
            i < current ? "bg-accent" : "bg-line-2",
          )}
        />
      ))}
    </div>
  );
}

export function Chip({
  active,
  className,
  ...props
}: ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      className={cx(
        "rounded-[10px] border px-4 py-[9px] text-[14px] font-semibold transition-colors",
        active
          ? "border-accent text-ink"
          : "border-line text-ink-2 hover:border-line-2",
        className,
      )}
      {...props}
    />
  );
}

export function Dot({ tone }: { tone: "accent" | "muted" | "open" }) {
  if (tone === "open") {
    return (
      <span
        aria-hidden
        className="block h-[9px] w-[9px] shrink-0 rounded-full border border-muted-2"
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cx(
        "block h-[9px] w-[9px] shrink-0 rounded-full",
        tone === "accent" ? "bg-accent" : "bg-muted-2",
      )}
    />
  );
}

export function CheckSeal({ size = 88 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="flex items-center justify-center rounded-[16px] border border-accent"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" fill="none" style={{ width: size * 0.34 }}>
        <path
          d="M4 12.6 9.2 17.8 20 6.6"
          stroke="var(--app-accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
