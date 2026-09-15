import Link from 'next/link';

const PILLARS = [
  {
    title: '감이 아니라 구조로 분석',
    caption: 'AI Formalization',
    desc: '자연어로 적힌 규칙과 기획 의도를 사람이 구조화된 스펙으로 정리해, 컴퓨터가 검사할 수 있게 만드는 방법론입니다 (이 데모에서는 미리 이렇게 정리해 뒀습니다 — 자연어 자동 변환기는 아직 없습니다)',
  },
  {
    title: '빠짐없이 다 뒤짐',
    caption: 'Bounded Exhaustive Search',
    desc: '정해진 범위 안에서 가능한 모든 행동 순서를 하나도 빠뜨리지 않고 검사합니다',
  },
  {
    title: '실제로 실행해서 확인',
    caption: 'Deterministic Simulation',
    desc: '규칙을 실제 코드처럼 실행한 결과이지, AI의 추측이 아닙니다',
  },
  {
    title: '무한한 경우의 수를 유한하게',
    caption: 'Finite Abstraction',
    desc: '금액·순서가 무한히 다양해도, 의미 있는 경우의 수로 압축해 다룰 수 있게 만듭니다',
  },
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
        데모로 실제 반례 찾아보기
      </Link>
      <p className="mt-2 text-xs text-neutral-500">
        지금은 샘플 시나리오 1개로 데모합니다. 내 규칙 입력 기능은 준비 중입니다.
      </p>
      <ul className="mt-16 grid grid-cols-2 gap-4">
        {PILLARS.map((p) => (
          <li key={p.title} className="rounded border border-neutral-800 p-4">
            <p className="font-medium text-emerald-400">{p.title}</p>
            <p className="mt-1 text-sm text-neutral-400">{p.desc}</p>
            <p className="mt-2 text-xs text-neutral-600">{p.caption}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
