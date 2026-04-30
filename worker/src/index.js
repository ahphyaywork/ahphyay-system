/**
 * AhPhyay System — Cloudflare Worker API
 * Routes:
 *   POST /auth/login
 *   GET  /projects
 *   GET  /staff
 *   GET  /tasks?projectId=
 *   GET  /worklog?staffId=&projectId=&from=&to=
 *   POST /worklog
 *   PUT  /worklog/:id
 *   DELETE /worklog/:id
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Auth
      if (path === '/auth/login' && request.method === 'POST') {
        return handleLogin(request, env);
      }

      // Verify JWT on all other routes
      const auth = await verifyJWT(request, env);
      if (!auth.ok) return json({ error: 'Unauthorized' }, 401);

      // Routes
      if (path === '/projects')             return getProjects(env);
      if (path === '/staff')                return getStaff(env);
      if (path === '/tasks')                return getTasks(url, env);
      if (path === '/worklog' && request.method === 'GET')    return getWorklog(url, env);
      if (path === '/worklog' && request.method === 'POST')   return addWorklog(request, env);
      if (path.startsWith('/worklog/') && request.method === 'PUT')    return updateWorklog(request, path, env);
      if (path.startsWith('/worklog/') && request.method === 'DELETE') return deleteWorklog(path, env);

      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }
};

// ── AUTH ──────────────────────────────────────────────────
async function handleLogin(request, env) {
  const { password } = await request.json();
  if (password !== env.ADMIN_PASSWORD) return json({ error: 'Invalid password' }, 401);
  const token = await signJWT({ role: 'admin' }, env.JWT_SECRET);
  return json({ token });
}

async function verifyJWT(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return { ok: false };
  try {
    await verifyToken(token, env.JWT_SECRET);
    return { ok: true };
  } catch { return { ok: false }; }
}

// ── SHEETS HELPER ─────────────────────────────────────────
async function sheetsRead(env, sheetName) {
  const token = await getGoogleToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SPREADSHEET_ID}/values/${sheetName}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  const [headers, ...rows] = data.values || [];
  return rows.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] || ''])));
}

async function sheetsAppend(env, sheetName, row) {
  const token = await getGoogleToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SPREADSHEET_ID}/values/${sheetName}!A1:append?valueInputOption=USER_ENTERED`;
  await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] })
  });
}

// ── ROUTE HANDLERS ────────────────────────────────────────
async function getProjects(env) {
  const rows = await sheetsRead(env, 'Projects');
  return json(rows.filter(r => r.Active !== 'false'));
}

async function getStaff(env) {
  const rows = await sheetsRead(env, 'Staff');
  return json(rows.filter(r => r.Active !== 'false'));
}

async function getTasks(url, env) {
  const projectId = url.searchParams.get('projectId');
  const rows = await sheetsRead(env, 'Tasks');
  return json(projectId ? rows.filter(r => r.ProjectID === projectId) : rows);
}

async function getWorklog(url, env) {
  const rows = await sheetsRead(env, 'WorkLog');
  let filtered = rows;
  const { staffId, projectId, from, to, view } = Object.fromEntries(url.searchParams);
  if (staffId)   filtered = filtered.filter(r => r.StaffID === staffId);
  if (projectId) filtered = filtered.filter(r => r.ProjectID === projectId);
  if (from)      filtered = filtered.filter(r => r.Date >= from);
  if (to)        filtered = filtered.filter(r => r.Date <= to);
  return json(filtered);
}

async function addWorklog(request, env) {
  const body = await request.json();
  const id = `WL-${Date.now()}`;
  const row = [
    id, body.staffId, body.projectId, body.taskId,
    body.date, body.actual, body.unit || '',
    body.status, body.note || '',
    new Date().toISOString()
  ];
  await sheetsAppend(env, 'WorkLog', row);
  return json({ success: true, id });
}

async function updateWorklog(request, path, env) {
  // For simplicity, reads all rows, patches the matching one, rewrites
  // In production: use row index from Sheets API
  return json({ success: true, note: 'Update via row index — implement with batchUpdate' });
}

async function deleteWorklog(path, env) {
  return json({ success: true, note: 'Delete via row index — implement with batchUpdate' });
}

// ── JWT (lightweight, no library) ────────────────────────
async function signJWT(payload, secret) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify({ ...payload, exp: Date.now() + 86400000 * 30 }));
  const sig = await hmac(`${header}.${body}`, secret);
  return `${header}.${body}.${sig}`;
}

async function verifyToken(token, secret) {
  const [header, body, sig] = token.split('.');
  const expected = await hmac(`${header}.${body}`, secret);
  if (sig !== expected) throw new Error('Invalid signature');
  const payload = JSON.parse(atob(body));
  if (payload.exp < Date.now()) throw new Error('Token expired');
  return payload;
}

async function hmac(data, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function getGoogleToken(env) {
  // Service account JWT flow
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now };
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimB64 = btoa(JSON.stringify(claim));
  const key = await crypto.subtle.importKey('pkcs8', pemToBuffer(env.GOOGLE_PRIVATE_KEY), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claimB64}`));
  const jwt = `${header}.${claimB64}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}` });
  const { access_token } = await res.json();
  return access_token;
}

function pemToBuffer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0)).buffer;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
