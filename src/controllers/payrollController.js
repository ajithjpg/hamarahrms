// src/controllers/payrollController.js
// Payroll processing and Puppeteer PDF payslip generation

const { Payroll, User } = require('../models');
const payrollService = require('../services/payrollService');
const notificationService = require('../services/notificationService');
const { AppError } = require('../middleware/errorHandler');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../config/logger');

/**
 * POST /api/payroll/process
 * HR/Admin triggers payroll processing for a user
 */
const processPayroll = async (req, res, next) => {
  try {
    const { userId, month, year } = req.body;

    const payroll = await payrollService.processPayroll(
      userId,
      parseInt(month),
      parseInt(year),
      req.user.id
    );

    // Generate payslip PDF
    const pdfPath = await generatePayslipPDF(payroll, userId);
    await payroll.update({ payslipUrl: pdfPath });

    // Notify employee
    await notificationService.createNotification(userId, {
      title: 'Payslip Generated',
      body: `Your payslip for ${getMonthName(month)} ${year} is ready. Net salary: ₹${payroll.netSalary.toLocaleString('en-IN')}`,
      type: 'payroll_processed',
      metadata: { payrollId: payroll.id },
    });

    res.json({
      success: true,
      message: 'Payroll processed successfully',
      data: payroll,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/payroll/process-bulk
 * Process payroll for all active employees in a month
 */
const processBulkPayroll = async (req, res, next) => {
  try {
    const { month, year } = req.body;
    const { User } = require('../models');

    const employees = await User.findAll({
      where: { isActive: true, role: 'employee' },
      attributes: ['id'],
    });

    const results = [];
    const errors = [];

    for (const emp of employees) {
      try {
        const payroll = await payrollService.processPayroll(
          emp.id, parseInt(month), parseInt(year), req.user.id
        );
        results.push({ userId: emp.id, payrollId: payroll.id, netSalary: payroll.netSalary });
      } catch (err) {
        errors.push({ userId: emp.id, error: err.message });
      }
    }

    res.json({
      success: true,
      message: `Processed ${results.length} payrolls, ${errors.length} errors`,
      data: { processed: results, errors },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/payroll/my?month=4&year=2025
 */
const getMyPayroll = async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const where = { userId: req.user.id };
    if (month) where.month = parseInt(month);
    if (year) where.year = parseInt(year);

    const payrolls = await Payroll.findAll({
      where,
      order: [['year', 'DESC'], ['month', 'DESC']],
    });

    res.json({ success: true, data: payrolls });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/payroll/:id/payslip
 * Download payslip PDF (regenerate if missing)
 */
const downloadPayslip = async (req, res, next) => {
  try {
    const payroll = await Payroll.findByPk(req.params.id, {
      include: [{ model: User, as: 'employee', attributes: { exclude: ['password', 'mfa_secret'] } }],
    });

    if (!payroll) throw new AppError('Payroll record not found', 404);

    // Employees can only access their own payslip
    if (req.user.role === 'employee' && payroll.userId !== req.user.id) {
      throw new AppError('Access denied', 403);
    }

    const pdfBuffer = await generatePayslipPDF(payroll, payroll.userId, true);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=payslip-${payroll.employee.employeeId}-${getMonthName(payroll.month)}-${payroll.year}.pdf`
    );
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
};

/**
 * Generate payslip PDF using Puppeteer
 * @returns Buffer of the PDF
 */
const generatePayslipPDF = async (payroll, userId, returnBuffer = false) => {
  const user = payroll.employee || await User.findByPk(userId);
  if (!user) throw new AppError('Employee not found', 404);

  const html = buildPayslipHTML(payroll, user);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });

    await browser.close();

    if (returnBuffer) return pdfBuffer;

    // Save to local storage (replace with S3 in production)
    const dir = path.join(__dirname, '../../uploads/payslips');
    await fs.mkdir(dir, { recursive: true });
    const filename = `payslip-${user.employeeId}-${payroll.month}-${payroll.year}.pdf`;
    const filePath = path.join(dir, filename);
    await fs.writeFile(filePath, pdfBuffer);

    return `/uploads/payslips/${filename}`;
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    logger.error('Payslip PDF generation failed', { error: err.message, userId });
    throw new AppError('Failed to generate payslip PDF', 500);
  }
};

/**
 * Build the HTML template for the payslip PDF
 */
const buildPayslipHTML = (payroll, user) => {
  const monthName = getMonthName(payroll.month);
  const fmt = (v) => `₹${parseFloat(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Arial', sans-serif; font-size: 12px; color: #222; margin: 0; padding: 0; }
    .header { background: #1a237e; color: white; padding: 20px; display: flex; justify-content: space-between; align-items: center; }
    .company { font-size: 22px; font-weight: bold; letter-spacing: 1px; }
    .payslip-title { font-size: 14px; opacity: 0.9; }
    .section { padding: 16px 20px; }
    .employee-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; background: #f5f5f5; padding: 16px; margin: 0 20px; border-radius: 4px; }
    .field { display: flex; flex-direction: column; }
    .label { font-size: 10px; color: #666; text-transform: uppercase; }
    .value { font-weight: bold; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin: 0 20px; width: calc(100% - 40px); }
    th { background: #e8eaf6; padding: 8px 10px; text-align: left; font-size: 11px; }
    td { padding: 7px 10px; border-bottom: 1px solid #eee; }
    .amount { text-align: right; }
    .totals-row td { font-weight: bold; background: #f5f5f5; }
    .net-salary { background: #1a237e; color: white; padding: 16px 20px; margin: 16px 20px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; font-size: 16px; font-weight: bold; }
    .footer { text-align: center; color: #999; font-size: 10px; padding: 16px; border-top: 1px solid #eee; }
    .badge { display: inline-block; background: #e8f5e9; color: #2e7d32; padding: 2px 8px; border-radius: 10px; font-size: 10px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="company">🏢 Hamara HR</div>
      <div class="payslip-title">Salary Slip — ${monthName} ${payroll.year}</div>
    </div>
    <div style="text-align:right; opacity:0.9;">
      <div>Pay Period: ${payroll.payPeriodStart} to ${payroll.payPeriodEnd}</div>
      <div>Working Days: ${payroll.workingDays} | LOP Days: ${payroll.lopDays}</div>
    </div>
  </div>

  <div class="employee-grid">
    <div class="field"><span class="label">Employee Name</span><span class="value">${user.firstName} ${user.lastName}</span></div>
    <div class="field"><span class="label">Employee ID</span><span class="value">${user.employeeId}</span></div>
    <div class="field"><span class="label">Designation</span><span class="value">${user.designation || '—'}</span></div>
    <div class="field"><span class="label">Department</span><span class="value">${user.department || '—'}</span></div>
    <div class="field"><span class="label">PAN</span><span class="value">${user.pan || '—'}</span></div>
    <div class="field"><span class="label">UAN</span><span class="value">${user.uan || '—'}</span></div>
  </div>

  <div class="section">
    <table>
      <thead>
        <tr><th>Earnings</th><th class="amount">Amount</th><th>Deductions</th><th class="amount">Amount</th></tr>
      </thead>
      <tbody>
        <tr><td>Basic Salary</td><td class="amount">${fmt(payroll.basicSalary)}</td><td>PF (Employee 12%)</td><td class="amount">${fmt(payroll.pfEmployee)}</td></tr>
        <tr><td>HRA</td><td class="amount">${fmt(payroll.hra)}</td><td>ESI (Employee 0.75%)</td><td class="amount">${fmt(payroll.esiEmployee)}</td></tr>
        <tr><td>Special Allowance</td><td class="amount">${fmt(payroll.specialAllowance)}</td><td>TDS (Income Tax)</td><td class="amount">${fmt(payroll.tds)}</td></tr>
        <tr><td>Conveyance Allowance</td><td class="amount">${fmt(payroll.conveyanceAllowance)}</td><td>Professional Tax</td><td class="amount">${fmt(payroll.professionalTax)}</td></tr>
        <tr><td>Medical Allowance</td><td class="amount">${fmt(payroll.medicalAllowance)}</td><td>LOP Deduction (${payroll.lopDays} days)</td><td class="amount">${fmt(payroll.lopDeduction)}</td></tr>
        <tr><td>Overtime Pay</td><td class="amount">${fmt(payroll.overtimePay)}</td><td></td><td></td></tr>
        <tr class="totals-row"><td>Gross Earnings</td><td class="amount">${fmt(payroll.grossEarnings)}</td><td>Total Deductions</td><td class="amount">${fmt(payroll.totalDeductions)}</td></tr>
      </tbody>
    </table>
  </div>

  <div class="net-salary">
    <span>NET TAKE-HOME SALARY</span>
    <span>${fmt(payroll.netSalary)}</span>
  </div>

  <div class="section" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:0 20px;">
    <div><b>Employer Contributions</b><br><br>
      PF (Employer): ${fmt(payroll.pfEmployer)}<br>
      ESI (Employer): ${fmt(payroll.esiEmployer)}
    </div>
    <div style="text-align:right;">
      <span class="badge">✓ Digitally Verified</span><br><br>
      <small>This is a computer-generated payslip and does not require a signature.</small>
    </div>
  </div>

  <div class="footer">Hamara HR Platform | Confidential | ${new Date().toLocaleDateString('en-IN')}</div>
</body>
</html>`;
};

const getMonthName = (month) => {
  const months = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return months[parseInt(month)] || month;
};

module.exports = { processPayroll, processBulkPayroll, getMyPayroll, downloadPayslip };
