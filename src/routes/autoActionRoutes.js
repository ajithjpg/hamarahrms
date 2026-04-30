// src/routes/autoActionRoutes.js
// ─── Auto-Action Engine Routes ────────────────────────────────────────────────
// Mount in src/routes/index.js:
//
//   const autoActionRoutes = require('./autoActionRoutes');
//   router.use('/auto-actions', autoActionRoutes);

'use strict';

const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/autoActionController');
const { authenticate, authorize, ownerOrAdmin } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard',
  authorize('hr', 'admin', 'manager'),
  ctrl.getDashboard
);

// ── Action Logs ───────────────────────────────────────────────────────────────
router.get('/logs',
  authorize('hr', 'admin', 'manager'),
  ctrl.getLogs
);

router.get('/logs/:id',
  authorize('hr', 'admin', 'manager'),
  ctrl.getLogById
);

router.put('/logs/:id/resolve',
  authorize('hr', 'admin'),
  ctrl.resolveLog
);

// ── Rules CRUD ────────────────────────────────────────────────────────────────
router.get('/rules',
  authorize('hr', 'admin'),
  ctrl.getRules
);

router.post('/rules',
  authorize('hr', 'admin'),
  ctrl.createRule
);

router.put('/rules/:id',
  authorize('hr', 'admin'),
  ctrl.updateRule
);

router.delete('/rules/:id',
  authorize('admin'),
  ctrl.deleteRule
);

// ── Per-employee view ─────────────────────────────────────────────────────────
// employees see own, managers see direct reports, hr/admin see all
router.get('/employee/:userId',
  ownerOrAdmin,
  ctrl.getEmployeeActions
);

// ── Manual triggers (Admin / HR) ──────────────────────────────────────────────
router.post('/trigger/:userId',
  authorize('hr', 'admin'),
  ctrl.triggerForEmployee
);

router.post('/run-batch',
  authorize('admin'),
  ctrl.runBatch
);

// ── Batch status ──────────────────────────────────────────────────────────────
router.get('/batch-status',
  authorize('hr', 'admin'),
  ctrl.getBatchStatusCtrl
);

module.exports = router;
