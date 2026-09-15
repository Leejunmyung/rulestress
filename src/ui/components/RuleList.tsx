import type { RulesSpec } from '../../domain/types';
import { EVENT_LABELS, PRIMITIVE_LABELS, ruleLabel } from '../lib/labels';

export function RuleList({ rules }: { rules: RulesSpec }) {
  return (
    <ul className="space-y-2">
      {rules.rules.map((r) => (
        <li key={r.id} className="rounded border border-neutral-800 p-3 text-sm">
          <div className="font-medium text-emerald-400">{ruleLabel(r.id)}</div>
          <div className="text-neutral-500">{EVENT_LABELS[r.trigger.type]}</div>
          <div className="mt-1 text-neutral-300">
            {r.conditions.length > 0 && <span>조건 {r.conditions.length}개 충족 시 · </span>}
            {r.effects.map((e) => PRIMITIVE_LABELS[e.primitive]).join(', ')}
          </div>
        </li>
      ))}
    </ul>
  );
}
