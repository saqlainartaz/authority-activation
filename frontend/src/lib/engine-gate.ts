// The single import point Cycle 5 frontend code uses to ask "does this
// deployment run the rehaul engine?" (Task P0.3). Both helpers delegate to
// the switches that already exist — `lib/product.ts`'s `usesKnowledgeEngine`
// (client identity, from `GET /v1/me`) and `lib/engine.ts`'s
// `deploymentUsesKnowledgeEngine` (operator/service key, from `GET /v2/engine`)
// — rather than repeating either check. No new behaviour beyond delegating.

import "server-only";

import { deploymentUsesKnowledgeEngine } from "@/lib/engine";
import { getMe, usesKnowledgeEngine } from "@/lib/product";

/** Whether the rehaul engine serves this client, by their own identity. */
export async function rehaulEnabledForClient(token: string): Promise<boolean> {
  return usesKnowledgeEngine(await getMe(token));
}

/** Whether the deployment runs the rehaul engine, as the operator sees it
 * (service key only, no client identity — see `deploymentUsesKnowledgeEngine`). */
export async function rehaulEnabledForOperator(): Promise<boolean> {
  return deploymentUsesKnowledgeEngine();
}
