/**
 * AhPhyay System — Cloudflare Worker API
 * Paste this entire file into the Cloudflare Worker editor manually.
 *
 * Environment secrets to set in Cloudflare Worker settings:
 *   SPREADSHEET_ID        — your Google Sheet ID
 *   GOOGLE_SA_EMAIL       — service account email
 *   GOOGLE_PRIVATE_KEY    — service account private key (full PEM)
 *   JWT_SECRET            — any long random string
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

const ROLES = { ADMIN: 'admin', MANAGEMENT: 'management', STAFF: 'staff', EXTERNAL: 'external' };

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    // Strip /api prefix so the worker responds to both:
    //   api.ahphyay.work/auth/login        (old route, kept as fallback)
    //   ahphyay.work/api/auth/login        (new same-origin route)
    const path = url.pathname.replace(/^\/api/, '') || '/';

    try {
      // ── Public routes ──────────────────────────────────
      if (path === '/auth/login' && request.method === 'POST')
        return await handleLogin(request, env);

      // ── Photo upload — verify token manually (FormData can't use api helper) ──
      if (path === '/profile/photo' && request.method === 'POST') {
        const auth2 = await verifyJWT(request, env);
        if (!auth2) return json({ error: 'Unauthorized' }, 401);
        return await uploadProfilePhoto(request, env, auth2.staffId);
      }

      // ── Evidence upload — verify token manually ──
      const evidenceMatch = path.match(/^\/tasks\/([\w-]+)\/evidence$/);
      if (evidenceMatch && request.method === 'POST') {
        const auth3 = await verifyJWT(request, env);
        if (!auth3) return json({ error: 'Unauthorized' }, 401);
        return await uploadEvidence(request, env, auth3.staffId, evidenceMatch[1]);
      }

      // ── Protected routes ───────────────────────────────
      const auth = await verifyJWT(request, env);
      if (!auth) return json({ error: 'Unauthorized' }, 401);

      const { role, staffId } = auth;

      // Auth
      if (path === '/auth/me')                                    return json(auth);
      if (path === '/auth/change-password' && request.method === 'POST')
        return await changePassword(request, env, staffId);

      // Staff management — admin only
      if (path === '/staff' && request.method === 'GET')          return await getStaff(env, role, staffId);
      if (path === '/staff' && request.method === 'POST')         return await addStaff(request, env, role);
      if (path.match(/^\/staff\/[\w-]+$/) && request.method === 'PUT')
        return await updateStaff(request, env, role, path.split('/')[2]);
      if (path.match(/^\/staff\/[\w-]+\/reset-password$/) && request.method === 'POST')
        return await resetPassword(request, env, role, path.split('/')[2]);

      // Projects
      if (path === '/projects' && request.method === 'GET')       return await getProjects(env, role, staffId);
      if (path === '/projects' && request.method === 'POST')      return await addProject(request, env, role);
      if (path.match(/^\/projects\/[\w-]+$/) && request.method === 'PUT')
        return await updateProject(request, env, role, path.split('/')[2]);

      // Tasks
      if (path === '/tasks' && request.method === 'GET')          return await getTasks(url, env, role, staffId);
      if (path === '/tasks' && request.method === 'POST')         return await addTask(request, env, role, staffId);
      if (path.match(/^\/tasks\/[\w-]+$/) && request.method === 'PUT')
        return await updateTask(request, env, role, path.split('/')[2], staffId);

      // Task evidence file upload
      if (path.match(/^\/tasks\/[\w-]+\/evidence$/) && request.method === 'POST') {
        const taskId = path.split('/')[2];
        return await uploadEvidence(request, env, staffId, taskId);
      }

      // Work log
      if (path === '/worklog' && request.method === 'GET')        return await getWorklog(url, env, role, staffId);
      if (path === '/worklog' && request.method === 'POST')       return await addWorklog(request, env, role, staffId);
      if (path.match(/^\/worklog\/[\w-]+$/) && request.method === 'PUT')
        return await updateWorklog(request, env, role, path.split('/')[2]);
      if (path.match(/^\/worklog\/[\w-]+$/) && request.method === 'DELETE')
        return await deleteWorklog(env, role, path.split('/')[2]);

      // KPI summary
      if (path === '/kpi' && request.method === 'GET')            return await getKPI(url, env, role, staffId);

      // Dashboard summary
      if (path === '/dashboard' && request.method === 'GET')      return await getDashboard(env, role, staffId);

      return json({ error: 'Not found' }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: e.message }, 500);
    }
  }
};

// ══════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════
async function handleLogin(request, env) {
  const { username, password } = await request.json();
  if (!username || !password) return json({ error: 'Missing credentials' }, 400);

  const staff = await sheetsRead(env, 'Staff');
  const user = staff.find(r => r.Username?.toLowerCase() === username.toLowerCase() && r.Active?.toLowerCase() === 'true');
  if (!user) return json({ error: 'Invalid username or password' }, 401);

  const valid = await verifyPassword(password, user.Password);
  if (!valid) return json({ error: 'Invalid username or password' }, 401);

  const token = await signJWT({
    staffId: user.ID,
    name: user.Name,
    role: user.Role.toLowerCase(),
    email: user.Email,
    projects: user.Projects,
  }, env.JWT_SECRET);

  return json({
    token,
    user: {
      staffId: user.ID,
      name: user.Name,
      role: user.Role.toLowerCase(),
      email: user.Email,
      projects: user.Projects,
    }
  });
}

async function changePassword(request, env, staffId) {
  const { oldPassword, newPassword } = await request.json();
  if (!oldPassword || !newPassword) return json({ error: 'Missing fields' }, 400);
  if (newPassword.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

  const staff = await sheetsRead(env, 'Staff');
  const rowIdx = staff.findIndex(r => r.ID === staffId);
  if (rowIdx === -1) return json({ error: 'Staff not found' }, 404);

  const valid = await verifyPassword(oldPassword, staff[rowIdx].Password);
  if (!valid) return json({ error: 'Current password is incorrect' }, 401);

  const hashed = await hashPassword(newPassword);
  await sheetsUpdate(env, 'Staff', rowIdx + 2, getColIndex('Staff', 'Password'), hashed);
  return json({ success: true });
}

async function resetPassword(request, env, role, targetId) {
  if (role !== ROLES.ADMIN) return json({ error: 'Admin only' }, 403);
  const { newPassword } = await request.json();
  if (!newPassword || newPassword.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

  const staff = await sheetsRead(env, 'Staff');
  const rowIdx = staff.findIndex(r => r.ID === targetId);
  if (rowIdx === -1) return json({ error: 'Staff not found' }, 404);

  const hashed = await hashPassword(newPassword);
  await sheetsUpdate(env, 'Staff', rowIdx + 2, getColIndex('Staff', 'Password'), hashed);
  return json({ success: true });
}

// ══════════════════════════════════════════════════════════
// STAFF
// ══════════════════════════════════════════════════════════
async function getStaff(env, role, staffId) {
  const staff = await sheetsRead(env, 'Staff');
  if (role === ROLES.STAFF || role === ROLES.EXTERNAL) {
    const me = staff.find(r => r.ID === staffId);
    return json(me ? [sanitizeStaff(me)] : []);
  }
  return json(staff.filter(r => r.Active?.toLowerCase() === 'true').map(sanitizeStaff));
}

async function addStaff(request, env, role) {
  if (role !== ROLES.ADMIN) return json({ error: 'Admin only' }, 403);
  const body = await request.json();
  const { name, username, password, staffRole, type, email, projects } = body;
  if (!name || !username || !password) return json({ error: 'Missing required fields' }, 400);

  const staff = await sheetsRead(env, 'Staff');
  if (staff.find(r => r.Username?.toLowerCase() === username.toLowerCase()))
    return json({ error: 'Username already exists' }, 409);

  const id = `STAFF-${String(staff.length + 1).padStart(3, '0')}`;
  const hashed = await hashPassword(password);
  const row = [id, name, username, hashed, staffRole || 'Staff', type || 'Staff', email || '', projects || '', 'true', new Date().toISOString()];
  await sheetsAppend(env, 'Staff', row);
  return json({ success: true, id });
}

async function updateStaff(request, env, role, targetId) {
  if (role !== ROLES.ADMIN) return json({ error: 'Admin only' }, 403);
  const body = await request.json();
  const staff = await sheetsRead(env, 'Staff');
  const rowIdx = staff.findIndex(r => r.ID === targetId);
  if (rowIdx === -1) return json({ error: 'Not found' }, 404);

  const existing = staff[rowIdx];
  const updated = [
    existing.ID,
    body.name || existing.Name,
    body.username || existing.Username,
    existing.Password,
    body.role || existing.Role,
    body.type || existing.Type,
    body.email || existing.Email,
    body.projects || existing.Projects,
    body.active !== undefined ? String(body.active) : existing.Active,
    existing.CreatedAt,
  ];
  await sheetsUpdateRow(env, 'Staff', rowIdx + 2, updated);
  return json({ success: true });
}

function sanitizeStaff(s) {
  const { Password, ...safe } = s;
  return safe;
}

// ══════════════════════════════════════════════════════════
// PROJECTS
// ══════════════════════════════════════════════════════════
async function getProjects(env, role, staffId) {
  const projects = await sheetsRead(env, 'Projects');
  if (role === ROLES.STAFF || role === ROLES.EXTERNAL) {
    const staff = await sheetsRead(env, 'Staff');
    const me = staff.find(r => r.ID === staffId);
    const myProjects = (me?.Projects || '').split(',').map(p => p.trim());
    if (myProjects.includes('ALL')) return json(projects.filter(p => p.Status?.toLowerCase() === 'active'));
    return json(projects.filter(p => myProjects.includes(p.ID)));
  }
  return json(projects);
}

async function addProject(request, env, role) {
  if (role !== ROLES.ADMIN && role !== ROLES.MANAGEMENT) return json({ error: 'Insufficient permissions' }, 403);
  const body = await request.json();
  const projects = await sheetsRead(env, 'Projects');
  const id = `PROJ-${String(projects.length + 1).padStart(3, '0')}`;
  const row = [id, body.name, body.shortName || body.name, body.startDate, body.endDate, body.status || 'Active', body.description || '', new Date().toISOString()];
  await sheetsAppend(env, 'Projects', row);
  return json({ success: true, id });
}

async function updateProject(request, env, role, projectId) {
  if (role !== ROLES.ADMIN && role !== ROLES.MANAGEMENT) return json({ error: 'Insufficient permissions' }, 403);
  const body = await request.json();
  const projects = await sheetsRead(env, 'Projects');
  const rowIdx = projects.findIndex(p => p.ID === projectId);
  if (rowIdx === -1) return json({ error: 'Not found' }, 404);
  const e = projects[rowIdx];
  const updated = [e.ID, body.name||e.Name, body.shortName||e.ShortName, body.startDate||e.StartDate, body.endDate||e.EndDate, body.status||e.Status, body.description||e.Description, e.CreatedAt];
  await sheetsUpdateRow(env, 'Projects', rowIdx + 2, updated);
  return json({ success: true });
}

// ══════════════════════════════════════════════════════════
// TASKS
// ══════════════════════════════════════════════════════════
async function getTasks(url, env, role, staffId) {
  const tasks = await sheetsRead(env, 'Tasks');
  const projectId = url.searchParams.get('projectId');
  let filtered = tasks.filter(t => t.Active?.toLowerCase() === 'true');
  if (projectId) filtered = filtered.filter(t => t.ProjectID === projectId);
  if (role === ROLES.STAFF || role === ROLES.EXTERNAL)
    filtered = filtered.filter(t => t.AssigneeID === staffId);
  return json(filtered);
}

async function addTask(request, env, role, staffId) {
  const body = await request.json();
  if (!body.name || !body.projectId) return json({ error: 'Name and project are required' }, 400);

  const assigneeId = (role === ROLES.STAFF || role === ROLES.EXTERNAL)
    ? staffId
    : (body.assigneeId || '');

  const tasks = await sheetsRead(env, 'Tasks');
  const id = 'TASK-' + String(tasks.length + 1).padStart(3, '0');
  const row = [
    id, body.projectId, body.name, body.category || '',
    body.dueDate || '', body.description || '',
    body.status || 'Pending', assigneeId,
    'true', '', '', '',
    new Date().toISOString(), '',
    body.priority || 'Medium'
  ];
  await sheetsAppend(env, 'Tasks', row);
  return json({ success: true, id });
}

async function updateTask(request, env, role, taskId, staffId) {
  const tasks = await sheetsRead(env, 'Tasks');
  const rowIdx = tasks.findIndex(t => t.ID === taskId);
  if (rowIdx === -1) return json({ error: 'Not found' }, 404);
  const e = tasks[rowIdx];

  if (role === ROLES.STAFF || role === ROLES.EXTERNAL) {
    if (e.AssigneeID !== staffId) return json({ error: 'You can only update your own tasks' }, 403);
  }

  const body = await request.json();
  const updated = [
    e.ID,
    body.projectId || e.ProjectID,
    body.name || e.Name,
    body.category || e.Category,
    body.dueDate || e.DueDate || '',
    body.description || e.Description || '',
    body.status || e.Status || 'Pending',
    body.assigneeId || e.AssigneeID,
    body.active !== undefined ? String(body.active) : e.Active,
    body.evidenceFile || e.EvidenceFile || '',
    body.evidenceLink || e.EvidenceLink || '',
    body.evidenceNote || e.EvidenceNote || '',
    e.CreatedAt,
    (body.evidenceFile || body.evidenceLink) ? new Date().toISOString() : (e.EvidenceDate || ''),
    body.priority || e.Priority || 'Medium',
  ];
  await sheetsUpdateRow(env, 'Tasks', rowIdx + 2, updated);
  return json({ success: true });
}

// ══════════════════════════════════════════════════════════
// WORK LOG
// ══════════════════════════════════════════════════════════
async function getWorklog(url, env, role, staffId) {
  const logs = await sheetsRead(env, 'WorkLog');
  let filtered = logs;
  const { filterStaffId, projectId, taskId, from, to } = Object.fromEntries(url.searchParams);

  if (role === ROLES.STAFF || role === ROLES.EXTERNAL)
    filtered = filtered.filter(r => r.StaffID === staffId);
  else if (filterStaffId)
    filtered = filtered.filter(r => r.StaffID === filterStaffId);

  if (projectId) filtered = filtered.filter(r => r.ProjectID === projectId);
  if (taskId)    filtered = filtered.filter(r => r.TaskID === taskId);
  if (from)      filtered = filtered.filter(r => r.Date >= from);
  if (to)        filtered = filtered.filter(r => r.Date <= to);

  return json(filtered);
}

async function addWorklog(request, env, role, staffId) {
  if (role !== ROLES.ADMIN && role !== ROLES.MANAGEMENT) return json({ error: 'Management or admin only' }, 403);
  const body = await request.json();
  const id = `WL-${Date.now()}`;
  const row = [id, body.staffId, body.projectId, body.taskId, body.date, body.actual || 0, body.unit || '', body.status || 'Done', body.note || '', new Date().toISOString()];
  await sheetsAppend(env, 'WorkLog', row);
  return json({ success: true, id });
}

async function updateWorklog(request, env, role, logId) {
  if (role !== ROLES.ADMIN && role !== ROLES.MANAGEMENT) return json({ error: 'Management or admin only' }, 403);
  const body = await request.json();
  const logs = await sheetsRead(env, 'WorkLog');
  const rowIdx = logs.findIndex(l => l.ID === logId);
  if (rowIdx === -1) return json({ error: 'Not found' }, 404);
  const e = logs[rowIdx];
  const updated = [e.ID, e.StaffID, body.projectId||e.ProjectID, body.taskId||e.TaskID, body.date||e.Date, body.actual||e.Actual, body.unit||e.Unit, body.status||e.Status, body.note||e.Note, e.CreatedAt];
  await sheetsUpdateRow(env, 'WorkLog', rowIdx + 2, updated);
  return json({ success: true });
}

async function deleteWorklog(env, role, logId) {
  if (role !== ROLES.ADMIN) return json({ error: 'Admin only' }, 403);
  const logs = await sheetsRead(env, 'WorkLog');
  const rowIdx = logs.findIndex(l => l.ID === logId);
  if (rowIdx === -1) return json({ error: 'Not found' }, 404);
  await sheetsDeleteRow(env, 'WorkLog', rowIdx + 2);
  return json({ success: true });
}

// ══════════════════════════════════════════════════════════
// KPI
// ══════════════════════════════════════════════════════════
async function getKPI(url, env, role, staffId) {
  const [tasks, projects, staff] = await Promise.all([
    sheetsRead(env, 'Tasks'),
    sheetsRead(env, 'Projects'),
    sheetsRead(env, 'Staff'),
  ]);

  const { filterStaffId, projectId } = Object.fromEntries(url.searchParams);
  const targetStaffId = (role === ROLES.STAFF || role === ROLES.EXTERNAL) ? staffId : (filterStaffId || null);

  let relevantTasks = tasks.filter(t => t.Active?.toLowerCase() === 'true');
  if (projectId)     relevantTasks = relevantTasks.filter(t => t.ProjectID === projectId);
  if (targetStaffId) relevantTasks = relevantTasks.filter(t => t.AssigneeID === targetStaffId);

  const kpis = relevantTasks.map(t => {
    const proj = projects.find(p => p.ID === t.ProjectID);
    const status = t.Status || 'Pending';
    const pct = status === 'Done' ? 100 : status === 'In Progress' ? 50 : 0;
    return {
      taskId: t.ID,
      taskName: t.Name,
      projectId: t.ProjectID,
      projectName: proj ? proj.ShortName : t.ProjectID,
      assigneeId: t.AssigneeID,
      category: t.Category || '',
      dueDate: t.DueDate || '',
      taskStatus: status,
      hasEvidence: !!(t.EvidenceFile || t.EvidenceLink),
      evidenceLink: t.EvidenceLink || t.EvidenceFile || '',
      evidenceDate: t.EvidenceDate || '',
      priority: t.Priority || 'Medium',
      percentage: pct,
      status: status === 'Done' ? 'achieved' : status === 'In Progress' ? 'on-track' : 'behind',
    };
  });

  let staffSummary = [];
  if (role === ROLES.ADMIN || role === ROLES.MANAGEMENT) {
    const activeStaff = staff.filter(s => s.Active?.toLowerCase() === 'true');
    staffSummary = activeStaff.map(s => {
      const staffKpis = kpis.filter(k => k.assigneeId === s.ID);
      const done = staffKpis.filter(k => k.taskStatus === 'Done').length;
      const inProg = staffKpis.filter(k => k.taskStatus === 'In Progress').length;
      const avg = staffKpis.length ? Math.round((done / staffKpis.length) * 100) : 0;
      return {
        staffId: s.ID,
        name: s.Name,
        role: s.Role,
        taskCount: staffKpis.length,
        doneCount: done,
        inProgressCount: inProg,
        avgPercentage: avg,
        overallStatus: avg >= 80 ? 'on-track' : avg >= 40 ? 'at-risk' : 'behind',
      };
    });
  }

  return json({ kpis, staffSummary });
}

// ══════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════
async function getDashboard(env, role, staffId) {
  const [staff, projects, tasks] = await Promise.all([
    sheetsRead(env, 'Staff'),
    sheetsRead(env, 'Projects'),
    sheetsRead(env, 'Tasks'),
  ]);
  const logs = [];

  const activeStaff = staff.filter(s => s.Active?.toLowerCase() === 'true');
  const activeProjects = projects.filter(p => p.Status?.toLowerCase() === 'active');

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const thisMonthLogs = logs.filter(l => l.Date >= monthStart);

  const activeTasks = tasks.filter(t => t.Active?.toLowerCase() === 'true');
  const kpiPcts = activeTasks.map(t => {
    const s = t.Status || 'Pending';
    return s === 'Done' ? 100 : s === 'In Progress' ? 50 : 0;
  });
  const avgKpi = kpiPcts.length ? Math.round(kpiPcts.reduce((a, b) => a + b, 0) / kpiPcts.length) : 0;
  const onTrack = activeTasks.filter(t => t.Status === 'Done' || t.Status === 'In Progress').length;

  const recentLogs = activeTasks
    .filter(t => t.Status && t.Status !== 'Pending')
    .slice(-5).reverse()
    .map(t => {
      const s = staff.find(s => s.ID === t.AssigneeID);
      return {
        Date: t.CreatedAt ? t.CreatedAt.slice(0,10) : '—',
        staffName: s?.Name || '—',
        taskName: t.Name || '—',
        Status: t.Status || 'Pending',
      };
    });

  if (role === ROLES.STAFF || role === ROLES.EXTERNAL) {
    const myTasks = activeTasks.filter(t => t.AssigneeID === staffId);
    const myKpis = myTasks.map(t => {
      const status = t.Status || 'Pending';
      const pct = status === 'Done' ? 100 : status === 'In Progress' ? 50 : 0;
      return {
        taskId: t.ID,
        taskName: t.Name,
        taskStatus: status,
        dueDate: t.DueDate || '',
        category: t.Category || '',
        percentage: pct,
        hasEvidence: !!(t.EvidenceFile || t.EvidenceLink),
        evidenceLink: t.EvidenceLink || t.EvidenceFile || '',
      };
    });
    return json({ myKpis, role });
  }

  return json({
    role,
    stats: {
      totalStaff: activeStaff.length,
      activeProjects: activeProjects.length,
      totalTasks: activeTasks.length,
      logsThisMonth: thisMonthLogs.length,
      avgKpiPercent: avgKpi,
      tasksOnTrack: onTrack,
    },
    recentLogs,
    staffSummary: activeStaff.map(s => {
      const sTasks = activeTasks.filter(t => t.AssigneeID === s.ID);
      const done = sTasks.filter(t => t.Status === 'Done').length;
      const avg = sTasks.length ? Math.round((done / sTasks.length) * 100) : 0;
      return { staffId: s.ID, name: s.Name, role: s.Role, taskCount: sTasks.length, avgKpi: avg, status: avg >= 70 ? 'on-track' : avg >= 40 ? 'at-risk' : 'behind' };
    }),
  });
}

// ══════════════════════════════════════════════════════════
// PROFILE PHOTO UPLOAD
// ══════════════════════════════════════════════════════════
async function uploadEvidence(request, env, staffId, taskId) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) return json({ error: 'No file provided' }, 400);

    const maxSize = 10 * 1024 * 1024;
    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength > maxSize) return json({ error: 'File must be under 10MB' }, 400);

    const token = await getDriveToken(env);
    const fileType = file.type || 'application/octet-stream';
    const fileName = 'evidence_' + taskId + '_' + Date.now() + '_' + (file.name || 'file');
    const folderId = env.Evidence_Folder_ID || 'root';
    const boundary = 'AhPhyayEvidenceBoundary';
    const CR = String.fromCharCode(13);
    const LF = String.fromCharCode(10);
    const CRLF = CR + LF;
    const metadataJson = JSON.stringify({ name: fileName, parents: [folderId] });

    const part1 = '--' + boundary + CRLF +
      'Content-Type: application/json; charset=UTF-8' + CRLF + CRLF +
      metadataJson + CRLF +
      '--' + boundary + CRLF +
      'Content-Type: ' + fileType + CRLF + CRLF;
    const part3 = CRLF + '--' + boundary + '--';

    const enc = new TextEncoder();
    const p1 = enc.encode(part1);
    const p2 = new Uint8Array(arrayBuffer);
    const p3 = enc.encode(part3);
    const combined = new Uint8Array(p1.byteLength + p2.byteLength + p3.byteLength);
    combined.set(p1, 0);
    combined.set(p2, p1.byteLength);
    combined.set(p3, p1.byteLength + p2.byteLength);

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'multipart/related; boundary=' + boundary,
        },
        body: combined,
      }
    );

    const uploadData = await uploadRes.json();
    if (!uploadData.id) return json({ error: 'Upload failed', detail: uploadData }, 500);

    await fetch('https://www.googleapis.com/drive/v3/files/' + uploadData.id + '/permissions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });

    const fileUrl = 'https://drive.google.com/file/d/' + uploadData.id + '/view?usp=sharing';
    return json({ success: true, fileUrl });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

async function uploadProfilePhoto(request, env, staffId) {
  try {
    const formData = await request.formData();
    const file = formData.get('photo');
    if (!file) return json({ error: 'No photo provided' }, 400);

    const maxSize = 2 * 1024 * 1024;
    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength > maxSize) return json({ error: 'Image must be under 2MB' }, 400);

    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const photoUrl = 'data:' + (file.type || 'image/jpeg') + ';base64,' + base64;

    const staff = await sheetsRead(env, 'Staff');
    const rowIdx = staff.findIndex(s => s.ID === staffId);
    if (rowIdx !== -1) {
      await sheetsUpdate(env, 'Staff', rowIdx + 2, getColIndex('Staff', 'PhotoURL'), photoUrl);
    }

    return json({ success: true, photoUrl });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// ══════════════════════════════════════════════════════════
// GOOGLE SHEETS HELPERS
// ══════════════════════════════════════════════════════════
const SHEET_HEADERS = {
  Staff:    ['ID','Name','Username','Password','Role','Type','Email','Projects','Active','CreatedAt','PhotoURL'],
  Projects: ['ID','Name','ShortName','StartDate','EndDate','Status','Description','CreatedAt'],
  Tasks:    ['ID','ProjectID','Name','Category','DueDate','Description','Status','AssigneeID','Active','EvidenceFile','EvidenceLink','EvidenceNote','CreatedAt','EvidenceDate','Priority'],
  WorkLog:  ['ID','StaffID','ProjectID','TaskID','Date','Actual','Unit','Status','Note','CreatedAt'],
  Config:   ['Key','Value'],
};

function getColIndex(sheet, colName) {
  return SHEET_HEADERS[sheet]?.indexOf(colName) ?? -1;
}

async function getGoogleToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: env.GOOGLE_SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claim));
  const signing = `${header}.${payload}`;

  const pemKey = env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const pemBody = pemKey.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const keyBuffer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0)).buffer;

  const key = await crypto.subtle.importKey(
    'pkcs8', keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signing));
  const sigB64 = b64url(String.fromCharCode(...new Uint8Array(sig)), true);
  const jwt = `${signing}.${sigB64}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const { access_token } = await res.json();
  return access_token;
}

async function getDriveToken(env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.DRIVE_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    if (data.error === 'invalid_grant') {
      throw new Error('Drive access expired. Admin must regenerate DRIVE_REFRESH_TOKEN in worker settings.');
    }
    throw new Error('Drive auth failed: ' + (data.error_description || data.error || 'unknown'));
  }
  return data.access_token;
}

async function sheetsRead(env, sheetName) {
  const token = await getGoogleToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SPREADSHEET_ID}/values/${sheetName}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!data.values || data.values.length < 2) return [];
  const [headers, ...rows] = data.values;
  return rows.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
}

async function sheetsAppend(env, sheetName, row) {
  const token = await getGoogleToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SPREADSHEET_ID}/values/${sheetName}!A1:append?valueInputOption=USER_ENTERED`;
  await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
  });
}

async function sheetsUpdate(env, sheetName, rowNum, colIdx, value) {
  const token = await getGoogleToken(env);
  const col = String.fromCharCode(65 + colIdx);
  const range = `${sheetName}!${col}${rowNum}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`;
  await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[value]] }),
  });
}

async function sheetsUpdateRow(env, sheetName, rowNum, rowData) {
  const token = await getGoogleToken(env);
  const endCol = String.fromCharCode(65 + rowData.length - 1);
  const range = `${sheetName}!A${rowNum}:${endCol}${rowNum}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`;
  await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [rowData] }),
  });
}

async function sheetsDeleteRow(env, sheetName, rowNum) {
  const token = await getGoogleToken(env);
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.SPREADSHEET_ID}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const meta = await metaRes.json();
  const sheet = meta.sheets?.find(s => s.properties.title === sheetName);
  if (!sheet) return;

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.SPREADSHEET_ID}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: { sheetId: sheet.properties.sheetId, dimension: 'ROWS', startIndex: rowNum - 1, endIndex: rowNum }
        }
      }]
    }),
  });
}

// ══════════════════════════════════════════════════════════
// PASSWORD HASHING — PBKDF2 (Web Crypto API)
// ══════════════════════════════════════════════════════════
async function hashPassword(password) {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password),
    { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const hash = Array.from(new Uint8Array(bits))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  return `pbkdf2:${salt}:${hash}`;
}

async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('pbkdf2:')) return false;
  const [, salt, storedHash] = stored.split(':');

  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password),
    { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const hash = Array.from(new Uint8Array(bits))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  return hash === storedHash;
}

// ══════════════════════════════════════════════════════════
// JWT — lightweight, no library
// ══════════════════════════════════════════════════════════
async function signJWT(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + 1000 * 60 * 60 * 24 * 30 }));
  const sig = await hmacSign(`${header}.${body}`, secret);
  return `${header}.${body}.${sig}`;
}

async function verifyJWT(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const [header, body, sig] = token.split('.');
    const expected = await hmacSign(`${header}.${body}`, env.JWT_SECRET);
    if (sig !== expected) return null;
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

async function hmacSign(data, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64url(String.fromCharCode(...new Uint8Array(sig)), true);
}

function b64url(str, isBinary = false) {
  const base = isBinary ? btoa(str) : btoa(unescape(encodeURIComponent(str)));
  return base.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}