// src/services/notificationService.js
// Creates DB notifications and emits real-time Socket.io events

const { Notification } = require('../models');
let io; // Socket.io instance, injected at server startup

const setIO = (socketIO) => { io = socketIO; };

/**
 * Create a notification and push it via Socket.io if user is connected
 */
const createNotification = async (userId, { title, body, type = 'general', metadata = null }) => {
  const notification = await Notification.create({ userId, title, body, type, metadata });

  // Emit to user's private Socket.io room
  if (io) {
    io.to(`user:${userId}`).emit('notification', {
      id: notification.id,
      title,
      body,
      type,
      metadata,
      createdAt: notification.createdAt,
    });
  }

  return notification;
};

/**
 * Broadcast to all HR/Admin users (used for SOS)
 */
const broadcastToRole = async (role, event, data) => {
  const { User } = require('../models');
  const users = await User.findAll({ where: { role, isActive: true }, attributes: ['id'] });

  for (const u of users) {
    if (io) io.to(`user:${u.id}`).emit(event, data);
    await createNotification(u.id, {
      title: data.title || 'Alert',
      body: data.body || JSON.stringify(data),
      type: data.type || 'general',
      metadata: data.metadata,
    });
  }
};

module.exports = { setIO, createNotification, broadcastToRole };
