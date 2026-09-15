import type { Ledger } from '../../domain/types';
import { LEDGER_FIELD_LABELS } from '../lib/labels';

export function StateDeltaTable({ rows }: { rows: { key: string; before: number; after: number }[] }) {
  if (rows.length === 0) return <p className="text-xs text-neutral-500">원장 변화 없음</p>;
  return (
    <table className="mt-2 text-xs">
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="pr-4 text-neutral-400">{LEDGER_FIELD_LABELS[r.key as keyof Ledger] ?? r.key}</td>
            <td className="pr-2 text-neutral-500">{r.before.toLocaleString()}</td>
            <td className="pr-2 text-neutral-600">→</td>
            <td className="text-emerald-400">{r.after.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
