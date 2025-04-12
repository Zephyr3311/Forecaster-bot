import {
  boolean,
  decimal,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const llmLeaderboardSchema = pgTable("llm_leaderboard", {
  id: serial("id").primaryKey(),
  rankUb: integer("rank_ub").notNull(),
  rankStyleCtrl: integer("rank_style_ctrl").notNull(),
  model: text("model").notNull().unique(),
  arenaScore: integer().notNull(),
  ci: text("ci").notNull(),
  votes: integer("votes").notNull(),
  organization: text("organization").notNull(),
  license: text("license").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const marketSchema = pgTable("market", {
  id: serial("id").primaryKey(),
  conditionId: text("condition_id").notNull(),
  questionId: text("question_id").notNull(),
  question: text("question").notNull(),
  description: text("description"),
  marketSlug: text("market_slug").notNull().unique(),

  // Status flags
  active: boolean("active").default(true),
  closed: boolean("closed").default(false),
  archived: boolean("archived").default(false),
  acceptingOrders: boolean("accepting_orders").default(true),

  // Configuration
  enableOrderBook: boolean("enable_order_book").default(true),
  minimumOrderSize: integer("minimum_order_size").default(5),
  minimumTickSize: decimal("minimum_tick_size", {
    precision: 10,
    scale: 6,
  }).default("0.01"),

  // Timestamps
  acceptingOrderTimestamp: timestamp("accepting_order_timestamp"),
  endDateIso: timestamp("end_date_iso"),
  gameStartTime: timestamp("game_start_time"),

  // Additional configs
  secondsDelay: integer("seconds_delay").default(0),
  fpmm: text("fpmm").default(""),
  makerBaseFee: decimal("maker_base_fee", { precision: 10, scale: 6 }).default(
    "0"
  ),
  takerBaseFee: decimal("taker_base_fee", { precision: 10, scale: 6 }).default(
    "0"
  ),
  notificationsEnabled: boolean("notifications_enabled").default(true),

  // Risk and market references
  negRisk: boolean("neg_risk").default(false),
  negRiskMarketId: text("neg_risk_market_id"),
  negRiskRequestId: text("neg_risk_request_id"),
  is5050Outcome: boolean("is_50_50_outcome").default(false),

  // Media
  icon: text("icon"),
  image: text("image"),
});

export const tokenSchema = pgTable("token", {
  id: serial("id").primaryKey(),
  marketId: integer("market_id")
    .notNull()
    .references(() => marketSchema.id, { onDelete: "cascade" }),
  tokenId: text("token_id"),
  outcome: text("outcome"),
  price: decimal("price", { precision: 10, scale: 6 }).default("0"),
  winner: boolean("winner").default(false),
});

export const marketTagSchema = pgTable(
  "market_tag",
  {
    marketId: integer("market_id")
      .notNull()
      .references(() => marketSchema.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (t) => [primaryKey({ columns: [t.marketId, t.tag] })]
);

export const rewardRateSchema = pgTable("reward_rate", {
  id: serial("id").primaryKey(),
  marketId: integer("market_id")
    .notNull()
    .references(() => marketSchema.id, { onDelete: "cascade" }),
  assetAddress: text("asset_address").notNull(),
  rewardsDailyRate: decimal("rewards_daily_rate", {
    precision: 10,
    scale: 2,
  }).default("0"),
});

export const rewardSchema = pgTable("reward", {
  id: serial("id").primaryKey(),
  marketId: integer("market_id")
    .notNull()
    .references(() => marketSchema.id, { onDelete: "cascade" }),
  minSize: integer("min_size").default(0),
  maxSpread: decimal("max_spread", { precision: 10, scale: 2 }).default("0"),
});
