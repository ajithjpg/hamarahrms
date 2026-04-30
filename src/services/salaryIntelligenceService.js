// src/services/salaryIntelligenceService.js
// Smart Salary Intelligence — market comparison, underpaid detection, increment suggestions

const { User, Payroll } = require('../models');
const { Op } = require('sequelize');
const logger = require('../config/logger');

/**
 * Market salary benchmarks (INR/month) by role + experience band
 * In production: integrate with real market data APIs (e.g., AmbitionBox, Glassdoor API)
 */
const MARKET_BENCHMARKS = {
  'Software Engineer':        { entry: 45000, mid: 80000, senior: 130000, lead: 180000 },
  'Senior Developer':         { entry: 70000, mid: 110000, senior: 160000, lead: 220000 },
  'Engineering Manager':      { entry: 120000, mid: 170000, senior: 230000, lead: 300000 },
  'HR Manager':               { entry: 50000, mid: 80000, senior: 120000, lead: 160000 },
  'Product Manager':          { entry: 80000, mid: 130000, senior: 180000, lead: 250000 },
  'Data Analyst':             { entry: 40000, mid: 70000, senior: 110000, lead: 150000 },
  'System Administrator':     { entry: 35000, mid: 60000, senior: 90000, lead: 130000 },
  'default':                  { entry: 35000, mid: 60000, senior: 90000, lead: 130000 },
};

/**
 * Determine experience band from date of joining
 */
const getExperienceBand = (dateOfJoining) => {
  if (!dateOfJoining) return 'mid';
  const years = (Date.now() - new Date(dateOfJoining)) / (1000 * 60 * 60 * 24 * 365);
  if (years < 2)  return 'entry';
  if (years < 5)  return 'mid';
  if (years < 10) return 'senior';
  return 'lead';
};

/**
 * Analyse salary fairness for a single employee
 */
const analyseEmployeeSalary = (user) => {
  const benchmark = MARKET_BENCHMARKS[user.designation] || MARKET_BENCHMARKS['default'];
  const band      = getExperienceBand(user.dateOfJoining);
  const marketMid = benchmark[band];
  const current   = parseFloat(user.basicSalary) * 2.5; // CTC estimate from basic

  const diffPct = Math.round(((current - marketMid) / marketMid) * 100);

  let status, recommendation, incrementPct;

  if (diffPct < -20) {
    status         = 'severely_underpaid';
    recommendation = `Employee underpaid by ${Math.abs(diffPct)}% vs market. Immediate correction needed to prevent attrition.`;
    incrementPct   = Math.min(35, Math.abs(diffPct) * 0.8);
  } else if (diffPct < -10) {
    status         = 'underpaid';
    recommendation = `Employee underpaid by ${Math.abs(diffPct)}% vs market. Recommend increment at next appraisal.`;
    incrementPct   = Math.min(20, Math.abs(diffPct) * 0.7);
  } else if (diffPct > 20) {
    status         = 'above_market';
    recommendation = `Employee compensated ${diffPct}% above market. Hold increments until market catches up.`;
    incrementPct   = 5; // Standard cost-of-living adjustment only
  } else {
    status         = 'market_aligned';
    recommendation = `Salary is within ±10% of market rate. Standard annual increment of 8–10% recommended.`;
    incrementPct   = 8 + (Math.random() * 2); // 8–10%
  }

  return {
    userId:           user.id,
    employeeId:       user.employeeId,
    name:             `${user.firstName} ${user.lastName}`,
    designation:      user.designation || 'N/A',
    department:       user.department  || 'N/A',
    currentCTC:       Math.round(current),
    marketBenchmark:  marketMid,
    experienceBand:   band,
    differencePercent: diffPct,
    status,
    recommendation,
    suggestedIncrementPercent: Math.round(incrementPct),
    suggestedNewSalary:        Math.round(current * (1 + incrementPct / 100)),
  };
};

/**
 * Run salary intelligence for all employees
 */
const runSalaryAnalysis = async () => {
  const employees = await User.findAll({
    where: { isActive: true },
    attributes: ['id', 'employeeId', 'firstName', 'lastName', 'designation', 'department', 'basicSalary', 'dateOfJoining'],
  });

  const results = employees.map(analyseEmployeeSalary);

  const summary = {
    total:            results.length,
    severelyUnderpaid: results.filter(r => r.status === 'severely_underpaid').length,
    underpaid:        results.filter(r => r.status === 'underpaid').length,
    marketAligned:    results.filter(r => r.status === 'market_aligned').length,
    aboveMarket:      results.filter(r => r.status === 'above_market').length,
    totalIncrementBudget: Math.round(results.reduce((s, r) => {
      if (r.status === 'market_aligned' || r.status === 'underpaid' || r.status === 'severely_underpaid') {
        return s + (r.currentCTC * r.suggestedIncrementPercent / 100 / 12);
      }
      return s;
    }, 0)),
  };

  return { employees: results, summary, generatedAt: new Date().toISOString() };
};

module.exports = { runSalaryAnalysis, analyseEmployeeSalary };
