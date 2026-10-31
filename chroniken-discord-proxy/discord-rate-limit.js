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
 * Kein Warten auf die Webhook-Queue und kein Warten auf einen globalen
 * Webhook-Rate-Limit. Bei 429 kommt die Discord-Antwort sofort zurück.
 */
async function discordOAuthFetch(url, options = {}) {
  return fetch(url, options);
}

module.exports = {
  discordFetch,
  discordOAuthFetch
};
