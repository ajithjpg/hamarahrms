// src/services/workforceHealthService.js
// Workforce Health Score — company-level and department-level AI well-being dashboard
// Aggregates attendance, overtime, leave, burnout into a single health index

const { Op, fn, col, literal } = require('sequelize');
const { User, Attendance, Leave, BurnoutScore, sequelize } = require('../models');
const logger = require('../config/logger');

/**
 * Score bands:
 *   80–100  Healthy   🟢
 *   60–79   Moderate  🟡
 *   40–59   At Risk   🟠
 *   0–39    Critical  🔴
 */
const getBand = (score) => {
  if (score >= 80) return { label: 'Healthy',   color: 'green',  emoji: '🟢' };
  if (score >= 60) return { label: 'Moderate',  color: 'yellow', emoji: '🟡' };
  if (score >= 40) return { label: 'At Risk',   color: 'orange', emoji: '🟠' };
  return              { label: 'Critical',  color: 'red',    emoji: '🔴' };
};

/**
 * Calculate health score for a single department (or company-wide if dept=null)
 * Health = weighted average of:
 *   Attendance rate   (30%)
 *   Leave utilisation (20%)
 *   Burnout inverse   (25%)
 *   Overtime balance  (15%)
 *   Retention proxy   (10%)
 */
const calcDeptHealth = async (department = null) => {
  const now  = new Date();
  const d30  = new Date(now); d30.setDate(d30.getDate() - 30);

  // Build where clause
  const userWhere = { isActive: true };
  if (department) userWhere.department = department;

  const users = await User.findAll({ where: userWhere, attributes: ['id'] });
  if (!users.length) return null;
  const userIds = users.map(u => u.id);

  // ── Attendance rate ──────────────────────────────────────────────────────
  const attRecords = await Attendance.findAll({
    where: { userId: { [Op.in]: userIds }, date: { [Op.gte]: d30 }, isWeekend: false },
    attributes: ['status', 'totalHours', 'overtimeHours'],
  });

  const totalDays    = attRecords.length || 1;
  const presentDays  = attRecords.filter(r => ['present', 'late'].includes(r.status)).length;
  const attendanceRate = presentDays / totalDays; // 0–1

  // ── Average daily hours & overtime ──────────────────────────────────────
  const avgHours   = attRecords.reduce((s, r) => s + parseFloat(r.totalHours || 0), 0) / totalDays;
  const totalOTHrs = attRecords.reduce((s, r) => s + parseFloat(r.overtimeHours || 0), 0);
  const avgOTPerDay = totalOTHrs / totalDays;

  // Overtime balance score: ideal is 0–0.5 hrs/day. Penalise if > 2 hrs/day
  const overtimeBalance = Math.max(0, 1 - avgOTPerDay / 2);

  // ── Leave utilisation ─────────────────────────────────────────────────────
  // Target: employees should use ~2 leave days/month. 0 = disengaged, >5 = disrupted
  const leaveDays = await Leave.sum('numberOfDays', {
    where: { userId: { [Op.in]: userIds }, status: 'approved', fromDate: { [Op.gte]: d30 } },
  }) || 0;
  const avgLeavePerPerson = leaveDays / users.length;
  // Score peaks at 2 days/month, drops off on either side
  const leaveUtil = Math.max(0, 1 - Math.abs(avgLeavePerPerson - 2) / 4);

  // ── Burnout inverse ───────────────────────────────────────────────────────
  // Average burnout score for the department, inverted (low burnout = high health)
  const burnoutScores = await BurnoutScore.findAll({
    where: {
      userId: { [Op.in]: userIds },
      calculatedFor: { [Op.gte]: d30.toISOString().split('T')[0] },
    },
    attributes: ['score'],
    order: [['calculatedFor', 'DESC']],
  });

  const avgBurnout = burnoutScores.length
    ? burnoutScores.reduce((s, b) => s + b.score, 0) / burnoutScores.length
    : 50;
  const burnoutHealth = Math.max(0, (100 - avgBurnout) / 100);

  // ── Retention proxy ───────────────────────────────────────────────────────
  // Based on low absenteeism trend: if < 10% absent days, retention health = 1
  const absentRate   = 1 - attendanceRate;
  const retentionProxy = Math.max(0, 1 - absentRate * 2);

  // ── Weighted composite score ─────────────────────────────────────────────
  const healthScore = Math.round(
    attendanceRate  * 30 +
    leaveUtil       * 20 +
    burnoutHealth   * 25 +
    overtimeBalance * 15 +
    retentionProxy  * 10
  );

  return {
    department: department || 'Company-Wide',
    headcount: users.length,
    healthScore,
    band: getBand(healthScore),
    breakdown: {
      attendanceRate:  Math.round(attendanceRate  * 100),
      leaveUtil:       Math.round(leaveUtil       * 100),
      burnoutHealth:   Math.round(burnoutHealth   * 100),
      overtimeBalance: Math.round(overtimeBalance * 100),
      retentionProxy:  Math.round(retentionProxy  * 100),
    },
    metrics: {
      avgDailyHours:     parseFloat(avgHours.toFixed(1)),
      avgOvertimePerDay: parseFloat(avgOTPerDay.toFixed(2)),
      avgLeavePerMonth:  parseFloat(avgLeavePerPerson.toFixed(1)),
      avgBurnout:        Math.round(avgBurnout),
    },
  };
};

/**
 * Full company workforce health report
 * Returns company-wide score + per-department breakdown
 */
const getCompanyHealthReport = async () => {
  // Get all departments
  const deptRows = await User.findAll({
    where: { isActive: true },
    attributes: [[fn('DISTINCT', col('department')), 'department']],
    raw: true,
  });
  const departments = deptRows.map(d => d.department).filter(Boolean);

  const [companyScore, ...deptScores] = await Promise.all([
    calcDeptHealth(null),
    ...departments.map(d => calcDeptHealth(d)),
  ]);

  // Sort departments by risk (worst first)
  const sortedDepts = deptScores
    .filter(Boolean)
    .sort((a, b) => a.healthScore - b.healthScore);

  const riskZones  = sortedDepts.filter(d => d.healthScore < 60);
  const healthyZones = sortedDepts.filter(d => d.healthScore >= 80);

  return {
    company: companyScore,
    departments: sortedDepts,
    riskZones,
    healthyZones,
    insights: generateInsights(companyScore, sortedDepts),
    generatedAt: new Date().toISOString(),
  };
};

/**
 * Generate text insights from the health data
 */
const generateInsights = (company, depts) => {
  const insights = [];

  if (company && company.healthScore < 60) {
    insights.push(`Overall company health is ${company.band.label.toLowerCase()} (${company.healthScore}/100). Immediate HR action recommended.`);
  }

  const worstDept = depts[0];
  if (worstDept && worstDept.healthScore < 50) {
    insights.push(`${worstDept.department} department is at critical risk (${worstDept.healthScore}/100). ${worstDept.headcount} employees affected.`);
  }

  if (company?.metrics?.avgBurnout > 60) {
    insights.push(`Average burnout score across company is ${company.metrics.avgBurnout}/100 — consider mandatory wellness days.`);
  }

  if (company?.metrics?.avgOvertimePerDay > 1.5) {
    insights.push(`Average overtime of ${company.metrics.avgOvertimePerDay.toFixed(1)}h/day detected — workforce may be understaffed.`);
  }

  const disengagedDepts = depts.filter(d => d.metrics?.avgLeavePerMonth < 0.5);
  if (disengagedDepts.length > 0) {
    insights.push(`${disengagedDepts.map(d => d.department).join(', ')} show near-zero leave usage — possible disengagement signal.`);
  }

  return insights;
};

module.exports = { getCompanyHealthReport, calcDeptHealth, getBand };
