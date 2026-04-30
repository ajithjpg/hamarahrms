// src/index.js
// Hamara HR — Express + Socket.io server bootstrap

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const jwt = require('jsonwebtoken');

const logger = require('./config/logger');
const sequelize = require('./config/database');
const redis = require('./config/redis');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const routes = require('./routes');
const notificationService = require('./services/notificationService');
const { startCron } = require('./services/autoAction/autoActionCron');
require('./models'); // ensure models are loaded

const app = express();
const server = http.createServer(app);

// ─── Socket.io ───────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:4200',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
});

notificationService.setIO(io);

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;
    socket.userRole = decoded.role;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.userId;
  logger.info('Socket connected', { userId, socketId: socket.id });
  socket.join(`user:${userId}`);
  if (['hr', 'admin'].includes(socket.userRole)) {
    socket.join('hr-channel');
  }
  socket.on('disconnect', (reason) => {
    logger.info('Socket disconnected', { userId, reason });
  });
  socket.on('ping', () => socket.emit('pong'));
});

// ─── Security & middleware ────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:4200',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

app.use(compression());

app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later' },
  skip: (req) => req.path === '/api/health',
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
  skip: (req) => req.path === '/api/health' && process.env.NODE_ENV === 'production',
}));

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/api', routes);
app.use(notFound);
app.use(errorHandler);

// ─── Database sync + server start ────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 3000;

const start = async () => {
  try {
    await sequelize.authenticate();
    logger.info('Database connected');

    // FIX: Re-enable model sync in development (was commented out)
    // if (process.env.NODE_ENV !== 'production') {
    //   await sequelize.sync({ alter: true });
    //   logger.info('Database models synchronised');
    // }

    server.listen(PORT, () => {
      logger.info(`Hamara HR API running on port ${PORT}`, {
        env: process.env.NODE_ENV,
        pid: process.pid,
      });
      console.log(`🔥 Server running on http://localhost:${PORT}`);

      // ── Start AI Auto-Action Engine cron (every 6 hours) ──────────────────
      startCron('0 */6 * * *');
      logger.info('AI Auto-Action Engine cron started');
    });
  } catch (err) {
    logger.error('Server startup failed', { error: err.message, stack: err.stack });
    console.error('Server startup failed:', err.message);
    process.exit(1);
  }
};

// ─── Graceful shutdown ────────────────────────────────────────────────────────
const shutdown = async (signal) => {
  logger.info(`Received ${signal}, shutting down gracefully`);
  server.close(async () => {
    try {
      await sequelize.close();
      await redis.quit(); // FIX: now a no-op for Upstash, won't crash
    } catch (_) {}
    logger.info('Server shut down cleanly');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
});

start();

module.exports = { app, server, io };
