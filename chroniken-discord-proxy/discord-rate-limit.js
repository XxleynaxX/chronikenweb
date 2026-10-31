/**
 * Gemeinsamer Discord-HTTP-Schutz für den Chroniken-Proxy.
 *
 * Behandelt 429-Antworten zentral, wartet die von Discord gemeldete
 * Zeit und begrenzt Wiederholungen. So erzeugen Wetter, Webhooks und
 * OAuth nicht gegenseitig unnötige Rate-Limit-Spitzen.
 */

let queue = Promise.resolve();
let nextRequestAt = 0;
let globalBlockedUntil = 0;

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

async function run(request) {
  for (let attempt = 0; ; attempt++) {
    const now = Date.now();
    const wait = Math.max(nextRequestAt - now, globalBlockedUntil - now);
    if (wait > 0) await delay(wait);

    nextRequestAt = Date.now() + MIN_INTERVAL_MS;
    const response = await request();

    if (response.status !== 429 || attempt >= MAX_RETRIES) return response;

    const bodyText = await response.clone().text().catch(() => '');
    const waitMs = retryAfterMs(response, bodyText);
    const until = Date.now() + waitMs;

    if (isGlobal(response)) globalBlockedUntil = Math.max(globalBlockedUntil, until);
    nextRequestAt = Math.max(nextRequestAt, until);

    console.warn('[Discord Rate Limit] 429 erhalten; warte ' + waitMs + ' ms (Versuch ' + (attempt + 1) + '/' + MAX_RETRIES + ').');
  }
}

function discordFetch(url, options) {
  const job = queue.then(() => run(() => fetch(url, options)));
  queue = job.catch(() => {});
  return job;
}

module.exports = { discordFetch };
