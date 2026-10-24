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
- `infrastructure/` is a separate npm package containing TypeScript AWS CDK code.
  Its entry point instantiates `WebsiteStack` from `lib/website-stack.ts`, which
  deploys `../website` to S3 and CloudFront. `InfrastructureStack` is an unused
  scaffold; the Jest test is currently a placeholder with no assertions.
- There is no root npm package or workspace. Run npm commands in the package
  directories below. `ReadMe.md` is the README's exact filename.

## Local development and validation

Use Node.js 20 to match the Playwright workflow. Install locked dependencies with
`npm ci` in the package being worked on.

For the website, run `npm run serve` from `tests/` after installing its
dependencies, then open `http://localhost:8080`. No AWS credentials are needed
for game development or local browser tests.

Run applicable checks in this order: lint, typecheck, tests, verification.

1. **Lint:** Neither package currently defines a lint script or a local lint
   configuration. Report this as unavailable; do not invent a passing lint gate.
2. **Typecheck:** For infrastructure changes, run `npm run build` from
   `infrastructure/`. It runs TypeScript and writes compiled files to `dist/`.
   There is no website or Playwright typecheck script.
3. **Tests:** For infrastructure changes, run `npm test -- --runInBand` from
   `infrastructure/`; its current placeholder does not validate stack resources.
   For gameplay, UI, or test changes, install Chromium with
   `npx playwright install chromium` from `tests/`, then run
   `npm test -- --project=chromium-desktop`. Linux hosts may need Playwright's
   browser system dependencies installed separately.
4. **Verification:** For infrastructure changes, run `npm run cdk -- synth` from
   `infrastructure/` after building. For game changes, check the affected desktop
   and mobile behavior in a browser, including browser console errors.
   For documentation-only changes, verify referenced paths and commands and run
   `git diff --check`; application suites are unnecessary.

Playwright starts the local server automatically unless `TEST_URL` is set.
Set `TEST_URL` to test an existing deployed site. The full `npm test` suite includes
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
- Follow `.github/instructions/codacy.instructions.md` for Codacy analysis.
  `.codacy.yml` currently enables Go analyzers despite this JavaScript/TypeScript
  repository; do not assume that configuration proves code quality. No Codecov
  configuration or coverage upload is currently committed.
- `.github/workflows/ci.yml` contains echo-only Build and Test jobs.
  `.github/workflows/test-branch.yml` runs real Playwright tests for PRs to `main`
  and pushes to `feature/**` and `refactor/**`. Green placeholder jobs do not
  replace local validation.
- Resolve review threads only after implementing the requested change or posting
  a justified reply. Merge only when required checks pass and no actionable
  threads remain, then remove the merged branch and prune stale references.
  No infrastructure or billing failure exception is defined here.
- Do not commit dependencies, generated build output, browser artifacts,
  credentials, or real account-specific cloud identifiers.
- On Windows 11, load native `env-detect` and `windows-execution` skills and use
  PowerShell 7 for terminal work, except repository-required POSIX workflows.
  Invoke native executables directly with argument arrays and literal paths;
  inspect `$LASTEXITCODE`.

## Deployment context

GitHub Pages publishes `website/` via `.github/workflows/deploy.yml` on pushes to
`main` and the explicitly listed `feature/quick-wins` branch. `netlify.toml`
configures static branch and PR previews. The Playwright workflow's
`deploy-preview` job prepares an artifact and posts test status; it does not
deploy a separate preview site.

AWS CDK deployment is a separate path. Run CDK commands from `infrastructure/`
because the app and website asset paths are relative to that directory.
Deployment or teardown requires an explicit task authorizing that operation.
The website bucket currently uses `RemovalPolicy.DESTROY` and
`autoDeleteObjects: true`, so teardown deletes its contents.
