"use client";

import toastr from "toastr";

/** Show a theme-styled, screen-reader-announced success confirmation. */
export function showSuccessToast(message: string): void {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  toastr.options = {
    closeButton: true,
    escapeHtml: true,
    extendedTimeOut: 1000,
    hideDuration: reduceMotion ? 0 : 180,
    hideMethod: reduceMotion ? "hide" : "fadeOut",
    newestOnTop: true,
    positionClass: "toast-top-right",
    preventDuplicates: true,
    progressBar: false,
    showDuration: reduceMotion ? 0 : 180,
    showMethod: reduceMotion ? "show" : "fadeIn",
    tapToDismiss: true,
    timeOut: 3200,
  };

  const toast = toastr.success(message);
  toast.attr("role", "status");
  toast.attr("aria-live", "polite");
  toast.attr("aria-atomic", "true");
}
