export type LlmArenaLeaderboard = {
  "Rank* (UB)": number;
  "Rank (StyleCtrl)": number;
  Model: string;
  "Arena Score": number;
  "95% CI": string;
  Votes: number;
  Organization: string;
  License: string;
};

export interface GradioResult {
  data: {
    value: {
      data: any[][];
    };
    headers: string[];
  }[];
}
