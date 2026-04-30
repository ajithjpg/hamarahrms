// src/models/index-models.js

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// ─── ITDeclaration ─────────────────────────────────────────────────────────
const ITDeclaration = sequelize.define('ITDeclaration', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  financialYear: { type: DataTypes.STRING(7), allowNull: false, comment: 'e.g. 2024-25' },
  regime: { type: DataTypes.ENUM('old', 'new'), defaultValue: 'new' },
  epfContribution:    { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  ppfContribution:    { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  lifeInsurance:      { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  elss:               { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  homeLoanPrincipal:  { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  nsc:                { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  tuitionFees:        { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  section80CTotal:    { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  healthInsuranceSelf:    { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  healthInsuranceParents: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  homeLoanInterest:   { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  hraRent:            { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  hraCity:            { type: DataTypes.ENUM('metro', 'non_metro'), defaultValue: 'metro' },
  hraExemption:       { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  totalDeductions:    { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  taxableIncome:      { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  projectedTax:       { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  monthlyTds:         { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  status: { type: DataTypes.ENUM('draft', 'submitted', 'approved'), defaultValue: 'draft' },
  submittedAt: { type: DataTypes.DATE, allowNull: true },
}, { tableName: 'it_declarations' });

// ─── Notification ────────────────────────────────────────────────────────────
const Notification = sequelize.define('Notification', {
  id:     { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  title:  { type: DataTypes.STRING(200), allowNull: false },
  body:   { type: DataTypes.TEXT, allowNull: false },
  type: {
    type: DataTypes.ENUM(
      'leave_applied', 'leave_approved', 'leave_rejected',
      'payroll_processed', 'burnout_alert', 'sos_triggered',
      'training_completed', 'nudge', 'general', 'auto_action'
    ),
    defaultValue: 'general',
  },
  isRead:   { type: DataTypes.BOOLEAN, defaultValue: false },
  metadata: { type: DataTypes.JSONB, allowNull: true },
}, { tableName: 'notifications' });

// ─── SOS ─────────────────────────────────────────────────────────────────────
const SOS = sequelize.define('SOS', {
  id:         { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId:     { type: DataTypes.UUID, allowNull: false },
  message:    { type: DataTypes.TEXT, allowNull: true, defaultValue: 'Emergency! I need help.' },
  latitude:   { type: DataTypes.DECIMAL(10, 8), allowNull: true },
  longitude:  { type: DataTypes.DECIMAL(11, 8), allowNull: true },
  address:    { type: DataTypes.TEXT, allowNull: true },
  status:     { type: DataTypes.ENUM('active', 'acknowledged', 'resolved'), defaultValue: 'active' },
  acknowledgedBy: { type: DataTypes.UUID, allowNull: true },
  acknowledgedAt: { type: DataTypes.DATE, allowNull: true },
  resolvedAt:     { type: DataTypes.DATE, allowNull: true },
  resolution:     { type: DataTypes.TEXT, allowNull: true },
}, { tableName: 'sos_alerts' });

// ─── Training Course ─────────────────────────────────────────────────────────
const TrainingCourse = sequelize.define('TrainingCourse', {
  id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  title:       { type: DataTypes.STRING(200), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  category:    { type: DataTypes.STRING(100), allowNull: true },
  duration:    { type: DataTypes.INTEGER, allowNull: true, comment: 'Minutes' },
  xpReward:    { type: DataTypes.INTEGER, defaultValue: 100 },
  badgeName:   { type: DataTypes.STRING(100), allowNull: true },
  contentUrl:  { type: DataTypes.STRING(500), allowNull: true },
  isActive:    { type: DataTypes.BOOLEAN, defaultValue: true },
  createdBy:   { type: DataTypes.UUID, allowNull: true },
}, { tableName: 'training_courses' });

// ─── Training Enrollment ─────────────────────────────────────────────────────
const TrainingEnrollment = sequelize.define('TrainingEnrollment', {
  id:         { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId:     { type: DataTypes.UUID, allowNull: false },
  courseId:   { type: DataTypes.UUID, allowNull: false },
  status:     { type: DataTypes.ENUM('enrolled', 'in_progress', 'completed'), defaultValue: 'enrolled' },
  progress:   { type: DataTypes.INTEGER, defaultValue: 0 },
  xpEarned:   { type: DataTypes.INTEGER, defaultValue: 0 },
  completedAt:{ type: DataTypes.DATE, allowNull: true },
  score:      { type: DataTypes.DECIMAL(5, 2), allowNull: true },
}, { tableName: 'training_enrollments' });

// ─── Burnout Score ────────────────────────────────────────────────────────────
// FIX: Added unique composite index on (userId, calculatedFor) so per-day upsert works
const BurnoutScore = sequelize.define('BurnoutScore', {
  id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId:    { type: DataTypes.UUID, allowNull: false },
  score:     { type: DataTypes.INTEGER, allowNull: false },
  riskLevel: { type: DataTypes.ENUM('low', 'medium', 'high', 'critical'), allowNull: false },
  overtimeScore:    { type: DataTypes.INTEGER, defaultValue: 0 },
  longHoursScore:   { type: DataTypes.INTEGER, defaultValue: 0 },
  weekendWorkScore: { type: DataTypes.INTEGER, defaultValue: 0 },
  absenceScore:     { type: DataTypes.INTEGER, defaultValue: 0 },
  leaveScore:       { type: DataTypes.INTEGER, defaultValue: 0 },
  factors:          { type: DataTypes.JSONB, allowNull: true },
  aiInsight:        { type: DataTypes.TEXT, allowNull: true },
  calculatedFor:    { type: DataTypes.DATEONLY, allowNull: false },
}, {
  tableName: 'burnout_scores',
  indexes: [
    { unique: true, fields: ['user_id', 'calculated_for'], name: 'burnout_scores_user_date_unique' }
  ],
});

// ─── Refresh Token ────────────────────────────────────────────────────────────
const RefreshToken = sequelize.define('RefreshToken', {
  id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId:    { type: DataTypes.UUID, allowNull: false, field: 'user_id' },
  token:     { type: DataTypes.STRING(500), allowNull: false, unique: true },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  isRevoked: { type: DataTypes.BOOLEAN, defaultValue: false },
  userAgent: { type: DataTypes.STRING(500), allowNull: true },
  ipAddress: { type: DataTypes.STRING(45), allowNull: true },
}, { tableName: 'refresh_tokens' });

module.exports = {
  ITDeclaration, Notification, SOS,
  TrainingCourse, TrainingEnrollment,
  BurnoutScore, RefreshToken,
};
