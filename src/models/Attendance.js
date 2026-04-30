// src/models/Attendance.js
// Records daily punch in/out with GPS coordinates and computed overtime

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Attendance = sequelize.define('Attendance', {
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
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: 'Calendar date of this attendance record',
  },
  punchIn: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  punchOut: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Geo-location for punch-in
  punchInLat: {
    type: DataTypes.DECIMAL(10, 8),
    allowNull: true,
  },
  punchInLng: {
    type: DataTypes.DECIMAL(11, 8),
    allowNull: true,
  },
  // Geo-location for punch-out
  punchOutLat: {
    type: DataTypes.DECIMAL(10, 8),
    allowNull: true,
  },
  punchOutLng: {
    type: DataTypes.DECIMAL(11, 8),
    allowNull: true,
  },
  // Computed values (updated on punch-out)
  totalHours: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0,
    comment: 'Total hours worked this day',
  },
  overtimeHours: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0,
    comment: 'Hours beyond standard 9hrs',
  },
  status: {
    type: DataTypes.ENUM('present', 'absent', 'half_day', 'late', 'on_leave', 'holiday', 'weekend'),
    defaultValue: 'present',
  },
  isWeekend: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'attendance',
  indexes: [
    { fields: ['user_id'] },
    { fields: ['date'] },
    { unique: true, fields: ['user_id', 'date'], name: 'unique_user_date' },
  ],
});

/**
 * Calculate total and overtime hours when punch_out is set.
 * Standard work day = 9 hours. Overtime = hours beyond 9.
 */
Attendance.prototype.calculateHours = function () {
  if (this.punchIn && this.punchOut) {
    const diffMs = new Date(this.punchOut) - new Date(this.punchIn);
    const hours = diffMs / (1000 * 60 * 60);
    this.totalHours = parseFloat(hours.toFixed(2));
    this.overtimeHours = parseFloat(Math.max(0, hours - 9).toFixed(2));
  }
};

module.exports = Attendance;
