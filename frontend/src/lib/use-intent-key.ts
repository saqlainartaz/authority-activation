"use client";

import { useState } from "react";

import { IntentKeyHolder } from "@/lib/intent-key";

/** One operator action's intent key, kept in component state for the life of
 *  the component. Each mutation takes its own instance; the rules live in
 *  `IntentKeyHolder` and `withIntentKey`. */
export function useIntentKey(): IntentKeyHolder {
  const [holder] = useState(() => new IntentKeyHolder());
  return holder;
}
