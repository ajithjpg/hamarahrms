// src/services/mistralService.js
// Mistral AI integration — replaces OpenAI for all AI features
// Uses mistral-large-latest for chat, mistral-small-latest for fast tasks

const { Mistral } = require('@mistralai/mistralai');
const redis = require('../config/redis');
const logger = require('../config/logger');

let client;
const getClient = () => {
  if (!client) client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
  return client;
};

// ─── HR Policy Knowledge Base (RAG) ──────────────────────────────────────────
const HR_POLICY_CONTEXT = `
HAMARA HR — COMPANY POLICY KNOWLEDGE BASE (FY 2024-25)

LEAVE POLICY:
- Casual Leave (CL): 12 days/year. Cannot be carried forward. Requires 1-day prior notice.
- Sick Leave (SL): 12 days/year. Medical certificate required for >2 consecutive days.
- Earned Leave (EL): 15 days/year. Can be carried forward (max 45 days).
- Maternity Leave: 26 weeks (first 2 children). Fully paid.
- Paternity Leave: 15 days. Must be taken within 6 months of birth.
- Bereavement Leave: 3 days for immediate family.
- Public Holidays: 14 per year.

ATTENDANCE POLICY:
- Standard working hours: 9:00 AM – 6:00 PM (9 hours including 1-hour lunch).
- Punch in via mobile app with GPS verification (100-metre radius of office).
- Late arrival >10 minutes = "Late" mark. 3 Late marks = 0.5 CL deducted.
- Overtime: Hours beyond 9 hrs/day logged as overtime. Overtime pay at 2× hourly rate.

PAYROLL POLICY:
- Salary credited on the last working day of each month.
- Payslips available in the HR portal by the 28th of each month.
- PF: 12% of basic salary (employer matches 12%). EPF wage ceiling: ₹15,000.
- ESI: 0.75% employee + 3.25% employer. Applicable if gross salary ≤ ₹21,000/month.
- Professional Tax: ₹200/month (Karnataka).
- TDS: Computed on projected annual income. IT declaration deadline: June 15.

HRA RULES:
- Metro city: HRA = 50% of basic. Non-metro: HRA = 40% of basic.
- HRA exemption = least of (actual HRA, rent paid – 10% of basic, 50%/40% of basic).
- Documents: Rent receipts + landlord PAN (if rent > ₹1 lakh/year).

IT DECLARATION:
- Section 80C limit: ₹1,50,000 (ELSS, PPF, LIC, EPF, home loan principal).
- Section 80D: ₹25,000 self + ₹25,000 parents.
- Section 24b: Home loan interest up to ₹2,00,000.
- New regime: Standard deduction ₹50,000. Rebate u/s 87A up to ₹7L.
- Old regime: All deductions applicable. Rebate u/s 87A up to ₹5L.

PERFORMANCE & TRAINING:
- Annual appraisals in April. Mid-year check-in in October.
- Training courses: 2 per quarter mandatory. Each completed course earns XP points.

EMERGENCY / SOS:
- Employees can trigger SOS via the mobile app. Response SLA: 15 minutes.
`;

/**
 * Stream a chat response via SSE — Mistral streaming
 */
const streamChatResponse = async (messages, user, res) => {
  const mistral = getClient();

  const systemPrompt = `You are Hamara HR Assistant — a friendly, knowledgeable HR companion for ${user.firstName} ${user.lastName} (${user.designation || user.role}, ${user.department || 'General'}).

Answer HR policy questions accurately using the policy knowledge base below.
Rules: 1) Only answer from the policy context. 2) Keep answers concise (under 150 words). 3) Use bullet points for lists.

POLICY KNOWLEDGE BASE:\n${HR_POLICY_CONTEXT}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const stream = await mistral.chat.stream({
      model: process.env.MISTRAL_MODEL || 'mistral-large-latest',
      maxTokens: 500,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-10),
      ],
    });

    for await (const chunk of stream) {
      const delta = chunk.data?.choices?.[0]?.delta?.content || '';
      if (delta) {
        res.write(`data: ${JSON.stringify({ content: delta, done: false })}\n\n`);
      }
    }
    res.write(`data: ${JSON.stringify({ content: '', done: true })}\n\n`);
    res.end();
  } catch (err) {
    logger.error('Mistral streaming error', { error: err.message });
    res.write(`data: ${JSON.stringify({ error: 'AI service temporarily unavailable', done: true })}\n\n`);
    res.end();
  }
};

/**
 * Generate burnout wellness insight
 */
const generateBurnoutInsight = async (user, burnoutData) => {
  const cacheKey = `burnout:insight:${user.id}:${burnoutData.score}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  try {
    const mistral = getClient();
    const resp = await mistral.chat.complete({
      model: process.env.MISTRAL_SMALL_MODEL || 'mistral-small-latest',
      maxTokens: 200,
      messages: [
        { role: 'system', content: 'You are a compassionate HR wellness advisor. Generate a personalised, warm, actionable wellness suggestion. Keep it under 100 words. Be encouraging, not alarming.' },
        { role: 'user', content: `Employee: ${user.firstName} (${user.designation || 'Employee'}, ${user.department || 'General'})\nBurnout Risk Score: ${burnoutData.score}/100 (${burnoutData.riskLevel} risk)\nKey factors: ${burnoutData.overtimeDays} overtime days, avg ${burnoutData.avgHours}h/day, ${burnoutData.weekendWorkDays} weekend days worked, ${burnoutData.absences} absences, ${burnoutData.leavesTaken} leaves taken in last 30 days.\nWrite a warm wellness suggestion.` },
      ],
    });
    const insight = resp.choices?.[0]?.message?.content || '';
    await redis.setEx(cacheKey, 3600, insight);
    return insight;
  } catch (err) {
    logger.error('Burnout insight failed', { error: err.message });
    return null;
  }
};

/**
 * Generate weekly personalised HR nudge
 */
const generateWeeklyNudge = async (user) => {
  const cacheKey = `nudge:${user.id}:${new Date().toISOString().split('T')[0]}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  try {
    const mistral = getClient();
    const resp = await mistral.chat.complete({
      model: process.env.MISTRAL_SMALL_MODEL || 'mistral-small-latest',
      maxTokens: 150,
      messages: [
        { role: 'system', content: 'You are a friendly HR companion. Generate a personalised weekly nudge for this employee. Could be career growth, wellness, compliance reminder, or recognition. Keep it under 80 words.' },
        { role: 'user', content: `Name: ${user.firstName}, Role: ${user.role}, Department: ${user.department || 'General'}, Designation: ${user.designation || 'N/A'}. Today: ${new Date().toLocaleDateString('en-IN')}` },
      ],
    });
    const nudge = resp.choices?.[0]?.message?.content || '';
    await redis.setEx(cacheKey, 86400, nudge);
    return nudge;
  } catch (err) {
    logger.error('Nudge failed', { error: err.message });
    return 'Great work this week! Remember to take short breaks to stay productive. 💪';
  }
};

/**
 * Parse voice command intent
 */
const parseVoiceIntent = async (utterance) => {
  try {
    const mistral = getClient();
    const resp = await mistral.chat.complete({
      model: process.env.MISTRAL_SMALL_MODEL || 'mistral-small-latest',
      maxTokens: 150,
      messages: [
        { role: 'system', content: `Parse the user's HR app voice command into a structured intent. Return ONLY valid JSON:\n{"intent":"punch_in|punch_out|apply_leave|show_payslip|check_balance|open_chatbot|trigger_sos|view_dashboard|open_training|unknown","params":{},"confidence":0.0-1.0,"response":"Brief confirmation"}` },
        { role: 'user', content: utterance },
      ],
    });
    const content = resp.choices?.[0]?.message?.content || '{}';
    const clean = content.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    return { intent: 'unknown', params: {}, confidence: 0, response: 'Sorry, I did not understand that.' };
  }
};

/**
 * Generate resignation retention insight
 */
const generateResignationInsight = async (user, data) => {
  try {
    const mistral = getClient();
    const resp = await mistral.chat.complete({
      model: process.env.MISTRAL_SMALL_MODEL || 'mistral-small-latest',
      maxTokens: 200,
      messages: [
        { role: 'system', content: 'You are an expert HR retention advisor. Provide a concise, actionable retention recommendation. Be empathetic and practical. Under 100 words.' },
        { role: 'user', content: `Employee: ${user.firstName} ${user.lastName}, ${user.designation || 'Staff'}, ${user.department || 'General'}\nResignation Risk: ${data.score}/100 (${data.riskLevel})\nSignals: ${data.signals.map(s => s.signal).join(', ')}\nRecommend specific retention actions.` },
      ],
    });
    return resp.choices?.[0]?.message?.content || null;
  } catch (err) {
    logger.error('Resignation insight failed', { error: err.message });
    return null;
  }
};

module.exports = {
  streamChatResponse,
  generateBurnoutInsight,
  generateWeeklyNudge,
  parseVoiceIntent,
  generateResignationInsight,
};
