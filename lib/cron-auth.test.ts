import { describe, expect, it } from 'vitest';
import { isAuthorizedCronRequest } from './cron-auth';

/**
 * 네 경우를 **분리해서** 고정한다. 하나로 뭉치면 `Bearer undefined` 우회가
 * "틀린 값은 거부한다" 뒤에 숨는다 — 그 우회는 시크릿이 **없을 때만** 열리기 때문이다.
 */
describe('isAuthorizedCronRequest', () => {
  const SECRET = 'cron-secret-value';

  it('① env 없음 — 어떤 헤더로도 통과할 수 없다', () => {
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}`, undefined)).toBe(false);
    // 이게 이 테스트의 본론이다: 미설정이 '누구나 아는 비밀번호'가 되지 않는다.
    expect(isAuthorizedCronRequest('Bearer undefined', undefined)).toBe(false);
    expect(isAuthorizedCronRequest('Bearer ', undefined)).toBe(false);
    expect(isAuthorizedCronRequest(null, undefined)).toBe(false);
    // 빈 문자열도 '설정되지 않음'으로 본다.
    expect(isAuthorizedCronRequest('Bearer ', '')).toBe(false);
    expect(isAuthorizedCronRequest('Bearer undefined', '')).toBe(false);
  });

  it('② 헤더 없음 — 거부', () => {
    expect(isAuthorizedCronRequest(null, SECRET)).toBe(false);
    expect(isAuthorizedCronRequest('', SECRET)).toBe(false);
  });

  it('③ 틀린 값 — 거부', () => {
    expect(isAuthorizedCronRequest('Bearer wrong', SECRET)).toBe(false);
    expect(isAuthorizedCronRequest(SECRET, SECRET), 'Bearer 접두사 없이 통과했다').toBe(false);
    expect(isAuthorizedCronRequest(`bearer ${SECRET}`, SECRET), '대소문자가 다른데 통과했다').toBe(false);
    expect(isAuthorizedCronRequest(`Bearer ${SECRET} `, SECRET), '뒤 공백이 붙었는데 통과했다').toBe(false);
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}x`, SECRET), '접두사만 맞는데 통과했다').toBe(false);
  });

  it('④ 맞는 값 — 통과 (이게 없으면 "전부 거부"가 위 셋을 다 통과한다)', () => {
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });
});
