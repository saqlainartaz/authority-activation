/**
 * Copy text from a user gesture, with a fallback for browsers and embedded
 * contexts where the asynchronous Clipboard API is unavailable or denied.
 */
export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Continue to the selection-based fallback below.
    }
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard access is unavailable.");
  }

  const activeElement = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.setAttribute("aria-hidden", "true");
  field.style.position = "fixed";
  field.style.inset = "0 auto auto -9999px";
  field.style.opacity = "0";
  document.body.appendChild(field);

  try {
    field.focus();
    field.select();
    field.setSelectionRange(0, field.value.length);
    if (!document.execCommand("copy")) {
      throw new Error("The browser refused clipboard access.");
    }
  } finally {
    field.remove();
    activeElement?.focus();
  }
}
