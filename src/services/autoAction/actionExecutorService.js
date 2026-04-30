// src/services/autoAction/actionExecutorService.js
// ─── Action Executor ──────────────────────────────────────────────────────────
// Handles execution of specific action types.
// Each action type is an isolated handler — easy to add new ones.
//
// Supported action types:
//   notify_manager          — DB notification to the employee's manager
//   create_hr_task          — Creates an ActionLog entry with pending status
//   suggest_salary_increase — Logs a salary review task for HR
//   suggest_wellness        — Logs a wellness intervention task
//   email_hr                — (stub) sends email to HR team (wire up nodemailer)
//   slack_alert             — (stub) posts to Slack channel

'use strict';

const logger = require('../../config/logger');
const notificationService = require('../notificationService');
const { ActionLog, ActionsQueue } = require('../../models/autoActionModels');
const { User } = require('../../models');

// ─── Handler map ─────────────────────────────────────────────────────────────
// Each handler receives { logEntry, snapshot, payload }
// Returns { success: boolean, detail: string }

const handlers = {

  // ── Notify the employee's manager ──────────────────────────────────────────
  notify_manager: async ({ logEntry, snapshot }) => {
    const { managerId, name, attritionScore, healthScore } = snapshot;
    if (!managerId) {
      return { success: false, detail: 'No manager assigned to this employee' };
    }
    await notificationService.createNotification(managerId, {
      title: `⚠️ Action Required: ${name}`,
      body: logEntry.reason,
      type: 'auto_action',
      metadata: {
        employeeId: snapshot.userId,
        priority: logEntry.priority,
        attritionScore,
        healthScore,
        actionLogId: logEntry.id,
        actionType: 'notify_manager',
      },
    });
    return { success: true, detail: `Manager (${managerId}) notified` };
  },

  // ── Create an HR task (ActionLog entry marked as pending task) ─────────────
  create_hr_task: async ({ logEntry, snapshot }) => {
    // Notify all HR users
    const hrUsers = await User.findAll({
      where: { role: 'hr', isActive: true },
      attributes: ['id'],
    });
    for (const hr of hrUsers) {
      await notificationService.createNotification(hr.id, {
        title: `📋 HR Task: Review ${snapshot.name}`,
        body: `Priority: ${logEntry.priority.toUpperCase()} — ${logEntry.reason}`,
        type: 'auto_action',
        metadata: {
          employeeId: snapshot.userId,
          priority: logEntry.priority,
          actionLogId: logEntry.id,
          taskType: 'hr_review',
        },
      });
    }
    return { success: true, detail: `HR task created, ${hrUsers.length} HR users notified` };
  },

  // ── Suggest a salary increase ──────────────────────────────────────────────
  suggest_salary_increase: async ({ logEntry, snapshot }) => {
    const hrUsers = await User.findAll({
      where: { role: 'hr', isActive: true },
      attributes: ['id'],
    });
    const gapText = snapshot.salaryGap
      ? `Salary gap: ${snapshot.salaryGap}% vs market.`
      : '';
    for (const hr of hrUsers) {
      await notificationService.createNotification(hr.id, {
        title: `💰 Salary Review: ${snapshot.name}`,
        body: `${gapText} ${logEntry.reason}`,
        type: 'auto_action',
        metadata: {
          employeeId: snapshot.userId,
          priority: logEntry.priority,
          actionLogId: logEntry.id,
          taskType: 'salary_review',
          salaryGap: snapshot.salaryGap,
        },
      });
    }
    return { success: true, detail: 'Salary review task queued for HR' };
  },

  // ── Suggest wellness intervention ──────────────────────────────────────────
  suggest_wellness: async ({ logEntry, snapshot }) => {
    // Notify employee + manager
    const { userId, managerId, name, healthScore, burnoutScore } = snapshot;
    await notificationService.createNotification(userId, {
      title: '🧘 Wellness Check-in',
      body: `Hi ${name.split(' ')[0]}, your wellbeing score is ${healthScore}/100. Please consider taking a break or speaking with HR.`,
      type: 'auto_action',
      metadata: { healthScore, burnoutScore, actionLogId: logEntry.id, actionType: 'suggest_wellness_employee' },
    });
    if (managerId) {
      await notificationService.createNotification(managerId, {
        title: `🧘 Wellness Alert: ${name}`,
        body: `${name}'s health score has dropped to ${healthScore}/100. Consider a 1:1 check-in.`,
        type: 'auto_action',
        metadata: { employeeId: userId, healthScore, actionLogId: logEntry.id, actionType: 'suggest_wellness_manager' },
      });
    }
    return { success: true, detail: 'Wellness nudge sent to employee and manager' };
  },

  // ── Email HR (stub — wire up nodemailer / SES) ─────────────────────────────
  email_hr: async ({ logEntry, snapshot }) => {
    // TODO: integrate nodemailer or AWS SES
    logger.info('[ACTION] email_hr stub', {
      employee: snapshot.name,
      reason: logEntry.reason,
    });
    return { success: true, detail: 'email_hr: stub executed (configure nodemailer to activate)' };
  },

  // ── Slack alert (stub — wire up @slack/web-api) ────────────────────────────
  slack_alert: async ({ logEntry, snapshot }) => {
    // TODO: integrate Slack WebClient
    logger.info('[ACTION] slack_alert stub', {
      employee: snapshot.name,
      priority: logEntry.priority,
      reason: logEntry.reason,
    });
    return { success: true, detail: 'slack_alert: stub executed (configure Slack token to activate)' };
  },
};

/**
 * Execute a single action type for a given log entry + snapshot.
 * Updates ActionsQueue record with result.
 *
 * @param {object} queueItem  - ActionsQueue instance
 * @param {object} logEntry   - ActionLog instance
 * @param {object} snapshot   - Score snapshot object
 */
const executeQueueItem = async (queueItem, logEntry, snapshot) => {
  const handler = handlers[queueItem.actionType];

  await queueItem.update({ status: 'processing', attempts: queueItem.attempts + 1 });

  if (!handler) {
    await queueItem.update({ status: 'failed', lastError: `Unknown action type: ${queueItem.actionType}` });
    return;
  }

  try {
    const result = await handler({ logEntry, snapshot, payload: queueItem.payload });
    await queueItem.update({
      status: result.success ? 'done' : 'failed',
      lastError: result.success ? null : result.detail,
      processedAt: new Date(),
    });
    logger.info(`[ActionExecutor] ${queueItem.actionType} → ${result.success ? 'done' : 'failed'}: ${result.detail}`);
  } catch (err) {
    const isRetryable = queueItem.attempts < queueItem.maxAttempts;
    await queueItem.update({
      status: isRetryable ? 'pending' : 'failed',
      lastError: err.message,
      runAt: isRetryable ? new Date(Date.now() + 5 * 60 * 1000) : queueItem.runAt, // retry after 5 min
    });
    logger.error(`[ActionExecutor] ${queueItem.actionType} error (attempt ${queueItem.attempts}):`, err.message);
  }
};

/**
 * Register a set of fired actions into action_logs + actions_queue.
 *
 * @param {string}   employeeId
 * @param {object[]} firedRules  - Array of { rule, explanation }
 * @param {object}   snapshot
 * @returns {ActionLog[]}
 */
const registerActions = async (employeeId, firedRules, snapshot) => {
  const logs = [];

  for (const { rule, explanation } of firedRules) {
    const actions = Array.isArray(rule.actions) ? rule.actions : [];

    for (const actionType of actions) {
      const logEntry = await ActionLog.create({
        employeeId,
        ruleId: rule.id,
        triggeredAction: actionType,
        reason: explanation,
        snapshot,
        priority: rule.priority,
        status: 'pending',
      });

      await ActionsQueue.create({
        logId: logEntry.id,
        actionType,
        payload: { snapshot, ruleId: rule.id },
        runAt: new Date(),
      });

      logs.push(logEntry);
    }
  }

  return logs;
};

module.exports = { executeQueueItem, registerActions, handlers };
