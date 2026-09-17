import { afterEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/cron/cleanup/route';

/**
 * 라우트가 **실제로** `isAuthorizedCronRequest`를 쓰는지 본다.
 *
 * `lib/cron-auth.test.ts`가 순수 함수를 고정하지만, 그것만으로는 라우트가 그 함수를 부르는지
 * 알 수 없다 — 순수 함수는 완벽한데 라우트가 자기 방식으로 비교하는 구현이 그 테스트를
 * 통과한다. 여기서는 라우트 핸들러를 직접 불러 401을 확인한다.
 *
 * 세 경우 모두 **DB에 닿기 전에** 반환되므로 DATABASE_URL 없이 돌아간다 — 그래서 이 파일이
 * DB 없는 `unit` 프로젝트에 있을 수 있다. "맞는 시크릿" 경우는 삭제 쿼리를 돌려야 하므로
 * `test/rate-limit.integration.test.ts`가 맡는다.
 */
describe('GET /api/cron/cleanup — 인가', () => {
  const saved = process.env.CRON_SECRET;
  afterEach(() => {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  });

  const call = (headers: Record<string, string>) =>
    GET(new Request('http://localhost/api/cron/cleanup', { headers }));

  it('① CRON_SECRET 미설정 — `Bearer undefined`도 401', async () => {
    delete process.env.CRON_SECRET;
    expect((await call({ authorization: 'Bearer undefined' })).status).toBe(401);
    expect((await call({})).status).toBe(401);
  });

  it('② Authorization 헤더 없음 — 401', async () => {
    process.env.CRON_SECRET = 'right-secret';
    expect((await call({})).status).toBe(401);
  });

  it('③ 틀린 시크릿 — 401', async () => {
    process.env.CRON_SECRET = 'right-secret';
    expect((await call({ authorization: 'Bearer wrong-secret' })).status).toBe(401);
    expect((await call({ authorization: 'right-secret' })).status).toBe(401);
  });

  it('401 본문이 미설정인지 틀린 값인지 알려주지 않는다', async () => {
    process.env.CRON_SECRET = 'right-secret';
    const wrong = await (await call({ authorization: 'Bearer wrong-secret' })).text();
    delete process.env.CRON_SECRET;
    const missing = await (await call({ authorization: 'Bearer wrong-secret' })).text();
    expect(wrong).toBe(missing);
  });
});
