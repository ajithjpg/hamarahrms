// src/controllers/aiIntelligenceController.js
// Exposes the 4 new AI intelligence features as REST endpoints

const resignationSvc    = require('../services/resignationDetectorService');
const workforceHealthSvc = require('../services/workforceHealthService');
const salarySvc         = require('../services/salaryIntelligenceService');
const decisionEngineSvc  = require('../services/hrDecisionEngineService');
const { AppError }       = require('../middleware/errorHandler');
const redis              = require('../config/redis');
const logger             = require('../config/logger');

// Cache TTL for expensive AI computations (15 minutes)
const CACHE_TTL = 900;

/** Helper: return cached result or compute + cache */
const withCache = async (key, fn) => {
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);
  } catch (_) {}

  const result = await fn();

  try {
    await redis.setEx(key, CACHE_TTL, JSON.stringify(result));
  } catch (_) {}

  return result;
};

// ── 1. Silent Resignation Detector ──────────────────────────────────────────

/**
 * GET /api/ai-intel/resignation/all
 * Run detector for all employees (HR/Admin only)
 */
const getAllResignationRisks = async (req, res, next) => {
  try {
    const data = await withCache('resignation:all', () => resignationSvc.runForAll());
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

/**
 * GET /api/ai-intel/resignation/:userId
 * Single employee resignation risk
 */
const getEmployeeResignationRisk = async (req, res, next) => {
  try {
    const userId = req.params.userId || req.user.id;
    // Employees can only see their own
    if (req.user.role === 'employee' && userId !== req.user.id) {
      throw new AppError('Access denied', 403);
    }
    const data = await resignationSvc.analyseEmployee(userId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

// ── 2. Workforce Health Score ────────────────────────────────────────────────

/**
 * GET /api/ai-intel/workforce-health
 * Full company health report with department breakdown
 */
const getWorkforceHealth = async (req, res, next) => {
  try {
    const data = await withCache('workforce:health', () => workforceHealthSvc.getCompanyHealthReport());
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

/**
 * GET /api/ai-intel/workforce-health/dept/:department
 */
const getDeptHealth = async (req, res, next) => {
  try {
    const dept = decodeURIComponent(req.params.department);
    const data = await withCache(`workforce:health:${dept}`, () => workforceHealthSvc.calcDeptHealth(dept));
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

// ── 3. Smart Salary Intelligence ─────────────────────────────────────────────

/**
 * GET /api/ai-intel/salary
 * Full salary analysis for all employees (HR/Admin)
 */
const getSalaryAnalysis = async (req, res, next) => {
  try {
    const data = await withCache('salary:analysis', () => salarySvc.runSalaryAnalysis());
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

/**
 * GET /api/ai-intel/salary/me
 * Employee's own salary intelligence
 */
const getMySalaryInsight = async (req, res, next) => {
  try {
    const { User } = require('../models');
    const user = await User.findByPk(req.user.id);
    if (!user) throw new AppError('User not found', 404);
    const data = salarySvc.analyseEmployeeSalary(user);
    // Anonymise market data (don't reveal exact benchmark to employee)
    res.json({
      success: true,
      data: {
        currentCTC: data.currentCTC,
        status: data.status,
        recommendation: data.recommendation.replace(/\d+%/g, match => match), // keep % visible
        suggestedIncrementPercent: data.suggestedIncrementPercent,
        marketPosition: data.differencePercent < -10 ? 'below_market' : data.differencePercent > 10 ? 'above_market' : 'market_aligned',
      },
    });
  } catch (err) { next(err); }
};

// ── 4. Auto HR Decision Engine ────────────────────────────────────────────────

/**
 * GET /api/ai-intel/decisions
 * Full AI decision report for all employees (HR/Admin)
 */
const getHRDecisions = async (req, res, next) => {
  try {
    // Decision engine is expensive — cache 15 min
    const data = await withCache('hr:decisions', () => decisionEngineSvc.runDecisionEngine());
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

/**
 * GET /api/ai-intel/decisions/:userId
 * Single employee AI decisions
 */
const getEmployeeDecisions = async (req, res, next) => {
  try {
    const { User } = require('../models');
    const userId = req.params.userId;
    if (req.user.role === 'employee' && userId !== req.user.id) {
      throw new AppError('Access denied', 403);
    }
    const user = await User.findByPk(userId);
    if (!user) throw new AppError('Employee not found', 404);

    const profile   = await decisionEngineSvc.buildEmployeeProfile(user);
    const decisions = decisionEngineSvc.generateDecisions(profile);

    res.json({ success: true, data: { profile, decisions } });
  } catch (err) { next(err); }
};

/**
 * POST /api/ai-intel/refresh-cache
 * Force-refresh all AI intelligence caches (Admin only)
 */
const refreshCache = async (req, res, next) => {
  try {
    const keys = ['resignation:all', 'workforce:health', 'salary:analysis', 'hr:decisions'];
    for (const k of keys) {
      try { await redis.del(k); } catch (_) {}
    }
    res.json({ success: true, message: 'AI intelligence cache cleared. Next request will recompute.' });
  } catch (err) { next(err); }
};

module.exports = {
  getAllResignationRisks, getEmployeeResignationRisk,
  getWorkforceHealth, getDeptHealth,
  getSalaryAnalysis, getMySalaryInsight,
  getHRDecisions, getEmployeeDecisions,
  refreshCache,
};
