/**
 * 이미 스키마를 갖고 있는 DB에 baseline 마이그레이션을 "실행 없이 적용됨"으로 표시한다.
 *
 * 왜 필요한가: Plan 02까지는 `drizzle-kit push`로 세 브랜치를 사람이 각각 맞췄으므로
 * 어느 브랜치에도 적용 이력(`drizzle.__drizzle_migrations`)이 없다. 이력이 빈 상태에서
 * `drizzle-kit migrate`를 돌리면 baseline의 CREATE TABLE이 기존 테이블과 충돌한다.
 * drizzle-kit에는 baseline/fake-apply 옵션이 없어(`migrate --help`의 플래그는 `--config` 하나뿐)
 * 이 스크립트가 이력만 기록한다.
 *
 * 실행 (브랜치별로 한 번씩, 일회성):
 *   npx dotenv -e .env.local -- node scripts/mark-migration-applied.mts   # dev
 *   npx dotenv -e .env.test  -- node scripts/mark-migration-applied.mts   # test
 *   # production은 README "마이그레이션 문제 해결" 절의 절차로 env를 임시로 받아 실행한다.
 *
 * 멱등하다 — 같은 hash가 이미 있으면 건너뛴다.
 */
import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL이 없습니다. dotenv -e <envfile> -- 로 실행하세요.');
  process.exit(1);
}

// 어느 DB에 쓰는지 눈으로 확인할 수 있게 표시한다. 자격증명은 찍지 않는다.
const target = new URL(url);
console.log(`target db=${target.pathname.slice(1)} host=${target.hostname.slice(0, 12)}…`);

const sql = neon(url);

// ── 프리플라이트 — 하나라도 어긋나면 아무것도 쓰지 않고 중단한다. ─────────────
const EXPECTED = [
  'account',
  'dues_payments',
  'dues_rounds',
  'groups',
  'ledger_entries',
  'memberships',
  'session',
  'user',
  'verification',
];

const trackedRows = (await sql`
  select count(*)::int as n from information_schema.tables
  where table_schema = 'drizzle' and table_name = '__drizzle_migrations'`) as { n: number }[];
const alreadyTracked = trackedRows[0].n;

const tableRows = (await sql`
  select table_name from information_schema.tables
  where table_schema = 'public' order by 1`) as { table_name: string }[];
const tables = tableRows.map((t) => t.table_name);

if (tables.join(',') !== EXPECTED.join(',')) {
  console.error('ABORT — public 스키마가 기대한 베이스라인과 다릅니다:', tables.join(', ') || '(없음)');
  console.error('기대:', EXPECTED.join(', '));
  process.exit(1);
}
console.log(`preflight ok — public 테이블 ${tables.length}개가 베이스라인과 일치합니다.`);
if (alreadyTracked > 0) {
  console.log('note: 이력 테이블이 이미 있습니다 — 중복 기록은 hash로 건너뜁니다.');
}

// ── 이력 기록 ────────────────────────────────────────────────────────────────
// drizzle-orm의 마이그레이터는 schema `drizzle`, 테이블 `__drizzle_migrations`를 본다.
// ⚠️ 적용 여부를 가르는 값은 **해시가 아니라 created_at**이다 — pg 다이얼렉트는 이력의
// 최신 행 하나를 읽어 `lastRow.created_at < migration.folderMillis`인 것만 적용한다.
// 해시는 기록만 되고 비교되지 않는다. 그래서 created_at에 저널의 `when`(ms)을 넣는 것이
// 베이스라인을 "이미 적용됨"으로 만드는 핵심이고, 해시는 사람이 파일을 대조할 때 쓴다.
const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
  entries: { tag: string; when: number }[];
};

await sql`create schema if not exists drizzle`;
await sql`create table if not exists drizzle.__drizzle_migrations (
  id serial primary key, hash text not null, created_at bigint
)`;

for (const entry of journal.entries) {
  const body = readFileSync(`drizzle/${entry.tag}.sql`, 'utf8');
  const hash = createHash('sha256').update(body).digest('hex');
  const dupRows = (await sql`
    select count(*)::int as n from drizzle.__drizzle_migrations where hash = ${hash}`) as { n: number }[];
  if (dupRows[0].n > 0) {
    console.log(`skip ${entry.tag} (already recorded)`);
    continue;
  }
  await sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${hash}, ${entry.when})`;
  console.log(`marked ${entry.tag}`);
}

// ── 결과 확인 — 브랜치별로 눈으로 확인한다. ──────────────────────────────────
const history = (await sql`
  select hash, created_at from drizzle.__drizzle_migrations order by created_at`) as {
  hash: string;
  created_at: string;
}[];
console.log(`drizzle.__drizzle_migrations: ${history.length}행`);
for (const row of history) {
  console.log(`  ${row.hash} ${row.created_at}`);
}
