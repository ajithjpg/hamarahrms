// src/controllers/leaveController.js

const { Leave, LeaveBalance, User } = require('../models');
const { Op } = require('sequelize');
const { AppError } = require('../middleware/errorHandler');
const notificationService = require('../services/notificationService');
const logger = require('../config/logger');

// Leave type to balance field mapping
const LEAVE_FIELD_MAP = {
  casual: { total: 'casualLeave', used: 'casualUsed' },
  sick:   { total: 'sickLeave',   used: 'sickUsed' },
  earned: { total: 'earnedLeave', used: 'earnedUsed' },
  comp_off: { total: 'compOff',   used: 'compOffUsed' },
};

/**
 * Calculate business days between two dates (excluding weekends)
 */
const calcBusinessDays = (fromDate, toDate) => {
  let count = 0;
  const cur = new Date(fromDate);
  const end = new Date(toDate);
  while (cur <= end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
};

/**
 * POST /api/leaves/apply
 * Employee applies for leave
 */
const applyLeave = async (req, res, next) => {
  try {
    const { leaveType, fromDate, toDate, reason, isHalfDay, halfDayType, attachmentUrl } = req.body;
    const userId = req.user.id;

    const numberOfDays = isHalfDay ? 0.5 : calcBusinessDays(fromDate, toDate);
    if (numberOfDays <= 0) throw new AppError('Invalid date range', 400);

    // Check leave balance for deductible leave types
    if (LEAVE_FIELD_MAP[leaveType]) {
      const year = new Date(fromDate).getFullYear();
      const balance = await LeaveBalance.findOne({ where: { userId, year } });
      if (!balance) throw new AppError('Leave balance not found', 404);

      const { total, used } = LEAVE_FIELD_MAP[leaveType];
      const available = parseFloat(balance[total]) - parseFloat(balance[used]);
      if (numberOfDays > available) {
        throw new AppError(`Insufficient ${leaveType} leave balance. Available: ${available} days`, 400);
      }
    }

    // Check for overlapping leaves
    const overlap = await Leave.findOne({
      where: {
        userId,
        status: { [Op.in]: ['pending', 'manager_approved', 'approved'] },
        [Op.or]: [
          { fromDate: { [Op.between]: [fromDate, toDate] } },
          { toDate: { [Op.between]: [fromDate, toDate] } },
        ],
      },
    });
    if (overlap) throw new AppError('You already have a leave request for overlapping dates', 409);

    // Get manager ID from user profile
    const user = await User.findByPk(userId, { attributes: ['managerId'] });

    const leave = await Leave.create({
      userId,
      leaveType,
      fromDate,
      toDate,
      numberOfDays,
      reason,
      isHalfDay: isHalfDay || false,
      halfDayType,
      attachmentUrl,
      managerId: user.managerId,
    });

    // Notify manager
    if (user.managerId) {
      await notificationService.createNotification(user.managerId, {
        title: 'Leave Request',
        body: `${req.user.firstName} ${req.user.lastName} has applied for ${numberOfDays} day(s) ${leaveType} leave.`,
        type: 'leave_applied',
        metadata: { leaveId: leave.id },
      });
    }

    logger.info('Leave applied', { userId, leaveType, numberOfDays, fromDate, toDate });
    res.status(201).json({ success: true, message: 'Leave applied successfully', data: leave });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/leaves/:id/manager-action
 * Manager approves or rejects at level 1
 */
const managerAction = async (req, res, next) => {
  try {
    const { action, comment } = req.body; // action: 'approved' | 'rejected'
    const leave = await Leave.findByPk(req.params.id, {
      include: [{ model: User, as: 'employee', attributes: ['id', 'firstName', 'lastName', 'managerId'] }],
    });

    if (!leave) throw new AppError('Leave not found', 404);
    if (leave.managerId !== req.user.id) throw new AppError('Not authorised for this leave', 403);
    if (leave.status !== 'pending') throw new AppError('Leave is not in pending state', 400);

    await leave.update({
      managerAction: action,
      managerComment: comment,
      managerActionAt: new Date(),
      status: action === 'approved' ? 'manager_approved' : 'rejected',
      managerId: req.user.id,
    });

    // Notify employee
    await notificationService.createNotification(leave.userId, {
      title: `Leave ${action === 'approved' ? 'Approved' : 'Rejected'} by Manager`,
      body: comment || `Your leave request has been ${action} by your manager.`,
      type: action === 'approved' ? 'leave_approved' : 'leave_rejected',
      metadata: { leaveId: leave.id },
    });

    // Notify HR team if approved by manager (escalate to HR)
    if (action === 'approved') {
      const hrUsers = await User.findAll({ where: { role: 'hr', isActive: true }, attributes: ['id'] });
      for (const hr of hrUsers) {
        await notificationService.createNotification(hr.id, {
          title: 'Leave Pending HR Approval',
          body: `${leave.employee.firstName}'s leave is awaiting your approval.`,
          type: 'leave_applied',
          metadata: { leaveId: leave.id },
        });
      }
    }

    res.json({ success: true, message: `Leave ${action} by manager`, data: leave });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/leaves/:id/hr-action
 * HR gives final approval/rejection
 */
const hrAction = async (req, res, next) => {
  try {
    const { action, comment } = req.body;
    const leave = await Leave.findByPk(req.params.id);

    if (!leave) throw new AppError('Leave not found', 404);
    if (leave.status !== 'manager_approved') throw new AppError('Leave needs manager approval first', 400);

    const finalStatus = action === 'approved' ? 'approved' : 'rejected';

    await leave.update({
      hrAction: action,
      hrComment: comment,
      hrActionAt: new Date(),
      status: finalStatus,
      hrId: req.user.id,
    });

    // Deduct from leave balance on final approval
    if (action === 'approved' && LEAVE_FIELD_MAP[leave.leaveType]) {
      const year = new Date(leave.fromDate).getFullYear();
      const balance = await LeaveBalance.findOne({ where: { userId: leave.userId, year } });
      if (balance) {
        const { used } = LEAVE_FIELD_MAP[leave.leaveType];
        await balance.increment(used, { by: parseFloat(leave.numberOfDays) });
      }
    }

    await notificationService.createNotification(leave.userId, {
      title: `Leave ${action === 'approved' ? 'Finally Approved' : 'Rejected'} by HR`,
      body: comment || `Your leave request has been ${action} by HR.`,
      type: action === 'approved' ? 'leave_approved' : 'leave_rejected',
      metadata: { leaveId: leave.id },
    });

    res.json({ success: true, message: `Leave ${action} by HR`, data: leave });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/leaves/:id/cancel
 * Employee cancels a pending leave
 */
const cancelLeave = async (req, res, next) => {
  try {
    const leave = await Leave.findOne({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!leave) throw new AppError('Leave not found', 404);
    if (!['pending', 'manager_approved'].includes(leave.status)) {
      throw new AppError('Cannot cancel an already processed leave', 400);
    }
    await leave.update({ status: 'cancelled' });
    res.json({ success: true, message: 'Leave cancelled' });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/leaves/my
 */
const getMyLeaves = async (req, res, next) => {
  try {
    const { year, status } = req.query;
    const where = { userId: req.user.id };
    if (status) where.status = status;
    if (year) {
      where.fromDate = {
        [Op.gte]: new Date(year, 0, 1),
        [Op.lte]: new Date(year, 11, 31),
      };
    }

    const leaves = await Leave.findAll({
      where,
      order: [['createdAt', 'DESC']],
    });
    res.json({ success: true, data: leaves });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/leaves/balance
 */
const getMyBalance = async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    let balance = await LeaveBalance.findOne({ where: { userId: req.user.id, year } });
    if (!balance) {
      balance = await LeaveBalance.create({ userId: req.user.id, year });
    }
    res.json({ success: true, data: balance });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/leaves/team-pending
 * Manager sees pending leaves from their team
 */
const getTeamPending = async (req, res, next) => {
  try {
    const teamUsers = await User.findAll({
      where: { managerId: req.user.id },
      attributes: ['id'],
    });
    const userIds = teamUsers.map((u) => u.id);

    const leaves = await Leave.findAll({
      where: { userId: { [Op.in]: userIds }, status: 'pending' },
      include: [{ model: User, as: 'employee', attributes: ['id', 'firstName', 'lastName', 'employeeId', 'department'] }],
      order: [['createdAt', 'ASC']],
    });

    res.json({ success: true, data: leaves });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/leaves/hr-pending
 * HR sees all manager-approved leaves
 */
const getHRPending = async (req, res, next) => {
  try {
    const leaves = await Leave.findAll({
      where: { status: 'manager_approved' },
      include: [{ model: User, as: 'employee', attributes: ['id', 'firstName', 'lastName', 'employeeId', 'department'] }],
      order: [['createdAt', 'ASC']],
    });
    res.json({ success: true, data: leaves });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  applyLeave, managerAction, hrAction, cancelLeave,
  getMyLeaves, getMyBalance, getTeamPending, getHRPending,
};
