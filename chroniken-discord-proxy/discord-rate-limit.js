/**
 * Discord-HTTP-Schutz für den Chroniken-Proxy.
 *
 * Webhooks (Wetter, Mond, Mod-Watcher, Heiler usw.) teilen sich eine
 * eigene Rate-Limit-Queue. OAuth-Login läuft bewusst komplett getrennt,
 * damit automatische Discord-Meldungen den Login nicht ausbremsen.
 */

let webhookQueue = Promise.resolve();
let webhookNextRequestAt = 0;
let webhookGlobalBlockedUntil = 0;
let oauthBlockedUntil = 0;
let oauthNextRequestAt = 0;
let oauthQueue = Promise.resolve();

const MIN_INTERVAL_MS = Math.max(0, Number(process.env.DISCORD_MIN_REQUEST_INTERVAL_MS) || 50);
const MAX_RETRIES = Math.max(0, Math.min(5, Number(process.env.DISCORD_MAX_RATE_LIMIT_RETRIES) || 3));

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
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

function oauthRetryAfterMs(response, bodyText) {
  const retryAfterHeader = response.headers.get('retry-after');
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.ceil(retryAfter * 1000);
  const retryAfterDate = Date.parse(retryAfterHeader || '');
  if (Number.isFinite(retryAfterDate)) return Math.max(0, retryAfterDate - Date.now());

  const resetAfter = Number(response.headers.get('x-ratelimit-reset-after'));
  if (Number.isFinite(resetAfter) && resetAfter >= 0) return Math.ceil(resetAfter * 1000);

  try {
    const retry = Number(JSON.parse(bodyText || '{}').retry_after);
    if (Number.isFinite(retry) && retry >= 0) return Math.ceil(retry * 1000);
  } catch {}

  return 1000;
}

function discordOAuthCooldownStatus() {
  const retryAfterMs = Math.max(0, oauthBlockedUntil - Date.now());
  return {
    retryAfterMs,
    resumeAt: retryAfterMs > 0 ? new Date(oauthBlockedUntil).toISOString() : null
  };
}

async function runWebhook(request) {
  for (let attempt = 0; ; attempt++) {
    const now = Date.now();
    const wait = Math.max(webhookNextRequestAt - now, webhookGlobalBlockedUntil - now);

    if (wait > 0) await delay(wait);

    webhookNextRequestAt = Date.now() + MIN_INTERVAL_MS;
    const response = await request();

    if (response.status !== 429 || attempt >= MAX_RETRIES) return response;

    const bodyText = await response.clone().text().catch(() => '');
    const waitMs = retryAfterMs(response, bodyText);
    const until = Date.now() + waitMs;

    if (isGlobal(response)) {
      webhookGlobalBlockedUntil = Math.max(webhookGlobalBlockedUntil, until);
    }

    webhookNextRequestAt = Math.max(webhookNextRequestAt, until);

    console.warn(
      '[Discord Webhook Rate Limit] 429 erhalten; warte ' +
      waitMs + ' ms (Versuch ' + (attempt + 1) + '/' + MAX_RETRIES + ').'
    );
  }
}

/**
 * Für Wetter, Mond, Mod-Watcher, Heiler und andere Discord-Webhooks.
 * Diese Requests teilen sich bewusst nur untereinander die Queue.
 */
function discordFetch(url, options = {}) {
  const job = webhookQueue.then(() => runWebhook(() => fetch(url, options)));
  webhookQueue = job.catch(() => {});
  return job;
}

/**
 * Für Discord OAuth.
 *
 * OAuth nutzt eine eigene Queue. Ein 429 wird nicht automatisch wiederholt:
 * die aktuelle Anmeldung bekommt die Originalantwort und nachfolgende
 * Anfragen werden bis Retry-After abgewiesen, damit kein Anfragesturm folgt.
 */
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

