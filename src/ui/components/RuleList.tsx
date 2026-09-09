import type { RulesSpec } from '../../domain/types';

export function RuleList({ rules }: { rules: RulesSpec }) {
  return (
    <ul className="space-y-2">
      {rules.rules.map((r) => (
        <li key={r.id} className="rounded border border-neutral-800 p-3 text-sm">
          <div className="font-medium text-emerald-400">{r.id}</div>
          <div className="text-neutral-400">on {r.trigger.type}</div>
          <div className="mt-1 text-neutral-300">
            {r.conditions.length > 0 && <span>if {r.conditions.length} condition(s) · </span>}
            {r.effects.map((e) => e.primitive).join(', ')}
          </div>
        </li>
      ))}
    </ul>
  );
}
