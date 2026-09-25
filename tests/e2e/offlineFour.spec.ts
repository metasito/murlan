import { offlineHandTests } from "./helpers/offlineHand";

offlineHandTests([
  { name: "4 players, free-for-all", playerCount: 4, gameMode: "free_for_all" },
  { name: "4 players, teams", playerCount: 4, gameMode: "teams" },
]);
