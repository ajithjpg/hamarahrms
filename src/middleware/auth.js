// src/middleware/auth.js
// JWT verification middleware with Redis blacklist + RBAC helpers

const jwt = require('jsonwebtoken');
const redis = require('../config/redis');
const { User } = require('../models');
const logger = require('../config/logger');

/**
 * authenticate — verifies Bearer JWT, attaches req.user
 * Checks Redis blacklist so revoked tokens are rejected instantly.
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    // Check if token has been blacklisted (logout / password change)
    const blacklisted = await redis.get(`blacklist:${token}`);
    if (blacklisted) {
      return res.status(401).json({ success: false, message: 'Token has been revoked' });
    }

    // Verify signature and expiry
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Load fresh user (role/status may have changed since token issue)
    const user = await User.findOne({
      where: { id: decoded.id, isActive: true },
      attributes: ['id', 'employeeId', 'firstName', 'lastName', 'email', 'role', 'department', 'managerId'],
    });

    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    logger.error('Auth middleware error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Authentication error' });
  }
};

/**
 * authorize(...roles) — role-based access control
 * Usage: router.get('/payroll', authenticate, authorize('hr', 'admin'), handler)
 */
const authorize = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  if (!roles.includes(req.user.role)) {
    logger.warn('Unauthorized access attempt', {
      userId: req.user.id,
      role: req.user.role,
      required: roles,
      path: req.path,
    });
    return res.status(403).json({
      success: false,
      message: `Access denied. Required roles: ${roles.join(', ')}`,
    });
  }
  next();
};

/**
 * ownerOrAdmin — allows access if the requesting user owns the resource
 * OR has hr/admin role. Expects req.params.userId or req.params.id.
 */
const ownerOrAdmin = (req, res, next) => {
  const targetId = req.params.userId || req.params.id;
  const isOwner = req.user.id === targetId;
  const isPrivileged = ['hr', 'admin'].includes(req.user.role);

  if (isOwner || isPrivileged) return next();

  return res.status(403).json({ success: false, message: 'Access denied' });
};

module.exports = { authenticate, authorize, ownerOrAdmin };
