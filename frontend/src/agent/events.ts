import "server-only";

/**
 * The server-side door to the event union, which now lives in
 * `src/lib/agent-events.ts` — see that file for why.
 *
 * This module exists so `route.ts`, `turn.ts` and `stream.ts` keep importing
 * `@/agent/events` exactly as they did, and so `check:agent-server-only`
 * keeps finding a `server-only` import in every module under `src/agent/`.
 * It intentionally holds no definitions of its own.
 */
export * from "@/lib/agent-events";
