/**
 * 공개 장부의 404. **모임의 존재 여부를 알려주지 않는다** — 없는 토큰과 재발급된 토큰이
 * 글자 하나까지 같은 화면을 받아야 한다. 레이트 리밋이 없는 v1에서 탐색에 정보를 주지 않는 것이
 * 토큰 엔트로피(128비트) 다음의 방어선이다(플랜 Step 1.5).
 *
 * 로그인 유도·모임 목록 링크를 두지 않는다. 이 화면을 보는 사람은 이 앱의 사용자가 아닐 수 있다.
 */
export default function PublicLedgerNotFound() {
  return (
    <main className="mx-auto max-w-3xl px-5 pb-20">
      <header className="flex items-baseline justify-between border-b-2 border-ink py-4">
        <span className="font-display text-lg font-bold tracking-tight">엔빵</span>
        <span className="font-display text-[11px] font-medium tracking-[0.18em] text-muted uppercase">
          Group Dues Ledger
        </span>
      </header>
      <p className="py-10 text-[14px] leading-[1.85] text-muted">
        열 수 없는 링크입니다. 주소가 잘못되었거나, 총무가 링크를 재발급했을 수 있습니다.
      </p>
    </main>
  );
}
