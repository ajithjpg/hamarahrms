// src/services/payrollService.js
// Gross-to-net payroll engine for Indian statutory compliance

const { User, Attendance, Leave, Payroll, ITDeclaration } = require('../models');
const { Op } = require('sequelize');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');

/**
 * Calculate salary components from a basic salary
 * Follows standard Indian payroll structure
 *
 * @param {number} basicSalary - Monthly basic salary
 * @param {boolean} isMetro - Metro city (HRA = 50% of basic vs 40%)
 * @returns {object} Salary breakdown
 */
const calculateSalaryComponents = (basicSalary, isMetro = true) => {
  const hra = basicSalary * (isMetro ? 0.5 : 0.4);
  const conveyance = 1600;                          // Statutory exemption limit
  const medical = 1250;                             // Statutory exemption limit
  const specialAllowance = Math.max(
    0,
    // Remainder after HRA, conveyance, medical = special allowance
    basicSalary * 2.5 - basicSalary - hra - conveyance - medical
  );

  return {
    basicSalary: round(basicSalary),
    hra: round(hra),
    conveyanceAllowance: conveyance,
    medicalAllowance: medical,
    specialAllowance: round(specialAllowance),
  };
};

/**
 * Calculate PF (Provident Fund)
 * Employee: 12% of basic (max ₹1,800/month)
 * Employer: 12% of basic (max ₹1,800/month)
 */
const calculatePF = (basicSalary) => {
  const PF_CEILING = 15000; // PF calculated on max ₹15,000 basic
  const pfBase = Math.min(basicSalary, PF_CEILING);
  const employee = round(pfBase * 0.12);
  const employer = round(pfBase * 0.12);
  return { employee, employer };
};

/**
 * Calculate ESI (Employee State Insurance)
 * Applicable only if gross <= ₹21,000
 * Employee: 0.75%, Employer: 3.25%
 */
const calculateESI = (grossSalary) => {
  const ESI_THRESHOLD = 21000;
  if (grossSalary > ESI_THRESHOLD) return { employee: 0, employer: 0 };
  return {
    employee: round(grossSalary * 0.0075),
    employer: round(grossSalary * 0.0325),
  };
};

/**
 * Calculate projected annual TDS (Tax Deducted at Source)
 * Supports both New Regime (FY 2024-25) and Old Regime
 *
 * @param {number} annualIncome - Gross annual income
 * @param {number} annualDeductions - Total 80C + 80D + HRA exemptions
 * @param {string} regime - 'new' | 'old'
 * @returns {object} { annualTax, monthlyTds }
 */
const calculateTDS = (annualIncome, annualDeductions = 0, regime = 'new') => {
  let taxableIncome;
  let tax = 0;

  if (regime === 'new') {
    // New Regime FY 2024-25 (no deductions except standard ₹50,000)
    taxableIncome = Math.max(0, annualIncome - 50000);

    if (taxableIncome <= 300000)       tax = 0;
    else if (taxableIncome <= 600000)  tax = (taxableIncome - 300000) * 0.05;
    else if (taxableIncome <= 900000)  tax = 15000 + (taxableIncome - 600000) * 0.10;
    else if (taxableIncome <= 1200000) tax = 45000 + (taxableIncome - 900000) * 0.15;
    else if (taxableIncome <= 1500000) tax = 90000 + (taxableIncome - 1200000) * 0.20;
    else                               tax = 150000 + (taxableIncome - 1500000) * 0.30;

    // Section 87A rebate: if taxable income <= ₹7 lakh, zero tax
    if (taxableIncome <= 700000) tax = 0;
  } else {
    // Old Regime with deductions
    taxableIncome = Math.max(0, annualIncome - 50000 - annualDeductions);

    if (taxableIncome <= 250000)       tax = 0;
    else if (taxableIncome <= 500000)  tax = (taxableIncome - 250000) * 0.05;
    else if (taxableIncome <= 1000000) tax = 12500 + (taxableIncome - 500000) * 0.20;
    else                               tax = 112500 + (taxableIncome - 1000000) * 0.30;

    // Section 87A rebate: if taxable income <= ₹5 lakh
    if (taxableIncome <= 500000) tax = 0;
  }

  // Add 4% Health & Education Cess
  tax = tax * 1.04;

  return {
    annualTax: round(tax),
    monthlyTds: round(tax / 12),
    taxableIncome: round(taxableIncome),
  };
};

/**
 * Calculate Loss of Pay deduction
 * lopDays × (basicSalary / workingDaysInMonth)
 */
const calculateLOP = (basicSalary, lopDays, workingDays = 26) => {
  const dailyRate = basicSalary / workingDays;
  return round(dailyRate * lopDays);
};

/**
 * Overtime pay = 2× hourly rate × overtime hours
 * Hourly rate = basicSalary / (26 days × 8 hours)
 */
const calculateOvertimePay = (basicSalary, overtimeHours) => {
  const hourlyRate = basicSalary / (26 * 8);
  return round(hourlyRate * 2 * overtimeHours);
};

/**
 * Full payroll calculation for a user + month/year
 */
const processPayroll = async (userId, month, year, processedBy) => {
  const user = await User.scope('withPassword').findByPk(userId);
  if (!user) throw new AppError('Employee not found', 404);

  const existingPayroll = await Payroll.findOne({ where: { userId, month, year } });
  if (existingPayroll && existingPayroll.status === 'paid') {
    throw new AppError('Payroll already processed and paid for this period', 409);
  }

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  // Get attendance summary for the month
  const attendanceRecords = await Attendance.findAll({
    where: {
      userId,
      date: { [Op.between]: [startDate, endDate] },
    },
  });

  // Count absent days (LOP = absent - approved leaves used)
  const absentDays = attendanceRecords.filter(
    (a) => a.status === 'absent'
  ).length;

  const overtimeHoursTotal = attendanceRecords.reduce(
    (sum, a) => sum + parseFloat(a.overtimeHours || 0), 0
  );

  // Salary components
  const { basicSalary, hra, conveyanceAllowance, medicalAllowance, specialAllowance } =
    calculateSalaryComponents(parseFloat(user.basicSalary));

  const grossEarnings = basicSalary + hra + conveyanceAllowance + medicalAllowance + specialAllowance;

  // Overtime pay
  const overtimePay = calculateOvertimePay(basicSalary, overtimeHoursTotal);

  // Statutory deductions
  const pf = calculatePF(basicSalary);
  const esi = calculateESI(grossEarnings);

  // TDS: check IT declaration for deductions
  const itDecl = await ITDeclaration.findOne({
    where: { userId, financialYear: `${year}-${String(year + 1).slice(-2)}` },
  });

  const annualDeductions = itDecl
    ? parseFloat(itDecl.totalDeductions || 0)
    : 0;
  const regime = itDecl?.regime || 'new';

  const annualGross = grossEarnings * 12;
  const { monthlyTds } = calculateTDS(annualGross, annualDeductions, regime);

  // LOP deduction
  const lopDeduction = calculateLOP(basicSalary, absentDays);

  // Karnataka Professional Tax
  const professionalTax = grossEarnings > 15000 ? 200 : 150;

  const totalDeductions =
    pf.employee + esi.employee + monthlyTds + professionalTax + lopDeduction;

  const netSalary = grossEarnings + overtimePay - totalDeductions;

  const payrollData = {
    userId,
    month,
    year,
    payPeriodStart: startDate,
    payPeriodEnd: endDate,
    basicSalary,
    hra,
    conveyanceAllowance,
    medicalAllowance,
    specialAllowance,
    overtimePay,
    grossEarnings: grossEarnings + overtimePay,
    pfEmployee: pf.employee,
    pfEmployer: pf.employer,
    esiEmployee: esi.employee,
    esiEmployer: esi.employer,
    tds: monthlyTds,
    professionalTax,
    lopDeduction,
    lopDays: absentDays,
    totalDeductions,
    netSalary,
    workingDays: 26,
    status: 'processed',
    processedAt: new Date(),
    processedBy,
  };

  const [payroll] = await Payroll.upsert(payrollData, {
    returning: true,
    conflictFields: ['userId', 'month', 'year'],
  });

  logger.info('Payroll processed', { userId, month, year, netSalary });
  return payroll;
};

const round = (val) => parseFloat((val || 0).toFixed(2));

module.exports = {
  processPayroll,
  calculateSalaryComponents,
  calculatePF,
  calculateESI,
  calculateTDS,
  calculateLOP,
};
