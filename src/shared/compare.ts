export type Comparable = number | string | boolean;

/**
 * Shared comparison used by both the rule-condition evaluator (`expr.ts`) and the
 * invariant evaluator (`invariants/evaluate.ts`).
 *
 * `eq`/`ne` work on any type. Ordering (`lt`/`gt`/`lte`/`gte`) requires both
 * operands to be numbers — otherwise a malformed spec (e.g. comparing a string
 * field with `lt`) would silently coerce to `NaN` and manufacture a bogus result.
 */
export function compare(op: string, l: Comparable, r: Comparable): boolean {
  switch (op) {
    case 'eq':
      return l === r;
    case 'ne':
      return l !== r;
    case 'gte':
    case 'lte':
    case 'gt':
    case 'lt': {
      if (typeof l !== 'number' || typeof r !== 'number') {
        throw new Error(
          `compare: ${op} requires numeric operands, got ${typeof l} and ${typeof r}`,
        );
      }
      if (op === 'gte') return l >= r;
      if (op === 'lte') return l <= r;
      if (op === 'gt') return l > r;
      return l < r;
    }
    default:
      throw new Error(`compare: unknown op ${op}`);
  }
}
