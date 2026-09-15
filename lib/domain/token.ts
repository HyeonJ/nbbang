import { randomBytes } from 'node:crypto';

export function newToken(): string {
  return randomBytes(9).toString('base64url'); // 12 chars
}

/**
 * 공개 장부(F5)용 토큰 — 인증 없이 돈 기록을 여는 **베어러 시크릿**이므로 128비트를 쓴다.
 *
 * 초대 토큰(72비트)과 구별하는 이유: 초대 링크는 추측에 성공해도 합류 화면에 닿을 뿐이고
 * 총무가 재발급할 수 있다. 공개 장부 토큰은 그 자체가 장부 전체의 열쇠라 여유를 둔다.
 * 레이트 리밋은 v1에 없다(플랜 Step 1.5의 기록) — 128비트 열거는 계산상 불가능하고,
 * 잘못된 토큰에는 본문 없는 404만 돌려줘 탐색에 정보를 주지 않는다.
 *
 * ⚠️ 길이는 **검증하지 않는다** — 이 함수 도입 이전에 발급된 12자 토큰도 그대로 유효해야 한다.
 */
export function newPublicToken(): string {
  return randomBytes(16).toString('base64url'); // 22 chars, 128 bits
}
