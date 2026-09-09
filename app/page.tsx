export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-3xl font-semibold">RuleStress</h1>
      <p className="mt-4 text-neutral-400">Break your promotion before users do.</p>
      <a href="/simulate" className="mt-8 inline-block rounded bg-emerald-500 px-4 py-2 font-medium text-neutral-950">
        내 이벤트 스트레스 테스트하기
      </a>
    </main>
  );
}
