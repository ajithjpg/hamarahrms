// src/controllers/controllers.js
// SOS, Training, Notifications, IT Declaration, Employee controllers — all in one file
// Consolidated imports at the top to avoid duplicate declarations

const { Op } = require('sequelize');
const {
  User, Notification, SOS,
  TrainingCourse, TrainingEnrollment,
  BurnoutScore, ITDeclaration,
} = require('../models');
const openaiService   = require('../services/openaiService');
const burnoutService  = require('../services/burnoutService');
const notificationService = require('../services/notificationService');
const payrollSvc      = require('../services/payrollService');
const { AppError }    = require('../middleware/errorHandler');

// ─── SOS Controller ───────────────────────────────────────────────────────────

const triggerSOS = async (req, res, next) => {
  try {
    const { message, latitude, longitude, address } = req.body;
    const sos = await SOS.create({
      userId: req.user.id,
      message: message || 'Emergency! I need immediate help.',
      latitude, longitude, address,
    });

    const payload = (role) => ({
      title: `🚨 SOS Alert from ${req.user.firstName} ${req.user.lastName}`,
      body: message || 'Emergency! I need immediate help.',
      type: 'sos_triggered',
      metadata: { sosId: sos.id, userId: req.user.id, latitude, longitude },
    });

    await notificationService.broadcastToRole('hr',    'sos_alert', payload('hr'));
    await notificationService.broadcastToRole('admin', 'sos_alert', payload('admin'));

    res.status(201).json({ success: true, message: 'SOS alert sent', data: sos });
  } catch (err) { next(err); }
};

const acknowledgeSOS = async (req, res, next) => {
  try {
    const sos = await SOS.findByPk(req.params.id);
    if (!sos) throw new AppError('SOS not found', 404);
    await sos.update({
      status: 'acknowledged',
      acknowledgedBy: req.user.id,
      acknowledgedAt: new Date(),
    });
    res.json({ success: true, data: sos });
  } catch (err) { next(err); }
};

const resolveSOS = async (req, res, next) => {
  try {
    const { resolution } = req.body;
    const sos = await SOS.findByPk(req.params.id);
    if (!sos) throw new AppError('SOS not found', 404);
    await sos.update({ status: 'resolved', resolvedAt: new Date(), resolution });
    res.json({ success: true, data: sos });
  } catch (err) { next(err); }
};

const getActiveAlerts = async (req, res, next) => {
  try {
    const alerts = await SOS.findAll({
      where: { status: { [Op.in]: ['active', 'acknowledged'] } },
      include: [{
        model: User, as: 'employee',
        attributes: ['id', 'firstName', 'lastName', 'phone'],
      }],
      order: [['createdAt', 'DESC']],
    });
    res.json({ success: true, data: alerts });
  } catch (err) { next(err); }
};

const sosController = { triggerSOS, acknowledgeSOS, resolveSOS, getActiveAlerts };

// ─── Training Controller ──────────────────────────────────────────────────────

const getCourses = async (req, res, next) => {
  try {
    const courses = await TrainingCourse.findAll({
      where: { isActive: true },
      order: [['createdAt', 'DESC']],
    });
    res.json({ success: true, data: courses });
  } catch (err) { next(err); }
};

const enroll = async (req, res, next) => {
  try {
    const { courseId } = req.body;
    const course = await TrainingCourse.findByPk(courseId);
    if (!course) throw new AppError('Course not found', 404);

    const [enrollment, created] = await TrainingEnrollment.findOrCreate({
      where: { userId: req.user.id, courseId },
      defaults: { userId: req.user.id, courseId },
    });
    if (!created) throw new AppError('Already enrolled in this course', 409);

    res.status(201).json({ success: true, data: enrollment });
  } catch (err) { next(err); }
};

const updateProgress = async (req, res, next) => {
  try {
    const { progress } = req.body;
    const enrollment = await TrainingEnrollment.findOne({
      where: { id: req.params.id, userId: req.user.id },
      include: [{ model: TrainingCourse, as: 'course' }],
    });
    if (!enrollment) throw new AppError('Enrollment not found', 404);

    const updates = { progress: parseInt(progress) };
    if (updates.progress >= 100) {
      updates.status      = 'completed';
      updates.completedAt = new Date();
      updates.xpEarned    = enrollment.course.xpReward;
    } else if (updates.progress > 0) {
      updates.status = 'in_progress';
    }

    await enrollment.update(updates);
    res.json({ success: true, data: enrollment });
  } catch (err) { next(err); }
};

const getLeaderboard = async (req, res, next) => {
  try {
    const { sequelize } = require('../models');
    const leaderboard = await sequelize.query(`
      SELECT
        u.id, u.first_name, u.last_name, u.department, u.avatar,
        COALESCE(SUM(te.xp_earned), 0) AS total_xp,
        COUNT(CASE WHEN te.status = 'completed' THEN 1 END) AS completed_courses
      FROM users u
      LEFT JOIN training_enrollments te ON te.user_id = u.id AND te.deleted_at IS NULL
      WHERE u.is_active = true AND u.deleted_at IS NULL
      GROUP BY u.id
      ORDER BY total_xp DESC
      LIMIT 20
    `, { type: sequelize.QueryTypes.SELECT });
    res.json({ success: true, data: leaderboard });
  } catch (err) { next(err); }
};

const getMyEnrollments = async (req, res, next) => {
  try {
    const enrollments = await TrainingEnrollment.findAll({
      where: { userId: req.user.id },
      include: [{ model: TrainingCourse, as: 'course' }],
      order: [['updatedAt', 'DESC']],
    });
    res.json({ success: true, data: enrollments });
  } catch (err) { next(err); }
};

const trainingController = { getCourses, enroll, updateProgress, getLeaderboard, getMyEnrollments };

// ─── Notification Controller ──────────────────────────────────────────────────

const notifController = {
  getAll: async (req, res, next) => {
    try {
      const notifications = await Notification.findAll({
        where: { userId: req.user.id },
        order: [['createdAt', 'DESC']],
        limit: 50,
      });
      res.json({ success: true, data: notifications });
    } catch (err) { next(err); }
  },
  markRead: async (req, res, next) => {
    try {
      await Notification.update(
        { isRead: true },
        { where: { id: req.params.id, userId: req.user.id } }
      );
      res.json({ success: true });
    } catch (err) { next(err); }
  },
  markAllRead: async (req, res, next) => {
    try {
      await Notification.update(
        { isRead: true },
        { where: { userId: req.user.id, isRead: false } }
      );
      res.json({ success: true });
    } catch (err) { next(err); }
  },
};

// ─── IT Declaration Controller ────────────────────────────────────────────────

const itController = {
  getOrCreate: async (req, res, next) => {
    try {
      const year = new Date().getFullYear();
      const fy = `${year}-${String(year + 1).slice(-2)}`;
      const [decl] = await ITDeclaration.findOrCreate({
        where: { userId: req.user.id, financialYear: fy },
        defaults: { userId: req.user.id, financialYear: fy },
      });
      res.json({ success: true, data: decl });
    } catch (err) { next(err); }
  },

  save: async (req, res, next) => {
    try {
      const year = new Date().getFullYear();
      const fy = `${year}-${String(year + 1).slice(-2)}`;
      const [decl] = await ITDeclaration.findOrCreate({
        where: { userId: req.user.id, financialYear: fy },
        defaults: { userId: req.user.id, financialYear: fy },
      });

      const data = req.body;

      // Cap Section 80C at ₹1,50,000
      const section80CTotal = Math.min(150000,
        (data.epfContribution  || 0) +
        (data.ppfContribution  || 0) +
        (data.lifeInsurance    || 0) +
        (data.elss             || 0) +
        (data.homeLoanPrincipal|| 0) +
        (data.nsc              || 0) +
        (data.tuitionFees      || 0)
      );

      // Section 80D caps: self ₹25k, parents ₹50k
      const section80D =
        Math.min(25000, data.healthInsuranceSelf    || 0) +
        Math.min(50000, data.healthInsuranceParents || 0);

      // Section 24b: home loan interest max ₹2,00,000
      const section24b = Math.min(200000, data.homeLoanInterest || 0);

      const totalDeductions = section80CTotal + section80D + section24b;

      // Compute projected annual income from user's basic salary
      const userRecord = await User.findByPk(req.user.id);
      // Gross ≈ basic × 2.5 (basic + HRA + allowances)
      const annualGross = parseFloat(userRecord.basicSalary || 0) * 2.5 * 12;

      const { annualTax, monthlyTds, taxableIncome } = payrollSvc.calculateTDS(
        annualGross,
        totalDeductions,
        data.regime || 'new'
      );

      await decl.update({
        ...data,
        section80CTotal,
        totalDeductions,
        taxableIncome,
        projectedTax: annualTax,
        monthlyTds,
      });

      res.json({ success: true, data: decl });
    } catch (err) { next(err); }
  },

  submit: async (req, res, next) => {
    try {
      const decl = await ITDeclaration.findOne({
        where: { userId: req.user.id },
        order: [['createdAt', 'DESC']],
      });
      if (!decl) throw new AppError('No declaration found. Please save a draft first.', 404);
      await decl.update({ status: 'submitted', submittedAt: new Date() });
      res.json({ success: true, data: decl });
    } catch (err) { next(err); }
  },
};

// ─── Employee Controller ──────────────────────────────────────────────────────

const empController = {
  getAll: async (req, res, next) => {
    try {
      const { department, role, search } = req.query;
      const where = { isActive: true };
      if (department) where.department = department;
      if (role)       where.role = role;
      if (search) {
        where[Op.or] = [
          { firstName:  { [Op.iLike]: `%${search}%` } },
          { lastName:   { [Op.iLike]: `%${search}%` } },
          { employeeId: { [Op.iLike]: `%${search}%` } },
          { email:      { [Op.iLike]: `%${search}%` } },
        ];
      }
      const employees = await User.findAll({
        where,
        order: [['firstName', 'ASC']],
        attributes: { exclude: ['password', 'mfaSecret'] },
      });
      res.json({ success: true, data: employees });
    } catch (err) { next(err); }
  },

  getById: async (req, res, next) => {
    try {
      const emp = await User.findByPk(req.params.id, {
        attributes: { exclude: ['password', 'mfaSecret'] },
      });
      if (!emp) throw new AppError('Employee not found', 404);
      res.json({ success: true, data: emp });
    } catch (err) { next(err); }
  },

  update: async (req, res, next) => {
    try {
      const emp = await User.findByPk(req.params.id);
      if (!emp) throw new AppError('Employee not found', 404);

      // Employees can only update their own profile
      if (req.user.role === 'employee' && req.user.id !== emp.id) {
        throw new AppError('Access denied', 403);
      }
      // Employees cannot elevate their own role or salary
      if (req.user.role === 'employee') {
        delete req.body.role;
        delete req.body.basicSalary;
        delete req.body.employeeId;
        delete req.body.isActive;
      }

      await emp.update(req.body);
      res.json({ success: true, data: emp });
    } catch (err) { next(err); }
  },

  deactivate: async (req, res, next) => {
    try {
      await User.update({ isActive: false }, { where: { id: req.params.id } });
      res.json({ success: true, message: 'Employee deactivated' });
    } catch (err) { next(err); }
  },
};

// ─── Export all controllers ───────────────────────────────────────────────────
module.exports = {
  sosController,
  trainingController,
  notifController,
  itController,
  empController,
};
