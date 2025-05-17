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
  "EPL", // English Premier League
  "UFC", // Ultimate Fighting Championship
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
  "Manchester City",
  "Newcastle United",
  "Arsenal",
  "Chelsea",
  "Aston Villa",
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
  "Burns",
  "Morales",
  "Gordon",
  "Moisés",
  "Yusuff",
  "Santos",
  "Lisboa",
  "Pennington",
  "Pinheiro",
  "Park",
  "Hernandez",
  "Mohamed Salah",
];

// Sports events, matches, and related terms
const SPORTS_EVENTS = ["Constructor score", "Preakness Stakes"];

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
    SPORTS_EVENTS.some((term) =>
      normalizedQuestion.includes(term.toLowerCase())
    )
  );
}
