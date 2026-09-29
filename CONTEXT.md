# Context

Domain glossary and pointers to where a concept's design lives, sharpened over time by
`mattpocock-skills:domain-modeling`. A decision that constrains the whole repo belongs in
`docs/adr/`, not here. What does belong here, next to the term it guards, is a dated note that a
specific change to *that term* was researched and rejected — narrow enough that it is part of the
term's meaning, and useless anywhere the term is not.

## Terms

- **Account recovery** — the register / verify-email / add-email / resend-verification /
  request-password-reset / reset-password state machine. Its authoritative shape (states,
  transitions, the enumeration-safety and race-condition invariants) is `docs/adr/0007-account-recovery-email-verification-and-password-reset.md`,
  whose six boxes are cited by number from every handler in `server/http/routes.ts`. A future review proposing to consolidate this flow into
  an "owning module" should read that spec first — the state machine is already consolidated,
  just not as code, and each route's await-vs-fire-and-forget timing relative to `res.json()`
  is a deliberate per-route timing-oracle defense, not duplication.

  Its **client** half is five screens that each run their own request block. That is not the same
  finding and was reviewed separately on 2026-09-10: the blocks rhyme but differ in the busy flag
  they set, the success action they take (`setStep`, `router.replace`, `refreshUser`, a cache
  invalidation, a notification) and the surface the error lands on, so a shared hook would take
  five callbacks and save nothing. `app/auth.tsx` and `app/recover.tsx` additionally carry #897's
  enumeration-safety behaviour on their success paths, which must survive any change to them.

- **The online table's surface** — the 37 fields a screen reads from `OnlineGameContext`, exposed
  as the six slices in `context/onlineGameHooks.ts` (connection, room, table, turn clock, match,
  exchange). The slices are the seam, and `tests/ui-rules/contextSlices.test.ts` pins both that they
  partition the surface exclusively and that nothing outside four files reaches past them.

  A review proposing to extract a pure `reduce(state, event)` module from the provider should stop:
  it was researched on 2026-09-10 and rejected. Fourteen of the roughly twenty socket handlers
  interleave side effects — a socket `ack`, three refs read at event time, `AsyncStorage` writes,
  `queryClient.invalidateQueries`, a retry timer that emits — so a reducer would have to carry an
  effect queue out. The listener effect's dependency array was measured at the same time and is
  entirely stable, with twenty `on` and twenty matching `off`: there is no listener churn and no
  leak to fix. What was real is #961, one context per slice.

- **Feedback master state** — the enabled/volume globals in `lib/device/feedback.ts`, driven by three
  setters from `context/SettingsContext.tsx`. The music pair became one setter, because a volume of 0
  stops the track. A review proposing to collapse the setters behind one
  `applyFeedbackSettings(settings)` entry point should not: each effect has its own dependency for a
  reason, the haptics one is gated on `readFinished` because `lib/device/feedback.ts` preloads its key at
  module init, and a single entry point would fire every setter whenever any one value changed.

- **Notice** — anything the table tells a player in words on a plate of its own: the turn pill,
  a seat's PASSO, the combination, the connection notes, who starts, a refusal. A notice has a
  *kind* (which surface it is), a *shape* in the lantern mockup's vocabulary — `pill`, `chip` (the
  mockup's mark), `float`, `panel` — and a *tone* (`neutral`, `lit`, `urgent`, `ok`, `bad`) its shape
  must be able to paint. Every one is painted by `components/table/TableNotice.tsx` from
  `NoticePalette` in `lib/tokens.ts`; its kinds, their geometry in mockup pixels and their timings
  are `components/table/noticeModel.ts`, and each kind's gallery is
  `components/table/notices/gallery.tsx`. Not a notice: the banners over the app
  (`NotificationBanner`), which are news about the app rather than about the table.

## Working with this vocabulary

- **Name a domain concept with the repo's own word** — in an issue title, a test name, a
  hypothesis. A synonym for something the code already names starts a second vocabulary.
- **This file grows one term at a time**, as each is resolved; a term it does not carry yet is
  not a gap to fill upfront.
- **Say so when a change contradicts an ADR**, rather than quietly overriding it:

  > _Contradicts ADR-0002 (a play leaves the seat it was thrown from), but worth reopening
  > because…_

- `docs/adr/README.md` indexes the ADRs a term's design cites.
