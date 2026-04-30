// src/services/autoAction/ruleEngineService.js
// ─── Rule Engine ──────────────────────────────────────────────────────────────
// Loads active rules from the DB, evaluates them against employee score
// snapshots, and returns which rules fired + why.
//
// Usage:
//   const { evaluateEmployee } = require('./ruleEngineService');
//   const fired = await evaluateEmployee(userId, scoreSnapshot);

'use strict';

const { Op } = require('sequelize');
const { ActionRule, ActionLog } = require('../../models/autoActionModels');
const logger = require('../../config/logger');

/**
 * Build a human-readable explanation for why a rule fired.
 * @param {object} rule  - ActionRule instance
 * @param {object} scores - { attritionScore, healthScore, salaryGap, ... }
 */
const buildExplanation = (rule, scores) => {
  const parts = [];
  const s = scores;

  if (rule.attritionScoreGt != null && s.attritionScore != null) {
    parts.push(`attrition_score=${s.attritionScore} (threshold >${rule.attritionScoreGt})`);
  }
  if (rule.healthScoreLt != null && s.healthScore != null) {
    parts.push(`health_score=${s.healthScore} (threshold <${rule.healthScoreLt})`);
  }
  if (rule.salaryGapLt != null && s.salaryGap != null) {
    parts.push(`salary_gap=${s.salaryGap}% (threshold <${rule.salaryGapLt}%)`);
  }
  if (rule.performanceScoreLt != null && s.performanceScore != null) {
    parts.push(`performance_score=${s.performanceScore} (threshold <${rule.performanceScoreLt})`);
  }
  if (rule.engagementScoreLt != null && s.engagementScore != null) {
    parts.push(`engagement_score=${s.engagementScore} (threshold <${rule.engagementScoreLt})`);
  }

  return `Rule "${rule.name}" triggered because: ${parts.join(', ')}`;
};

/**
 * Test whether a single rule's conditions are satisfied by the score snapshot.
 * Returns true only if EVERY defined condition fires (AND logic).
 *
 * @param {object} rule   - ActionRule instance
 * @param {object} scores - { attritionScore, healthScore, salaryGap, performanceScore, engagementScore }
 */
const ruleMatches = (rule, scores) => {
  const { attritionScore, healthScore, salaryGap, performanceScore, engagementScore } = scores;

  if (rule.attritionScoreGt != null) {
    if (attritionScore == null || attritionScore <= rule.attritionScoreGt) return false;
  }
  if (rule.healthScoreLt != null) {
    if (healthScore == null || healthScore >= rule.healthScoreLt) return false;
  }
  if (rule.salaryGapLt != null) {
    if (salaryGap == null || salaryGap >= rule.salaryGapLt) return false;
  }
  if (rule.performanceScoreLt != null) {
    if (performanceScore == null || performanceScore >= rule.performanceScoreLt) return false;
  }
  if (rule.engagementScoreLt != null) {
    if (engagementScore == null || engagementScore >= rule.engagementScoreLt) return false;
  }

  // A rule with zero conditions defined should never fire
  const hasAtLeastOneCondition = [
    rule.attritionScoreGt,
    rule.healthScoreLt,
    rule.salaryGapLt,
    rule.performanceScoreLt,
    rule.engagementScoreLt,
  ].some((v) => v != null);

  return hasAtLeastOneCondition;
};

/**
 * Check if this rule is on cooldown for the given employee.
 * Returns true if the rule fired for this employee within cooldownHours.
 */
const isOnCooldown = async (ruleId, employeeId, cooldownHours) => {
  if (!cooldownHours) return false;

  const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);
  const recent = await ActionLog.findOne({
    where: {
      ruleId,
      employeeId,
      triggeredAt: { [Op.gte]: cutoff },
    },
  });
  return !!recent;
};

/**
 * Evaluate all active rules against one employee's score snapshot.
 *
 * @param {string} employeeId  - UUID
 * @param {object} scores      - { attritionScore, healthScore, salaryGap, performanceScore, engagementScore }
 * @returns {Array}  Array of { rule, explanation } for every rule that fired
 */
const evaluateEmployee = async (employeeId, scores) => {
  const rules = await ActionRule.findAll({ where: { isActive: true } });
  const fired = [];

  for (const rule of rules) {
    if (!ruleMatches(rule, scores)) continue;

    // Cooldown check — skip if already triggered recently
    const cooled = await isOnCooldown(rule.id, employeeId, rule.cooldownHours);
    if (cooled) {
      logger.debug(`Rule "${rule.name}" on cooldown for employee ${employeeId}`);
      continue;
    }

    fired.push({
      rule,
      explanation: buildExplanation(rule, scores),
    });
  }

  return fired;
};

/**
 * Compute aggregate priority for an employee based on their scores.
 * High: attrition > 80 AND health < 50
 * Medium: attrition > 60 OR health < 50
 * Low: everything else
 */
const computePriority = (scores) => {
  const { attritionScore = 0, healthScore = 100 } = scores;
  if (attritionScore > 80 && healthScore < 50) return 'high';
  if (attritionScore > 60 || healthScore < 50) return 'medium';
  return 'low';
};

module.exports = { evaluateEmployee, ruleMatches, computePriority, buildExplanation };
