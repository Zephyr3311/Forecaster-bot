// Sports leagues and tournaments
const SPORTS_LEAGUES = [
  "NBA",
  "NFL",
  "MLB",
  "NHL",
  "PGA",
  "UEFA",
  "FIFA",
  "Grand Prix",
  "Championship",
  "Tournament",
  "Olympics",
  "League",
  "Playoffs",
];

// Sports teams
const SPORTS_TEAMS = [
  "Trail Blazers",
  "Wizards",
  "Nets",
  "Suns",
  "Jazz",
  "Mavericks",
  "Celtics",
  "Timberwolves",
  "Knicks",
  "Pacers",
  "Nuggets",
  "Thunder",
  "Cavaliers",
  "McLaren",
  "Racing Bulls",
  "Virtus.pro",
  "Natus Vincere",
  "paiN",
  "Aurora",
  "MongolZ",
];

// Player names and sports figures
const SPORTS_PLAYERS = [
  "Keith Mitchell",
  "Keegan Bradley",
  "Jordan Spieth",
  "Justin Thomas",
  "Collin Morikawa",
  "Russell Henley",
  "Patrick Cantlay",
  "Viktor Hovland",
];

// Sports events, matches, and related terms
const SPORTS_EVENTS = [
  "Finals",
  "matchup",
  "Game",
  "Match",
  "win",
  "beat",
  "score",
  "Draft Lottery",
  "Advance",
  "Constructor score",
  "Preakness Stakes",
];

// Sports-specific actions and terminology
const SPORTS_TERMINOLOGY = [
  "win",
  "beat",
  "score",
  "finish",
  "qualify",
  "advance",
  "highest",
];

// Function to check if a market is sports-related
export function isSportsMarket(marketQuestion: string): boolean {
  const normalizedQuestion = marketQuestion.toLowerCase();

  // Check each category
  return (
    SPORTS_LEAGUES.some((term) =>
      normalizedQuestion.includes(term.toLowerCase())
    ) ||
    SPORTS_TEAMS.some((term) =>
      normalizedQuestion.includes(term.toLowerCase())
    ) ||
    SPORTS_PLAYERS.some((term) =>
      normalizedQuestion.includes(term.toLowerCase())
    ) ||
    (SPORTS_EVENTS.some((term) =>
      normalizedQuestion.includes(term.toLowerCase())
    ) &&
      SPORTS_TERMINOLOGY.some((term) =>
        normalizedQuestion.includes(term.toLowerCase())
      ))
  );
}
