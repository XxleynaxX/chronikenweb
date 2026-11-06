'use strict';

const db = require('./db');

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function clip(v, n) {
  return String(v == null ? '' : v).trim().slice(0, n);
}

async function readJson(req, max = 100000) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > max) throw Object.assign(new Error('Daten zu groß.'), { status: 413 });
  }
  try { return JSON.parse(body || '{}'); }
  catch { throw Object.assign(new Error('Ungültiges JSON.'), { status: 400 }); }
}

function taskEmbed(action, task, actor) {
  const kinds = {
    created: { title: '📋 Neue Admin-Aufgabe', color: 0xa855f7 },
    updated: { title: '✏️ Admin-Aufgabe geändert', color: 0x8b5cf6 },
    done: { title: '✅ Admin-Aufgabe abgeschlossen', color: 0x22c55e },
    blocked: { title: '⛔ Admin-Aufgabe blockiert', color: 0xef4444 }
  };
  const k = kinds[action] || kinds.updated;
  return {
    username: 'Chroniken Admin',
    embeds: [{
      title: k.title,
      color: k.color,
      fields: [
        { name: 'Aufgabe', value: clip(task.title, 256) || '—', inline: false },
        { name: 'Status', value: clip(task.status, 80) || '—', inline: true },
        { name: 'Priorität', value: clip(task.priority, 80) || '—', inline: true },
        { name: 'Projekt', value: clip(task.project_name, 256) || '—', inline: true },
        { name: 'Verantwortlich', value: clip(task.assigned_discord_id, 80) || 'Nicht zugewiesen', inline: true },
        { name: 'Fällig', value: clip(task.due_date, 80) || 'Keine Frist', inline: true }
      ],
      footer: { text: 'Die Chroniken · Admin-System · von ' + clip(actor, 80) },
      timestamp: new Date().toISOString()
    }]
  };
}

async function notify(webhook, action, task, actor) {
  if (!webhook) return;
  try {
    const r = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskEmbed(action, task, actor))
    });
    if (!r.ok) console.warn('[ADMIN] Discord Webhook HTTP', r.status);
  } catch (e) {
    console.warn('[ADMIN] Discord Webhook Fehler:', e.message);
  }
}

async function discordTeam() {
  const token = process.env.DISCORD_BOT_TOKEN || '';
  const guild = process.env.DISCORD_GUILD_ID || '1204906165004279889';
  if (!token) return [];
  try {
    const r = await fetch('https://discord.com/api/v10/guilds/' + guild + '/members?limit=1000', {
      headers: { Authorization: 'Bot ' + token }
    });
    if (!r.ok) return [];
    const members = await r.json();
    return Array.isArray(members) ? members.map(m => ({
      id: m.user?.id,
      name: m.nick || m.user?.global_name || m.user?.username || 'Discord',
      bot: !!m.user?.bot,
      roles: Array.isArray(m.roles) ? m.roles : []
    })) : [];
  } catch { return []; }
}

async function handle(req, res, url, session, webhook) {
  if (!session || !session.admin) return json(res, 403, { ok: false, error: 'Nur Admins erlaubt.' });
  try {
    const actor = session.name || 'Discord Admin';

    if (req.method === 'GET' && url.pathname === '/admin/summary') {
      return json(res, 200, { ok: true, summary: await db.adminSummary() });
    }

    if (req.method === 'GET' && url.pathname === '/admin/tasks') {
      const tasks = await db.adminTasks({
        status: url.searchParams.get('status') || '',
        assigned: url.searchParams.get('assigned') || ''
      });
      return json(res, 200, { ok: true, tasks });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/admin/tasks/')) {
      const id = Number(url.pathname.split('/').pop());
      const task = await db.adminTask(id);
      return task ? json(res, 200, { ok: true, task }) : json(res, 404, { ok: false, error: 'Aufgabe nicht gefunden.' });
    }

    if (req.method === 'POST' && url.pathname === '/admin/tasks') {
      const b = await readJson(req);
      if (!clip(b.title, 255)) return json(res, 400, { ok: false, error: 'Titel fehlt.' });
      const task = await db.adminCreateTask({
        title: clip(b.title, 255),
        description: clip(b.description, 10000),
        project_id: Number(b.project_id) || null,
        assigned_discord_id: clip(b.assigned_discord_id, 32) || null,
        status: ['open','working','waiting','blocked','done'].includes(b.status) ? b.status : 'open',
        priority: ['low','normal','high','critical'].includes(b.priority) ? b.priority : 'normal',
        due_date: clip(b.due_date, 30)
      }, actor);
      await notify(webhook, task.status === 'done' ? 'done' : task.status === 'blocked' ? 'blocked' : 'created', task, actor);
      return json(res, 201, { ok: true, task });
    }

    if (req.method === 'PUT' && url.pathname.startsWith('/admin/tasks/')) {
      const id = Number(url.pathname.split('/').pop());
      const b = await readJson(req);
      if (!clip(b.title, 255)) return json(res, 400, { ok: false, error: 'Titel fehlt.' });
      const before = await db.adminTask(id);
      if (!before) return json(res, 404, { ok: false, error: 'Aufgabe nicht gefunden.' });
      const task = await db.adminUpdateTask(id, {
        title: clip(b.title, 255),
        description: clip(b.description, 10000),
        project_id: Number(b.project_id) || null,
        assigned_discord_id: clip(b.assigned_discord_id, 32) || null,
        status: ['open','working','waiting','blocked','done'].includes(b.status) ? b.status : 'open',
        priority: ['low','normal','high','critical'].includes(b.priority) ? b.priority : 'normal',
        due_date: clip(b.due_date, 30)
      }, actor);
      let action = 'updated';
      if (task.status === 'done' && before.status !== 'done') action = 'done';
      if (task.status === 'blocked' && before.status !== 'blocked') action = 'blocked';
      if (task.status !== before.status || action !== 'updated') await notify(webhook, action, task, actor);
      return json(res, 200, { ok: true, task });
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/admin/tasks/')) {
      const id = Number(url.pathname.split('/').pop());
      const task = await db.adminTask(id);
      if (!task) return json(res, 404, { ok: false, error: 'Aufgabe nicht gefunden.' });
      await db.adminDeleteTask(id, actor);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname.match(/^\/admin\/tasks\/\d+\/comments$/)) {
      const id = Number(url.pathname.split('/')[3]);
      const b = await readJson(req);
      const comment = clip(b.comment, 5000);
      if (!comment) return json(res, 400, { ok: false, error: 'Kommentar fehlt.' });
      if (!await db.adminTask(id)) return json(res, 404, { ok: false, error: 'Aufgabe nicht gefunden.' });
      await db.adminAddComment(id, clip(session.discordId || session.id || actor, 32), comment);
      return json(res, 201, { ok: true, task: await db.adminTask(id) });
    }

    if (req.method === 'GET' && url.pathname === '/admin/projects') {
      return json(res, 200, { ok: true, projects: await db.adminProjects() });
    }

    if (req.method === 'POST' && url.pathname === '/admin/projects') {
      const b = await readJson(req);
      if (!clip(b.name, 255)) return json(res, 400, { ok: false, error: 'Projektname fehlt.' });
      const id = await db.adminCreateProject({ name: clip(b.name,255), description: clip(b.description,5000), status: ['active','paused','completed'].includes(b.status) ? b.status : 'active' }, actor);
      return json(res, 201, { ok: true, id });
    }

    if (req.method === 'PUT' && url.pathname.startsWith('/admin/projects/')) {
      const id = Number(url.pathname.split('/').pop());
      const b = await readJson(req);
      await db.adminUpdateProject(id, { name: clip(b.name,255), description: clip(b.description,5000), status: ['active','paused','completed'].includes(b.status) ? b.status : 'active' }, actor);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/admin/projects/')) {
      const id = Number(url.pathname.split('/').pop());
      await db.adminDeleteProject(id, actor);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/admin/blacklist') {
      return json(res, 200, { ok: true, blacklist: await db.adminBlacklist() });
    }

    if (req.method === 'POST' && url.pathname === '/admin/blacklist') {
      const b = await readJson(req);
      const entry = await db.adminAddBlacklist({
        steam_id: clip(b.steam_id, 32),
        player_name: clip(b.player_name, 255),
        reason: clip(b.reason, 5000)
      }, actor);
      return json(res, 201, { ok: true, entry });
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/admin/blacklist/')) {
      const id = Number(url.pathname.split('/').pop());
      if (!Number.isInteger(id) || id < 1) return json(res, 400, { ok: false, error: 'Ungültige Blacklist-ID.' });
      const removed = await db.adminRemoveBlacklist(id, actor);
      return removed ? json(res, 200, { ok: true }) : json(res, 404, { ok: false, error: 'Blacklist-Eintrag nicht gefunden.' });
    }

    if (req.method === 'GET' && url.pathname === '/admin/changelog') {
      return json(res, 200, { ok: true, changelog: await db.adminChangelog(url.searchParams.get('limit')) });
    }

    if (req.method === 'GET' && url.pathname === '/admin/activity') {
      return json(res, 200, { ok: true, activities: await db.adminActivities(url.searchParams.get('limit')) });
    }

    if (req.method === 'GET' && url.pathname === '/admin/team') {
      return json(res, 200, { ok: true, members: await discordTeam(), current: { name: session.name || '', id: session.discordId || session.id || '' } });
    }

    return false;
  } catch (e) {
    console.error('[ADMIN]', e);
    return json(res, e.status || 500, { ok: false, error: e.status ? e.message : 'Admin-API-Fehler: ' + e.message });
  }
}

module.exports = { handle };