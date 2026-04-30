// src/models/autoActionModels.js
// Sequelize models for the AI Auto-Action Engine
// Drop into src/models/ alongside existing model files

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// ─── ActionRule ───────────────────────────────────────────────────────────────
const ActionRule = sequelize.define('ActionRule', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },

  // ── Condition thresholds (null = not evaluated) ────────────────────────────
  attritionScoreGt: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Fire if attrition_score GREATER THAN this value',
  },
  healthScoreLt: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Fire if health_score LESS THAN this value',
  },
  salaryGapLt: {
    type: DataTypes.DECIMAL(6, 2),
    allowNull: true,
    comment: 'Fire if salary_gap_pct LESS THAN this value (negative = underpaid)',
  },
  performanceScoreLt: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
    comment: 'Fire if performance_score LESS THAN this value',
  },
  engagementScoreLt: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
    comment: 'Fire if engagement_score LESS THAN this value',
  },

  // ── Actions to execute when rule fires ─────────────────────────────────────
  actions: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Array of action type strings',
  },

  priority: {
    type: DataTypes.ENUM('high', 'medium', 'low'),
    defaultValue: 'medium',
  },

  // Cooldown: don't re-fire for same employee within N hours
  cooldownHours: {
    type: DataTypes.INTEGER,
    defaultValue: 24,
  },

  createdBy: {
    type: DataTypes.UUID,
    allowNull: true,
  },
}, {
  tableName: 'action_rules',
  underscored: true,
});

// ─── ActionLog ────────────────────────────────────────────────────────────────
const ActionLog = sequelize.define('ActionLog', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  employeeId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  ruleId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  triggeredAction: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'Human-readable explanation of why this action fired',
  },
  snapshot: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Full score snapshot at the moment the action was triggered',
  },
  status: {
    type: DataTypes.ENUM('pending', 'in_progress', 'completed', 'failed', 'skipped'),
    defaultValue: 'pending',
  },
  priority: {
    type: DataTypes.ENUM('high', 'medium', 'low'),
    defaultValue: 'medium',
  },
  resolvedBy: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  resolvedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  resolutionNote: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  triggeredAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'action_logs',
  underscored: true,
  indexes: [
    { fields: ['employee_id'] },
    { fields: ['status'] },
    { fields: ['priority'] },
    { fields: ['triggered_at'] },
  ],
});

// ─── ActionsQueue ─────────────────────────────────────────────────────────────
const ActionsQueue = sequelize.define('ActionsQueue', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  logId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  actionType: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  payload: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },
  status: {
    type: DataTypes.ENUM('pending', 'processing', 'done', 'failed'),
    defaultValue: 'pending',
  },
  attempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  maxAttempts: {
    type: DataTypes.INTEGER,
    defaultValue: 3,
  },
  lastError: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  runAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  processedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'actions_queue',
  underscored: true,
});

// ─── Associations ─────────────────────────────────────────────────────────────
// Call this after all models (including User) are loaded
const setupAssociations = () => {
  const User = sequelize.models.User;

  if (User) {
    ActionLog.belongsTo(User, { foreignKey: 'employeeId', as: 'employee' });
    ActionLog.belongsTo(User, { foreignKey: 'resolvedBy', as: 'resolver' });
  }

  ActionLog.belongsTo(ActionRule, { foreignKey: 'ruleId', as: 'rule' });
  ActionRule.hasMany(ActionLog, { foreignKey: 'ruleId', as: 'logs' });

  ActionLog.hasMany(ActionsQueue, { foreignKey: 'logId', as: 'queueItems' });
  ActionsQueue.belongsTo(ActionLog, { foreignKey: 'logId', as: 'log' });
};

module.exports = { ActionRule, ActionLog, ActionsQueue, setupAssociations };
