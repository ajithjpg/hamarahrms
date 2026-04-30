// src/models/index.js
// Central model registry — defines all Sequelize associations

const sequelize = require('../config/database');
const User = require('./User');
const Attendance = require('./Attendance');
const Leave = require('./Leave');
const LeaveBalance = require('./LeaveBalance');
const Payroll = require('./Payroll');
const {
  ITDeclaration,
  Notification,
  SOS,
  TrainingCourse,
  TrainingEnrollment,
  BurnoutScore,
  RefreshToken,
} = require('./index-models');

// ─── AI Auto-Action Engine models ─────────────────────────────────────────────
const { ActionRule, ActionLog, ActionsQueue, setupAssociations: setupAutoActionAssociations } = require('./autoActionModels');

// ─── Associations ─────────────────────────────────────────────────────────────

// User self-reference (manager relationship)
User.hasMany(User, { as: 'subordinates', foreignKey: 'managerId' });
User.belongsTo(User, { as: 'manager', foreignKey: 'managerId' });

// User → Attendance (one user, many daily records)
User.hasMany(Attendance, { foreignKey: 'userId', as: 'attendanceRecords' });
Attendance.belongsTo(User, { foreignKey: 'userId', as: 'employee' });

// User → Leave
User.hasMany(Leave, { foreignKey: 'userId', as: 'leaves' });
Leave.belongsTo(User, { foreignKey: 'userId', as: 'employee' });
Leave.belongsTo(User, { foreignKey: 'managerId', as: 'manager' });
Leave.belongsTo(User, { foreignKey: 'hrId', as: 'hrOfficer' });

// User → LeaveBalance
User.hasMany(LeaveBalance, { foreignKey: 'userId', as: 'leaveBalances' });
LeaveBalance.belongsTo(User, { foreignKey: 'userId' });

// User → Payroll
User.hasMany(Payroll, { foreignKey: 'userId', as: 'payrolls' });
Payroll.belongsTo(User, { foreignKey: 'userId', as: 'employee' });

// User → ITDeclaration
User.hasMany(ITDeclaration, { foreignKey: 'userId', as: 'itDeclarations' });
ITDeclaration.belongsTo(User, { foreignKey: 'userId' });

// User → Notification
User.hasMany(Notification, { foreignKey: 'userId', as: 'notifications' });
Notification.belongsTo(User, { foreignKey: 'userId' });

// User → SOS
User.hasMany(SOS, { foreignKey: 'userId', as: 'sosAlerts' });
SOS.belongsTo(User, { foreignKey: 'userId', as: 'employee' });
SOS.belongsTo(User, { foreignKey: 'acknowledgedBy', as: 'acknowledgedByUser' });

// Training
TrainingCourse.hasMany(TrainingEnrollment, { foreignKey: 'courseId', as: 'enrollments' });
TrainingEnrollment.belongsTo(TrainingCourse, { foreignKey: 'courseId', as: 'course' });
User.hasMany(TrainingEnrollment, { foreignKey: 'userId', as: 'trainingEnrollments' });
TrainingEnrollment.belongsTo(User, { foreignKey: 'userId', as: 'learner' });

// Burnout
User.hasMany(BurnoutScore, { foreignKey: 'userId', as: 'burnoutScores' });
BurnoutScore.belongsTo(User, { foreignKey: 'userId' });

// RefreshToken
User.hasMany(RefreshToken, { foreignKey: 'userId', as: 'refreshTokens' });
RefreshToken.belongsTo(User, { foreignKey: 'userId' });

// ─── AI Auto-Action Engine associations ───────────────────────────────────────
setupAutoActionAssociations();

module.exports = {
  sequelize,
  User,
  Attendance,
  Leave,
  LeaveBalance,
  Payroll,
  ITDeclaration,
  Notification,
  SOS,
  TrainingCourse,
  TrainingEnrollment,
  BurnoutScore,
  RefreshToken,
  // Auto-Action Engine
  ActionRule,
  ActionLog,
  ActionsQueue,
};
