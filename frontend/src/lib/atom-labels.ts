import type { AtomType } from "@/lib/product";

// The client-facing name for every M1 atom type.
//
// D7B-16 makes this an explicit OPERATOR OVERRIDE POINT: review this table
// rather than deriving a label from an internal engine name. Two engine types
// deliberately map to Constraints because that screen groups them by origin,
// not type. Goals is a shipped category with no atom type behind it, so it is
// inert under D7B-19 until the engine grows one. Keeping those asymmetries here
// prevents a later "one type per category" cleanup from changing the product.

/** Total over the nine `M1_ATOM_TYPES`; a missing entry is a TypeScript error. */
export const ATOM_TYPE_LABELS: Readonly<Record<AtomType, string>> = {
  tldr: "Business model",
  insight: "Brand strategy",
  proof_point: "Evidence",
  pain_point: "Audience",
  objection: "Sales strategy",
  quote: "Voice",
  terminology: "Products & offers",
  voice_constraint: "Constraints",
  claims_blacklist: "Constraints",
};

/**
 * Stop engine vocabulary at the BFF boundary. The fallback is intentionally
 * generic: a newly shipped backend type must not leak its raw name before this
 * reviewed table is extended.
 */
export function labelForAtomType(atomType: string): string {
  return ATOM_TYPE_LABELS[atomType as AtomType] ?? "Uncategorised material";
}

/** Merge the deliberate two-types-to-Constraints pairing without losing counts. */
export function labelAtomCounts(atomCounts: Record<string, number>): Record<string, number> {
  return Object.entries(atomCounts).reduce<Record<string, number>>((labels, [atomType, count]) => {
    const label = labelForAtomType(atomType);
    labels[label] = (labels[label] ?? 0) + count;
    return labels;
  }, {});
}

/** A play needs each client-facing category only once, even if two types map there. */
export function labelMissingAtomTypes(atomTypes: readonly string[]): string[] {
  return [...new Set(atomTypes.map(labelForAtomType))];
}
