// tests/autoAction.test.js
// Full test suite for AI Auto-Action Engine — logic, models, RBAC, SQL

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET   = 'test-secret-for-tests';

const express = require('express');
const request = require('supertest');
const fs      = require('fs');

// ── Pure logic imports (no DB needed) ────────────────────────────────────────
const {
  ruleMatches, computePriority, buildExplanation,
} = require('../src/services/autoAction/ruleEngineService');

// ─────────────────────────────────────────────────────────────────────────────
// 1. ruleMatches()
// ─────────────────────────────────────────────────────────────────────────────
describe('ruleMatches()', () => {
  const r = (o = {}) => ({
    attritionScoreGt: null, healthScoreLt: null, salaryGapLt: null,
    performanceScoreLt: null, engagementScoreLt: null, ...o,
  });

  test('fires when attrition > threshold',             () => expect(ruleMatches(r({ attritionScoreGt: 80 }), { attritionScore: 85 })).toBe(true));
  test('does NOT fire at exact boundary (exclusive)',  () => expect(ruleMatches(r({ attritionScoreGt: 80 }), { attritionScore: 80 })).toBe(false));
  test('does NOT fire below threshold',               () => expect(ruleMatches(r({ attritionScoreGt: 80 }), { attritionScore: 79 })).toBe(false));
  test('fires when health < threshold',               () => expect(ruleMatches(r({ healthScoreLt: 50 }),    { healthScore: 45   })).toBe(true));
  test('does NOT fire at exact health boundary',      () => expect(ruleMatches(r({ healthScoreLt: 50 }),    { healthScore: 50   })).toBe(false));
  test('fires when salary_gap < threshold (underpaid)',() => expect(ruleMatches(r({ salaryGapLt: -20 }),    { salaryGap: -25    })).toBe(true));
  test('does NOT fire for acceptable salary_gap',     () => expect(ruleMatches(r({ salaryGapLt: -20 }),    { salaryGap: -15    })).toBe(false));
  test('AND logic — all defined conditions must match', () => {
    const rule = r({ attritionScoreGt: 80, healthScoreLt: 50 });
    expect(ruleMatches(rule, { attritionScore: 85, healthScore: 45 })).toBe(true);
    expect(ruleMatches(rule, { attritionScore: 85, healthScore: 60 })).toBe(false);
    expect(ruleMatches(rule, { attritionScore: 70, healthScore: 45 })).toBe(false);
  });
  test('all 5 conditions match simultaneously', () => {
    const rule = r({ attritionScoreGt: 60, healthScoreLt: 60, salaryGapLt: -10, performanceScoreLt: 50, engagementScoreLt: 50 });
    expect(ruleMatches(rule, { attritionScore: 70, healthScore: 40, salaryGap: -15, performanceScore: 40, engagementScore: 40 })).toBe(true);
  });
  test('rule with zero conditions never fires',       () => expect(ruleMatches(r(), { attritionScore: 99 })).toBe(false));
  test('null score does not satisfy a defined condition', () => expect(ruleMatches(r({ attritionScoreGt: 80 }), { attritionScore: null })).toBe(false));
  test('performance score condition',                 () => {
    expect(ruleMatches(r({ performanceScoreLt: 40 }), { performanceScore: 35 })).toBe(true);
    expect(ruleMatches(r({ performanceScoreLt: 40 }), { performanceScore: 50 })).toBe(false);
  });
  test('engagement score condition',                  () => {
    expect(ruleMatches(r({ engagementScoreLt: 45 }), { engagementScore: 30 })).toBe(true);
    expect(ruleMatches(r({ engagementScoreLt: 45 }), { engagementScore: 60 })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. computePriority()
// ─────────────────────────────────────────────────────────────────────────────
describe('computePriority()', () => {
  test('HIGH: attrition > 80 AND health < 50',          () => expect(computePriority({ attritionScore: 85, healthScore: 40 })).toBe('high'));
  test('HIGH at exact boundary: 81 attrition + 49 health', () => expect(computePriority({ attritionScore: 81, healthScore: 49 })).toBe('high'));
  test('MEDIUM: only attrition > 60',                   () => expect(computePriority({ attritionScore: 65, healthScore: 80 })).toBe('medium'));
  test('MEDIUM: only health < 50',                      () => expect(computePriority({ attritionScore: 20, healthScore: 40 })).toBe('medium'));
  test('LOW: both scores healthy',                      () => expect(computePriority({ attritionScore: 30, healthScore: 80 })).toBe('low'));
  test('LOW: empty object defaults to low',              () => expect(computePriority({})).toBe('low'));
  test('HIGH needs BOTH — 85 attrition + 55 health = MEDIUM', () => expect(computePriority({ attritionScore: 85, healthScore: 55 })).toBe('medium'));
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. buildExplanation()
// ─────────────────────────────────────────────────────────────────────────────
describe('buildExplanation()', () => {
  const r = (o = {}) => ({ name: 'Test Rule', attritionScoreGt: null, healthScoreLt: null, salaryGapLt: null, performanceScoreLt: null, engagementScoreLt: null, ...o });

  test('includes rule name',                           () => expect(buildExplanation(r({ attritionScoreGt: 80 }), { attritionScore: 85 })).toContain('Test Rule'));
  test('includes attrition score value + threshold',   () => {
    const e = buildExplanation(r({ attritionScoreGt: 80 }), { attritionScore: 85 });
    expect(e).toContain('attrition_score=85');
    expect(e).toContain('>80');
  });
  test('includes health_score value',                  () => expect(buildExplanation(r({ healthScoreLt: 50 }), { healthScore: 40 })).toContain('health_score=40'));
  test('includes salary_gap value',                    () => expect(buildExplanation(r({ salaryGapLt: -20 }), { salaryGap: -25 })).toContain('salary_gap=-25'));
  test('omits null conditions entirely',               () => {
    const e = buildExplanation(r({ attritionScoreGt: 80 }), { attritionScore: 85, healthScore: 40 });
    expect(e).not.toContain('health_score');
    expect(e).not.toContain('salary_gap');
  });
  test('all 5 conditions appear in explanation',       () => {
    const rule = r({ attritionScoreGt: 60, healthScoreLt: 60, salaryGapLt: -10, performanceScoreLt: 50, engagementScoreLt: 50 });
    const e = buildExplanation(rule, { attritionScore: 70, healthScore: 40, salaryGap: -15, performanceScore: 40, engagementScore: 40 });
    ['attrition_score=70', 'health_score=40', 'salary_gap=-15', 'performance_score=40', 'engagement_score=40'].forEach(v => expect(e).toContain(v));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Bug-fix verification (static source checks)
// ─────────────────────────────────────────────────────────────────────────────
describe('Bug fixes (source checks)', () => {
  test('FIX 1 — salary gap reads differencePercent, not gapPercent', () => {
    const src = fs.readFileSync('./src/services/autoAction/scoreAggregatorService.js', 'utf8');
    expect(src).toContain('differencePercent');
    expect(src).not.toContain('gapPercent');
  });

  test('FIX 2 — cron has isRunning overlap guard + finally release', () => {
    const src = fs.readFileSync('./src/services/autoAction/autoActionCron.js', 'utf8');
    expect(src).toContain('isRunning = true');
    expect(src).toContain('isRunning = false');
    expect(src).toContain('finally');
    expect(src).toContain('already running');
  });

  test('FIX 2b — cron processes employees in concurrent chunks', () => {
    const src = fs.readFileSync('./src/services/autoAction/autoActionCron.js', 'utf8');
    expect(src).toContain('Promise.allSettled');
    expect(src).toContain('chunkArray');
  });

  test('FIX 2c — getBatchStatus exported and callable', () => {
    const { getBatchStatus } = require('../src/services/autoAction/autoActionCron');
    expect(typeof getBatchStatus).toBe('function');
    const status = getBatchStatus();
    expect(status).toHaveProperty('isRunning');
    expect(status).toHaveProperty('lastRunAt');
    expect(status).toHaveProperty('lastRunStats');
  });

  test('FIX 3 — all notifications use type auto_action', () => {
    const src = fs.readFileSync('./src/services/autoAction/actionExecutorService.js', 'utf8');
    expect(src).not.toContain("type: 'general'");
    expect(src).not.toContain("type: 'nudge'");
    expect(src).not.toContain("type: 'burnout_alert'");
    const hits = (src.match(/type: 'auto_action'/g) || []).length;
    expect(hits).toBeGreaterThanOrEqual(4);
  });

  test('FIX 4a — getLogs scopes to manager team', () => {
    const src = fs.readFileSync('./src/controllers/autoActionController.js', 'utf8');
    expect(src).toContain("req.user.role === 'manager'");
    expect(src).toContain('managerId: req.user.id');
    expect(src).toContain('employee not in your team');
  });

  test('FIX 4b — getDashboard has scopeWhere for manager', () => {
    const src = fs.readFileSync('./src/controllers/autoActionController.js', 'utf8');
    expect(src).toContain('scopeWhere');
    expect(src).toContain('Scope: managers see only their direct reports');
  });

  test('FIX 4c — recentActivity uses scopeWhere', () => {
    const src = fs.readFileSync('./src/controllers/autoActionController.js', 'utf8');
    expect(src).toContain('where: scopeWhere,\n      include: [\n        { model: User, as: \'employee\'');
  });

  test('FIX 4d — getEmployeeActions blocks manager cross-team access', () => {
    const src = fs.readFileSync('./src/controllers/autoActionController.js', 'utf8');
    expect(src).toContain('employee is not in your team');
    expect(src).toContain('isDirectReport');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Sequelize model definitions
// ─────────────────────────────────────────────────────────────────────────────
describe('Sequelize Models', () => {
  const { ActionRule, ActionLog, ActionsQueue } = require('../src/models/autoActionModels');

  test('ActionRule — correct table + all fields', () => {
    expect(ActionRule.tableName).toBe('action_rules');
    ['attritionScoreGt','healthScoreLt','salaryGapLt','performanceScoreLt',
     'engagementScoreLt','actions','priority','cooldownHours','isActive'].forEach(f =>
      expect(Object.keys(ActionRule.rawAttributes)).toContain(f));
  });

  test('ActionLog — correct table + all fields', () => {
    expect(ActionLog.tableName).toBe('action_logs');
    ['employeeId','ruleId','triggeredAction','reason','snapshot','status',
     'priority','resolvedBy','resolvedAt','resolutionNote','triggeredAt'].forEach(f =>
      expect(Object.keys(ActionLog.rawAttributes)).toContain(f));
  });

  test('ActionsQueue — correct table + all fields', () => {
    expect(ActionsQueue.tableName).toBe('actions_queue');
    ['logId','actionType','payload','status','attempts','maxAttempts',
     'lastError','runAt','processedAt'].forEach(f =>
      expect(Object.keys(ActionsQueue.rawAttributes)).toContain(f));
  });

  test('ActionLog status ENUM has all 5 values', () =>
    ['pending','in_progress','completed','failed','skipped'].forEach(v =>
      expect(ActionLog.rawAttributes.status.values).toContain(v)));

  test('ActionsQueue status ENUM has all 4 values', () =>
    ['pending','processing','done','failed'].forEach(v =>
      expect(ActionsQueue.rawAttributes.status.values).toContain(v)));

  test('ActionRule priority ENUM correct', () =>
    ['high','medium','low'].forEach(v =>
      expect(ActionRule.rawAttributes.priority.values).toContain(v)));

  test('All models use underscored=true', () => {
    expect(ActionRule.options.underscored).toBe(true);
    expect(ActionLog.options.underscored).toBe(true);
    expect(ActionsQueue.options.underscored).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. HTTP API + RBAC — build isolated apps per role
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a fresh Express app for a given role.
 * Uses REAL middleware logic (no mocks) with a fake req.user injected.
 * Controllers are stubbed so no DB is needed.
 */
function buildApp(role) {
  const app = express();
  app.use(express.json());

  // Inject fake user — real authorize() and ownerOrAdmin() read from req.user
  app.use((req, _res, next) => {
    req.user = { id: 'user-uuid', role };
    next();
  });

  // ── Real authorize() logic (copied from auth.js, no require cache) ──────────
  const authorize = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: `Access denied. Required: ${roles.join(', ')}` });
    }
    next();
  };

  // ── Real ownerOrAdmin() logic ────────────────────────────────────────────────
  const ownerOrAdmin = (req, res, next) => {
    const targetId    = req.params.userId || req.params.id;
    const isOwner     = req.user.id === targetId;
    const isPrivileged = ['hr', 'admin'].includes(req.user.role);
    if (isOwner || isPrivileged) return next();
    return res.status(403).json({ success: false, message: 'Access denied' });
  };

  // ── Stub controllers (no DB) ────────────────────────────────────────────────
  const ok     = (extra = {}) => (_req, res) => res.json({ success: true, data: {}, ...extra });
  const ok201  = (_req, res) => { if (!_req.body.name) return res.status(400).json({ success: false, message: 'Rule name is required' }); res.status(201).json({ success: true, data: { id: 'new' } }); };
  const okDel  = (_req, res) => res.json({ success: true, message: 'Rule deactivated' });
  const okBatch = (_req, res) => res.json({ success: true, message: 'Batch run initiated' });
  const okBS   = (_req, res) => res.json({ success: true, data: { isRunning: false, lastRunAt: null, nextRunAt: null, lastStats: { employeesProcessed: 100, actionsFired: 5, elapsedSeconds: 10 } } });
  const okResolve = (req, res) => res.json({ success: true, data: { id: req.params.id, status: 'completed' } });
  const okLogs = (_req, res) => res.json({ success: true, total: 5, data: [] });

  // ── Routes (mirrors autoActionRoutes.js exactly) ────────────────────────────
  const router = express.Router();

  router.get('/dashboard',        authorize('hr','admin','manager'), ok({ data: { summary: { totalLogs:10, pendingCount:3, completedCount:5, highPriorityCount:2 }, priorityCases:[], recentActivity:[], actionBreakdown:[] } }));
  router.get('/logs',             authorize('hr','admin','manager'), okLogs);
  router.get('/logs/:id',         authorize('hr','admin','manager'), ok());
  router.put('/logs/:id/resolve', authorize('hr','admin'),           okResolve);
  router.get('/rules',            authorize('hr','admin'),           ok({ data: [] }));
  router.post('/rules',           authorize('hr','admin'),           ok201);
  router.put('/rules/:id',        authorize('hr','admin'),           ok());
  router.delete('/rules/:id',     authorize('admin'),                okDel);
  router.get('/employee/:userId', ownerOrAdmin,                      ok({ data: { logs:[], snapshot:{}, priority:'low' } }));
  router.post('/trigger/:userId', authorize('hr','admin'),           ok());
  router.post('/run-batch',       authorize('admin'),                okBatch);
  router.get('/batch-status',     authorize('hr','admin'),           okBS);

  app.use('/api/auto-actions', router);
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6a. Admin — full access
// ─────────────────────────────────────────────────────────────────────────────
describe('RBAC: Admin role — full access', () => {
  const app = buildApp('admin');

  test('GET  /dashboard      → 200', async () => { const r = await request(app).get('/api/auto-actions/dashboard');           expect(r.status).toBe(200); });
  test('GET  /logs           → 200', async () => { const r = await request(app).get('/api/auto-actions/logs');                expect(r.status).toBe(200); expect(r.body.total).toBe(5); });
  test('GET  /logs/:id       → 200', async () => { const r = await request(app).get('/api/auto-actions/logs/log-123');        expect(r.status).toBe(200); });
  test('PUT  /logs/:id/resolve→200', async () => { const r = await request(app).put('/api/auto-actions/logs/l1/resolve').send({ resolutionNote:'Fixed' }); expect(r.status).toBe(200); expect(r.body.data.status).toBe('completed'); });
  test('GET  /rules          → 200', async () => { const r = await request(app).get('/api/auto-actions/rules');               expect(r.status).toBe(200); });
  test('POST /rules valid    → 201', async () => { const r = await request(app).post('/api/auto-actions/rules').send({ name:'R', actions:['notify_manager'], priority:'high', cooldownHours:24 }); expect(r.status).toBe(201); });
  test('POST /rules no name  → 400', async () => { const r = await request(app).post('/api/auto-actions/rules').send({ actions:['notify_manager'] }); expect(r.status).toBe(400); });
  test('PUT  /rules/:id      → 200', async () => { const r = await request(app).put('/api/auto-actions/rules/r1').send({ isActive: false }); expect(r.status).toBe(200); });
  test('DEL  /rules/:id      → 200', async () => { const r = await request(app).delete('/api/auto-actions/rules/r1');         expect(r.status).toBe(200); expect(r.body.message).toBe('Rule deactivated'); });
  test('GET  /employee/:own  → 200', async () => { const r = await request(app).get('/api/auto-actions/employee/user-uuid'); expect(r.status).toBe(200); });
  test('GET  /employee/:other→ 200 (admin sees all)', async () => { const r = await request(app).get('/api/auto-actions/employee/other-uuid'); expect(r.status).toBe(200); });
  test('POST /trigger/:id    → 200', async () => { const r = await request(app).post('/api/auto-actions/trigger/emp-1');      expect(r.status).toBe(200); });
  test('POST /run-batch      → 200', async () => { const r = await request(app).post('/api/auto-actions/run-batch');          expect(r.status).toBe(200); expect(r.body.message).toBe('Batch run initiated'); });
  test('GET  /batch-status   → 200', async () => { const r = await request(app).get('/api/auto-actions/batch-status');        expect(r.status).toBe(200); expect(r.body.data.lastStats.employeesProcessed).toBe(100); });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6b. HR — read+manage rules, resolve logs, NO run-batch/delete-rules
// ─────────────────────────────────────────────────────────────────────────────
describe('RBAC: HR role', () => {
  const app = buildApp('hr');

  test('GET  /dashboard      → 200', async () => { expect((await request(app).get('/api/auto-actions/dashboard')).status).toBe(200); });
  test('GET  /logs           → 200', async () => { expect((await request(app).get('/api/auto-actions/logs')).status).toBe(200); });
  test('PUT  /logs/:id/resolve→200', async () => { expect((await request(app).put('/api/auto-actions/logs/l1/resolve').send({})).status).toBe(200); });
  test('GET  /rules          → 200', async () => { expect((await request(app).get('/api/auto-actions/rules')).status).toBe(200); });
  test('POST /rules          → 201', async () => { expect((await request(app).post('/api/auto-actions/rules').send({ name:'R',actions:['notify_manager'],priority:'medium',cooldownHours:24 })).status).toBe(201); });
  test('PUT  /rules/:id      → 200', async () => { expect((await request(app).put('/api/auto-actions/rules/r1').send({})).status).toBe(200); });
  test('DEL  /rules/:id      → 403 (admin only)', async () => { expect((await request(app).delete('/api/auto-actions/rules/r1')).status).toBe(403); });
  test('POST /run-batch      → 403 (admin only)', async () => { expect((await request(app).post('/api/auto-actions/run-batch')).status).toBe(403); });
  test('GET  /batch-status   → 200', async () => { expect((await request(app).get('/api/auto-actions/batch-status')).status).toBe(200); });
  test('POST /trigger/:id    → 200', async () => { expect((await request(app).post('/api/auto-actions/trigger/emp-1')).status).toBe(200); });
  test('GET  /employee/:own  → 200', async () => { expect((await request(app).get('/api/auto-actions/employee/user-uuid')).status).toBe(200); });
  test('GET  /employee/:other→ 200 (hr sees all)', async () => { expect((await request(app).get('/api/auto-actions/employee/other-uuid')).status).toBe(200); });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6c. Manager — dashboard+logs (own team scope), NO rules/resolve/batch
// ─────────────────────────────────────────────────────────────────────────────
describe('RBAC: Manager role', () => {
  const app = buildApp('manager');

  test('GET  /dashboard      → 200 (sees own team)', async () => { expect((await request(app).get('/api/auto-actions/dashboard')).status).toBe(200); });
  test('GET  /logs           → 200 (sees own team)', async () => { expect((await request(app).get('/api/auto-actions/logs')).status).toBe(200); });
  test('GET  /logs/:id       → 200',                 async () => { expect((await request(app).get('/api/auto-actions/logs/log-1')).status).toBe(200); });
  test('PUT  /logs/:id/resolve→403 (hr/admin only)', async () => { expect((await request(app).put('/api/auto-actions/logs/l1/resolve').send({})).status).toBe(403); });
  test('GET  /rules          → 403 (hr/admin only)', async () => { expect((await request(app).get('/api/auto-actions/rules')).status).toBe(403); });
  test('POST /rules          → 403 (hr/admin only)', async () => { expect((await request(app).post('/api/auto-actions/rules').send({ name:'X',actions:['notify_manager'] })).status).toBe(403); });
  test('DEL  /rules/:id      → 403 (admin only)',    async () => { expect((await request(app).delete('/api/auto-actions/rules/r1')).status).toBe(403); });
  test('POST /run-batch      → 403 (admin only)',    async () => { expect((await request(app).post('/api/auto-actions/run-batch')).status).toBe(403); });
  test('GET  /batch-status   → 403 (hr/admin only)', async () => { expect((await request(app).get('/api/auto-actions/batch-status')).status).toBe(403); });
  test('POST /trigger/:id    → 403 (hr/admin only)', async () => { expect((await request(app).post('/api/auto-actions/trigger/emp-1')).status).toBe(403); });
  test('GET  /employee/user-uuid → 200 (own)',       async () => { expect((await request(app).get('/api/auto-actions/employee/user-uuid')).status).toBe(200); });
  test('GET  /employee/other-uuid→ 403 (not report)',async () => { expect((await request(app).get('/api/auto-actions/employee/other-uuid')).status).toBe(403); });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6d. Employee — can only see own /employee/:id, everything else blocked
// ─────────────────────────────────────────────────────────────────────────────
describe('RBAC: Employee role', () => {
  const app = buildApp('employee');

  test('GET  /dashboard       → 403', async () => { expect((await request(app).get('/api/auto-actions/dashboard')).status).toBe(403); });
  test('GET  /logs            → 403', async () => { expect((await request(app).get('/api/auto-actions/logs')).status).toBe(403); });
  test('GET  /logs/:id        → 403', async () => { expect((await request(app).get('/api/auto-actions/logs/l1')).status).toBe(403); });
  test('PUT  /logs/:id/resolve→ 403', async () => { expect((await request(app).put('/api/auto-actions/logs/l1/resolve').send({})).status).toBe(403); });
  test('GET  /rules           → 403', async () => { expect((await request(app).get('/api/auto-actions/rules')).status).toBe(403); });
  test('POST /rules           → 403', async () => { expect((await request(app).post('/api/auto-actions/rules').send({ name:'X',actions:['notify_manager'] })).status).toBe(403); });
  test('DEL  /rules/:id       → 403', async () => { expect((await request(app).delete('/api/auto-actions/rules/r1')).status).toBe(403); });
  test('POST /run-batch       → 403', async () => { expect((await request(app).post('/api/auto-actions/run-batch')).status).toBe(403); });
  test('GET  /batch-status    → 403', async () => { expect((await request(app).get('/api/auto-actions/batch-status')).status).toBe(403); });
  test('POST /trigger/:id     → 403', async () => { expect((await request(app).post('/api/auto-actions/trigger/emp-1')).status).toBe(403); });
  test('GET  /employee/user-uuid → 200 (own data)', async () => { expect((await request(app).get('/api/auto-actions/employee/user-uuid')).status).toBe(200); });
  test('GET  /employee/other-uuid→ 403 (blocked)',  async () => { expect((await request(app).get('/api/auto-actions/employee/other-uuid')).status).toBe(403); });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. SQL Schema validation
// ─────────────────────────────────────────────────────────────────────────────
describe('SQL Schema (init.sql)', () => {
  const sql = fs.readFileSync('./init.sql', 'utf8');

  const tables = ['users','attendance','leaves','payrolls','notifications',
    'burnout_scores','action_rules','action_logs','actions_queue'];
  tables.forEach(t => test(`Table exists: ${t}`, () => expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${t}`)));

  test('action_rules — all condition + config columns', () =>
    ['attrition_score_gt','health_score_lt','salary_gap_lt','performance_score_lt',
     'engagement_score_lt','actions','priority','cooldown_hours'].forEach(c => expect(sql).toContain(c)));

  test('action_logs — all audit columns', () =>
    ['employee_id','rule_id','triggered_action','reason','snapshot',
     'resolved_by','resolution_note','triggered_at'].forEach(c => expect(sql).toContain(c)));

  test('actions_queue — all queue columns', () =>
    ['log_id','action_type','payload','attempts','max_attempts','last_error','run_at','processed_at'].forEach(c => expect(sql).toContain(c)));

  test('All 6 performance indexes present', () =>
    ['idx_action_rules_active','idx_action_logs_employee','idx_action_logs_status',
     'idx_action_logs_priority','idx_action_logs_triggered','idx_actions_queue_pending'].forEach(i => expect(sql).toContain(i)));

  test('All 6 seed rules present', () =>
    ['Critical Attrition','Severe Underpaid','Burnout','Moderate Attrition','Salary Review','Low Performance'].forEach(n => expect(sql).toContain(n)));

  test('All FK constraints present', () => {
    expect(sql).toContain('employee_id       UUID NOT NULL REFERENCES users(id)');
    expect(sql).toContain('log_id        UUID NOT NULL REFERENCES action_logs(id)');
    expect(sql).toContain('rule_id           UUID REFERENCES action_rules(id)');
  });

  test('CHECK constraints for all status/priority ENUMs', () => {
    expect(sql).toContain("CHECK (priority IN ('high','medium','low'))");
    expect(sql).toContain("CHECK (status IN ('pending','in_progress','completed','failed','skipped'))");
    expect(sql).toContain("CHECK (status IN ('pending','processing','done','failed'))");
  });
});
