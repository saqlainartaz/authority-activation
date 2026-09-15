import { ATOM_TYPE_LABELS } from "@/lib/atom-labels";

export type GroundingGap = {
  atom_count: number;
  grounded_type_count: number;
  missing_type_count: number;
  total_type_count: number;
  completeness_percent: number;
};

/** Computes the reviewed nine-type grounding measure from raw engine counts. */
export function computeGroundingGap(
  atomCounts: Readonly<Record<string, number>>,
): GroundingGap {
  const types = Object.keys(ATOM_TYPE_LABELS);
  let atomCount = 0;
  let groundedTypeCount = 0;
  for (const type of types) {
    const count = atomCounts[type];
    if (!Number.isFinite(count) || count <= 0) continue;
    atomCount += count;
    groundedTypeCount += 1;
  }
  const totalTypeCount = types.length;
  return {
    atom_count: atomCount,
    grounded_type_count: groundedTypeCount,
    missing_type_count: totalTypeCount - groundedTypeCount,
    total_type_count: totalTypeCount,
    completeness_percent: Math.max(0, Math.min(100, Math.round((groundedTypeCount / totalTypeCount) * 100))),
  };
}
