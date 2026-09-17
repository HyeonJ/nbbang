import { headers } from 'next/headers';
import { auth } from '@/lib/auth';

/**
 * **세션을 해석하는 유일한 자리.** 탈퇴한 계정은 여기서 걸린다 (ADR-004).
 *
 * ── 왜 미들웨어가 아닌가 (외부 리뷰 IMPORTANT 14) ────────────────────────────
 * `middleware.ts`의 매처는 `/g/:path*`다 — 서버 액션 POST도, `/groups/*` 페이지도 지나가지
 * 않는다. 매처를 넓혀 거기서 막으면 **두 개의 인증 판정**이 생기고(미들웨어 하나, 액션 헬퍼
 * 하나), 그 둘이 어긋나는 날 조용히 뚫린다. 그래서 차단은 세션을 **해석하는** 지점, 즉 이
 * 함수 하나에 둔다. 이 레포에서 `auth.api.getSession`을 부르는 곳은 여기 말고 없다 —
 * 페이지 9개 · CSV 라우트 · `actions/clients.ts`가 전부 이것을 부른다.
 *
 * ── Better Auth는 스스로 막아주지 않는다 (실측) ──────────────────────────────
 * `user` 행을 직접 UPDATE해 `deleted_at`을 찍고 세션 행을 남겨 둔 채 `getSession`을 부르면
 * **세션이 그대로 돌아온다**(2026-09-17 측정). Better Auth에는 "이 사용자를 비활성으로 본다"는
 * 개념이 없으므로 그 판정은 전적으로 앱의 몫이다. 탈퇴는 `session` 행을 지우므로 보통은
 * 쿠키가 이미 죽어 있지만, 이 검사는 그 삭제가 실패·회귀했을 때의 두 번째 방어선이고,
 * 통합 테스트는 **그 상태를 강제로 만들어**(세션 행은 살리고 `deleted_at`만 찍어) 확인한다.
 *
 * ── `deletedAt`이 어디서 오는가 ─────────────────────────────────────────────
 * `lib/auth.ts`의 `user.additionalFields.deletedAt` 선언 덕분에 세션 응답에 실려 온다.
 * 그 선언이 없으면 어댑터가 읽어 온 값이 `parseUserOutput`에서 걸러져 **여기서 `undefined`가
 * 되고 이 차단은 항상 통과한다.** TypeScript가 그 제거를 컴파일 에러로 잡지만(선언이 사라지면
 * 이 속성 접근이 타입 에러가 된다), 그것만 믿지 않고 통합 테스트가 값의 실재를 따로 못 박는다.
 */
export type ActiveSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

export async function getActiveSession(): Promise<ActiveSession | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  // 탈퇴한 계정은 "로그인되지 않음"과 같게 취급한다 — 별도 화면을 만들지 않는다.
  // 파기가 끝난 계정에 대고 "탈퇴한 계정입니다"라고 말해 줄 상대가 없다(쿠키만 남아 있다).
  if (session.user.deletedAt) return null;
  return session;
}
