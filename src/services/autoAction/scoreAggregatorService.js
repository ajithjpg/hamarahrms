// src/services/autoAction/scoreAggregatorService.js
// ─── Score Aggregator ─────────────────────────────────────────────────────────
// Pulls all AI signal scores for a given employee from existing services.
// This is the ONLY place that reads from existing modules — keeps coupling minimal.
//
// Scores returned:
//   attritionScore   0–100  (from resignationDetectorService)
//   healthScore      0–100  (inverse of burnout; 100 = healthy)
//   salaryGap        %      (negative = underpaid; from salaryIntelligenceService)
//   performanceScore 0–100  (derived from attendance + training)
//   engagementScore  0–100  (derived from burnout factors + leave usage)

'use strict';

const logger = require('../../config/logger');

// ── Existing services (read-only, not modified) ───────────────────────────────
const resignationSvc   = require('../resignationDetectorService');
const burnoutSvc       = require('../burnoutService');
const salarySvc        = require('../salaryIntelligenceService');

// ── DB models (read-only queries) ─────────────────────────────────────────────
const { User, BurnoutScore, Attendance, Leave, TrainingEnrollment } = require('../../models');
const { Op } = require('sequelize');

/**
 * Pull the latest burnout score from the DB (avoid re-computation if recent).
 */
const getLatestBurnout = async (userId) => {
  const today = new Date().toISOString().split('T')[0];
  const record = await BurnoutScore.findOne({
    where: { userId },
    order: [['calculatedFor', 'DESC']],
  });
  // If we have a record from today, use it; otherwise compute fresh
  if (record && record.calculatedFor === today) {
    return record;
  }
  try {
    return await burnoutSvc.calculateBurnoutScore(userId);
  } catch (err) {
    logger.warn(`Burnout calc failed for ${userId}: ${err.message}`);
    return null;
  }
};

/**
 * Derive a simple performance score (0–100) from attendance + training.
 * - Attendance rate 90 days → 60 pts
 * - Training completion rate → 40 pts
 */
const derivePerformanceScore = async (userId) => {
  const d90 = new Date(); d90.setDate(d90.getDate() - 90);

  const attendance = await Attendance.findAll({
    where: { userId, date: { [Op.gte]: d90 }, isWeekend: false },
    attributes: ['status'],
  });
  const present = attendance.filter((a) => ['present', 'late'].includes(a.status)).length;
  const attendanceRate = attendance.length ? present / attendance.length : 0.8;
  const attendancePts = Math.round(attendanceRate * 60);

  const enrollments = await TrainingEnrollment.findAll({ where: { userId } });
  const completed    = enrollments.filter((e) => e.status === 'completed').length;
  const trainingRate = enrollments.length ? completed / enrollments.length : 0.5;
  const trainingPts  = Math.round(trainingRate * 40);

  return Math.min(100, attendancePts + trainingPts);
};

/**
 * Derive an engagement score (0–100).
 * Uses inverse of burnout score as a proxy and adjusts for leave utilisation.
 */
const deriveEngagementScore = async (userId, burnoutRecord) => {
  const burnoutScore = burnoutRecord?.score ?? 30;
  // High burnout → low engagement
  const base = Math.max(0, 100 - burnoutScore);

  // Leave utilisation: taking regular leave = engaged; zero leave = disengaged
  const d60 = new Date(); d60.setDate(d60.getDate() - 60);
  const leaveTaken = await Leave.count({
    where: { userId, status: 'approved', fromDate: { [Op.gte]: d60 } },
  });
  // Bonus for reasonable leave usage (1-4 days in 60 days = healthy)
  const leaveBonus = leaveTaken >= 1 && leaveTaken <= 4 ? 5 : leaveTaken === 0 ? -10 : 0;

  return Math.min(100, Math.max(0, base + leaveBonus));
};

/**
 * Build the complete score snapshot for one employee.
 * All heavy lifting is delegated to existing services.
 *
 * @param {string} userId - UUID
 * @returns {object} ScoreSnapshot
 */
const buildScoreSnapshot = async (userId) => {
  const user = await User.findByPk(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  // ── 1. Attrition score (Silent Resignation) ───────────────────────────────
  let attritionScore = 0;
  let attritionSignals = {};
  try {
    const res = await resignationSvc.analyseEmployee(userId);
    attritionScore   = res.score ?? 0;
    attritionSignals = res.signals ?? {};
  } catch (err) {
    logger.warn(`Attrition analysis failed for ${userId}: ${err.message}`);
  }

  // ── 2. Health / Burnout score ─────────────────────────────────────────────
  const burnoutRecord = await getLatestBurnout(userId);
  const burnoutScore  = burnoutRecord?.score ?? 0;
  // healthScore is INVERSE of burnout: 0 burnout = 100 health
  const healthScore   = Math.max(0, 100 - burnoutScore);

  // ── 3. Salary gap ─────────────────────────────────────────────────────────
  let salaryGap = 0;
  try {
    const salaryAnalysis = salarySvc.analyseEmployeeSalary(user);
    salaryGap = salaryAnalysis.differencePercent ?? 0;
  } catch (err) {
    logger.warn(`Salary analysis failed for ${userId}: ${err.message}`);
  }

  // ── 4. Performance score (derived) ────────────────────────────────────────
  const performanceScore = await derivePerformanceScore(userId);

  // ── 5. Engagement score (derived) ─────────────────────────────────────────
  const engagementScore = await deriveEngagementScore(userId, burnoutRecord);

  return {
    userId,
    employeeId: user.employeeId,
    name: `${user.firstName} ${user.lastName}`,
    department: user.department,
    designation: user.designation,
    managerId: user.managerId,

    // ── Core scores ───────────────────────────────────────────────────────────
    attritionScore,
    healthScore,
    salaryGap,
    performanceScore,
    engagementScore,

    // ── Extra context for logs/explainability ─────────────────────────────────
    burnoutScore,
    attritionSignals,
    burnoutRiskLevel: burnoutRecord?.riskLevel ?? 'low',
    capturedAt: new Date().toISOString(),
  };
};

/**
 * Build snapshots for ALL active employees.
 * Used by the cron job / batch executor.
 */
const buildAllSnapshots = async () => {
  const users = await User.findAll({
    where: { isActive: true },
    attributes: ['id'],
  });

  const snapshots = [];
  for (const u of users) {
    try {
      const snap = await buildScoreSnapshot(u.id);
      snapshots.push(snap);
    } catch (err) {
      logger.error(`Snapshot failed for ${u.id}: ${err.message}`);
    }
  }
  return snapshots;
};

module.exports = { buildScoreSnapshot, buildAllSnapshots };
