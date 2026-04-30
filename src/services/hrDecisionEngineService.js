// src/services/hrDecisionEngineService.js
// Auto HR Decision Engine — AI synthesises all data signals into actionable HR decisions

const { User, Attendance, BurnoutScore, TrainingEnrollment, Leave, Payroll } = require('../models');
const { Op } = require('sequelize');
const resignationSvc  = require('./resignationDetectorService');
const salarySvc       = require('./salaryIntelligenceService');
const logger          = require('../config/logger');

/**
 * Decision types the engine can produce
 */
const DECISIONS = {
  PROMOTE:       'promote',
  UPSKILL:       'upskill',
  RETAIN:        'retain_risk',
  WELLNESS:      'wellness_intervention',
  SALARY_REVIEW: 'salary_review',
  RECOGNITION:   'recognition',
  PIP:           'performance_improvement',
};

/**
 * Build a comprehensive profile for one employee across all signals
 */
const buildEmployeeProfile = async (user) => {
  const now = new Date();
  const d90 = new Date(now); d90.setDate(d90.getDate() - 90);
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);

  // Attendance quality over 90 days
  const attendance = await Attendance.findAll({
    where: { userId: user.id, date: { [Op.gte]: d90 }, isWeekend: false },
    attributes: ['status', 'totalHours', 'overtimeHours'],
  });
  const totalDays    = attendance.length || 1;
  const presentDays  = attendance.filter(a => ['present', 'late'].includes(a.status)).length;
  const attendanceRate = presentDays / totalDays;
  const avgHours     = attendance.reduce((s, a) => s + parseFloat(a.totalHours || 0), 0) / totalDays;
  const overtimeDays = attendance.filter(a => parseFloat(a.overtimeHours) > 0.5).length;

  // Latest burnout score
  const burnout = await BurnoutScore.findOne({
    where: { userId: user.id },
    order: [['calculatedFor', 'DESC']],
  });

  // Training completion rate
  const enrollments = await TrainingEnrollment.findAll({ where: { userId: user.id } });
  const completedCourses  = enrollments.filter(e => e.status === 'completed').length;
  const totalEnrolled     = enrollments.length;
  const totalXP           = enrollments.reduce((s, e) => s + (e.xpEarned || 0), 0);
  const trainingRate      = totalEnrolled ? completedCourses / totalEnrolled : 0;

  // Leave balance health (using too much or too little)
  const leaveTaken = await Leave.count({ where: { userId: user.id, status: 'approved', fromDate: { [Op.gte]: d90 } } });

  // Salary intelligence
  const salaryAnalysis = salarySvc.analyseEmployeeSalary(user);

  // Resignation risk
  const resignationRisk = await resignationSvc.analyseEmployee(user.id);

  return {
    user,
    attendanceRate:   Math.round(attendanceRate * 100),
    avgDailyHours:    parseFloat(avgHours.toFixed(1)),
    overtimeDaysQtr:  overtimeDays,
    burnoutScore:     burnout?.score || 0,
    burnoutLevel:     burnout?.riskLevel || 'low',
    completedCourses,
    totalXP,
    trainingRate:     Math.round(trainingRate * 100),
    leaveTakenQtr:    leaveTaken,
    salaryStatus:     salaryAnalysis.status,
    salaryDiffPct:    salaryAnalysis.differencePercent,
    resignationRisk:  resignationRisk.riskLevel,
    resignationScore: resignationRisk.score,
    resignationSignals: resignationRisk.signals,
  };
};

/**
 * Generate AI decisions for one employee profile
 */
const generateDecisions = (profile) => {
  const decisions = [];
  const { user } = profile;

  // ── Promotion candidate ──────────────────────────────────────────────────
  const isHighPerformer =
    profile.attendanceRate >= 90 &&
    profile.completedCourses >= 3 &&
    profile.burnoutScore < 40 &&
    profile.resignationRisk === 'low' &&
    profile.overtimeDaysQtr >= 10;

  if (isHighPerformer) {
    decisions.push({
      type:       DECISIONS.PROMOTE,
      priority:   'high',
      title:      `Promote ${user.firstName} ${user.lastName}`,
      reasoning:  `Attendance ${profile.attendanceRate}%, ${profile.completedCourses} courses completed, low burnout, strong commitment. Promotion-ready.`,
      action:     'Initiate promotion review with manager and HR.',
      impact:     'Retain top talent, boost morale',
    });
  }

  // ── Recognition ───────────────────────────────────────────────────────────
  if (profile.totalXP >= 500 && !isHighPerformer) {
    decisions.push({
      type:     DECISIONS.RECOGNITION,
      priority: 'medium',
      title:    `Recognise ${user.firstName} for Learning Excellence`,
      reasoning: `${profile.totalXP} XP earned from training. Strong learning commitment.`,
      action:   'Feature in monthly newsletter. Award Learning Champion badge.',
      impact:   'Boost engagement and motivation',
    });
  }

  // ── Upskilling ────────────────────────────────────────────────────────────
  const needsUpskill =
    profile.trainingRate < 40 &&
    profile.attendanceRate >= 75 &&
    profile.resignationRisk !== 'critical';

  if (needsUpskill) {
    decisions.push({
      type:     DECISIONS.UPSKILL,
      priority: 'medium',
      title:    `Assign Training Plan for ${user.firstName} ${user.lastName}`,
      reasoning: `Only ${profile.trainingRate}% of enrolled courses completed. Skill gap detected.`,
      action:   `Enroll in 2 mandatory courses this quarter. Set manager-reviewed learning goal.`,
      impact:   'Close skill gap, improve career trajectory',
    });
  }

  // ── Retention risk ────────────────────────────────────────────────────────
  if (profile.resignationRisk === 'high' || profile.resignationRisk === 'critical') {
    decisions.push({
      type:     DECISIONS.RETAIN,
      priority: 'critical',
      title:    `Urgent Retention Action — ${user.firstName} ${user.lastName}`,
      reasoning: `Resignation risk score: ${profile.resignationScore}/100. Signals: ${profile.resignationSignals.slice(0, 2).map(s => s.signal).join(', ')}.`,
      action:   `1:1 with manager this week. Address concerns. Review compensation and workload.`,
      impact:   `Prevent ₹${Math.round(parseFloat(user.basicSalary || 0) * 2.5 * 6 / 100000)}L replacement cost`,
    });
  }

  // ── Wellness intervention ─────────────────────────────────────────────────
  if (profile.burnoutScore >= 60) {
    decisions.push({
      type:     DECISIONS.WELLNESS,
      priority: profile.burnoutScore >= 75 ? 'critical' : 'high',
      title:    `Wellness Intervention — ${user.firstName} ${user.lastName}`,
      reasoning: `Burnout score: ${profile.burnoutScore}/100 (${profile.burnoutLevel}). ${profile.leaveTakenQtr === 0 ? 'No leave taken in 90 days.' : ''}`,
      action:   `Mandatory wellness check-in. Encourage 3–5 days leave. Consider workload redistribution.`,
      impact:   'Prevent long-term health issues and potential sick leave',
    });
  }

  // ── Salary review ─────────────────────────────────────────────────────────
  if (profile.salaryStatus === 'underpaid' || profile.salaryStatus === 'severely_underpaid') {
    decisions.push({
      type:     DECISIONS.SALARY_REVIEW,
      priority: profile.salaryStatus === 'severely_underpaid' ? 'critical' : 'high',
      title:    `Salary Review Required — ${user.firstName} ${user.lastName}`,
      reasoning: `Compensation is ${Math.abs(profile.salaryDiffPct)}% below market for ${user.designation}.`,
      action:   `Review and adjust salary at next cycle. Immediate off-cycle review if resignation risk is also elevated.`,
      impact:   'Prevent attrition, ensure competitive compensation',
    });
  }

  // ── Performance improvement ────────────────────────────────────────────────
  const lowPerformer =
    profile.attendanceRate < 70 &&
    profile.trainingRate < 30 &&
    profile.burnoutScore < 40; // Low burnout + low performance = PIP candidate

  if (lowPerformer) {
    decisions.push({
      type:     DECISIONS.PIP,
      priority: 'medium',
      title:    `Performance Improvement Plan — ${user.firstName} ${user.lastName}`,
      reasoning: `Attendance ${profile.attendanceRate}%, low training completion ${profile.trainingRate}%. Performance below expectations.`,
      action:   `Initiate 90-day PIP with clear KPIs. Weekly check-ins with manager.`,
      impact:   'Course-correct before performance impacts team',
    });
  }

  return decisions;
};

/**
 * Run decision engine for all active employees
 * Returns structured decisions sorted by priority
 */
const runDecisionEngine = async () => {
  const employees = await User.findAll({
    where: { isActive: true, role: { [Op.in]: ['employee', 'manager'] } },
    attributes: ['id', 'employeeId', 'firstName', 'lastName', 'designation',
                 'department', 'basicSalary', 'dateOfJoining', 'managerId'],
  });

  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const allDecisions  = [];
  const employeeSummaries = [];

  for (const emp of employees) {
    try {
      const profile   = await buildEmployeeProfile(emp);
      const decisions = generateDecisions(profile);

      employeeSummaries.push({
        employee:    { id: emp.id, name: `${emp.firstName} ${emp.lastName}`, designation: emp.designation, department: emp.department },
        profile:     { attendanceRate: profile.attendanceRate, burnoutScore: profile.burnoutScore, trainingRate: profile.trainingRate, resignationRisk: profile.resignationRisk },
        decisions:   decisions.length,
        topDecision: decisions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])[0] || null,
      });

      allDecisions.push(...decisions.map(d => ({ ...d, employeeId: emp.id, employeeName: `${emp.firstName} ${emp.lastName}`, department: emp.department })));
    } catch (err) {
      logger.error('Decision engine failed for user', { userId: emp.id, error: err.message });
    }
  }

  // Sort by priority
  allDecisions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const stats = {
    total:        allDecisions.length,
    critical:     allDecisions.filter(d => d.priority === 'critical').length,
    high:         allDecisions.filter(d => d.priority === 'high').length,
    medium:       allDecisions.filter(d => d.priority === 'medium').length,
    byType:       Object.values(DECISIONS).reduce((acc, type) => {
      acc[type] = allDecisions.filter(d => d.type === type).length;
      return acc;
    }, {}),
  };

  return { decisions: allDecisions, employees: employeeSummaries, stats, generatedAt: new Date().toISOString() };
};

module.exports = { runDecisionEngine, buildEmployeeProfile, DECISIONS };
