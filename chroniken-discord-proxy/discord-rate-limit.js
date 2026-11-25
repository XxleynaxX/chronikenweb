'use strict';

/**
 * Zentraler Discord-HTTP-Schutz für den Chroniken-Proxy.
 *
 * Jede Webhook-URL besitzt eine eigene FIFO-Warteschlange.
 * Dadurch blockiert ein überlasteter Charakter-Webhook nicht Wetter,
 * Mond, Heiler oder Mod-Watcher.
 *
 * Bei HTTP 429 wird Discords retry_after respektiert. Auch sehr lange
 * Cooldowns werden nicht verworfen: die aktuelle Anfrage wartet in ihrer
 * Queue und wird danach erneut gesendet.
 */

const webhookStates = new Map();
let webhookGlobalBlockedUntil = 0;

let oauthBlockedUntil = 0;
let oauthNextRequestAt = 0;
let oauthQueue = Promise.resolve();
let oauthRequestInFlight = false;

// OAuth ist absichtlich deutlich langsamer als Webhooks. Discords OAuth-
// Endpunkte reagieren bei zu vielen Anfragen mit einem globalen 429.
const OAUTH_MIN_INTERVAL_MS = Math.max(
  500,
  Number(process.env.DISCORD_OAUTH_MIN_REQUEST_INTERVAL_MS) || 1500
);

const MIN_INTERVAL_MS = Math.max(
  100,
  Number(process.env.DISCORD_MIN_REQUEST_INTERVAL_MS) || 2100
);

const MAX_RETRIES = Math.max(
  0,
  Math.min(5, Number(process.env.DISCORD_MAX_RATE_LIMIT_RETRIES) || 3)
);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function webhookKey(url) {
  // Die URL wird nie geloggt. Sie dient nur intern als Map-Key.
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
  if (Number.isFinite(header) && header >= 0) {
    return Math.ceil(header * 1000);
  }

  const resetAfter = Number(response.headers.get('x-ratelimit-reset-after'));
  if (Number.isFinite(resetAfter) && resetAfter >= 0) {
    return Math.ceil(resetAfter * 1000);
  }

  try {
    const json = JSON.parse(bodyText || '{}');
    const retry = Number(json.retry_after);

    if (Number.isFinite(retry) && retry >= 0) {
      return Math.ceil(retry * 1000);
    }
  } catch {}

  return 1000;
}

function isGlobal(response) {
  return String(response.headers.get('x-ratelimit-scope') || '').toLowerCase() === 'global' ||
    String(response.headers.get('x-ratelimit-global') || '').toLowerCase() === 'true';
}

function rateLimitMetadata(response) {
  const headers = response.headers;

  return {
    status: response.status,
    retryAfter: headers.get('retry-after'),
    rateLimitScope: headers.get('x-ratelimit-scope'),
    rateLimitResetAfter: headers.get('x-ratelimit-reset-after'),
    rateLimitReset: headers.get('x-ratelimit-reset'),
    rateLimitBucket: headers.get('x-ratelimit-bucket'),
    rateLimitLimit: headers.get('x-ratelimit-limit'),
    rateLimitRemaining: headers.get('x-ratelimit-remaining'),
    rateLimitGlobal: headers.get('x-ratelimit-global')
  };
}

function makeRateLimitedResponse(waitMs, global = false) {
  return new Response(JSON.stringify({
    ok: false,
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

/**
 * Sendet eine einzelne Anfrage.
 *
 * Wichtig: Bei einem langen 429 wird NICHT aufgegeben.
 * Die Queue wartet genau so lange, wie Discord es über retry_after vorgibt,
 * und versucht danach erneut. Dadurch gehen Charakter-, Heiler- oder
 * Admin-Meldungen nicht einfach verloren.
 */
async function runWebhook(url, request, state) {
  for (let attempt = 0; ; attempt++) {
    const now = Date.now();
    const blockedUntil = Math.max(
      state.blockedUntil,
      webhookGlobalBlockedUntil
    );

    if (blockedUntil > now) {
      const remaining = blockedUntil - now;

      console.warn(
        '[Discord Webhook Queue] Cooldown aktiv:',
        JSON.stringify({
          retryAfterMs: remaining,
          retryAfterSeconds: Number((remaining / 1000).toFixed(1)),
          global: webhookGlobalBlockedUntil > now
        })
      );

      await delay(remaining);
    }

    const wait = Math.max(0, state.nextRequestAt - Date.now());

    if (wait > 0) {
      await delay(wait);
    }

    state.nextRequestAt = Date.now() + MIN_INTERVAL_MS;

    const response = await request();

    if (response.status !== 429) {
      return response;
    }

    const bodyText = await response.clone().text().catch(() => '');
    const waitMs = retryAfterMs(response, bodyText);
    const global = isGlobal(response);
    const until = Date.now() + waitMs;

    if (global) {
      webhookGlobalBlockedUntil = Math.max(
        webhookGlobalBlockedUntil,
        until
      );
    } else {
      state.blockedUntil = Math.max(
        state.blockedUntil,
        until
      );
    }

    console.warn(
      '[Discord Webhook Rate Limit]',
      JSON.stringify({
        ...rateLimitMetadata(response),
        retryAfterMs: waitMs,
        retryAfterSeconds: Number((waitMs / 1000).toFixed(1)),
        global,
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES
      })
    );

    if (attempt >= MAX_RETRIES) {
      return response;
    }

    // Discord gibt hier die maßgebliche Wartezeit vor.
    // Auch 30+ Minuten werden korrekt abgewartet.
    await delay(waitMs);
  }
}

function discordFetch(url, options = {}) {
  const state = getWebhookState(url);

  const job = state.queue.then(() =>
    runWebhook(
      url,
      () => fetch(url, options),
      state
    )
  );

  // Ein fehlgeschlagener Job darf die komplette Queue nicht stoppen.
  state.queue = job.catch(() => {});

  return job;
}

function oauthRetryAfterMs(response, bodyText) {
  const header = Number(response.headers.get('retry-after'));
  if (Number.isFinite(header) && header >= 0) {
    return Math.ceil(header * 1000);
  }

  const resetAfter = Number(response.headers.get('x-ratelimit-reset-after'));
  if (Number.isFinite(resetAfter) && resetAfter >= 0) {
    return Math.ceil(resetAfter * 1000);
  }

  try {
    const json = JSON.parse(bodyText || '{}');
    const retry = Number(json.retry_after);

    if (Number.isFinite(retry) && retry >= 0) {
      return Math.ceil(retry * 1000);
    }
  } catch {}

  return 1000;
}

function discordOAuthFetch(url, options = {}) {
  const job = oauthQueue.then(async () => {
    const now = Date.now();

    // Kein neuer Discord-OAuth-Request während eines bekannten Cooldowns.
    // Dadurch wird insbesondere verhindert, dass mehrere Callback-Aufrufe
    // nach einem globalen 429 Discord weiter bombardieren.
    if (now < oauthBlockedUntil) {
      const error = new Error(
        'Discord OAuth ist wegen eines Rate-Limits vorübergehend pausiert.'
      );
      error.code = 'DISCORD_RATE_LIMITED';
      error.retryAfterMs = oauthBlockedUntil - now;
      throw error;
    }

    if (now < oauthBlockedUntil) {
      const error = new Error(
        'Discord OAuth ist wegen eines Rate-Limits vorübergehend pausiert.'
      );

      error.code = 'DISCORD_RATE_LIMITED';
      error.retryAfterMs = oauthBlockedUntil - now;
      throw error;
    }

    const wait = Math.max(0, oauthNextRequestAt - now);

    if (wait) {
      await delay(wait);
    }

    oauthNextRequestAt = Date.now() + OAUTH_MIN_INTERVAL_MS;
    oauthRequestInFlight = true;

    let response;
    try {
      response = await fetch(url, options);
    } finally {
      oauthRequestInFlight = false;
    }

    if (response.status === 429) {
      const bodyText = await response.clone().text().catch(() => '');
      const retryAfter = oauthRetryAfterMs(response, bodyText);

      oauthBlockedUntil = Math.max(
        oauthBlockedUntil,
        Date.now() + retryAfter
      );

      console.warn(
        '[Discord OAuth]',
        JSON.stringify({
          event: 'rate_limited',
          status: 429,
          retryAfterMs: retryAfter,
          retryAfterSeconds: Number((retryAfter / 1000).toFixed(3)),
          resumeAt: new Date(oauthBlockedUntil).toISOString(),
          rateLimitScope: response.headers.get('x-ratelimit-scope'),
          rateLimitResetAfter: response.headers.get('x-ratelimit-reset-after')
        })
      );
    }

    return response;
  });

  oauthQueue = job.catch(() => {});

  return job;
}

function discordOAuthCooldownStatus() {
  const remaining = Math.max(0, oauthBlockedUntil - Date.now());

  return {
    blocked: remaining > 0,
    retryAfterMs: remaining,
    resumeAt: remaining > 0
      ? new Date(Date.now() + remaining).toISOString()
      : null,
    requestInFlight: oauthRequestInFlight,
    nextRequestAt: oauthNextRequestAt
  };
}

module.exports = {
  discordFetch,
  discordOAuthFetch,
  discordOAuthCooldownStatus
};
