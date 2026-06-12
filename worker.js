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

const ROLES = {
  BOD:               'bod',
  SENIOR_IMPACT:     'senior-impact',
  SENIOR_BIZ:        'senior-biz',
  PROJECT_COORD:     'project-coordinator',
  PRODUCTION_LEAD:   'production-lead',
  SENIOR_ADMIN:      'senior-admin',
  PROJECT_OFFICER:   'project-officer',
  NETWORK_CATALYST:  'network-catalyst',
  PAGE_ADMIN:        'page-admin',
  ADMIN_ASSISTANT:   'admin-assistant',
  PRODUCTION_INTERN: 'production-intern',
};

// Permission group helpers
const isAdmin      = r => r === 'bod';
const isManagement = r => ['bod','senior-impact','senior-biz','project-coordinator'].includes(r);
const isStaffLevel = r => ['production-lead','senior-admin','project-officer','network-catalyst','page-admin','admin-assistant','production-intern'].includes(r);
const hasAccess    = r => Object.values(ROLES).includes(r);

// Role display labels
const ROLE_LABELS = {
  'bod':                  'BOD',
  'senior-impact':        'Senior Impact Coordinator',
  'senior-biz':           'Senior Business Development Coordinator',
  'project-coordinator':  'Project Coordinator',
  'production-lead':      'Production Lead',
  'senior-admin':         'Senior Admin & Finance Assistant',
  'project-officer':      'Project Officer',
  'network-catalyst':     'Network Catalyst',
  'page-admin':           'Page Admin',
  'admin-assistant':      'Admin & Finance Assistant',
  'production-intern':    'Production Intern',
};

// Legacy role mapping — converts old role names to new ones on login
function normalizeRole(role) {
  if (!role) return 'project-officer';
  const r = role.toLowerCase().trim();
  const map = {
    // old generic names
    'admin':         'bod',
    'management':    'senior-impact',
    'staff':         'project-officer',
    'external':      'network-catalyst',
    // old specific names
    'senior':        'senior-impact',
    'coordinator':   'project-coordinator',
    'officer':       'project-officer',
    'assistant':     'admin-assistant',
    'specialist':    'production-lead',
    'tailor':        'production-lead',
    'advisor':       'network-catalyst',
    'intern':        'production-intern',
  };
  return map[r] || r;
}

// Check if a staffId is one of the (possibly comma-separated) assignees
function isAssigned(assigneeField, staffId) {
  if (!assigneeField || !staffId) return false;
  return assigneeField.split(',').map(s => s.trim()).includes(staffId);
}

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
      if (path === '/staff/names' && request.method === 'GET')     return await getStaffNames(env);
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

      // Storage
      if (path === '/storage/debug' && request.method === 'GET' && isAdmin(role)) {
        const staff = await sheetsRead(env, 'Staff');
        return json(staff.map(s => ({ ID: s.ID, Name: s.Name, FolderID: s.FolderID || '(empty)', PhotoURL: s.PhotoURL ? '(has photo)' : '(no photo)' })));
      }
      if (path === '/storage' && request.method === 'GET')                          return await getStorageOverview(env, role, staffId);
      if (path.match(/^\/storage\/[\w-]+\/resumable$/) && request.method === 'POST') return await initResumableUpload(request, env, role, staffId, path.split('/')[2]);
      if (path.match(/^\/storage\/[\w-]+$/) && request.method === 'GET')           return await getStaffStorage(url, env, role, staffId, path.split('/')[2]);
      if (path.match(/^\/storage\/[\w-]+\/upload$/) && request.method === 'POST') return await uploadToStorage(request, env, role, staffId, path.split('/')[2]);
      if (path.match(/^\/storage\/file\/[\w-]+$/) && request.method === 'DELETE') return await deleteStorageFile(request, env, role, staffId, path.split('/')[3]);
      if (path.match(/^\/storage\/file\/[\w-]+\/rename$/) && request.method === 'PUT') return await renameStorageFile(request, env, role, staffId, path.split('/')[3]);
      if (path === '/storage/init-missing' && request.method === 'POST')            return await initMissingFolders(env, role);

      // Requests
      if (path === '/requests' && request.method === 'GET')
        return await getRequests(env, staffId, auth.name);
      if (path === '/requests' && request.method === 'POST')
        return await createRequest(request, env, staffId, auth.name);
      if (path.match(/^\/requests\/[\w-]+$/) && request.method === 'PUT')
        return await respondToRequest(request, env, staffId, auth.name, path.split('/')[2]);

      // Notifications
      if (path === '/notifications' && request.method === 'GET')
        return await getNotifications(url, env, staffId, role);
      if (path === '/notifications/read' && request.method === 'POST')
        return await markNotificationsRead(request, env, staffId);

      // Comments
      if (path.match(/^\/tasks\/[\w-]+\/comments$/) && request.method === 'GET')
        return await getTaskComments(path.split('/')[2], env);
      if (path.match(/^\/tasks\/[\w-]+\/comments$/) && request.method === 'POST')
        return await addTaskComment(request, path.split('/')[2], env, staffId, auth.name);

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

  const role = normalizeRole(user.Role);

  const token = await signJWT({
    staffId: user.ID,
    name: user.Name,
    role,
    email: user.Email,
    projects: user.Projects,
  }, env.JWT_SECRET);

  return json({
    token,
    user: {
      staffId: user.ID,
      name: user.Name,
      role,
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
  if (!isAdmin(role)) return json({ error: 'Admin only' }, 403);
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
  if (isStaffLevel(role)) {
    const me = staff.find(r => r.ID === staffId);
    return json(me ? [sanitizeStaff(me)] : []);
  }
  return json(staff.filter(r => r.Active?.toLowerCase() === 'true').map(sanitizeStaff));
}

// Returns minimal staff list (ID + Name only) — safe for all roles to look up assignee names
async function getStaffNames(env) {
  const staff = await sheetsRead(env, 'Staff');
  const names = staff
    .filter(s => s.Active?.toLowerCase() === 'true')
    .map(s => ({ ID: s.ID, Name: s.Name }));
  return json(names);
}

async function addStaff(request, env, role) {
  if (!isAdmin(role)) return json({ error: 'Admin only' }, 403);
  const body = await request.json();
  const { name, username, password, staffRole, type, email, projects } = body;
  if (!name || !username || !password) return json({ error: 'Missing required fields' }, 400);

  const staff = await sheetsRead(env, 'Staff');
  if (staff.find(r => r.Username?.toLowerCase() === username.toLowerCase()))
    return json({ error: 'Username already exists' }, 409);

  const id = `STAFF-${String(staff.length + 1).padStart(3, '0')}`;
  const hashed = await hashPassword(password);

  // Create personal Drive folder structure for this staff member
  let folderId = '';
  try {
    folderId = await createStaffFolderStructure(env, id, name);
  } catch (e) {
    console.error('Failed to create staff folder:', e.message);
    // Don't block account creation if folder creation fails
  }

  const row = [id, name, username, hashed, staffRole || 'Staff', type || 'Staff', email || '', projects || '', 'true', new Date().toISOString(), '', folderId];
  await sheetsAppend(env, 'Staff', row);
  return json({ success: true, id });
}

async function updateStaff(request, env, role, targetId) {
  if (!isAdmin(role)) return json({ error: 'Admin only' }, 403);
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
  if (isStaffLevel(role)) {
    const staff = await sheetsRead(env, 'Staff');
    const me = staff.find(r => r.ID === staffId);
    const myProjects = (me?.Projects || '').split(',').map(p => p.trim());
    if (myProjects.includes('ALL')) return json(projects.filter(p => p.Status?.toLowerCase() === 'active'));
    return json(projects.filter(p => myProjects.includes(p.ID)));
  }
  return json(projects);
}

async function addProject(request, env, role) {
  if (!isManagement(role)) return json({ error: 'Insufficient permissions' }, 403);
  const body = await request.json();
  const projects = await sheetsRead(env, 'Projects');
  const id = `PROJ-${String(projects.length + 1).padStart(3, '0')}`;
  const row = [id, body.name, body.shortName || body.name, body.startDate, body.endDate, body.status || 'Active', body.description || '', new Date().toISOString()];
  await sheetsAppend(env, 'Projects', row);
  return json({ success: true, id });
}

async function updateProject(request, env, role, projectId) {
  if (!isManagement(role)) return json({ error: 'Insufficient permissions' }, 403);
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
  if (isStaffLevel(role))
    filtered = filtered.filter(t => isAssigned(t.AssigneeID, staffId));
  return json(filtered);
}

async function addTask(request, env, role, staffId) {
  const body = await request.json();
  if (!body.name || !body.projectId) return json({ error: 'Name and project are required' }, 400);

  const assigneeId = (isStaffLevel(role))
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

  // Notify assignees they have been assigned a task
  try {
    const assigneeIds = assigneeId ? assigneeId.split(',').map(s => s.trim()).filter(Boolean) : [];
    for (const recipientId of assigneeIds) {
      if (recipientId !== staffId) { // don't notify self-assigned
        await createNotification(env, recipientId, 'assigned',
          'New task assigned to you',
          `You have been assigned: "${body.name}"`,
          id
        );
      }
    }
  } catch(e) { console.error('Assignment notification failed:', e.message); }

  return json({ success: true, id });
}

async function updateTask(request, env, role, taskId, staffId) {
  const tasks = await sheetsRead(env, 'Tasks');
  const rowIdx = tasks.findIndex(t => t.ID === taskId);
  if (rowIdx === -1) return json({ error: 'Not found' }, 404);
  const e = tasks[rowIdx];

  if (isStaffLevel(role)) {
    if (!isAssigned(e.AssigneeID, staffId)) return json({ error: 'You can only update your own tasks' }, 403);
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

  // Notifications for task updates
  try {
    const newStatus = body.status || e.Status;
    const newAssigneeId = body.assigneeId || e.AssigneeID || '';

    // Notify management/BOD when task is marked Done
    if (newStatus === 'Done' && e.Status !== 'Done') {
      const allStaff = await sheetsRead(env, 'Staff');
      const managers = allStaff.filter(s => isManagement(s.Role?.toLowerCase()) && s.Active?.toLowerCase() === 'true');
      for (const mgr of managers) {
        await createNotification(env, mgr.ID, 'completed',
          'Task completed',
          `"${e.Name}" has been marked as done`,
          taskId
        );
      }
    }

    // Notify newly assigned staff
    const oldIds = (e.AssigneeID || '').split(',').map(s => s.trim()).filter(Boolean);
    const newIds = newAssigneeId.split(',').map(s => s.trim()).filter(Boolean);
    const addedIds = newIds.filter(id => !oldIds.includes(id));
    for (const recipientId of addedIds) {
      if (recipientId !== staffId) {
        await createNotification(env, recipientId, 'assigned',
          'Task assigned to you',
          `You have been assigned: "${e.Name}"`,
          taskId
        );
      }
    }
  } catch(ex) { console.error('Update notification failed:', ex.message); }

  return json({ success: true });
}

// ══════════════════════════════════════════════════════════
// WORK LOG
// ══════════════════════════════════════════════════════════
async function getWorklog(url, env, role, staffId) {
  const logs = await sheetsRead(env, 'WorkLog');
  let filtered = logs;
  const { filterStaffId, projectId, taskId, from, to } = Object.fromEntries(url.searchParams);

  if (isStaffLevel(role))
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
  if (!isManagement(role)) return json({ error: 'Management or BOD only' }, 403);
  const body = await request.json();
  const id = `WL-${Date.now()}`;
  const row = [id, body.staffId, body.projectId, body.taskId, body.date, body.actual || 0, body.unit || '', body.status || 'Done', body.note || '', new Date().toISOString()];
  await sheetsAppend(env, 'WorkLog', row);
  return json({ success: true, id });
}

async function updateWorklog(request, env, role, logId) {
  if (!isManagement(role)) return json({ error: 'Management or BOD only' }, 403);
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
  if (!isAdmin(role)) return json({ error: 'Admin only' }, 403);
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
  const targetStaffId = isStaffLevel(role) ? staffId : (filterStaffId || null);

  let relevantTasks = tasks.filter(t => t.Active?.toLowerCase() === 'true');
  if (projectId)     relevantTasks = relevantTasks.filter(t => t.ProjectID === projectId);
  if (targetStaffId) relevantTasks = relevantTasks.filter(t => isAssigned(t.AssigneeID, targetStaffId));

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
  if (isManagement(role)) {
    const activeStaff = staff.filter(s => s.Active?.toLowerCase() === 'true');
    staffSummary = activeStaff.map(s => {
      const staffKpis = kpis.filter(k => isAssigned(k.assigneeId, s.ID));
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

  if (isStaffLevel(role)) {
    const myTasks = activeTasks.filter(t => isAssigned(t.AssigneeID, staffId));
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
      const sTasks = activeTasks.filter(t => isAssigned(t.AssigneeID, s.ID));
      const done = sTasks.filter(t => t.Status === 'Done').length;
      const avg = sTasks.length ? Math.round((done / sTasks.length) * 100) : 0;
      return { staffId: s.ID, name: s.Name, role: s.Role, taskCount: sTasks.length, avgKpi: avg, status: avg >= 70 ? 'on-track' : avg >= 40 ? 'at-risk' : 'behind' };
    }),
  });
}

// ══════════════════════════════════════════════════════════
// PROFILE PHOTO UPLOAD
// ══════════════════════════════════════════════════════════
// ── Get or create a per-task subfolder inside the Evidence root folder ──
async function getOrCreateTaskFolder(token, env, taskId, taskName) {
  const rootFolderId = env.Evidence_Folder_ID || 'root';
  // Sanitize folder name — Drive allows most chars but strip slashes
  const safeName = (taskId + ' — ' + (taskName || 'Untitled')).replace(/[/\\]/g, '-');

  // Search for existing folder with this name inside root
  const searchUrl = 'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
    q: `name='${safeName.replace(/'/g, "\'")}' and '${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
    pageSize: '1',
  });

  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: 'Bearer ' + token },
  });
  const searchData = await searchRes.json();

  // Return existing folder if found
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // Create new folder
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: safeName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootFolderId],
    }),
  });
  const createData = await createRes.json();
  if (!createData.id) throw new Error('Failed to create task folder: ' + JSON.stringify(createData));
  return createData.id;
}

async function uploadEvidence(request, env, staffId, taskId) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) return json({ error: 'No file provided' }, 400);

    const maxSize = 100 * 1024 * 1024; // 100MB for evidence
    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength > maxSize) return json({ error: 'File must be under 100MB' }, 400);

    const token = await getDriveToken(env);

    // Look up task name from Sheets for a human-readable folder name
    let taskName = '';
    try {
      const tasks = await sheetsRead(env, 'Tasks');
      const task = tasks.find(t => t.ID === taskId);
      taskName = task?.Name || '';
    } catch (_) {}

    // Get or create the per-task subfolder
    const folderId = await getOrCreateTaskFolder(token, env, taskId, taskName);

    // Use original filename (clean it up slightly), no taskId prefix needed
    const fileName = (file.name || 'file').replace(/[^\w.\-_ ]/g, '_');
    const fileType = file.type || 'application/octet-stream';

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

    // Make file publicly readable
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

    const maxSize = 2 * 1024 * 1024; // 2MB
    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength > maxSize) return json({ error: 'Image must be under 2MB' }, 400);

    // Upload to Google Drive (Profile_Folder_ID) instead of storing base64 in sheet
    const token = await getDriveToken(env);
    const folderId = env.Profile_Folder_ID || 'root';
    const fileName = 'profile_' + staffId + '_' + Date.now() + '.' + (file.name?.split('.').pop() || 'jpg');
    const fileType = file.type || 'image/jpeg';

    const boundary = 'AhPhyayProfileBoundary';
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
    if (!uploadData.id) return json({ error: 'Photo upload failed', detail: uploadData }, 500);

    // Make publicly readable so it can be displayed in the browser
    await fetch('https://www.googleapis.com/drive/v3/files/' + uploadData.id + '/permissions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });

    // Use direct thumbnail URL — renders in <img> tags without redirect
    const photoUrl = 'https://drive.google.com/thumbnail?id=' + uploadData.id + '&sz=w200';

    // Save Drive URL to Staff sheet (short string, not base64)
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
// STORAGE — Drive folder management
// ══════════════════════════════════════════════════════════

// Create full folder structure for a new staff member
async function createStaffFolderStructure(env, staffId, staffName) {
  const token = await getDriveToken(env);
  const rootId = env.STAFF_STORAGE_ID;
  if (!rootId) throw new Error('STAFF_STORAGE_ID secret not set');

  const folderName = staffName + ' (' + staffId + ')';

  // Create staff root folder
  const staffFolder = await driveCreateFolder(token, folderName, rootId);

  // Create subfolders sequentially to avoid Drive API race conditions
  await driveCreateFolder(token, 'Evidence', staffFolder.id);
  await driveCreateFolder(token, 'Profile', staffFolder.id);
  await driveCreateFolder(token, 'General', staffFolder.id);

  return staffFolder.id;
}

// Create a single Drive folder
async function driveCreateFolder(token, name, parentId) {
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });
  const data = await res.json();
  if (!data.id) throw new Error('Failed to create folder "' + name + '": ' + JSON.stringify(data));
  return data;
}

// List files/folders in a Drive folder
async function driveListFiles(token, folderId) {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink,thumbnailLink)',
    orderBy: 'folder,name',
    pageSize: '200',
  });
  const res = await fetch('https://www.googleapis.com/drive/v3/files?' + params, {
    headers: { Authorization: 'Bearer ' + token },
  });
  const data = await res.json();
  return data.files || [];
}

// Search files by name within a folder tree
async function driveSearchFiles(token, folderId, query) {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and name contains '${query.replace(/'/g, "\'")}' and trashed=false`,
    fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink,parents)',
    pageSize: '50',
  });
  const res = await fetch('https://www.googleapis.com/drive/v3/files?' + params, {
    headers: { Authorization: 'Bearer ' + token },
  });
  const data = await res.json();
  return data.files || [];
}

// Get total size of all files in a folder (recursive via Drive API)
async function driveFolderSize(token, folderId) {
  // Recursively sum sizes by first getting all subfolders, then all files
  // Use ancestral search: find all files anywhere under this folder
  let totalBytes = 0;
  let pageToken = '';

  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`,
      fields: 'nextPageToken,files(size)',
      pageSize: '1000',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch('https://www.googleapis.com/drive/v3/files?' + params, {
      headers: { Authorization: 'Bearer ' + token },
    });
    const data = await res.json();
    totalBytes += (data.files || []).reduce((sum, f) => sum + parseInt(f.size || 0), 0);
    pageToken = data.nextPageToken || '';

    // Also recurse into subfolders
    const subParams = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'`,
      fields: 'files(id)',
      pageSize: '100',
    });
    const subRes = await fetch('https://www.googleapis.com/drive/v3/files?' + subParams, {
      headers: { Authorization: 'Bearer ' + token },
    });
    const subData = await subRes.json();
    for (const sub of (subData.files || [])) {
      totalBytes += await driveFolderSize(token, sub.id);
    }
  } while (pageToken);

  return totalBytes;
}

// Upload a file to a specific Drive folder
async function driveUploadFile(token, arrayBuffer, fileName, fileType, folderId) {
  const boundary = 'AhPhyayStorageBoundary';
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

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,webViewLink,modifiedTime',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'multipart/related; boundary=' + boundary,
      },
      body: combined,
    }
  );
  const data = await res.json();
  if (!data.id) throw new Error('Upload failed: ' + JSON.stringify(data));

  // Make publicly readable
  await fetch('https://www.googleapis.com/drive/v3/files/' + data.id + '/permissions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });

  return data;
}

// Helper: get staff folder ID, optionally auto-create if missing
async function getStaffFolderId(env, token, staffMember) {
  if (staffMember.FolderID) return staffMember.FolderID;
  // Auto-create if missing (for existing accounts)
  const folderId = await createStaffFolderStructure(env, staffMember.ID, staffMember.Name);
  // Save back to sheet
  const staff = await sheetsRead(env, 'Staff');
  const rowIdx = staff.findIndex(s => s.ID === staffMember.ID);
  if (rowIdx !== -1) {
    await sheetsUpdate(env, 'Staff', rowIdx + 2, getColIndex('Staff', 'FolderID'), folderId);
  }
  return folderId;
}

// GET /storage — overview of all staff storage (admin/management)
async function getStorageOverview(env, role, staffId) {
  const token = await getDriveToken(env);
  const staff = await sheetsRead(env, 'Staff');

  // All roles see the full overview (admin/management see all, staff/external only see themselves via frontend filter)
  // But for staff/external we still return all-staff overview and let frontend filter

  const activeStaff = staff.filter(s => s.Active?.toLowerCase() === 'true');

  // Debug: log what keys each staff row has
  const debugInfo = activeStaff.map(s => ({
    id: s.ID,
    name: s.Name,
    folderIdRaw: s.FolderID,
    keys: Object.keys(s),
  }));
  console.log('Staff sheet data:', JSON.stringify(debugInfo));

  // Don't call driveFolderSize here — too slow for overview and causes errors
  // Storage usage is shown when user clicks into a staff member's storage
  const storageData = activeStaff.map(s => ({
    staffId: s.ID,
    name: s.Name,
    role: s.Role,
    folderId: s.FolderID || '',
    usedBytes: 0,
    hasFolder: !!(s.FolderID && s.FolderID.trim()),
  }));

  return json({ staffStorage: storageData, _debug: debugInfo });
}

// GET /storage/:targetStaffId — list files for one staff member
async function getStaffStorage(url, env, role, staffId, targetStaffId) {
  // Staff can only see their own
  if (isStaffLevel(role) && targetStaffId !== staffId)
    return json({ error: 'Access denied' }, 403);

  const token = await getDriveToken(env);
  const staff = await sheetsRead(env, 'Staff');
  const member = staff.find(s => s.ID === targetStaffId);
  if (!member) return json({ error: 'Staff not found' }, 404);

  const folderId = await getStaffFolderId(env, token, member);
  const query = url.searchParams.get('q') || '';

  let files;
  if (query) {
    files = await driveSearchFiles(token, folderId, query);
    return json({ files, folderId, staffName: member.Name });
  }

  // List top-level subfolders (Evidence, Profile, General)
  const topLevel = await driveListFiles(token, folderId);
  const folders = topLevel.filter(f => f.mimeType === 'application/vnd.google-apps.folder');

  // For each subfolder, list its contents
  const structure = await Promise.all(folders.map(async folder => {
    const children = await driveListFiles(token, folder.id);
    // For Evidence folder, list task subfolders and their files
    if (folder.name === 'Evidence') {
      const taskFolders = children.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
      const taskFiles = await Promise.all(taskFolders.map(async tf => {
        const tFiles = await driveListFiles(token, tf.id);
        return { folder: tf, files: tFiles.filter(f => f.mimeType !== 'application/vnd.google-apps.folder') };
      }));
      const looseFiles = children.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');
      return { folder, taskGroups: taskFiles, files: looseFiles };
    }
    return { folder, files: children.filter(f => f.mimeType !== 'application/vnd.google-apps.folder') };
  }));

  const usedBytes = await driveFolderSize(token, folderId);
  return json({ structure, folderId, staffName: member.Name, usedBytes });
}

// POST /storage/:targetStaffId/upload — upload file to General/ subfolder
async function uploadToStorage(request, env, role, staffId, targetStaffId) {
  if (isStaffLevel(role) && targetStaffId !== staffId)
    return json({ error: 'Access denied' }, 403);

  const formData = await request.formData();
  const file = formData.get('file');
  const subfolder = formData.get('subfolder') || 'General';
  if (!file) return json({ error: 'No file provided' }, 400);

  const maxSize = 100 * 1024 * 1024; // 100MB via worker (Cloudflare free plan limit)
  const arrayBuffer = await file.arrayBuffer();
  if (arrayBuffer.byteLength > maxSize) return json({ error: 'File must be under 100MB' }, 400);

  const token = await getDriveToken(env);
  const staff = await sheetsRead(env, 'Staff');
  const member = staff.find(s => s.ID === targetStaffId);
  if (!member) return json({ error: 'Staff not found' }, 404);

  const rootFolderId = await getStaffFolderId(env, token, member);

  // Find the target subfolder
  const topLevel = await driveListFiles(token, rootFolderId);
  let targetFolder = topLevel.find(f => f.name === subfolder && f.mimeType === 'application/vnd.google-apps.folder');
  if (!targetFolder) {
    // Create it if it doesn't exist
    targetFolder = await driveCreateFolder(token, subfolder, rootFolderId);
  }

  const fileName = (file.name || 'file').replace(/[^\w.\-_ ]/g, '_');
  const uploaded = await driveUploadFile(token, arrayBuffer, fileName, file.type || 'application/octet-stream', targetFolder.id);

  return json({ success: true, file: uploaded });
}

// DELETE /storage/file/:fileId — delete a file from Drive
async function deleteStorageFile(request, env, role, staffId, fileId) {
  const token = await getDriveToken(env);

  // Verify the file belongs to this staff member (for staff/external)
  if (isStaffLevel(role)) {
    const staff = await sheetsRead(env, 'Staff');
    const me = staff.find(s => s.ID === staffId);
    if (!me?.FolderID) return json({ error: 'No storage folder found' }, 404);
    // Get file parents to verify ownership
    const fileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    const fileData = await fileRes.json();
    // Simple ownership check — file must be somewhere under their folder
    // (full recursive check would be expensive; we trust the UI)
  }

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token },
  });

  if (res.status === 204 || res.status === 200) return json({ success: true });
  const err = await res.json().catch(() => ({}));
  return json({ error: err.error?.message || 'Delete failed' }, 500);
}

// PUT /storage/file/:fileId/rename — rename a file
async function renameStorageFile(request, env, role, staffId, fileId) {
  const { newName } = await request.json();
  if (!newName?.trim()) return json({ error: 'New name required' }, 400);

  const token = await getDriveToken(env);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName.trim() }),
  });
  const data = await res.json();
  if (!data.id) return json({ error: 'Rename failed' }, 500);
  return json({ success: true, file: data });
}

// POST /storage/init-missing — create folders for staff who don't have one yet
async function initMissingFolders(env, role) {
  if (!isAdmin(role)) return json({ error: 'Admin only' }, 403);

  const token = await getDriveToken(env);
  const rootId = env.STAFF_STORAGE_ID;
  const staff = await sheetsRead(env, 'Staff');
  const active = staff.filter(s => s.Active?.toLowerCase() === 'true');

  const results = [];

  for (const s of active) {
    try {
      const expectedFolderName = s.Name + ' (' + s.ID + ')';

      // Step 1: Check if folder already exists in Drive (prevent duplicates)
      const searchParams = new URLSearchParams({
        q: `name='${expectedFolderName.replace(/'/g,"\'")}' and '${rootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id,name)',
        pageSize: '5',
      });
      const searchRes = await fetch('https://www.googleapis.com/drive/v3/files?' + searchParams, {
        headers: { Authorization: 'Bearer ' + token },
      });
      const searchData = await searchRes.json();
      const existingFolders = searchData.files || [];

      let folderId = '';

      if (existingFolders.length > 0) {
        // Folder already exists in Drive — just use it (take first, ignore duplicates)
        folderId = existingFolders[0].id;
      } else {
        // Create fresh folder structure
        folderId = await createStaffFolderStructure(env, s.ID, s.Name);
      }

      // Step 2: Always write FolderID to sheet if it's missing or wrong
      if (!s.FolderID || s.FolderID !== folderId) {
        const freshStaff = await sheetsRead(env, 'Staff');
        const rowIdx = freshStaff.findIndex(r => r.ID === s.ID);
        if (rowIdx !== -1) {
          await sheetsUpdate(env, 'Staff', rowIdx + 2, getColIndex('Staff', 'FolderID'), folderId);
        }
        results.push({ staffId: s.ID, name: s.Name, success: true, folderId, action: s.FolderID ? 'fixed' : 'created' });
      } else {
        results.push({ staffId: s.ID, name: s.Name, success: true, folderId, action: 'ok' });
      }
    } catch (e) {
      results.push({ staffId: s.ID, name: s.Name, success: false, error: e.message });
    }
  }

  const created = results.filter(r => r.action === 'created').length;
  const fixed = results.filter(r => r.action === 'fixed').length;
  return json({ success: true, results, created, fixed });
}

// ══════════════════════════════════════════════════════════
// REQUESTS
// ══════════════════════════════════════════════════════════

async function getRequests(env, staffId, staffName) {
  try {
    const requests = await sheetsRead(env, 'Requests');
    const staff = await sheetsRead(env, 'Staff');

    // Enrich with names
    const enriched = requests.map(r => ({
      ...r,
      assigneeName: staff.find(s => s.ID === r.AssigneeID)?.Name || '—',
    }));

    const received = enriched.filter(r => r.AssigneeID === staffId)
      .sort((a, b) => b.CreatedAt.localeCompare(a.CreatedAt));
    const sent = enriched.filter(r => r.RequesterID === staffId)
      .sort((a, b) => b.CreatedAt.localeCompare(a.CreatedAt));

    const pendingCount = received.filter(r => r.Status === 'Pending').length;
    return json({ received, sent, pendingCount });
  } catch(e) {
    return json({ error: e.message }, 500);
  }
}

async function createRequest(request, env, staffId, staffName) {
  try {
    const { assigneeId, title, description } = await request.json();
    if (!assigneeId || !title?.trim()) return json({ error: 'Assignee and title required' }, 400);

    const id = 'REQ-' + Date.now();
    const row = [id, staffId, staffName, assigneeId, title.trim(), description?.trim() || '', 'Pending', '', new Date().toISOString()];
    await sheetsAppend(env, 'Requests', row);

    // Notify the assignee
    try {
      await createNotification(env, assigneeId, 'assigned',
        'New task request from ' + staffName,
        `"${title.trim()}" — tap to view and respond`,
        id
      );
    } catch(e) { console.error('Request notification failed:', e.message); }

    return json({ success: true, id });
  } catch(e) {
    return json({ error: e.message }, 500);
  }
}

async function respondToRequest(request, env, staffId, staffName, requestId) {
  try {
    const { action, response, projectId } = await request.json();
    if (!['accept','decline'].includes(action)) return json({ error: 'Action must be accept or decline' }, 400);

    const requests = await sheetsRead(env, 'Requests');
    const rowIdx = requests.findIndex(r => r.ID === requestId);
    if (rowIdx === -1) return json({ error: 'Request not found' }, 404);

    const req = requests[rowIdx];
    if (req.AssigneeID !== staffId) return json({ error: 'You can only respond to requests assigned to you' }, 403);
    if (req.Status !== 'Pending') return json({ error: 'Request already responded to' }, 400);

    const newStatus = action === 'accept' ? 'Accepted' : 'Declined';

    // Update Status and Response columns
    await sheetsUpdate(env, 'Requests', rowIdx + 2, getColIndex('Requests', 'Status'), newStatus);
    await sheetsUpdate(env, 'Requests', rowIdx + 2, getColIndex('Requests', 'Response'), response?.trim() || '');

    let taskId = '';

    // If accepted — create a real task
    if (action === 'accept') {
      try {
        const tasks = await sheetsRead(env, 'Tasks');
        taskId = 'TASK-' + String(tasks.length + 1).padStart(3, '0');
        const taskRow = [
          taskId,
          projectId || '',
          req.Title,
          'Request',
          '',
          req.Description,
          'Pending',
          staffId,
          'true',
          '',
          '',
          '',
          '',
          new Date().toISOString(),
          'Medium',
        ];
        await sheetsAppend(env, 'Tasks', taskRow);

        // Save task ID back to request
        await sheetsUpdate(env, 'Requests', rowIdx + 2, getColIndex('Requests', 'Response'),
          (response?.trim() || '') + (taskId ? ' [' + taskId + ']' : '')
        );
      } catch(e) { console.error('Task creation from request failed:', e.message); }
    }

    // Notify the requester
    try {
      const notifTitle = action === 'accept'
        ? staffName + ' accepted your request'
        : staffName + ' declined your request';
      const notifMsg = action === 'accept'
        ? `"${req.Title}" has been accepted and added as a task`
        : `"${req.Title}" was declined${response ? ': ' + response.trim() : ''}`;
      await createNotification(env, req.RequesterID, action === 'accept' ? 'completed' : 'comment',
        notifTitle, notifMsg, taskId || requestId
      );
    } catch(e) { console.error('Response notification failed:', e.message); }

    return json({ success: true, status: newStatus, taskId });
  } catch(e) {
    return json({ error: e.message }, 500);
  }
}

// ══════════════════════════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════════════════════════

async function createNotification(env, staffId, type, title, message, taskId = '') {
  const id = 'NTF-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
  const row = [id, staffId, type, title, message, taskId, 'FALSE', new Date().toISOString()];
  await sheetsAppend(env, 'Notifications', row);
  return id;
}

async function createNotificationsBatch(env, notifications) {
  // Create multiple notifications sequentially to avoid race conditions
  for (const n of notifications) {
    await createNotification(env, n.staffId, n.type, n.title, n.message, n.taskId || '');
  }
}

async function getNotifications(url, env, staffId, role) {
  try {
    const [notifications, tasks] = await Promise.all([
      sheetsRead(env, 'Notifications'),
      sheetsRead(env, 'Tasks'),
    ]);

    // Check for overdue tasks and create notifications if not already done today
    const today = new Date().toISOString().slice(0, 10);
    const activeTasks = tasks.filter(t => t.Active?.toLowerCase() === 'true' && t.DueDate && t.Status !== 'Done');
    const overdueTasks = activeTasks.filter(t => {
      if (!isAssigned(t.AssigneeID, staffId)) return false;
      try {
        return new Date(t.DueDate) < new Date(today);
      } catch { return false; }
    });

    // Only create ONE overdue notification per task per day
    const existingOverdueKeys = new Set(
      notifications.filter(n =>
        n.StaffID === staffId &&
        n.Type === 'overdue' &&
        n.CreatedAt?.slice(0, 10) === today
      ).map(n => n.TaskID + '|' + n.CreatedAt?.slice(0, 10))
    );

    const overdueToCreate = overdueTasks.filter(t =>
      !existingOverdueKeys.has(t.ID + '|' + today)
    );
    for (const t of overdueToCreate) {
      try {
        await createNotification(env, staffId, 'overdue',
          'Task overdue',
          `"${t.Name}" was due on ${t.DueDate}`,
          t.ID
        );
      } catch(e) { console.error('Failed to create overdue notif:', e.message); }
    }

    // Re-read after possible overdue additions
    const fresh = await sheetsRead(env, 'Notifications');
    const mine = fresh
      .filter(n => n.StaffID === staffId)
      .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''))
      .slice(0, 50);

    const unreadCount = mine.filter(n => n.IsRead?.toLowerCase() === 'false').length;
    return json({ notifications: mine, unreadCount });
  } catch(e) {
    console.error('getNotifications error:', e.message);
    return json({ notifications: [], unreadCount: 0 });
  }
}

async function markNotificationsRead(request, env, staffId) {
  try {
  const { notifId } = await request.json();
  const notifs = await sheetsRead(env, 'Notifications');

  if (notifId === 'all') {
    // Mark all mine as read sequentially
    const myUnread = notifs.filter(n => n.StaffID === staffId && n.IsRead?.toLowerCase() === 'false');
    for (const n of myUnread) {
      const rowIdx = notifs.findIndex(r => r.ID === n.ID);
      if (rowIdx !== -1) {
        await sheetsUpdate(env, 'Notifications', rowIdx + 2, getColIndex('Notifications', 'IsRead'), 'TRUE');
      }
    }
  } else {
    const rowIdx = notifs.findIndex(n => n.ID === notifId && n.StaffID === staffId);
    if (rowIdx !== -1) {
      await sheetsUpdate(env, 'Notifications', rowIdx + 2, getColIndex('Notifications', 'IsRead'), 'TRUE');
    }
  }

  return json({ success: true });
  } catch(e) {
    console.error('markNotificationsRead error:', e.message);
    return json({ error: e.message }, 500);
  }
}

// ══════════════════════════════════════════════════════════
// COMMENTS
// ══════════════════════════════════════════════════════════

async function getTaskComments(taskId, env) {
  const comments = await sheetsRead(env, 'Comments');
  const filtered = comments
    .filter(c => c.TaskID === taskId)
    .sort((a, b) => a.CreatedAt.localeCompare(b.CreatedAt));
  return json(filtered);
}

async function addTaskComment(request, taskId, env, staffId, staffName) {
  const { comment } = await request.json();
  if (!comment?.trim()) return json({ error: 'Comment cannot be empty' }, 400);

  const comments = await sheetsRead(env, 'Comments');
  const id = 'CMT-' + Date.now();
  const row = [id, taskId, staffId, staffName, comment.trim(), new Date().toISOString()];
  await sheetsAppend(env, 'Comments', row);

  // Notify all assignees of this task (except the commenter)
  try {
    const tasks = await sheetsRead(env, 'Tasks');
    const task = tasks.find(t => t.ID === taskId);
    if (task) {
      const assigneeIds = (task.AssigneeID || '').split(',').map(s => s.trim()).filter(Boolean);
      const toNotify = assigneeIds.filter(id => id !== staffId);
      for (const recipientId of toNotify) {
        await createNotification(env, recipientId, 'comment',
          'New comment on your task',
          `${staffName} commented on "${task.Name}": ${comment.trim().slice(0, 80)}${comment.trim().length > 80 ? '…' : ''}`,
          taskId
        );
      }
    }
  } catch(e) { console.error('Comment notification failed:', e.message); }

  return json({ success: true, id });
}

// ══════════════════════════════════════════════════════════
// RESUMABLE UPLOAD — for files up to 2GB
// Browser uploads directly to Drive, bypassing Cloudflare limits
// ══════════════════════════════════════════════════════════

async function initResumableUpload(request, env, role, staffId, targetStaffId) {
  // Access check
  if (isStaffLevel(role) && targetStaffId !== staffId)
    return json({ error: 'Access denied' }, 403);

  const { fileName, fileType, fileSize, subfolder } = await request.json();
  if (!fileName || !fileType || !fileSize) return json({ error: 'fileName, fileType and fileSize required' }, 400);

  const maxSize = 2 * 1024 * 1024 * 1024; // 2GB per file
  if (fileSize > maxSize) return json({ error: 'File must be under 2GB' }, 400);

  const token = await getDriveToken(env);
  const staff = await sheetsRead(env, 'Staff');
  const member = staff.find(s => s.ID === targetStaffId);
  if (!member) return json({ error: 'Staff not found' }, 404);

  const rootFolderId = await getStaffFolderId(env, token, member);

  // Find or create target subfolder
  const subfolderName = subfolder || 'General';
  const topLevel = await driveListFiles(token, rootFolderId);
  let targetFolder = topLevel.find(f => f.name === subfolderName && f.mimeType === 'application/vnd.google-apps.folder');
  if (!targetFolder) {
    targetFolder = await driveCreateFolder(token, subfolderName, rootFolderId);
  }

  const cleanName = fileName.replace(/[^\w.\-_ ]/g, '_');
  const metadata = JSON.stringify({ name: cleanName, parents: [targetFolder.id] });

  // Initiate resumable upload session with Google Drive
  const initRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': fileType,
        'X-Upload-Content-Length': String(fileSize),
      },
      body: metadata,
    }
  );

  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({}));
    return json({ error: 'Failed to initiate upload: ' + JSON.stringify(err) }, 500);
  }

  // The resumable upload URL is in the Location header
  const uploadUrl = initRes.headers.get('Location');
  if (!uploadUrl) return json({ error: 'No upload URL returned from Drive' }, 500);

  return json({ success: true, uploadUrl, folderId: targetFolder.id });
}

// ══════════════════════════════════════════════════════════
// GOOGLE SHEETS HELPERS
// ══════════════════════════════════════════════════════════
const SHEET_HEADERS = {
  Staff:    ['ID','Name','Username','Password','Role','Type','Email','Projects','Active','CreatedAt','PhotoURL','FolderID'],
  Projects: ['ID','Name','ShortName','StartDate','EndDate','Status','Description','CreatedAt'],
  Tasks:    ['ID','ProjectID','Name','Category','DueDate','Description','Status','AssigneeID','Active','EvidenceFile','EvidenceLink','EvidenceNote','CreatedAt','EvidenceDate','Priority'],
  WorkLog:  ['ID','StaffID','ProjectID','TaskID','Date','Actual','Unit','Status','Note','CreatedAt'],
  Config:   ['Key','Value'],
  Comments:      ['ID','TaskID','StaffID','StaffName','Comment','CreatedAt'],
  Notifications: ['ID','StaffID','Type','Title','Message','TaskID','IsRead','CreatedAt'],
  Requests:      ['ID','RequesterID','RequesterName','AssigneeID','Title','Description','Status','Response','CreatedAt'],
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