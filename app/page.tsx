import Link from 'next/link';

const PILLARS = [
  ['AI Formalization', '자연어 규칙·의도를 구조화된 스펙으로'],
  ['Finite Abstraction', '무한 입력 공간을 의미 있는 유한 상태로'],
  ['Deterministic Simulation', '규칙을 실제로 실행'],
  ['Bounded Exhaustive Search', '경계 안의 모든 reachable state 검사'],
];

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-4xl font-semibold leading-tight">
        이벤트는 정상 사용자를 기준으로 테스트합니다.
        <br />
        <span className="text-neutral-400">어뷰저는 정상적으로 사용하지 않습니다.</span>
      </h1>
      <p className="mt-6 text-neutral-300">
        RuleStress는 이벤트 규칙과 기획 의도를 구조화하고, 가능한 행동 순서를 직접 시뮬레이션해
        예상하지 못한 허점을 출시 전에 찾아냅니다.
      </p>
      <Link
        href="/simulate"
        className="mt-8 inline-block rounded bg-emerald-500 px-5 py-2.5 font-medium text-neutral-950"
      >
        내 이벤트 스트레스 테스트하기
      </Link>
      <ul className="mt-16 grid grid-cols-2 gap-4">
        {PILLARS.map(([t, d]) => (
          <li key={t} className="rounded border border-neutral-800 p-4">
            <p className="font-medium text-emerald-400">{t}</p>
            <p className="mt-1 text-sm text-neutral-400">{d}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
