// src/models/LeaveBalance.js
// Per-user, per-year leave balance tracking

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const LeaveBalance = sequelize.define('LeaveBalance', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  casualLeave: {
    type: DataTypes.DECIMAL(4, 1),
    defaultValue: 12,
  },
  casualUsed: {
    type: DataTypes.DECIMAL(4, 1),
    defaultValue: 0,
  },
  sickLeave: {
    type: DataTypes.DECIMAL(4, 1),
    defaultValue: 12,
  },
  sickUsed: {
    type: DataTypes.DECIMAL(4, 1),
    defaultValue: 0,
  },
  earnedLeave: {
    type: DataTypes.DECIMAL(4, 1),
    defaultValue: 15,
  },
  earnedUsed: {
    type: DataTypes.DECIMAL(4, 1),
    defaultValue: 0,
  },
  compOff: {
    type: DataTypes.DECIMAL(4, 1),
    defaultValue: 0,
  },
  compOffUsed: {
    type: DataTypes.DECIMAL(4, 1),
    defaultValue: 0,
  },
}, {
  tableName: 'leave_balances',
  indexes: [
    { unique: true, fields: ['user_id', 'year'] },
  ],
});

module.exports = LeaveBalance;
