import { describe, it, expect } from 'vitest';
import { newPublicToken, newToken } from '@/lib/domain/token';

describe('newToken', () => {
  it('URL-safe 12+ chars, unique', () => {
    const a = newToken();
    const b = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{12,}$/);
    expect(a).not.toBe(b);
  });
});

describe('newPublicToken', () => {
  // 길이를 정확히 못 박는다 — 22자는 128비트 base64url의 유일한 결과다(패딩 없음).
  // 이 단언이 없으면 newToken()으로 조용히 되돌아가도(12자) 아래 문자셋 테스트는 통과한다.
  it('128비트 = 22자를 낸다', () => {
    expect(newPublicToken()).toHaveLength(22);
  });

  it('URL-safe 문자만 쓴다 — 주소창에 그대로 실린다', () => {
    // base64url은 +/= 를 쓰지 않는다. 하나라도 섞이면 인코딩 없이 URL에 못 넣는다.
    for (let i = 0; i < 64; i += 1) {
      expect(newPublicToken()).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });

  it('호출마다 다른 값을 낸다', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => newPublicToken()));
    expect(seen.size).toBe(1000);
  });

  it('초대 토큰보다 길다 — 두 함수가 뒤바뀌면 여기서 걸린다', () => {
    expect(newPublicToken().length).toBeGreaterThan(newToken().length);
  });
});
