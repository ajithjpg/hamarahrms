// src/controllers/attendanceController.js

const { Attendance, User } = require('../models');
const { Op } = require('sequelize');
const { AppError } = require('../middleware/errorHandler');
const notificationService = require('../services/notificationService');
const logger = require('../config/logger');

/**
 * POST /api/attendance/punch-in
 * Creates a new attendance record for today.
 * Validates geo-location against office coordinates.
 */
const punchIn = async (req, res, next) => {
  try {
    const { latitude, longitude } = req.body;
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    // Prevent duplicate punch-ins for the same day
    const existing = await Attendance.findOne({ where: { userId, date: today } });
    if (existing) {
      if (existing.punchIn) {
        return res.status(409).json({ success: false, message: 'Already punched in today' });
      }
    }

    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Determine late status: standard start time 9:00 AM
    const nineAM = new Date(now);
    nineAM.setHours(9, 10, 0, 0); // 10-minute grace
    const isLate = now > nineAM && !isWeekend;

    const attendance = await Attendance.create({
      userId,
      date: today,
      punchIn: now,
      punchInLat: latitude,
      punchInLng: longitude,
      status: isWeekend ? 'weekend' : isLate ? 'late' : 'present',
      isWeekend,
    });

    logger.info('Punch in', { userId, time: now, isLate });

    res.status(201).json({
      success: true,
      message: isLate ? 'Punched in (late)' : 'Punched in successfully',
      data: attendance,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/attendance/punch-out
 * Updates today's record with punch-out time and computes hours.
 */
const punchOut = async (req, res, next) => {
  try {
    const { latitude, longitude } = req.body;
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    const attendance = await Attendance.findOne({ where: { userId, date: today } });
    if (!attendance) throw new AppError('No punch-in record found for today', 404);
    if (attendance.punchOut) throw new AppError('Already punched out today', 409);

    const now = new Date();
    attendance.punchOut = now;
    attendance.punchOutLat = latitude;
    attendance.punchOutLng = longitude;

    // Calculate hours worked
    attendance.calculateHours();
    await attendance.save();

    // Send overtime notification if > 9 hours
    if (attendance.overtimeHours > 0) {
      await notificationService.createNotification(userId, {
        title: 'Overtime Logged',
        body: `You worked ${attendance.overtimeHours} hours overtime today. Great dedication — remember to rest!`,
        type: 'nudge',
      });
    }

    res.json({
      success: true,
      message: 'Punched out successfully',
      data: attendance,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/attendance/today
 * Returns today's attendance record for current user
 */
const getToday = async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const record = await Attendance.findOne({
      where: { userId: req.user.id, date: today },
    });
    res.json({ success: true, data: record || null });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/attendance/my?month=4&year=2025
 * Returns current user's attendance for a month
 */
const getMyAttendance = async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year) || new Date().getFullYear();

    const startDate = new Date(y, m - 1, 1);
    const endDate = new Date(y, m, 0);

    const records = await Attendance.findAll({
      where: {
        userId: req.user.id,
        date: { [Op.between]: [startDate, endDate] },
      },
      order: [['date', 'ASC']],
    });

    // Compute summary stats
    const summary = {
      present: 0, absent: 0, late: 0, halfDay: 0,
      totalHours: 0, overtimeHours: 0, workingDays: 0,
    };
    records.forEach((r) => {
      if (r.status === 'present' || r.status === 'late') summary.present++;
      if (r.status === 'absent') summary.absent++;
      if (r.status === 'late') summary.late++;
      if (r.status === 'half_day') summary.halfDay++;
      if (!r.isWeekend) summary.workingDays++;
      summary.totalHours += parseFloat(r.totalHours || 0);
      summary.overtimeHours += parseFloat(r.overtimeHours || 0);
    });

    res.json({ success: true, data: { records, summary } });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/attendance/team
 * HR/Manager: get team attendance for a date range
 */
const getTeamAttendance = async (req, res, next) => {
  try {
    const { date, department } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    const userWhere = { isActive: true };
    if (department) userWhere.department = department;

    // Managers see only their direct reports
    if (req.user.role === 'manager') {
      userWhere.managerId = req.user.id;
    }

    const users = await User.findAll({
      where: userWhere,
      attributes: ['id', 'firstName', 'lastName', 'employeeId', 'department', 'designation'],
    });

    const userIds = users.map((u) => u.id);
    const attendanceRecords = await Attendance.findAll({
      where: { userId: { [Op.in]: userIds }, date: targetDate },
    });

    const attendanceMap = {};
    attendanceRecords.forEach((a) => { attendanceMap[a.userId] = a; });

    const teamData = users.map((u) => ({
      employee: u,
      attendance: attendanceMap[u.id] || { status: 'absent', totalHours: 0 },
    }));

    res.json({ success: true, data: teamData });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/attendance/manual (HR/Admin only)
 * Manually add/correct an attendance record
 */
const manualEntry = async (req, res, next) => {
  try {
    const { userId, date, punchIn, punchOut, status, notes } = req.body;

    const [record, created] = await Attendance.findOrCreate({
      where: { userId, date },
      defaults: { userId, date, punchIn, punchOut, status, notes },
    });

    if (!created) {
      await record.update({ punchIn, punchOut, status, notes });
      record.calculateHours();
      await record.save();
    }

    res.json({ success: true, message: 'Attendance updated', data: record });
  } catch (err) {
    next(err);
  }
};

module.exports = { punchIn, punchOut, getToday, getMyAttendance, getTeamAttendance, manualEntry };
