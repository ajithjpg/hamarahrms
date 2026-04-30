-- ============================================================
-- Hamara HR — AI Auto-Action Engine
-- Migration: 001_auto_action_engine.sql
-- Run ONCE against your existing PostgreSQL database
-- ============================================================

-- ─── 1. action_rules ─────────────────────────────────────────────────────────
-- Stores all configurable trigger rules (editable via UI / API)
CREATE TABLE IF NOT EXISTS action_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Human-readable metadata
  name            VARCHAR(200)  NOT NULL,
  description     TEXT,
  is_active       BOOLEAN       NOT NULL DEFAULT true,

  -- ── Conditions (all thresholds are inclusive) ──────────────────────────────
  -- Each field is nullable; only non-null fields are evaluated
  attrition_score_gt    INTEGER,     -- trigger if attrition_score > this value
  health_score_lt       INTEGER,     -- trigger if health_score < this value
  salary_gap_lt         NUMERIC(6,2),-- trigger if salary_gap_pct < this value (negative = underpaid)
  performance_score_lt  NUMERIC(5,2),-- trigger if performance_score < this value
  engagement_score_lt   NUMERIC(5,2),-- trigger if engagement_score < this value

  -- ── Actions to take when rule fires ───────────────────────────────────────
  -- Array of action type strings, e.g. ["notify_manager","create_hr_task","suggest_salary"]
  actions         JSONB         NOT NULL DEFAULT '[]',

  -- ── Priority the rule assigns ──────────────────────────────────────────────
  priority        VARCHAR(10)   NOT NULL DEFAULT 'medium'
                  CHECK (priority IN ('high','medium','low')),

  -- ── Cooldown: don't re-fire this rule for same employee within N hours ─────
  cooldown_hours  INTEGER       NOT NULL DEFAULT 24,

  -- ── Audit ─────────────────────────────────────────────────────────────────
  created_by      UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_action_rules_active ON action_rules (is_active);

-- ─── 2. action_logs ──────────────────────────────────────────────────────────
-- Immutable audit trail of every action triggered
CREATE TABLE IF NOT EXISTS action_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  employee_id     UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_id         UUID          REFERENCES action_rules(id) ON DELETE SET NULL,

  -- Which action was taken
  triggered_action VARCHAR(100) NOT NULL,

  -- Why it fired (human-readable + machine-readable)
  reason          TEXT          NOT NULL,
  snapshot        JSONB,        -- full score snapshot at time of trigger

  -- Lifecycle
  status          VARCHAR(20)   NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','in_progress','completed','failed','skipped')),
  priority        VARCHAR(10)   NOT NULL DEFAULT 'medium'
                  CHECK (priority IN ('high','medium','low')),

  -- Optional: who acknowledged / resolved this log entry
  resolved_by     UUID          REFERENCES users(id) ON DELETE SET NULL,
  resolved_at     TIMESTAMPTZ,
  resolution_note TEXT,

  -- Timestamps
  triggered_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_action_logs_employee  ON action_logs (employee_id);
CREATE INDEX IF NOT EXISTS idx_action_logs_status    ON action_logs (status);
CREATE INDEX IF NOT EXISTS idx_action_logs_priority  ON action_logs (priority);
CREATE INDEX IF NOT EXISTS idx_action_logs_triggered ON action_logs (triggered_at DESC);

-- ─── 3. actions_queue ────────────────────────────────────────────────────────
-- Durable queue for async/retryable actions (email, Slack, etc.)
CREATE TABLE IF NOT EXISTS actions_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id          UUID          NOT NULL REFERENCES action_logs(id) ON DELETE CASCADE,

  action_type     VARCHAR(100)  NOT NULL,
  payload         JSONB         NOT NULL DEFAULT '{}',

  -- Queue state
  status          VARCHAR(20)   NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','done','failed')),
  attempts        INTEGER       NOT NULL DEFAULT 0,
  max_attempts    INTEGER       NOT NULL DEFAULT 3,
  last_error      TEXT,

  -- Scheduling
  run_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_actions_queue_pending ON actions_queue (status, run_at)
  WHERE status IN ('pending','failed');

-- ─── 4. Seed default rules ───────────────────────────────────────────────────
-- You can customise or delete these later from the UI
INSERT INTO action_rules
  (name, description, attrition_score_gt, health_score_lt, salary_gap_lt,
   actions, priority, cooldown_hours)
VALUES
  (
    'Critical Attrition Alert',
    'Employee shows very high resignation risk combined with poor health.',
    80, 50, NULL,
    '["notify_manager","create_hr_task","suggest_wellness"]',
    'high', 48
  ),
  (
    'Severe Underpaid + High Attrition',
    'Employee is significantly underpaid and is a high flight risk.',
    70, NULL, -20,
    '["notify_manager","create_hr_task","suggest_salary_increase"]',
    'high', 72
  ),
  (
    'Burnout + Engagement Drop',
    'Employee health score very low and high disengagement risk.',
    NULL, 35, NULL,
    '["suggest_wellness","notify_manager"]',
    'medium', 24
  ),
  (
    'Moderate Attrition Risk',
    'Early warning — moderate attrition risk detected.',
    60, NULL, NULL,
    '["create_hr_task"]',
    'medium', 24
  ),
  (
    'Salary Review Recommended',
    'Employee is underpaid relative to market, regardless of attrition risk.',
    NULL, NULL, -15,
    '["suggest_salary_increase","create_hr_task"]',
    'low', 168
  )
ON CONFLICT DO NOTHING;
