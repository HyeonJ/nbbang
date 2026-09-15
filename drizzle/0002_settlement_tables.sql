CREATE TABLE "settlement_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"settlement_id" text NOT NULL,
	"membership_id" text NOT NULL,
	"display_name_at_time" text NOT NULL,
	"share_amount" integer NOT NULL,
	"is_payer" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"settlement_id" text NOT NULL,
	"from_membership_id" text NOT NULL,
	"to_membership_id" text NOT NULL,
	"amount" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"title" text NOT NULL,
	"total" integer NOT NULL,
	"payer_membership_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_group_id_key" UNIQUE("group_id","id")
);
--> statement-breakpoint
ALTER TABLE "settlement_participants" ADD CONSTRAINT "settlement_participants_settlement_fk" FOREIGN KEY ("group_id","settlement_id") REFERENCES "public"."settlements"("group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_participants" ADD CONSTRAINT "settlement_participants_membership_fk" FOREIGN KEY ("group_id","membership_id") REFERENCES "public"."memberships"("group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_transfers" ADD CONSTRAINT "settlement_transfers_settlement_fk" FOREIGN KEY ("group_id","settlement_id") REFERENCES "public"."settlements"("group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_transfers" ADD CONSTRAINT "settlement_transfers_from_fk" FOREIGN KEY ("group_id","from_membership_id") REFERENCES "public"."memberships"("group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_transfers" ADD CONSTRAINT "settlement_transfers_to_fk" FOREIGN KEY ("group_id","to_membership_id") REFERENCES "public"."memberships"("group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_payer_fk" FOREIGN KEY ("group_id","payer_membership_id") REFERENCES "public"."memberships"("group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_participants_unique" ON "settlement_participants" USING btree ("settlement_id","membership_id");