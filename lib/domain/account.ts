/**
 * 탈퇴 확인 문구 — 화면이 타이핑을 받고 서버가 **다시** 확인하는 그 문자열 하나.
 *
 * ── 왜 `actions/account.ts`가 아니라 여기인가 (빌드가 잡은 실수) ─────────────
 * 처음에는 액션 파일에 두고 화면이 거기서 import했다. `tsc --noEmit`도 `eslint`도
 * 통과했지만 `next build`가 거부했다:
 *
 *   The export deleteAccount was not found in module actions/account.ts
 *   The module has no exports at all.
 *
 * `'use server'` 파일은 **async 함수만** export할 수 있다. 상수를 하나 얹는 순간 그 모듈의
 * export가 통째로 무효가 되고, 에러는 상수가 아니라 **액션을 못 찾는다**고 나온다 —
 * 원인에서 한 칸 떨어진 자리에서 터지는 종류의 실패다. 그래서 값은 순수 모듈에 둔다.
 *
 * ── 왜 한 곳에만 두는가 ────────────────────────────────────────────────────
 * 화면의 비교와 서버의 비교가 **같은 값**이어야 한다. 두 벌로 갈리면 화면이 통과시킨 입력을
 * 서버가 거절하고, 사용자는 이유를 알 수 없는 실패를 본다(`deleteGroup`의 이름 비교 규칙을
 * 화면·서버가 공유하는 것과 같은 이유).
 */
export const DELETE_ACCOUNT_CONFIRM = '탈퇴합니다';
