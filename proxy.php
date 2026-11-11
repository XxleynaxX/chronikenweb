<?php
/**
 * Proxy für die conan-exiles.com Vote-API.
 * Der API-Key bleibt hier auf dem Server und taucht nie im Browser auf.
 *
 * Aufruf:  proxy.php?element=voters&month=current
 *          proxy.php?element=votes
 */

const API_KEY   = 'wUh7JPwEUsO53w3qeBCIyC3tj688bVdbkuA';
const API_BASE  = 'https://conan-exiles.com/api/';
const CACHE_TTL = 180; // Sekunden (die API cached selbst 3 Minuten)

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function fail(string $msg, int $code = 502): void {
    http_response_code($code);
    echo json_encode(['error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

/* ---- Eingaben prüfen (nur erlaubte Werte durchlassen) ---- */
$element = $_GET['element'] ?? '';
if (!in_array($element, ['voters', 'votes', 'detail'], true)) fail('Ungültiges element', 400);

$month = $_GET['month'] ?? 'current';
if (!in_array($month, ['current', 'previous'], true)) $month = 'current';

$limit = max(1, min(1000, (int)($_GET['limit'] ?? 100)));

/* ---- Cache ---- */
$cacheFile = sys_get_temp_dir() . "/conan_votes_{$element}_{$month}_{$limit}.json";
if (is_file($cacheFile) && time() - filemtime($cacheFile) < CACHE_TTL) {
    readfile($cacheFile);
    exit;
}

/* ---- HTTP-Abruf ---- */
function fetchUrl(string $url): ?string {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_USERAGENT      => 'VoteListProxy/1.0',
        ]);
        $body = curl_exec($ch);
        $ok   = $body !== false && curl_getinfo($ch, CURLINFO_RESPONSE_CODE) < 400;
        curl_close($ch);
        return $ok ? $body : null;
    }
    $ctx  = stream_context_create(['http' => ['timeout' => 10, 'user_agent' => 'VoteListProxy/1.0']]);
    $body = @file_get_contents($url, false, $ctx);
    return $body === false ? null : $body;
}

function apiUrl(string $element, string $month, int $limit, string $format): string {
    $q = ['object' => 'servers', 'element' => $element, 'key' => API_KEY];
    if ($element !== 'detail') { $q['limit'] = $limit; $q['format'] = $format; }
    if ($element === 'voters') $q['month'] = $month;
    return API_BASE . '?' . http_build_query($q);
}

/* ---- HTML-Tabelle in Zeilen umwandeln (Fallback, falls JSON nicht klappt) ---- */
function parseHtmlTable(string $html): array {
    if (!class_exists('DOMDocument')) return [];
    $dom = new DOMDocument();
    @$dom->loadHTML('<?xml encoding="utf-8"?>' . $html);

    // Datentabelle = die mit den meisten Spalten (die Server-Info-Tabelle hat nur 2)
    $best = null; $bestCols = 0;
    foreach ($dom->getElementsByTagName('table') as $table) {
        $tr = $table->getElementsByTagName('tr')->item(0);
        if (!$tr) continue;
        $cols = $tr->getElementsByTagName('th')->length ?: $tr->getElementsByTagName('td')->length;
        if ($cols > $bestCols) { $best = $table; $bestCols = $cols; }
    }
    if (!$best || $bestCols < 3) return [];

    $rows = []; $headers = [];
    foreach ($best->getElementsByTagName('tr') as $i => $tr) {
        $cells = [];
        foreach ($tr->childNodes as $c) {
            if (in_array($c->nodeName, ['th', 'td'], true)) $cells[] = trim($c->textContent);
        }
        if ($i === 0) {
            $headers = array_map(fn($h) => strtolower(preg_replace('/[^a-z0-9]+/i', '_', trim($h))), $cells);
            continue;
        }
        if (count($cells) !== count($headers)) continue;
        $rows[] = array_combine($headers, $cells);
    }
    return $rows;
}

/* ---- Server-Details: JSON einfach durchreichen ---- */
if ($element === 'detail') {
    $raw = fetchUrl(apiUrl('detail', $month, $limit, 'json'));
    $decoded = $raw !== null ? json_decode($raw, true) : null;
    if (!is_array($decoded)) fail('API nicht erreichbar');
    $out = json_encode(['detail' => $decoded], JSON_UNESCAPED_UNICODE);
    @file_put_contents($cacheFile, $out);
    echo $out;
    exit;
}

/* ---- Daten holen: erst JSON, sonst HTML ---- */
$items = null;
$raw = fetchUrl(apiUrl($element, $month, $limit, 'json'));
if ($raw !== null) {
    $decoded = json_decode($raw, true);
    if (is_array($decoded)) $items = $decoded;
}
if ($items === null) {
    $html = fetchUrl(apiUrl($element, $month, $limit, 'html'));
    if ($html === null) fail('API nicht erreichbar');
    $items = parseHtmlTable($html);
}

$out = json_encode(['items' => $items, 'fetched' => time()], JSON_UNESCAPED_UNICODE);
@file_put_contents($cacheFile, $out);
echo $out;
