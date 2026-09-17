import type { ReactNode } from 'react';
import { Cell, DataTable, Row } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/page-header';

/**
 * 개인정보처리방침 — **서비스 정책**이다(플랜 Task 4 / 외부 리뷰 MINOR 24).
 *
 * ── 이 문서를 "법적 형식을 갖춘"이라고 부르지 않는다 ─────────────────────────
 * 법률 자문을 거치지 않았으므로 그렇게 단정할 수 없다. 이 페이지가 주장하는 것은 하나다:
 * **여기 적힌 내용이 이 레포의 코드가 실제로 하는 일과 일치한다.**
 *
 * ── 그래서 이 파일은 명세를 베낀 것이지 홍보 문구가 아니다 ────────────────────
 * 각 문단의 출처를 여기 적어 둔다. 코드가 바뀌면 이 페이지도 같이 바뀌어야 한다.
 *  - 수집 항목·보관기간   → `lib/client-ip.ts`(IP HMAC) · `app/api/cron/cleanup/route.ts`(48시간)
 *                          · `lib/db/auth-schema.ts`(session.ip_address·user_agent) · `lib/auth.ts`
 *  - 탈퇴 시 파기·보존    → `lib/db/anonymize.ts` + `docs/adr/004-deletion-semantics.md`
 *  - 모임 삭제            → `lib/db/delete.ts`
 *  - 공개 장부 노출 범위  → `lib/db/public-queries.ts` · `middleware.ts`(분당 60회)
 *
 * ⚠️ **"24시간"이라고 적지 않는다.** Vercel Hobby는 1일 1회 크론이 최소이고 실행 시각이
 * ±59분, 배달이 best effort다. 임계값 1시간 + 최악의 다음 실행 ≈ 26시간이고, 한 번의 실행
 * 누락까지 감안한 정직한 상한이 **48시간**이다(`app/api/cron/cleanup/route.ts`의 계산).
 *
 * ⚠️ **"평문 IP를 저장하지 않는다"고 적지 않는다.** 레이트 리밋 버킷은 HMAC이지만,
 * 로그인 **세션 행**에는 Better Auth가 접속 IP와 User-Agent를 평문으로 적는다
 * (`internal-adapter.mjs`: `ipAddress: getIP(headers, options)`). 실측으로 확인했고
 * (dev DB의 session 27행 전부 `ip_address`·`user_agent`가 채워져 있다) 아래 표에 그대로 적었다.
 *
 * ⚠️ 외부 리소스를 넣지 않는다 — 공개 장부 푸터에서 이 페이지로 오는 링크가 있으므로,
 * 여기에 원격 폰트·이미지를 붙이면 그 요청의 `Referer`로 장부 토큰이 나갈 표면이 생긴다.
 * `e2e/public-ledger.spec.ts`가 이 페이지의 외부 호스트 요청 0건을 단언한다(리뷰 MINOR 21).
 */

export const metadata = { title: '개인정보처리방침' };

/** 시행일. 내용을 고치면 이 값도 함께 고친다. */
const EFFECTIVE_DATE = '2026년 9월 17일';

const H2 = 'font-display text-[12px] font-bold tracking-[0.14em] text-ink uppercase';
const BODY = 'text-[14px] leading-[1.85] text-muted';
const NOTE = 'text-[13px] leading-[1.8] text-muted';

/**
 * 표 한 줄 — 왼쪽에 항목·설명, 오른쪽에 처리·보관.
 *
 * 좁은 화면(<640px)에서는 **두 칸을 쌓는다**. 390px에서 2열을 유지하면 오른쪽 칸 폭이
 * 100px 남짓으로 줄어 "탈퇴 시 파기"가 한 단어씩 끊어진다 — 표가 정보를 주는 게 아니라
 * 읽기를 방해하는 상태가 된다(실측 후 수정).
 */
function Line({ term, detail, value }: { term: string; detail?: ReactNode; value: ReactNode }) {
  return (
    <Row className="block sm:table-row">
      <Cell className="block pb-0 align-top sm:table-cell sm:pb-3">
        <span className="font-bold text-ink">{term}</span>
        {detail ? <span className="mt-1 block text-[13px] leading-[1.7] text-muted">{detail}</span> : null}
      </Cell>
      {/* 좁은 화면에서는 값이 설명 바로 아래 같은 모양으로 놓여 둘이 구별되지 않는다 —
          값만 잉크색으로 둔다. 2열로 돌아가면(≥640px) 오른쪽 칸이라는 위치가 이미 구별을
          해 주므로 원래의 muted로 되돌린다. */}
      <Cell className="block pt-1 text-[13px] leading-[1.7] text-ink sm:table-cell sm:w-[38%] sm:pt-3 sm:pl-4 sm:text-right sm:align-top sm:text-muted">
        {value}
      </Cell>
    </Row>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b-2 border-ink py-9">
      <h2 className={H2}>{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 pb-20">
      <PageHeader back="/" title="개인정보처리방침" />

      <section className="border-b-2 border-ink py-9">
        <p className={BODY}>
          엔빵이 <b className="font-bold text-ink">무엇을 수집하고, 무엇을 지우고, 무엇이 남는지</b> 적은
          서비스 정책입니다. 법률 자문을 거친 문서가 아니라, 이 서비스의 코드가 실제로 하는 일을 그대로
          옮긴 문서입니다. 여기 적힌 내용과 코드가 어긋난다면 그것은 고쳐야 할 결함입니다.
        </p>
        <p className={`mt-4 ${NOTE}`}>시행일 · {EFFECTIVE_DATE}</p>
      </section>

      <Section title="수집하는 항목과 보관기간">
        <DataTable>
          <Line term="이메일" detail="계정 식별·로그인" value="탈퇴 시 파기" />
          <Line
            term="비밀번호"
            detail="로그인 인증. 해시만 저장하며 평문 비밀번호는 저장하지 않습니다."
            value="탈퇴 시 삭제"
          />
          <Line term="이름" detail="화면에 표시되는 계정 이름" value="탈퇴 시 파기" />
          <Line term="모임 표시 이름" detail="모임 안에서 쓰는 이름. 모임마다 따로 정합니다." value="탈퇴 시 파기" />
          <Line
            term="모임 활동 기록"
            detail="회비 회차·납부 여부·지출·정산과 직접 입력한 메모"
            value={
              <>
                모임이 삭제될 때까지
                <span className="mt-1 block">탈퇴해도 남습니다</span>
              </>
            }
          />
          <Line term="세션 쿠키" detail="로그인 상태 유지" value="기본 7일 · 로그아웃·탈퇴 시 무효" />
          <Line
            term="세션 기록"
            detail="접속 IP와 브라우저 정보(User-Agent). 로그인 세션마다 한 줄씩 남습니다."
            value="로그아웃·탈퇴 시 삭제"
          />
          <Line
            term="접속 IP의 해시값"
            detail="공개 장부 링크의 남용(반복 자동 수집) 방지"
            value="최대 48시간"
          />
        </DataTable>

        <ul className={`mt-6 space-y-3 ${NOTE}`}>
          <li>
            <b className="font-bold text-ink">IP 해시</b> — 남용 방지 카운터에는 IP를 그대로 적지 않고
            HMAC-SHA256의 앞 32자만 적습니다. 저장된 값에서 IP를 되돌릴 수 없습니다. 보관기간을
            &ldquo;24시간&rdquo;이 아니라 <b className="font-bold text-ink">최대 48시간</b>으로 적는 이유는,
            정리 작업이 하루 한 번 도는 예약 작업이고 실행 시각에 오차와 누락이 있을 수 있기 때문입니다.
            지킬 수 없는 숫자를 적는 것보다 실제 상한을 적는 편이 낫다고 판단했습니다.
          </li>
          <li>
            <b className="font-bold text-ink">세션 기록</b> — 로그인 세션을 만들 때 인증 라이브러리가 접속
            IP와 브라우저 정보를 세션 한 줄에 <b className="font-bold text-ink">그대로</b> 함께 적습니다.
            이 값은 그 세션에만 붙어 있고, 로그아웃하거나 탈퇴하면 세션 줄과 함께 사라집니다. 만료된
            세션은 더 이상 로그인에 쓰이지 않으며, 그 쿠키로 다시 접근하는 시점에 삭제됩니다.
          </li>
          <li>
            <b className="font-bold text-ink">쿠키</b> — 로그인 상태 유지 하나에만 씁니다. 광고·분석
            쿠키는 없고, 외부 분석 도구나 추적 스크립트를 붙이지 않습니다.
          </li>
        </ul>
      </Section>

      <Section title="이용 목적">
        <p className={BODY}>
          수집한 정보는 <b className="font-bold text-ink">서비스 제공</b>(계정·모임 장부 기능)과
          <b className="font-bold text-ink"> 남용 방지</b>(공개 장부 링크의 반복 자동 수집 차단) 두 가지에만
          씁니다. 광고·프로파일링에 쓰지 않으며, 판매하지 않습니다.
        </p>
      </Section>

      <Section title="탈퇴하면 지워지는 것">
        <p className={BODY}>
          계정 설정에서 탈퇴하면 아래 여덟 가지가 그 자리에서 파기됩니다. 되돌릴 수 없고 유예기간은
          없습니다.
        </p>
        <div className="mt-5">
          <DataTable>
            <Line term="이메일" value="실재하지 않는 임의 주소로 대체" />
            <Line term="이름" value="&lsquo;탈퇴한 사용자&rsquo;로 대체" />
            <Line term="프로필 이미지" value="삭제" />
            <Line term="비밀번호 해시" value="삭제" />
            <Line term="로그인 세션" detail="접속 IP·브라우저 정보를 포함합니다." value="삭제 · 즉시 로그아웃" />
            <Line term="이메일 인증·비밀번호 재설정 토큰" value="삭제" />
            <Line term="모임 표시 이름" value="&lsquo;탈퇴한 멤버&rsquo;로 대체" />
            <Line term="과거 정산에 굳어 있던 표시 이름" value="&lsquo;탈퇴한 멤버&rsquo;로 대체" />
          </DataTable>
        </div>
        <p className={`mt-5 ${NOTE}`}>
          이메일이 비워지므로 <b className="font-bold text-ink">같은 이메일로 다시 가입할 수 있습니다.</b>{' '}
          다시 가입하면 새 계정이며, 이전 모임·기록과 연결되지 않습니다.
        </p>
      </Section>

      <Section title="탈퇴해도 남는 것">
        <p className={BODY}>
          파기 범위는 위에 적은 <b className="font-bold text-ink">여덟 가지 구조화된 식별자</b>입니다. 그
          밖의 것은 남습니다. 숨기지 않고 적습니다.
        </p>
        <div className="mt-5">
          <DataTable>
            <Line
              term="모임의 금액 기록"
              detail="회비·지출·정산의 금액·날짜·이체 구조"
              value="그대로 남습니다"
            />
            <Line
              term="모임 멤버 자리"
              detail="이름만 바뀌고 줄은 남습니다. 지우면 그 사람이 냈던 회비가 &lsquo;미납&rsquo;으로 보이거나 없던 일이 됩니다."
              value="&lsquo;탈퇴한 멤버&rsquo;로 남습니다"
            />
            <Line
              term="내부 식별자"
              detail="계정 줄 자체는 지울 수 없습니다 — 모임 멤버십·장부 기록·정산이 이 줄을 참조하기 때문입니다."
              value="남습니다"
            />
            <Line
              term="직접 입력한 자유 텍스트"
              detail="지출 메모 · 입금 계좌 문구 · 정산 제목"
              value="그대로 남습니다"
            />
          </DataTable>
        </div>
        <ul className={`mt-6 space-y-3 ${NOTE}`}>
          <li>
            <b className="font-bold text-ink">내부 식별자</b> — 계정 줄에 남는 무작위 식별자(UUID)입니다.
            그 값 자체에는 개인정보가 들어 있지 않고 외부 시스템과 연결되지도 않지만, 탈퇴자의 과거 활동이
            하나의 값으로 계속 이어진다는 뜻이므로{' '}
            <b className="font-bold text-ink">&ldquo;연결할 수 없는 익명화&rdquo;는 아닙니다.</b> 이 한계를
            적어 두는 편이 &ldquo;완전히 익명화된다&rdquo;고 쓰는 것보다 정직하다고 판단했습니다.
          </li>
          <li>
            <b className="font-bold text-ink">자유 텍스트</b> — 지출 메모·입금 계좌 문구·정산 제목에 직접
            적은 글자는 파기 대상이 아닙니다. 거기에 이름·이메일·계좌번호를 적었다면{' '}
            <b className="font-bold text-ink">그 글자는 남습니다.</b> 글 안에서 개인정보를 찾아 지우는
            기능은 없습니다 — 남의 이름이나 모임 이름을 잘못 지우는 문제가 함께 따라오기 때문입니다.
            필요하면 탈퇴하기 전에 직접 고치거나, 총무라면 모임을 삭제하세요.
          </li>
          <li>
            <b className="font-bold text-ink">총무는 바로 탈퇴할 수 없습니다.</b> 소유한 모임이 있으면 그
            모임을 먼저 삭제해야 합니다. 총무를 다른 멤버에게 넘기는 기능은 아직 없습니다.
          </li>
        </ul>
      </Section>

      <Section title="모임을 삭제하면">
        <p className={BODY}>
          총무가 모임을 삭제하면 그 모임의 회비 회차·납부 기록·지출·정산·멤버 목록이 한 번에 삭제되고,
          그 모임의 공개 링크는 즉시 열리지 않습니다. 계정은 삭제되지 않습니다 — 모임을 지우는 것과
          탈퇴하는 것은 별개입니다.
        </p>
      </Section>

      <Section title="공개 장부 링크">
        <ul className={`space-y-3 ${BODY}`}>
          <li>
            총무가 발급한 링크를 가진 사람은{' '}
            <b className="font-bold text-ink">로그인 없이 모임 이름·잔액·멤버 표시 이름·전체 기록</b>을
            봅니다. 링크 자체가 유일한 접근 수단이므로, 공유 범위가 곧 공개 범위입니다.
          </li>
          <li>공개 장부에 나오지 않는 것: 이메일 · 입금 계좌 문구 · 초대 링크 · 내부 식별자.</li>
          <li>
            총무가 링크를 재발급하면 <b className="font-bold text-ink">이전 링크는 즉시 무효</b>가 됩니다.
          </li>
          <li>검색엔진이 이 주소를 수집·색인하지 않도록 막아 두었습니다.</li>
          <li>남용 방지를 위해 같은 접속 IP에서 오는 요청을 분당 60회로 제한합니다.</li>
        </ul>
      </Section>

      <Section title="제3자 제공 · 처리 위탁 · 국외 이전">
        <p className={BODY}>
          수집한 정보를 제3자에게 제공하거나 판매하지 않습니다. 서비스를 돌리기 위해 아래 두 곳에 처리를
          맡기고 있으며, 그 결과 정보는 <b className="font-bold text-ink">미국</b>에 저장됩니다.
        </p>
        <div className="mt-5">
          <DataTable>
            <Line term="Vercel" detail="웹 호스팅·서버 실행" value="미국 (리전 iad1, 버지니아)" />
            <Line term="Neon" detail="데이터베이스" value="미국 (리전 us-east-2, 오하이오)" />
          </DataTable>
        </div>
        <p className={`mt-5 ${NOTE}`}>
          이전되는 항목은 위 &lsquo;수집하는 항목&rsquo;의 전부이고, 이전 시점은 서비스를 이용하는 때(저장·조회가
          일어날 때마다), 방법은 네트워크 전송, 목적은 서비스 제공입니다. 요청은 전송 경로에서 이용자와
          가까운 지점을 거칠 수 있지만, 저장은 위 두 곳에서만 일어납니다.
        </p>
      </Section>

      <Section title="이용자의 권리와 행사 방법">
        <p className={BODY}>
          열람과 삭제는 문의하지 않고 <b className="font-bold text-ink">화면에서 직접</b> 할 수 있습니다.
        </p>
        <div className="mt-5">
          <DataTable>
            <Line term="내 계정 정보 열람" value="내 모임 → 계정" />
            <Line term="회원 탈퇴" detail="식별자 파기. 위 두 절의 내용대로 처리됩니다." value="내 모임 → 계정 → 위험 구역" />
            <Line term="모임 기록 삭제" detail="총무만 할 수 있습니다." value="모임 → 설정 → 위험 구역" />
            <Line term="장부 내려받기" detail="모임의 전체 기록을 CSV 파일로 받습니다." value="모임 → CSV 내보내기" />
          </DataTable>
        </div>
        <p className={`mt-5 ${NOTE}`}>
          계정 이름과 모임 표시 이름을 <b className="font-bold text-ink">바꾸는 화면은 아직 없습니다.</b>{' '}
          정정이 필요하면 아래 문의 경로로 알려 주세요.
        </p>
      </Section>

      <Section title="문의">
        <p className={BODY}>
          문의는 GitHub 이슈로 받습니다.{' '}
          <a
            href="https://github.com/HyeonJ/nbbang/issues"
            target="_blank"
            rel="noopener"
            className="font-bold text-ink underline underline-offset-4 hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            github.com/HyeonJ/nbbang/issues
          </a>
        </p>
        <p className="mt-5 border-l-2 border-accent pl-4 text-[14px] leading-[1.8] text-ink">
          <b className="font-bold">GitHub 이슈는 누구나 볼 수 있는 공개 게시판입니다.</b> 이메일·전화번호·
          계좌번호·공개 장부 링크 같은 개인정보를 이슈에 적지 마세요. 적으면 이슈를 지워도 검색엔진과
          다른 사람의 기록에 남을 수 있습니다.
        </p>
        <p className={`mt-5 ${NOTE}`}>
          열람·삭제는 이슈를 열 필요 없이 위 표의 경로에서 직접 처리할 수 있습니다. 개인정보를 주고받을
          수 있는 별도 문의 창구는 실제 이용자를 받는 시점에 마련합니다.
        </p>
      </Section>

      <section className="py-9">
        <p className={NOTE}>
          이 방침은 {EFFECTIVE_DATE}부터 적용됩니다. 수집 항목이나 처리 방식이 바뀌면 이 페이지를 먼저
          고치고 시행일을 갱신합니다.
        </p>
      </section>
    </main>
  );
}
