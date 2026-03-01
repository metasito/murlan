# Murlan - Card Game App

A mobile card game app built with Expo React Native.

## Overview

Murlan is a classic Italian card game app with the following features:
- Full offline single-player (vs AI opponents)
- Local multiplayer pass-and-play (2-4 players)
- Complete game engine with all combination rules
- AI with 3 difficulty levels (Easy, Medium, Hard)
- Teams mode for 4 players

## Tech Stack

- **Frontend:** Expo Router (React Native)
- **Backend:** Express.js (API server on port 5000)
- **State:** React Context + useState
- **Fonts:** @expo-google-fonts/rajdhani + @expo-google-fonts/inter
- **Animations:** react-native-reanimated
- **Orientation:** expo-screen-orientation (landscape lock for game screen)

## Architecture

### App Structure (no tabs - stack navigation)
```
app/
  _layout.tsx       # Root layout with fonts, providers
  index.tsx         # Home screen
  lobby.tsx         # Game setup screen
  game.tsx          # Game table screen (landscape locked)
  result.tsx        # End game results
  rules.tsx         # Rules & FAQ screen
```

### Key Files
```
lib/gameEngine.ts      # Complete game logic (cards, combos, AI)
context/GameContext.tsx # Game state management
components/CardView.tsx # Card rendering (noLift prop for fan use)
constants/colors.ts    # Dark felt theme colors
```

## Design

- Dark green felt theme (#061410 background, #0B3B25 felt)
- Gold accent (#C9A84C)
- Fonts: Rajdhani (headers) + Inter (body)
- Animations with react-native-reanimated

## Game Rules

- 54-card deck (52 + 2 jokers)
- Card strength: Joker★ > Joker > 2 > A > K > Q > J > 10 > ... > 3
- Combinations: Single, Pair, Triple, Straight (min 3)
- Start: player with 3♥ goes first
- Win: first to empty hand wins

## Game Screen Design

- **Orientation:** Landscape only (forced via expo-screen-orientation on mount, restored on unmount)
- **Layout:** Full-screen landscape — table in upper area, hand at bottom
- **Table:** Large rounded rectangle with dark green felt + gold border
- **Opponents:** Avatar circles with initials + card fans, compass positions (top-center, left-center, right-center)
- **Played pile:** Last 4 combos stacked/overlapping on table center
- **Hand:** Straight horizontal spread (no arc rotation), cards lift UP on selection
- **PASSA:** Dark crimson pill button bottom-left (disabled when starting a round)
- **GIOCA:** Gold gradient pill button bottom-right (appears active only when valid combo selected)
- **Timer:** 20-second countdown shown inline in top bar; auto-pass when expired

## Workflows

- **Start Backend:** `npm run server:dev` (port 5000)
- **Start Frontend:** `npm run expo:dev` (port 8081)
