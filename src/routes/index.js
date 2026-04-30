// src/routes/index.js
// Central route registry — mounts all module routers

const express = require('express');
const router = express.Router();

const { authenticate, authorize } = require('../middleware/auth');

// ─── Auth routes ─────────────────────────────────────────────────────────────
const authCtrl = require('../controllers/authController');
const authRouter = express.Router();

authRouter.post('/register', authCtrl.registerRules, authCtrl.validate, authCtrl.register);
authRouter.post('/login',    authCtrl.loginRules,    authCtrl.validate, authCtrl.login);
authRouter.post('/refresh',  authCtrl.refresh);
authRouter.post('/logout',   authenticate, authCtrl.logout);
authRouter.get('/me',        authenticate, authCtrl.me);

router.use('/auth', authRouter);

// ─── Attendance routes ────────────────────────────────────────────────────────
const attCtrl = require('../controllers/attendanceController');
const attRouter = express.Router();

attRouter.use(authenticate);
attRouter.post('/punch-in',        attCtrl.punchIn);
attRouter.put('/punch-out',         attCtrl.punchOut);
attRouter.get('/today',             attCtrl.getToday);
attRouter.get('/my',                attCtrl.getMyAttendance);
attRouter.get('/team',              authorize('manager', 'hr', 'admin'), attCtrl.getTeamAttendance);
attRouter.post('/manual',           authorize('hr', 'admin'),            attCtrl.manualEntry);

router.use('/attendance', attRouter);

// ─── Leave routes ─────────────────────────────────────────────────────────────
const leaveCtrl = require('../controllers/leaveController');
const leaveRouter = express.Router();

leaveRouter.use(authenticate);
leaveRouter.post('/apply',                 leaveCtrl.applyLeave);
leaveRouter.put('/:id/manager-action',     authorize('manager', 'hr', 'admin'), leaveCtrl.managerAction);
leaveRouter.put('/:id/hr-action',          authorize('hr', 'admin'),            leaveCtrl.hrAction);
leaveRouter.put('/:id/cancel',             leaveCtrl.cancelLeave);
leaveRouter.get('/my',                     leaveCtrl.getMyLeaves);
leaveRouter.get('/balance',                leaveCtrl.getMyBalance);
leaveRouter.get('/team-pending',           authorize('manager', 'hr', 'admin'), leaveCtrl.getTeamPending);
leaveRouter.get('/hr-pending',             authorize('hr', 'admin'),            leaveCtrl.getHRPending);

router.use('/leaves', leaveRouter);

// ─── Payroll routes ───────────────────────────────────────────────────────────
const payCtrl = require('../controllers/payrollController');
const payRouter = express.Router();

payRouter.use(authenticate);
payRouter.post('/process',      authorize('hr', 'admin'), payCtrl.processPayroll);
payRouter.post('/bulk',         authorize('hr', 'admin'), payCtrl.processBulkPayroll);
payRouter.get('/my',            payCtrl.getMyPayroll);
payRouter.get('/:id/payslip',   payCtrl.downloadPayslip);

router.use('/payroll', payRouter);

// ─── AI routes ───────────────────────────────────────────────────────────────
const aiCtrl = require('../controllers/aiController');
const aiRouter = express.Router();

aiRouter.use(authenticate);
aiRouter.post('/chat',          aiCtrl.chat);
aiRouter.get('/burnout/me',     aiCtrl.getMyBurnout);
aiRouter.get('/burnout/team',   authorize('manager', 'hr', 'admin'), aiCtrl.getTeamBurnout);
aiRouter.get('/nudge',          aiCtrl.getNudge);
aiRouter.post('/voice-intent',  aiCtrl.voiceIntent);

router.use('/ai', aiRouter);

// ─── SOS routes ───────────────────────────────────────────────────────────────
const { sosController } = require('../controllers/controllers');
const sosRouter = express.Router();

sosRouter.use(authenticate);
sosRouter.post('/trigger',         sosController.triggerSOS);
sosRouter.put('/:id/acknowledge',  authorize('hr', 'admin'), sosController.acknowledgeSOS);
sosRouter.put('/:id/resolve',      authorize('hr', 'admin'), sosController.resolveSOS);
sosRouter.get('/active',           authorize('hr', 'admin'), sosController.getActiveAlerts);

router.use('/sos', sosRouter);

// ─── Training routes ──────────────────────────────────────────────────────────
const { trainingController } = require('../controllers/controllers');
const trainingRouter = express.Router();

trainingRouter.use(authenticate);
trainingRouter.get('/',              trainingController.getCourses);
trainingRouter.post('/enroll',       trainingController.enroll);
trainingRouter.put('/:id/progress',  trainingController.updateProgress);
trainingRouter.get('/leaderboard',   trainingController.getLeaderboard);
trainingRouter.get('/my',            trainingController.getMyEnrollments);

router.use('/training', trainingRouter);

// ─── Notifications ────────────────────────────────────────────────────────────
const { notifController } = require('../controllers/controllers');
const notifRouter = express.Router();

notifRouter.use(authenticate);
notifRouter.get('/',           notifController.getAll);
notifRouter.put('/:id/read',   notifController.markRead);
notifRouter.put('/read-all',   notifController.markAllRead);

router.use('/notifications', notifRouter);

// ─── IT Declaration routes ────────────────────────────────────────────────────
const { itController } = require('../controllers/controllers');
const itRouter = express.Router();

itRouter.use(authenticate);
itRouter.get('/',        itController.getOrCreate);
itRouter.post('/save',   itController.save);
itRouter.post('/submit', itController.submit);

router.use('/it-declaration', itRouter);

// ─── Employee routes ──────────────────────────────────────────────────────────
const { empController } = require('../controllers/controllers');
const empRouter = express.Router();

empRouter.use(authenticate);
empRouter.get('/',          authorize('hr', 'admin', 'manager'), empController.getAll);
empRouter.get('/:id',       empController.getById);
empRouter.put('/:id',       empController.update);
empRouter.delete('/:id',    authorize('admin'), empController.deactivate);

router.use('/employees', empRouter);

// ─── Health check ────────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Hamara HR API',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

module.exports = router;

// ─── AI Intelligence routes (new 4 AI features) ───────────────────────────
const aiIntelCtrl = require('../controllers/aiIntelligenceController');
const aiIntelRouter = express.Router();

aiIntelRouter.use(authenticate);
aiIntelRouter.get('/resignation/all',       authorize('hr','admin'),            aiIntelCtrl.getAllResignationRisks);
aiIntelRouter.get('/resignation/:userId',   aiIntelCtrl.getEmployeeResignationRisk);
aiIntelRouter.get('/workforce-health',      authorize('hr','admin','manager'),  aiIntelCtrl.getWorkforceHealth);
aiIntelRouter.get('/workforce-health/dept/:department', authorize('hr','admin','manager'), aiIntelCtrl.getDeptHealth);
aiIntelRouter.get('/salary',                authorize('hr','admin'),            aiIntelCtrl.getSalaryAnalysis);
aiIntelRouter.get('/salary/me',             aiIntelCtrl.getMySalaryInsight);
aiIntelRouter.get('/decisions',             authorize('hr','admin'),            aiIntelCtrl.getHRDecisions);
aiIntelRouter.get('/decisions/:userId',     authorize('hr','admin','manager'),  aiIntelCtrl.getEmployeeDecisions);
aiIntelRouter.post('/refresh-cache',        authorize('admin'),                 aiIntelCtrl.refreshCache);

router.use('/ai-intel', aiIntelRouter);

// ─── AI Auto-Action Engine routes ────────────────────────────────────────────
const autoActionRoutes = require('./autoActionRoutes');
router.use('/auto-actions', autoActionRoutes);
