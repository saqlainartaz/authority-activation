"use client";

import { useEffect, type RefObject } from "react";

/**
 * A composer grows with its text and stops at a ceiling, then scrolls.
 *
 * Two screens ask a client to type a request — Home and Compose — and they have
 * to feel like the same control, so the sizing rule lives here rather than
 * being written twice and drifting. The ceiling is a share of the viewport, not
 * a fixed pixel count, so a phone and a desktop each get a sensible number of
 * lines; it is recomputed on resize because rotating a phone changes the share.
 */
export function useAutoGrow(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;

    const fit = () => {
      const ceiling = Math.min(Math.round(window.innerHeight * 0.4), 420);
      // Reset first: scrollHeight only shrinks back if the box is not already
      // holding the taller height from the previous keystroke.
      node.style.height = "auto";
      node.style.height = `${Math.min(node.scrollHeight, ceiling)}px`;
      node.style.overflowY = node.scrollHeight > ceiling ? "auto" : "hidden";
    };

    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [ref, value]);
}
