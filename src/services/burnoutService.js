// src/services/burnoutService.js
// Burnout risk scoring algorithm

const { Op } = require('sequelize');
const { Attendance, Leave, BurnoutScore, User } = require('../models');
const openaiService = require('./mistralService');
const logger = require('../config/logger');

const getRiskLevel = (score) => {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
};

const calculateBurnoutScore = async (userId, asOf = new Date()) => {
  const thirtyDaysAgo = new Date(asOf);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const records = await Attendance.findAll({
    where: { userId, date: { [Op.between]: [thirtyDaysAgo, asOf] } },
  });

  const user = await User.findByPk(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  const leavesTaken = await Leave.count({
    where: { userId, status: 'approved', fromDate: { [Op.gte]: thirtyDaysAgo } },
  });

  // Component 1: Overtime frequency (max 30 pts)
  const overtimeDays = records.filter((r) => parseFloat(r.overtimeHours) > 1).length;
  const overtimeScore = Math.min(30, (overtimeDays / 30) * 30 * 2.5);

  // Component 2: Long hours (max 25 pts)
  const workDays = records.filter((r) => parseFloat(r.totalHours) > 0);
  const avgHours = workDays.length
    ? workDays.reduce((sum, r) => sum + parseFloat(r.totalHours), 0) / workDays.length
    : 0;
  const longHoursScore = Math.min(25, Math.max(0, (avgHours - 9) * 5));

  // Component 3: Weekend work (max 20 pts)
  const weekendWorkDays = records.filter((r) => r.isWeekend && parseFloat(r.totalHours) > 0).length;
  const weekendWorkScore = Math.min(20, weekendWorkDays * 5);

  // Component 4: Frequent absences (max 15 pts)
  const absences = records.filter((r) => r.status === 'absent').length;
  const absenceScore = Math.min(15, absences * 3);

  // Component 5: Leave non-utilisation (max 10 pts)
  const leaveScore = leavesTaken === 0 ? 10 : Math.max(0, 10 - leavesTaken * 2);

  const totalScore = Math.round(overtimeScore + longHoursScore + weekendWorkScore + absenceScore + leaveScore);
  const riskLevel = getRiskLevel(totalScore);

  let aiInsight = null;
  if (totalScore >= 25) {
    try {
      aiInsight = await openaiService.generateBurnoutInsight(user, {
        score: totalScore, riskLevel, overtimeDays,
        avgHours: parseFloat(avgHours.toFixed(1)),
        weekendWorkDays, absences, leavesTaken,
      });
    } catch (e) {
      logger.warn('AI burnout insight failed', { error: e.message });
    }
  }

  const calculatedForDate = asOf.toISOString().split('T')[0];

  // FIX: was `user_id` (ReferenceError). Use findOrCreate + update instead of upsert
  // to avoid DB constraint issues.
  let scoreRecord = await BurnoutScore.findOne({
    where: { userId, calculatedFor: calculatedForDate },
  });

  if (scoreRecord) {
    await scoreRecord.update({
      score: totalScore, riskLevel,
      overtimeScore: Math.round(overtimeScore),
      longHoursScore: Math.round(longHoursScore),
      weekendWorkScore: Math.round(weekendWorkScore),
      absenceScore: Math.round(absenceScore),
      leaveScore: Math.round(leaveScore),
      factors: { overtimeDays, avgHours: parseFloat(avgHours.toFixed(1)), weekendWorkDays, absences, leavesTaken },
      aiInsight,
    });
  } else {
    scoreRecord = await BurnoutScore.create({
      userId,
      score: totalScore, riskLevel,
      overtimeScore: Math.round(overtimeScore),
      longHoursScore: Math.round(longHoursScore),
      weekendWorkScore: Math.round(weekendWorkScore),
      absenceScore: Math.round(absenceScore),
      leaveScore: Math.round(leaveScore),
      factors: { overtimeDays, avgHours: parseFloat(avgHours.toFixed(1)), weekendWorkDays, absences, leavesTaken },
      aiInsight,
      calculatedFor: calculatedForDate,
    });
  }

  logger.info('Burnout score calculated', { userId, score: totalScore, riskLevel });
  return scoreRecord;
};

const calculateBurnoutForAll = async () => {
  const users = await User.findAll({ where: { isActive: true }, attributes: ['id'] });
  const results = [];
  for (const user of users) {
    try {
      const score = await calculateBurnoutScore(user.id);
      results.push({ userId: user.id, score: score.score, riskLevel: score.riskLevel });
    } catch (err) {
      logger.error('Burnout calculation failed for user', { userId: user.id, error: err.message });
    }
  }
  return results;
};

module.exports = { calculateBurnoutScore, calculateBurnoutForAll, getRiskLevel };
