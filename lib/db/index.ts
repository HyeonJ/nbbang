import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from './schema';

// neon-serverless는 WebSocket으로 붙어 트랜잭션을 지원한다(neon-http는 불가).
// Node 런타임에는 전역 WebSocket이 없어 ws를 주입한다.
neonConfig.webSocketConstructor = ws;

// max: 5 — 워밍된 Vercel 인스턴스마다 자기 풀을 갖는데 Neon 다이렉트 엔드포인트는
// 동시 연결을 ~100으로 제한한다. 인스턴스당 상한을 낮게 잡아 연결 고갈을 막는다.
// idleTimeoutMillis: 10_000 — Vercel 동결(freeze) 구간을 건너뛴 유휴 클라이언트는
// 이미 죽은 소켓일 수 있다. 짧게 버려서 재사용하지 않는다.
// Client가 아니라 Pool을 쓰는 이유: 단일 공유 클라이언트면 동시 쿼리가 열린 트랜잭션 안으로 새어든다.
// export 이유는 테스트 종료뿐이다 — Vitest 통합 테스트는 이 풀을 명시적으로 닫아야
// 워커 프로세스가 유휴 소켓을 붙든 채 남지 않는다(test/db-fixture.ts의 afterAll).
// 앱 코드는 db만 쓴다.
export const pool = new Pool({ connectionString: process.env.DATABASE_URL!, max: 5, idleTimeoutMillis: 10_000 });

// node-postgres Pool은 유휴 클라이언트 장애를 'error'로 올린다. 리스너가 없으면
// 프로세스가 그 이벤트로 죽어 같은 인스턴스의 다른 요청까지 500이 된다.
pool.on('error', (e: Error) => console.error('[db pool]', e));

export const db = drizzle(pool, { schema });
