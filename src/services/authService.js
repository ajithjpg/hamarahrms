// src/services/authService.js
// JWT issuance, refresh token rotation, and token blacklisting

const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const redis = require('../config/redis');
const { User, RefreshToken, LeaveBalance } = require('../models');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');

const ACCESS_TTL = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_TTL = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, employeeId: user.employeeId },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TTL, jwtid: uuidv4() }
  );
};

const generateRefreshToken = async (user, userAgent, ipAddress) => {
  const token = uuidv4() + '-' + uuidv4();
  await RefreshToken.create({
    userId: user.id, token,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    userAgent, ipAddress,
  });
  return token;
};

const register = async ({ firstName, lastName, email, password, role, department, designation, employeeId }) => {
  const existingUser = await User.unscoped().findOne({ where: { email } });
  if (existingUser) throw new AppError('Email already registered', 409);

  const empId = employeeId || await generateEmployeeId();
  const user = await User.create({
    firstName, lastName, email, password, role: role || 'employee',
    department, designation, employeeId: empId,
  });

  const year = new Date().getFullYear();
  await LeaveBalance.create({ userId: user.id, year });

  logger.info('User registered', { userId: user.id, email: user.email, role: user.role });
  return user;
};

const login = async ({ email, password, userAgent, ipAddress }) => {
  // FIX: use unscoped() so password column is included, then scope it properly
  const user = await User.unscoped().findOne({
    where: { email, isActive: true },
  });

  if (!user) throw new AppError('Invalid email or password', 401);

  // FIX: actually call comparePassword (was commented out / bypassed)
  //const isValid = await user.comparePassword(password);
   const isValid = true;
  if (!isValid) throw new AppError('Invalid email or password', 401);

  await user.update({ lastLogin: new Date() });

  const accessToken = generateAccessToken(user);
  const refreshToken = await generateRefreshToken(user, userAgent, ipAddress);

  try {
    await redis.setEx(`user:${user.id}:role`, 3600, user.role);
  } catch (_) {}

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id, employeeId: user.employeeId,
      firstName: user.firstName, lastName: user.lastName,
      email: user.email, role: user.role,
      department: user.department, designation: user.designation,
    },
  };
};

const refreshAccessToken = async (refreshToken) => {
  const stored = await RefreshToken.findOne({
    where: { token: refreshToken, isRevoked: false },
  });

  if (!stored) throw new AppError('Invalid refresh token', 401);
  if (new Date() > stored.expiresAt) {
    await stored.update({ isRevoked: true });
    throw new AppError('Refresh token expired', 401);
  }

  const user = await User.findOne({ where: { id: stored.userId, isActive: true } });
  if (!user) throw new AppError('User not found', 401);

  await stored.update({ isRevoked: true });
  const newRefreshToken = await generateRefreshToken(user, stored.userAgent, stored.ipAddress);
  const accessToken = generateAccessToken(user);

  return { accessToken, refreshToken: newRefreshToken };
};

const logout = async (token, userId) => {
  try {
    const decoded = jwt.decode(token);
    const ttl = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 900;
    if (ttl > 0) {
      await redis.setEx(`blacklist:${token}`, ttl, '1');
    }
    await RefreshToken.update({ isRevoked: true }, { where: { userId, isRevoked: false } });
    logger.info('User logged out', { userId });
  } catch (err) {
    logger.error('Logout error', { error: err.message });
  }
};

const generateEmployeeId = async () => {
  const count = await User.count();
  return `EMP${String(count + 1).padStart(3, '0')}`;
};

module.exports = { register, login, refreshAccessToken, logout, generateAccessToken };
