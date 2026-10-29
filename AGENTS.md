# Repository instructions

## Current structure

- `website/` is the deployable static HTML, CSS, and JavaScript site. It has no
  package manifest, bundler, or build step. Serve it over HTTP for ES modules.
- `website/index.html` loads `game-modular.js`, which initializes
  `modules/core/Game.js`. Keep game orchestration and state in `modules/core/`,
  game objects in `modules/entities/`, input/audio/spawning/effects/collision
  systems in `modules/systems/`, and existing shared utilities in `modules/utils/`.
- `tests/` is a separate npm package containing Playwright specs and helpers.
  `tests/helpers/game-helper.js` uses the browser API exposed by
  `website/modules/core/TestAPI.js`. Preserve that contract when changing gameplay.
- `game/` is a separate npm package: the work-in-progress TypeScript build (Vite,
  Vitest, ESLint, Playwright). Its `dist/` build is deployed to `/next/` on the
  Pages site. Its scripts include `build:e2e` (an e2e build in `dist-e2e/` that
  carries the test bridge and the `?seed=`/`?lives=`/`?quality=`/`?galaxy=`/`?storm=`/`?today=` URL overrides,
  and checks that it does), `check:no-bridge` (fails if the release `dist/`
  contains the bridge or that URL parsing), and `record:parity` (records the
  parity traces), `icons` (re-renders the committed PNG icons in
  `game/public/icons/` from `game/assets-src/icon.svg` with Playwright's
  Chromium; run it after editing the SVG and commit the PNGs), and `find-seeds`
  (re-picks an e2e seed: every seed a Playwright spec depends on is listed with its
  claim in `game/e2e/seeds.ts`, a unit test guards each claim, and a failing guard
  prints the `npm run find-seeds -- <claim>` command to run; a new seed gets a
  table entry plus a claim check in `game/tests/helpers/seedClaims.ts`). The same
  file holds a date table (`E2E_DATES`): a Daily's World seed comes from its date, so a
  spec that plays a Daily picks a date, each with a claim (`daily-clears`,
  `daily-streak`, `daily-game-over`) that `find-seeds` re-picks by scanning dates from
  `DATE_EPOCH`. Each attract demo's seed carries an `attract-<level>` claim (the
  expert loses no life in its first 45 s at 16:9, 4:3 and 21:9), which the guard checks
  and `find-seeds` re-picks too. Dev builds also
  honour the URL overrides; release builds never parse them, and `check:no-bridge`
  also fails if an e2e hook (frame, fast-forward, boss damage, pickup grant, event
  tally, frame-stats restart, sprite-cache use, attract now, attract state) reaches
  `dist/`. The bridge (`testBridge.ts`, typed in `testApi.d.ts`) carries a
  `BRIDGE_VERSION`, now 8, raised whenever its state changes shape; the specs wait for
  that version. Each hook lives in
  `app/e2eHooks.ts`, is set only under
  `import.meta.env.MODE === 'e2e'`, and has a mark in `scripts/check-no-bridge.mjs`
  and a case in `tests/unit/checkNoBridge.test.ts`; a new hook needs all three.
  `?galaxy=` jumps straight into a level and `?storm=<seconds>` adds a gravity storm to
  the level played (see `app/seed.ts`). A run started with `?galaxy=`, `?seed=`,
  `?lives=` or `?storm=` never writes the save. `?today=YYYY-MM-DD` pins the app's
  date instead of the device's; it is not a debug run (a device clock can do the
  same), so its runs write the save. `?seed=` does not apply to the Daily, whose
  date fixes its World seed.
  Gameplay code under `game/src/sim/` is deterministic and DOM-free; ESLint
  enforces it. Ship handling is pinned to recorded traces of the live game in
  `game/tests/fixtures/parity/`; do not re-record them after `website/` changes
  without owner approval.
- In `game/src/`, `content/` holds the level tables (levels grouped in sets,
  each set ending in a boss level), the difficulty curves, the pacing rules and
  the bosses as typed data, plus the Daily's twists and the ship's looks;
  `meta/` holds the pure save, unlock, star, Rank, calendar, Daily, "New best!"
  and look-unlock rules; `app/` owns the screen flow (`flow.ts`, pure), the run
  controller (save, World and Rank wiring), commands, hit-stop, frame monitor,
  settings and attract mode; `render/` owns drawing; `audio/` owns sound; `input/`
  owns keyboard, touch and gamepad input and menu focus; `ui/` owns the DOM
  cards (title, mode select, the level map and level select, results and game
  over, pause, settings, records, the Hangar, crash, rotate prompt); `platform/`
  owns full screen, the service worker registration, the install offer, the
  crash guard and the local log; `sw/` is the service worker itself; `bot/`
  holds the bots and their level runner (`run.ts`). The tests and the balance
  suites use every profile; the expert also ships to players, flying the attract
  demo behind the title, while the level runner stays test-only.
  - `bot/` is pure like `sim/` (ESLint enforces it: no DOM, clock or `Math.random`). A bot reads
    a `BotView` (the World's state, refilled in place) and returns controls; it
    never changes the World. There are three profiles: `statue` sends no input
    (the baseline of what a level does to an idle ship), `casual` is a
    handicapped player (late reactions, a wobbling aim, dodges only some
    threats), and `expert` is the full pilot, which the casual wraps. `createBot`
    gives each run its own random stream, derived from the run's seed with
    `deriveSeed(seed, 'bot')`; a bot draws from nothing else, so a bot run
    replays exactly and never shifts a sim stream. A change to the expert changes
    what the casual does, so rerun the balance suites after either.
  - Pickups and weapon tiers (`sim/pickups/`, `content/pickups.ts`): a kill can
    drop a pickup, with a chance that follows the level's difficulty and a pool
    of kinds that widens by set; the `'pickups'` stream decides both. A
    `Loadout` holds the weapon tier (0 to 3; one kind raises it, and a Rank
    death lowers it by one) and the timed effects, each with a clock; collecting
    a running kind refreshes it and never stacks. `volley.ts` composes the
    ship's barrels from the tier and the running effects (effects only ever add
    barrels or shorten the fire interval), and the shot rules: how many targets
    a shot pierces, which shots home, and whether the Wingman adds its shot. A
    protective pickup absorbs one hit. Field Bomb and Nova blasts score their
    kills with the combo but never drop pickups. Time Warp runs the rocks, foes,
    bolts and boss at `TIME_WARP_SCALE` of real time (`enemyTimeScale` in
    `sim/pickups/effects.ts`; a beaten boss dies in real time), while the ship,
    player shots, pickups, hazards, the director and the galaxy clock stay in
    real time; the boss pass times windups on the boss's own clock. The HUD
    shows a pill with a countdown for each running timed effect
    (`render/hudPickups.ts`). Which kinds the player has collected is saved
    (`seenPickups`) and decided in `app/pickupNotices.ts`, because the sim knows
    nothing of what the player has seen: a kind's first drop is announced once,
    and collecting it ends the callout for good.
  - Foes and hazards: `content/foes.ts` and `content/hazards.ts` hold their
    stats and schedules as typed data; `sim/foes/` has one behaviour per foe
    kind over a pooled `Foe` (never hold one across steps), and `FoeField` owns
    the pool, spawning, hits and rams. The director spends foes from the same
    threat budget as rocks, by cost. Foe motion draws from the `'foes'` stream.
    `HAZARD_RULES` in `content/hazards.ts` is the hazard table: each type's
    telegraph, length and first set (gravity wells, repulsion fields, danger
    zones, warp rifts, the black hole and the gravity storm: up to four gravity
    wells placed together (`stormWells`), apart from each other and clear of the
    field's centre, the respawn point and the ship, whose summed pull is capped like
    any other; only the Daily schedules
    it, and `?storm=` adds one in e2e and dev builds). A level event schedules a hazard; it
    shows as a harmless warning for its telegraph, then turns hostile.
    `HazardField` (`sim/hazards/`) runs one `Hazard` per type a level names,
    made by `HAZARD_FACTORIES`, each from its own stream (`hazardStreamName`:
    gravity wells keep `'hazards'`, every other type draws from
    `'hazards:<type>'`). It sums every hazard's pull on the ship and caps it at
    `MAX_SHIP_PULL`, so a thrusting ship always beats it. A hazard's optional
    parts strike the ship, swallow shots, carry bodies, or move the respawn,
    which `sim/respawn.ts` keeps clear of the boss, the hole, foes, zones and
    rift mouths. Each foe kind says whether a pull moves it. Foes and hazards
    are drawn by `render/foePass.ts` and `render/hazardPass.ts` (the hazards'
    painters are in `render/hazardArt.ts`); a well holds still under reduced
    motion.
  - Hostile bolts (`sim/foes/bolts.ts`) come from one pool per level, fired by
    gunships and boss attacks after a telegraphed windup: a bolt flies straight,
    leaves the field rather than wrapping, and lasts `BOLT.life` seconds of the
    enemies' time. The player's shots go through `sim/shots.ts`: `ShotRules` say
    what the running effects add (piercing, homing, the Wingman's shot), and
    each shot strikes through `ShotTargets` (a black hole's horizon, the boss,
    the foes, the rocks), never the same target twice.
  - A boss is three pieces, and a new one needs all of them. Its definition in
    `content/bosses.ts` gives hit points, radius, the attacks of each phase and
    the rests between them. Its behaviour in `sim/boss/` implements
    `BossBehaviour` (`behaviour.ts`): an `AttackSpec` for every attack its phases
    name, each with a telegraph of at least `MIN_WINDUP_SECONDS` (build them
    from the shared attack library in `sim/boss/attacks.ts`: pulses, dashes,
    rock rings, bolts, drone launches and the rest, each declaring the threat
    the bots read, before writing one of its own); and optionally
    its drift, parts, `vulnerable`, `hurtsAt` and `target` (where a shot does
    harm), its exposure events and a per-step hook. A factory builds it afresh
    for each fight, drawing only from the fight's `'boss'` stream, and
    `GalaxyRun` registers it. `BossRunner` owns what every boss shares (intro,
    phases, windups, dying) and publishes one `BossView` updated in place, which
    the renderer, the bots and the e2e bridge read; a boss never touches the
    renderer. Its look in `render/boss/` implements `BossDrawer` (`drawer.ts`):
    a glow and a `body`, with optional underglow, `advance`, `handle` and
    `reset`; the boss pass draws what every boss shares (windup rings,
    shockwave, hit flash, and a dive's aim line) and looks the drawer up by
    boss id. A drawer bakes its sprites by key and allocates nothing per frame.
    Cover a new boss with unit tests for its behaviour and drawer, a bot
    kill-rate case in `game/tests/balance/`, and an e2e spec that fights it
    through the bridge's `boss` state and `damageBoss`.
  - The Daily Galaxy (`meta/dailyGalaxy.ts`, `content/daily.ts`): every local date
    has one generated survival level, the same for every player. `dailyGalaxy(date)`
    is pure and takes only the date: the World seed is a hash of the date, and the
    generator draws from that seed's `'daily'` stream. It anchors on a real
    Dimension 1–2 survival level (`DAILY_ANCHORS`), so the curves, tiers and clear
    bonuses apply unchanged, and builds only from Dimension 1–2 material. Each date
    plays one twist, a data row in `DAILY_TWISTS` (more meteor showers, a gravity
    storm, a drone swarm, a splitter field) that the generator applies the same way as
    every other row; no twist plays two dates running, and none changes how the ship
    handles. Its target score comes from `TARGET_K` and the anchor's threat budget.
    A schedule that breaks a content rule (`content/validity.ts`, shared with the
    content tests) makes the generator throw, naming the date; a unit test builds
    every date from 1970 through 2099 to prove none does, and a few dates are pinned
    to their exact output. Mode `'daily'` starts like Free play and never touches
    Rank: a Daily run writes only the save's `daily` record (the streak and the best
    score on the latest date played), never a level's record, stars, unlocks, the
    Rank run or its board. Its results show the target, not stars. The date is read
    once as a run starts and kept for its retries, so a run past midnight counts for
    the day it began. Mode select re-reads the date every time it shows, and a date
    whose Daily cannot be built leaves its card unavailable (and logged) while the
    other modes play on. Every Daily string lives in `ui/dailyCopy.ts`, and a test
    holds them all to copy that never presses or speaks of loss. `e2e/daily.spec.ts`
    plays it through `?today=` and the bridge's `daily` state.
  - The streak (`meta/daily.ts`): a date counts on its first Daily clear, never a
    game over, and counting is idempotent. It runs on only when the last counted date
    is the day before, else it starts again at 1; a date on or before the last counted
    one changes nothing (a clock set back, a flight west). The best streak never
    goes down, mode select shows the streak from 2, and nothing ever mentions a
    streak ending: once it stops running it is simply not shown.
  - Dates (`meta/calendar.ts`) are `YYYY-MM-DD` strings with pure calendar
    arithmetic through `Date.UTC`, never by adding milliseconds. Dates are injected:
    everything takes "today" as a `() => string`, and only `app/date.ts` turns a
    `Date` into a local date.
  - "New best!" has one owner, `meta/bests.ts`: it needs an earlier record to beat
    (a first clear or an empty board never shows it) and never shows on a debug
    run. A level's best is judged at Free play scale; a Rank run's entry against the
    board's top; a Daily against that date's earlier best. The badge names the
    recorded number whenever it differs from the score the card shows.
    `e2e/moments.spec.ts` covers the badge in each mode, and holds death to playing
    again (R, Enter or a tap on the end card) under 2 s, with the end card's 0.7 s
    input guard still holding.
  - The ship's looks (`content/cosmetics.ts`, `meta/cosmetics.ts`): skins change
    the hull's trim only (rim, panel lines, cockpit), never its path or its green
    body, and engine trails change only the trail's particles, drawn from the
    render-only random source. They are visual only: nothing in `sim/`, `bot/` or
    the level content reads them, and a test proves a run's events are the same
    under every look. Unlocks are worked out from the stars saved, never stored; the
    chosen skin and trail live in the settings, and a choice no longer unlocked (a
    save reset) draws as the default. The Hangar (`ui/hangarCard.ts`,
    `app/hangar.ts`) is a card over the title and mode select with a radio group per
    kind: a locked look is disabled and names its star cost, a pick writes the
    settings at once, and focus opens on the trim drawn. The ship's sprite key is
    `ship|<palette>:<skin>|0`, which `e2e/hangar.spec.ts` reads from the bridge's
    `spriteCache` keys.
  - Attract mode (`app/attract.ts`): after 10 s without input on the bare title, the
    expert bot plays a demo level behind the dimmed card (`ATTRACT_DEMOS`, each for
    up to 45 s, a second apart). It never starts under `prefers-reduced-motion`, in
    a hidden tab, upright, or with a card over the title (settings, records, the
    Hangar, the rotate prompt, the crash card, the install prompt). It is isolated
    by its dependencies: it has no save store, flow, notices or audio, so a demo
    writes nothing, counts no run and plays no sound effect, and the renderer
    draws it with `renderer.draw(world, alpha, null)`, which skips the HUD. The
    input that ends it is swallowed in the capture phase (`app/inputRouting.ts`):
    the key with its repeats and release, a pointer press with the clicks it leads
    to, and a pad frame (`routePad(pad, edges, now)` says when it swallowed one, so
    that press spends no sound hint). Only keys that would act on the page (Enter,
    Space, Tab, the arrows) lose their browser action; F5, F12 and browser shortcuts
    keep theirs. A throw in a demo stops attract for the session and writes the
    local log, with no crash card; a crash of the game stops it too.
    `e2e/attract.spec.ts` covers it, through the bridge's `attract` state and
    `attractNow()`.
  - Ship controls (input, thrust, fire, turn, the volley and the frame loop)
    are tested with real input, never with bridge shortcuts: change any of them
    only with `e2e/keyboard.spec.ts` (every thrust, fire and turn chord, in both
    directions, on arrows and WASD, plus Space, Shift, Z and X) and the touch and
    gamepad specs passing, and add a chord case for any new binding. A held
    turn key always turns the ship.
  - Game key handling stands down while a form control has focus
    (`input/keyEvent.ts`), so sliders and radios keep their keys. `F` requests
    full screen synchronously in its keydown handler, because Safari and
    Firefox refuse a deferred request.
  - Gamepads use the standard mapping: the left stick steers like the touch
    joystick, the D-pad turns and thrusts, A/RB/RT fire, Start pauses, and on
    menus the D-pad moves focus, A confirms and B goes back.
  - The crash guard wraps each frame. A crash shows a recovery card with
    *Try again* and *Copy report*; the report comes from an in-memory ring log
    and nothing is sent anywhere.
  - Draw sizes scale up on small screens (`render/visualScale.ts`) while the
    720-unit field and every hitbox stay identical on all devices.
  - `render/` draws from interpolated sim poses. Sprites are baked once into a
    bounded LRU cache (`spriteCache.ts`, `sprites.ts`), whose
    `SPRITE_CACHE_CAPACITY` is at least 1.5 times the most sprites
    `e2e/spriteCache.spec.ts` sees in use in the last survival level and the
    last three boss fights, and which may evict next to nothing there (the spec
    plays them in the look that bakes the most sprites, and thrusts so the
    trail's glows are baked too); glows are baked or
    additive sprites. Never set `shadowBlur` (ESLint bans it) or a canvas
    `filter` per frame. `fieldPen.ts` lands an upright sprite drawn at its baked
    size on whole device pixels, which a CPU-rasterized canvas copies several
    times faster than a resampled one; `turnedSprite.ts` turns a big sprite once
    onto its own canvas and draws that upright until its angle moves its corners
    half a pixel. Effects (`effects.ts`) drive a pooled particle system,
    shake and flash, and honour `prefers-reduced-motion`.
  - `render/quality.ts` steps through `QUALITY_LEVELS` from measured frame
    time with hysteresis, judged against the display's own frame interval as
    measured on idle screens (so a 30 Hz-capped display is not read as
    overloaded); the lowest levels add the `lite` body class, which
    turns off CSS backdrop blur. `?quality=` pins a level in e2e and dev builds.
  - `audio/` is all synthesized WebAudio: no audio files. The `AudioContext` is
    created on the first user gesture, suspended while the tab is hidden, and
    builds no nodes while suspended or muted. `M` or the sound chip toggles mute.
  - `World` takes a rules strategy. Practice rules (the old game's spawning,
    kept for tests and pinned by `game/tests/fixtures/practice-log.json`) and level
    rules: a threat-budget director (`sim/galaxy/director.ts`) keeps the
    on-field cost under a budget normalised to field area, a scripted pacing
    (opening, build, lull, surge, warp-out) shapes it, meteor showers are
    scheduled and telegraphed and their rocks pass through instead of wrapping,
    and boss levels run a phased boss (`sim/boss/`). `galaxyCleared` fires
    when the warp starts (the timer runs out, or the boss's HP hits 0), and the
    app records the clear at that moment.
  - Progress saves under `cosmic-assault.v2` (`meta/save.ts`, `app/saveStore.ts`).
    Loading sanitizes field by field; every write re-reads, merges (`mergeSaves`:
    furthest frontier, best score and stars per level, the ranked run with the
    higher `rankSeq`) and never writes after a failed read. Other tabs' changes
    arrive through the `storage` event, and a ranked run playing in another
    tab is detected over `BroadcastChannel` before any forfeit.
  - Settings persist in `localStorage` under the key
    `cosmic-assault.v2.settings` (`app/settings.ts`): mute, music and effects
    volume, screen shake (`auto`, `on` or `off`; `auto` follows
    `prefers-reduced-motion`), left-handed touch controls, and the ship's skin and
    engine trail. Loading sanitizes
    field by field and never throws. New stored data must use the `cosmic-assault.v2.`
    prefix, because the legacy site shares the origin.
- There is no root npm package or workspace. Run npm commands from `game/` or
  `tests/`, whichever package you are changing. `ReadMe.md` is the README's
  exact filename.

## Local development and validation

Use Node.js 24 (the version in `.nvmrc`; local ≥22.12 works). Install locked
dependencies with `npm ci` in `game/` or `tests/`, whichever package you are
changing.

For the website, run `npm run serve` from `tests/` after installing its
dependencies, then open `http://localhost:8080`.

Run applicable checks in this order: lint, typecheck, tests, verification.

1. **Lint:** For `game/` changes, run `npm run lint` from `game/`. `tests/` has
   no lint script; report its lint as unavailable rather than inventing a gate.
2. **Typecheck:** For `game/` changes, run `npm run typecheck` from `game/`.
   `tests/` has no typecheck script.
3. **Tests:** For `game/` changes, run `npm test` (Vitest) and `npm run test:e2e`
   (Playwright against the e2e build, plus a smoke test of the release build)
   from `game/`; install Chromium first with `npx playwright install chromium`.
   Locally, `test:e2e` builds both before serving them on ports 4317 (e2e) and
   4318 (release), clear of Vite's default preview port. `npm run test:perf`
   (the `perf` project: 4x CPU slowdown, a busy field and a boss fight, each
   held to the frame-time ceilings in `game/e2e/perfThresholds.ts`, which are
   worked out from eight recorded runs of the CI job spread over hours (runner
   speed varies), and both written to
   `game/test-results/perf.json`) is not part of `test:e2e`; CI runs it as the
   `perf` job, which gates deployment. `npm run test:balance` runs the slow many-seed bot
   suites in `game/tests/balance/`, which `npm test` leaves out. `targets.ts`
   is the balance matrix: for every level, how long an idle ship lasts (at
   least 20 s in the first, and no longer than in the level before, bar the
   ruled exceptions), the casual's
   clear rate against a trend band (a few levels hold a ruled floor instead),
   the expert's clears and stars, and each boss's kill bar. Each Dimension has
   its `d<N>-targets.test.ts`, and every balance file carries a `d<N>-` prefix
   or, for the Daily's suite (`daily.test.ts`: many dates, each on its own seed, the
   expert clearing every one, the casual's clear rate in band for every twist, and
   the target in reach), the `daily` prefix, which `check:workflow` guards; pass
   `-- d3-` to run one Dimension, or `-- daily` for the Daily. Run it after any change
   to level content, difficulty curves, pacing, boss stats, the Daily generator or the bots, and
   before changing a target; CI runs it as the non-required `balance` check. For changes to
   `website/` gameplay, UI, or the legacy tests, install Chromium with
   `npx playwright install chromium` from `tests/`, then run
   `npm test -- --project=chromium-desktop`. Linux hosts may need Playwright's
   browser system dependencies installed separately.
4. **Verification:** For game changes, check the affected desktop
   and mobile behavior in a browser, including browser console errors.
   For documentation-only changes, verify referenced paths and commands and run
   `git diff --check`; application suites are unnecessary.

In `tests/`, Playwright starts the local server automatically unless `TEST_URL`
is set. Set `TEST_URL` to test an existing deployed site. The full `npm test` suite includes
Chromium, Firefox, WebKit, mobile Chrome, and mobile Safari; install the corresponding
browsers before running it. CI currently runs only `chromium-desktop`, with one
worker and retries. Reports and failure artifacts live under `tests/playwright-report/`
and `tests/test-results/` and are ignored by Git.

## Change workflow

- Work on a feature branch from `main`; never commit directly to `main`.
  Use intentional conventional commits and a pull request for each change.
- Keep changes focused. After non-trivial code edits, apply the native `refactor`
  skill (dedup, then simplify) to the touched scope before tests. Reuse the existing
  owner of behavior instead of copying helpers or introducing one-call wrappers.
- Before declaring a PR ready, inspect unresolved review threads, CI logs,
  Codacy findings, and Codecov patch coverage when available. Fix actionable
  failures, and report unavailable checks explicitly.
- When the Codacy MCP server is available in the session, follow
  `.github/instructions/codacy.instructions.md`. Otherwise report Codacy
  analysis as unavailable and continue. `.codacy.yml` only lists
  exclusions; the repository is not currently analysed on Codacy. No Codecov
  configuration or coverage upload is currently committed.
- `.github/workflows/ci.yml` is the only workflow. It runs on pull requests to
  `main`, pushes to `main`, and manual dispatch. Job `game` runs the `game/`
  workflow guard, lint, typecheck, unit tests, the expert D1–D2 digests
  (`npm run test:digests`, one file of the balance suite), release build, base check,
  no-test-bridge check, e2e build, and e2e tests (the `chromium-desktop` and
  `mobile-landscape` projects against `dist-e2e/`, plus the `release-smoke`
  project against `dist/`);
  job `legacy` runs the `tests/` Playwright suite in `chromium-desktop` against
  `website/`. Job `perf` builds both bundles and runs `npm run test:perf`.
  Job `deploy` runs only on pushes to `main`, and only after `game`, `legacy`
  and `perf` pass, so a frame-time regression cannot ship; `npm run
  check:workflow` in `game/` guards that gate. `perf` is not a required check,
  so a pull request may merge before it passes. Job
  `balance-dimension` runs `npm run test:balance -- <shard>` as a matrix over
  the shards `d1-` to `d5-` and `daily`, and job `balance` passes only if every shard did, so the
  ruleset sees one check. `balance` is a report: not a required check, and it
  does not gate deployment.
- Resolve review threads only after implementing the requested change or posting
  a justified reply. Merge only when required checks pass and no actionable
  threads remain, then remove the merged branch and prune stale references.
  CI failures caused by infrastructure or billing problems are not grounds
  to merge; stop and report them.
- Do not commit dependencies, generated build output, browser artifacts,
  credentials, or real account-specific cloud identifiers.
- On Windows 11, load native `env-detect` and `windows-execution` skills and use
  PowerShell 7 for terminal work, except repository-required POSIX workflows.
  Invoke native executables directly with argument arrays and literal paths;
  inspect `$LASTEXITCODE`.

## Deployment context

GitHub Pages is the only deployment, published by the `deploy` job in
`.github/workflows/ci.yml`. Pages serves `website/` at the root and `game/dist`
at `next/`. The job fails if the published root differs from `website/`.
There are no other hosting paths.

The `game/` build is an installable, offline-capable web app. `vite/precache.ts`
emits `src/sw/worker.ts` as `sw.js` with the list of every built file but the two
512 px icons (`NOT_PRECACHED`), which the browser fetches itself when it installs
the app; `tests/unit/icons.test.ts` caps the precached icons' bytes. The worker
registers from `./sw.js` with its default scope, so it controls only `/next/`
and never the legacy root; it is never registered by the Vite dev server. Each
deploy gets a new cache version, and older `cosmic-assault-next-*` caches are
deleted when the new worker activates.
