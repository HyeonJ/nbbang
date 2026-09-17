import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicLedger, type PublicLedgerEntry } from '@/lib/db/public-queries';
import { formatDateKst } from '@/lib/format';
import { Amount } from '@/components/ui/amount';
import { Cell, DataTable, Row } from '@/components/ui/data-table';

/**
 * 공개 장부(F5) — **인증 없이** 링크만으로 열리는 유일한 라우트.
 *
 * ── 이 파일을 고칠 때의 규칙 ────────────────────────────────────────────────
 *  1. 데이터는 `lib/db/public-queries.ts`에서만 온다. `lib/db/queries.ts`를 부르지 말 것 —
 *     그쪽은 행 전체(토큰 포함)를 돌려주고, 여기서는 반환값이 그대로 렌더 출력과
 *     flight 페이로드로 나간다.
 *  2. **서드파티 리소스 금지** — 애널리틱스·외부 폰트·외부 이미지를 넣지 않는다.
 *     외부 요청 하나가 `Referer`로 토큰 URL을 실어 나른다. (루트 레이아웃의 폰트는
 *     `next/font`라 빌드 시 자기 호스트로 내려받아 `/_next/static`에서 서빙된다 — 외부 요청 없음.
 *     `e2e/public-ledger.spec.ts`가 외부 호스트 요청 0건을 단언해 이 성질을 고정한다.)
 *  3. 쓰기 UI·로그인 유도·관리 링크를 두지 않는다. 이 화면의 권한은 "링크 보유" 하나뿐이다.
 *  4. 클라이언트 컴포넌트에 prop을 넘길 일이 생기면 **무엇을 넘기는지** 먼저 확인할 것.
 *     서버 지역 변수가 저절로 새지는 않지만, 직렬화된 prop은 확실하게 샌다.
 */

/**
 * 캐시 금지. 토큰을 재발급하면 옛 링크가 **즉시** 죽어야 한다 — 어딘가에 저장된 응답이
 * 살아 있으면 "재발급했으니 안전하다"가 거짓이 된다.
 *
 * 실제로 일하는 것이 무엇인지 구별해 적어둔다(2026-09-15 실측):
 *  - `dynamic = 'force-dynamic'` — 매 요청 SSR. 빌드 출력에서 이 라우트가 `ƒ`(Dynamic)로
 *    찍히는 것이 증거다. Next의 렌더 캐시를 끄는 실질적 장치.
 *  - **응답 헤더 `Cache-Control: private, no-store`** — CDN·브라우저·중간 프록시를 막는
 *    유일한 수단이다. Next 내부 설정은 이들에게 보이지 않는다. `next.config.ts`의
 *    `headers()`가 `/g/:token*`에 건다.
 *  - `revalidate = 0` — force-dynamic과 겹치지만 의도를 명시적으로 남긴다.
 *  - `fetchCache = 'force-no-store'` — **이 라우트에서는 아무 일도 하지 않는다.** 이 설정은
 *    세그먼트 안의 `fetch()` 호출만 지배하는데, `lib/db/index.ts`는 `neon-serverless`
 *    (WebSocket Pool)를 쓰므로 DB 왕복이 `fetch()`를 거치지 않는다(neon-http였다면 지배했다).
 *    플랜은 이것을 캐시 방어 3종의 하나로 적었지만 실제 방어는 위의 둘이다. 빌드가 받아들이고
 *    해가 없으므로 남겨두되, **이 줄을 캐시 방어로 믿지 말 것**.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

// 헤더(X-Robots-Tag)와 중복이지만 둘 다 둔다 — 크롤러가 어느 쪽을 보든 걸리게.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/**
 * 원장 한 행의 이름표. 공개 장부는 **원장을 그대로** 보여주므로 REVERSAL도 한 행을 차지한다.
 * 회비 납부는 메모가 없는 대신 종류로 읽히게 한다.
 */
function labelOf(e: PublicLedgerEntry): string {
  if (e.type === 'REVERSAL') return '정정';
  if (e.memo) return e.memo;
  if (e.category) return e.category;
  return e.type === 'DUES_PAYMENT' ? '회비 납부' : '지출';
}

export default async function PublicLedgerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const ledger = await getPublicLedger(token);
  // 토큰이 틀리면 404 하나뿐 — 모임이 있는지 없는지는 어느 쪽으로도 알려주지 않는다.
  if (!ledger) notFound();

  const { groupName, balance, entries, members } = ledger;

  /**
   * 정정된 원본의 id 집합.
   *
   * ⚠️ 지출·회차 화면은 REVERSAL을 원본 행에 **접어 넣는다**(direction.md Q3 = B).
   * 이 화면만 예외로 A를 쓴다 — 원본과 정정을 **둘 다 행으로** 보여준다. 목적이 다르기 때문이다:
   * 저 화면들의 목적은 "지금 얼마 썼나"이고, 이 화면의 목적은 **검증**이다. 접어 넣으면
   * 보는 사람이 "총무가 뭘 지웠나"를 확인할 수 없고, 그러면 공개 장부의 존재 이유가 사라진다.
   */
  const reversedIds = new Set(entries.filter((e) => e.reversalOf).map((e) => e.reversalOf!));

  return (
    <main className="mx-auto max-w-3xl px-5 pb-20">
      <header className="flex items-baseline justify-between border-b-2 border-ink py-4">
        <h1 className="text-xl font-black tracking-tight" data-testid="public-group-name">
          {groupName}
        </h1>
        <span className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">
          Public Ledger
        </span>
      </header>

      <section className="border-b-2 border-ink py-7">
        <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">현재 잔액</h2>
        <p className="mt-1" data-testid="public-balance">
          {/* tone='plain' — 이 자리의 숫자는 "들어온 돈"이 아니라 잔액이다. 오렌지는 한 화면에
              한 가지 의미만 갖는다(direction.md 형태 규칙). */}
          <Amount value={balance} size="xl" unit tone="plain" />
        </p>
        <p className="mt-4 text-[13px] leading-[1.8] text-muted">
          이 장부는 <b className="font-bold text-ink">링크를 가진 사람만</b> 볼 수 있습니다. 로그인은
          필요하지 않으며, 링크 자체가 유일한 접근 수단입니다. 총무가 링크를 재발급하면 이 주소는 즉시
          열리지 않습니다.
        </p>
      </section>

      <section className="border-b-2 border-ink py-7">
        <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">
          멤버 {members.length}명
        </h2>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {members.map((m, i) => (
            // 표시 이름은 모임 안에서 유일하지 않을 수 있어 index를 함께 키로 쓴다.
            <li key={`${m.displayName}-${i}`} className="text-[14px]" data-testid="public-member">
              {m.displayName}
              {m.role === 'owner' ? <span className="text-[12px] text-muted"> · 총무</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="pt-7">
        <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">
          전체 기록 {entries.length}건
        </h2>
        <p className="mt-2 text-[12px] leading-[1.7] text-muted">
          기록은 지워지지 않습니다. 잘못 적은 항목은 삭제 대신 정정 기록이 한 줄 더 쌓이며, 이 표에는
          원본과 정정이 모두 남습니다.
        </p>
        <div className="mt-4">
          <DataTable>
            {entries.length === 0 ? (
              <Row>
                <Cell className="text-muted">아직 기록이 없습니다.</Cell>
              </Row>
            ) : (
              entries.map((e) => {
                const isReversal = e.type === 'REVERSAL';
                const struck = reversedIds.has(e.id) ? 'text-muted line-through' : '';
                return (
                  <Row key={e.id} testId="public-entry-row">
                    <Cell className="num w-[92px] align-top text-muted">
                      {formatDateKst(e.occurredAt)}
                    </Cell>
                    <Cell className="align-top">
                      {/* 정정 행은 화살표로 원본에 딸린 줄임을 보인다 — 접지 않되 읽기는 도와준다. */}
                      {isReversal ? <span className="text-muted">↳ </span> : null}
                      <span className={struck}>{labelOf(e)}</span>
                      {e.memo && e.category ? (
                        <span className={`ml-2 text-[12px] text-muted ${struck}`}>{e.category}</span>
                      ) : null}
                      {reversedIds.has(e.id) ? (
                        <span className="font-display ml-2 border border-ink px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-[0.1em]">
                          정정됨
                        </span>
                      ) : null}
                    </Cell>
                    <Cell align="right" className="align-top">
                      <span className={reversedIds.has(e.id) ? 'line-through opacity-45' : ''}>
                        <Amount value={e.amount} size="md" showSign />
                      </span>
                    </Cell>
                  </Row>
                );
              })
            )}
          </DataTable>
        </div>
      </section>

      <footer className="mt-14 flex items-center justify-between gap-4 border-t border-hairline pt-5 text-[12px] text-muted">
        <span className="font-display tracking-[0.1em]">NBBANG</span>
        {/* 제품 유입과 처리방침. 둘 다 같은 출처라 외부 요청이 아니고, Referrer-Policy: no-referrer가
            이 클릭에서 토큰 URL이 Referer로 나가는 것을 막는다.
            ⚠️ 처리방침 페이지(`app/privacy/page.tsx`)에 외부 폰트·이미지를 넣으면 이 링크를 타고 간
            화면에서 외부 요청이 생긴다 — `e2e/public-ledger.spec.ts`가 그 페이지의 외부 요청 0건도
            함께 단언한다(리뷰 MINOR 21). */}
        <span className="flex items-center gap-4">
          <Link href="/privacy" className="underline underline-offset-4 hover:text-accent-deep">
            개인정보처리방침
          </Link>
          <Link href="/" className="underline underline-offset-4 hover:text-accent-deep">
            엔빵으로 만든 장부입니다
          </Link>
        </span>
      </footer>
    </main>
  );
}
