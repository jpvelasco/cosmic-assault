// Lists the lowest World seeds, from 1 up, for which an e2e seed claim holds (see e2e/seeds.ts) or an attract demo's claim
// does (attract-<galaxy>, see ATTRACT_DEMOS in src/app/attract.ts); for a date claim, the earliest dates from DATE_EPOCH,
// with --from and --to counted in days after it.
// Run from game/ with: npm run find-seeds -- <claim> [--count N] [--from N] [--to N]
// It loads the TypeScript checks the guard tests use (tests/helpers/seedClaims.ts) through Vite, headlessly.
import { createServer } from 'vite';

const USAGE = 'usage: npm run find-seeds -- <claim> [--count N] [--from N] [--to N], where --from and --to are seeds, or for a date claim, days after DATE_EPOCH';

const FLAGS = { count: 1, from: 0, to: 1 };

/** Reads a whole-number flag of at least its minimum, or exits saying how to fix it. */
function numberFlag(args, name) {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return undefined;
  const value = Number(args[at + 1]);
  if (!Number.isInteger(value) || value < FLAGS[name]) fail(`--${name} needs a whole number of ${String(FLAGS[name])} or more (got "${args[at + 1] ?? ''}")`);
  return value;
}

function fail(message) {
  console.error(`${message}\n${USAGE}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const server = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true }, logLevel: 'silent' });
try {
  const { claimIds, findSeeds, dateClaimIds, findDates, demoClaimIds, findDemoSeeds } = await server.ssrLoadModule('/tests/helpers/seedClaims.ts');
  const dateClaims = dateClaimIds();
  const demoClaims = demoClaimIds();
  const claims = [...claimIds(), ...demoClaims, ...dateClaims];
  const claim = args[0];
  if (claim === undefined || claim.startsWith('--')) fail(`name a claim: ${claims.join(', ')}`);
  if (!claims.includes(claim)) fail(`unknown claim "${claim}"; the claims are ${claims.join(', ')}`);
  const unknown = args.slice(1).find((arg) => arg.startsWith('--') && !(arg.slice(2) in FLAGS));
  if (unknown !== undefined) fail(`unknown option "${unknown}"; the options are ${Object.keys(FLAGS).map((flag) => `--${flag}`).join(', ')}`);
  const options = { from: numberFlag(args, 'from'), count: numberFlag(args, 'count'), to: numberFlag(args, 'to') };
  const given = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
  const byDate = dateClaims.includes(claim);
  const find = byDate ? findDates : demoClaims.includes(claim) ? findDemoSeeds : findSeeds;
  const found = find(claim, given);
  const start = byDate ? `date from day ${String(options.from ?? 0)} after DATE_EPOCH` : `seed from ${String(options.from ?? 1)}`;
  if (found.length === 0) fail(`no ${start} keeps "${claim}"; widen the range with --to, or the claim may need rethinking`);
  console.log(`${claim}: ${found.join(', ')}`);
} finally {
  await server.close();
}
