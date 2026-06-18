/*
 * JWT secret loader — single source of truth for JWT_SECRET across the server.
 *
 * Read at module load time and validated. The process REFUSES TO BOOT when:
 *   • JWT_SECRET env var is unset or empty, or
 *   • shorter than MIN_LEN characters (defends against weak ops-set values).
 *
 * Rationale: a hardcoded fallback baked into the source means the secret is
 * effectively public — anyone with read access to the repo can forge admin
 * tokens, defeating every JWT-based check (request middleware AND socket.io
 * handshake). Fail-fast on boot is the only safe posture.
 *
 * Operator notes:
 *   • Set JWT_SECRET in the process environment before `node index.js`
 *     (systemd unit, Electron launcher, docker compose, etc.).
 *   • The server-app Electron wrapper should populate it before
 *     `require('./server/index')` — see server-app/main.js.
 */
const MIN_LEN = 32;

const raw = process.env.JWT_SECRET;

function die(msg) {
  console.error('');
  console.error('╔══════════════════════════════════════════════════════════════╗');
  console.error('║  FATAL: JWT_SECRET configuration invalid — server will exit  ║');
  console.error('╚══════════════════════════════════════════════════════════════╝');
  console.error(`  ${msg}`);
  console.error('');
  console.error('  Set the JWT_SECRET environment variable before starting the');
  console.error('  server. Generate one with:');
  console.error('    node -p "require(\'crypto\').randomBytes(48).toString(\'hex\')"');
  console.error('  Then in bash:  export JWT_SECRET=<paste>');
  console.error('');
  process.exit(1);
}

if (typeof raw !== 'string' || raw.length === 0) {
  die('JWT_SECRET is not set in the process environment.');
}
if (raw.length < MIN_LEN) {
  die(`JWT_SECRET must be at least ${MIN_LEN} characters; got ${raw.length}.`);
}

module.exports = raw;
