// src/services/autoAction/autoActionCron.js
// ─── Auto-Action Cron Job ─────────────────────────────────────────────────────
// Runs on a schedule (default: every 6 hours).
// 1. Builds score snapshots for all active employees
// 2. Evaluates rules via ruleEngineService
// 3. Registers fired actions (logs + queue)
// 4. Processes the actions_queue (execute pending items)
//
// Bootstrap: call startCron() once from src/index.js after DB connects.

'use strict';

const cron   = require('node-cron');
const logger = require('../../config/logger');
const { buildAllSnapshots }   = require('./scoreAggregatorService');
const { evaluateEmployee, computePriority } = require('./ruleEngineService');
const { registerActions, executeQueueItem } = require('./actionExecutorService');
const { ActionLog, ActionsQueue }           = require('../../models/autoActionModels');
const { Op } = require('sequelize');

// ── Overlap guard — prevents concurrent batch runs ────────────────────────────
let isRunning = false;
let lastRunAt = null;
let lastRunStats = null;

const getBatchStatus = () => ({
  isRunning,
  lastRunAt,
  lastRunStats,
});

// ── Concurrent chunk helper — process N employees in parallel ─────────────────
const chunkArray = (arr, size) => {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
};

// ── Main batch run ────────────────────────────────────────────────────────────

const runAutoActionBatch = async () => {
  // Overlap guard — skip if a run is already in progress
  if (isRunning) {
    logger.warn('[AutoAction] Batch already running — skipping this tick to prevent duplicates');
    return;
  }

  isRunning = true;
  const startedAt = Date.now();
  logger.info('[AutoAction] Batch run started');

  try {
    // Step 1 — Build score snapshots for all employees
    const snapshots = await buildAllSnapshots();
    logger.info(`[AutoAction] Built ${snapshots.length} employee snapshots`);

    let totalFired = 0;

    // Step 2 — Evaluate rules in concurrent chunks of 20 (faster than serial loop)
    const chunks = chunkArray(snapshots, 20);
    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map(async (snapshot) => {
          const firedRules = await evaluateEmployee(snapshot.userId, snapshot);
          if (firedRules.length === 0) return 0;
          logger.info(`[AutoAction] ${firedRules.length} rule(s) fired for ${snapshot.name} (${snapshot.userId})`);
          await registerActions(snapshot.userId, firedRules, snapshot);
          return firedRules.length;
        })
      );
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') totalFired += r.value;
        else logger.error(`[AutoAction] Rule eval failed for ${chunk[i].userId}: ${r.reason?.message}`);
      });
    }

    logger.info(`[AutoAction] Evaluation complete. Rules fired: ${totalFired}`);

    // Step 3 — Process pending queue items
    await processQueue();

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    lastRunAt    = new Date().toISOString();
    lastRunStats = { employeesProcessed: snapshots.length, actionsFired: totalFired, elapsedSeconds: parseFloat(elapsed) };
    logger.info(`[AutoAction] Batch run finished in ${elapsed}s — ${totalFired} actions fired across ${snapshots.length} employees`);
  } catch (err) {
    logger.error('[AutoAction] Batch run failed:', err.message);
  } finally {
    isRunning = false; // always release lock even if an error occurs
  }
};

// ── Queue processor ───────────────────────────────────────────────────────────

const processQueue = async () => {
  const items = await ActionsQueue.findAll({
    where: {
      status: { [Op.in]: ['pending', 'failed'] },
      runAt:  { [Op.lte]: new Date() },
      attempts: { [Op.lt]: ActionsQueue.sequelize.col('max_attempts') },
    },
    include: [{ association: 'log' }],
    order: [['run_at', 'ASC']],
    limit: 100,
  });

  if (items.length === 0) return;
  logger.info(`[AutoAction] Processing ${items.length} queue item(s)`);

  for (const item of items) {
    if (!item.log) {
      await item.update({ status: 'failed', lastError: 'Parent log not found' });
      continue;
    }

    // Retrieve snapshot from the log
    const snapshot = item.log.snapshot || {};

    await executeQueueItem(item, item.log, snapshot);

    // Mark parent log as completed if all queue items for it are done/failed
    await maybeCompleteLog(item.logId);
  }
};

/**
 * Mark an ActionLog as 'completed' if every queue item under it is done or failed.
 */
const maybeCompleteLog = async (logId) => {
  const pending = await ActionsQueue.count({
    where: { logId, status: { [Op.in]: ['pending', 'processing'] } },
  });
  if (pending === 0) {
    await ActionLog.update(
      { status: 'completed' },
      { where: { id: logId, status: { [Op.notIn]: ['completed', 'failed'] } } }
    );
  }
};

// ── Cron schedule ─────────────────────────────────────────────────────────────

let cronJob = null;

/**
 * Start the auto-action cron.
 * @param {string} schedule  node-cron expression. Default: every 6 hours.
 */
const startCron = (schedule = '0 */6 * * *') => {
  if (cronJob) {
    logger.warn('[AutoAction] Cron already running');
    return;
  }
  cronJob = cron.schedule(schedule, runAutoActionBatch, { timezone: 'Asia/Kolkata' });
  logger.info(`[AutoAction] Cron scheduled: "${schedule}"`);

  // Also run once at startup (after a short delay for DB to warm up)
  setTimeout(runAutoActionBatch, 15_000);
};

const stopCron = () => {
  if (cronJob) { cronJob.stop(); cronJob = null; }
};

module.exports = { startCron, stopCron, runAutoActionBatch, processQueue, getBatchStatus };
