-- ⚠️⚠️ 이 파일은 `drizzle-kit generate` 산출물을 **손으로 고친 것**이다 (Plan 03 Task 2 Step 3 허용).
-- 생성된 원본은 그대로 돌리면 **반드시 실패한다**. 고친 이유 두 가지:
--
-- 1) **순서**: 생성된 SQL은 복합 FK(`ADD CONSTRAINT … FOREIGN KEY ("group_id","id")`)를
--    그 FK가 참조하는 복합 UNIQUE보다 **먼저** 실행한다. Postgres는 FK 생성 시점에 참조 대상
--    유니크가 이미 있어야 하므로 42830("there is no unique constraint matching given keys")으로
--    즉사한다. 그래서 유니크 3개를 FK들보다 앞으로 옮겼다.
--
-- 2) **백필**: 생성된 SQL은 `ALTER TABLE dues_payments ADD COLUMN "group_id" text NOT NULL`을
--    한 문장으로 낸다 — 기존 행이 하나라도 있으면 23502다. 이 태스크 시점에 dev는 dues_payments가
--    0행이었지만 **test 브랜치에는 1행이 남아 있었고**, `e2e/global-setup.ts`는 `drizzle-kit migrate`를
--    TRUNCATE보다 **먼저** 돌리므로 CI가 그 1행을 안고 마이그레이션한다. 프로덕션 데이터는 로컬에서
--    확인할 수 없다. 그래서 "nullable 추가 → 회차에서 백필 → SET NOT NULL" 세 문장으로 쪼갰다
--    (데이터가 비어 있어도 안전하고, 있어도 안전하다).
--
-- 🔁 `schema.ts`를 다시 generate하면 이 두 수정은 사라진다. 이 파일을 재생성할 일이 생기면
--    위 두 가지를 **다시 손으로 적용**해야 한다.

-- [1] 복합 FK가 참조할 대상 키를 먼저 만든다 — 아래 FK들보다 반드시 앞.
ALTER TABLE "dues_rounds" ADD CONSTRAINT "dues_rounds_group_id_key" UNIQUE("group_id","id");--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_group_id_key" UNIQUE("group_id","id");--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_group_id_key" UNIQUE("group_id","id");--> statement-breakpoint

-- [2] 기존 단일 컬럼 FK를 걷어낸다 — 아래 복합 FK가 대체한다.
--     (단일 FK는 "그 행이 존재함"만 봤고 모임 경계는 보지 못했다.)
ALTER TABLE "dues_payments" DROP CONSTRAINT "dues_payments_round_id_dues_rounds_id_fk";--> statement-breakpoint
ALTER TABLE "dues_payments" DROP CONSTRAINT "dues_payments_membership_id_memberships_id_fk";--> statement-breakpoint
ALTER TABLE "dues_payments" DROP CONSTRAINT "dues_payments_ledger_entry_id_ledger_entries_id_fk";--> statement-breakpoint

-- [3] group_id 추가 — nullable로 넣고, 회차를 통해 모임을 찾아 백필한 뒤 NOT NULL로 조인다.
ALTER TABLE "dues_payments" ADD COLUMN "group_id" text;--> statement-breakpoint
UPDATE "dues_payments" p SET "group_id" = r."group_id" FROM "dues_rounds" r WHERE r."id" = p."round_id";--> statement-breakpoint
ALTER TABLE "dues_payments" ALTER COLUMN "group_id" SET NOT NULL;--> statement-breakpoint

-- [4] 복합 FK — 회차·멤버십·원장 엔트리가 모두 이 결제와 같은 모임이어야 한다.
ALTER TABLE "dues_payments" ADD CONSTRAINT "dues_payments_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues_payments" ADD CONSTRAINT "dues_payments_round_fk" FOREIGN KEY ("group_id","round_id") REFERENCES "public"."dues_rounds"("group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues_payments" ADD CONSTRAINT "dues_payments_membership_fk" FOREIGN KEY ("group_id","membership_id") REFERENCES "public"."memberships"("group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues_payments" ADD CONSTRAINT "dues_payments_entry_fk" FOREIGN KEY ("group_id","ledger_entry_id") REFERENCES "public"."ledger_entries"("group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- [5] 자기참조 복합 FK — 역분개 대상은 같은 모임의 실재하는 엔트리다.
--     reversal_of가 NULL이면(역분개가 아닌 엔트리) MATCH SIMPLE 규칙상 검사되지 않는다.
--     기존 `ledger_entries_reversal_of_unique`는 **건드리지 않는다** — "한 엔트리는 한 번만
--     역분개"는 그 유니크의 일이고, 이 FK가 대체하지 않는다.
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reversal_fk" FOREIGN KEY ("group_id","reversal_of") REFERENCES "public"."ledger_entries"("group_id","id") ON DELETE no action ON UPDATE no action;
