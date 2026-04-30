-- ============================================================
-- Hamara HR — PostgreSQL Database Initialization Script
-- Run once to create all tables, indexes, and seed demo data
-- Usage: psql -U postgres -d hamara_hr -f init.sql
-- ============================================================

-- Create database (run as superuser if needed)
-- CREATE DATABASE hamara_hr;
-- \c hamara_hr;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Users ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id      VARCHAR(20) UNIQUE NOT NULL,
    first_name       VARCHAR(50) NOT NULL,
    last_name        VARCHAR(50) NOT NULL,
    email            VARCHAR(100) UNIQUE NOT NULL,
    password         VARCHAR(255) NOT NULL,
    role             VARCHAR(20) NOT NULL DEFAULT 'employee'
                     CHECK (role IN ('employee','manager','hr','admin')),
    department       VARCHAR(100),
    designation      VARCHAR(100),
    manager_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    phone            VARCHAR(15),
    date_of_joining  DATE,
    date_of_birth    DATE,
    address          TEXT,
    avatar           VARCHAR(500),
    is_active        BOOLEAN NOT NULL DEFAULT true,
    mfa_enabled      BOOLEAN NOT NULL DEFAULT false,
    mfa_secret       VARCHAR(255),
    last_login       TIMESTAMPTZ,
    basic_salary     DECIMAL(12,2) DEFAULT 0,
    pan              VARCHAR(10),
    uan              VARCHAR(12),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email      ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_employee_id ON users(employee_id);
CREATE INDEX IF NOT EXISTS idx_users_role       ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_manager_id ON users(manager_id);
CREATE INDEX IF NOT EXISTS idx_users_dept       ON users(department);

-- ── Refresh Tokens ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       VARCHAR(500) UNIQUE NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    is_revoked  BOOLEAN NOT NULL DEFAULT false,
    user_agent  VARCHAR(500),
    ip_address  VARCHAR(45),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rt_user_id  ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_rt_token    ON refresh_tokens(token);

-- ── Attendance ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date             DATE NOT NULL,
    punch_in         TIMESTAMPTZ,
    punch_out        TIMESTAMPTZ,
    punch_in_lat     DECIMAL(10,8),
    punch_in_lng     DECIMAL(11,8),
    punch_out_lat    DECIMAL(10,8),
    punch_out_lng    DECIMAL(11,8),
    total_hours      DECIMAL(5,2) DEFAULT 0,
    overtime_hours   DECIMAL(5,2) DEFAULT 0,
    status           VARCHAR(20) NOT NULL DEFAULT 'present'
                     CHECK (status IN ('present','absent','half_day','late','on_leave','holiday','weekend')),
    is_weekend       BOOLEAN NOT NULL DEFAULT false,
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at       TIMESTAMPTZ,
    UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_att_user_id ON attendance(user_id);
CREATE INDEX IF NOT EXISTS idx_att_date    ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_att_status  ON attendance(status);

-- ── Leave Balances ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_balances (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    year           INTEGER NOT NULL,
    casual_leave   DECIMAL(4,1) DEFAULT 12,
    casual_used    DECIMAL(4,1) DEFAULT 0,
    sick_leave     DECIMAL(4,1) DEFAULT 12,
    sick_used      DECIMAL(4,1) DEFAULT 0,
    earned_leave   DECIMAL(4,1) DEFAULT 15,
    earned_used    DECIMAL(4,1) DEFAULT 0,
    comp_off       DECIMAL(4,1) DEFAULT 0,
    comp_off_used  DECIMAL(4,1) DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at     TIMESTAMPTZ,
    UNIQUE(user_id, year)
);

-- ── Leaves ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leaves (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_type       VARCHAR(20) NOT NULL
                     CHECK (leave_type IN ('casual','sick','earned','maternity','paternity','bereavement','comp_off','unpaid')),
    from_date        DATE NOT NULL,
    to_date          DATE NOT NULL,
    number_of_days   DECIMAL(4,1) NOT NULL,
    reason           TEXT NOT NULL,
    status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','manager_approved','approved','rejected','cancelled')),
    manager_id       UUID REFERENCES users(id),
    manager_action   VARCHAR(20) DEFAULT 'pending',
    manager_comment  TEXT,
    manager_action_at TIMESTAMPTZ,
    hr_id            UUID REFERENCES users(id),
    hr_action        VARCHAR(20) DEFAULT 'pending',
    hr_comment       TEXT,
    hr_action_at     TIMESTAMPTZ,
    attachment_url   VARCHAR(500),
    is_half_day      BOOLEAN DEFAULT false,
    half_day_type    VARCHAR(20),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_leaves_user_id   ON leaves(user_id);
CREATE INDEX IF NOT EXISTS idx_leaves_status    ON leaves(status);
CREATE INDEX IF NOT EXISTS idx_leaves_dates     ON leaves(from_date, to_date);

-- ── Payroll ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payrolls (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month                INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    year                 INTEGER NOT NULL,
    pay_period_start     DATE NOT NULL,
    pay_period_end       DATE NOT NULL,
    basic_salary         DECIMAL(12,2) DEFAULT 0,
    hra                  DECIMAL(12,2) DEFAULT 0,
    special_allowance    DECIMAL(12,2) DEFAULT 0,
    conveyance_allowance DECIMAL(12,2) DEFAULT 0,
    medical_allowance    DECIMAL(12,2) DEFAULT 0,
    overtime_pay         DECIMAL(12,2) DEFAULT 0,
    bonuses              DECIMAL(12,2) DEFAULT 0,
    gross_earnings       DECIMAL(12,2) DEFAULT 0,
    pf_employee          DECIMAL(12,2) DEFAULT 0,
    pf_employer          DECIMAL(12,2) DEFAULT 0,
    esi_employee         DECIMAL(12,2) DEFAULT 0,
    esi_employer         DECIMAL(12,2) DEFAULT 0,
    tds                  DECIMAL(12,2) DEFAULT 0,
    professional_tax     DECIMAL(12,2) DEFAULT 200,
    lop_deduction        DECIMAL(12,2) DEFAULT 0,
    total_deductions     DECIMAL(12,2) DEFAULT 0,
    net_salary           DECIMAL(12,2) DEFAULT 0,
    lop_days             DECIMAL(4,1) DEFAULT 0,
    working_days         INTEGER DEFAULT 26,
    payslip_url          VARCHAR(500),
    status               VARCHAR(20) DEFAULT 'draft'
                         CHECK (status IN ('draft','processed','paid','disputed')),
    processed_at         TIMESTAMPTZ,
    processed_by         UUID REFERENCES users(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at           TIMESTAMPTZ,
    UNIQUE(user_id, month, year)
);

CREATE INDEX IF NOT EXISTS idx_payroll_user_id ON payrolls(user_id);
CREATE INDEX IF NOT EXISTS idx_payroll_period  ON payrolls(month, year);

-- ── IT Declarations ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS it_declarations (
    id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    financial_year            VARCHAR(7) NOT NULL,
    regime                    VARCHAR(10) DEFAULT 'new' CHECK (regime IN ('old','new')),
    epf_contribution          DECIMAL(12,2) DEFAULT 0,
    ppf_contribution          DECIMAL(12,2) DEFAULT 0,
    life_insurance            DECIMAL(12,2) DEFAULT 0,
    elss                      DECIMAL(12,2) DEFAULT 0,
    home_loan_principal       DECIMAL(12,2) DEFAULT 0,
    nsc                       DECIMAL(12,2) DEFAULT 0,
    tuition_fees              DECIMAL(12,2) DEFAULT 0,
    section80_c_total         DECIMAL(12,2) DEFAULT 0,
    health_insurance_self     DECIMAL(12,2) DEFAULT 0,
    health_insurance_parents  DECIMAL(12,2) DEFAULT 0,
    home_loan_interest        DECIMAL(12,2) DEFAULT 0,
    hra_rent                  DECIMAL(12,2) DEFAULT 0,
    hra_city                  VARCHAR(10) DEFAULT 'metro',
    hra_exemption             DECIMAL(12,2) DEFAULT 0,
    total_deductions          DECIMAL(12,2) DEFAULT 0,
    taxable_income            DECIMAL(12,2) DEFAULT 0,
    projected_tax             DECIMAL(12,2) DEFAULT 0,
    monthly_tds               DECIMAL(12,2) DEFAULT 0,
    status                    VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved')),
    submitted_at              TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at                TIMESTAMPTZ,
    UNIQUE(user_id, financial_year)
);

-- ── Notifications ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      VARCHAR(200) NOT NULL,
    body       TEXT NOT NULL,
    type       VARCHAR(50) DEFAULT 'general',
    is_read    BOOLEAN NOT NULL DEFAULT false,
    metadata   JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notif_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_is_read ON notifications(is_read);

-- ── SOS Alerts ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sos_alerts (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message          TEXT DEFAULT 'Emergency! I need help.',
    latitude         DECIMAL(10,8),
    longitude        DECIMAL(11,8),
    address          TEXT,
    status           VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','acknowledged','resolved')),
    acknowledged_by  UUID REFERENCES users(id),
    acknowledged_at  TIMESTAMPTZ,
    resolved_at      TIMESTAMPTZ,
    resolution       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sos_status ON sos_alerts(status);
CREATE INDEX IF NOT EXISTS idx_sos_user   ON sos_alerts(user_id);

-- ── Training Courses ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_courses (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title       VARCHAR(200) NOT NULL,
    description TEXT,
    category    VARCHAR(100),
    duration    INTEGER,
    xp_reward   INTEGER DEFAULT 100,
    badge_name  VARCHAR(100),
    content_url VARCHAR(500),
    is_active   BOOLEAN DEFAULT true,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);

-- ── Training Enrollments ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_enrollments (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id    UUID NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
    status       VARCHAR(20) DEFAULT 'enrolled' CHECK (status IN ('enrolled','in_progress','completed')),
    progress     INTEGER DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    xp_earned    INTEGER DEFAULT 0,
    completed_at TIMESTAMPTZ,
    score        DECIMAL(5,2),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at   TIMESTAMPTZ,
    UNIQUE(user_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_enroll_user   ON training_enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_enroll_course ON training_enrollments(course_id);

-- ── Burnout Scores ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS burnout_scores (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score               INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
    risk_level          VARCHAR(20) NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
    overtime_score      INTEGER DEFAULT 0,
    long_hours_score    INTEGER DEFAULT 0,
    weekend_work_score  INTEGER DEFAULT 0,
    absence_score       INTEGER DEFAULT 0,
    leave_score         INTEGER DEFAULT 0,
    factors             JSONB,
    ai_insight          TEXT,
    calculated_for      DATE NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    UNIQUE(user_id, calculated_for)
);

CREATE INDEX IF NOT EXISTS idx_burnout_user ON burnout_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_burnout_date ON burnout_scores(calculated_for);
CREATE INDEX IF NOT EXISTS idx_burnout_risk ON burnout_scores(risk_level);

-- ════════════════════════════════════════════════════════════════════
-- AI Auto-Action Engine Tables
-- ════════════════════════════════════════════════════════════════════

-- action_rules: configurable trigger rules (editable via UI / API)
CREATE TABLE IF NOT EXISTS action_rules (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                  VARCHAR(200) NOT NULL,
    description           TEXT,
    is_active             BOOLEAN NOT NULL DEFAULT true,
    -- Conditions (null = not evaluated for this rule)
    attrition_score_gt    INTEGER,
    health_score_lt       INTEGER,
    salary_gap_lt         NUMERIC(6,2),
    performance_score_lt  NUMERIC(5,2),
    engagement_score_lt   NUMERIC(5,2),
    -- Actions to fire: JSON array of action type strings
    actions               JSONB NOT NULL DEFAULT '[]',
    priority              VARCHAR(10) NOT NULL DEFAULT 'medium'
                          CHECK (priority IN ('high','medium','low')),
    -- Cooldown: don't re-fire for same employee within N hours
    cooldown_hours        INTEGER NOT NULL DEFAULT 24,
    created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_action_rules_active ON action_rules(is_active);

-- action_logs: immutable audit trail of every triggered action
CREATE TABLE IF NOT EXISTS action_logs (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rule_id           UUID REFERENCES action_rules(id) ON DELETE SET NULL,
    triggered_action  VARCHAR(100) NOT NULL,
    reason            TEXT NOT NULL,
    snapshot          JSONB,
    status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','in_progress','completed','failed','skipped')),
    priority          VARCHAR(10) NOT NULL DEFAULT 'medium'
                      CHECK (priority IN ('high','medium','low')),
    resolved_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at       TIMESTAMPTZ,
    resolution_note   TEXT,
    triggered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_action_logs_employee   ON action_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_action_logs_status     ON action_logs(status);
CREATE INDEX IF NOT EXISTS idx_action_logs_priority   ON action_logs(priority);
CREATE INDEX IF NOT EXISTS idx_action_logs_triggered  ON action_logs(triggered_at DESC);

-- actions_queue: durable async queue for retryable action execution
CREATE TABLE IF NOT EXISTS actions_queue (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    log_id        UUID NOT NULL REFERENCES action_logs(id) ON DELETE CASCADE,
    action_type   VARCHAR(100) NOT NULL,
    payload       JSONB NOT NULL DEFAULT '{}',
    status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','done','failed')),
    attempts      INTEGER NOT NULL DEFAULT 0,
    max_attempts  INTEGER NOT NULL DEFAULT 3,
    last_error    TEXT,
    run_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_actions_queue_pending ON actions_queue(status, run_at)
    WHERE status IN ('pending','failed');

-- ═══════════════════════════════════════════════════════════════
-- SEED DATA — Demo users and sample records
-- ═══════════════════════════════════════════════════════════════

-- Password for all demo users: Password@123
-- bcrypt hash of 'Password@123' with 12 rounds:
DO $$
DECLARE
  admin_id   UUID := uuid_generate_v4();
  hr_id      UUID := uuid_generate_v4();
  mgr_id     UUID := uuid_generate_v4();
  emp1_id    UUID := uuid_generate_v4();
  emp2_id    UUID := uuid_generate_v4();
  course1_id UUID := uuid_generate_v4();
  course2_id UUID := uuid_generate_v4();
  pw_hash    TEXT := '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewYpwBAM2Y6VJ7.2';
  cur_year   INT  := EXTRACT(YEAR FROM NOW())::INT;
BEGIN

  -- ── Users ──────────────────────────────────────────────────────────────
  INSERT INTO users (id, employee_id, first_name, last_name, email, password, role, department, designation, phone, date_of_joining, basic_salary, pan, is_active)
  VALUES
    (admin_id, 'EMP001', 'Arjun',  'Sharma', 'admin@hamarahr.com',    pw_hash, 'admin',    'IT',               'System Administrator', '9876543210', '2022-01-01', 80000,  'ABCDE1234A', true),
    (hr_id,    'EMP002', 'Priya',  'Mehta',  'hr@hamarahr.com',       pw_hash, 'hr',       'Human Resources',  'HR Manager',           '9876543211', '2022-03-15', 60000,  'ABCDE1234B', true),
    (mgr_id,   'EMP003', 'Rohan',  'Verma',  'manager@hamarahr.com',  pw_hash, 'manager',  'Engineering',      'Engineering Manager',  '9876543212', '2021-06-01', 100000, 'ABCDE1234C', true),
    (emp1_id,  'EMP004', 'Sneha',  'Patel',  'employee@hamarahr.com', pw_hash, 'employee', 'Engineering',      'Software Engineer',    '9876543213', '2023-01-10', 50000,  'ABCDE1234D', true),
    (emp2_id,  'EMP005', 'Vikram', 'Nair',   'vikram@hamarahr.com',   pw_hash, 'employee', 'Engineering',      'Senior Developer',     '9876543214', '2022-07-20', 70000,  'ABCDE1234E', true)
  ON CONFLICT (email) DO NOTHING;

  -- Set manager relationships
  UPDATE users SET manager_id = mgr_id WHERE id IN (emp1_id, emp2_id);

  -- ── Leave balances ────────────────────────────────────────────────────
  INSERT INTO leave_balances (user_id, year, casual_leave, sick_leave, earned_leave)
  SELECT id, cur_year, 12, 12, 15 FROM users
  ON CONFLICT (user_id, year) DO NOTHING;

  -- ── Training courses ──────────────────────────────────────────────────
  INSERT INTO training_courses (id, title, description, category, duration, xp_reward, badge_name, is_active, created_by)
  VALUES
    (course1_id, 'POSH Act 2013 Compliance',     'Prevention of Sexual Harassment at Workplace', 'Compliance',  45,  150, 'Compliance Champion', true, hr_id),
    (course2_id, 'Effective Communication Skills','Email, presentation, and meeting management', 'Soft Skills', 60,  200, 'Communicator',        true, hr_id),
    (uuid_generate_v4(), 'Leadership Fundamentals',   'Core principles for new managers',             'Leadership',  90,  300, 'Leader',              true, hr_id),
    (uuid_generate_v4(), 'Data Privacy & DPDP Act',   'India DPDP 2023 compliance',                   'Compliance',  30,  100, 'Privacy Pro',         true, hr_id),
    (uuid_generate_v4(), 'Advanced Excel for HR',     'Pivot tables, VLOOKUP, HR dashboards',         'Technical',  120, 250, 'Excel Expert',        true, hr_id)
  ON CONFLICT DO NOTHING;

  -- ── Attendance last 30 days ───────────────────────────────────────────
  -- Insert for employees (emp1 and emp2) only, skip weekends
  INSERT INTO attendance (user_id, date, punch_in, punch_out, punch_in_lat, punch_in_lng, total_hours, overtime_hours, status, is_weekend)
  SELECT
    u.id,
    gs::DATE,
    (gs + INTERVAL '9 hours 5 minutes')::TIMESTAMPTZ,
    CASE
      WHEN u.id = emp2_id THEN (gs + INTERVAL '19 hours')::TIMESTAMPTZ  -- Vikram works late
      ELSE                     (gs + INTERVAL '18 hours 15 minutes')::TIMESTAMPTZ
    END,
    12.9716, 77.5946,
    CASE WHEN u.id = emp2_id THEN 9.92 ELSE 9.17 END,
    CASE WHEN u.id = emp2_id THEN 0.92 ELSE 0.17 END,
    'present',
    false
  FROM generate_series(NOW() - INTERVAL '29 days', NOW(), INTERVAL '1 day') AS gs
  CROSS JOIN (SELECT id FROM users WHERE id IN (emp1_id, emp2_id)) AS u
  WHERE EXTRACT(DOW FROM gs) NOT IN (0, 6)  -- Skip Sun/Sat
  ON CONFLICT (user_id, date) DO NOTHING;

  RAISE NOTICE 'Seed data inserted successfully!';
  RAISE NOTICE 'Demo credentials:';
  RAISE NOTICE '  admin@hamarahr.com    / Password@123';
  RAISE NOTICE '  hr@hamarahr.com       / Password@123';
  RAISE NOTICE '  manager@hamarahr.com  / Password@123';
  RAISE NOTICE '  employee@hamarahr.com / Password@123';

END $$;

-- ════════════════════════════════════════════════════════════════════
-- AI Auto-Action Engine — Default Seed Rules
-- ════════════════════════════════════════════════════════════════════
INSERT INTO action_rules
    (name, description, attrition_score_gt, health_score_lt, salary_gap_lt,
     performance_score_lt, engagement_score_lt, actions, priority, cooldown_hours)
VALUES
    (
        'Critical Attrition + Poor Health',
        'Employee shows very high resignation risk combined with poor health score.',
        80, 50, NULL, NULL, NULL,
        '["notify_manager","create_hr_task","suggest_wellness"]',
        'high', 48
    ),
    (
        'Severe Underpaid + High Attrition Risk',
        'Employee is significantly underpaid and is a high flight risk.',
        70, NULL, -20, NULL, NULL,
        '["notify_manager","create_hr_task","suggest_salary_increase"]',
        'high', 72
    ),
    (
        'Burnout + Low Engagement',
        'Employee health score very low indicating burnout and disengagement.',
        NULL, 35, NULL, NULL, 40,
        '["suggest_wellness","notify_manager"]',
        'medium', 24
    ),
    (
        'Moderate Attrition Risk',
        'Early warning — moderate attrition risk detected before it becomes critical.',
        60, NULL, NULL, NULL, NULL,
        '["create_hr_task"]',
        'medium', 24
    ),
    (
        'Salary Review Recommended',
        'Employee is underpaid relative to market, regardless of attrition risk.',
        NULL, NULL, -15, NULL, NULL,
        '["suggest_salary_increase","create_hr_task"]',
        'low', 168
    ),
    (
        'Low Performance + High Attrition',
        'Employee showing both declining performance and high flight risk.',
        65, NULL, NULL, 40, NULL,
        '["notify_manager","create_hr_task"]',
        'high', 48
    )
ON CONFLICT DO NOTHING;
