import { describe, expect, it } from 'vitest';
import { clientIp, hashIp, rateLimitSalt } from './client-ip';

/** 테스트용 Headers 조립 — 실제 미들웨어가 받는 것과 같은 타입을 쓴다. */
const h = (init: Record<string, string>) => new Headers(init);

describe('clientIp — 헤더에서 클라이언트 IP를 뽑고 검증·정규화한다', () => {
  it('x-forwarded-for의 첫 항목을 쓴다', () => {
    expect(clientIp(h({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
  });

  it('공백을 흘려도 같은 값이 나온다', () => {
    expect(clientIp(h({ 'x-forwarded-for': '  203.0.113.7 ,10.0.0.1' }))).toBe('203.0.113.7');
  });

  it('IPv6을 받는다', () => {
    expect(clientIp(h({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
  });

  it('루프백 IPv6(`::1`)을 받는다 — next start가 소켓에서 채우는 실제 값이다', () => {
    expect(clientIp(h({ 'x-forwarded-for': '::1' }))).toBe('::1');
  });

  it('x-forwarded-for가 없으면 x-real-ip로 떨어진다', () => {
    expect(clientIp(h({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
  });

  /**
   * ⚠️ 이 단언들이 이 파일의 본론이다. `null`은 "제한하지 않는다"로 이어지므로
   * 관용적으로 파싱하면 그게 곧 우회 경로가 된다 — 쓰레기 값이 한 버킷으로 뭉치거나,
   * 같은 주소의 여러 표기가 여러 버킷으로 갈라진다.
   */
  describe('유효하지 않은 값은 null — 버킷 오염·우회 경로를 만들지 않는다', () => {
    it('헤더가 아예 없으면 null', () => {
      expect(clientIp(h({}))).toBeNull();
    });

    it('공백뿐이면 null', () => {
      expect(clientIp(h({ 'x-forwarded-for': '   ' }))).toBeNull();
    });

    it('IP가 아닌 문자열이면 null', () => {
      expect(clientIp(h({ 'x-forwarded-for': 'not-an-ip' }))).toBeNull();
    });

    it('비정상적으로 긴 값이면 null', () => {
      expect(clientIp(h({ 'x-forwarded-for': 'A'.repeat(500) }))).toBeNull();
    });

    it('포트가 붙은 값은 거부한다', () => {
      expect(clientIp(h({ 'x-forwarded-for': '203.0.113.7:8080' }))).toBeNull();
    });

    it('옥텟이 범위를 넘으면 null', () => {
      expect(clientIp(h({ 'x-forwarded-for': '203.0.113.999' }))).toBeNull();
      expect(clientIp(h({ 'x-forwarded-for': '203.0.113' }))).toBeNull();
      expect(clientIp(h({ 'x-forwarded-for': '203.0.113.7.1' }))).toBeNull();
    });

    it('앞자리 0이 붙은 옥텟은 거부한다 — 한 주소에 두 표기를 만들지 않는다', () => {
      expect(clientIp(h({ 'x-forwarded-for': '203.0.113.007' }))).toBeNull();
      expect(clientIp(h({ 'x-forwarded-for': '010.0.0.1' }))).toBeNull();
    });

    it('대괄호·존 식별자가 붙은 IPv6은 거부한다', () => {
      expect(clientIp(h({ 'x-forwarded-for': '[2001:db8::1]' }))).toBeNull();
      expect(clientIp(h({ 'x-forwarded-for': 'fe80::1%eth0' }))).toBeNull();
    });

    it('`::`이 둘 이상인 IPv6은 거부한다', () => {
      expect(clientIp(h({ 'x-forwarded-for': '2001::db8::1' }))).toBeNull();
    });

    it('그룹 수가 맞지 않는 IPv6은 거부한다', () => {
      expect(clientIp(h({ 'x-forwarded-for': '1:2:3:4:5:6:7' }))).toBeNull();
      expect(clientIp(h({ 'x-forwarded-for': '1:2:3:4:5:6:7:8:9' }))).toBeNull();
      // '::'가 0 그룹을 대신할 수는 없다
      expect(clientIp(h({ 'x-forwarded-for': '1:2:3:4:5:6:7:8::' }))).toBeNull();
    });

    it('첫 항목이 쓰레기면 x-real-ip로 떨어지지 않는다 — 우회 경로를 열지 않는다', () => {
      expect(clientIp(h({ 'x-forwarded-for': 'garbage', 'x-real-ip': '203.0.113.9' }))).toBeNull();
    });

    it('빈 첫 항목(`, 1.2.3.4`)은 null — 뒤 항목으로 넘어가지 않는다', () => {
      expect(clientIp(h({ 'x-forwarded-for': ', 203.0.113.7' }))).toBeNull();
    });
  });

  /**
   * 같은 주소의 여러 표기가 **한 버킷**이어야 한다. 갈라지면 표기만 바꿔 한도를 배로 쓴다.
   * (프로덕션에서는 Vercel이 헤더를 덮어써 표기가 고정되지만, 그 한 겹에만 의존하지 않는다.)
   */
  describe('IPv6 정규화 — 같은 주소의 여러 표기가 한 값으로 모인다', () => {
    const canon = (s: string) => clientIp(h({ 'x-forwarded-for': s }));

    it('완전 표기와 압축 표기가 같은 값이 된다', () => {
      expect(canon('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1');
      expect(canon('2001:db8:0:0:0:0:0:1')).toBe('2001:db8::1');
    });

    it('대문자 표기가 소문자로 모인다', () => {
      expect(canon('2001:DB8::1')).toBe('2001:db8::1');
    });

    it('가장 긴 0 구간을 압축한다', () => {
      expect(canon('2001:0:0:1:0:0:0:1')).toBe('2001:0:0:1::1');
    });

    it('0 구간이 한 그룹이면 압축하지 않는다 (RFC 5952)', () => {
      expect(canon('2001:db8:0:1:1:1:1:1')).toBe('2001:db8:0:1:1:1:1:1');
    });

    it('전체가 0이면 `::`', () => {
      expect(canon('0:0:0:0:0:0:0:0')).toBe('::');
      expect(canon('::')).toBe('::');
    });

    it('IPv4를 꼬리에 단 표기도 받아 한 값으로 모인다', () => {
      expect(canon('::ffff:192.0.2.1')).toBe(canon('::ffff:c000:201'));
      expect(canon('1:2:3:4:5:6:203.0.113.7')).toBe('1:2:3:4:5:6:cb00:7107');
    });
  });
});

describe('hashIp — IP를 평문으로 저장하지 않기 위한 HMAC', () => {
  const SALT = 'test-salt-0123456789';

  it('같은 입력·같은 salt면 같은 출력', async () => {
    expect(await hashIp('203.0.113.7', SALT)).toBe(await hashIp('203.0.113.7', SALT));
  });

  it('다른 IP면 다른 출력', async () => {
    expect(await hashIp('203.0.113.7', SALT)).not.toBe(await hashIp('203.0.113.8', SALT));
  });

  it('salt가 다르면 출력이 다르다 — salt 없이는 사전 대조가 안 된다', async () => {
    expect(await hashIp('203.0.113.7', SALT)).not.toBe(await hashIp('203.0.113.7', `${SALT}x`));
  });

  it('출력에 원본 IP가 들어 있지 않다', async () => {
    const out = await hashIp('203.0.113.7', SALT);
    expect(out).not.toContain('203.0.113.7');
    expect(out).not.toContain('203');
  });

  it('길이가 고정된다 — 32자 16진수(128비트)', async () => {
    for (const ip of ['203.0.113.7', '::1', '2001:db8::1', '255.255.255.255']) {
      const out = await hashIp(ip, SALT);
      expect(out, ip).toHaveLength(32);
      expect(out, ip).toMatch(/^[0-9a-f]{32}$/);
    }
  });
});

describe('rateLimitSalt — 시크릿 기본값을 하드코딩하지 않는다', () => {
  it('RATE_LIMIT_SALT가 없으면 던진다', () => {
    const saved = process.env.RATE_LIMIT_SALT;
    try {
      delete process.env.RATE_LIMIT_SALT;
      expect(() => rateLimitSalt()).toThrow(/RATE_LIMIT_SALT/);
      process.env.RATE_LIMIT_SALT = '';
      expect(() => rateLimitSalt()).toThrow(/RATE_LIMIT_SALT/);
    } finally {
      if (saved === undefined) delete process.env.RATE_LIMIT_SALT;
      else process.env.RATE_LIMIT_SALT = saved;
    }
  });

  it('있으면 그 값을 돌려준다', () => {
    const saved = process.env.RATE_LIMIT_SALT;
    try {
      process.env.RATE_LIMIT_SALT = 'from-env';
      expect(rateLimitSalt()).toBe('from-env');
    } finally {
      if (saved === undefined) delete process.env.RATE_LIMIT_SALT;
      else process.env.RATE_LIMIT_SALT = saved;
    }
  });
});
