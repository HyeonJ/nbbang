CREATE TABLE "dues_round_members" (
	"group_id" text NOT NULL,
	"round_id" text NOT NULL,
	"membership_id" text NOT NULL,
	CONSTRAINT "dues_round_members_pk" PRIMARY KEY("round_id","membership_id"),
	CONSTRAINT "dues_round_members_group_round_membership_key" UNIQUE("group_id","round_id","membership_id")
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "left_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "left_reason" text;--> statement-breakpoint
ALTER TABLE "dues_round_members" ADD CONSTRAINT "dues_round_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues_round_members" ADD CONSTRAINT "dues_round_members_round_fk" FOREIGN KEY ("group_id","round_id") REFERENCES "public"."dues_rounds"("group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues_round_members" ADD CONSTRAINT "dues_round_members_membership_fk" FOREIGN KEY ("group_id","membership_id") REFERENCES "public"."memberships"("group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_left_consistency" CHECK (("memberships"."left_at" is null) = ("memberships"."left_reason" is null));--> statement-breakpoint
-- backfill:start
UPDATE "memberships" AS m
   SET "left_at" = u."deleted_at", "left_reason" = 'withdrawn'
  FROM "user" AS u
 WHERE u."id" = m."user_id" AND u."deleted_at" IS NOT NULL AND m."left_at" IS NULL;--> statement-breakpoint
INSERT INTO "dues_round_members" ("group_id", "round_id", "membership_id")
SELECT r."group_id", r."id", m."id"
  FROM "dues_rounds" AS r
  JOIN "memberships" AS m ON m."group_id" = r."group_id" AND m."joined_at" <= r."created_at"
                         AND (m."left_at" IS NULL OR m."left_at" > r."created_at")
UNION
SELECT p."group_id", p."round_id", p."membership_id"
  FROM "dues_payments" AS p
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- backfill:end
ALTER TABLE "dues_payments" ADD CONSTRAINT "dues_payments_roster_fk" FOREIGN KEY ("group_id","round_id","membership_id") REFERENCES "public"."dues_round_members"("group_id","round_id","membership_id") ON DELETE no action ON UPDATE no action;
