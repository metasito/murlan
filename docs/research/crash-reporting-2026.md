# Crash reporting: does Sentry fit? — research pass, August 2026

Research-only document, for #102. Nothing here was implemented. Package metadata was read
live from `registry.npmjs.org`, `api.github.com`, `api.expo.dev` and
`raw.githubusercontent.com` on **2026-08-21**; docs and pricing from their primary hosts on
the same date. Local measurements were taken against this repo's checked-in `dist/` on the
same date. Anything not confirmed against a primary source is collected under
[Explicitly unverified](#explicitly-unverified) and flagged inline as **[UNVERIFIED]**.

---

## Bottom line — **out**

Not on reputation grounds, and not because it doesn't work. `@sentry/react-native@8.23.0`
does support Expo web, contrary to the assumption in the ticket. It is out because of what
it costs against what it would actually deliver *here*.

- **The one thing Sentry sells that the existing table cannot do is grouping.** Everything
  else — capture, storage, a place to read it — already runs. So grouping is the whole case.
- **Grouping on web requires source maps**, and Sentry says so in the imperative:
  *"Minimized JavaScript source code will destroy the grouping in detrimental ways."*
  ([event grouping](https://docs.sentry.io/concepts/data-management/event-grouping/), read
  2026-08-21)
- **Web source maps are the one part of the chain nobody can show working on Expo + Metro.**
  The single public report of exactly this configuration
  ([#5857](https://github.com/getsentry/sentry-react-native/issues/5857), closed 2026-03-20)
  was closed *by the reporter*, not by a fix: *"Move to expo as it looks like it more a
  Metro/expo issue when building the source maps."* No doc or changelog entry says it works.
- So the purchase is: **+134–175 KB gzip on the primary surface, an accepted DPA, a privacy
  policy, and three store-disclosure categories — for a feature that is unproven precisely
  where the players are.**
- **And the free tier is a downgrade on the axis that already works.** Sentry Developer keeps
  errors **30 days**; `client_errors` keeps **90**. Developer has **no API access**, so
  Sentry's data cannot feed `/admin` — it would be a second place to look, not a better one.

**What replaces it:** four small changes to the pipeline that already exists, listed in
[§7](#7-what-replaces-it). The largest coverage gain in the set is ~30 lines — global error
handlers — because today *nothing but the React error boundary can report a crash at all*.

**What would reverse this:** see [§8](#8-what-would-change-the-answer). The honest trigger is
native store launch plus a demonstrated Expo-web source-map round trip.

---

## 1. What is running today

`POST /api/client-errors` (`server/routes.ts:525`) → pino **and** the `client_errors` table
(`server/clientErrors.ts:41`), read on the server-rendered `/admin` page
(`server/routes.ts:481`, behind `requireAdmin` at `server/routes.ts:127`).

The table already carries `message`, `stack`, `screen`, `platform`, `app_version`, `context`
jsonb, `user_id`, `occurred_at`, indexed on `occurred_at`, pruned to
`CLIENT_ERROR_RETENTION_DAYS = 90` inside the same transaction as the insert.

`server/routes.ts:517` already records the reasoning for choosing in-house:

> In-house rather than a third-party crash SDK: any such SDK is a data processor, which
> changes the App Store privacy answers and adds a dependency that runs in every session.

This pass confirms that reasoning and adds numbers to it.

### 1.1 Measured coverage gaps — the real argument, and it is not about Sentry

The endpoint has exactly one caller: `components/ErrorFallback.tsx:44`, fired from the root
`<ErrorBoundary>` in `app/_layout.tsx:78`. A React error boundary catches render, lifecycle
and commit errors and nothing else. Grepping the whole tree for
`ErrorUtils` / `setGlobalHandler` / `unhandledrejection` / `window.onerror` returns **no
matches**. So today:

| Crash class | Reported? | Why not |
|---|---|---|
| Render / lifecycle error below the root boundary | **yes** | the one path that works |
| Unhandled promise rejection | **no** | no `unhandledrejection` handler exists |
| Error in an event handler, socket callback or timer | **no** | outside React's render phase |
| Any crash before login | **no** | the endpoint is `requireAuth` (`server/routes.ts:527`) |
| Native crash, JS engine death | **no** | no JS survives to send it |
| Chunk / bundle load failure | **no** | the app never boots |

Two fields are dead on arrival: `app_version` and `screen` exist as columns, and the single
caller sends neither — it sends `message`, `stack`, `platform` only.

**This matters more than the Sentry question.** Adding a third party does not fix a missing
`window.onerror`; adding `window.onerror` does. Most of the gap between "we see crashes" and
"we don't" is four handlers and two fields, not a vendor.

### 1.2 Measured bundle baseline

From the checked-in `dist/_expo/static/js/web/`, gzip -9, on 2026-08-21:

| file | raw | gzip |
|---|---|---|
| `entry-cd5e85b6….js` | 2,991,716 | **760,290** |
| `index-1b02327c….js` | 132,145 | **35,014** |
| **total** | 3,123,861 | **795,304** |

`scripts/bundle-budget.mjs` sets `BUDGET_BYTES = 1_000_000`, so headroom is **204,696 bytes
gzipped**. The budget is a guardrail, not a product limit — its own comment says raising it
is *"a reviewable diff that shows up in `git log`"* — but the headroom number is what any
addition has to be argued against.

**There is no async chunking today.** `lib/pushRegistration.ts:30` already does
`import("expo-notifications")`, and that module is inlined into `index-*.js`; the export
produces exactly two JS files. So "load the SDK after first paint" is not a free mitigation —
it is separate work.

**The web build emits no source maps.** Zero `.map` files in `dist/`. Confirmed against the
CLI: `expo export`'s `--source-maps` (short `-s`) is a boolean defaulting to false in
`@expo/cli@54.0.27` (`build/src/export/resolveOptions.js`: `sourceMaps: !!args['--source-maps']`),
and `@expo/metro-config@54.0.17` `serializeChunks.js` returns `null` for the source-map URL
unless `serializerOptions.includeSourceMaps === true`. `--dump-sourcemap` survives only as a
hidden deprecated alias. Expo's published CLI docs page mentions neither flag.

---

## 2. `@sentry/react-native` in 2026

All from `registry.npmjs.org` and the sentry-react-native repo, read 2026-08-21.

- **Latest `8.23.0`**, published `2026-08-13T09:52:15.441Z`. `dist-tags`:
  `latest 8.23.0`, `next 8.18.0-alpha.3`, `v8.14 8.14.2`. Unpacked 8,723,369 bytes, 1185 files.
- Peers: `{"expo": ">=49.0.0", "react": ">=17.0.0", "react-native": ">=0.65.0"}` — this repo's
  react 19.1.0 / RN 0.81.5 satisfy them. Deps pin `@sentry/{core,react,browser}@10.69.0`,
  `@sentry/cli@3.6.2`, `@sentry/expo-upload-sourcemaps@8.23.0`.
- RN 0.81 support landed in `6.20.0` (CHANGELOG, #5051). Expo SDK 54 is named explicitly at
  `7.3.0` (*"Fixes TypeScript errors when using custom Metro configurations with Expo SDK 54"*,
  #5246). New Architecture supported since 5.0.0.
- Sentry's docs require **Expo SDK 50+**; `sentry-expo` is deprecated.

### 2.1 The version this repo would actually install is 7.2.x, not 8.23.0

`https://api.expo.dev/v2/sdks/54.0.0/native-modules` (read 2026-08-21) and
`expo/expo@sdk-54:packages/expo/bundledNativeModules.json` both pin:

```
@sentry/react-native  ~7.2.0
```

So `npx expo install @sentry/react-native` on SDK 54 installs **7.2.x**, and `expo install
--check` / `expo-doctor` flags 8.23.0 as off-pin. Expo has not moved to the 8.x line on any
branch — SDK 55 and 56 pin `~7.11.0`. Latest 7.x is `7.13.0` (2026-02-12).

Choosing between them is a real fork: run supported-but-old, or run current-but-off-pin in a
repo whose CI is the thing that catches drift. Neither is free.

Also worth knowing, though not web-relevant: **8.17.0 and 8.17.1 are unsafe** — the changelog
flags a `libsentry-tm-perf-logger.so` that is not 16 KB page aligned, which *"fails Google
Play's 16 KB requirement"* (#6394), and a build failure on subset-ABI/Expo builds (#6398).
Both entries say *"Please use 8.17.2"*.

### 2.2 Expo web — supported, and the ticket's premise was wrong

The old advice ("the RN SDK doesn't do web, use `@sentry/react` there") is obsolete. Decisive
primary statement, [sentry-expo migration guide](https://docs.sentry.io/platforms/react-native/guides/expo/migration/sentry-expo/)
(read 2026-08-21):

> The `sentry-expo` package automatically switched to `@sentry/react` for `react-native-web`
> builds. **This is no longer the case with `@sentry/react-native` which supports
> `react-native-web` out of the box.**
>
> Note that some features might not be supported or work differently in
> `@sentry/react-native` on `react-native-web` compared to direct usage of `@sentry/react`.

Confirmed in source (`packages/core/src/js/integrations/default.ts`, read 2026-08-21): the SDK
branches on `notWeb()` and pushes `browserApiErrorsIntegration`,
`browserGlobalHandlersIntegration`, `browserLinkedErrorsIntegration` and
`browserSessionIntegration` when running in a browser. It also ships `.web.js` platform
variants (`dist/js/utils/rnlibraries.web.js`, `dist/js/replay/CustomMask.web.js`) so
RN-internal `require`s are never reached on web.

**One package, one `Sentry.init()`, one DSN, one config.** The only place the docs ask you to
branch on `Platform.OS` yourself is choosing `browserReplayIntegration()` vs
`mobileReplayIntegration()`.

Note what this buys that the error boundary cannot: `browserGlobalHandlersIntegration` is
`window.onerror` + `unhandledrejection`. That is a genuine capability gain — and it is also
[§7.1](#71-global-error-handlers--sizes), which costs ~30 lines without a vendor.

Degraded on web, each from its own doc page (read 2026-08-21): app-start tracing
(*"not available on the web"*), Time To Display (*"not available on Web yet"*), User Feedback
screenshots, the Sentry Playground (compatibility table row `| Web | No | No |`), and dev-mode
symbolication (*"This currently doesn't work on web."*).

Open GitHub issues mentioning web: **9**, none of them "web is unsupported". The web-specific
one is [#3646](https://github.com/getsentry/sentry-react-native/issues/3646) (open since
2024-02-29, updated 2026-04-14) — dev-mode symbolication only.

---

## 3. Free tier — the plan is called Developer

All from `https://sentry.io/pricing/`, `https://docs.sentry.io/pricing/`,
`https://docs.sentry.io/product/accounts/quotas/` and
`https://docs.sentry.io/security-legal-pii/security/data-retention-periods/`, read 2026-08-21.

| | Developer (free) |
|---|---|
| Errors | **5,000 / month** |
| **Error retention** | **30 days** |
| Seats | **1 user** ("Limited to one user") |
| Tracing | 5M spans |
| Session Replay | 50 replays |
| Attachments | 1 GB |
| Custom dashboards | 10 |
| **API access** | **not included** — blank in the comparison table for `developer` |
| Third-party integrations | not included |
| Spend notifications / max spend threshold | not included |
| Data Residency | ✓ included |
| Manage PII | ✓ included |

**Two of these decide the question.**

**Retention is a downgrade.** 30 days on Developer against the 90 that `client_errors` already
keeps. And retention is stamped at ingest: *"Retention periods are set at the time data is
ingested, based on the then-current plan… plan upgrades or downgrades affect retention for new
data only."*

**No API on the free plan** means Sentry's data cannot be pulled into `/admin`. The dashboard
that #40 built stays the place you read product state, and Sentry becomes a second, separate
console with a one-seat login. That is the opposite of the consolidation the charting session
was after.

At the ceiling, events are dropped, not billed —
[manage-event-stream](https://docs.sentry.io/pricing/quotas/manage-event-stream-guide/):

> When you exceed your quota threshold, the server will respond with a 429 HTTP status code…
> clients are not supposed to retry events, but instead drop events until the rate limit has
> expired.

Owners get an email. The one-time grace period is explicitly *"if… **you're on a paid plan**"*.
Developer cannot buy overage: *"If you're on a Developer plan and want to increase your quota,
you'll need to upgrade to a Team or Business plan."*

Per-DSN rate limiting — the obvious defence against one looping client eating the month — is
*"available only if your organization is on a Business or Enterprise plan."* The existing
`errorReportLimiter` (5/min, `server/routes.ts:101`) is a control this repo already has and
Sentry's free tier does not.

New accounts get a 14-day full-feature trial and then drop to Developer automatically.

---

## 4. What it collects, and what can be switched off

Both platform "Data Collected" pages plus the options pages, read 2026-08-21.

**Defaults are conservative.** `sendDefaultPii` defaults to **`false`** on both the RN and
browser SDKs — *"By default, no such data is sent."* Session Replay is **opt-in** on both
platforms. Tracing is **off** unless `tracesSampleRate`/`tracesSampler` is set —
*"Either this or `tracesSampler` must be defined to enable tracing."* Profiling defaults to
`profileSessionSampleRate: 0`.

**But three things are on, or unavoidable:**

1. **Request URLs cannot be turned off.** Both pages use the same phrasing: the full request
   URL of outgoing HTTP requests *"is always sent to Sentry"* — plus, on RN, the Referer and
   the full query string.
2. **Console logs are sent by default** — *"By default, the Sentry SDK sends JS console logs to
   Sentry which may contain PII data."* The browser `breadcrumbsIntegration` wraps `console`,
   `dom` (*"Log all click and keypress events"*), `fetch`, `history` and `xhr` by default.
3. **Geo data survives the IP switch.** Even with project-level *"Prevent Storing of IP
   Addresses"* enabled, [server-side scrubbing](https://docs.sentry.io/security-legal-pii/scrubbing/server-side-scrubbing/)
   says: *"Geographic information is extracted from the user's IP address. **This occurs even
   if the setting to stop storing IP addresses is turned on.**"* Removing it needs an Advanced
   Data Scrubbing rule (`[Remove] [Anything] from [$user.geo.**]`).

Also note the JS SDK is mid-migration: `sendDefaultPii` is **deprecated as of `@sentry/browser`
10.54.0**, replaced by `dataCollection` (since 10.57.0), removal planned for v11 — and the two
have **opposite defaults**. Passing any `dataCollection` object *"opts you into the more
permissive `dataCollection` defaults"*: `userInfo`, `cookies`, `httpHeaders`, `httpBodies`,
`urlQueryParams`, `genAI` and `stackFrameVariables` all `true`. A future SDK bump is a privacy
posture change, not just a version bump.

Deletion after the fact is coarse: *"While you cannot delete a single event, you can delete the
issue… you may need to **delete and re-create the project** to effectively cleanse the system."*

---

## 5. Legal and store footprint

### 5.1 A DPA is a precondition, not a formality

[Sentry ToS v3.0.0](https://sentry.io/terms/) (2024-02-12, read 2026-08-21):

> **Personal Data.** Unless Customer and Sentry have entered into a DPA, **Customer will not
> submit any Personal Data to the Service.**

The [DPA](https://sentry.io/legal/dpa/) is v5.1.0 (2024-05-29), self-serve under
*Organization Settings → Legal & Compliance*, and *"can only be signed/accepted by members with
a Owner or Billing role."* It covers GDPR, UK GDPR, Swiss FADP and CCPA. Counterparty is
**Functional Software, Inc. d/b/a Sentry**, San Francisco; EU affiliate Functional Software
GmbH, Vienna. Governing law California, venue San Francisco.

This is the constraint the ticket flagged, and it holds: #44 says no privacy policy exists
anywhere in the repo, and both stores refuse a listing without one. Admitting Sentry converts
that from "needed before launch" into "needed before the first event is sent".

### 5.2 The sub-processor list is now a disclosure problem of its own

[Sub-processors](https://sentry.io/legal/subprocessors/), last updated **2026-06-01**
(read 2026-08-21): AWS, Cloudflare, Google LLC, Intercom, Sinch/Mailgun, Twilio/SendGrid — and
**Anthropic, PBC** and **OpenAI, L.L.C.**, both listed for *"AI/ML services"*, both United
States.

A privacy policy for a card game that names two US AI providers among its processors is a
harder document to write, and a harder one to explain, than one that names none.

### 5.3 EU region exists, on the free plan, and is irreversible

[Data storage location](https://docs.sentry.io/organization/data-storage-location/): the EU
region is **Frankfurt, Germany**, and "Data Residency" is checked for `developer` in the
pricing comparison table. Errors, replays, releases, **source maps** and their metadata stay in
region.

> Please note that once selected, your data storage location can't be changed. The only way to
> switch it is by creating a new organization.

EU orgs must call `de.sentry.io`. Account data, org settings, **project metadata and DSN keys**
go to the US regardless of the choice.

### 5.4 Store answers if it were admitted

Sentry's own position ([mobile privacy FAQ](https://docs.sentry.io/security-legal-pii/security/mobile-privacy/)):
*"**Yes**, Sentry is a third-party partner whose code (SDKs) you integrate in your app that
collects data from users of your app."* It does not use IDFA, does not track users, and uses
*"IDs which are randomly generated per device, per app, and per installation."*

Its published `PrivacyInfo.xcprivacy` declares exactly three types, all `Linked=false`,
`Tracking=false`, purpose `AppFunctionality`: `CrashData`, `PerformanceData`,
`OtherDiagnosticData`. Note the page's caveat — *"If you are using statically linked libraries,
which is **the default for React Native applications**, you need to provide the privacy manifest
yourself."*

| Store | Declaration |
|---|---|
| Apple | Diagnostics → **Crash Data**, **Performance Data**, **Other Diagnostic Data**; purposes App Functionality + Analytics; Tracking No; Linked No |
| Apple | Identifiers → User ID **only if** `Sentry.setUser()` is called |
| Google Play | App info and performance → **Crash logs**, **Diagnostics**; **Data shared with a third party = Yes** |

Against today's answer, which is: none of the above, because nothing leaves the server.

---

## 6. Source maps, and why they are the hinge

### 6.1 Without them, grouping does not work

[Event grouping](https://docs.sentry.io/concepts/data-management/event-grouping/), read
2026-08-21:

> **Minimized JavaScript source code will destroy the grouping in detrimental ways. To avoid
> this, ensure that Sentry can access your Source Maps.**

Stack-trace grouping keys on module name, *"normalized filename (with revision hashes, and so
forth, removed)"* and *"normalized context line"*. A minified, content-hashed single-file
bundle degrades all three at once, and the filename changes every deploy. Grouping is the only
reason this ticket exists, so this is the whole chain.

Also not retroactive: *"If you upload artifacts after an error is captured by Sentry, Sentry
will not go back and retroactively apply any source annotations to those errors."*

### 6.2 Two upload paths, both survivable on Replit — this is not the blocker

Worth stating plainly, because the ticket expected this to be disqualifying and it is not.

**Path A — upload from CI.** `expo export --platform web --source-maps`, then
`npx @sentry/expo-upload-sourcemaps dist`, authenticated purely by `SENTRY_AUTH_TOKEN` /
`SENTRY_ORG` / `SENTRY_PROJECT` env vars. [CLI configuration](https://docs.sentry.io/cli/configuration/)
confirms env-var-only auth; `sentry-cli login` is the optional interactive path, not a
requirement.

I read the published `@sentry/expo-upload-sourcemaps@8.23.0` tarball (`package/cli.js`). It is
**platform-agnostic** — it walks the directory, groups files by basename on
`.map` / `.js` / `.hbc`, and does the one step that makes Expo's output ingestible:

```js
if (sourceMap.debugId) { sourceMap.debug_id = sourceMap.debugId; }
```

Expo's own serializer already writes `debugId` (`@expo/metro-config`
`serializer/debugId.js`, whose header reads *"Copyright (c) 2022, Sentry."*). So the web
bundle **would** be picked up — there is no platform filter and no web exclusion.

Cost: `@sentry/cli@3.6.2` resolves a platform binary via optional dependencies —
`@sentry/cli-linux-x64@3.6.2` is **23,179,671 bytes unpacked**. That belongs in GitHub Actions,
not on the Replit Run button. Since `.github/workflows/ci.yml` already runs the web build, the
Replit constraint is satisfiable: **Replit never runs the upload.**

**Path B — host the maps publicly.** Still supported and **not deprecated** — the doc history
for `hosting-publicly.mdx` shows its most recent touch as 2026-05-05, a platform-list edit,
with no deprecation commit. The project setting still exists as `scrapeJavaScript`
(stored as `sentry:scrape_javascript`), and `SCRAPE_JAVASCRIPT_DEFAULT = True` in
`getsentry/sentry:src/sentry/constants.py`. Zero tooling.

Cost: source maps carry `sourcesContent` — the original, unminified source, readable by anyone
who fetches the `.map`. That is a deliberate publication decision, not a build detail.

### 6.3 The part that does not resolve

Both paths assume the round trip works. For Expo web + Metro specifically, the only public
report is [#5857](https://github.com/getsentry/sentry-react-native/issues/5857) — *"Web
sourcemaps not resolved despite correct Debug IDs uploaded via sentry-expo-upload-sourcemaps
(Expo Web + Metro + Netlify)"*, filed against 7.2.0, **closed 2026-03-20 by the reporter**
with *"Move to expo as it looks like it more a Metro/expo issue when building the source
maps."* No fix, no changelog entry, no doc confirming it now works. Sentry's Expo docs describe
web source maps nowhere; the native flow is documented in detail.

So the decisive claim of the whole evaluation — *readable, grouped web stack traces* — rests on
the one link with no primary evidence behind it. **[UNVERIFIED]**, and unverifiable short of
building it.

---

## 7. What replaces it

Four changes to the pipeline that already exists. Together they close most of the gap in
[§1.1](#11-measured-coverage-gaps--the-real-argument-and-it-is-not-about-sentry) with no
processor, no DPA, no store disclosure and no bundle cost worth measuring.

### 7.1 Global error handlers — `size:S`

The largest single gain. Today the *only* thing that can report a crash is the React error
boundary. Add, in one module registered from `app/_layout.tsx`:

- web: `window.addEventListener("error", …)` and `"unhandledrejection"`
- native: `ErrorUtils.setGlobalHandler`, chaining the previous handler

posting to the existing `/api/client-errors`. The existing 5/min limiter already covers the
crash-loop case. This is exactly the capability `browserGlobalHandlersIntegration` would have
supplied.

### 7.2 Send the fields the table already has — `size:XS`

`ErrorFallback.tsx:44` sends `message`, `stack`, `platform`. The columns `app_version` and
`screen` exist and stay null. `appVersion` from `expo-constants`, `screen` from the
`componentStack` the boundary already receives.

### 7.3 Fingerprint and group — `size:S`

The one Sentry feature genuinely worth having, and it is a hash plus a `GROUP BY`. A
`fingerprint` column over normalized message + top stack frame lets `/admin` show
"×47 since Tuesday" instead of 47 rows. Normalization is the same idea Sentry documents:
strip hashes and digits from the filename, keep the frame shape.

### 7.4 Private source maps, symbolicated server-side — `size:M`

The lazy version of what Sentry would do, without publishing anything. `expo export
--source-maps` in CI, keep the `.map` files **server-side only** (never under the served
`dist/`), and resolve stacks on `/admin` with the `source-map` package at read time. Readable
traces, no third party, no public `sourcesContent`.

Worth pairing with 7.3 — fingerprinting a minified stack is exactly as lossy for us as it is
for Sentry.

### 7.5 Left deliberately unsized — needs an owner call

**Unauthenticated crash reporting.** `requireAuth` on the endpoint means no pre-login crash is
ever seen, and `server/routes.ts:522` states the reason: *"An open endpoint is an open
log-injection vector."* Removing the guard is a security decision with a real trade, not an
implementation detail. It should be `ready-for-human`, not `ready-for-agent`.

---

## 8. What would change the answer

This is a "no, for now", and these are the specific triggers — each one testable, so this
document does not have to be re-litigated from scratch.

1. **A demonstrated Expo-web source-map round trip.** If a minified web crash resolves to a
   real file and line in Sentry, §6.3 collapses and the case gets much stronger.
2. **Native store launch.** Native is where Sentry is unambiguously ahead: a JS-thread death or
   a native module crash cannot report itself, and no amount of `window.onerror` fixes that.
   The native source-map and dSYM path is also fully automated at EAS Build time and needs
   nothing on a developer machine. **If iOS/Android ship, re-open this.**
3. **Volume past a person's reading.** 5,000 errors/month is far above beta traffic. If
   `/admin` becomes unreadable, grouping is worth paying for — but §7.3 buys that first, and
   cheaper.
4. **A privacy policy existing anyway.** Once #44 is done for the stores, the marginal legal
   cost of one processor drops sharply. It does not reach zero — the sub-processor list still
   names OpenAI and Anthropic.

---

## Explicitly unverified

- **The bundle cost of `@sentry/react-native` in a real Metro/Expo web export.** Estimated at
  **+134–175 KB gzip** (namespace import, no tree-shaking, with and without
  `includeWebReplay: false` / `includeWebFeedback: false`), from an esbuild emulation with
  `react-native` → `react-native-web` aliasing and `.web.js` resolution — not from an actual
  `expo export`. Metro does not tree-shake and Expo's serializer adds its own wrapping, so the
  real figure is likely **higher**. Sentry publishes no size-limit config for the RN SDK.
  Against the measured 795 KB baseline this is roughly **+17% to +22%**. Not measured, because
  the verdict does not rest on it — but if this is ever revisited, measure it first.
- **Whether `@sentry/react-native@8.23.0` has been validated against Expo SDK 54 specifically.**
  The changelog names SDK 54 at 7.3.0 and SDK 56 later; there is no per-Expo-SDK compatibility
  table. Expo's own pin for SDK 54 is `~7.2.0`.
- **Whether `expo-doctor` on SDK 54 hard-fails or merely warns on `@sentry/react-native@8.x`.**
  Not tested.
- **Whether the Expo-web source-map round trip works today** (§6.3). The one public report was
  closed as an upstream Metro/Expo issue by its reporter, with no fix landed. This is the single
  most load-bearing unknown in the document.
- **Whether Spike Protection is available on the Developer plan.** The
  [doc](https://docs.sentry.io/product/accounts/quotas/spike-protection/) states no plan
  restriction and it is not a row in the pricing table; its stated purpose (*"ensuring that you
  don't get charged for the excess volume"*) is moot on a plan that cannot be charged.
- **Whether a credit card is required at signup.** Neither `sentry.io/signup/` nor the pricing
  docs state one either way.
- **Whether the DPA is gated by plan.** No page says a Developer-plan org can or cannot accept
  it; only the BAA is marked "Business plans or higher", which implies the DPA is not gated.
- **Exact profile-hours allowance on Developer.** Both profiling rows are blank for `developer`
  and profiling is *"available only through PAYG"*, which Developer does not have. Effectively
  zero, but never printed as a number.
- **Whether Sentry has ever announced a plan to remove public source-map fetching.** No such
  announcement found in the docs, the `hosting-publicly.mdx` git history, or code search — but
  absence of a found announcement is not proof of absence.
- **Whether Replit's runtime is `linux/x64`.** Assumed from the platform. `linux/arm64` is also
  covered by an optional dependency; a musl-only environment has no `@sentry/cli` package.
