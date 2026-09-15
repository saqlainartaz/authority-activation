"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * "Start a post" opens Compose. That is the whole job.
 *
 * It used to mint a `provisioning_key` and carry it in the URL, from the era when
 * Compose consumed that key to create a durable content item on arrival. Phase 8
 * moved creation to the first chat turn, and nothing has read the key since —
 * `compose/page.tsx` only ever deleted it. So the key, the `topic` param beside
 * it, and the `useIdempotencyKey` ceremony around both were guarding a value no
 * server ever saw.
 *
 * The ceremony was not harmless. It carried an `inFlight` ref that was set true
 * and never reset, and because the Sidebar lives in the app shell and never
 * remounts, ONE click left every "Start a post" button in the app dead until a
 * reload. Deleting the reason for the guard deletes the guard.
 *
 * Starting a new conversation is a different action and lives inside Compose,
 * where the server's `start_new_post` command owns it.
 */
export function useStartPost() {
  const router = useRouter();
  return useCallback(() => {
    router.push("/compose");
  }, [router]);
}
