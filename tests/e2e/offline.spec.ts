import { offlineHandTests } from "./helpers/offlineHand";

offlineHandTests([
  { name: "2 players, free-for-all", playerCount: 2, gameMode: "free_for_all" },
  { name: "3 players, free-for-all", playerCount: 3, gameMode: "free_for_all" },
]);
