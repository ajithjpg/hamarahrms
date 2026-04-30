// src/models/User.js
// Core user model with RBAC roles, JWT tracking, and soft delete

const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  employeeId: {
    type: DataTypes.STRING(20),
    unique: true,
    allowNull: false,
    comment: 'Human-readable employee ID e.g. EMP001',
  },
  firstName: {
    type: DataTypes.STRING(50),
    allowNull: false,
    validate: { len: [2, 50] },
  },
  lastName: {
    type: DataTypes.STRING(50),
    allowNull: false,
    validate: { len: [2, 50] },
  },
  email: {
    type: DataTypes.STRING(100),
    unique: true,
    allowNull: false,
    validate: { isEmail: true },
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  role: {
    type: DataTypes.ENUM('employee', 'manager', 'hr', 'admin'),
    defaultValue: 'employee',
    allowNull: false,
  },
  department: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  designation: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  managerId: {
    type: DataTypes.UUID,
    allowNull: true,
    comment: 'Reports to this manager',
  },
  phone: {
    type: DataTypes.STRING(15),
    allowNull: true,
  },
  dateOfJoining: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  dateOfBirth: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  address: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  avatar: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'S3 URL or local path to avatar image',
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  mfaEnabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  mfaSecret: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  lastLogin: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Salary fields
  basicSalary: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  pan: {
    type: DataTypes.STRING(10),
    allowNull: true,
    comment: 'PAN for TDS computation',
  },
  uan: {
    type: DataTypes.STRING(12),
    allowNull: true,
    comment: 'UAN for PF',
  },
}, {
  tableName: 'users',
  indexes: [
    { fields: ['email'] },
    { fields: ['employee_id'] },
    { fields: ['role'] },
    { fields: ['manager_id'] },
  ],
  // Exclude password from default JSON output
  defaultScope: {
    attributes: { exclude: ['password', 'mfa_secret'] },
  },
  scopes: {
    // Use withPassword scope only when authenticating
    withPassword: { attributes: {} },
  },
});

// Hash password before create/update
User.beforeSave(async (user) => {
  if (user.changed('password')) {
    const salt = await bcrypt.genSalt(12);
    user.password = await bcrypt.hash(user.password, salt);
  }
});

// Instance method: compare password
User.prototype.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Virtual full name
User.prototype.getFullName = function () {
  return `${this.firstName} ${this.lastName}`;
};

module.exports = User;
