// Rules and Journeys reports, mounted inside your own app (like Sidekiq's web UI): keep every scored run in your Postgres
// and serve the scoreboards with their history. No database driver or web framework of its own; the host app brings three things:
//   - a database: anything with query(text, params) → Promise<{ rows }>, such as a node-postgres Pool;
//   - authentication: mount createReports() behind your own admin check, it has none of its own;
//   - the schema: run schemaSql() once (or copy it into a migration).
//
//   import { createReports, recordRun, schemaSql } from 'rules-and-journeys/server';
//   app.use('/admin/tests', requireAdmin, createReports({ db: pool }));
//   await recordRun(pool, JSON.parse(readFileSync('reports/tests/score.json', 'utf8')), { branch: 'main' });
import { createHash, timingSafeEqual } from 'node:crypto';
import { renderHtml } from '../scorer/report-html.mjs';

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const SLUG = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const schemaName = schema => { if (!IDENT.test(schema)) throw new Error(`Invalid schema name: ${schema}`); return schema; };
/** Runs kept per project and branch; older ones are deleted when a new one is recorded. */
const KEEP = 500;
/** Points on a trend line. */
const TREND = 200;

/** The tables, in their own schema (default `rj`). Idempotent. */
export function schemaSql(schema = 'rj') {
  const s = schemaName(schema);
  return `CREATE SCHEMA IF NOT EXISTS ${s};
CREATE TABLE IF NOT EXISTS ${s}.project (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ${s}.run (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES ${s}.project(id) ON DELETE CASCADE,
  branch text NOT NULL CHECK (length(branch) BETWEEN 1 AND 200),
  commit text CHECK (commit IS NULL OR length(commit) <= 64),
  scored_at timestamptz NOT NULL,
  score smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS run_project_branch_scored ON ${s}.run (project_id, branch, scored_at DESC);
`;
}

/** Save one scored run (the scorer's score.json). The project defaults to the scored repo's name. */
export async function recordRun(db, result, { project = result?.name, branch = 'main', schema = 'rj', keep = KEEP } = {}) {
  const s = schemaName(schema);
  if (!result || typeof result !== 'object' || !Number.isInteger(result.score) || result.score < 0 || result.score > 100 || typeof result.dimensions !== 'object')
    throw new Error('recordRun needs a scorer result (score.json).');
  const slug = String(project ?? '').toLowerCase();
  if (!SLUG.test(slug)) throw new Error(`Invalid project name: ${project}`);
  if (typeof branch !== 'string' || !branch || branch.length > 200) throw new Error('Invalid branch.');
  const projectId = (await db.query(`INSERT INTO ${s}.project (slug) VALUES ($1) ON CONFLICT (slug) DO UPDATE SET slug = excluded.slug RETURNING id`, [slug])).rows[0].id;
  const run = (await db.query(`INSERT INTO ${s}.run (project_id, branch, commit, scored_at, score, result) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [projectId, branch, result.commit ? String(result.commit).slice(0, 64) : null, result.scoredAt ?? new Date().toISOString(), result.score, JSON.stringify(result)])).rows[0];
  await db.query(`DELETE FROM ${s}.run WHERE project_id = $1 AND branch = $2 AND id NOT IN (SELECT id FROM ${s}.run WHERE project_id = $1 AND branch = $2 ORDER BY scored_at DESC, id DESC LIMIT $3)`,
    [projectId, branch, keep]);
  return { project: slug, branch, id: String(run.id) };
}

// ---------- serving ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const blockHashes = (html, tag) => [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))]
  .map(m => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`).join(' ') || "'none'";
/** A strict policy that allows exactly this page's own <style> and <script> blocks. */
const policy = html => `default-src 'none'; style-src ${blockHashes(html, 'style')}; script-src ${blockHashes(html, 'script')}; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
function send(res, status, html) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', policy(html));
  res.end(html);
}
function redirect(res, location) { res.statusCode = 302; res.setHeader('Location', location); res.end(); }

/** A plain page (project list, not found) in the scoreboard's look. */
function plainPage(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;background:#f9f9f7;color:#0b0b0b;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:720px;margin:0 auto;padding:40px 24px}
p.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6f6d68;margin:0 0 6px}h1{font-size:26px;margin:0 0 20px}
ul{list-style:none;padding:0;margin:0;display:grid;gap:10px}li a{display:flex;justify-content:space-between;padding:14px 18px;border-radius:12px;background:#fcfcfb;box-shadow:0 0 0 1px rgba(11,11,11,.1);color:inherit;text-decoration:none}
li a:hover{box-shadow:0 0 0 1px #2a78d6}b{font-size:20px}span{color:#52514e;font-size:13px}
@media (prefers-color-scheme:dark){body{background:#0d0d0d;color:#f0efec}li a{background:#1a1a19;box-shadow:0 0 0 1px rgba(255,255,255,.1)}span{color:#c3c2b7}}</style>
</head><body><main><p class="eyebrow">Rules and Journeys</p>${body}</main></body></html>`;
}

/**
 * A request handler for Node's http, Express or Connect: (req, res, next?). Mount it at any path, behind your own
 * authentication. Pages: the project list, a project's latest run on a branch (?branch=, default `defaultBranch`), and any
 * past run (/<project>/runs/<id>), each with the trend of its branch.
 */
export function createReports({ db, schema = 'rj', defaultBranch = 'main', basePath } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('createReports needs db: an object with query(text, params).');
  const s = schemaName(schema);
  return async function reports(req, res, next) {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.setHeader('Allow', 'GET, HEAD'); res.end(); return; }
      const base = (basePath ?? req.baseUrl ?? '').replace(/\/$/, '');
      const url = new URL(req.url ?? '/', 'http://local');
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const projects = (await db.query(`SELECT p.slug, r.score, r.scored_at FROM ${s}.project p
        LEFT JOIN LATERAL (SELECT score, scored_at FROM ${s}.run WHERE project_id = p.id ORDER BY scored_at DESC, id DESC LIMIT 1) r ON true ORDER BY p.slug`)).rows;
      const projectHref = slug => `${base}/${encodeURIComponent(slug)}`;

      if (!parts.length) {
        if (projects.length === 1) return redirect(res, projectHref(projects[0].slug));
        return send(res, 200, plainPage('Test scoreboards', `<h1>Test scoreboards</h1>${projects.length ? `<ul>${projects.map(p =>
          `<li><a href="${esc(projectHref(p.slug))}"><strong>${esc(p.slug)}</strong><span>${p.score === null ? 'no runs yet' : `<b>${p.score}</b> / 100`}</span></a></li>`).join('')}</ul>`
          : '<p>No runs recorded yet. Record one with recordRun() from rules-and-journeys/server.</p>'}`));
      }

      const slug = parts[0];
      const project = (await db.query(`SELECT id, slug FROM ${s}.project WHERE slug = $1`, [slug])).rows[0];
      const byId = parts[1] === 'runs' && /^\d{1,18}$/.test(parts[2] ?? '') && parts.length === 3;
      if (!project || !(parts.length === 1 || byId)) return send(res, 404, plainPage('Not found', '<h1>Not found</h1><p>No such project or run.</p>'));

      const branches = (await db.query(`SELECT branch, max(scored_at) AS last FROM ${s}.run WHERE project_id = $1 GROUP BY branch ORDER BY (branch = $2) DESC, max(scored_at) DESC LIMIT 20`,
        [project.id, defaultBranch])).rows.map(r => r.branch);
      let run;
      if (byId) run = (await db.query(`SELECT id, branch, commit, scored_at, score, result FROM ${s}.run WHERE project_id = $1 AND id = $2`, [project.id, parts[2]])).rows[0];
      else {
        const wanted = url.searchParams.get('branch') ?? (branches.includes(defaultBranch) ? defaultBranch : branches[0]);
        run = (await db.query(`SELECT id, branch, commit, scored_at, score, result FROM ${s}.run WHERE project_id = $1 AND branch = $2 ORDER BY scored_at DESC, id DESC LIMIT 1`,
          [project.id, wanted])).rows[0];
      }
      if (!run) return send(res, 404, plainPage('No runs', `<h1>${esc(project.slug)}</h1><p>No runs recorded on this branch yet.</p>`));

      // The trend: this branch's runs up to this one, oldest first.
      const history = (await db.query(`SELECT commit, scored_at, score, dimensions, layers FROM (SELECT commit, scored_at, score, id,
          (SELECT jsonb_object_agg(k, v->'score') FROM jsonb_each(result->'dimensions') AS d(k, v)) AS dimensions,
          (SELECT jsonb_object_agg(k, jsonb_build_object('ms', v->'ms')) FROM jsonb_each(result->'layers') AS l(k, v) WHERE v ? 'ms') AS layers
        FROM ${s}.run WHERE project_id = $1 AND branch = $2 AND (scored_at, id) <= ($3, $4) ORDER BY scored_at DESC, id DESC LIMIT ${TREND}) t ORDER BY scored_at, id`,
        [project.id, run.branch, run.scored_at, run.id])).rows.map(r => ({ commit: r.commit, scoredAt: new Date(r.scored_at).toISOString(), score: r.score,
          dimensions: r.dimensions ?? {}, layers: r.layers ?? {} }));
      const recent = (await db.query(`SELECT id, branch, commit, scored_at, score FROM ${s}.run WHERE project_id = $1 AND branch = $2 ORDER BY scored_at DESC, id DESC LIMIT 15`,
        [project.id, run.branch])).rows;
      const result = typeof run.result === 'string' ? JSON.parse(run.result) : run.result;
      const html = renderHtml({ ...result, name: project.slug }, history, {
        back: projects.length > 1 ? { label: 'All projects', href: base || '/' } : undefined,
        branches: branches.length > 1 ? branches.map(b => ({ name: b, href: `${projectHref(project.slug)}?branch=${encodeURIComponent(b)}`, current: b === run.branch })) : [],
        runs: recent.map(r => ({ href: `${projectHref(project.slug)}/runs/${r.id}`, score: r.score, commit: r.commit, branch: r.branch, scoredAt: r.scored_at, current: String(r.id) === String(run.id) })),
      });
      return send(res, 200, html);
    } catch (error) {
      if (next) next(error); else { console.error('rules-and-journeys reports:', error); res.statusCode = 500; res.end('Internal error'); }
    }
  };
}

/**
 * Optional: an upload endpoint for hosts that would rather receive runs over HTTP than write them from CI. POST JSON
 * { project?, branch?, result } with Authorization: Bearer <token>. Mount it outside your session auth; the token is the auth.
 */
export function createIngest({ db, token, schema = 'rj', maxBytes = 2_000_000 } = {}) {
  if (!token || String(token).length < 24) throw new Error('createIngest needs a token of at least 24 characters.');
  const expected = createHash('sha256').update(String(token)).digest();
  return async function ingest(req, res) {
    const json = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
    if (req.method !== 'POST') return json(405, { error: 'POST a run.' });
    const given = createHash('sha256').update(String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')).digest();
    if (!timingSafeEqual(given, expected)) return json(401, { error: 'Invalid token.' });
    try {
      let body = req.body;
      if (body === undefined) {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > maxBytes) return json(413, { error: 'Too large.' }); chunks.push(chunk); }
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      }
      return json(201, await recordRun(db, body.result, { project: body.project ?? body.result?.name, branch: body.branch ?? 'main', schema }));
    } catch (error) { return json(400, { error: error instanceof Error ? error.message : 'Invalid run.' }); }
  };
}
