// src/models/Leave.js
// Leave application with multi-level approval (employee → manager → HR)

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Leave = sequelize.define('Leave', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'user_id',
    references: { model: 'users', key: 'id' },
  },
  leaveType: {
    type: DataTypes.ENUM(
      'casual',       // CL - 12 per year
      'sick',         // SL - 12 per year
      'earned',       // EL - carried forward
      'maternity',    // 26 weeks
      'paternity',    // 15 days
      'bereavement',  // 3 days
      'comp_off',     // Compensatory off
      'unpaid'        // Loss of Pay
    ),
    allowNull: false,
  },
  fromDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  toDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  numberOfDays: {
    type: DataTypes.DECIMAL(4, 1),
    allowNull: false,
    comment: 'Supports half-day leaves (0.5)',
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('pending', 'manager_approved', 'approved', 'rejected', 'cancelled'),
    defaultValue: 'pending',
  },
  // Level 1: Manager
  managerId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  managerAction: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected'),
    defaultValue: 'pending',
  },
  managerComment: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  managerActionAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Level 2: HR
  hrId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  hrAction: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected'),
    defaultValue: 'pending',
  },
  hrComment: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  hrActionAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  attachmentUrl: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'Medical certificate or supporting doc',
  },
  isHalfDay: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  halfDayType: {
    type: DataTypes.ENUM('first_half', 'second_half'),
    allowNull: true,
  },
}, {
  tableName: 'leaves',
  indexes: [
    { fields: ['user_id'] },
    { fields: ['status'] },
    { fields: ['from_date', 'to_date'] },
  ],
});

module.exports = Leave;
