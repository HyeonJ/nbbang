import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter, type SqlExecutor } from '@/lib/rate-limit';
import { requireTestDatabase } from './db-guard';

/**
 * 레이트 리밋 카운터의 **DB 왕복 불변식**. 단위 테스트로는 볼 수 없는 것들을 본다 —
 * 원자적 upsert가 정말 원자적인지, `Retry-After`가 DB 시계로 계산되는지, 윈도가 리셋되는지.
 *
 * ── 왜 실행기를 주입받는 구조인가 (리뷰 블로커 2) ─────────────────────────────
 * `checkRateLimit`이 자기 커넥션을 직접 만들면 **fail-open을 테스트할 방법이 없다.**
 * 카운터 쓰기가 실패하는 상황을 테스트에서 강제할 수 없기 때문이다. `createRateLimiter(exec)`는
 * 던지는 실행기를 주입할 수 있게 해서, "장애 시 통과시킨다"는 **정책 자체를 증거로 만든다.**
 */

const sql = await requireTestDatabase('레이트 리밋 통합 테스트');

/** 프로덕션 미들웨어가 쓰는 것과 **같은 드라이버**(neon HTTP)로 돈다 — 경로를 비껴가지 않는다. */
const exec: SqlExecutor = (query, params) =>
  sql.query(query, params) as Promise<Record<string, unknown>[]>;

const checkRateLimit = createRateLimiter(exec);

const WINDOW = 60;

/** 버킷 키는 실제로도 HMAC 해시 문자열이다 — 여기서도 평문 IP를 쓰지 않는다. */
const bucket = (label: string) => `g:test-${label}`;

const rows = async (b: string) =>
  (await sql.query('select count, window_start from rate_limits where bucket = $1', [b])) as {
    count: number;
    window_start: string;
  }[];

describe('레이트 리밋 카운터', () => {
  it('한도 안이면 통과시킨다', async () => {
    const b = bucket('under');
    for (let i = 1; i <= 3; i += 1) {
      expect(await checkRateLimit(b, 3, WINDOW), `${i}번째`).toEqual({ allowed: true });
    }
  });

  it('한도를 넘으면 막고 Retry-After를 준다 — 1 이상, 윈도 이하', async () => {
    const b = bucket('over');
    for (let i = 1; i <= 3; i += 1) {
      expect(await checkRateLimit(b, 3, WINDOW)).toEqual({ allowed: true });
    }
    const decision = await checkRateLimit(b, 3, WINDOW);
    expect(decision.allowed).toBe(false);
    // 두 번째로 넘겨도 계속 막힌다 — 카운터가 판정 때문에 되돌아가지 않는다.
    const again = await checkRateLimit(b, 3, WINDOW);
    expect(again.allowed).toBe(false);
    if (decision.allowed || again.allowed) throw new Error('도달 불가');
    for (const d of [decision, again]) {
      expect(d.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(d.retryAfterSeconds).toBeLessThanOrEqual(WINDOW);
    }
  });

  /**
   * ⚠️ 이 단언이 없으면 **"전부 막기"** 라는 구현이 위 테스트들을 전부 통과한다.
   * 한 IP가 한도를 채웠을 때 다른 IP가 멀쩡해야 비로소 레이트 리밋이다.
   */
  it('다른 버킷은 영향받지 않는다', async () => {
    const noisy = bucket('noisy');
    const quiet = bucket('quiet');
    for (let i = 1; i <= 4; i += 1) await checkRateLimit(noisy, 3, WINDOW);
    expect((await checkRateLimit(noisy, 3, WINDOW)).allowed).toBe(false);

    expect(await checkRateLimit(quiet, 3, WINDOW)).toEqual({ allowed: true });
    expect((await rows(quiet))[0]!.count).toBe(1);
  });

  it('윈도가 지나면 리셋된다', async () => {
    const b = bucket('reset');
    for (let i = 1; i <= 4; i += 1) await checkRateLimit(b, 3, WINDOW);
    expect((await checkRateLimit(b, 3, WINDOW)).allowed).toBe(false);

    // 시간을 기다리지 않고 **윈도 시작을 과거로 직접 밀어** 만료 상태를 강제한다.
    await sql.query(
      `update rate_limits set window_start = now() - interval '10 minutes' where bucket = $1`,
      [b],
    );

    expect(await checkRateLimit(b, 3, WINDOW), '윈도가 지났는데도 막혔다').toEqual({ allowed: true });
    // 리셋이지 감소가 아니다 — 카운터가 1로 돌아갔는지 DB에서 직접 확인한다.
    expect((await rows(b))[0]!.count).toBe(1);
  });

  /**
   * 원자성. `select` → 판정 → `update`로 쪼개 구현하면 동시 요청이 같은 카운터를 읽어
   * 한도를 넘겨 새어 나간다. 한 문장 upsert가 그것을 막는지를 **동시에 던져서** 본다.
   */
  it('동시 요청이 한도를 넘겨 새지 않는다', async () => {
    const b = bucket('race');
    const limit = 10;
    const decisions = await Promise.all(
      Array.from({ length: limit + 5 }, () => checkRateLimit(b, limit, WINDOW)),
    );
    expect(decisions.filter((d) => d.allowed)).toHaveLength(limit);
    expect(decisions.filter((d) => !d.allowed)).toHaveLength(5);
    expect((await rows(b))[0]!.count).toBe(limit + 5);
  });

  /**
   * fail-open — 이 정책이 이 파일에서 **가장 중요한** 단언이다.
   * 카운터를 못 쓰는 상황에서 장부를 막으면, DB가 잠깐 흔들릴 때 정상 사용자가 공개 링크를
   * 못 연다. 레이트 리밋이 잠깐 없는 쪽이 낫다. 던지는 실행기로 그 정책을 증명한다.
   */
  it('카운터 쓰기가 실패하면 통과시키고(fail-open) 에러를 남긴다', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const boom = createRateLimiter(() => Promise.reject(new Error('카운터 폭발')));
      expect(await boom(bucket('failopen'), 1, WINDOW)).toEqual({ allowed: true });
      // 한도가 1인데 여러 번 불러도 계속 통과한다 — 장애 중에는 제한이 없다.
      expect(await boom(bucket('failopen'), 1, WINDOW)).toEqual({ allowed: true });
      expect(errors, '조용히 삼켰다 — 장애가 로그에 남지 않으면 아무도 모른다').toHaveBeenCalled();
      expect(String(errors.mock.calls[0])).toContain('rate-limit');
    } finally {
      errors.mockRestore();
    }
  });

  it('행이 하나도 안 돌아와도 통과시킨다(fail-open)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const empty = createRateLimiter(() => Promise.resolve([]));
      expect(await empty(bucket('emptyrows'), 1, WINDOW)).toEqual({ allowed: true });
      expect(errors).toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});

describe('정리 크론 — IP 해시를 무기한 보관하지 않는다', () => {
  const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = 'integration-cron-secret';
  });

  afterEach(() => {
    if (ORIGINAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  });

  const call = async (headers: Record<string, string>) => {
    const { GET } = await import('@/app/api/cron/cleanup/route');
    return GET(new Request('http://localhost/api/cron/cleanup', { headers }));
  };

  it('맞는 시크릿이면 만료된 행만 지운다 — 살아 있는 버킷은 남는다', async () => {
    const stale = bucket('cron-stale');
    const fresh = bucket('cron-fresh');
    await checkRateLimit(stale, 60, WINDOW);
    await checkRateLimit(fresh, 60, WINDOW);
    await sql.query(
      `update rate_limits set window_start = now() - interval '3 days' where bucket = $1`,
      [stale],
    );

    const res = await call({ authorization: 'Bearer integration-cron-secret' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: number };
    expect(body.deleted).toBe(1);

    expect(await rows(stale), '만료된 행이 남았다 — 보관기간이 지켜지지 않는다').toHaveLength(0);
    expect(await rows(fresh), '살아 있는 버킷을 지웠다 — 제한이 리셋된다').toHaveLength(1);
  });

  /**
   * ⚠️ 응답 본문에 버킷 값을 담지 않는다는 단언. 버킷은 IP의 HMAC이고, 그것을 200 본문에
   * 실으면 인증된 크론 응답이 그대로 해시 목록 유출 경로가 된다.
   */
  it('응답 본문에 버킷(IP 해시)을 담지 않는다', async () => {
    const b = bucket('cron-nobody');
    await checkRateLimit(b, 60, WINDOW);
    await sql.query(
      `update rate_limits set window_start = now() - interval '3 days' where bucket = $1`,
      [b],
    );
    const res = await call({ authorization: 'Bearer integration-cron-secret' });
    expect(await res.text()).not.toContain(b);
  });
});
