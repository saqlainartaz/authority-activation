"use client";

import { cx } from "./primitives";

/**
 * Loading placeholders. They pulse rather than shimmer — a sweep needs a
 * gradient, and this design has none.
 */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      aria-hidden
      className={cx("pulse-soft block rounded-[6px] bg-surface-3", className)}
      style={style}
    />
  );
}

/** A few lines of fake copy, the last one short like real text. */
export function SkeletonLines({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <span className={cx("block space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className="h-[13px]"
          style={{
            width: i === lines - 1 ? "58%" : "100%",
            animationDelay: `${i * 120}ms`,
          }}
        />
      ))}
    </span>
  );
}

/** The post card, before it arrives. */
export function SkeletonPostCard({ delay = 0 }: { delay?: number }) {
  return (
    <div className="min-w-0 rounded-[14px] border border-line bg-surface-2 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <Skeleton className="h-11 w-11 rounded-full" style={{ animationDelay: `${delay}ms` }} />
        <div className="min-w-0 flex-1 space-y-2 pt-1">
          <Skeleton className="h-[14px] w-32" style={{ animationDelay: `${delay + 80}ms` }} />
          <Skeleton className="h-[12px] w-56" style={{ animationDelay: `${delay + 160}ms` }} />
        </div>
        <Skeleton className="h-[26px] w-24 rounded-[8px]" style={{ animationDelay: `${delay + 240}ms` }} />
      </div>

      <div className="mt-5 space-y-2.5">
        {[100, 96, 88, 62].map((width, index) => (
          <Skeleton
            key={index}
            className="h-[13px]"
            style={{ width: `${width}%`, animationDelay: `${delay + 320 + index * 90}ms` }}
          />
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
        <span className="flex gap-5">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton
              key={index}
              className="h-[19px] w-[19px] rounded-[5px]"
              style={{ animationDelay: `${delay + 680 + index * 70}ms` }}
            />
          ))}
        </span>
        <Skeleton className="h-[13px] w-16" style={{ animationDelay: `${delay + 960}ms` }} />
      </div>
    </div>
  );
}

/** Screen-reader announcement while a region is loading. */
export function LoadingRegion({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading">
      {children}
    </div>
  );
}
