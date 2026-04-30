// src/controllers/autoActionController.js
// ─── Auto-Action Engine Controller ────────────────────────────────────────────
// REST endpoints for the AI Auto-Action Engine module.
//
// Routes mounted at /api/auto-actions (see routes/autoActionRoutes.js)

'use strict';

const { Op } = require('sequelize');
const { ActionRule, ActionLog, ActionsQueue } = require('../models/autoActionModels');
const { User }                = require('../models');
const { AppError }            = require('../middleware/errorHandler');
const { runAutoActionBatch, getBatchStatus } = require('../services/autoAction/autoActionCron');
const { buildScoreSnapshot }  = require('../services/autoAction/scoreAggregatorService');
const { evaluateEmployee, computePriority } = require('../services/autoAction/ruleEngineService');
const { registerActions }     = require('../services/autoAction/actionExecutorService');
const logger                  = require('../config/logger');

// ─────────────────────────────────────────────────────────────────────────────
// ACTION LOGS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/auto-actions/logs
 * List action logs with optional filters: status, priority, employeeId, limit, offset
 */
const getLogs = async (req, res, next) => {
  try {
    const {
      status, priority, employeeId,
      limit = 50, offset = 0,
      from, to,
    } = req.query;

    const where = {};
    if (status)     where.status     = status;
    if (priority)   where.priority   = priority;
    if (employeeId) where.employeeId = employeeId;
    if (from || to) {
      where.triggeredAt = {};
      if (from) where.triggeredAt[Op.gte] = new Date(from);
      if (to)   where.triggeredAt[Op.lte] = new Date(to);
    }

    // Managers see only their direct reports — not the entire org
    if (req.user.role === 'manager') {
      const teamMembers = await User.findAll({
        where: { managerId: req.user.id, isActive: true },
        attributes: ['id'],
      });
      const teamIds = teamMembers.map((u) => u.id);
      // If a specific employeeId was requested, verify it's in their team
      if (employeeId) {
        if (!teamIds.includes(employeeId)) {
          return res.status(403).json({ success: false, message: 'Access denied: employee not in your team' });
        }
      } else {
        where.employeeId = { [Op.in]: teamIds };
      }
    }

    // Employees can only see their own logs
    if (req.user.role === 'employee') {
      where.employeeId = req.user.id;
    }

    const { count, rows } = await ActionLog.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'employee',
          attributes: ['id', 'employeeId', 'firstName', 'lastName', 'department', 'designation'],
        },
        {
          model: ActionRule,
          as: 'rule',
          attributes: ['id', 'name', 'priority'],
        },
      ],
      order: [['triggered_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    res.json({ success: true, total: count, data: rows });
  } catch (err) { next(err); }
};

/**
 * GET /api/auto-actions/logs/:id
 * Single log entry with queue items
 */
const getLogById = async (req, res, next) => {
  try {
    const log = await ActionLog.findByPk(req.params.id, {
      include: [
        { model: User, as: 'employee', attributes: ['id', 'firstName', 'lastName', 'department'] },
        { model: ActionRule, as: 'rule' },
        { model: ActionsQueue, as: 'queueItems' },
      ],
    });
    if (!log) throw new AppError('Log not found', 404);
    res.json({ success: true, data: log });
  } catch (err) { next(err); }
};

/**
 * PUT /api/auto-actions/logs/:id/resolve
 * Mark a log entry as completed/resolved by HR
 */
const resolveLog = async (req, res, next) => {
  try {
    const { resolutionNote } = req.body;
    const log = await ActionLog.findByPk(req.params.id);
    if (!log) throw new AppError('Log not found', 404);

    await log.update({
      status: 'completed',
      resolvedBy: req.user.id,
      resolvedAt: new Date(),
      resolutionNote: resolutionNote || 'Resolved by HR',
    });

    res.json({ success: true, data: log });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// RULES (CRUD)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/auto-actions/rules
 * List all rules
 */
const getRules = async (req, res, next) => {
  try {
    const rules = await ActionRule.findAll({ order: [['created_at', 'DESC']] });
    res.json({ success: true, data: rules });
  } catch (err) { next(err); }
};

/**
 * POST /api/auto-actions/rules
 * Create a new rule
 */
const createRule = async (req, res, next) => {
  try {
    const {
      name, description,
      attritionScoreGt, healthScoreLt, salaryGapLt,
      performanceScoreLt, engagementScoreLt,
      actions, priority, cooldownHours,
    } = req.body;

    if (!name) throw new AppError('Rule name is required', 400);
    if (!Array.isArray(actions) || actions.length === 0) {
      throw new AppError('At least one action is required', 400);
    }

    const rule = await ActionRule.create({
      name, description,
      attritionScoreGt:   attritionScoreGt   ?? null,
      healthScoreLt:      healthScoreLt      ?? null,
      salaryGapLt:        salaryGapLt        ?? null,
      performanceScoreLt: performanceScoreLt ?? null,
      engagementScoreLt:  engagementScoreLt  ?? null,
      actions,
      priority: priority || 'medium',
      cooldownHours: cooldownHours || 24,
      createdBy: req.user.id,
    });

    res.status(201).json({ success: true, data: rule });
  } catch (err) { next(err); }
};

/**
 * PUT /api/auto-actions/rules/:id
 * Update an existing rule
 */
const updateRule = async (req, res, next) => {
  try {
    const rule = await ActionRule.findByPk(req.params.id);
    if (!rule) throw new AppError('Rule not found', 404);
    await rule.update(req.body);
    res.json({ success: true, data: rule });
  } catch (err) { next(err); }
};

/**
 * DELETE /api/auto-actions/rules/:id
 * Soft-delete: set isActive = false
 */
const deleteRule = async (req, res, next) => {
  try {
    const rule = await ActionRule.findByPk(req.params.id);
    if (!rule) throw new AppError('Rule not found', 404);
    await rule.update({ isActive: false });
    res.json({ success: true, message: 'Rule deactivated' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// ACTIONS DASHBOARD DATA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/auto-actions/dashboard
 * Summary stats + priority cases for the AI Actions Dashboard
 */
const getDashboard = async (req, res, next) => {
  try {
    // Scope: managers see only their direct reports; hr/admin see everyone
    let scopeWhere = {};
    if (req.user.role === 'manager') {
      const teamMembers = await User.findAll({
        where: { managerId: req.user.id, isActive: true },
        attributes: ['id'],
      });
      scopeWhere = { employeeId: { [Op.in]: teamMembers.map((u) => u.id) } };
    }

    // Counts by status (scoped)
    const [totalLogs, pendingCount, completedCount, highPriorityCount] = await Promise.all([
      ActionLog.count({ where: scopeWhere }),
      ActionLog.count({ where: { ...scopeWhere, status: 'pending' } }),
      ActionLog.count({ where: { ...scopeWhere, status: 'completed' } }),
      ActionLog.count({ where: { ...scopeWhere, priority: 'high', status: { [Op.ne]: 'completed' } } }),
    ]);

    // Latest 10 high-priority pending cases (scoped)
    const priorityCases = await ActionLog.findAll({
      where: { ...scopeWhere, priority: 'high', status: { [Op.in]: ['pending', 'in_progress'] } },
      include: [
        { model: User, as: 'employee', attributes: ['id', 'firstName', 'lastName', 'department', 'designation'] },
        { model: ActionRule, as: 'rule', attributes: ['name'] },
      ],
      order: [['triggered_at', 'DESC']],
      limit: 10,
    });

    // Recent activity — scoped
    const recentActivity = await ActionLog.findAll({
      where: scopeWhere,
      include: [
        { model: User, as: 'employee', attributes: ['id', 'firstName', 'lastName'] },
        { model: ActionRule, as: 'rule', attributes: ['name'] },
      ],
      order: [['triggered_at', 'DESC']],
      limit: 20,
    });

    // Breakdown by action type — scoped
    const sequelize = ActionLog.sequelize;
    const actionBreakdown = await ActionLog.findAll({
      where: scopeWhere,
      attributes: [
        'triggeredAction',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      group: ['triggered_action'],
      raw: true,
    });

    res.json({
      success: true,
      data: {
        summary: { totalLogs, pendingCount, completedCount, highPriorityCount },
        priorityCases,
        recentActivity,
        actionBreakdown,
      },
    });
  } catch (err) { next(err); }
};

/**
 * GET /api/auto-actions/employee/:userId
 * All action logs for a specific employee
 */
const getEmployeeActions = async (req, res, next) => {
  try {
    const { userId } = req.params;

    // Employees can only view their own logs
    if (req.user.role === 'employee' && userId !== req.user.id) {
      throw new AppError('Access denied: you can only view your own actions', 403);
    }

    // Managers can only view their direct reports
    if (req.user.role === 'manager') {
      const isDirectReport = await User.findOne({
        where: { id: userId, managerId: req.user.id, isActive: true },
      });
      if (!isDirectReport && userId !== req.user.id) {
        throw new AppError('Access denied: employee is not in your team', 403);
      }
    }

    const logs = await ActionLog.findAll({
      where: { employeeId: userId },
      include: [{ model: ActionRule, as: 'rule', attributes: ['name', 'priority'] }],
      order: [['triggered_at', 'DESC']],
    });

    // Also build a live score snapshot
    const snapshot = await buildScoreSnapshot(userId);
    const priority = computePriority(snapshot);

    res.json({ success: true, data: { logs, snapshot, priority } });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// MANUAL TRIGGERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/auto-actions/trigger/:userId
 * Manually run rule evaluation for a single employee (HR/Admin only)
 */
const triggerForEmployee = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const snapshot   = await buildScoreSnapshot(userId);
    const firedRules = await evaluateEmployee(userId, snapshot);

    if (firedRules.length === 0) {
      return res.json({ success: true, message: 'No rules fired for this employee', data: { snapshot } });
    }

    const logs = await registerActions(userId, firedRules, snapshot);
    res.json({
      success: true,
      message: `${logs.length} action(s) triggered`,
      data: { snapshot, logs, firedRules: firedRules.map((f) => f.explanation) },
    });
  } catch (err) { next(err); }
};

/**
 * POST /api/auto-actions/run-batch
 * Manually trigger the full batch run (Admin only)
 */
const runBatch = async (req, res, next) => {
  try {
    // Fire and forget — respond immediately
    res.json({ success: true, message: 'Batch run initiated' });
    runAutoActionBatch().catch((err) =>
      logger.error('[AutoAction] Manual batch run failed:', err.message)
    );
  } catch (err) { next(err); }
};

/**
 * GET /api/auto-actions/batch-status
 * Returns last batch run time, next run, employees processed, actions fired
 */
const getBatchStatusCtrl = (req, res) => {
  const status = getBatchStatus();
  const nextRunMs = 6 * 60 * 60 * 1000; // 6 hours
  const nextRun = status.lastRunAt
    ? new Date(new Date(status.lastRunAt).getTime() + nextRunMs).toISOString()
    : null;
  res.json({
    success: true,
    data: {
      isRunning:  status.isRunning,
      lastRunAt:  status.lastRunAt,
      nextRunAt:  nextRun,
      lastStats:  status.lastRunStats,
    },
  });
};

module.exports = {
  getLogs, getLogById, resolveLog,
  getRules, createRule, updateRule, deleteRule,
  getDashboard, getEmployeeActions,
  triggerForEmployee, runBatch, getBatchStatusCtrl,
};
