// src/services/resignationDetectorService.js
// Silent Resignation Detector — analyses behavioural signals to predict attrition
// Outputs a risk score (0–100) and proactive alert with 30-day prediction window

const { Op } = require('sequelize');
const { Attendance, Leave, User, BurnoutScore, Notification } = require('../models');
const mistralService = require('./mistralService');
const notificationService = require('./notificationService');
const logger = require('../config/logger');

/**
 * Behavioural signals and their weights (total = 100 pts)
 *
 * Signal                    Weight  Trigger condition
 * ─────────────────────────────────────────────────
 * Late / irregular logins   25 pts  >30% days with late arrival
 * Attendance decline        20 pts  Attendance rate drops below 80%
 * Zero leave usage          15 pts  No leave taken in 60+ days (disengagement)
 * Overtime decline          15 pts  OT hours dropped >50% vs prev month
 * Weekend absence streak    10 pts  Never works extra even when team does
 * Short workdays            10 pts  Avg hours < 7 (doing minimum)
 * Burnout high + no leave    5 pts  Score ≥ 60 but still not taking breaks
 */

const WEIGHTS = {
  lateLogins:        25,
  attendanceDecline: 20,
  zeroLeaveUsage:    15,
  overtimeDecline:   15,
  shortWorkdays:     10,
  weekendAbsence:    10,
  burnoutNoLeave:     5,
};

/**
 * Analyse a single employee for silent resignation signals
 * @param {string} userId
 * @returns {object} { score, riskLevel, signals, prediction, aiInsight }
 */
const analyseEmployee = async (userId) => {
  const now   = new Date();
  const d30   = new Date(now); d30.setDate(d30.getDate() - 30);
  const d60   = new Date(now); d60.setDate(d60.getDate() - 60);
  const dPrev = new Date(now); dPrev.setDate(dPrev.getDate() - 60); // prev 30-day window

  // ── Fetch last 60 days of attendance ────────────────────────────────────
  const allRecords = await Attendance.findAll({
    where: { userId, date: { [Op.gte]: d60 } },
    order: [['date', 'ASC']],
  });

  const recent30  = allRecords.filter(r => new Date(r.date) >= d30);
  const previous30 = allRecords.filter(r => new Date(r.date) < d30);
  const workdays30 = recent30.filter(r => !r.isWeekend);

  // ── Fetch leaves ────────────────────────────────────────────────────────
  const leavesTaken60 = await Leave.count({
    where: { userId, status: 'approved', fromDate: { [Op.gte]: d60 } },
  });

  // ── Fetch latest burnout score ───────────────────────────────────────────
  const latestBurnout = await BurnoutScore.findOne({
    where: { userId },
    order: [['calculatedFor', 'DESC']],
  });

  // ── Signal computation ───────────────────────────────────────────────────
  let totalScore = 0;
  const signals  = [];

  // 1. Late logins
  const lateDays   = workdays30.filter(r => r.status === 'late').length;
  const lateRatio  = workdays30.length ? lateDays / workdays30.length : 0;
  if (lateRatio > 0.30) {
    const pts = Math.round(WEIGHTS.lateLogins * Math.min(lateRatio / 0.5, 1));
    totalScore += pts;
    signals.push({ signal: 'Irregular/late logins', detail: `${Math.round(lateRatio * 100)}% late days`, pts });
  }

  // 2. Attendance decline
  const attendRate = workdays30.length
    ? workdays30.filter(r => ['present', 'late'].includes(r.status)).length / workdays30.length
    : 1;
  if (attendRate < 0.80) {
    const pts = Math.round(WEIGHTS.attendanceDecline * Math.min((0.80 - attendRate) / 0.20, 1));
    totalScore += pts;
    signals.push({ signal: 'Attendance rate declined', detail: `${Math.round(attendRate * 100)}% present`, pts });
  }

  // 3. Zero leave usage (disengagement indicator)
  if (leavesTaken60 === 0) {
    totalScore += WEIGHTS.zeroLeaveUsage;
    signals.push({ signal: 'No leave taken in 60 days', detail: 'Possible disengagement', pts: WEIGHTS.zeroLeaveUsage });
  }

  // 4. Overtime decline (was motivated, now not)
  const recentOT   = recent30.reduce((s, r)   => s + parseFloat(r.overtimeHours || 0), 0);
  const previousOT = previous30.reduce((s, r) => s + parseFloat(r.overtimeHours || 0), 0);
  if (previousOT > 5 && recentOT < previousOT * 0.5) {
    const dropPct = Math.round((1 - recentOT / previousOT) * 100);
    const pts     = Math.round(WEIGHTS.overtimeDecline * Math.min(dropPct / 80, 1));
    totalScore += pts;
    signals.push({ signal: 'Overtime significantly declined', detail: `${dropPct}% drop vs last month`, pts });
  }

  // 5. Short workdays
  const avgHours = workdays30.length
    ? workdays30.reduce((s, r) => s + parseFloat(r.totalHours || 0), 0) / workdays30.length
    : 8;
  if (avgHours < 7 && avgHours > 0) {
    const pts = Math.round(WEIGHTS.shortWorkdays * Math.min((7 - avgHours) / 2, 1));
    totalScore += pts;
    signals.push({ signal: 'Working shorter hours', detail: `Avg ${avgHours.toFixed(1)}h/day`, pts });
  }

  // 6. Weekend presence dropped (compared to team norms — simplified)
  const weekendDays = recent30.filter(r => r.isWeekend && parseFloat(r.totalHours || 0) > 0).length;
  if (weekendDays === 0 && workdays30.length >= 15) {
    // Only flag if the team member previously showed weekend engagement
    const prevWeekend = previous30.filter(r => r.isWeekend && parseFloat(r.totalHours || 0) > 0).length;
    if (prevWeekend > 0) {
      totalScore += WEIGHTS.weekendAbsence;
      signals.push({ signal: 'Stopped weekend engagement', detail: 'No weekend activity in 30 days', pts: WEIGHTS.weekendAbsence });
    }
  }

  // 7. High burnout but not taking leave (trapped / checking out mentally)
  const burnoutScore = latestBurnout?.score || 0;
  if (burnoutScore >= 60 && leavesTaken60 === 0) {
    totalScore += WEIGHTS.burnoutNoLeave;
    signals.push({ signal: 'High burnout + zero leave', detail: `Burnout: ${burnoutScore}/100`, pts: WEIGHTS.burnoutNoLeave });
  }

  const finalScore = Math.min(100, totalScore);
  const riskLevel  = finalScore >= 70 ? 'critical' : finalScore >= 45 ? 'high' : finalScore >= 25 ? 'medium' : 'low';

  // ── AI narrative insight ─────────────────────────────────────────────────
  let aiInsight = null;
  const user = await User.findByPk(userId);
  if (finalScore >= 25 && user) {
    aiInsight = await generateResignationInsight(user, { score: finalScore, riskLevel, signals });
  }

  return {
    userId,
    score:      finalScore,
    riskLevel,
    prediction: finalScore >= 45 ? `Employee likely to resign within ${finalScore >= 70 ? '14' : '30'} days` : null,
    signals,
    aiInsight,
    calculatedAt: new Date().toISOString(),
  };
};

/**
 * Generate GPT-4o insight for resignation risk
 */
const generateResignationInsight = async (user, data) => {
  return mistralService.generateResignationInsight(user, data);
};

/**
 * Run detector for all active employees and alert HR/managers for high-risk employees
 */
const runForAll = async () => {
  const employees = await User.findAll({
    where: { isActive: true, role: { [Op.in]: ['employee', 'manager'] } },
    attributes: ['id', 'firstName', 'lastName', 'managerId', 'department'],
  });

  const results = [];
  for (const emp of employees) {
    try {
      const result = await analyseEmployee(emp.id);
      results.push({ employee: emp, ...result });

      // Alert HR + manager if high/critical risk
      if (result.riskLevel === 'high' || result.riskLevel === 'critical') {
        const alertMsg = `⚠️ ${emp.firstName} ${emp.lastName} shows ${result.riskLevel} resignation risk (${result.score}/100). ${result.prediction || ''}`;

        // Notify HR team
        await notificationService.broadcastToRole('hr', 'resignation_risk', {
          title: `Silent Resignation Alert — ${emp.firstName} ${emp.lastName}`,
          body: alertMsg,
          type: 'nudge',
          metadata: { userId: emp.id, score: result.score, riskLevel: result.riskLevel },
        });

        // Notify direct manager
        if (emp.managerId) {
          await notificationService.createNotification(emp.managerId, {
            title: `Retention Alert — Team Member`,
            body: alertMsg,
            type: 'nudge',
            metadata: { userId: emp.id, score: result.score },
          });
        }

        logger.warn('High resignation risk detected', {
          userId: emp.id,
          name: `${emp.firstName} ${emp.lastName}`,
          score: result.score,
          riskLevel: result.riskLevel,
        });
      }
    } catch (err) {
      logger.error('Resignation detection failed for user', { userId: emp.id, error: err.message });
    }
  }

  return results;
};

module.exports = { analyseEmployee, runForAll };
