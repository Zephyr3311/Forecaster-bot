export interface LlmAreena {
  arenaMetadata: ArenaMetadata;
  categoryMetadata: CategoryMetadata;
  leaderboards: LlmAreenaLeaderboard[];
  categories: Category[];
  plots: Plot[];
}

export type LeaderboardResponse = {
  data: LlmAreena | null;
  htmlSize: number;
  timestamp: number;
  htmlContent?: string;
  error?: string;
} | null;

export interface ArenaMetadata {
  name: string;
  slug: string;
  description: string;
}

export interface Category {
  id: string;
  arenaId: string;
  name: string;
  slug: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  leaderboards: CategoryLeaderboard[];
}

export interface CategoryLeaderboard {
  id: string;
  leaderboardCategoryId: string;
  name: string;
  leaderboardType: LeaderboardType;
  isPrivate: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export enum LeaderboardType {
  Default = "default",
  RemoveStyleControl = "remove-style-control",
}

export interface CategoryMetadata {
  name: string;
  slug: string;
}

export interface LlmAreenaLeaderboard {
  id: string;
  leaderboardCategoryId: string;
  name: string;
  leaderboardType: LeaderboardType;
  isPrivate: boolean;
  createdAt: Date;
  updatedAt: Date;
  entries: Entry[];
  totalVotes: number;
  totalModels: number;
  lastUpdated: Date;
  icon: Array<IconClass | null | string>;
  categorySlug: string;
}

export interface Entry {
  id: string;
  leaderboardId: string;
  modelName: string;
  modelOrganization: string;
  modelUrl: string;
  license: string;
  score: number;
  votes: number;
  confidenceIntervalLower: number;
  confidenceIntervalUpper: number;
  metadata: null;
  isDeprecated: boolean;
  createdAt: Date;
  updatedAt: Date;
  rank: number;
  rankStyleControl?: number;
}

export interface IconClass {
  ref: string;
  xmlns: string;
  width: number;
  height: number;
  viewBox: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeLinecap: string;
  strokeLinejoin: string;
  className: string;
  children: Array<Array<ChildClass | string> | string>;
}

export interface ChildClass {
  d: string;
}

export interface Plot {
  id: string;
  leaderboardId: string;
  plotType: string;
  data: Data;
  createdAt: string;
  updatedAt: string;
}

export interface Data {
  modelWinRates?: ModelWinRate[];
  models?: string[];
  values?: Array<Array<number | null>>;
  modelRatings?: ModelRating[];
}

export interface ModelRating {
  score: number;
  modelName: string;
  confidenceIntervalLower: number;
  confidenceIntervalUpper: number;
}

export interface ModelWinRate {
  winRate: number;
  modelName: string;
}
