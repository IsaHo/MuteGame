/*
 * Client-side session lifecycle state machine.
 *
 * Pure reducer (no DOM, no socket, no IPC) so it can be unit-tested in
 * Node without Electron. App.jsx wires socket events + timer ticks to
 * dispatch() and renders based on state.
 *
 * States:
 *   IDLE          — no session, login screen
 *   STARTING      — login submitted, awaiting session:started from server
 *   ACTIVE        — session live, billing running
 *   GRACE_SOFT    — disconnected, overlay shown, game keeps running
 *                   (0..30s; all lockout levels enter here first)
 *   GRACE_MEDIUM  — disconnected longer, overlay + block new launches
 *                   (30s+; only when lockout level ∈ {medium, hard})
 *   GRACE_HARD    — disconnected even longer, overlay + kill active game
 *                   (60s+; only when lockout level == hard)
 *   RECOVERING    — socket reconnected, awaiting resume:ok / resume:rejected
 *   RECOVERED     — short transition state used to flash "session restored"
 *                   to the user (≤500ms) before returning to ACTIVE
 *   LOCKED        — session ended (no_credits / kick / etc.); kiosk locked
 *
 * Events (action.type):
 *   LOGIN_SUBMIT          IDLE → STARTING (no payload required)
 *   SESSION_STARTED       STARTING → ACTIVE
 *                         payload: { session_uuid, user_id, locked_rate_per_hour }
 *   LOGIN_ERROR           STARTING → IDLE
 *                         payload: { reason }
 *   DISCONNECTED          ACTIVE → GRACE_SOFT (resets gracePhase to 0)
 *   GRACE_TIMER           GRACE_SOFT → GRACE_MEDIUM (at 30s, if level ≥ medium)
 *                         GRACE_MEDIUM → GRACE_HARD (at 60s, if level == hard)
 *                         payload: { elapsed_seconds }
 *   RECONNECTING          GRACE_* → RECOVERING
 *                         (emits client:resume from the dispatcher side)
 *   RESUME_OK             RECOVERING → RECOVERED → ACTIVE (via subsequent
 *                         RECOVERED_HIDE event after a brief flash)
 *                         payload: { session_id, credits, debt, post_pay,
 *                                    locked_rate_per_hour }
 *   RECOVERED_HIDE        RECOVERED → ACTIVE
 *   RESUME_REJECTED       RECOVERING → IDLE (clear session)
 *                         payload: { reason }
 *   SESSION_END           ACTIVE / RECOVERED → LOCKED
 *                         payload: { reason }
 *   ADMIN_KICK            * → LOCKED
 *   LOGOUT                ACTIVE → IDLE
 *   LOCK_UNLOCKED         LOCKED → IDLE  (user dismissed lock screen)
 *   STRIKE_LIMIT_HIT      RECOVERING → IDLE (after N resume:rejected in
 *                         60s, fall back to operator-call screen)
 *   ADMIN_MESSAGE         any → any (no state transition; stores message)
 *                         payload: { text }
 *
 * Lockout escalation policy:
 *   The state machine itself is policy-agnostic. The dispatcher (App.jsx)
 *   reads the lockout_level setting and decides whether to fire GRACE_TIMER
 *   events at the medium and hard thresholds. The reducer enforces the
 *   ordering (no skipping levels, no going backwards).
 */

const SS = Object.freeze({
  IDLE:         'IDLE',
  STARTING:     'STARTING',
  ACTIVE:       'ACTIVE',
  GRACE_SOFT:   'GRACE_SOFT',
  GRACE_MEDIUM: 'GRACE_MEDIUM',
  GRACE_HARD:   'GRACE_HARD',
  RECOVERING:   'RECOVERING',
  RECOVERED:    'RECOVERED',
  LOCKED:       'LOCKED',
});

const LOCKOUT_LEVELS = Object.freeze(['soft', 'medium', 'hard']);

const initial = Object.freeze({
  state: SS.IDLE,
  session_uuid: null,
  session_id: null,
  user_id: null,
  credits: null,
  debt: null,
  post_pay: 0,
  locked_rate_per_hour: null,
  disconnect_at: null,       // ms timestamp when DISCONNECTED fired
  grace_elapsed_s: 0,
  last_resume_reason: null,
  reject_strike_count: 0,
  reject_strike_window_start: null,
  admin_message: null,
  lockout_level: 'medium',
});

const STRIKE_WINDOW_MS = 60_000;
const STRIKE_LIMIT = 3;

function reducer(state, action) {
  if (!action || !action.type) return state;
  switch (action.type) {
    case 'SET_LOCKOUT_LEVEL': {
      const lvl = action.level;
      if (!LOCKOUT_LEVELS.includes(lvl)) return state;
      return { ...state, lockout_level: lvl };
    }

    case 'LOGIN_SUBMIT': {
      if (state.state !== SS.IDLE) return state;
      return { ...state, state: SS.STARTING, last_resume_reason: null };
    }

    case 'SESSION_STARTED': {
      if (state.state !== SS.STARTING && state.state !== SS.RECOVERING && state.state !== SS.RECOVERED) {
        // Defensive — server may double-emit; accept from STARTING only.
        return state;
      }
      return {
        ...state,
        state: SS.ACTIVE,
        session_uuid: action.session_uuid,
        session_id: action.session_id || state.session_id,
        user_id: action.user_id,
        credits: action.credits == null ? state.credits : action.credits,
        debt: action.debt == null ? state.debt : action.debt,
        post_pay: action.post_pay == null ? state.post_pay : action.post_pay,
        locked_rate_per_hour: action.locked_rate_per_hour,
        disconnect_at: null,
        grace_elapsed_s: 0,
      };
    }

    case 'LOGIN_ERROR': {
      return { ...initial, lockout_level: state.lockout_level, last_resume_reason: action.reason || 'login_error' };
    }

    case 'DISCONNECTED': {
      if (state.state !== SS.ACTIVE) return state;
      return {
        ...state,
        state: SS.GRACE_SOFT,
        disconnect_at: action.now_ms || 0,
        grace_elapsed_s: 0,
      };
    }

    case 'GRACE_TIMER': {
      // Update grace_elapsed_s on every tick; transition based on
      // lockout_level + elapsed time. Idempotent — repeated ticks at
      // the same elapsed value don't bounce states.
      const elapsed = Math.max(state.grace_elapsed_s, action.elapsed_seconds || 0);
      const cur = state.state;
      if (cur !== SS.GRACE_SOFT && cur !== SS.GRACE_MEDIUM && cur !== SS.GRACE_HARD) return state;

      let nextState = cur;
      const level = state.lockout_level;
      // Soft never escalates.
      if (level === 'medium' || level === 'hard') {
        if (elapsed >= 30 && cur === SS.GRACE_SOFT) nextState = SS.GRACE_MEDIUM;
      }
      if (level === 'hard') {
        if (elapsed >= 60 && (cur === SS.GRACE_SOFT || cur === SS.GRACE_MEDIUM)) nextState = SS.GRACE_HARD;
      }
      if (nextState === cur && elapsed === state.grace_elapsed_s) return state;
      return { ...state, state: nextState, grace_elapsed_s: elapsed };
    }

    case 'RECONNECTING': {
      const cur = state.state;
      if (cur !== SS.GRACE_SOFT && cur !== SS.GRACE_MEDIUM && cur !== SS.GRACE_HARD) return state;
      return { ...state, state: SS.RECOVERING };
    }

    case 'RESUME_OK': {
      if (state.state !== SS.RECOVERING) return state;
      return {
        ...state,
        state: SS.RECOVERED,
        session_id: action.session_id == null ? state.session_id : action.session_id,
        credits: action.credits == null ? state.credits : action.credits,
        debt: action.debt == null ? state.debt : action.debt,
        post_pay: action.post_pay == null ? state.post_pay : action.post_pay,
        locked_rate_per_hour: action.locked_rate_per_hour == null ? state.locked_rate_per_hour : action.locked_rate_per_hour,
        last_resume_reason: 'ok',
        disconnect_at: null,
        grace_elapsed_s: 0,
        reject_strike_count: 0,
        reject_strike_window_start: null,
      };
    }

    case 'RECOVERED_HIDE': {
      if (state.state !== SS.RECOVERED) return state;
      return { ...state, state: SS.ACTIVE };
    }

    case 'RESUME_REJECTED': {
      if (state.state !== SS.RECOVERING) return state;
      const reason = action.reason || 'unknown';
      const nowMs = action.now_ms || 0;
      let strikeCount = state.reject_strike_count;
      let windowStart = state.reject_strike_window_start;
      if (!windowStart || nowMs - windowStart > STRIKE_WINDOW_MS) {
        windowStart = nowMs;
        strikeCount = 1;
      } else {
        strikeCount += 1;
      }
      return {
        ...initial,
        lockout_level: state.lockout_level,
        last_resume_reason: reason,
        reject_strike_count: strikeCount,
        reject_strike_window_start: windowStart,
        state: strikeCount >= STRIKE_LIMIT ? SS.LOCKED : SS.IDLE,
      };
    }

    case 'SESSION_END': {
      // Server-initiated session end (no_credits, kick, limit, etc.)
      // Lands directly in LOCKED regardless of current state — including
      // GRACE_* and RECOVERING (server's final word).
      return { ...initial, lockout_level: state.lockout_level, last_resume_reason: action.reason || 'session_end', state: SS.LOCKED };
    }

    case 'ADMIN_KICK': {
      return { ...initial, lockout_level: state.lockout_level, last_resume_reason: 'admin_kick', state: SS.LOCKED };
    }

    case 'LOGOUT': {
      if (state.state !== SS.ACTIVE && state.state !== SS.RECOVERED) return state;
      return { ...initial, lockout_level: state.lockout_level };
    }

    case 'LOCK_UNLOCKED': {
      if (state.state !== SS.LOCKED) return state;
      return { ...initial, lockout_level: state.lockout_level };
    }

    case 'ADMIN_MESSAGE': {
      return { ...state, admin_message: action.text || null };
    }

    case 'CLEAR_ADMIN_MESSAGE': {
      return { ...state, admin_message: null };
    }

    default:
      return state;
  }
}

/*
 * Selectors / helpers — used by App.jsx so render logic doesn't need to
 * inspect raw state strings everywhere.
 */
function isOverlayVisible(state) {
  return (
    state.state === SS.GRACE_SOFT
    || state.state === SS.GRACE_MEDIUM
    || state.state === SS.GRACE_HARD
    || state.state === SS.RECOVERING
    || state.state === SS.RECOVERED
  );
}
function isGameLaunchAllowed(state) {
  // Soft + Active permit launching. Medium and harder block new launches.
  if (state.state === SS.ACTIVE) return true;
  if (state.state === SS.GRACE_SOFT) return true;
  return false;
}
function shouldKillActiveGame(state) {
  return state.state === SS.GRACE_HARD;
}
function canEmitResume(state) {
  // Only meaningful when we have a uuid and we're in a graceful state.
  if (!state.session_uuid || !state.user_id) return false;
  return (
    state.state === SS.GRACE_SOFT
    || state.state === SS.GRACE_MEDIUM
    || state.state === SS.GRACE_HARD
    || state.state === SS.RECOVERING
  );
}

module.exports = {
  reducer,
  initial,
  SESSION_STATES: SS,
  LOCKOUT_LEVELS,
  STRIKE_LIMIT,
  STRIKE_WINDOW_MS,
  isOverlayVisible,
  isGameLaunchAllowed,
  shouldKillActiveGame,
  canEmitResume,
};
