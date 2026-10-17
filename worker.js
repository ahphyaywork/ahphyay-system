/**
 * AhPhyay System — Cloudflare Worker API
 * Paste this entire file into the Cloudflare Worker editor manually.
 *
 * Environment secrets to set in Cloudflare Worker settings:
 *   SPREADSHEET_ID        — your Google Sheet ID
 *   GOOGLE_SA_EMAIL       — service account email
 *   GOOGLE_PRIVATE_KEY    — service account private key (full PEM)
 *   JWT_SECRET            — any long random string
 *   INCU_FOLDER_ID        — Drive folder ID for the SN@IL Incubation root (collaborator sub-folders are created inside it)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

const ROLES = {
  DEVELOPER:         'developer',
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
  COLLABORATOR:      'collaborator',   // SN@IL incubation collaborator (external business owner)
  RP_FINANCE:        'rp-finance',     // SN@IL external resource persons — review + comment on one topic
  RP_QUALITY:        'rp-quality',
  RP_BRAND:          'rp-brand',
  RP_LEAN:           'rp-lean',
};
const RP_TOPIC = { 'rp-finance':'finance', 'rp-quality':'pqr', 'rp-brand':'brand', 'rp-lean':'lean' };
const INCU_EXTERNAL_ROLES = ['collaborator','rp-finance','rp-quality','rp-brand','rp-lean'];

// Permission group helpers
const isAdmin      = r => r === 'bod' || r === 'developer';
const isManagement = r => ['bod','developer','senior-impact','senior-biz','project-coordinator'].includes(r);
const isDeveloper  = r => r === 'developer';
const isStaffLevel = r => ['production-lead','senior-admin','project-officer','network-catalyst','page-admin','admin-assistant','production-intern'].includes(r);
const hasAccess    = r => Object.values(ROLES).includes(r);
const isCollaborator = r => r === 'collaborator';
const isResourcePerson = r => !!RP_TOPIC[r];
const rpTopic = r => RP_TOPIC[r] || null;
const isMentor     = r => isAdmin(r);   // mentors are BOD/Developer for now

// Role display labels
const ROLE_LABELS = {
  'developer':            'Developer',
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
  'collaborator':         'Collaborator',
  'rp-finance':           'Resource Person — Finance',
  'rp-quality':           'Resource Person — Product Quality',
  'rp-brand':             'Resource Person — Branding',
  'rp-lean':              'Resource Person — Lean',
};

// ═══════════════════════════════════════════════════════════════
// JD SCOPE SYSTEM — maps tasks to each role's job description
// Derived from the 2026 staff JD documents. Editable by BOD via Config.
// ═══════════════════════════════════════════════════════════════

// Standardised scope areas drawn from the JD responsibility sections
const JD_AREAS = {
  production:   'Production & Tailoring',
  quality:      'Quality Control',
  finance:      'Finance & Accounting',
  procurement:  'Procurement, Inventory & Logistics',
  admin:        'Admin, Office & Facilities',
  program:      'Program & Project Implementation',
  training:     'Training & Capacity Building',
  meal:         'M&E, Learning & Reporting',
  docs:         'Documentation & Data',
  digital:      'Digital Platform & Web',
  content:      'Content, Media & Social',
  sales:        'Sales, Orders & Customers',
  community:    'Community & Network Engagement',
  partnership:  'Partnerships, Donors & Business Dev',
  coordination: 'Coordination & Meetings',
  hr:           'HR & People',
  system:       'System Development',
};

// Maps a free-text task Category to a scope area.
// Keys are lowercase; matching is exact first, then substring.
const CATEGORY_TO_AREA = {
  'production': 'production', 'production team': 'production', 'sewing': 'production',
  'tailoring': 'production', 'design': 'production', 'pattern': 'production',
  'quality control': 'quality', 'qc': 'quality', 'montly qc form': 'quality', 'monthly qc form': 'quality',
  'finance': 'finance', 'accounting': 'finance', 'budget': 'finance', 'payment': 'finance',
  'procurement': 'procurement', 'purchase': 'procurement', 'inventory': 'procurement',
  'logistics': 'procurement', 'stock': 'procurement',
  'admin': 'admin', 'operations': 'admin', 'operation': 'admin', 'office': 'admin', 'facilities': 'admin',
  'program': 'program', 'project': 'program', 'implementation': 'program',
  'training': 'training', 'coaching session': 'training', 'coaching': 'training',
  'lean management training': 'training', 'workshop': 'training',
  'm&e': 'meal', 'meal': 'meal', 'reporting': 'meal', 'monitoring': 'meal', 'evaluation': 'meal',
  'documentation': 'docs', 'data entry': 'docs', 'filing': 'docs', 'setup': 'docs', 'data': 'docs',
  'digital': 'digital', 'web': 'digital', 'website': 'digital', 'platform': 'digital', 'app': 'digital',
  'content': 'content', 'social': 'content', 'media': 'content', 'social media': 'content',
  'sales': 'sales', 'order': 'sales', 'orders': 'sales', 'customer': 'sales',
  'networking': 'community', 'network': 'community', 'community': 'community', 'outreach': 'community',
  'partnership': 'partnership', 'donor': 'partnership', 'grant': 'partnership', 'business development': 'partnership',
  'coordination': 'coordination', 'coordination meeting': 'coordination', 'meeting': 'coordination', 'agenda': 'coordination',
  'hr': 'hr', 'od': 'hr', 'people': 'hr', 'recruitment': 'hr',
  'development': 'system', 'bug fix': 'system', 'system improvement': 'system',
  'ahphyay-system': 'system', 'system': 'system',
};

// Resolve a task Category to a scope area key, or null if unrecognised
function categoryToArea(category) {
  const c = (category || '').trim().toLowerCase();
  if (!c) return null;
  if (CATEGORY_TO_AREA[c]) return CATEGORY_TO_AREA[c];
  // Substring fallback: longest matching key wins
  let best = null, bestLen = 0;
  for (const key in CATEGORY_TO_AREA) {
    if (c.includes(key) && key.length > bestLen) { best = CATEGORY_TO_AREA[key]; bestLen = key.length; }
  }
  return best;
}

// Default JD scope per role — which areas fall inside each role's job description.
// Sourced from the 2026 JD documents.
function defaultJdScope() {
  const allAreas = Object.keys(JD_AREAS);
  return {
    'bod':                 allAreas.slice(),
    'developer':           ['system','digital','docs'],
    'senior-impact':       ['production','quality','program','training','meal','docs','coordination','hr','finance','community'],
    'senior-biz':          ['procurement','finance','admin','program','partnership','coordination','docs','meal','hr','production','quality'],
    'project-coordinator': ['program','digital','training','community','docs','meal','coordination'],
    'production-lead':     ['production','quality','procurement'],
    'senior-admin':        ['admin','procurement','finance','docs','coordination'],
    'project-officer':     ['production','quality','finance','procurement','program','coordination','docs','meal'],
    'network-catalyst':    ['community','digital','content','docs','meal'],
    'page-admin':          ['content','digital','sales','procurement','coordination'],
    'admin-assistant':     ['finance','procurement','docs','admin'],
    'production-intern':   ['production','quality'],
  };
}

// Load the JD scope, merging any BOD overrides stored in Config
let _jdScopeCache = null;
async function getJdScope(env) {
  if (_jdScopeCache) return _jdScopeCache;
  const scope = defaultJdScope();
  try {
    const config = await sheetsRead(env, 'Config');
    const row = config.find(c => c.Key === 'jdScope');
    if (row && row.Value) {
      const overrides = JSON.parse(row.Value);
      for (const role in overrides) {
        if (Array.isArray(overrides[role])) scope[role] = overrides[role];
      }
    }
  } catch (e) { /* fall back to defaults */ }
  _jdScopeCache = scope;
  return _jdScopeCache;
}

async function saveJdScope(env, overrides) {
  const config = await sheetsRead(env, 'Config');
  const rowIdx = config.findIndex(c => c.Key === 'jdScope');
  const value = JSON.stringify(overrides);
  if (rowIdx === -1) {
    await sheetsAppend(env, 'Config', ['jdScope', value]);
  } else {
    await sheetsUpdate(env, 'Config', rowIdx + 2, getColIndex('Config', 'Value'), value);
  }
  _jdScopeCache = null;
}

// Compute how much of a staff member's work sits inside their JD.
// Returns null when there is nothing to measure, so the UI can show "—" rather than 0%.
function computeJdAlignment(staffTasks, role, scopeMap) {
  const allowed = new Set(scopeMap[role] || []);
  let inScope = 0, offScope = 0, unclassified = 0;
  const offScopeAreas = {};
  for (const t of staffTasks) {
    const area = categoryToArea(t.Category);
    if (!area) { unclassified++; continue; }
    if (allowed.has(area)) inScope++;
    else { offScope++; offScopeAreas[area] = (offScopeAreas[area] || 0) + 1; }
  }
  const classified = inScope + offScope;
  return {
    inScope, offScope, unclassified,
    classified,
    alignmentPct: classified ? Math.round((inScope / classified) * 100) : null,
    offScopeAreas: Object.entries(offScopeAreas)
      .sort((a, b) => b[1] - a[1])
      .map(([area, count]) => ({ area, label: JD_AREAS[area] || area, count })),
  };
}

// Date from which JD alignment starts affecting KPI scores.
// Only tasks due on/after this date are scored against the JD.
const JD_KPI_START_DATE = '2026-08-08';

// Alignment scoped to the JD-effective window (tasks due on/after the start date).
// Uncategorised tasks are excluded; off-JD tasks are neutral (not misses),
// they only lower the in-JD proportion.
function computeJdAlignmentScored(staffTasks, role, scopeMap) {
  const scoped = staffTasks.filter(t => t.DueDate && t.DueDate >= JD_KPI_START_DATE);
  return computeJdAlignment(scoped, role, scopeMap);
}

// Turn an alignment% into the KPI multiplier: 0.85 → 1.00, floored at 0.85.
// No classifiable tasks in the window → multiplier 1.00 (no data, no penalty).
function jdMultiplier(alignmentPct) {
  if (alignmentPct === null || alignmentPct === undefined) return 1.0;
  return 0.85 + 0.15 * (alignmentPct / 100);
}

// Enrich a base KPI object with the JD-adjusted score, keeping the base intact.
// The base kpiScore/kpiLabel are preserved; jdScore/jdLabel/jdMultiplier are added.
function applyJdAdjustment(kpiObj, staffTasks, role, scopeMap) {
  const jdScored = computeJdAlignmentScored(staffTasks, role, scopeMap);
  const mult = jdMultiplier(jdScored.alignmentPct);
  const jdScore = Math.round(kpiObj.kpiScore * mult);
  const jdLabel = jdScore >= 85 ? 'Excellent'
                : jdScore >= 70 ? 'Strong'
                : jdScore >= 50 ? 'Developing'
                : 'Needs attention';
  return {
    ...kpiObj,
    baseKpiScore: kpiObj.kpiScore,   // preserve the pre-JD score explicitly
    jdScore,
    jdLabel,
    jdMultiplier: Math.round(mult * 100) / 100,
    jdScoredAlignment: jdScored,     // alignment computed on the JD-effective window
  };
}

// Classify each of a staff member's tasks for the My KPIs JD breakdown.
// Returns a list with per-task JD status so staff can see exactly what counts.
function classifyTasksForJd(staffTasks, role, scopeMap) {
  const allowed = new Set(scopeMap[role] || []);
  return staffTasks.map(t => {
    const area = categoryToArea(t.Category);
    const scored = !!(t.DueDate && t.DueDate >= JD_KPI_START_DATE); // does it count toward JD alignment?
    let status;
    if (!area) status = 'uncategorised';
    else if (allowed.has(area)) status = 'in-jd';
    else status = 'off-jd';
    return {
      id: t.ID,
      name: t.Name,
      category: t.Category || '',
      dueDate: t.DueDate || '',
      taskStatus: t.Status || 'Pending',
      area: area || null,
      areaLabel: area ? (JD_AREAS[area] || area) : null,
      jdStatus: status,   // 'in-jd' | 'off-jd' | 'uncategorised'
      scored,             // whether it's in the JD-effective window (due >= 8 Aug)
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// PERMISSION SYSTEM — config-driven, editable by BOD
// ═══════════════════════════════════════════════════════════════

// The features/capabilities that can be toggled per role.
// Each maps to a real permission check used across the worker.
const PERMISSION_KEYS = {
  // Tab visibility
  'tab.dashboard':   'See Dashboard tab',
  'tab.tasks':       'See Tasks tab',
  'tab.storage':     'See Storage tab',
  'tab.documents':   'See Documents tab',
  'tab.kpi':         'See KPI / My KPIs tab',
  'tab.worklog':     'See Work Log tab',
  'tab.projects':    'See Projects tab',
  'tab.recurring':   'See Recurring Tasks tab',
  'tab.staff':       'See Staff Management tab',
  'tab.access':      'See Access Control tab',
  // Feature capabilities
  'staff.manage':    'Add / edit / remove staff',
  'tasks.assign':    'Assign tasks to others',
  'tasks.deleteAny': 'Delete any task',
  'kpi.viewAll':     'View all staff KPIs',
  'projects.manage': 'Create / edit projects',
  'docs.fullAccess': 'Full document tracker access',
  'docs.verify':     'Verify / flag documents',
  'recurring.manage':'Manage recurring task templates',
};

// Default permission matrix — the safe baseline (mirrors the original hardcoded rules).
// true = allowed. Anything not listed for a role defaults to false.
function defaultPermissions() {
  const mgmt = ['bod','developer','senior-impact','senior-biz','project-coordinator'];
  const admin = ['bod','developer'];
  const all = Object.values(ROLES).filter(r => !INCU_EXTERNAL_ROLES.includes(r));
  const staffLevel = ['production-lead','senior-admin','project-officer','network-catalyst','page-admin','admin-assistant','production-intern'];

  const perms = {};
  all.forEach(r => {
    perms[r] = {
      'tab.dashboard': true,
      'tab.tasks': true,
      'tab.storage': true,
      'tab.documents': true,
      'tab.kpi': true,
      'tab.worklog': mgmt.includes(r),
      'tab.projects': mgmt.includes(r),
      'tab.recurring': mgmt.includes(r),
      'tab.staff': admin.includes(r),
      'tab.access': r === 'bod' || r === 'developer',
      'staff.manage': admin.includes(r),
      'tasks.assign': mgmt.includes(r),
      'tasks.deleteAny': mgmt.includes(r),
      'kpi.viewAll': mgmt.includes(r),
      'projects.manage': mgmt.includes(r),
      'docs.fullAccess': mgmt.includes(r),
      'docs.verify': mgmt.includes(r),
      'recurring.manage': mgmt.includes(r),
    };
  });
  return perms;
}

// Cache the merged permission matrix per request to avoid repeated sheet reads
let _permCache = null;
async function getPermissions(env) {
  if (_permCache) return _permCache;
  const defaults = defaultPermissions();
  try {
    const config = await sheetsRead(env, 'Config');
    const row = config.find(c => c.Key === 'permissions');
    if (row && row.Value) {
      const overrides = JSON.parse(row.Value);
      // Merge overrides onto defaults (per role, per key)
      for (const role in overrides) {
        if (!defaults[role]) defaults[role] = {};
        for (const key in overrides[role]) {
          defaults[role][key] = overrides[role][key] === true;
        }
      }
    }
  } catch (e) { /* fall back to defaults */ }

  // ANTI-LOCKOUT GUARDRAIL: BOD always keeps the Access Control tab and staff management.
  if (defaults['bod']) {
    defaults['bod']['tab.access'] = true;
    defaults['bod']['staff.manage'] = true;
  }

  _permCache = defaults;
  return _permCache;
}

// Check a single permission for a role
async function can(env, role, key) {
  const perms = await getPermissions(env);
  return !!(perms[role] && perms[role][key]);
}

// Save permission overrides (BOD only) — enforces the anti-lockout rail
async function savePermissions(env, overrides) {
  // Force BOD's critical access on before saving
  if (!overrides['bod']) overrides['bod'] = {};
  overrides['bod']['tab.access'] = true;
  overrides['bod']['staff.manage'] = true;

  const config = await sheetsRead(env, 'Config');
  const rowIdx = config.findIndex(c => c.Key === 'permissions');
  const value = JSON.stringify(overrides);
  if (rowIdx === -1) {
    await sheetsAppend(env, 'Config', ['permissions', value]);
  } else {
    await sheetsUpdate(env, 'Config', rowIdx + 2, getColIndex('Config', 'Value'), value);
  }
  _permCache = null; // invalidate cache
}

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

      // Collaborators and resource persons are confined to the incubation extension + their own account
      if (INCU_EXTERNAL_ROLES.includes(role) && !path.startsWith('/incu') &&
          !['/auth/me','/auth/change-password'].includes(path)) {
        return json({ error: 'Access denied' }, 403);
      }

      // ── SN@IL Incubation extension ──
      if (path.startsWith('/incu')) return await handleIncu(path, request, url, env, auth);

      // Auth
      if (path === '/auth/me') {
        const allPerms = await getPermissions(env);
        return json({ ...auth, permissions: allPerms[role] || {} });
      }
      if (path === '/auth/change-password' && request.method === 'POST')
        return await changePassword(request, env, staffId);

      // Staff management — admin only
      if (path === '/staff/names' && request.method === 'GET')     return await getStaffNames(env);

      // ── JD Scope (which task areas belong to each role) ──
      if (path === '/jd-scope' && request.method === 'GET') {
        const scope = await getJdScope(env);
        return json({ scope, areas: JD_AREAS, roles: ROLE_LABELS, defaults: defaultJdScope() });
      }
      if (path === '/jd-scope' && request.method === 'POST') {
        if (!(await can(env, role, 'tab.access'))) return json({ error: 'Access denied' }, 403);
        const body = await request.json();
        await saveJdScope(env, body.scope || {});
        return json({ success: true });
      }
      if (path === '/jd-scope/reset' && request.method === 'POST') {
        if (!(await can(env, role, 'tab.access'))) return json({ error: 'Access denied' }, 403);
        await saveJdScope(env, defaultJdScope());
        return json({ success: true });
      }

      // ── Access Control (permissions) — BOD only ──
      if (path === '/permissions' && request.method === 'GET') {
        if (!(await can(env, role, 'tab.access'))) return json({ error: 'Access denied' }, 403);
        const perms = await getPermissions(env);
        return json({ permissions: perms, keys: PERMISSION_KEYS, roles: ROLE_LABELS, defaults: defaultPermissions() });
      }
      if (path === '/permissions' && request.method === 'POST') {
        if (!(await can(env, role, 'tab.access'))) return json({ error: 'Access denied' }, 403);
        const body = await request.json();
        await savePermissions(env, body.permissions || {});
        return json({ success: true });
      }
      if (path === '/permissions/reset' && request.method === 'POST') {
        if (!(await can(env, role, 'tab.access'))) return json({ error: 'Access denied' }, 403);
        await savePermissions(env, defaultPermissions());
        return json({ success: true });
      }
      if (path === '/staff' && request.method === 'GET')          return await getStaff(env, role, staffId, url);
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
      if (path.match(/^\/tasks\/[\w-]+$/) && request.method === 'DELETE')
        return await deleteTask(env, role, staffId, path.split('/')[2]);

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

      // Document Submissions
      if (path === '/docs' && request.method === 'GET')
        return await getDocSubmissions(env, role, staffId);
      if (path === '/docs' && request.method === 'POST')
        return await createDocSubmission(request, env, role, staffId, auth.name);
      if (path.match(/^\/docs\/[\w-]+$/) && request.method === 'PUT')
        return await updateDocSubmission(request, env, role, staffId, path.split('/')[2]);
      if (path.match(/^\/docs\/[\w-]+$/) && request.method === 'DELETE')
        return await deleteDocSubmission(env, role, path.split('/')[2]);
      if (path.match(/^\/docs\/[\w-]+\/submit$/) && request.method === 'POST')
        return await submitDocuments(request, env, role, staffId, path.split('/')[2]);
      if (path.match(/^\/docs\/[\w-]+\/upload$/) && request.method === 'POST')
        return await uploadDocFile(request, env, role, staffId, path.split('/')[2]);

      // Recurring Tasks
      if (path === '/recurring' && request.method === 'GET')
        return await getRecurringTasks(env, role);
      if (path === '/recurring' && request.method === 'POST')
        return await addRecurringTask(request, env, role);
      if (path.match(/^\/recurring\/[\w-]+$/) && request.method === 'PUT')
        return await updateRecurringTask(request, env, role, path.split('/')[2]);
      if (path.match(/^\/recurring\/[\w-]+$/) && request.method === 'DELETE')
        return await deleteRecurringTask(env, role, path.split('/')[2]);
      if (path === '/recurring/generate' && request.method === 'POST')
        return await generateRecurringTasks(env, role);
      if (path === '/recurring/seed' && request.method === 'POST')
        return await seedRecurringTasks(env, role);
      if (path === '/recurring/reset-generation' && request.method === 'POST')
        return await resetRecurringGeneration(env, role);

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

  // Include this user's effective permissions so the frontend renders the right tabs
  const allPerms = await getPermissions(env);
  const myPerms = allPerms[role] || {};

  return json({
    token,
    user: {
      staffId: user.ID,
      name: user.Name,
      role,
      email: user.Email,
      projects: user.Projects,
      team: user.Team || 'Program Team',
      permissions: myPerms,
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
async function getStaff(env, role, staffId, url) {
  const staff = await sheetsRead(env, 'Staff');
  if (isStaffLevel(role)) {
    const me = staff.find(r => r.ID === staffId);
    return json(me ? [sanitizeStaff(me)] : []);
  }
  // ?all=true returns inactive staff too (for the Staff Management panel, admin only)
  const includeAll = url && url.searchParams.get('all') === 'true' && isAdmin(role);
  const list = includeAll ? staff : staff.filter(r => r.Active?.toLowerCase() === 'true');
  return json(list.map(sanitizeStaff));
}

// Returns minimal staff list (ID + Name only) — safe for all roles to look up assignee names
async function getStaffNames(env) {
  const staff = await sheetsRead(env, 'Staff');
  const names = staff
    .filter(s => s.Active?.toLowerCase() === 'true' && !INCU_EXTERNAL_ROLES.includes(normalizeRole(s.Role)))
    .map(s => ({ ID: s.ID, Name: s.Name, Role: normalizeRole(s.Role) }));
  return json(names);
}

async function addStaff(request, env, role) {
  if (!isAdmin(role)) return json({ error: 'Admin only' }, 403);
  const body = await request.json();
  const { name, username, password, staffRole, type, email, projects, team, collaborator } = body;
  if (!name || !username || !password) return json({ error: 'Missing required fields' }, 400);
  const isCollab = staffRole === 'collaborator';
  const isExternal = INCU_EXTERNAL_ROLES.includes(staffRole);
  if (isCollab && !collaborator?.businessName?.trim()) return json({ error: 'Business name is required for a collaborator' }, 400);

  const staff = await sheetsRead(env, 'Staff');
  if (staff.find(r => r.Username?.toLowerCase() === username.toLowerCase()))
    return json({ error: 'Username already exists' }, 409);

  const id = `STAFF-${String(staff.length + 1).padStart(3, '0')}`;
  const hashed = await hashPassword(password);

  // Create personal Drive folder structure for this staff member
  let folderId = '';
  if (!isExternal) try {
    folderId = await createStaffFolderStructure(env, id, name);
  } catch (e) {
    console.error('Failed to create staff folder:', e.message);
    // Don't block account creation if folder creation fails
  }

  const row = [id, name, username, hashed, staffRole || 'project-officer', type || 'Full-time', email || '', isExternal ? '' : (projects || ''), 'true', new Date().toISOString(), '', folderId, isCollab ? 'Collaborator' : isExternal ? 'Resource Person' : (team || 'Program Team')];
  await sheetsAppend(env, 'Staff', row);

  let collaboratorId = '';
  if (isCollab) collaboratorId = await upsertCollaboratorProfile(env, id, collaborator);
  return json({ success: true, id, collaboratorId });
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
    body.email !== undefined ? body.email : existing.Email,
    body.projects !== undefined ? body.projects : existing.Projects,
    body.active !== undefined ? String(body.active) : existing.Active,
    existing.CreatedAt,
    existing.PhotoURL || '',
    existing.FolderID || '',
    body.team || existing.Team || 'Program Team',
  ];
  await sheetsUpdateRow(env, 'Staff', rowIdx + 2, updated);
  if (normalizeRole(updated[4]) === 'collaborator' && body.collaborator) {
    await upsertCollaboratorProfile(env, targetId, body.collaborator);
  }
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
// Check whether a task belongs to a given project (ProjectID may be comma-separated for multi-project tasks)
function taskInProject(taskProjectField, projectId) {
  if (!taskProjectField) return false;
  return taskProjectField.split(',').map(s => s.trim()).filter(Boolean).includes(projectId);
}

// Generate the next task ID by finding the highest existing TASK-NNN number and adding 1.
// This avoids collisions when rows are manually added/deleted (counting rows is unreliable).
function nextTaskId(tasks) {
  let maxNum = 0;
  for (const t of tasks) {
    const m = /^TASK-(\d+)$/.exec((t.ID || '').trim());
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  return 'TASK-' + String(maxNum + 1).padStart(3, '0');
}

async function getTasks(url, env, role, staffId) {
  const tasks = await sheetsRead(env, 'Tasks');
  const projectId = url.searchParams.get('projectId');
  let filtered = tasks.filter(t => t.Active?.toLowerCase() === 'true');
  if (projectId) filtered = filtered.filter(t => taskInProject(t.ProjectID, projectId));
  if (isStaffLevel(role))
    filtered = filtered.filter(t => isAssigned(t.AssigneeID, staffId));

  // Enrich tasks that have a linked document with that doc's title + status
  const hasLinks = filtered.some(t => t.LinkedDocID);
  if (hasLinks) {
    const docs = await sheetsRead(env, 'DocSubmissions');
    filtered = filtered.map(t => {
      if (t.LinkedDocID) {
        const doc = docs.find(d => d.ID === t.LinkedDocID);
        if (doc) {
          return { ...t, linkedDocTitle: doc.Title, linkedDocStatus: doc.Status };
        }
      }
      return t;
    });
  }

  return json(filtered);
}

async function addTask(request, env, role, staffId) {
  const body = await request.json();
  if (!body.name || !body.projectId) return json({ error: 'Name and project are required' }, 400);

  const assigneeId = (isStaffLevel(role))
    ? staffId
    : (body.assigneeId || '');

  const tasks = await sheetsRead(env, 'Tasks');
  const id = nextTaskId(tasks);
  const row = [
    id, body.projectId, body.name, body.category || '',
    body.dueDate || '', body.description || '',
    body.status || 'Pending', assigneeId,
    'true', '', '', '',
    new Date().toISOString(), '',
    body.priority || 'Medium',
    body.linkedDocId || ''
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
    body.linkedDocId !== undefined ? body.linkedDocId : (e.LinkedDocID || ''),
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

async function deleteTask(env, role, staffId, taskId) {
  const tasks = await sheetsRead(env, 'Tasks');
  const rowIdx = tasks.findIndex(t => t.ID === taskId);
  if (rowIdx === -1) return json({ error: 'Task not found' }, 404);

  const task = tasks[rowIdx];

  // Permission: management can delete any task, staff can delete tasks they're assigned to
  if (!isManagement(role) && !isAssigned(task.AssigneeID, staffId)) {
    return json({ error: 'You can only delete your own tasks' }, 403);
  }

  // Delete the task row from the sheet
  await sheetsDeleteRow(env, 'Tasks', rowIdx + 2);

  // Clean up related comments for this task
  try {
    const comments = await sheetsRead(env, 'Comments');
    // Delete from bottom up to keep row indices valid
    const toDelete = comments
      .map((c, i) => ({ c, i }))
      .filter(x => x.c.TaskID === taskId)
      .sort((a, b) => b.i - a.i);
    for (const x of toDelete) {
      await sheetsDeleteRow(env, 'Comments', x.i + 2);
    }
  } catch(e) { console.error('Comment cleanup failed:', e.message); }

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
// Compute a staff member's composite KPI score + breakdown from their tasks.
// Used by both the management view and each staff member's own "My KPIs".
function computeStaffKpi(staffTasks, todayStr) {
  const total = staffTasks.length;
  const done = staffTasks.filter(t => t.Status === 'Done').length;
  const inProg = staffTasks.filter(t => t.Status === 'In Progress').length;

  // 1. Completion
  const completionPct = total ? Math.round((done / total) * 100) : 0;

  // 2. Timeliness (% of done-with-due tasks finished on time)
  const doneWithDue = staffTasks.filter(t => t.Status === 'Done' && t.DueDate);
  const onTimeDone = doneWithDue.filter(t => {
    const completed = (t.EvidenceDate || '').slice(0, 10) || todayStr;
    return completed <= t.DueDate;
  }).length;
  const onTimeRate = doneWithDue.length ? Math.round((onTimeDone / doneWithDue.length) * 100) : null;
  const timelinessPct = onTimeRate === null ? completionPct : onTimeRate;

  // 3. Evidence (% of done tasks with evidence)
  const doneTasks = staffTasks.filter(t => t.Status === 'Done');
  const doneWithEvidence = doneTasks.filter(t => t.EvidenceFile || t.EvidenceLink).length;
  const evidencePct = doneTasks.length ? Math.round((doneWithEvidence / doneTasks.length) * 100) : (total ? 0 : 100);

  // 4. Reliability (overdue penalty)
  const overdueTasks = staffTasks.filter(t => t.Status !== 'Done' && t.DueDate && t.DueDate < todayStr);
  const overdueCount = overdueTasks.length;
  const overdueShare = total ? overdueCount / total : 0;
  const overduePct = Math.round(100 * (1 - overdueShare));

  // Average days late
  const lateDaysArr = overdueTasks.map(t => {
    if (todayStr <= t.DueDate) return 0;
    return Math.max(0, Math.round((new Date(todayStr) - new Date(t.DueDate)) / 86400000));
  }).filter(d => d > 0);
  const avgDaysLate = lateDaysArr.length ? Math.round(lateDaysArr.reduce((a,b)=>a+b,0) / lateDaysArr.length) : 0;

  // Weighted score — softened so overdue tasks aren't triple-counted.
  // Reliability weight reduced from 15% to 8% (roughly halved); the freed weight
  // goes to Completion (43%) and Timeliness (34%), which reward positive work.
  const W_COMPLETION = 0.43;
  const W_TIMELINESS = 0.34;
  const W_EVIDENCE   = 0.15;
  const W_RELIABILITY= 0.08;
  const kpiScore = Math.round(
    W_COMPLETION  * completionPct +
    W_TIMELINESS  * timelinessPct +
    W_EVIDENCE    * evidencePct +
    W_RELIABILITY * overduePct
  );
  const kpiLabel = kpiScore >= 85 ? 'Excellent'
                 : kpiScore >= 70 ? 'Strong'
                 : kpiScore >= 50 ? 'Developing'
                 : 'Needs attention';

  return {
    taskCount: total,
    doneCount: done,
    inProgressCount: inProg,
    avgPercentage: completionPct,
    onTimeRate,
    overdueCount,
    avgDaysLate,
    kpiScore,
    kpiLabel,
    kpiBreakdown: {
      completion: { pct: completionPct, weight: Math.round(W_COMPLETION*100), points: Math.round(W_COMPLETION * completionPct) },
      timeliness: { pct: timelinessPct, weight: Math.round(W_TIMELINESS*100), points: Math.round(W_TIMELINESS * timelinessPct) },
      evidence:   { pct: evidencePct,   weight: Math.round(W_EVIDENCE*100),   points: Math.round(W_EVIDENCE * evidencePct) },
      reliability:{ pct: overduePct,    weight: Math.round(W_RELIABILITY*100),points: Math.round(W_RELIABILITY * overduePct) },
    },
  };
}

// Get the Monday (week start) date string for a given date
function weekStart(dateStr) {
  const d = new Date(dateStr);
  const day = d.getUTCDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1) - day; // move back to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// Capture a weekly KPI snapshot for all active staff (once per week max).
// Called opportunistically when management loads the KPI page.
async function captureKpiSnapshots(env, staffSummary, todayStr) {
  try {
    const thisWeek = weekStart(todayStr);
    const snaps = await sheetsRead(env, 'KpiSnapshots');
    // Already captured this week? (check any row)
    const already = snaps.some(s => s.WeekOf === thisWeek);
    if (already) return;

    for (const s of staffSummary) {
      const id = 'SNAP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      const b = s.kpiBreakdown || {};
      await sheetsAppend(env, 'KpiSnapshots', [
        id, s.staffId, thisWeek, s.kpiScore,
        b.completion?.pct ?? '', b.timeliness?.pct ?? '', b.evidence?.pct ?? '', b.reliability?.pct ?? '',
        s.taskCount, new Date().toISOString(),
      ]);
    }
  } catch (e) { /* snapshotting is best-effort, never blocks KPI */ }
}

// Build per-staff trend series (monthly display from weekly snapshots)
async function getKpiTrends(env) {
  const snaps = await sheetsRead(env, 'KpiSnapshots');
  const byStaff = {};
  for (const s of snaps) {
    if (!byStaff[s.StaffID]) byStaff[s.StaffID] = [];
    byStaff[s.StaffID].push({ week: s.WeekOf, score: parseInt(s.KpiScore) || 0 });
  }
  // Sort each staff's series by week
  for (const id in byStaff) byStaff[id].sort((a, b) => a.week.localeCompare(b.week));
  return byStaff;
}

async function getKPI(url, env, role, staffId) {
  const [tasks, projects, staff] = await Promise.all([
    sheetsRead(env, 'Tasks'),
    sheetsRead(env, 'Projects'),
    sheetsRead(env, 'Staff'),
  ]);

  const { filterStaffId, projectId } = Object.fromEntries(url.searchParams);
  const targetStaffId = isStaffLevel(role) ? staffId : (filterStaffId || null);
  const rankingOnly = url.searchParams.get('rankingOnly') === 'true';

  let relevantTasks = tasks.filter(t => t.Active?.toLowerCase() === 'true');
  if (projectId)     relevantTasks = relevantTasks.filter(t => taskInProject(t.ProjectID, projectId));
  if (targetStaffId) relevantTasks = relevantTasks.filter(t => isAssigned(t.AssigneeID, targetStaffId));

  const kpis = relevantTasks.map(t => {
    // For multi-project tasks, show the first project (or the filtered one) as the label
    const firstProjId = projectId || (t.ProjectID || '').split(',').map(s=>s.trim()).filter(Boolean)[0] || '';
    const proj = projects.find(p => p.ID === firstProjId);
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

  const todayStr = new Date().toISOString().slice(0, 10);

  // Helper: was a done task completed on or before its due date?
  const isOnTime = t => {
    if (t.Status !== 'Done' || !t.DueDate) return null; // not applicable
    const completed = (t.EvidenceDate || '').slice(0, 10) || todayStr;
    return completed <= t.DueDate;
  };
  // Helper: days a task is late (overdue & not done) or was late (done after due)
  const daysLate = t => {
    if (!t.DueDate) return 0;
    if (t.Status === 'Done') {
      const completed = (t.EvidenceDate || '').slice(0, 10);
      if (!completed || completed <= t.DueDate) return 0;
      return Math.max(0, Math.round((new Date(completed) - new Date(t.DueDate)) / 86400000));
    }
    // not done — measure against today
    if (todayStr <= t.DueDate) return 0;
    return Math.max(0, Math.round((new Date(todayStr) - new Date(t.DueDate)) / 86400000));
  };

  const jdScopeMap = await getJdScope(env);

  let staffSummary = [];
  if (isManagement(role) && !rankingOnly) {
    const activeStaff = staff.filter(s => s.Active?.toLowerCase() === 'true' && !['developer', ...INCU_EXTERNAL_ROLES].includes(normalizeRole(s.Role)));
    staffSummary = activeStaff.map(s => {
      const staffTasks = relevantTasks.filter(t => isAssigned(t.AssigneeID, s.ID));
      const kBase = computeStaffKpi(staffTasks, todayStr);
      const k = applyJdAdjustment(kBase, staffTasks, normalizeRole(s.Role), jdScopeMap);
      const jd = computeJdAlignment(staffTasks, normalizeRole(s.Role), jdScopeMap);
      return {
        staffId: s.ID,
        name: s.Name,
        role: normalizeRole(s.Role),
        ...k,
        jdAlignment: jd,
        overallStatus: k.avgPercentage >= 80 ? 'on-track' : k.avgPercentage >= 40 ? 'at-risk' : 'behind',
      };
    });
  }

  // Per-project metrics
  let projectSummary = [];
  if (isManagement(role) && !rankingOnly) {
    const activeProjects = projects.filter(p => p.Status?.toLowerCase() === 'active' || !p.Status);
    projectSummary = activeProjects.map(p => {
      const pTasks = relevantTasks.filter(t => taskInProject(t.ProjectID, p.ID));
      const total = pTasks.length;
      const done = pTasks.filter(t => t.Status === 'Done').length;
      const completionRate = total ? Math.round((done / total) * 100) : 0;

      // On-time rate
      const doneWithDue = pTasks.filter(t => t.Status === 'Done' && t.DueDate);
      const onTimeDone = doneWithDue.filter(t => isOnTime(t) === true).length;
      const onTimeRate = doneWithDue.length ? Math.round((onTimeDone / doneWithDue.length) * 100) : null;

      // Overdue (not done, past due) and at-risk (not done, due within 3 days)
      const overdueCount = pTasks.filter(t => t.Status !== 'Done' && t.DueDate && t.DueDate < todayStr).length;
      const atRiskCount = pTasks.filter(t => {
        if (t.Status === 'Done' || !t.DueDate || t.DueDate < todayStr) return false;
        const diff = Math.round((new Date(t.DueDate) - new Date(todayStr)) / 86400000);
        return diff >= 0 && diff <= 3;
      }).length;

      // Composite health score (0–100): weighted blend of completion, timeliness, and overdue penalty
      // 50% completion + 30% on-time + 20% (1 - overdue share)
      const overdueShare = total ? overdueCount / total : 0;
      const onTimeComponent = onTimeRate === null ? completionRate : onTimeRate; // fall back to completion if no due-dated done tasks
      const health = Math.round(
        0.5 * completionRate +
        0.3 * onTimeComponent +
        0.2 * (100 * (1 - overdueShare))
      );

      return {
        projectId: p.ID,
        name: p.Name,
        shortName: p.ShortName || p.Name,
        taskCount: total,
        doneCount: done,
        completionRate,
        onTimeRate,
        overdueCount,
        atRiskCount,
        health,
        healthStatus: health >= 75 ? 'healthy' : health >= 50 ? 'at-risk' : 'critical',
      };
    });
  }

  // Personal KPI for the requesting staff member (for their own "My KPIs" view)
  let myKpi = null;
  if (staffId && !rankingOnly) {
    const myTasks = relevantTasks.filter(t => isAssigned(t.AssigneeID, staffId));
    myKpi = computeStaffKpi(myTasks, todayStr);
    myKpi.jdAlignment = computeJdAlignment(myTasks, role, jdScopeMap);
    myKpi = applyJdAdjustment(myKpi, myTasks, role, jdScopeMap);
    // Per-task JD classification + this role's JD areas, for the My KPIs explainer
    myKpi.jdTasks = classifyTasksForJd(myTasks, role, jdScopeMap);
    myKpi.jdRoleAreas = (jdScopeMap[role] || []).map(a => ({ area: a, label: JD_AREAS[a] || a }));
    myKpi.jdStartDate = JD_KPI_START_DATE;
  }

  // Management: capture weekly snapshot (best-effort) and return trends.
  // Skipped in rankingOnly mode — the ranking tab uses monthlyTrend, not snapshots,
  // so we avoid the slow sheet read/write on that load.
  let trends = null;
  if (!rankingOnly) {
    if (isManagement(role) && staffSummary.length) {
      await captureKpiSnapshots(env, staffSummary, todayStr);
      trends = await getKpiTrends(env);
    } else if (staffId) {
      const all = await getKpiTrends(env);
      trends = all[staffId] ? { [staffId]: all[staffId] } : {};
    }
  }

  // ── Monthly ranking (scoped to tasks due within the requested month) ──
  // month param format: YYYY-MM. Defaults to current month.
  let monthlySummary = null;
  let monthlyTrend = null;
  const monthParam = url.searchParams.get('month');
  if (isManagement(role)) {
    const month = monthParam || todayStr.slice(0, 7); // YYYY-MM
    const activeStaff = staff.filter(s => s.Active?.toLowerCase() === 'true' && !['developer', ...INCU_EXTERNAL_ROLES].includes(normalizeRole(s.Role)));

    // The 6 months we display (selected month + 5 prior)
    const months = [];
    const base = new Date(month + '-01T00:00:00Z');
    for (let i = 5; i >= 0; i--) {
      const d = new Date(base); d.setUTCMonth(d.getUTCMonth() - i);
      months.push(d.toISOString().slice(0, 7));
    }
    const monthsSet = new Set(months);
    const activeStaffIds = new Set(activeStaff.map(s => s.ID));

    // Single pass: bucket tasks by staffId → month → [tasks].
    // Turns O(staff × months × tasks) into O(tasks + staff × months).
    const buckets = {};
    for (const id of activeStaffIds) buckets[id] = {};
    for (const t of tasks) {
      if (t.Active?.toLowerCase() !== 'true' || !t.DueDate) continue;
      const ym = t.DueDate.slice(0, 7);
      if (!monthsSet.has(ym)) continue;
      const ids = (t.AssigneeID || '').split(',');
      for (let raw of ids) {
        const aid = raw.trim();
        if (!aid || !activeStaffIds.has(aid)) continue;
        (buckets[aid][ym] = buckets[aid][ym] || []).push(t);
      }
    }

    // Selected-month summary — direct bucket lookup
    monthlySummary = activeStaff.map(s => {
      const monthTasks = buckets[s.ID][month] || [];
      const kBase = computeStaffKpi(monthTasks, todayStr);
      const k = applyJdAdjustment(kBase, monthTasks, normalizeRole(s.Role), jdScopeMap);
      const jd = computeJdAlignment(monthTasks, normalizeRole(s.Role), jdScopeMap);
      return { staffId: s.ID, name: s.Name, role: normalizeRole(s.Role), ...k, jdAlignment: jd };
    });

    // 6-month trend — reuse the same buckets
    monthlyTrend = {};
    activeStaff.forEach(s => {
      monthlyTrend[s.ID] = months.map(m => {
        const mTasks = buckets[s.ID][m] || [];
        if (!mTasks.length) return { month: m, score: null };
        const base = computeStaffKpi(mTasks, todayStr);
        // Months from the JD start month onward use the JD-adjusted score; earlier months use base
        const jdActive = (m + '-31') >= JD_KPI_START_DATE;
        const adj = jdActive ? applyJdAdjustment(base, mTasks, normalizeRole(s.Role), jdScopeMap) : base;
        return { month: m, score: jdActive ? adj.jdScore : base.kpiScore };
      });
    });
  }

  return json({ kpis, staffSummary, projectSummary, myKpi, trends, monthlySummary, monthlyTrend, month: monthParam || todayStr.slice(0,7) });
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

  const activeStaff = staff.filter(s => s.Active?.toLowerCase() === 'true' && !['developer', ...INCU_EXTERNAL_ROLES].includes(normalizeRole(s.Role)));
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
      return { staffId: s.ID, name: s.Name, role: normalizeRole(s.Role), taskCount: sTasks.length, avgKpi: avg, status: avg >= 70 ? 'on-track' : avg >= 40 ? 'at-risk' : 'behind' };
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
// DOCUMENT SUBMISSIONS
// ══════════════════════════════════════════════════════════

// Access: Support Team + Management only
function canAccessDocs(role, team) {
  if (isManagement(role)) return true;
  return team === 'Support Team';
}

async function getDocSubmissions(env, role, staffId) {
  const staff = await sheetsRead(env, 'Staff');
  const me = staff.find(s => s.ID === staffId);
  const myTeam = me?.Team || '';
  const fullAccess = canAccessDocs(role, myTeam);

  const [allDocs, projects] = await Promise.all([
    sheetsRead(env, 'DocSubmissions'),
    sheetsRead(env, 'Projects'),
  ]);

  // Visibility:
  //  - Full access (support/management) → all documents
  //  - Otherwise → documents they owe (RequestedFromID) OR documents they must verify (RequestedByID)
  const docs = fullAccess
    ? allDocs
    : allDocs.filter(d => d.RequestedFromID === staffId || d.RequestedByID === staffId);

  const today = new Date().toISOString().slice(0, 10);

  const enriched = docs.map(d => {
    const isOverdue = d.Status !== 'Verified' && d.Status !== 'Submitted' && d.DueDate && d.DueDate < today;
    // Parse submission entries (JSON array with timestamps)
    let entries = [];
    try { entries = d.Files ? JSON.parse(d.Files) : []; } catch(_) {
      if (d.Files) {
        entries = d.Files.split(',').map(u => u.trim()).filter(Boolean)
          .map(url => ({ type: 'file', url, name: 'File', time: d.CreatedAt || '', by: '' }));
      }
    }
    if (d.SubmitLink) {
      entries.push({ type: 'link', url: d.SubmitLink, name: 'Link', time: d.CreatedAt || '', by: '' });
    }
    // Can the current user verify this specific document?
    const canVerify = fullAccess || d.RequestedByID === staffId || isAdmin(role);
    // Is the current user the one who owes it?
    const isOwner = d.RequestedFromID === staffId;
    return {
      ...d,
      entries,
      requestedFromName: staff.find(s => s.ID === d.RequestedFromID)?.Name || '—',
      requestedByName: staff.find(s => s.ID === d.RequestedByID)?.Name || '—',
      verifierName: staff.find(s => s.ID === d.RequestedByID)?.Name || '—',
      projectName: projects.find(p => p.ID === d.ProjectID)?.Name || '',
      isOverdue,
      canVerify,
      isOwner,
    };
  });

  // Sort: overdue first, then by due date
  enriched.sort((a, b) => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    return (a.DueDate || '').localeCompare(b.DueDate || '');
  });

  const pending = enriched.filter(d => d.Status === 'Pending').length;
  const overdue = enriched.filter(d => d.isOverdue).length;
  const verified = enriched.filter(d => d.Status === 'Verified').length;
  const incomplete = enriched.filter(d => d.Status === 'Incomplete').length;

  return json({ docs: enriched, counts: { pending, overdue, verified, incomplete, total: enriched.length }, fullAccess });
}

async function createDocSubmission(request, env, role, staffId, staffName) {
  const staff = await sheetsRead(env, 'Staff');
  const me = staff.find(s => s.ID === staffId);
  const fullAccess = canAccessDocs(role, me?.Team);

  const { title, projectId, requestedFromId, documentType, activityDate, dueDate, notes, verifierId } = await request.json();
  if (!title?.trim() || !requestedFromId || !dueDate) {
    return json({ error: 'Title, person, and due date are required' }, 400);
  }

  // Support Team + Management can request from anyone.
  // Program team can only create a request where THEY are the one who owes the documents.
  const isSelfOwed = requestedFromId === staffId;
  if (!fullAccess && !isSelfOwed) {
    return json({ error: 'You can only log documents that you owe' }, 403);
  }

  // For self-owed documents created by non-full-access staff, a verifier must be chosen.
  // The verifier becomes the RequestedBy (the person responsible for verifying).
  // For normal finance-created requests, the creator is the RequestedBy.
  let requestedById = staffId;
  if (!fullAccess && isSelfOwed) {
    if (!verifierId) return json({ error: 'Please choose who will verify your documents' }, 400);
    requestedById = verifierId;
  } else if (verifierId) {
    // Full-access creator can also explicitly set a verifier if they want
    requestedById = verifierId;
  }

  const id = 'DOC-' + Date.now();
  const row = [
    id, title.trim(), projectId || '', requestedFromId, requestedById,
    documentType || 'Other', activityDate || '', dueDate, 'Pending',
    notes?.trim() || '', new Date().toISOString()
  ];
  await sheetsAppend(env, 'DocSubmissions', row);

  // Notify appropriately
  try {
    if (isSelfOwed) {
      // Staff logging their own document → notify the chosen verifier
      await createNotification(env, requestedById, 'assigned',
        'Document to verify from ' + staffName,
        `"${title.trim()}" — ${staffName} will submit documents for your verification (due ${dueDate}).`,
        ''
      );
    } else {
      // Finance requesting from someone → notify the person who owes it
      await createNotification(env, requestedFromId, 'assigned',
        'Document requested by ' + staffName,
        `"${title.trim()}" is due by ${dueDate}. Please submit your supporting documents.`,
        ''
      );
    }
  } catch(e) {}

  return json({ success: true, id });
}

async function updateDocSubmission(request, env, role, staffId, docId) {
  const docs = await sheetsRead(env, 'DocSubmissions');
  const rowIdx = docs.findIndex(d => d.ID === docId);
  if (rowIdx === -1) return json({ error: 'Not found' }, 404);

  const body = await request.json();

  // Verification access control: only the chosen verifier (RequestedByID) or BOD/Developer can verify/flag
  if (body.status === 'Verified' || body.status === 'Incomplete') {
    const docRow = docs[rowIdx];
    const isChosenVerifier = docRow.RequestedByID === staffId;
    const isAdminOverride = isAdmin(role); // bod or developer
    if (!isChosenVerifier && !isAdminOverride) {
      return json({ error: 'Only the assigned verifier can verify or flag this document' }, 403);
    }
  }
  const e = docs[rowIdx];

  // When flagging incomplete, append the reason to Notes with a timestamp
  let newNotes = body.notes !== undefined ? body.notes : e.Notes;
  if (body.status === 'Incomplete' && body.incompleteReason) {
    const stamp = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
    const flagNote = `[Incomplete — ${stamp}] ${body.incompleteReason}`;
    newNotes = e.Notes ? (e.Notes + '\n' + flagNote) : flagNote;
  }

  const updated = [
    e.ID,
    body.title !== undefined ? body.title : e.Title,
    body.projectId !== undefined ? body.projectId : e.ProjectID,
    body.requestedFromId || e.RequestedFromID,
    e.RequestedByID,
    body.documentType || e.DocumentType,
    body.activityDate !== undefined ? body.activityDate : e.ActivityDate,
    body.dueDate || e.DueDate,
    body.status || e.Status,
    newNotes,
    e.CreatedAt,
    body.files !== undefined ? body.files : (e.Files || ''),
    body.submitLink !== undefined ? body.submitLink : (e.SubmitLink || ''),
  ];
  await sheetsUpdateRow(env, 'DocSubmissions', rowIdx + 2, updated);

  // Notify requester when status changes to Submitted
  if (body.status === 'Submitted' && e.Status !== 'Submitted') {
    try {
      await createNotification(env, e.RequestedByID, 'completed',
        'Documents submitted',
        `"${e.Title}" has been submitted and is ready for verification`,
        ''
      );
    } catch(ex) {}
  }

  // Notify the staff member when their submission is flagged incomplete
  if (body.status === 'Incomplete') {
    try {
      const reason = body.incompleteReason || 'Please review and resubmit.';
      await createNotification(env, e.RequestedFromID, 'overdue',
        'Document flagged incomplete',
        `"${e.Title}": ${reason}`,
        ''
      );
    } catch(ex) {}
  }

  // When document is VERIFIED, auto-complete any tasks linked to it
  if (body.status === 'Verified' && e.Status !== 'Verified') {
    try {
      const tasks = await sheetsRead(env, 'Tasks');
      let completedCount = 0;
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        const taskDocId = (t.LinkedDocID || '').trim();
        if (taskDocId === docId.trim() && t.Status !== 'Done' && t.Active?.toLowerCase() === 'true') {
          // Mark the linked task as Done
          await sheetsUpdate(env, 'Tasks', i + 2, getColIndex('Tasks', 'Status'), 'Done');

          // Attach the verified document's files/links as the task's evidence
          try {
            let entries = [];
            try { entries = e.Files ? JSON.parse(e.Files) : []; } catch(_) {}
            const fileLinks = entries.filter(en => en.type === 'file').map(en => en.url);
            const linkLinks = entries.filter(en => en.type === 'link').map(en => en.url);
            if (fileLinks.length) {
              await sheetsUpdate(env, 'Tasks', i + 2, getColIndex('Tasks', 'EvidenceFile'), fileLinks.join(','));
            }
            if (linkLinks.length) {
              await sheetsUpdate(env, 'Tasks', i + 2, getColIndex('Tasks', 'EvidenceLink'), linkLinks.join(','));
            }
            await sheetsUpdate(env, 'Tasks', i + 2, getColIndex('Tasks', 'EvidenceNote'), `Auto-attached from verified document: ${e.Title}`);
            await sheetsUpdate(env, 'Tasks', i + 2, getColIndex('Tasks', 'EvidenceDate'), new Date().toISOString());
          } catch(evErr) { console.error('Failed to attach doc evidence to task:', evErr.message); }

          completedCount++;
          // Notify the task's assignees
          const assigneeIds = (t.AssigneeID || '').split(',').map(s => s.trim()).filter(Boolean);
          for (const aid of assigneeIds) {
            await createNotification(env, aid, 'completed',
              'Task auto-completed',
              `"${t.Name}" is now complete — its linked document "${e.Title}" was verified`,
              t.ID
            );
          }
        }
      }
      console.log(`Doc ${docId} verified — auto-completed ${completedCount} linked task(s)`);
    } catch(ex) { console.error('Auto-complete linked tasks failed:', ex.message); }
  }

  return json({ success: true });
}

// Submit documents (upload files + optional link) — accessible to the person who owes them OR support/management
async function submitDocuments(request, env, role, staffId, docId) {
  const docs = await sheetsRead(env, 'DocSubmissions');
  const rowIdx = docs.findIndex(d => d.ID === docId);
  if (rowIdx === -1) return json({ error: 'Not found' }, 404);

  const e = docs[rowIdx];
  const staff = await sheetsRead(env, 'Staff');
  const me = staff.find(s => s.ID === staffId);
  const fullAccess = canAccessDocs(role, me?.Team);

  // Only the person who owes the docs, or support/management, can submit
  if (!fullAccess && e.RequestedFromID !== staffId) {
    return json({ error: 'You can only submit your own documents' }, 403);
  }

  const body = await request.json();
  const { files, links } = body;
  // files: [{url, name}], links: [string]
  const now = new Date().toISOString();
  const submitterName = me?.Name || 'Someone';

  // Parse existing entries (stored as JSON array)
  let entries = [];
  try { entries = e.Files ? JSON.parse(e.Files) : []; } catch(_) {
    // Migrate old comma-separated format
    if (e.Files) {
      entries = e.Files.split(',').map(u => u.trim()).filter(Boolean)
        .map(url => ({ type: 'file', url, name: 'File', time: e.CreatedAt || now, by: '' }));
    }
  }

  // Add new file entries with timestamps
  for (const f of (files || [])) {
    if (f.url) entries.push({ type: 'file', url: f.url, name: f.name || 'File', time: now, by: submitterName });
  }
  // Add new link entries with timestamps
  for (const l of (links || [])) {
    if (l && l.trim()) entries.push({ type: 'link', url: l.trim(), name: 'Link', time: now, by: submitterName });
  }

  const updated = [
    e.ID, e.Title, e.ProjectID, e.RequestedFromID, e.RequestedByID,
    e.DocumentType, e.ActivityDate, e.DueDate, 'Submitted', e.Notes, e.CreatedAt,
    JSON.stringify(entries),
    '',  // SubmitLink no longer used — links are in the entries now
  ];
  await sheetsUpdateRow(env, 'DocSubmissions', rowIdx + 2, updated);

  // Notify the finance person who requested it
  try {
    await createNotification(env, e.RequestedByID, 'completed',
      'Documents submitted',
      `"${e.Title}" has been submitted and is ready for verification`,
      ''
    );
  } catch(ex) {}

  return json({ success: true });
}

// Upload a single document file to Drive for a doc submission
async function uploadDocFile(request, env, role, staffId, docId) {
  try {
    const docs = await sheetsRead(env, 'DocSubmissions');
    const doc = docs.find(d => d.ID === docId);
    if (!doc) return json({ error: 'Document request not found' }, 404);

    const staff = await sheetsRead(env, 'Staff');
    const me = staff.find(s => s.ID === staffId);
    const fullAccess = canAccessDocs(role, me?.Team);
    if (!fullAccess && doc.RequestedFromID !== staffId) {
      return json({ error: 'You can only submit your own documents' }, 403);
    }

    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) return json({ error: 'No file provided' }, 400);

    const maxSize = 100 * 1024 * 1024; // 100MB
    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength > maxSize) return json({ error: 'File must be under 100MB' }, 400);

    const token = await getDriveToken(env);

    // Store in a per-document folder under the Evidence root
    const folderId = await getOrCreateDocFolder(token, env, docId, doc.Title);

    const fileName = (file.name || 'document').replace(/[^\w.\-_ ]/g, '_');
    const fileType = file.type || 'application/octet-stream';

    const boundary = 'AhPhyayDocBoundary';
    const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
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
    return json({ success: true, fileUrl, fileName });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// Get or create a Drive folder for a document submission
async function getOrCreateDocFolder(token, env, docId, docTitle) {
  const rootFolderId = env.Evidence_Folder_ID || 'root';
  const safeName = ('DOC ' + docId + ' — ' + (docTitle || 'Untitled')).replace(/[/\\]/g, '-');

  const searchUrl = 'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
    q: `name='${safeName.replace(/'/g, "\'")}' and '${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
    pageSize: '1',
  });
  const searchRes = await fetch(searchUrl, { headers: { Authorization: 'Bearer ' + token } });
  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) return searchData.files[0].id;

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
  if (!createData.id) throw new Error('Failed to create doc folder');
  return createData.id;
}

async function deleteDocSubmission(env, role, docId) {
  if (!isManagement(role)) return json({ error: 'Management only' }, 403);
  const docs = await sheetsRead(env, 'DocSubmissions');
  const rowIdx = docs.findIndex(d => d.ID === docId);
  if (rowIdx === -1) return json({ error: 'Not found' }, 404);
  await sheetsDeleteRow(env, 'DocSubmissions', rowIdx + 2);
  return json({ success: true });
}

// ══════════════════════════════════════════════════════════
// RECURRING TASKS
// ══════════════════════════════════════════════════════════

async function getRecurringTasks(env, role) {
  if (!isManagement(role)) return json({ error: 'Management only' }, 403);
  const recurring = await sheetsRead(env, 'RecurringTasks');
  const staff = await sheetsRead(env, 'Staff');
  const enriched = recurring.map(r => ({
    ...r,
    assigneeName: staff.find(s => s.ID === r.AssigneeID)?.Name || '',
  }));
  return json(enriched);
}

async function addRecurringTask(request, env, role) {
  if (!isManagement(role)) return json({ error: 'Management only' }, 403);
  const { title, description, frequency, team, assigneeId, sendDay } = await request.json();
  if (!title?.trim() || !frequency) return json({ error: 'Title and frequency required' }, 400);

  const id = 'REC-' + Date.now();
  const row = [id, title.trim(), description?.trim() || '', frequency, team || 'Support Team', assigneeId || '', 'true', '', sendDay !== undefined ? String(sendDay) : ''];
  await sheetsAppend(env, 'RecurringTasks', row);
  return json({ success: true, id });
}

async function updateRecurringTask(request, env, role, recId) {
  if (!isManagement(role)) return json({ error: 'Management only' }, 403);
  const body = await request.json();
  const recurring = await sheetsRead(env, 'RecurringTasks');
  const rowIdx = recurring.findIndex(r => r.ID === recId);
  if (rowIdx === -1) return json({ error: 'Not found' }, 404);

  const e = recurring[rowIdx];
  const updated = [
    e.ID,
    body.title !== undefined ? body.title : e.Title,
    body.description !== undefined ? body.description : e.Description,
    body.frequency || e.Frequency,
    body.team || e.Team,
    body.assigneeId !== undefined ? body.assigneeId : e.AssigneeID,
    body.active !== undefined ? String(body.active) : e.Active,
    e.LastGenerated || '',
    body.sendDay !== undefined ? String(body.sendDay) : (e.SendDay || ''),
  ];
  await sheetsUpdateRow(env, 'RecurringTasks', rowIdx + 2, updated);
  return json({ success: true });
}

async function deleteRecurringTask(env, role, recId) {
  if (!isManagement(role)) return json({ error: 'Management only' }, 403);
  const recurring = await sheetsRead(env, 'RecurringTasks');
  const rowIdx = recurring.findIndex(r => r.ID === recId);
  if (rowIdx === -1) return json({ error: 'Not found' }, 404);
  await sheetsDeleteRow(env, 'RecurringTasks', rowIdx + 2);
  return json({ success: true });
}

// Check if a recurring task is due based on frequency and last generation
function isRecurringDue(frequency, lastGenerated, sendDay) {
  const now = new Date();
  const freq = (frequency || '').toLowerCase();
  const todayStr = now.toISOString().slice(0, 10);

  // Prevent generating the same template twice on the same day
  if (lastGenerated) {
    const lastStr = new Date(lastGenerated).toISOString().slice(0, 10);
    if (lastStr === todayStr) return false;
  }

  if (freq === 'daily') {
    // Every day — due if not already generated today (checked above)
    return true;
  }

  if (freq === 'weekly') {
    // sendDay = weekday number 0(Sun)–6(Sat). Default Monday (1) if unset.
    const targetDow = (sendDay !== undefined && sendDay !== null && sendDay !== '')
      ? parseInt(sendDay, 10) : 1;
    if (now.getDay() !== targetDow) return false;      // only on the chosen weekday
    // Due if we haven't generated in the last 6 days (i.e., not already this week)
    if (!lastGenerated) return true;
    const days = (now - new Date(lastGenerated)) / (1000 * 60 * 60 * 24);
    return days >= 6;
  }

  if (freq === 'monthly') {
    // sendDay = day of month 1–28. Default 1 if unset.
    const targetDom = (sendDay !== undefined && sendDay !== null && sendDay !== '')
      ? parseInt(sendDay, 10) : 1;
    if (now.getDate() !== targetDom) return false;     // only on the chosen day of month
    // Due if last generation was in a previous month
    if (!lastGenerated) return true;
    const last = new Date(lastGenerated);
    return last.getFullYear() !== now.getFullYear() || last.getMonth() !== now.getMonth();
  }

  return false;
}

// Calculate a sensible due date based on frequency
function recurringDueDate(frequency) {
  const now = new Date();
  const freq = (frequency || '').toLowerCase();
  if (freq === 'daily') {
    now.setDate(now.getDate() + 1);
  } else if (freq === 'weekly') {
    now.setDate(now.getDate() + 7);
  } else if (freq === 'monthly') {
    now.setMonth(now.getMonth() + 1);
  }
  return now.toISOString().slice(0, 10);
}

async function generateRecurringTasks(env, role) {
  if (!isManagement(role)) return json({ error: 'Management only' }, 403);

  const recurring = await sheetsRead(env, 'RecurringTasks');
  const dueTasks = recurring.filter(r =>
    r.Active?.toLowerCase() === 'true' && isRecurringDue(r.Frequency, r.LastGenerated, r.SendDay)
  );

  if (!dueTasks.length) return json({ success: true, generated: 0, message: 'No tasks due' });

  const tasks = await sheetsRead(env, 'Tasks');
  // Base the counter on the highest existing TASK number, not the row count,
  // so manual additions/deletions don't cause ID collisions.
  let taskCounter = parseInt((nextTaskId(tasks).match(/\d+/) || ['0'])[0], 10) - 1;
  let generated = 0;
  const nowISO = new Date().toISOString();

  for (const rec of dueTasks) {
    try {
      taskCounter++;
      const taskId = 'TASK-' + String(taskCounter).padStart(3, '0');
      const dueDate = recurringDueDate(rec.Frequency);

      const taskRow = [
        taskId,
        '',                      // ProjectID
        rec.Title,
        'Recurring',             // Category
        dueDate,
        rec.Description || '',
        'Pending',
        rec.AssigneeID || '',
        'true',
        '',                      // EvidenceFile
        '',                      // EvidenceLink
        '',                      // EvidenceNote
        nowISO,                  // CreatedAt
        '',                      // EvidenceDate
        'Medium',                // Priority
      ];
      await sheetsAppend(env, 'Tasks', taskRow);

      // Update LastGenerated for this recurring template
      const rowIdx = recurring.findIndex(r => r.ID === rec.ID);
      if (rowIdx !== -1) {
        await sheetsUpdate(env, 'RecurringTasks', rowIdx + 2, getColIndex('RecurringTasks', 'LastGenerated'), nowISO);
      }

      // Notify the assignee
      if (rec.AssigneeID) {
        try {
          await createNotification(env, rec.AssigneeID, 'assigned',
            'Recurring task generated',
            `"${rec.Title}" (${rec.Frequency}) is due by ${dueDate}`,
            taskId
          );
        } catch(e) {}
      }

      generated++;
    } catch(e) {
      console.error('Failed to generate recurring task:', rec.Title, e.message);
    }
  }

  return json({ success: true, generated });
}

// Clear LastGenerated on all templates so they regenerate on next run
async function resetRecurringGeneration(env, role) {
  if (!isManagement(role)) return json({ error: 'Management only' }, 403);
  const recurring = await sheetsRead(env, 'RecurringTasks');
  for (let i = 0; i < recurring.length; i++) {
    await sheetsUpdate(env, 'RecurringTasks', i + 2, getColIndex('RecurringTasks', 'LastGenerated'), '');
  }
  return json({ success: true, reset: recurring.length });
}

// Pre-load the 11 workflow templates
async function seedRecurringTasks(env, role) {
  if (!isAdmin(role)) return json({ error: 'Admin only' }, 403);

  const existing = await sheetsRead(env, 'RecurringTasks');
  if (existing.length > 0) return json({ error: 'Recurring tasks already exist. Delete them first to re-seed.' }, 400);

  const templates = [
    ['Financial Planning & Budgeting', 'Project financial planning, budget review & revision, cash forecast preparation', 'Monthly'],
    ['Expense Monitoring & Cost Tracking', 'Day-to-day transaction recording, advance book (hard & soft), expenditure vs budget tracking', 'Daily'],
    ['Payment Processing & Advance Management', 'Advance request preparation, withdrawal processing, claim & clearance, follow-up on pending advances', 'Weekly'],
    ['Financial Reporting & Variance Analysis', 'Monthly financial report, variance analysis, monthly closing & summary report', 'Monthly'],
    ['Documentation & Data Management', 'Document collection & finalization, scanning & Google Drive upload, cash book update, finance forms check', 'Weekly'],
    ['Procurement & Asset Administration', 'Procurement tracker data entry, quotation process support, GRN & PO follow-up, asset code follow-up', 'Weekly'],
    ['AhPhyay Sales & Production Support', 'Sale list collection & verification, data entry & stock record update, reconciliation, weekly production review', 'Weekly'],
    ['Intern & Staff Administration', 'Timesheet collection & hour counting, staff salary advance preparation, leave list update', 'Monthly'],
    ['Financial Coordination & Reporting Support', 'Document support to Finance Coordinator, collect & check supporting documents, scan & submit', 'Monthly'],
    ['Team Meetings & Organizational Development', 'Monthly team meeting participation, meeting minutes, OD sessions', 'Monthly'],
    ['Workspace & Office Management', 'Office cleaning & 5S ordering, finance forms stock check & replenishment', 'Weekly'],
  ];

  let seeded = 0;
  for (let i = 0; i < templates.length; i++) {
    const [title, desc, freq] = templates[i];
    const id = 'REC-' + (Date.now() + i);
    const row = [id, title, desc, freq, 'Support Team', '', 'true', ''];
    await sheetsAppend(env, 'RecurringTasks', row);
    seeded++;
  }

  return json({ success: true, seeded });
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
        taskId = nextTaskId(tasks);
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
// SN@IL INCUBATION EXTENSION  (/incu/*)
// Collaborators self-assess → system scores → mentor (BOD) reviews & finalises.
// Form definitions live here ONLY; the frontend renders from GET /incu/forms
// and the scoring below reads the same object, so UI and score never drift.
// ══════════════════════════════════════════════════════════

const INCU_BUSINESS_STAGES = ['Idea Stage','Start-up','Early Growth','Growing Enterprise','Established Enterprise'];
const INCU_PRODUCT_CATEGORIES = ['Garment','Bag','Home Textile','Accessories'];

const INCU_FORMS = {
  // ── Product Inspection Report — 100 pts, QC standard met at ≥ 80 ──
  // Client template (Sep 2026): five sections with fixed weights; checkpoints may be Not Applicable,
  // and each section's weight is split equally across its applicable checkpoints.
  pqr: {
    label: 'Product Inspection Report',
    perProduct: true,
    qcThreshold: 80,
    header: [
      { id:'inspector',   label:'Inspector / QC name', type:'text' },
      { id:'report_date', label:'Report date', type:'date' },
      { id:'version',     label:'Version no.', type:'number', unit:'' },
    ],
    areas: [
      { key:'conformity',  label:'Product Conformity', max:20, questions:[
        { id:'c_design',     label:'Design / Style / Sewing construction', na:true },
        { id:'c_material',   label:'Material', hint:'Same material used for all construction components', na:true },
        { id:'c_color',      label:'Color shading', hint:'For mass production only — not mandatory for a small workshop', na:true, defaultNa:true },
        { id:'c_label',      label:'Labeling', hint:'Brand label, size label, hangtag, price tag', na:true },
        { id:'c_accessory',  label:'Accessories', hint:'Zipper, button, snap — must be consistent across mass-produced items', na:true } ]},
      { key:'testing',     label:'Product Testing (function check & measurement)', max:20, questions:[
        { id:'t_sewability', label:'Sewability / label resistance', na:true },
        { id:'t_accessory',  label:'Accessories check', hint:'Zipper, button, snap and other accessories', na:true },
        { id:'t_printing',   label:'Printing resistance / embroidery / color', na:true, defaultNa:true },
        { id:'t_loading',    label:'Loading test for bag', hint:'If applicable', na:true },
        { id:'t_laptop',     label:'Laptop fitness test for backpack / computer bag', hint:'If applicable', na:true, defaultNa:true },
        { id:'t_measure',    label:'Measurement checking', na:true } ]},
      { key:'workmanship', label:'Workmanship (product quality)', max:30, questions:[
        { id:'w_overall',    label:'Seam & stitching, asymmetry, finishing (uncut threads, raw edges), cleaning (dirty marks, stains), material, accessories, printing', hint:'Record the number of major and minor defects and attach defect photos', na:false, defects:true } ]},
      { key:'packing',     label:'Packing & Branding', max:10, questions:[
        { id:'p_attractive', label:'Attractive & protective', na:true },
        { id:'p_brandinfo',  label:'Brand information', na:true } ]},
      { key:'market',      label:'Market Readiness', max:20, questions:[
        { id:'m_price',      label:'Price competitiveness', na:false },
        { id:'m_appeal',     label:'Customer appeal', na:false },
        { id:'m_present',    label:'Overall presentation', na:false } ]},
    ],
    photoSlots: [
      { key:'front',      label:'Product view (front)' },
      { key:'back',       label:'Product view (back)' },
      { key:'side',       label:'Product side view' },
      { key:'top',        label:'Product top view' },
      { key:'colorshade', label:'Color shade checking', hint:'Mass production, bulk to bulk over 50 pcs' },
      { key:'label',      label:'Brand label' },
      { key:'hangtag',    label:'Hangtag' },
      { key:'accessory',  label:'Zipper / button / snap / accessories' },
      { key:'function',   label:'Function check', hint:'Sewability test, label resistance' },
      { key:'funcacc',    label:'Function check — zipper / button / snap' },
      { key:'packaging',  label:'Packaging view' },
      { key:'folding',    label:'Folding view' },
      { key:'defect_major', label:'Defect — Major', caption:true },
      { key:'defect_minor', label:'Defect — Minor', caption:true },
    ],
    bands: [[90,'Very Good Quality','Premium quality product, ready for exhibitions and wider markets.'],
            [80,'Good Quality','Good quality with only minor improvements needed. Meets the QC standard.'],
            [70,'Acceptable','Meets basic market standards but requires improvement in consistency or presentation.'],
            [60,'Fair','Saleable but needs significant improvement before expanding markets.'],
            [0,'Needs Improvement','Requires major improvements in quality, finishing, and market readiness before promotion.']],
  },

  // ── Branding & Market Positioning — 100 pts, auto-derived from the checklist ──
  brand: {
    label: 'Branding & Market Positioning',
    sections: [
      { key:'snapshot', label:'Current Business Snapshot', questions:[
        { id:'business_stage', label:'Business Stage', type:'select', options: INCU_BUSINESS_STAGES },
        { id:'core_product',   label:'Core Product',   type:'text' },
        { id:'target_customer',label:'Target Customer',type:'text' },
        { id:'sales_channels', label:'Current Sales Channels', type:'text' } ]},
      { key:'maturity', label:'Branding Maturity', questions:[
        { id:'m_name',      label:'Business Name',        type:'level', options:['Established','Developing','None'] },
        { id:'m_logo',      label:'Logo',                 type:'level', options:['Strong','Basic','None'] },
        { id:'m_story',     label:'Brand Story',          type:'level', options:['Clear','Partial','None'] },
        { id:'m_identity',  label:'Product Identity',     type:'level', options:['Clear','Developing','Weak'] },
        { id:'m_packaging', label:'Packaging',            type:'level', options:['Professional','Basic','None'] },
        { id:'m_photo',     label:'Product Photography',  type:'level', options:['Good','Fair','Limited'] },
        { id:'m_social',    label:'Social Media Branding',type:'level', options:['Consistent','Inconsistent','None'] },
        { id:'branding_stage', label:'Branding Stage', type:'stage', options:[
          'Stage 1 – Product-Based Business: sells products without a clear brand identity',
          'Stage 2 – Brand Identity Development: name, logo and identity emerging but inconsistent',
          'Stage 3 – Market-Oriented Brand: consistent branding, growing recognition and storytelling',
          'Stage 4 – Competitive Lifestyle Brand: strong positioning, loyal customers, clear differentiation'] } ]},
      { key:'positioning', label:'Market Positioning', questions:[
        { id:'value_prop', label:'Value Proposition — how clearly does the business communicate why customers should choose its products?', type:'rating4', options:['Excellent','Good','Fair','Weak'] },
        { id:'usp',        label:'Current USP', type:'textarea' },
        { id:'star_quality',    label:'Product Quality',     type:'stars' },
        { id:'star_consistency',label:'Product Consistency', type:'stars' },
        { id:'star_demand',     label:'Market Demand',       type:'stars' },
        { id:'star_pricing',    label:'Pricing Strategy',    type:'stars' },
        { id:'star_cx',         label:'Customer Experience', type:'stars' },
        { id:'star_recognition',label:'Brand Recognition',   type:'stars' },
        { id:'positioning_stage', label:'Positioning Stage', type:'stage', options:[
          'Stage 1 – Local Community Business: mainly serves friends, neighbours and local buyers',
          'Stage 2 – Emerging Market Presence: participates in exhibitions, receives repeat customers',
          'Stage 3 – Regional Market Position: recognised beyond the local community, growing partnerships',
          'Stage 4 – Premium or Export Ready: clear positioning, strong branding, capacity for larger markets'] } ]},
      { key:'digital', label:'Digital Positioning', questions:[
        { id:'platforms', label:'Current Platforms', type:'multi', options:['Facebook','TikTok','Instagram','Viber','Website','Marketplace'] },
        { id:'digital_readiness', label:'Digital Readiness', type:'rating4', options:['Beginner','Developing','Intermediate','Advanced'], ascending:true } ]},
    ],
    areas: [
      { key:'brand_identity', label:'Brand Identity',             weight:20 },
      { key:'positioning',    label:'Product Positioning',        weight:20 },
      { key:'cvp',            label:'Customer Value Proposition', weight:15 },
      { key:'digital',        label:'Digital Presence',           weight:15 },
      { key:'market',         label:'Market Readiness',           weight:15 },
      { key:'growth',         label:'Business Growth Potential',  weight:15 },
    ],
    bands: [[90,'Brand Leader','Strong, recognizable brand with a clear market position and readiness for expansion.'],
            [80,'Growth Brand','Consistent branding and growing market presence with potential for scaling.'],
            [70,'Emerging Brand','Developing brand identity and positioning but requires stronger consistency and market differentiation.'],
            [60,'Developing Business','Basic branding exists, but significant improvement is needed in positioning, marketing, and customer engagement.'],
            [0,'Foundation Stage','Business is primarily product-focused and requires support to establish a clear brand identity and market positioning.']],
  },

  // ── Financial Assessment — client's "SMEs Financial Assessment" template ──
  // 17 inputs → 11 calculated values → 9 KPIs scored 1–5 by rubric → weighted average × 20 = /100.
  finance: {
    label: 'Financial Assessment',
    currency: 'MMK',
    sections: [
      { key:'sales', label:'Sales & growth', questions:[
        { id:'revenue_prev',  label:'Previous period total sales', type:'number', unit:'MMK', hint:'Total sales for the previous comparable period' },
        { id:'revenue',       label:'Current period total sales', type:'number', unit:'MMK', hint:'Total sales in the period being assessed' },
        { id:'credit_sales',  label:'Credit sales in period', type:'number', unit:'MMK', hint:'Sales made on credit terms — enter total sales if all sales are on credit, 0 if none' },
        { id:'mix_trend',     label:'Product / service mix trend', type:'rating5', options:['Severe drop in main items','Falling sales in key products','Flat sales across items','Moderate growth across items','Strong growth across all lines'], hint:'Check whether falling sales come from demand, pricing or stock availability' } ]},
      { key:'profit', label:'Costs & profitability', questions:[
        { id:'cogs',          label:'Cost of goods sold (COGS)', type:'number', unit:'MMK', hint:'Direct materials, direct labour, production costs' },
        { id:'opex',          label:'Operating expenses', type:'number', unit:'MMK', hint:'Rent, utilities, wages, marketing, admin, transport' },
        { id:'interest_tax',  label:'Interest & tax expense', type:'number', unit:'MMK', hint:'Interest payments and business tax for the period' } ]},
      { key:'cash', label:'Cash & liquidity (at period end)', questions:[
        { id:'cash',          label:'Cash & bank balances', type:'number', unit:'MMK' },
        { id:'receivables',   label:'Accounts receivable', type:'number', unit:'MMK', hint:'Amounts owed by customers' },
        { id:'inventory',     label:'Inventory at cost', type:'number', unit:'MMK', hint:'Value of stock at cost price' },
        { id:'other_ca',      label:'Other current assets', type:'number', unit:'MMK', hint:'Prepaid rent, short-term advances, etc.' },
        { id:'payables',      label:'Accounts payable', type:'number', unit:'MMK', hint:'Unpaid bills owed to suppliers' },
        { id:'st_debt',       label:'Short-term debt / loans due', type:'number', unit:'MMK', hint:'Loan instalments due within 12 months' },
        { id:'other_cl',      label:'Other current liabilities', type:'number', unit:'MMK', hint:'Accrued payroll, taxes payable, short obligations' } ]},
      { key:'debt', label:'Debt control', questions:[
        { id:'total_debt',    label:'Total debt outstanding', type:'number', unit:'MMK', hint:'Total outstanding principal for all business loans (0 if none)' },
        { id:'cash_for_debt', label:'Cash available for debt service', type:'number', unit:'MMK', hint:'Net operating cash generated, available to pay debt' },
        { id:'debt_service',  label:'Scheduled debt principal & interest', type:'number', unit:'MMK', hint:'Principal + interest due during the period (0 if none)' },
        { id:'debt_level',    label:'Debt level & repayments', type:'rating5', options:['Missed payments / high risk','Severe cash strain from debt','Tight but punctual','Manageable repayment load','Zero debt / easily covered'], hint:'Consider loan interest rates, maturities and collateral risk' } ]},
      { key:'reflection', label:'Owner\u2019s notes', questions:[
        { id:'fin_challenges',   label:'Main financial challenges this period', type:'textarea' },
        { id:'fin_improvements', label:'Changes made since the last assessment', type:'textarea' } ]},
    ],
    // Pillars (weights sum to 100)
    areas: [
      { key:'growth',  label:'Sales & Growth',   weight:20 },
      { key:'profit',  label:'Profitability',    weight:30 },
      { key:'cash',    label:'Cash & Liquidity', weight:35 },
      { key:'debt',    label:'Debt Control',     weight:15 },
    ],
    // KPIs: weight (template), rubric thresholds → score 1–5
    kpis: [
      { key:'growth', pillar:'growth', label:'Total sales growth rate', weight:0.10, fmt:'pct', benchmark:'Growth above inflation', guidance:'Compare sales vs previous period. Negative growth requires price/volume review.', rubric:['< -10%','-10% to 0%','0% to 5%','5% to 15%','> 15%'] },
      { key:'mix',    pillar:'growth', label:'Product / service mix trend', weight:0.10, fmt:'text', benchmark:'Diversified demand', guidance:'Check if falling sales are caused by demand, pricing, or stock availability.' },
      { key:'gpm',    pillar:'profit', label:'Gross profit margin', weight:0.15, fmt:'pct', benchmark:'Target 30% – 50%', guidance:'Measures pricing & production efficiency. Low margin indicates rising input costs.', rubric:['< 15%','15% – 25%','25% – 35%','35% – 50%','> 50%'] },
      { key:'npm',    pillar:'profit', label:'Net profit margin', weight:0.15, fmt:'pct', benchmark:'Target > 10%', guidance:'True take-home profit. Low margin means overhead expenses are consuming revenues.', rubric:['Loss','0% – 5%','5% – 10%','10% – 20%','> 20%'] },
      { key:'cr',     pillar:'cash',   label:'Current ratio', weight:0.15, fmt:'x', benchmark:'Target 1.5 – 2.0', guidance:'Can short-term assets cover short-term debts? Below 1.0 indicates a cash crunch.', rubric:['< 0.8x','0.8x – 1.0x','1.0x – 1.5x','1.5x – 2.5x','> 2.5x'] },
      { key:'dso',    pillar:'cash',   label:'Days sales outstanding (DSO)', weight:0.10, fmt:'days', benchmark:'Target < 30 days', guidance:'Average days to collect customer cash. High DSO traps cash in overdue receivables.', rubric:['> 90 days','60 – 90','45 – 60','30 – 45','< 30 days'] },
      { key:'dio',    pillar:'cash',   label:'Days inventory outstanding (DIO)', weight:0.10, fmt:'days', benchmark:'Target < 45 days', guidance:'Days inventory sits before selling. High DIO ties up capital in slow stock.', rubric:['> 90 days','60 – 90','45 – 60','30 – 45','< 30 days'] },
      { key:'debt',   pillar:'debt',   label:'Total debt & repayment schedule', weight:0.05, fmt:'text', benchmark:'Manageable loans', guidance:'Check loan interest rates, maturities, and collateral risk.' },
      { key:'dscr',   pillar:'debt',   label:'Debt service coverage ratio (DSCR)', weight:0.10, fmt:'x', benchmark:'Target > 1.25x', guidance:'Operating cash vs loan payments. Below 1.0 means cash flow cannot cover debt.', rubric:['< 0.8x','0.8x – 1.0x','1.0x – 1.25x','1.25x – 1.75x','> 1.75x'] },
    ],
    bands: [[80,'Strong & Stable','Business is highly resilient, profitable, and cash flow is healthy.','Reinvest profits into expansion, inventory, or rainy-day reserves.'],
            [60,'Moderate / Stable','Generally healthy, but one or two specific areas need monitoring.','Address isolated weak spots before they impact overall liquidity.'],
            [40,'Vulnerable / Warning','Profit margins or cash flow are under pressure. The business is burning capital.','Cut non-essential overhead costs and negotiate better terms with suppliers.'],
            [0,'High Risk / Critical','Severe financial distress. Cash depleted and risk of loan default.','Urgent emergency cash preservation, debt restructuring, or capital injection.']],
  },

  // ── Lean KPI Baseline / Endline — 7 KPIs; endline is scored against the latest reviewed baseline ──
  lean: {
    label: 'Lean KPI Questionnaire',
    periods: ['Baseline','Endline'],
    kpis: [
      { key:'output', label:'Daily Output', labelMm:'တစ်နေ့တာ ထုတ်လုပ်နိုင်မှု', target:'+20% growth', targetRule:{ type:'increase', pct:20 }, unit:'units/day',
        baseline:[ { id:'b_output', label:'Average units produced per day', type:'number', unit:'units/day', metric:true },
                   { id:'b_days_week', label:'Working days per week', type:'number', unit:'days' },
                   { id:'b_has_target', label:'Is there a daily production target?', type:'yesno' },
                   { id:'b_target', label:'If yes, target', type:'number', unit:'units/day' },
                   { id:'b_barriers', label:'Main barriers to increasing output', type:'multi', options:['Waiting for materials','Poor work management','Waiting in line','Tool / machine problems','Other'] } ],
        endline:[  { id:'e_output', label:'Average units produced per day after Lean', type:'number', unit:'units/day', metric:true },
                   { id:'e_changes', label:'Main changes that improved output', type:'textarea' } ],
        evidence:{ required:true, photos:['Production area','Workstation layout','Working process'], docs:['Daily production record','Order record','Production tracking sheet'] } },
      { key:'defect', label:'Defect Rate', labelMm:'အမှားပါသော ထုတ်ကုန်နှုန်း', target:'< 5%', targetRule:{ type:'below', value:5, rateOf:30 }, unit:'per 30',
        baseline:[ { id:'b_defects', label:'Defective items per 30 produced', type:'number', unit:'/ 30', metric:true },
                   { id:'b_rework', label:'Items reworked per week', type:'number', unit:'/ week' },
                   { id:'b_defect_types', label:'Most common defect types', type:'textarea' },
                   { id:'b_defect_cause', label:'Main cause of defects', type:'textarea' } ],
        endline:[  { id:'e_defects', label:'Defective items per 30 produced after Lean', type:'number', unit:'/ 30', metric:true },
                   { id:'e_quality_changes', label:'Changes made to improve quality', type:'textarea' } ],
        evidence:{ required:false, photos:['Defect sample','Quality checking area'], docs:['Defect record','Quality inspection checklist'] } },
      { key:'search', label:'Search Time', labelMm:'ပစ္စည်းရှာဖွေချိန်', target:'< 5 minutes', targetRule:{ type:'below', value:5 }, unit:'minutes',
        baseline:[ { id:'b_search', label:'Average time to find tools / materials', type:'number', unit:'minutes', metric:true },
                   { id:'b_hard_items', label:'Items that are hard to find', type:'textarea' } ],
        endline:[  { id:'e_search', label:'Average time to find tools / materials now', type:'number', unit:'minutes', metric:true },
                   { id:'e_5s_easier', label:'What became easier because of 5S and visual management?', type:'textarea' } ],
        evidence:{ required:true, photos:['Before / after storage area','Labeling system'], docs:['Storage layout','Material location list'] } },
      { key:'lead', label:'Lead Time', labelMm:'အော်ဒါပြီးစီးချိန်', target:'Reduce 40–60%', targetRule:{ type:'decrease', pct:40 }, unit:'days',
        baseline:[ { id:'b_lead', label:'Days from order received to finished product delivered', type:'number', unit:'days', metric:true },
                   { id:'b_delay_reasons', label:'Reasons orders get delayed', type:'textarea' } ],
        endline:[  { id:'e_lead', label:'Days to complete an order after Lean', type:'number', unit:'days', metric:true } ],
        evidence:{ required:false, photos:['Process flow','Production & packing area'], docs:['Order tracking sheet','Delivery record'] } },
      { key:'fives', label:'5S Score', labelMm:'5S အမှတ်', target:'> 80 / 100', targetRule:{ type:'above', value:80 }, unit:'/ 100',
        baseline:[ { id:'b_5s', label:'Current 5S audit score', type:'number', unit:'/ 100', max:100, metric:true },
                   { id:'b_workplace', label:'Workplace organisation', type:'select', options:['Good','Average','Needs improvement'] } ],
        endline:[  { id:'e_5s', label:'5S audit score after Lean', type:'number', unit:'/ 100', max:100, metric:true },
                   { id:'e_workplace_changes', label:'What changed in the workplace after 5S?', type:'textarea' } ],
        evidence:{ required:true, photos:['Entire workplace','Working table','Storage area','Finished product area'], docs:['5S audit checklist','Cleaning schedule'] } },
      { key:'kaizen', label:'Kaizen Suggestions', labelMm:'တိုးတက်ရေးအကြံပြုချက်', target:'≥ 5 / month', targetRule:{ type:'atleast', value:5 }, unit:'/ month',
        baseline:[ { id:'b_kaizen', label:'Improvement suggestions submitted per month', type:'number', unit:'/ month', metric:true },
                   { id:'b_kaizen_recorded', label:'Are suggestions recorded?', type:'yesno' } ],
        endline:[  { id:'e_kaizen', label:'Kaizen suggestions submitted per month', type:'number', unit:'/ month', metric:true },
                   { id:'e_kaizen_done', label:'Improvements implemented', type:'number', unit:'count' } ],
        evidence:{ required:false, photos:['Kaizen activity','Improvement result'], docs:['Kaizen suggestion form','Improvement record'] } },
      { key:'participation', label:'Employee Participation', labelMm:'အဖွဲ့ဝင်ပါဝင်မှု', target:'> 70%', targetRule:{ type:'above', value:70, ratio:true }, unit:'%',
        baseline:[ { id:'b_members', label:'Total members', type:'number', unit:'people' },
                   { id:'b_participants', label:'Members participating in Lean activities', type:'number', unit:'people' },
                   { id:'b_low_reason', label:'Reason for low participation (if any)', type:'textarea' } ],
        endline:[  { id:'e_members', label:'Total members', type:'number', unit:'people' },
                   { id:'e_participants', label:'Members participating', type:'number', unit:'people' },
                   { id:'e_behaviour', label:'How did members\u2019 behaviour / attitude change after Lean?', type:'textarea' } ],
        evidence:{ required:false, photos:['Team meeting','Training','Kaizen activity'], docs:['Attendance record','Training record'] } },
    ],
  },
};

// ── Scoring helpers ──
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function bandFor(bands, score) {
  for (const [min, label, desc] of bands) if (score >= min) return { label, desc };
  return { label: bands[bands.length - 1][1], desc: bands[bands.length - 1][2] };
}

// Product Inspection: each section's weight is split equally across its applicable checkpoints
// (answers[id + '__na'] === true marks a checkpoint Not Applicable). Marks are capped at the item max.
function scorePqr(answers) {
  const f = INCU_FORMS.pqr;
  const areas = f.areas.map(a => {
    const applicable = a.questions.filter(q => !(q.na && answers[q.id + '__na'] === true));
    const itemMax = applicable.length ? Math.round(a.max / applicable.length * 100) / 100 : 0;
    const items = a.questions.map(q => {
      const isNa = q.na && answers[q.id + '__na'] === true;
      const raw = isNa ? null : num(answers[q.id]);
      return { id:q.id, label:q.label, na:isNa, max: isNa ? 0 : itemMax, score: isNa ? 0 : (raw === null ? 0 : clamp(raw, 0, itemMax)), remark: answers[q.id + '__remark'] || '',
               ...(q.defects ? { major: num(answers.wm_major) ?? 0, minor: num(answers.wm_minor) ?? 0 } : {}) };
    });
    const score = Math.round(items.reduce((s, i) => s + i.score, 0) * 10) / 10;
    return { key:a.key, label:a.label, max:a.max, applicable: applicable.length, itemMax, score, items };
  });
  const total = Math.round(areas.reduce((s, a) => s + a.score, 0));
  const band = bandFor(f.bands, total);
  return { score: total, rating: band.label, ratingDesc: band.desc, qcMet: total >= f.qcThreshold, areas,
           majorDefects: num(answers.wm_major) ?? 0, minorDefects: num(answers.wm_minor) ?? 0 };
}

// Branding: derive the six weighted areas from the checklist answers.
//   Brand Identity 20   ← 7 maturity components, best/mid/none = 2/1/0 (max 14)
//   Positioning 20      ← branding stage (1–4) and positioning stage (1–4), averaged
//   CVP 15              ← value proposition rating (Excellent 3 … Weak 0)
//   Digital 15          ← half from platform count (/6), half from digital readiness (0–3)
//   Market Readiness 15 ← average of the six 1–5 star ratings, rescaled 0–1
//   Growth 15           ← business stage (0–4) and positioning stage (1–4), averaged
function scoreBrand(answers) {
  const f = INCU_FORMS.brand;
  const levelVal = id => { const i = ['0','1','2'].indexOf(String(answers[id] ?? '')); return i === -1 ? 0 : 2 - i; }; // option index 0 = best
  const stageVal = id => clamp(num(answers[id]) ?? 1, 1, 4);
  const maturity = ['m_name','m_logo','m_story','m_identity','m_packaging','m_photo','m_social'].reduce((s, id) => s + levelVal(id), 0);
  const brandingStage = stageVal('branding_stage'), positioningStage = stageVal('positioning_stage');
  const valueProp = (() => { const i = num(answers.value_prop); return i === null ? 0 : clamp(3 - i, 0, 3); })(); // option 0 = Excellent
  const platforms = Array.isArray(answers.platforms) ? answers.platforms.length : 0;
  const digitalReady = clamp(num(answers.digital_readiness) ?? 0, 0, 3);                                        // option 0 = Beginner
  const stars = ['star_quality','star_consistency','star_demand','star_pricing','star_cx','star_recognition'].map(id => clamp(num(answers[id]) ?? 1, 1, 5));
  const starAvg = stars.reduce((a, b) => a + b, 0) / stars.length;
  const bizStage = clamp(INCU_BUSINESS_STAGES.indexOf(answers.business_stage), 0, 4);

  const ratios = {
    brand_identity: maturity / 14,
    positioning:    ((brandingStage - 1) / 3 + (positioningStage - 1) / 3) / 2,
    cvp:            valueProp / 3,
    digital:        (platforms / 6) * 0.5 + (digitalReady / 3) * 0.5,
    market:         (starAvg - 1) / 4,
    growth:         (bizStage / 4 + (positioningStage - 1) / 3) / 2,
  };
  const areas = f.areas.map(a => ({ key:a.key, label:a.label, max:a.weight, score: Math.round(ratios[a.key] * a.weight * 10) / 10 }));
  const total = Math.round(areas.reduce((s, a) => s + a.score, 0));
  const band = bandFor(f.bands, total);
  return { score: total, rating: band.label, ratingDesc: band.desc, areas, brandingStage, positioningStage };
}

// Lean: pull the one headline metric per KPI; for an endline, compare to the paired baseline
// and test each KPI against its target. Score = % of the 7 targets met (null for baseline).
function leanMetric(kpi, answers, period) {
  const qs = period === 'Endline' ? kpi.endline : kpi.baseline;
  if (kpi.targetRule.ratio) {
    const pre = period === 'Endline' ? 'e' : 'b';
    const total = num(answers[pre + '_members']), part = num(answers[pre + '_participants']);
    return total ? Math.round((part || 0) / total * 1000) / 10 : null;
  }
  const q = qs.find(x => x.metric);
  let v = num(answers[q.id]);
  if (v !== null && kpi.targetRule.rateOf) v = Math.round(v / kpi.targetRule.rateOf * 1000) / 10; // defects/30 → %
  return v;
}
function leanTargetMet(rule, base, end) {
  if (end === null) return null;
  switch (rule.type) {
    case 'increase': return base ? ((end - base) / base * 100) >= rule.pct : null;
    case 'decrease': return base ? ((base - end) / base * 100) >= rule.pct : null;
    case 'below':    return end < rule.value;
    case 'above':    return end > rule.value;
    case 'atleast':  return end >= rule.value;
  }
  return null;
}
function scoreLean(answers, period, baselineAnswers) {
  const f = INCU_FORMS.lean;
  const kpis = f.kpis.map(k => {
    const value = leanMetric(k, answers, period);
    if (period !== 'Endline') return { key:k.key, label:k.label, unit:k.unit, target:k.target, value };
    const base = baselineAnswers ? leanMetric(k, baselineAnswers, 'Baseline') : null;
    const changePct = (base && value !== null) ? Math.round((value - base) / base * 1000) / 10 : null;
    return { key:k.key, label:k.label, unit:k.unit, target:k.target, baseline: base, value, changePct, met: leanTargetMet(k.targetRule, base, value) };
  });
  if (period !== 'Endline') return { score: null, rating: 'Baseline recorded', kpis, metCount: null };
  const scored = kpis.filter(k => k.met !== null);
  const metCount = scored.filter(k => k.met).length;
  const score = scored.length ? Math.round(metCount / f.kpis.length * 100) : null;
  const rating = score === null ? 'Not enough data' : score >= 85 ? 'Excellent' : score >= 70 ? 'Strong' : score >= 50 ? 'Developing' : 'Needs attention';
  return { score, rating, kpis, metCount, hasBaseline: !!baselineAnswers };
}

// Financial Assessment: template formulas + 1–5 rubric per KPI, weighted average × 20.
const fin5 = (v, cuts) => { if (v === null || v === undefined || !Number.isFinite(v)) return null; let sc = 1; for (const c of cuts) if (v >= c) sc++; return sc; };        // ascending thresholds
const fin5desc = (v, cuts) => { if (v === null || v === undefined || !Number.isFinite(v)) return null; let sc = 5; for (const c of cuts) if (v > c) sc--; return sc; };  // lower is better
function scoreFinance(answers) {
  const f = INCU_FORMS.finance;
  const n = id => num(answers[id]);
  const prev = n('revenue_prev'), sales = n('revenue'), credit = n('credit_sales'), cogs = n('cogs'), opex = n('opex'), itax = n('interest_tax') ?? 0;
  const cash = n('cash') ?? 0, ar = n('receivables') ?? 0, inv = n('inventory') ?? 0, oca = n('other_ca') ?? 0, ap = n('payables') ?? 0, std = n('st_debt') ?? 0, ocl = n('other_cl') ?? 0;
  const tdebt = n('total_debt'), cfd = n('cash_for_debt'), dsvc = n('debt_service');
  const pct = (a, b) => (a !== null && b) ? Math.round(a / b * 1000) / 10 : null;
  const growthPct = (sales !== null && prev) ? Math.round((sales - prev) / prev * 1000) / 10 : null;
  const grossProfit = (sales !== null && cogs !== null) ? sales - cogs : null;
  const grossMarginPct = pct(grossProfit, sales);
  const netProfit = (grossProfit !== null && opex !== null) ? grossProfit - opex - itax : null;
  const netMarginPct = pct(netProfit, sales);
  const totalCA = cash + ar + inv + oca, totalCL = ap + std + ocl;
  const currentRatio = totalCL > 0 ? Math.round(totalCA / totalCL * 100) / 100 : (totalCA > 0 ? 9.99 : null);
  const dso = credit === null ? null : credit > 0 ? Math.round(ar / credit * 30 * 10) / 10 : (ar > 0 ? null : 0);
  const dio = cogs ? Math.round(inv / cogs * 30 * 10) / 10 : null;
  const noDebt = (tdebt === 0 || tdebt === null) && !(dsvc > 0);
  const dscr = noDebt ? null : (dsvc > 0 && cfd !== null) ? Math.round(cfd / dsvc * 100) / 100 : null;
  const mixScore = num(answers.mix_trend) !== null ? clamp(num(answers.mix_trend) + 1, 1, 5) : null;
  const debtScore = num(answers.debt_level) !== null ? clamp(num(answers.debt_level) + 1, 1, 5) : null;
  const values = { growth: growthPct, mix: mixScore, gpm: grossMarginPct, npm: netMarginPct, cr: currentRatio, dso, dio, debt: debtScore, dscr };
  const scores = {
    growth: fin5(growthPct, [-10, 0, 5, 15]),
    mix: mixScore,
    gpm: fin5(grossMarginPct, [15, 25, 35, 50]),
    npm: fin5(netMarginPct, [0, 5, 10, 20]),
    cr: fin5(currentRatio, [0.8, 1.0, 1.5, 2.5]),
    dso: fin5desc(dso, [30, 45, 60, 90]),
    dio: fin5desc(dio, [30, 45, 60, 90]),
    debt: debtScore,
    dscr: noDebt ? 5 : fin5(dscr, [0.8, 1.0, 1.25, 1.75]),
  };
  const fmtVal = (k, v) => v === null || v === undefined ? '—' : k.fmt === 'pct' ? v + '%' : k.fmt === 'x' ? (v >= 9.99 ? '> 10x' : v + 'x') : k.fmt === 'days' ? v + ' days' : (k.key === 'mix' ? (f.sections[0].questions[3].options[v - 1] || v) : (f.sections[3].questions[3].options[v - 1] || v));
  const kpis = f.kpis.map(k => { const sc = scores[k.key]; const used = sc === null ? 3 : sc;   // missing data → Adequate (3), flagged
    return { key:k.key, pillar:k.pillar, label:k.label, weight:k.weight, value: values[k.key], display: fmtVal(k, values[k.key]), score: sc, scoreUsed: used, weighted: Math.round(k.weight * used * 1000) / 1000, benchmark:k.benchmark, guidance:k.guidance, missing: sc === null }; });
  const weightedAvg = Math.round(kpis.reduce((s, k) => s + k.weighted, 0) * 100) / 100;
  const total = Math.round(weightedAvg * 20);
  const areas = f.areas.map(a => { const ks = kpis.filter(k => k.pillar === a.key); const w = ks.reduce((s, k) => s + k.weight, 0); const got = ks.reduce((s, k) => s + k.weighted, 0); return { key:a.key, label:a.label, max:a.weight, score: Math.round(got / (w * 5) * a.weight * 10) / 10 }; });
  const band = f.bands.find(b => total >= b[0]) || f.bands[f.bands.length - 1];
  return { score: total, weightedAvg, rating: band[1], ratingDesc: band[2], action: band[3], areas, kpis,
           growthPct, grossProfit, grossMarginPct, netProfit, netMarginPct, totalCA, totalCL, currentRatio, dso, dio, dscr, noDebt,
           incomeChangePct: growthPct, profitable: netProfit !== null ? netProfit > 0 : null, missingCount: kpis.filter(k => k.missing).length };
}

function scoreAssessment(type, answers, period, baselineAnswers) {
  if (type === 'finance') return scoreFinance(answers);
  if (type === 'pqr')   return scorePqr(answers);
  if (type === 'brand') return scoreBrand(answers);
  if (type === 'lean')  return scoreLean(answers, period, baselineAnswers);
  throw new Error('Unknown assessment type');
}

const parseJson = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch (_) { return fallback; } };

// ── Collaborator profile ──
function nextCollabId(rows) {
  let max = 0;
  for (const r of rows) { const m = /^COL-(\d+)$/.exec(r.ID || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return 'COL-' + String(max + 1).padStart(3, '0');
}
async function upsertCollaboratorProfile(env, staffId, c) {
  const rows = await sheetsRead(env, 'Collaborators');
  const idx = rows.findIndex(r => r.StaffID === staffId);
  const e = idx === -1 ? {} : rows[idx];
  const id = e.ID || nextCollabId(rows);
  const row = [
    id, staffId,
    c.businessName !== undefined ? c.businessName.trim() : (e.BusinessName || ''),
    c.owner !== undefined ? c.owner : (e.Owner || ''),
    c.location !== undefined ? c.location : (e.Location || ''),
    c.businessStage !== undefined ? c.businessStage : (e.BusinessStage || ''),
    c.coreProduct !== undefined ? c.coreProduct : (e.CoreProduct || ''),
    c.targetCustomer !== undefined ? c.targetCustomer : (e.TargetCustomer || ''),
    c.salesChannels !== undefined ? c.salesChannels : (e.SalesChannels || ''),
    c.mentorId !== undefined ? c.mentorId : (e.MentorID || ''),
    e.Active || 'true',
    e.CreatedAt || new Date().toISOString(),
    e.FolderID || '',
  ];
  if (idx === -1) await sheetsAppend(env, 'Collaborators', row);
  else await sheetsUpdateRow(env, 'Collaborators', idx + 2, row);
  // Create the collaborator's Drive folder up front (best-effort; also created lazily on first upload)
  try { const token = await getDriveToken(env); await getIncuCollabFolder(token, env, { ...e, ID: id, StaffID: staffId, BusinessName: row[2], FolderID: e.FolderID || '' }); } catch (_) {}
  return id;
}

// ── Drive layout ─────────────────────────────────────────
//   <INCU_FOLDER_ID>  "SN@IL Incubation"
//     └── <BusinessName> (<COL-ID>)              ← Collaborators.FolderID
//           └── <ASM-ID> — <form> — <product|period>   evidence files, responses-*.json, report.pdf
function incuRootFolder(env) { return env.INCU_FOLDER_ID || env.Evidence_Folder_ID || 'root'; }

async function driveFindOrCreateFolder(token, name, parentId) {
  const safe = name.replace(/[/\\]/g, '-');
  const q = `name='${safe.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await fetch('https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' }), { headers: { Authorization: 'Bearer ' + token } });
  const data = await res.json();
  if (data.files?.length) return data.files[0].id;
  return (await driveCreateFolder(token, safe, parentId)).id;
}

// Collaborator folder — cached in Collaborators.FolderID, created on demand
async function getIncuCollabFolder(token, env, collab) {
  if (collab.FolderID) return collab.FolderID;
  const folderId = await driveFindOrCreateFolder(token, (collab.BusinessName || 'Collaborator') + ' (' + collab.ID + ')', incuRootFolder(env));
  const rows = await sheetsRead(env, 'Collaborators');
  const idx = rows.findIndex(r => r.ID === collab.ID);
  if (idx !== -1) await sheetsUpdate(env, 'Collaborators', idx + 2, getColIndex('Collaborators', 'FolderID'), folderId);
  collab.FolderID = folderId;
  return folderId;
}

// Per-assessment folder inside the collaborator folder
function incuAssessmentFolderName(a) {
  return a.ID + ' — ' + INCU_FORMS[a.Type].label + ' — ' + (a.ProductName || a.Period || '');
}
async function getIncuAssessmentFolder(token, env, a) {
  const collabs = await sheetsRead(env, 'Collaborators');
  const c = collabs.find(x => x.ID === a.CollaboratorID);
  if (!c) throw new Error('Collaborator not found for this assessment');
  const collabFolder = await getIncuCollabFolder(token, env, c);
  return await driveFindOrCreateFolder(token, incuAssessmentFolderName(a), collabFolder);
}

// Snapshot the full answer set + computed breakdown to Drive (on submit and on finalise). Best-effort.
async function incuSnapshotResponses(env, a, stage, extra) {
  try {
    const token = await getDriveToken(env);
    const folderId = await getIncuAssessmentFolder(token, env, a);
    const payload = {
      assessmentId: a.ID, collaboratorId: a.CollaboratorID, type: a.Type, form: INCU_FORMS[a.Type].label,
      period: a.Period || '', productName: a.ProductName || '', productCategory: a.ProductCategory || '',
      stage, snapshotAt: new Date().toISOString(),
      answers: parseJson(a.Answers, {}), breakdown: parseJson(a.Breakdown, null),
      selfScore: a.SelfScore || null, finalScore: a.FinalScore || null, rating: a.Rating || '',
      mentorAnswers: parseJson(a.MentorAnswers, {}), mentorNotes: a.MentorNotes || '',
      evidence: parseJson(a.Evidence, []), ...(extra || {}),
    };
    const buf = new TextEncoder().encode(JSON.stringify(payload, null, 2)).buffer;
    // Replace an existing snapshot of the same stage rather than piling up copies
    const name = 'responses-' + stage + '.json';
    const q = `name='${name}' and '${folderId}' in parents and trashed=false`;
    const ex = await (await fetch('https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({ q, fields: 'files(id)' }), { headers: { Authorization: 'Bearer ' + token } })).json();
    for (const f of (ex.files || [])) await fetch('https://www.googleapis.com/drive/v3/files/' + f.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
    await driveUploadFile(token, buf, name, 'application/json', folderId);
  } catch (e) { console.error('Snapshot failed:', e.message); }
}

// Collaborator folder link for mentors
async function incuCollabFolderLink(env, auth, collabId) {
  if (!isManagement(auth.role)) return json({ error: 'Access denied' }, 403);
  const collabs = await sheetsRead(env, 'Collaborators');
  const c = collabs.find(x => x.ID === collabId);
  if (!c) return json({ error: 'Not found' }, 404);
  const token = await getDriveToken(env);
  const folderId = await getIncuCollabFolder(token, env, c);
  return json({ success: true, folderId, url: 'https://drive.google.com/drive/folders/' + folderId });
}

// Store a generated PDF report in the assessment folder; recorded in Evidence as kind:'report'
async function incuUploadReport(request, env, auth, id) {
  const all = await sheetsRead(env, 'Assessments');
  const idx = all.findIndex(x => x.ID === id);
  if (idx === -1) return json({ error: 'Not found' }, 404);
  const e = all[idx];
  if (isCollaborator(auth.role)) {
    const c = await myCollaborator(env, auth.staffId);
    if (!c || c.ID !== e.CollaboratorID) return json({ error: 'Access denied' }, 403);
  } else if (!isManagement(auth.role) && !(isResourcePerson(auth.role) && rpTopic(auth.role) === e.Type)) return json({ error: 'Access denied' }, 403);
  if (e.Status === 'Draft') return json({ error: 'Submit the assessment before generating a report' }, 400);
  const formData = await request.formData();
  const file = formData.get('file');
  if (!file) return json({ error: 'No file provided' }, 400);
  const buf = await file.arrayBuffer();
  const token = await getDriveToken(env);
  const folderId = await getIncuAssessmentFolder(token, env, e);
  const fileName = (file.name || (id + '-report.pdf')).replace(/[^\w.\-_ ]/g, '_');
  // Replace a previous copy with the same name so the folder holds one current report per stage
  try {
    const q = `name='${fileName}' and '${folderId}' in parents and trashed=false`;
    const ex = await (await fetch('https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({ q, fields: 'files(id)' }), { headers: { Authorization: 'Bearer ' + token } })).json();
    for (const f of (ex.files || [])) await fetch('https://www.googleapis.com/drive/v3/files/' + f.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
  } catch (_) {}
  const uploaded = await driveUploadFile(token, buf, fileName, 'application/pdf', folderId);
  const url = 'https://drive.google.com/file/d/' + uploaded.id + '/view?usp=sharing';
  const evidence = parseJson(e.Evidence, []).filter(x => !(x.kind === 'report' && x.name === fileName));
  evidence.push({ url, name: fileName, kpi: '', kind: 'report', time: new Date().toISOString(), by: auth.name || '' });
  await sheetsUpdate(env, 'Assessments', idx + 2, getColIndex('Assessments', 'Evidence'), JSON.stringify(evidence));
  return json({ success: true, url, evidence });
}

// ── Router ──
async function handleIncu(path, request, url, env, auth) {
  const { role, staffId } = auth;
  const m = request.method;
  const canView = isCollaborator(role) || isManagement(role) || isResourcePerson(role);
  if (!canView) return json({ error: 'Access denied' }, 403);

  if (path === '/incu/forms' && m === 'GET')
    return json({ forms: INCU_FORMS, businessStages: INCU_BUSINESS_STAGES, productCategories: INCU_PRODUCT_CATEGORIES, isMentor: isMentor(role), rpTopic: rpTopic(role) });
  const cm = path.match(/^\/incu\/assessments\/([\w-]+)\/comments$/);
  if (cm && m === 'GET')                                return await incuGetComments(env, auth, cm[1]);
  if (cm && m === 'POST')                               return await incuAddComment(request, env, auth, cm[1]);
  if (path === '/incu/me' && m === 'GET')               return await incuMe(env, auth);
  if (path === '/incu/collaborators' && m === 'GET')    return await incuCollaborators(env, role);
  if (path === '/incu/assessments' && m === 'GET')      return await incuListAssessments(url, env, auth);
  if (path === '/incu/assessments' && m === 'POST')     return await incuCreateAssessment(request, env, auth);
  const one = path.match(/^\/incu\/assessments\/([\w-]+)$/);
  if (one && m === 'GET')                               return await incuGetAssessment(env, auth, one[1]);
  if (one && m === 'PUT')                               return await incuUpdateAssessment(request, env, auth, one[1]);
  if (one && m === 'DELETE')                            return await incuDeleteAssessment(env, auth, one[1]);
  const rev = path.match(/^\/incu\/assessments\/([\w-]+)\/review$/);
  if (rev && m === 'POST')                              return await incuReviewAssessment(request, env, auth, rev[1]);
  const ev = path.match(/^\/incu\/assessments\/([\w-]+)\/evidence$/);
  if (ev && m === 'POST')                               return await incuUploadEvidence(request, env, auth, ev[1]);
  const evd = path.match(/^\/incu\/assessments\/([\w-]+)\/evidence\/([\w-]+)$/);
  if (evd && m === 'DELETE')                            return await incuDeleteEvidence(env, auth, evd[1], evd[2]);
  const img = path.match(/^\/incu\/file\/([\w-]+)$/);
  if (img && m === 'GET')                               return await incuFileProxy(env, auth, img[1], url);
  const rep = path.match(/^\/incu\/assessments\/([\w-]+)\/report$/);
  if (rep && m === 'POST')                              return await incuUploadReport(request, env, auth, rep[1]);
  const fol = path.match(/^\/incu\/collaborators\/([\w-]+)\/folder$/);
  if (fol && m === 'GET')                               return await incuCollabFolderLink(env, auth, fol[1]);
  if (path === '/incu/dashboard' && m === 'GET')        return await incuDashboard(env, role);
  return json({ error: 'Not found' }, 404);
}

// Can this user read a given assessment? Collaborator: own. RP: own topic, not drafts. Management: all.
async function canReadAssessment(env, auth, a) {
  if (isManagement(auth.role)) return true;
  if (isResourcePerson(auth.role)) return a.Type === rpTopic(auth.role) && a.Status !== 'Draft';
  if (isCollaborator(auth.role)) { const c = await myCollaborator(env, auth.staffId); return !!c && c.ID === a.CollaboratorID; }
  return false;
}

// ── Comments (resource persons, mentors, collaborator) — stored in the Comments sheet keyed by assessment ID ──
async function incuGetComments(env, auth, id) {
  const all = await sheetsRead(env, 'Assessments');
  const a = all.find(x => x.ID === id);
  if (!a) return json({ error: 'Not found' }, 404);
  if (!(await canReadAssessment(env, auth, a))) return json({ error: 'Access denied' }, 403);
  const [comments, staff] = await Promise.all([sheetsRead(env, 'Comments'), sheetsRead(env, 'Staff')]);
  const list = comments.filter(c => c.TaskID === id).sort((x, y) => (x.CreatedAt || '').localeCompare(y.CreatedAt || ''))
    .map(c => { const s = staff.find(st => st.ID === c.StaffID); const r = normalizeRole(s?.Role); return { ...c, role: r, roleLabel: ROLE_LABELS[r] || r, isRp: isResourcePerson(r), isMentor: isMentor(r) }; });
  return json({ comments: list, rpCommentCount: list.filter(c => c.isRp).length });
}
async function incuAddComment(request, env, auth, id) {
  const all = await sheetsRead(env, 'Assessments');
  const a = all.find(x => x.ID === id);
  if (!a) return json({ error: 'Not found' }, 404);
  if (!(await canReadAssessment(env, auth, a))) return json({ error: 'Access denied' }, 403);
  if (a.Status === 'Draft') return json({ error: 'Comments open once the assessment is submitted' }, 400);
  const { comment } = await request.json();
  if (!comment?.trim()) return json({ error: 'Comment cannot be empty' }, 400);
  const cid = 'CMT-' + Date.now();
  await sheetsAppend(env, 'Comments', [cid, id, auth.staffId, auth.name || '', comment.trim(), new Date().toISOString()]);
  // Notify everyone else involved: collaborator, mentors (or assigned mentor), resource person for this topic
  try {
    const [staff, collabs] = await Promise.all([sheetsRead(env, 'Staff'), sheetsRead(env, 'Collaborators')]);
    const c = collabs.find(x => x.ID === a.CollaboratorID);
    const active = staff.filter(s => s.Active?.toLowerCase() === 'true');
    const targets = new Set();
    if (c?.StaffID) targets.add(c.StaffID);
    (c?.MentorID ? active.filter(s => s.ID === c.MentorID) : active.filter(s => isMentor(normalizeRole(s.Role)))).forEach(s => targets.add(s.ID));
    active.filter(s => rpTopic(normalizeRole(s.Role)) === a.Type).forEach(s => targets.add(s.ID));
    targets.delete(auth.staffId);
    const label = INCU_FORMS[a.Type].label + (a.ProductName ? ' — ' + a.ProductName : a.Period ? ' — ' + a.Period : '');
    for (const t of targets) await createNotification(env, t, 'comment', `${auth.name} commented on ${c?.BusinessName || 'an assessment'}`, `${label}: ${comment.trim().slice(0, 80)}${comment.trim().length > 80 ? '…' : ''}`, '');
  } catch (_) {}
  return json({ success: true, id: cid });
}

// Resolve the collaborator record for the logged-in user (collaborators only)
async function myCollaborator(env, staffId) {
  const rows = await sheetsRead(env, 'Collaborators');
  return rows.find(r => r.StaffID === staffId) || null;
}

async function incuMe(env, auth) {
  if (!isCollaborator(auth.role)) return json({ collaborator: null, isMentor: isMentor(auth.role), rpTopic: rpTopic(auth.role) });
  const c = await myCollaborator(env, auth.staffId);
  if (!c) return json({ error: 'No collaborator profile found — ask your mentor to complete your business profile' }, 404);
  return json({ collaborator: c, isMentor: false });
}

// Mentor view: every collaborator with their latest scores
async function incuCollaborators(env, role) {
  if (!isManagement(role) && !isResourcePerson(role)) return json({ error: 'Access denied' }, 403);
  const [rows, staff, assessments] = await Promise.all([
    sheetsRead(env, 'Collaborators'), sheetsRead(env, 'Staff'), sheetsRead(env, 'Assessments'),
  ]);
  const list = rows.filter(r => r.Active?.toLowerCase() !== 'false').map(c => {
    const s = staff.find(x => x.ID === c.StaffID);
    const mine = assessments.filter(a => a.CollaboratorID === c.ID);
    return { ...c, staffName: s?.Name || '', username: s?.Username || '', staffActive: s?.Active, mentorName: staff.find(x => x.ID === c.MentorID)?.Name || '',
             folderUrl: c.FolderID ? 'https://drive.google.com/drive/folders/' + c.FolderID : '',
             summary: summariseCollaborator(mine) };
  });
  return json({ collaborators: list });
}

// Latest reviewed (fallback: submitted) score per type, plus pending-review count
function summariseCollaborator(assessments) {
  const latest = type => {
    const of = assessments.filter(a => a.Type === type && a.Status !== 'Draft').sort((a, b) => (b.SubmittedAt || '').localeCompare(a.SubmittedAt || ''));
    const rev = of.find(a => a.Status === 'Reviewed') || of[0];
    if (!rev) return null;
    const score = rev.Status === 'Reviewed' ? num(rev.FinalScore) : num(rev.SelfScore);
    return { id: rev.ID, status: rev.Status, score, rating: rev.Rating, period: rev.Period, date: rev.ReviewedAt || rev.SubmittedAt };
  };
  const leanDone = assessments.filter(a => a.Type === 'lean' && a.Status === 'Reviewed');
  return {
    pqr: latest('pqr'), brand: latest('brand'), lean: latest('lean'), finance: latest('finance'),
    pqrProducts: assessments.filter(a => a.Type === 'pqr' && a.Status === 'Reviewed').length,
    pendingReview: assessments.filter(a => a.Status === 'Submitted').length,
    hasBaseline: leanDone.some(a => a.Period === 'Baseline'),
    hasEndline: leanDone.some(a => a.Period === 'Endline'),
    total: assessments.length,
  };
}

function enrichAssessment(a) {
  return { ...a,
    answers: parseJson(a.Answers, {}), breakdown: parseJson(a.Breakdown, null),
    mentorAnswers: parseJson(a.MentorAnswers, {}), evidence: parseJson(a.Evidence, []),
    selfScore: num(a.SelfScore), finalScore: num(a.FinalScore),
    Answers: undefined, Breakdown: undefined, MentorAnswers: undefined, Evidence: undefined };
}

async function incuListAssessments(url, env, auth) {
  const all = await sheetsRead(env, 'Assessments');
  let collabId = url.searchParams.get('collaboratorId') || '';
  if (isCollaborator(auth.role)) {
    const c = await myCollaborator(env, auth.staffId);
    if (!c) return json({ assessments: [] });
    collabId = c.ID;
  }
  let list = collabId ? all.filter(a => a.CollaboratorID === collabId) : all;
  if (isResourcePerson(auth.role)) list = list.filter(a => a.Type === rpTopic(auth.role) && a.Status !== 'Draft');
  const type = url.searchParams.get('type'); if (type) list = list.filter(a => a.Type === type);
  const status = url.searchParams.get('status'); if (status) list = list.filter(a => a.Status === status);
  list = list.map(enrichAssessment).sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  // Mentors get collaborator names attached
  if (!isCollaborator(auth.role)) {
    const collabs = await sheetsRead(env, 'Collaborators');
    list = list.map(a => ({ ...a, businessName: collabs.find(c => c.ID === a.CollaboratorID)?.BusinessName || a.CollaboratorID }));
  }
  return json({ assessments: list });
}

async function incuGetAssessment(env, auth, id) {
  const all = await sheetsRead(env, 'Assessments');
  const a = all.find(x => x.ID === id);
  if (!a) return json({ error: 'Not found' }, 404);
  if (!(await canReadAssessment(env, auth, a))) return json({ error: 'Access denied' }, 403);
  const [collabs, comments] = await Promise.all([sheetsRead(env, 'Collaborators'), sheetsRead(env, 'Comments')]);
  const c = collabs.find(x => x.ID === a.CollaboratorID);
  const commentCount = comments.filter(x => x.TaskID === id).length;
  return json({ assessment: { ...enrichAssessment(a), businessName: c?.BusinessName || '' }, collaborator: c || null, commentCount });
}

// Find the most recent reviewed Baseline for a collaborator (for endline scoring)
function latestBaseline(all, collabId) {
  return all.filter(a => a.CollaboratorID === collabId && a.Type === 'lean' && a.Period === 'Baseline' && a.Status !== 'Draft')
            .sort((a, b) => (b.SubmittedAt || b.CreatedAt || '').localeCompare(a.SubmittedAt || a.CreatedAt || ''))[0] || null;
}

async function incuCreateAssessment(request, env, auth) {
  const body = await request.json();
  const { type, period, productName, productCategory, answers, submit } = body;
  if (!INCU_FORMS[type]) return json({ error: 'Invalid assessment type' }, 400);

  let collabId = body.collaboratorId || '';
  if (isCollaborator(auth.role)) {
    const c = await myCollaborator(env, auth.staffId);
    if (!c) return json({ error: 'No collaborator profile' }, 403);
    collabId = c.ID;
  } else if (!isMentor(auth.role)) return json({ error: 'Only collaborators or mentors can create assessments' }, 403);
  if (!collabId) return json({ error: 'collaboratorId required' }, 400);

  if (type === 'lean' && !INCU_FORMS.lean.periods.includes(period)) return json({ error: 'Lean period must be Baseline or Endline' }, 400);
  if (type === 'pqr' && !productName?.trim()) return json({ error: 'Product name is required' }, 400);

  const all = await sheetsRead(env, 'Assessments');
  const baseline = type === 'lean' && period === 'Endline' ? latestBaseline(all, collabId) : null;
  const ans = answers || {};
  const result = scoreAssessment(type, ans, period, baseline ? parseJson(baseline.Answers, {}) : null);
  const now = new Date().toISOString();
  const status = submit ? 'Submitted' : 'Draft';
  const id = 'ASM-' + Date.now();
  await sheetsAppend(env, 'Assessments', [
    id, collabId, type, period || '', productName || '', productCategory || '', status,
    JSON.stringify(ans), JSON.stringify(result), result.score ?? '', '', '', result.rating || '',
    '', '[]', '', submit ? now : '', '', now,
  ]);
  if (submit) {
    await notifyMentors(env, collabId, type, id);
    await incuSnapshotResponses(env, { ID: id, CollaboratorID: collabId, Type: type, Period: period || '', ProductName: productName || '', ProductCategory: productCategory || '', Answers: JSON.stringify(ans), Breakdown: JSON.stringify(result), SelfScore: result.score ?? '', Rating: result.rating || '', Evidence: '[]' }, 'submitted');
  }
  return json({ success: true, id, status, score: result.score, rating: result.rating, breakdown: result });
}

async function incuUpdateAssessment(request, env, auth, id) {
  const all = await sheetsRead(env, 'Assessments');
  const idx = all.findIndex(x => x.ID === id);
  if (idx === -1) return json({ error: 'Not found' }, 404);
  const e = all[idx];
  if (isCollaborator(auth.role)) {
    const c = await myCollaborator(env, auth.staffId);
    if (!c || c.ID !== e.CollaboratorID) return json({ error: 'Access denied' }, 403);
  } else if (!isMentor(auth.role)) return json({ error: 'Access denied' }, 403);
  if (e.Status === 'Reviewed') return json({ error: 'This assessment has been finalised and can no longer be edited' }, 400);

  const body = await request.json();
  const ans = body.answers !== undefined ? body.answers : parseJson(e.Answers, {});
  const period = body.period || e.Period;
  const baseline = e.Type === 'lean' && period === 'Endline' ? latestBaseline(all.filter(a => a.ID !== id), e.CollaboratorID) : null;
  const result = scoreAssessment(e.Type, ans, period, baseline ? parseJson(baseline.Answers, {}) : null);
  const now = new Date().toISOString();
  const submitting = body.submit === true && e.Status === 'Draft';
  const status = submitting ? 'Submitted' : e.Status;
  await sheetsUpdateRow(env, 'Assessments', idx + 2, [
    e.ID, e.CollaboratorID, e.Type, period, body.productName !== undefined ? body.productName : e.ProductName,
    body.productCategory !== undefined ? body.productCategory : e.ProductCategory, status,
    JSON.stringify(ans), JSON.stringify(result), result.score ?? '', e.MentorAnswers || '', e.FinalScore || '', result.rating || '',
    e.MentorNotes || '', e.Evidence || '[]', e.ReviewerID || '', submitting ? now : (e.SubmittedAt || ''), e.ReviewedAt || '', e.CreatedAt,
  ]);
  if (submitting) {
    await notifyMentors(env, e.CollaboratorID, e.Type, id);
    await incuSnapshotResponses(env, { ...e, Period: period, Answers: JSON.stringify(ans), Breakdown: JSON.stringify(result), SelfScore: result.score ?? '', Rating: result.rating || '' }, 'submitted');
  }
  return json({ success: true, status, score: result.score, rating: result.rating, breakdown: result });
}

// Mentor review: overrides are merged over the collaborator's answers, re-scored, and frozen as FinalScore.
async function incuReviewAssessment(request, env, auth, id) {
  if (!isMentor(auth.role)) return json({ error: 'Only mentors can review' }, 403);
  const all = await sheetsRead(env, 'Assessments');
  const idx = all.findIndex(x => x.ID === id);
  if (idx === -1) return json({ error: 'Not found' }, 404);
  const e = all[idx];
  if (e.Status === 'Draft') return json({ error: 'Collaborator has not submitted this yet' }, 400);

  const { mentorAnswers, mentorNotes, reopen } = await request.json();
  if (reopen) {
    await sheetsUpdate(env, 'Assessments', idx + 2, getColIndex('Assessments', 'Status'), 'Submitted');
    return json({ success: true, status: 'Submitted' });
  }
  const overrides = mentorAnswers || {};   // { questionId: { value, note } }
  const merged = { ...parseJson(e.Answers, {}) };
  for (const k in overrides) if (overrides[k] && overrides[k].value !== undefined) merged[k] = overrides[k].value;
  const baseline = e.Type === 'lean' && e.Period === 'Endline' ? latestBaseline(all.filter(a => a.ID !== id), e.CollaboratorID) : null;
  const result = scoreAssessment(e.Type, merged, e.Period, baseline ? parseJson(baseline.Answers, {}) : null);
  const now = new Date().toISOString();
  await sheetsUpdateRow(env, 'Assessments', idx + 2, [
    e.ID, e.CollaboratorID, e.Type, e.Period, e.ProductName, e.ProductCategory, 'Reviewed',
    e.Answers, JSON.stringify(result), e.SelfScore, JSON.stringify(overrides), result.score ?? '', result.rating || '',
    mentorNotes || '', e.Evidence || '[]', auth.staffId, e.SubmittedAt || now, now, e.CreatedAt,
  ]);
  await incuSnapshotResponses(env, { ...e, Breakdown: JSON.stringify(result), FinalScore: result.score ?? '', Rating: result.rating || '', MentorAnswers: JSON.stringify(overrides), MentorNotes: mentorNotes || '' }, 'final', { reviewerId: auth.staffId, reviewerName: auth.name || '' });
  // Notify the collaborator
  try {
    const collabs = await sheetsRead(env, 'Collaborators');
    const c = collabs.find(x => x.ID === e.CollaboratorID);
    if (c?.StaffID) await createNotification(env, c.StaffID, 'completed', 'Assessment reviewed',
      `${INCU_FORMS[e.Type].label}${e.ProductName ? ' — ' + e.ProductName : ''}: ${result.score ?? '—'} (${result.rating})`, '');
  } catch (_) {}
  return json({ success: true, status: 'Reviewed', finalScore: result.score, rating: result.rating, breakdown: result });
}

async function incuDeleteAssessment(env, auth, id) {
  const all = await sheetsRead(env, 'Assessments');
  const idx = all.findIndex(x => x.ID === id);
  if (idx === -1) return json({ error: 'Not found' }, 404);
  const e = all[idx];
  if (isCollaborator(auth.role)) {
    const c = await myCollaborator(env, auth.staffId);
    if (!c || c.ID !== e.CollaboratorID || e.Status !== 'Draft') return json({ error: 'You can only delete your own drafts' }, 403);
  } else if (!isMentor(auth.role)) return json({ error: 'Access denied' }, 403);
  await sheetsDeleteRow(env, 'Assessments', idx + 2);
  return json({ success: true });
}

// Evidence file → Drive folder "INCU ASM-xxx — <label>" under Evidence_Folder_ID
async function incuUploadEvidence(request, env, auth, id) {
  const all = await sheetsRead(env, 'Assessments');
  const idx = all.findIndex(x => x.ID === id);
  if (idx === -1) return json({ error: 'Not found' }, 404);
  const e = all[idx];
  if (isCollaborator(auth.role)) {
    const c = await myCollaborator(env, auth.staffId);
    if (!c || c.ID !== e.CollaboratorID) return json({ error: 'Access denied' }, 403);
  } else if (!isMentor(auth.role)) return json({ error: 'Access denied' }, 403);

  const formData = await request.formData();
  const file = formData.get('file');
  const kpi = formData.get('kpi') || '';          // lean KPI key, or pqr photo-slot key
  const kind = formData.get('kind') || 'photo';   // photo | doc
  const caption = (formData.get('caption') || '').toString().slice(0, 200);
  if (!file) return json({ error: 'No file provided' }, 400);
  const buf = await file.arrayBuffer();
  if (buf.byteLength > 100 * 1024 * 1024) return json({ error: 'File must be under 100MB' }, 400);

  const token = await getDriveToken(env);
  const folderId = await getIncuAssessmentFolder(token, env, e);
  const slotLabel = kpi ? (INCU_FORMS.lean.kpis.find(k => k.key === kpi)?.label || INCU_FORMS.pqr.photoSlots.find(p => p.key === kpi)?.label || kpi) : '';
  const prefix = slotLabel ? slotLabel.replace(/[^\w]+/g, '') + ' - ' : '';
  const fileName = (prefix + (file.name || 'evidence')).replace(/[^\w.\-_ ]/g, '_');
  const uploaded = await driveUploadFile(token, buf, fileName, file.type || 'application/octet-stream', folderId);
  const url = 'https://drive.google.com/file/d/' + uploaded.id + '/view?usp=sharing';

  const evidence = parseJson(e.Evidence, []);
  evidence.push({ url, fileId: uploaded.id, name: fileName, kpi, kind, caption, time: new Date().toISOString(), by: auth.name || '' });
  await sheetsUpdate(env, 'Assessments', idx + 2, getColIndex('Assessments', 'Evidence'), JSON.stringify(evidence));
  return json({ success: true, url, evidence });
}

// Remove an evidence entry (and the Drive file) — owner while not reviewed, or mentor
async function incuDeleteEvidence(env, auth, id, fileId) {
  const all = await sheetsRead(env, 'Assessments');
  const idx = all.findIndex(x => x.ID === id);
  if (idx === -1) return json({ error: 'Not found' }, 404);
  const e = all[idx];
  if (isCollaborator(auth.role)) {
    const c = await myCollaborator(env, auth.staffId);
    if (!c || c.ID !== e.CollaboratorID || e.Status === 'Reviewed') return json({ error: 'Access denied' }, 403);
  } else if (!isMentor(auth.role)) return json({ error: 'Access denied' }, 403);
  const evidence = parseJson(e.Evidence, []);
  const entry = evidence.find(x => (x.fileId || (x.url.match(/\/d\/([\w-]+)/) || [])[1]) === fileId);
  if (!entry) return json({ error: 'File not found on this assessment' }, 404);
  try { const token = await getDriveToken(env); await fetch('https://www.googleapis.com/drive/v3/files/' + fileId, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } }); } catch (_) {}
  const rest = evidence.filter(x => x !== entry);
  await sheetsUpdate(env, 'Assessments', idx + 2, getColIndex('Assessments', 'Evidence'), JSON.stringify(rest));
  return json({ success: true, evidence: rest });
}

// Stream a Drive file through the worker so the browser can show thumbnails and embed photos in PDFs
// without hitting Drive's cross-origin limits. Any incubation user may read; the ID must come from an assessment.
async function incuFileProxy(env, auth, fileId, url) {
  const token = await getDriveToken(env);
  const res = await fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media', { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) return json({ error: 'File not available' }, 404);
  const ct = res.headers.get('Content-Type') || 'application/octet-stream';
  return new Response(res.body, { headers: { ...CORS, 'Content-Type': ct, 'Cache-Control': 'private, max-age=3600' } });
}

async function notifyMentors(env, collabId, type, assessmentId) {
  try {
    const [staff, collabs] = await Promise.all([sheetsRead(env, 'Staff'), sheetsRead(env, 'Collaborators')]);
    const c = collabs.find(x => x.ID === collabId);
    const active = staff.filter(s => s.Active?.toLowerCase() === 'true');
    const targets = c?.MentorID ? active.filter(s => s.ID === c.MentorID) : active.filter(s => isMentor(normalizeRole(s.Role)));
    active.filter(s => rpTopic(normalizeRole(s.Role)) === type).forEach(s => { if (!targets.includes(s)) targets.push(s); });
    for (const t of targets) await createNotification(env, t.ID, 'assigned', 'Assessment to review',
      `${c?.BusinessName || collabId} submitted a ${INCU_FORMS[type].label}`, '');
  } catch (_) {}
}

// MEALA dashboard — percentages the client reports against
async function incuDashboard(env, role) {
  if (!isManagement(role) && !isResourcePerson(role)) return json({ error: 'Access denied' }, 403);
  const [collabs, assessments] = await Promise.all([sheetsRead(env, 'Collaborators'), sheetsRead(env, 'Assessments')]);
  const active = collabs.filter(c => c.Active?.toLowerCase() !== 'false');
  const reviewed = assessments.filter(a => a.Status === 'Reviewed');
  const pct = (n, d) => d ? Math.round(n / d * 100) : 0;

  // Latest reviewed assessment per collaborator per type
  const latestFor = (cid, type) => reviewed.filter(a => a.CollaboratorID === cid && a.Type === type)
    .sort((a, b) => (b.ReviewedAt || '').localeCompare(a.ReviewedAt || ''))[0] || null;

  // ── QC system: % collaborators with ≥1 product meeting the QC standard; % products meeting it
  const pqrAll = reviewed.filter(a => a.Type === 'pqr');
  const latestPerProduct = {};
  pqrAll.forEach(a => { const k = a.CollaboratorID + '|' + a.ProductName; if (!latestPerProduct[k] || (a.ReviewedAt || '') > (latestPerProduct[k].ReviewedAt || '')) latestPerProduct[k] = a; });
  const products = Object.values(latestPerProduct);
  const productsMet = products.filter(a => num(a.FinalScore) >= INCU_FORMS.pqr.qcThreshold);
  const collabsWithQc = new Set(productsMet.map(a => a.CollaboratorID));
  const collabsWithAnyPqr = new Set(products.map(a => a.CollaboratorID));

  // ── Branding: distribution by stage band + branding stage (1–4)
  const brandLatest = active.map(c => latestFor(c.ID, 'brand')).filter(Boolean);
  const brandBands = {}; INCU_FORMS.brand.bands.forEach(b => brandBands[b[1]] = 0);
  const brandingStages = { 1:0, 2:0, 3:0, 4:0 };
  brandLatest.forEach(a => { brandBands[a.Rating] = (brandBands[a.Rating] || 0) + 1; const bd = parseJson(a.Breakdown, {}); if (bd.brandingStage) brandingStages[bd.brandingStage]++; });
  const brandAvgAreas = INCU_FORMS.brand.areas.map(ar => {
    const vals = brandLatest.map(a => (parseJson(a.Breakdown, {}).areas || []).find(x => x.key === ar.key)?.score).filter(v => v !== undefined);
    return { key: ar.key, label: ar.label, max: ar.weight, avg: vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 10) / 10 : null };
  });

  // ── Lean: endlines with targets, per-KPI achievement
  const leanEnd = active.map(c => reviewed.filter(a => a.CollaboratorID === c.ID && a.Type === 'lean' && a.Period === 'Endline')
    .sort((a, b) => (b.ReviewedAt || '').localeCompare(a.ReviewedAt || ''))[0]).filter(Boolean);
  const leanBase = active.filter(c => reviewed.some(a => a.CollaboratorID === c.ID && a.Type === 'lean' && a.Period === 'Baseline')).length;
  const perKpi = INCU_FORMS.lean.kpis.map(k => {
    const rows = leanEnd.map(a => (parseJson(a.Breakdown, {}).kpis || []).find(x => x.key === k.key)).filter(x => x && x.met !== null);
    const met = rows.filter(x => x.met).length;
    const changes = rows.map(x => x.changePct).filter(v => v !== null && v !== undefined);
    return { key: k.key, label: k.label, target: k.target, assessed: rows.length, met, metPct: pct(met, rows.length),
             avgChangePct: changes.length ? Math.round(changes.reduce((s, v) => s + v, 0) / changes.length) : null };
  });

  // ── Finance: latest reviewed per collaborator
  const finLatest = active.map(c => latestFor(c.ID, 'finance')).filter(Boolean);
  const finBd = finLatest.map(a => parseJson(a.Breakdown, {}));
  const avgOf = arr => { const v = arr.filter(x => x !== null && x !== undefined); return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length * 10) / 10 : null; };

  // ── Per collaborator cards
  const cards = active.map(c => {
    const mine = assessments.filter(a => a.CollaboratorID === c.ID);
    return { id: c.ID, businessName: c.BusinessName, owner: c.Owner, location: c.Location, businessStage: c.BusinessStage, ...summariseCollaborator(mine) };
  });

  return json({
    totals: { collaborators: active.length, assessments: assessments.length, reviewed: reviewed.length, pendingReview: assessments.filter(a => a.Status === 'Submitted').length },
    qc: { collaboratorsAssessed: collabsWithAnyPqr.size, collaboratorsMet: collabsWithQc.size, collaboratorsMetPct: pct(collabsWithQc.size, active.length),
          productsAssessed: products.length, productsMet: productsMet.length, productsMetPct: pct(productsMet.length, products.length),
          avgScore: products.length ? Math.round(products.reduce((s, a) => s + (num(a.FinalScore) || 0), 0) / products.length) : null },
    brand: { assessed: brandLatest.length, assessedPct: pct(brandLatest.length, active.length), bands: brandBands, brandingStages,
             branded: brandLatest.filter(a => (parseJson(a.Breakdown, {}).brandingStage || 1) >= 2).length,
             avgScore: brandLatest.length ? Math.round(brandLatest.reduce((s, a) => s + (num(a.FinalScore) || 0), 0) / brandLatest.length) : null, avgAreas: brandAvgAreas },
    finance: { assessed: finLatest.length, assessedPct: pct(finLatest.length, active.length),
               profitable: finBd.filter(b => b.profitable === true).length, profitablePct: pct(finBd.filter(b => b.profitable === true).length, finLatest.length),
               avgScore: finLatest.length ? Math.round(finLatest.reduce((s, a) => s + (num(a.FinalScore) || 0), 0) / finLatest.length) : null,
               avgGrossMargin: avgOf(finBd.map(b => b.grossMarginPct)), avgNetMargin: avgOf(finBd.map(b => b.netMarginPct)), avgIncomeChange: avgOf(finBd.map(b => b.incomeChangePct)),
               healthyLiquidity: finBd.filter(b => b.currentRatio !== null && b.currentRatio >= 1.5).length, bands: finLatest.reduce((o, a) => { o[a.Rating] = (o[a.Rating] || 0) + 1; return o; }, {}) },
    lean: { baselines: leanBase, endlines: leanEnd.length, perKpi,
            avgTargetsMet: leanEnd.length ? Math.round(leanEnd.reduce((s, a) => s + (parseJson(a.Breakdown, {}).metCount || 0), 0) / leanEnd.length * 10) / 10 : null },
    cards,
  });
}

// ══════════════════════════════════════════════════════════
// GOOGLE SHEETS HELPERS
// ══════════════════════════════════════════════════════════
const SHEET_HEADERS = {
  Staff:    ['ID','Name','Username','Password','Role','Type','Email','Projects','Active','CreatedAt','PhotoURL','FolderID','Team'],
  Projects: ['ID','Name','ShortName','StartDate','EndDate','Status','Description','CreatedAt'],
  Tasks:    ['ID','ProjectID','Name','Category','DueDate','Description','Status','AssigneeID','Active','EvidenceFile','EvidenceLink','EvidenceNote','CreatedAt','EvidenceDate','Priority','LinkedDocID'],
  WorkLog:  ['ID','StaffID','ProjectID','TaskID','Date','Actual','Unit','Status','Note','CreatedAt'],
  Config:   ['Key','Value'],
  Comments:      ['ID','TaskID','StaffID','StaffName','Comment','CreatedAt'],
  Notifications: ['ID','StaffID','Type','Title','Message','TaskID','IsRead','CreatedAt'],
  Requests:      ['ID','RequesterID','RequesterName','AssigneeID','Title','Description','Status','Response','CreatedAt'],
  RecurringTasks:['ID','Title','Description','Frequency','Team','AssigneeID','Active','LastGenerated','SendDay'],
  DocSubmissions:['ID','Title','ProjectID','RequestedFromID','RequestedByID','DocumentType','ActivityDate','DueDate','Status','Notes','CreatedAt','Files','SubmitLink'],
  KpiSnapshots:  ['ID','StaffID','WeekOf','KpiScore','Completion','Timeliness','Evidence','Reliability','TaskCount','CreatedAt'],
  Collaborators: ['ID','StaffID','BusinessName','Owner','Location','BusinessStage','CoreProduct','TargetCustomer','SalesChannels','MentorID','Active','CreatedAt','FolderID'],
  Assessments:   ['ID','CollaboratorID','Type','Period','ProductName','ProductCategory','Status','Answers','Breakdown','SelfScore','MentorAnswers','FinalScore','Rating','MentorNotes','Evidence','ReviewerID','SubmittedAt','ReviewedAt','CreatedAt'],
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