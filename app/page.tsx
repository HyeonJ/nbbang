import Link from 'next/link';

const STEPS = [
  {
    no: '01',
    title: '걷는다',
    body: '월 회차를 만들고 납부를 체크한다. 미납자 명단은 카톡에 붙여넣을 수 있는 텍스트로 나온다.',
  },
  {
    no: '02',
    title: '쓴다',
    body: '지출을 기록한다. 잘못 적었으면 지우지 않고 역분개로 정정한다 — 장부는 고쳐 쓰지 않는다.',
  },
  {
    no: '03',
    title: '나눈다',
    body: '회식비를 엔빵하면 누가 누구에게 얼마를 보낼지 최소 송금 횟수로 계산해준다.',
  },
];

export default function Home() {
  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-5 pb-20">
      <header className="flex items-center justify-between border-b-2 border-ink py-4">
        <span className="font-display text-lg font-bold tracking-tight">엔빵</span>
        <span className="font-display text-[11px] font-medium tracking-[0.18em] text-muted uppercase">
          Group Dues Ledger
        </span>
      </header>

      <section className="border-b-2 border-ink py-14">
        <h1 className="text-3xl leading-[1.35] font-black tracking-tight sm:text-4xl sm:leading-[1.3]">
          모임 회비,
          <br />
          <span className="border-b-4 border-accent">엑셀 스크린샷</span>은 이제 그만.
        </h1>
        <p className="mt-6 max-w-xl leading-[1.85] text-muted">
          동호회·스터디 총무를 위한 회비 장부입니다. 걷고, 쓰고, 나누고, 링크 하나로 투명하게 공개하세요.
          멤버는 가입하지 않아도 장부를 볼 수 있습니다.
        </p>
        <Link
          href="/groups"
          className="mt-9 inline-block bg-ink px-7 py-3.5 text-[15px] font-bold tracking-[0.06em] text-paper"
        >
          모임 만들기 →
        </Link>
      </section>

      <section className="grid sm:grid-cols-3">
        {STEPS.map((s) => (
          <article key={s.no} className="border-b border-hairline py-7 sm:border-b-0 sm:pr-6 sm:last:pr-0">
            <span className="font-display text-[11px] font-bold tracking-[0.18em] text-accent-deep">{s.no}</span>
            <h2 className="mt-2 text-lg font-bold">{s.title}</h2>
            <p className="mt-2 text-[14px] leading-[1.8] text-muted">{s.body}</p>
          </article>
        ))}
      </section>

      <section className="mt-4 border-t-2 border-ink pt-7">
        <p className="text-[14px] leading-[1.85] text-muted">
          모든 금액 변동은 지울 수 없는 기록으로 남습니다. 잔액은 저장된 숫자가 아니라 기록을 합산한
          결과라서, 장부와 잔액이 어긋날 수가 없습니다.
        </p>
      </section>

      <footer className="mt-14 flex items-center justify-between gap-4 border-t border-hairline pt-5 text-[12px] text-muted">
        <span className="font-display tracking-[0.1em]">NBBANG</span>
        <span className="flex items-center gap-4">
          <Link href="/privacy" className="underline underline-offset-4 hover:text-accent-deep">
            개인정보처리방침
          </Link>
          <a
            href="https://github.com/HyeonJ/nbbang"
            target="_blank"
            rel="noopener"
            className="underline underline-offset-4 hover:text-accent-deep"
          >
            GitHub
          </a>
        </span>
      </footer>
    </main>
  );
}
