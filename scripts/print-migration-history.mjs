/**
 * 적용 이력(`drizzle.__drizzle_migrations`)을 읽기만 한다 — 쓰지 않는다.
 *
 * 왜 필요한가: `drizzle-kit migrate`는 적용할 것이 없어도 항상
 * "migrations applied successfully!"를 출력한다. 그래서 **출력으로는 멱등성을 증명할 수 없다**.
 * 증명은 이력 행 수로만 가능하므로, CI의 deploy 잡이 migrate 전후로 이 스크립트를 찍어
 * 프로덕션에 아무 변경도 적용되지 않았음을 로그에 남긴다.
 *
 * 실행: DATABASE_URL=... node scripts/print-migration-history.mjs
 * 자격증명은 찍지 않는다 (DB 이름과 호스트 앞 12자만).
 */
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL이 없습니다.');
  process.exit(1);
}

const target = new URL(url);
console.log(`target db=${target.pathname.slice(1)} host=${target.hostname.slice(0, 12)}…`);

const sql = neon(url);

const tracked = await sql`
  select count(*)::int as n from information_schema.tables
  where table_schema = 'drizzle' and table_name = '__drizzle_migrations'`;
if (tracked[0].n === 0) {
  console.log('drizzle.__drizzle_migrations: 없음 (이력 테이블 자체가 없다)');
  process.exit(0);
}

const history = await sql`
  select hash, created_at from drizzle.__drizzle_migrations order by created_at`;
console.log(`drizzle.__drizzle_migrations: ${history.length}행`);
for (const row of history) {
  console.log(`  ${row.hash} ${row.created_at}`);
}
