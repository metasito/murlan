# Albanian card terminology: the joker's name, and the declension problem

Research for the owner's two reports: (1) the black joker is called three different things
across `en.ts` / `it.ts` / `sq.ts`, and (2) Albanian needs a different form of the card name
depending on where it lands in a sentence — *"xholi i zi or xhol i zi or xhol te zi
depending on the case"*. No file other than this one was changed.

**Repo facts used below** (read from `locales/*.ts`, `lib/cardNames.ts`, `shared/i18n.ts`,
`components/ExchangeAnnouncement.tsx`, `components/CardView.tsx`, `app/rules.tsx`,
`app/lobby.tsx`, `docs/RULES.md`):

- `shared/i18n.ts:26` interpolates by **name**, not position:
  `template.replace(/\{\{(\w+)\}\}/g, …)`. **Placeholder order is free per locale.** This is
  the fact the whole recommendation rests on — Albanian may reorder `{{card}}`, `{{from}}`
  and `{{to}}` inside its own string without touching English, Italian or any component.
- `lib/cardNames.ts:47` builds a card name from `cards.nameFormat` for ordinary cards, and
  from `cardView.jokerColored` / `cardView.jokerBlack` for the two jokers. It is called from
  `CardView` (`accessibilityLabel`), `ExchangeModal`, `ExchangeAnnouncement` (both the
  spoken label and a visible line) and `GameTable`.
- `cards.suit*` and `cards.rank*` reach the user **only through `cardSpokenName`** — i.e.
  they are screen-reader vocabulary plus the one visible line in `ExchangeAnnouncement`.
  Nothing draws a suit word on a card face.
- `components/CardView.tsx:547` paints `joker_colored` in `Colors.heart` and `joker_bw` in
  `Colors.cardInk`. **The two cards render red and black.** Neither renders black-and-white.
- `exchangeAnnouncement.giveLine` is used **only** as the modal's `accessibilityLabel`
  (`ExchangeAnnouncement.tsx:136-152`). The *visible* line is assembled from five spans:
  `{from}` · `givesWord` · `{card}` · `toWord` · `{to}` (lines 232-238) — a fixed order the
  locale file cannot change.
- `rules.strengthCard` (`app/rules.tsx:299`) and `lobby.ruleCard` (`app/lobby.tsx:572`) set
  `minWidth` only — no `maxWidth`, no `numberOfLines`. Labels widen their card.

---

## Recommendation

1. **One name for the black card, in all three languages: it is black.** Kill every `B/W`
   and `B/N`. `en` "Black Joker", `it` "Joker nero", `sq` **"Xholi i zi"** — the last is not
   a guess, it is the exact wording of the Tier-1 Albanian rules text already cited in
   `docs/RULES.md`.
2. **The Albanian for the other joker is "Xholi i kuq" (red), not "Xholi me ngjyrë".** In
   Albanian card vocabulary **`ngjyrë` means *suit***, not "colour" — the dictionary defines
   a suit as *"njërën nga të katër **ngjyrat** e lojës së letrave"* and the rules text says
   a straight is legal *"nuk ka rëndësi nëse kanë **ngjyra** të ndryshme"* ("it doesn't
   matter if they are of different **suits**"). "Xholi me ngjyrë" therefore reads as *"the
   joker that has a suit"* — which is precisely the thing a joker does not have. `i kuq` is
   what the source says, and it is what the app already draws.
3. **The citation-form strategy holds.** Every one of the 26 keys can be written with the
   card name in its dictionary form, with **zero new keys and zero component changes** —
   because interpolation is name-keyed, so Albanian can put `{{card}}` last. There is
   exactly one hard case (`exchangeAnnouncement.givesWord`/`toWord`, whose order is fixed in
   JSX), and it is solved by making the Albanian connectives arrows rather than words.
4. **The declension problem is bigger than the joker, and worse for player names.**
   `giveLine` also drops a *username* into a slot that Albanian wants in the **dative**
   (`Benit`, not `Beni`) — and a username can never be inflected. `result.bothJokersBody`
   drops one into an adjective agreement (`fillon i lirë` is masculine; a woman needs
   `e lirë`) — and gender is not knowable. Those two are unfixable by any locale string and
   need the sentence reshaped. Italian has the same gender bug in `inizia libero`.
5. **Two of the four Albanian suit names are wrong** (§e). ♣ is `spathi`, not `Trefla`; ♠ is
   `maç`, not `Pika` — and ♠ is the suit the game names out loud most often, because the 3♠
   opens every session.

**Count.** §d covers 26 keys: **20 CONFIRMED** against a cited source, **6 NEEDS OWNER
REVIEW** — plus one cross-cutting Italian `Jolly`/`Joker` decision and one Albanian
capitalisation convention, both judgment calls. §e adds 9 further findings: 3 CONFIRMED,
5 NEEDS OWNER REVIEW, 1 unverified.

---

## Sources

| # | Source | What it is | Used for |
|---|---|---|---|
| **S1** | `visixplay.com/murlan/rules.php?lang=al` | The Albanian Murlan rules text, already Tier 1 in `docs/RULES.md`. Fetched raw (not via a summariser) 2026-08-20. | Joker names, rank names, combination names, ♠ = `maç` |
| **S2** | `fjale.al` — entries `letër`, `xhol`, `spathi`, `maç`, `kupë`, `karo`, `zonjë` | An online reproduction of the *Fjalor i Gjuhës Shqipe* tradition; its entry formatting (`~, ~U m. ~NJ, ~NJTË`) is FGJSSH house style. **The site does not name its edition** — treat the wording as the dictionary's, the edition as unverified. | `xhol` as a headword, all four suit definitions, the `rank + suit` phrase pattern |
| **S3** | `fjalori.online/pasqyrat` — *Fjalor i Madh i Gjuhës Shqipe*, Akademia e Shkencave e Shqipërisë | The Academy's own grammatical paradigm tables. | Masculine noun declension (`mal / mali / malin / malit`) |
| **S4** | `sq.wikipedia.org/wiki/Mbiemri` | Albanian-language statement of linked-adjective agreement. | The case paradigm, in Albanian: *"Mjeku i ri / I,e mjekut të ri / Mjekun e ri"* |
| **S5** | `en.wikipedia.org/wiki/Albanian_morphology` | The *nyja e përparme* clitic table. | Definite: nom `i`, acc `e`, dat/abl `të`. Indefinite: nom `i`, acc/dat/abl `të` |
| **S6** | `en.wiktionary.org/wiki/zi#Albanian` | | `i zi` / `e zezë` / `të zinj` / `të zeza` |
| **S7** | `sq.wikipedia.org/wiki/Pesëkatëshi` | Albanian Wikipedia on an Albanian card game. | Independent corroboration of the four suit names |
| **S8** | Newmark, Hubbard & Prifti, *Standard Albanian: A Reference Grammar for Students*, Stanford University Press 1982, ISBN 0-8047-1129-1 | The standard English-language reference grammar. | Cited as the published authority. **Bibliographic record verified; the pages were not read** — S3/S4/S5 are what the paradigms below actually come from |
| **S9** | `shqiperia.com/Parafjala`, `tradita.org` (*Pjesë nga gramatika e gjuhës shqipe*) | | `te`, `tek`, `nga` govern the **nominative** |

Not consulted, and it should be: **Akademia e Shkencave e Shqipërisë, *Gramatika e Gjuhës
Shqipe I — Morfologjia* (Tiranë, 1995)** is the canonical printed grammar. Nothing below
contradicts it as far as I know, but I read S3/S4/S5 instead and cannot claim otherwise.

---

## (a) Albanian card-game vocabulary

### The jokers

S1, fetched as raw HTML, contains all three of these:

| Where in S1 | Albanian, verbatim | Form |
|---|---|---|
| the rank ladder | `… 2, Xhol i Zi dhe Xhol i Kuq.` | indefinite nominative |
| the strength summary | `Letrat me vlerë më të lartë janë As, 2, Xholi i Zi dhe Xholi i Kuq.` | **definite nominative** |
| the exchange exception | `… kur lojtarit të fundit i kanë ardhur të dy xholat (i ziu dhe i kuqi).` | definite plural; adjectives nominalised |
| again | `… kur i kanë ardhur të 2 Xholat (në ketë rast nuk ndërrohen letra)` | definite plural |

Three things follow, and all three are usable directly:

- **`Xholi i zi` and `Xholi i kuq` are the sourced names.** `docs/RULES.md` §2 already quotes
  this line; the header of `sq.ts` already claims these as SOURCED. The file simply does not
  use them consistently.
- **`Xhol` is a real Albanian headword**, not a transliteration someone invented. S2:
  *"**XHOL** II m. — Figurë e veçantë në letra, që përdoret në vend të çdo letre tjetër"*
  ("a special figure among the cards, used in place of any other card"), masculine.
  Declines `xhol` / `xholi` / `xholin` / `xholit`, plural `xhola` / `xholat`.
- **S1 never once writes `bardh`.** There is no Albanian source anywhere for a
  black-and-white joker. `Xholi B/Z` in `sq.ts` is a machine rendering of the English
  `B/W`, and the English `B/W` is itself contradicted by `cardView.jokerBlack` = "Black
  Joker" and by the card's own ink colour.
- **`ngjyrë` = suit.** S2 (`spathi`): *"Që i përkon njërës nga të katër **ngjyrat** e lojës
  së letrave"*. S1: *"nuk ka rëndësi nëse kanë **ngjyra** të ndryshme"*. This is exactly the
  Italian *colore* / German *Farbe* usage. **`Xholi me ngjyrë` is therefore not a neutral
  paraphrase of "Colored Joker" — it is a category error in Albanian.**

### Suits — two of four in `sq.ts` are wrong

S2, verbatim, with the current `sq.ts` value beside it:

| Suit | S2 definition (verbatim) | Attested word | `sq.ts` today | |
|---|---|---|---|---|
| ♥ | *"Një nga katër llojet e letrave të bixhozit, me shenjë si **zemër** në ngjyrë të kuqe"* | **kupë** (pl. `kupa`, `kupat`) | `Kupa` | ✅ |
| ♦ | *"Një nga katër llojet e letrave të bixhozit me shenjë si **romb** në ngjyrë të kuqe"* | **karo** | `Karo` | ✅ |
| ♣ | *"…paraqitet me një **tërfil të zi me tri gjethe**"* (a black trefoil, three leaves) | **spathi** | `Trefla` | ❌ |
| ♠ | *"Njëra nga të dy ngjyrat e zeza …, që shënohet me një figurë në trajtën e **gjethes me bisht**"* (a leaf with a stem) | **maç** | `Pika` | ❌ |

Corroborated twice over: S1 opens the game with *"ai lojtar që ka **3 maç**"* — and
`docs/RULES.md` §4 records that the same page's English says *"3 of spades"*. S7 lists
`kupa, karo, spathi, maç` as the four. `Trefla` and `Pika` appear in neither, and I could
not attest either as a card suit anywhere. (`Pika` looks like German *Pik*; `Trefla` like a
calque of *trefoil*. **Unverified** whether Kosovo colloquial usage differs from the Tirana
dictionary here — that is a genuine dialect question I could not settle.)

### The `rank + suit` pattern is already right

S2's own examples under `spathi` and `maç`: **`Fanti spathi`**, **`Çupa spathi`**,
**`Dyshi spathi`**, **`Asi (mbreti) maç`**. Definite rank, bare suit, no preposition — which
is precisely `cards.nameFormat` = `"{{rank}} {{suit}}"`. And `lib/cardNames.ts:33` returns a
numeric rank as its own digit, giving `3 maç` — S1's exact phrase. **The format string is
native and needs no change; only the suit *values* are wrong.**

### Ranks

| | `sq.ts` | S1 | S2 | verdict |
|---|---|---|---|---|
| J | `Fanti` | `Fant (Jan)` | `Fanti spathi` | ✅ confirmed |
| Q | `Zonja` | `Çupë` | `Çupa spathi` | ⚠️ **both sources say `Çupa`.** S2's `zonjë` entry has six senses and **none is a playing card** |
| K | `Mbreti` | `Mbret` | `(mbreti) maç` | ✅ confirmed |
| A | `Asi` | `As` | `Asi (mbreti) maç` | ✅ confirmed |
| straight | `Shkallë` | `Shkalla duhet të ketë të paktën 5 letra` | — | ✅ confirmed |
| card | `letër` / `letra` | throughout | *"Letra bixhozi"* | ✅ confirmed |

### Combinations — S1 has a full set the file does not use

S1: *"**Letër teke**, **dyshe** me të njëjtën vlerë …, **treshe** me të njëjtën vlerë …,
**katërshe** me të njëjtën vlerë … dhe **shkallë**."* Also *"Lojtari **bën pas**"* (passes),
*"**hedh**"* (plays/throws), *"letrat **shkartisen**"* (are shuffled), *"**dorë**"* (hand).
`sq.ts` uses `E vetme` / `Çift` / `Tresh` / `Bombë` instead — see §e.

### Gheg / Tosk / Kosovo

S1 is standard (Tosk-based) literary Albanian, but it is a **translation of an Italian
page**, not native-authored rules — its Albanian is sound but its *register* is that of a
translator. S2 is Tirana-normative. Neither is Kosovar. `Çupë` is homely/colloquial where
`Zonjë` is formal; `maç`/`spathi` are the Tirana dictionary's words. **I could not verify
what a Kosovo player actually says.** Everything below is Albania-normative; if the beta
testers are Kosovar, that is worth one question to them.

---

## (b) The declension, and why one flat string cannot cover it

### Two moving parts

**1. The noun.** `xhol` is a masculine noun. S3 (Academy of Sciences paradigm tables), on
`mal`, which `xhol` follows exactly:

| Case | indefinite sg | definite sg | indefinite pl | definite pl |
|---|---|---|---|---|
| Emërore (nom.) | (një) mal | mal**i** | (ca) male | male**t** |
| Gjinore (gen.) | i mali | i mal**it** | i maleve | i maleve |
| Dhanore (dat.) | mali | mal**it** | maleve | maleve |
| Kallëzore (acc.) | mal | mal**in** | male | male**t** |
| Rrjedhore (abl.) | prej mali | prej mal**it** | prej malesh | prej maleve |

→ `xhol` · `xholi` · `xholin` · `xholit`; plural `xhola` · `xholat`.

**2. The adjective's proclitic article** (*nyja e përparme*). `i zi` is a *linked* adjective
— it carries a little article that agrees with the head noun in gender, number, case **and
definiteness**. S5:

| | nominative | accusative | dative / ablative |
|---|---|---|---|
| **definite**, masc. sg. | **i** | **e** | **të** |
| **indefinite**, masc. sg. | **i** | **të** | **të** |

S4 states the same rule in Albanian, with a worked example:
*"Mjeku **i** ri / I,e mjekut **të** ri / Mjekun **e** ri"*.

### "The black joker", fully declined

| | indefinite | definite |
|---|---|---|
| **Emërore** (subject) | një xhol **i** zi | xholi **i** zi |
| **Kallëzore** (direct object) | një xhol **të** zi | xholi**n e** zi |
| **Dhanore / Rrjedhore** | një xholi **të** zi | xholi**t të** zi |
| **Gjinore** | i një xholi **të** zi | i xholi**t të** zi |
| **plural** (the app only ever needs the bare noun) | xhola | xhola**t** |

**"The coloured/red joker"** is identical, with `i kuq` (S6: fem. `e kuqe`, masc. pl.
`të kuq`): `xholi i kuq` · `xholin e kuq` · `xholit të kuq`.

Note that the plural is where it stops hurting: Albanian masculine definite plurals are
**identical in nominative and accusative** (`malet` / `malet`). That is why the existing
`të dy Xholat` strings are already grammatical wherever they appear — S1 writes exactly
`të dy xholat` both as a subject and as an object.

**`Xholi me ngjyrë`, by contrast, does not decline at all** — `me ngjyrë` is a prepositional
phrase, so only the noun moves (`xholin me ngjyrë`). That is a *convenience*, and it is the
one thing the current wording has going for it. It is not worth the price of naming the
card after the thing it does not have (§a).

### So: three sentences, three forms

| English | Albanian | why |
|---|---|---|
| **The black joker** is the second strongest. | **Xholi i zi** është i dyti për forcë. | subject → definite nominative |
| Ana gives him **the black joker**. | Ana i jep **xholin e zi**. | direct object → definite accusative |
| He beat it with **the black joker**. | E mundi me **një xhol të zi**. | after `me` → indefinite accusative |
| Win without playing **any joker**. | Fito pa luajtur **asnjë xhol**. | `asnjë` forces the bare indefinite |

A single flat `"Xholi i zi"` dropped into slots 2, 3 and 4 produces `Ana i jep xholi i zi`,
`me xholi i zi`, `asnjë xholi i zi` — all three ungrammatical, and the last one is **already
shipping**, in `achievements.purist.desc` (§e).

### The part the brief did not mention: the names

`exchangeAnnouncement.giveLine` = `"{{from}} gives {{card}} to {{to}}"`. Albanian wants
`Ana i jep **Benit** xholin e zi` — the recipient in the **dative**, `Ben` → `Benit`.
`{{to}}` is a *username*. It can never be inflected, by any strategy, ever. Today's
`sq.ts` string leaves it bare (`{{from}} i jep {{card}} {{to}}`), which reads as two nouns
shoved together. **The name is a harder case than the card**, and it is what forces the
answer in §c.

---

## (c) Does the citation-form strategy hold? Yes — with one substitution and one exception

The strategy works because of `shared/i18n.ts:26`: interpolation is a **name-keyed regex
replace**, so a locale may place `{{card}}` anywhere in its own template, including last,
without touching the other two locales or any component. Slot by slot:

| Slot | Grammatical demand in Albanian | Holds? |
|---|---|---|
| `cardView.joker*`, `lobby.rankJoker*`, `rules.strengthJoker*` | none — bare label | ✅ citation form is *correct*, not merely tolerated |
| `cards.nameFormat` | none — S2's attested `rank + suit` pattern | ✅ unchanged |
| `rules.faq.a3`, `a11` (bullets and ladders) | none — list item | ✅ |
| `rules.faq.a10` parenthetical | nominalised adjectives | ✅ and **S1 supplies it verbatim**: `(i ziu dhe i kuqi)` |
| `rules.faq.a15`, `a17`, `q11`, `tip` | the noun is a **literal** in the string, not `{{card}}` | ✅ the translator writes whatever case the sentence needs |
| `tutorial.beat.exchange.instruction` | needs definite **accusative** — but again a literal | ✅ write `Xholin e kuq` directly. **No second key needed** |
| `result.bothJokersTitle`, `a11yNoSwap`, `noSwapText` | definite plural, nom = acc | ✅ |
| `exchangeAnnouncement.giveLine` (spoken) | dative recipient + accusative object | ✅ **by reordering**: `Nga {{from}} te {{to}}: {{card}}`. `nga` and `te` both govern the **nominative** (S9), so an uninflectable username is correct as-is, and the card lands after a colon in citation form |
| `exchangeAnnouncement.givesWord` / `toWord` (visible) | same — **but the span order is fixed in JSX** and no locale can reorder it | ⚠️ **the one hard slot.** Solved without code: make the Albanian connectives arrows, `" → "` / `" → "`, giving `Ana → Xholi i zi → Beni` — verbless, nothing to inflect, and it mirrors the `Name → [card] → Name` row directly above it |
| `result.bothJokersBody` | `{{name}} fillon **i lirë**` — masculine **gender agreement on a username** | ❌ **citation form cannot help.** Not a case problem. Needs the sentence rewritten to have no agreeing adjective. *Italian has the identical bug: `inizia libero`* |

**So: no accusative key is genuinely needed anywhere.** The one place the accusative is
required (`tutorial.beat.exchange.instruction`) has the card name as a hardcoded literal, so
the Albanian translator just writes the accusative. **Zero new keys. Zero component
changes.** The only slot that resists — `givesWord`/`toWord` — resists because of JSX span
order, not grammar, and the arrow substitution costs nothing.

**Optional follow-up, owner's call:** the visible desc line in `ExchangeAnnouncement.tsx`
(lines 232-238, 257-263) restates in words what the row above it already shows as
`Name → card → Name`. Deleting the line and the two keys would remove the hard slot
outright. That is a component change and outside this brief; recorded here, not done.

---

## (d) Proposed strings

`joker_bw` in `lib/gameEngine.ts` is untouched — display strings only.

### Short keys

| # | Key | en | it | sq | Status |
|---|---|---|---|---|---|
| 1 | `cardView.jokerColored` | `Colored Joker` *(unchanged)* | `Joker colorato` *(unchanged)* | **`Xholi i kuq`** | **CONFIRMED** (S1 `Xholi i Kuq`; card renders `Colors.heart`) |
| 2 | `cardView.jokerBlack` | `Black Joker` *(unchanged)* | `Joker nero` *(unchanged)* | **`Xholi i zi`** | **CONFIRMED** (S1 `Xholi i Zi`) |
| 3 | `lobby.rankJokerColored` | `Colored Joker` | **`Joker colorato`** | **`Xholi i kuq`** | **CONFIRMED** (sq); it/en = casing only |
| 4 | `lobby.rankJokerBlack` | **`Black Joker`** | **`Joker nero`** | **`Xholi i zi`** | **CONFIRMED** |
| 5 | `rules.strengthJokerColored` | `Colored Joker` | **`Joker colorato`** | **`Xholi i kuq`** | **NEEDS OWNER REVIEW** — unabbreviating `Joker Col.` widens the card. No `maxWidth`/`numberOfLines` is set and today's sq label (`Xholi me Ngjyrë`, 15 chars) is already longer, so it should fit; only an e2e run proves it |
| 6 | `rules.strengthJokerBlack` | **`Black Joker`** | **`Joker nero`** | **`Xholi i zi`** | **CONFIRMED** |
| 7 | `cards.nameFormat` | `{{rank}} of {{suit}}` *(unchanged)* | `{{rank}} di {{suit}}` *(unchanged)* | `{{rank}} {{suit}}` *(unchanged)* | **CONFIRMED** — S2's own examples (`Fanti spathi`, `Asi maç`); S1's `3 maç`. Fix the *suit values*, §e-1 |
| 8 | `exchangeAnnouncement.giveLine` | `{{from}} gives {{card}} to {{to}}` *(unchanged)* | `{{from}} dà {{card}} a {{to}}` *(unchanged)* | **`Nga {{from}} te {{to}}: {{card}}`** | **NEEDS OWNER REVIEW** — the *structure* is confirmed (S9: `nga`/`te` take the nominative, so a username is safe; card in citation form after the colon). The phrasing is my judgment, not a citation |
| 9 | `exchangeAnnouncement.givesWord` | `" gives "` *(unchanged)* | `" dà "` *(unchanged)* | **`" → "`** | **NEEDS OWNER REVIEW** — grammatically forced (§c), but "an arrow instead of a verb" is a design call |
| 10 | `exchangeAnnouncement.toWord` | `" to "` *(unchanged)* | `" a "` *(unchanged)* | **`" → "`** | **NEEDS OWNER REVIEW** — same |
| 11 | `exchangeAnnouncement.a11yNoSwap` | `Exchange: no exchange, {{loserName}} showed both Jokers` *(unchanged)* | `Scambio: nessuno scambio, {{loserName}} ha mostrato entrambi i **Joker**` | **`Shkëmbim: pa shkëmbim, {{loserName}} tregoi të dy xholat`** | **CONFIRMED** (sq) — S1's exact `të dy xholat`; only the capital drops. it: `Jolly`→`Joker`, see note |
| 12 | `exchangeAnnouncement.noSwapText` | **`No exchange — both Jokers 🃏`** | **`Nessuno scambio — entrambi i Joker 🃏`** | **`Pa shkëmbim — të dy xholat 🃏`** | **NEEDS OWNER REVIEW** (en/it: "double Joker" → "both Jokers" is a wording change). sq phrase itself is **CONFIRMED** from S1 |
| 13 | `result.bothJokersTitle` | `THE LOSER HAS BOTH JOKERS!` *(unchanged)* | `IL PERDENTE HA ENTRAMBI I **JOKER**!` | `HUMBËSI KA TË DY XHOLAT!` *(unchanged)* | **CONFIRMED** — sq already correct (definite plural, nom = acc) |
| 14 | `result.bothJokersBody` | **`{{name}} opens the new hand.\nNo exchange.`** | **`{{name}} apre la nuova mano.\nNessuno scambio.`** | **`{{name}} hap dorën e re.\nPa shkëmbim.`** | **NEEDS OWNER REVIEW** — fixes a real gender bug in **both** sq (`i lirë`) and it (`libero`), but changes the English sense from "starts free". The rule it describes is `docs/RULES.md` §10 |
| 15 | `rules.faq.q11` | `What are the Jokers?` *(unchanged)* | `Cosa sono i Joker?` *(unchanged)* | **`Çfarë janë xholat?`** | **CONFIRMED** — lowercase only |
| 16 | `tutorial.beat.exchange.tip` | *(unchanged)* | `…entrambi i **Joker**…` | `…TË DY xholat…` (was `TË DY Xholat`) | **CONFIRMED** — casing only |
| 17 | `achievements.purist.desc` | `Win a hand without playing any Joker.` *(unchanged)* | `Vinci una mano senza giocare nessun **Joker**.` | **`Fito një dorë pa luajtur asnjë xhol.`** | **CONFIRMED** — `asnjë` requires the bare indefinite (S3 paradigm). `asnjë Xholi` is currently **ungrammatical** |
| 18 | `achievements.wildCard.desc` | *(unchanged)* | `…sia una Bomba che un **Joker**.` | **`Fito një dorë pasi ke luajtur si një bombë ashtu edhe një xhol.`** | **CONFIRMED** — was `edhe Xholi` (definite where indefinite is required) |
| 19 | `achievements.minimalist.desc` | *(unchanged)* | `…Bombe né **Joker**.` | **`Fito një dorë pa luajtur bomba apo xhola.`** | **CONFIRMED** — casing only; the indefinite plural was already right |
| 20 | `achievements.ironWill.desc` | *(unchanged)* | `…senza giocare **Joker**…` | **`Fito një ndeshje të plotë pa luajtur xhol në dorën përfundimtare.`** | **CONFIRMED** — was `Xholi` |

**Italian `Jolly` vs `Joker`.** `it.ts` uses `Joker` 19 times and `Jolly` 6 (rows 11, 12,
13, 17, 18, 19, 20). *Jolly* is the more idiomatic Italian for the card; *Joker* is what the
rest of the file and the game's own branding already say. I recommend **`Joker` everywhere**
(6 edits, not 19) — but that is a taste call, so: **NEEDS OWNER REVIEW**, and if the answer
is *Jolly*, it is 19 edits and none of the Albanian above changes.

**Albanian capitalisation.** Albanian does not title-case an attributive adjective, so
`Xholi i zi`, not `Xholi i Zi`. S1 writes `Xholi i Zi` — that is an artefact of its Italian
source page, not Albanian orthography. `cardView.jokerBlack` already uses sentence case;
this makes the other five agree with it. Judgment, not citation.

### Long keys — the fragments that change

Every change below is mechanical: the joker's name, plus casing. No other sentence moves.

**`rules.faq.a3`** — sq ladder line becomes:
```
★ Xholi i kuq > ☆ Xholi i zi > 2 > A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3
```
en: `★ Colored Joker > ☆ Black Joker > …`  ·  it: `★ Joker Colorato > ☆ Joker nero > …`
**CONFIRMED.** (See §e-9 on `mazhit` in the following line.)

**`rules.faq.a10`** — last paragraph, sq:
```
Përjashtimi i dy xholave: nëse humbësi ka në dorë të dy xholat (i ziu dhe i kuqi),
shkëmbimi NUK ndodh. Fituesi fillon vetë raundin tjetër.
```
en: `…both Jokers (colored and black)…`  ·  it: `…entrambi i Joker (colorato e nero)…`
**CONFIRMED** — `të dy xholat (i ziu dhe i kuqi)` is S1 word for word.

**`rules.faq.a11`** — sq bullets and last line:
```
• Xholi i kuq ★: më i forti absolutisht
• Xholi i zi ☆: i dyti për forcë
…Një xhol i luajtur si letër e vetme mund të mundet nga një Bombë!
```
en: `• Colored Joker ★ … • Black Joker ☆ …`  ·  it: `• Joker Colorato ★ … • Joker nero ☆ …`
**CONFIRMED.**

**`rules.faq.a15`** — sq: `(52 + 2 xhola)` and `të dy xholat`. en/it unchanged.
**CONFIRMED** (casing).

**`rules.faq.a17`** — sq: `…kur shpenzohet një 2, një xhol ose një Bombë…`. en/it unchanged.
**CONFIRMED** (casing).

**`tutorial.beat.exchange.instruction`** — sq, final clause:
```
…letrën e tij më të fortë, Xholin e kuq. Tani zgjidh një letër…
```
**CONFIRMED.** This is the accusative slot — and it needs no new key, because the name is a
literal in the sentence. en/it unchanged apart from row 5's naming.

---

## (e) Other Albanian strings in the high-priority subset, ranked

The `sq.ts` header names `cards.*`, `gameShared.combo*`, `gameTable.play*`, `lobby.rank*`,
`rules.combo*`/`strength*`, `tutorial.type*` as the subset to check first. Nine findings,
worst first. This is a shortlist, not a rewrite.

**1. `cards.suitClubs` and `cards.suitSpades` name the wrong things — CONFIRMED**
`Trefla` → **`spathi`**, `Pika` → **`maç`** (S1, S2, S7 — §a). ♠ is the suit the game speaks
most, because the 3♠ opens every session and `gameTable.playLabelStartCard` /
`playA11ySpokenStartCard` point at it. While there: `cards.suitHearts` `Kupa` and
`suitDiamonds` `Karo` are right, but `Kupa` is a plural/definite form sitting in a slot that
S2's examples fill with the bare singular (`Fanti spathi`, `Asi maç`). Whether Albanian says
`asi kupë` or `asi kupe` for the ace of hearts is a **native-speaker judgment I could not
source** — the other three suits are invariant here, so hearts is the only open one.

**2. `rules.comboPairDesc` / `comboTripleDesc` / `comboBombDesc` have a gender agreement
error, three times — CONFIRMED**
`2 letra të **të njëjtit** vlerë` — `vlerë` is **feminine**; the linked article must be
feminine ablative/genitive: **`të së njëjtës vlerë`**. Applies to all three strings. This is
the single most visible grammar mistake in the subset — it is on the rules screen, in a
three-row grid, so a reader sees the same error three times in a column.

**3. `rules.comboBombDesc` / `comboRoyalDesc` / `playA11ySpokenRoyalUnbeatable`: `mund`
reads as the modal, not the verb — NEEDS OWNER REVIEW**
`mund gjithçka përveç Shkallës Mbretërore` / `mund edhe Bombën` / `shkalla mbretërore mund
gjithçka`. Albanian `mund` is both *"can"* (modal, then a subordinate clause follows) and
*"defeats"* (transitive, then a clitic pronoun is normally there). With a bare object and no
clitic, a reader parses the modal first and gets *"the bomb **can** everything"*. Suggested:
**`i mund të gjitha përveç Shkallës Mbretërore`**, **`e mund edhe Bombën`**,
**`shkalla mbretërore i mund të gjitha`**. Native judgment, not a citation.

**4. `rules.comboRoyalDesc`: `me të njëjtin bojë` — CONFIRMED wrong, twice over**
`bojë` is **feminine** → `të njëjtën`, not `të njëjtin`. And `bojë` means *paint*; the card
word is **`ngjyrë`** (S2: *"njërën nga të katër **ngjyrat** e lojës së letrave"*; S1: *"nëse
kanë **ngjyra** të ndryshme"*). → **`Shkallë me të njëjtën ngjyrë`**.

**5. Combination names are invented where S1 supplies attested ones — NEEDS OWNER REVIEW**
S1: *"**Letër teke**, **dyshe** …, **treshe** …, **katërshe** … dhe **shkallë**"*.
`sq.ts` has `E vetme` / `Çift` / `Tresh` / `Bombë` / `Shkallë`. Only `Shkallë` matches. The
honest trade-off, which is why this is the owner's call and not mine:
- `Teke` (S1) is attested; `E vetme` ("the single/lone one") is a literal rendering of the
  English and reads as machine translation.
- `Dyshe` (S1) is attested, but it sits one letter from `rules.strengthTwo` = `Dyshi` (the
  card *2*) in the same UI. `Çift` is unambiguous standard Albanian and I would keep it.
- **`Tresh` is a real collision and should change regardless.** `rules.comboTripleName` =
  `Tresh` and `rules.strengthThree` = `Treshi` are the same word for two different things —
  a set of three cards, and the card *3*. S1 distinguishes them: **`treshe`** is the set.
- `Bombë` vs S1's `katërshe`: `Bomb` is the app's own flavour word in English too
  (`gameShared.comboBomb` = `💣 Bomb`), so keeping `Bombë` is consistent, not a mistake.
Also `gameShared.comboSingle`/`comboPair`/`comboTriple` and `tutorial.typeSingle`…
`typeRoyalStraight` carry the same words and must move together.

**6. `rules.comboStraightDesc`: `letra të njëpasnjëshme` — NEEDS OWNER REVIEW**
Grammatical, but `njëpasnjëshme` is bookish. S1 says the same thing plainly with examples
(`p.sh. 3,4,5,6,7`), and `radhazi` or `me radhë` is what a player would say. Low priority —
the example in the string already carries the meaning.

**7. `cards.rankQueen` / `rules.strengthQueen` = `Zonja` is unattested for the card —
NEEDS OWNER REVIEW**
S1 says `Çupë`, S2 says `Çupa spathi`, and S2's `zonjë` entry has six senses, **none of them
a playing card**. `Çupa` is the sourced word. But `çupë` is homely ("girl") where `Zonja`
is dignified, and a card-game UI may legitimately want the dignified one — S7 uses `çupat`.
Sourced answer: `Çupa`. Owner's answer: whichever sounds right at the table.

**8. `gameTable.playA11ySpokenRoyalUnbeatable`: `mund gjithçka: këtu nuk mund të
përgjigjesh` — NEEDS OWNER REVIEW**
Two `mund` in one clause, one modal and one not (see finding 3). Suggested:
**`shkalla mbretërore i mund të gjitha: kësaj nuk mund t'i përgjigjesh`**.

**9. Outside the subset, but it recurs: `mazh` — unverified, probably not a word**
`rules.faq.a3`, `a11`, `a15` use `mazhit` / `mazhi` for *deck*. I could not find `mazh` in
any Albanian dictionary I reached (S2 returns 404; no dictionary hit anywhere). It looks
like a bare borrowing of Italian *mazzo*. S1 avoids the noun entirely (*"Letrat shkartisen
dhe i ndahen lojtarëve"*). `pako letrash` or `një deng letrash` are candidates but I have
**no source for either as the card-game term** — flagging it, not proposing a fix.

---

## What we could not verify

- **Whether Kosovar Albanian agrees with the Tirana dictionary on the suits.** `maç` and
  `spathi` are S1 + S2 + S7. `Pika` and `Trefla` are in none of them — but "not in the
  dictionary" is not "not said in Prishtina". If the beta testers are Kosovar this is worth
  one question to them, and it is the single question with the widest blast radius here.
- **The correct form of ♥ in `cards.nameFormat`** — `asi kupë` or `asi kupe`. S2's examples
  cover `spathi` and `maç` (both invariant in that slot) and never a heart after a rank.
- **`Gramatika e Gjuhës Shqipe I — Morfologjia` (ASHSH 1995) and Newmark et al. 1982 were
  not read.** Both are cited above as the standing authorities and the bibliographic record
  for Newmark was verified, but the paradigms in §b come from S3, S4 and S5. If the owner
  wants a printed-page citation, those two books are where to get it.
- **`mazh`** (§e-9) — no dictionary reached had an entry, but absence from four websites is
  not absence from the language.
- **Every "NEEDS OWNER REVIEW" row in §d is my judgment as a non-native reader working from
  sources**, not a native-speaker intuition. The nine of them are exactly the set the owner
  asked to be left to review; the seventeen CONFIRMED rows each trace to a quoted source
  above and can be taken without a second opinion.
- **Nothing here was rendered.** `rules.strengthJokerColored` at `Joker colorato` widening
  its card (§d row 5) is an inference from `minWidth`-only styles, not an observation.
  `tests/e2e/tableFit.spec.ts` is the thing that would actually know.
