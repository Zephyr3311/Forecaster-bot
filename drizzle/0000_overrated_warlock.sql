CREATE TABLE "market" (
	"id" serial PRIMARY KEY NOT NULL,
	"condition_id" text NOT NULL,
	"question_id" text NOT NULL,
	"question" text NOT NULL,
	"description" text,
	"market_slug" text,
	"active" boolean DEFAULT true,
	"closed" boolean DEFAULT false,
	"archived" boolean DEFAULT false,
	"accepting_orders" boolean DEFAULT true,
	"enable_order_book" boolean DEFAULT true,
	"minimum_order_size" integer DEFAULT 5,
	"minimum_tick_size" numeric(10, 6) DEFAULT '0.01',
	"accepting_order_timestamp" timestamp,
	"end_date_iso" timestamp,
	"game_start_time" timestamp,
	"seconds_delay" integer DEFAULT 0,
	"fpmm" text DEFAULT '',
	"maker_base_fee" numeric(10, 6) DEFAULT '0',
	"taker_base_fee" numeric(10, 6) DEFAULT '0',
	"notifications_enabled" boolean DEFAULT true,
	"neg_risk" boolean DEFAULT false,
	"neg_risk_market_id" text,
	"neg_risk_request_id" text,
	"is_50_50_outcome" boolean DEFAULT false,
	"icon" text,
	"image" text,
	CONSTRAINT "market_question_id_unique" UNIQUE("question_id")
);
--> statement-breakpoint
CREATE TABLE "market_tag" (
	"market_id" integer NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "market_tag_market_id_tag_pk" PRIMARY KEY("market_id","tag")
);
--> statement-breakpoint
CREATE TABLE "reward_rate" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"asset_address" text NOT NULL,
	"rewards_daily_rate" numeric(10, 2) DEFAULT '0'
);
--> statement-breakpoint
CREATE TABLE "reward" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"min_size" integer DEFAULT 0,
	"max_spread" numeric(10, 2) DEFAULT '0'
);
--> statement-breakpoint
CREATE TABLE "token" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"token_id" text,
	"outcome" text,
	"price" numeric(10, 6) DEFAULT '0',
	"winner" boolean DEFAULT false
);
--> statement-breakpoint
ALTER TABLE "market_tag" ADD CONSTRAINT "market_tag_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_rate" ADD CONSTRAINT "reward_rate_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward" ADD CONSTRAINT "reward_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token" ADD CONSTRAINT "token_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE cascade ON UPDATE no action;