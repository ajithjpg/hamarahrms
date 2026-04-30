// src/models/Payroll.js
// Monthly payroll record with full Indian statutory deductions

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Payroll = sequelize.define('Payroll', {
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
  month: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1, max: 12 },
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  payPeriodStart: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  payPeriodEnd: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  
  // Earnings
  basicSalary: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: '40% of CTC',
  },
  hra: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: '50% of basic for metro / 40% non-metro',
  },
  specialAllowance: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  conveyanceAllowance: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  medicalAllowance: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  overtimePay: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: '2x hourly rate for overtime hours',
  },
  bonuses: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  grossEarnings: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },

  // Deductions
  pfEmployee: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: '12% of basic, max 1800/month',
  },
  pfEmployer: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: '12% employer contribution',
  },
  esiEmployee: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: '0.75% of gross if gross <= 21000',
  },
  esiEmployer: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: '3.25% employer contribution',
  },
  tds: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'Monthly TDS based on projected annual income',
  },
  professionalTax: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 200,
    comment: 'State PT - Karnataka ₹200/month',
  },
  lopDeduction: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'Loss of Pay for unapproved absent days',
  },
  totalDeductions: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },

  // Net
  netSalary: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  lopDays: {
    type: DataTypes.DECIMAL(4, 1),
    defaultValue: 0,
    comment: 'Days deducted as Loss of Pay',
  },
  workingDays: {
    type: DataTypes.INTEGER,
    defaultValue: 26,
  },
  payslipUrl: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'S3 URL of generated PDF payslip',
  },
  status: {
    type: DataTypes.ENUM('draft', 'processed', 'paid', 'disputed'),
    defaultValue: 'draft',
  },
  processedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  processedBy: {
    type: DataTypes.UUID,
    allowNull: true,
  },
}, {
  tableName: 'payrolls',
  indexes: [
    { fields: ['user_id'] },
    { fields: ['month', 'year'] },
    { unique: true, fields: ['user_id', 'month', 'year'] },
  ],
});

module.exports = Payroll;
