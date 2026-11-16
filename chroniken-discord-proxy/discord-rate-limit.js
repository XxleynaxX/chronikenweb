/**
 * Discord-HTTP-Schutz für den Chroniken-Proxy.
 *
 * Webhooks (Wetter, Mond, Mod-Watcher, Heiler usw.) teilen sich eine
 * eigene Rate-Limit-Queue. OAuth-Login läuft bewusst komplett getrennt,
 * damit automatische Discord-Meldungen den Login nicht ausbremsen.
 */

// Jeder Discord-Webhook hat sein eigenes Rate-Limit.
// Eine gemeinsame Queue für Wetter, Mond, Mod-Watcher, Heiler und Charaktere
// würde sonst einen einzelnen überlasteten Webhook für alle anderen blockieren.
const webhookStates = new Map();
let webhookGlobalBlockedUntil = 0;

let oauthBlockedUntil = 0;
let oauthNextRequestAt = 0;
let oauthQueue = Promise.resolve();

const MIN_INTERVAL_MS = Math.max(100, Number(process.env.DISCORD_MIN_REQUEST_INTERVAL_MS) || 2100);
// Discord-Retry-After kann theoretisch sehr groß werden. Niemals den gesamten
// Render-Prozess minutenlang in await delay() hängen lassen.
const MAX_AUTOMATIC_RETRY_MS = Math.max(
  1000,
  Number(process.env.DISCORD_MAX_AUTOMATIC_RETRY_MS) || 10000
);
const MAX_RETRIES = Math.max(0, Math.min(5, Number(process.env.DISCORD_MAX_RATE_LIMIT_RETRIES) || 3));

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function webhookKey(url) {
  // Webhook-URLs sind geheim. Für die Logik reicht die URL selbst als Map-Key,
  // sie wird niemals ausgegeben.
  return String(url || '');
}

function getWebhookState(url) {
  const key = webhookKey(url);
  let state = webhookStates.get(key);
  if (!state) {
    state = {
      queue: Promise.resolve(),
      nextRequestAt: 0,
      blockedUntil: 0
    };
    webhookStates.set(key, state);
  }
  return state;
}

function retryAfterMs(response, bodyText) {
  const header = Number(response.headers.get('retry-after'));
  if (Number.isFinite(header) && header >= 0) return Math.ceil(header * 1000);

  const resetAfter = Number(response.headers.get('x-ratelimit-reset-after'));
  if (Number.isFinite(resetAfter) && resetAfter >= 0) return Math.ceil(resetAfter * 1000);

  try {
    const json = JSON.parse(bodyText || '{}');
    const retry = Number(json.retry_after);
    if (Number.isFinite(retry) && retry >= 0) return Math.ceil(retry * 1000);
  } catch {}

  return 1000;
}

function isGlobal(response) {
  return String(response.headers.get('x-ratelimit-scope') || '').toLowerCase() === 'global'
    || String(response.headers.get('x-ratelimit-global') || '').toLowerCase() === 'true';
}

function makeRateLimitedResponse(waitMs, global = false) {
  return new Response(JSON.stringify({
    message: 'Discord Webhook Rate Limit',
    retry_after: waitMs / 1000,
    global
  }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(Math.ceil(waitMs / 1000))
    }
  });
}

async function runWebhook(url, request, state) {
  for (let attempt = 0; ; attempt++) {
    const now = Date.now();
    const blockedUntil = Math.max(state.blockedUntil, webhookGlobalBlockedUntil);

    // Bereits bekannter Cooldown: nicht erneut an Discord senden und vor allem
    // keine minutenlange Queue blockieren.
    if (blockedUntil > now) {
      const remaining = blockedUntil - now;
      console.warn('[Discord Webhook Rate Limit] Cooldown aktiv; Anfrage nicht erneut gesendet.', JSON.stringify({
        retryAfterMs: remaining,
        retryAfterSeconds: Number((remaining / 1000).toFixed(1))
      }));
      return makeRateLimitedResponse(remaining, webhookGlobalBlockedUntil > now);
    }

    const wait = Math.max(0, state.nextRequestAt - now);
    if (wait > 0) await delay(wait);

    state.nextRequestAt = Date.now() + MIN_INTERVAL_MS;
    const response = await request();

    if (response.status !== 429 || attempt >= MAX_RETRIES) return response;

    const bodyText = await response.clone().text().catch(() => '');
    const waitMs = retryAfterMs(response, bodyText);
    const global = isGlobal(response);
    const until = Date.now() + waitMs;

    if (global) {
      webhookGlobalBlockedUntil = Math.max(webhookGlobalBlockedUntil, until);
    } else {
      state.blockedUntil = Math.max(state.blockedUntil, until);
    }

    console.warn('[Discord Webhook Rate Limit]', JSON.stringify({
      status: 429,
      retryAfterMs: waitMs,
      retryAfterSeconds: Number((waitMs / 1000).toFixed(1)),
      global,
      attempt: attempt + 1,
      maxRetries: MAX_RETRIES,
      automaticRetry: waitMs <= MAX_AUTOMATIC_RETRY_MS
    }));

    // Kurze Limits automatisch wiederholen. Bei langen Limits sofort zurückgeben,
    // damit keine Anfrage 30+ Minuten in der Queue hängt.
    if (waitMs > MAX_AUTOMATIC_RETRY_MS) {
      return response;
    }

    await delay(waitMs);
  }
}

function discordFetch(url, options = {}) {
  const state = getWebhookState(url);

  const job = state.queue.then(() => runWebhook(
    url,
    () => fetch(url, options),
    state
  ));

  state.queue = job.catch(() => {});

  return job;
}


function discordOAuthFetch(url, options = {}) {
  const job = oauthQueue.then(async () => {
    const now = Date.now();
    if (now < oauthBlockedUntil) {
      const error = new Error('Discord OAuth ist wegen eines Rate-Limits vorübergehend pausiert.');
      error.code = 'DISCORD_RATE_LIMITED';
      error.retryAfterMs = oauthBlockedUntil - now;
      throw error;
    }

    const wait = Math.max(0, oauthNextRequestAt - now);
    if (wait) await delay(wait);
    oauthNextRequestAt = Date.now() + 250;

    const response = await fetch(url, options);
    if (response.status === 429) {
      const bodyText = await response.clone().text().catch(() => '');
      const retryAfter = oauthRetryAfterMs(response, bodyText);
      oauthBlockedUntil = Math.max(oauthBlockedUntil, Date.now() + retryAfter);
      console.warn('[Discord OAuth]', JSON.stringify({
        event: 'rate_limited',
        status: 429,
        retryAfterMs: retryAfter,
        retryAfterSeconds: Number((retryAfter / 1000).toFixed(3)),
        resumeAt: new Date(oauthBlockedUntil).toISOString(),
        rateLimitScope: response.headers.get('x-ratelimit-scope'),
        rateLimitResetAfter: response.headers.get('x-ratelimit-reset-after')
      }));
    }
    return response;
  });
  oauthQueue = job.catch(() => {});
  return job;
}

module.exports = {
  discordFetch,
  discordOAuthFetch,
  discordOAuthCooldownStatus
};

