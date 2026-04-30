// src/controllers/aiController.js
const openaiService = require('../services/mistralService');
const burnoutService = require('../services/burnoutService');
const { BurnoutScore, User } = require('../models');
const { Op } = require('sequelize');

/** POST /api/ai/chat — Streaming SSE chatbot */
const chat = async (req, res, next) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ success: false, message: 'messages array required' });
    }
    await openaiService.streamChatResponse(messages, req.user, res);
  } catch (err) { next(err); }
};

/** GET /api/ai/burnout/me — Compute and return my burnout score */
const getMyBurnout = async (req, res, next) => {
  try {
    const score = await burnoutService.calculateBurnoutScore(req.user.id);
    res.json({ success: true, data: score });
  } catch (err) { next(err); }
};

/** GET /api/ai/burnout/team */
const getTeamBurnout = async (req, res, next) => {
  try {
    const where = { isActive: true };
    if (req.user.role === 'manager') where.managerId = req.user.id;

    const employees = await User.findAll({
      where,
      attributes: ['id', 'firstName', 'lastName', 'department', 'designation'],
    });
    const today = new Date().toISOString().split('T')[0];

    const scores = await BurnoutScore.findAll({
      where: { userId: { [Op.in]: employees.map(e => e.id) }, calculatedFor: today },
    });

    const scoreMap = {};
    scores.forEach(s => { scoreMap[s.userId] = s; });

    const result = employees.map(e => ({
      employee: e,
      burnout: scoreMap[e.id] || null,
    }));

    res.json({ success: true, data: result });
  } catch (err) { next(err); }
};

/** GET /api/ai/nudge */
const getNudge = async (req, res, next) => {
  try {
    const nudge = await openaiService.generateWeeklyNudge(req.user);
    res.json({ success: true, data: { nudge } });
  } catch (err) { next(err); }
};

/** POST /api/ai/voice-intent */
const voiceIntent = async (req, res, next) => {
  try {
    const { utterance } = req.body;
    if (!utterance) return res.status(400).json({ success: false, message: 'utterance required' });
    const intent = await openaiService.parseVoiceIntent(utterance);
    res.json({ success: true, data: intent });
  } catch (err) { next(err); }
};

module.exports = { chat, getMyBurnout, getTeamBurnout, getNudge, voiceIntent };
