-- ============================================================
--  FAVX CRM — PostgreSQL Schema
--  Versão: 1.0.0
--  Módulos: Auth · Subcontas · Contatos · WhatsApp ·
--           Conversas · Funis · Automações · IA · Integrações · Auditoria
-- ============================================================

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. ACCOUNTS (contas-mãe / agências)
-- ============================================================

CREATE TABLE accounts (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(150) NOT NULL,
  slug          VARCHAR(80)  UNIQUE NOT NULL,
  plan          VARCHAR(50)  NOT NULL DEFAULT 'free',   -- free | starter | pro | enterprise
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. SUBCONTAS (clientes da agência)
-- ============================================================

CREATE TABLE subaccounts (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id    UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name          VARCHAR(150) NOT NULL,
  slug          VARCHAR(80)  NOT NULL,
  timezone      VARCHAR(60)  NOT NULL DEFAULT 'America/Sao_Paulo',
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, slug)
);

-- ============================================================
-- 3. USUÁRIOS & AUTENTICAÇÃO
-- ============================================================

CREATE TABLE users (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  subaccount_id   UUID        REFERENCES subaccounts(id) ON DELETE SET NULL,
  name            VARCHAR(150) NOT NULL,
  last_name       VARCHAR(150),
  email           VARCHAR(255) UNIQUE NOT NULL,
  phone           VARCHAR(50),
  password_hash   TEXT        NOT NULL,
  role            VARCHAR(50)  NOT NULL DEFAULT 'user',  -- super_admin | admin | user | viewer
  avatar_url      TEXT,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  email_verified  BOOLEAN      NOT NULL DEFAULT FALSE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Sessões ativas (JWT refresh tokens)
CREATE TABLE user_sessions (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token   TEXT        UNIQUE NOT NULL,
  ip_address      INET,
  user_agent      TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tokens de verificação (e-mail, reset de senha)
CREATE TABLE user_tokens (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(30) NOT NULL,   -- email_verify | password_reset | invite
  token       TEXT        UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  used_at     TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 4. CONTATOS
-- ============================================================

CREATE TABLE contacts (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  subaccount_id   UUID        NOT NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  name            VARCHAR(200) NOT NULL,
  email           VARCHAR(255),
  phone           VARCHAR(30),
  phone_country   VARCHAR(5)   DEFAULT 'BR',
  company         VARCHAR(150),
  position        VARCHAR(100),
  source          VARCHAR(80),   -- whatsapp | instagram | site | manual | import
  status          VARCHAR(50)    NOT NULL DEFAULT 'lead',  -- lead | customer | churned
  assigned_to     UUID           REFERENCES users(id) ON DELETE SET NULL,
  avatar_url      TEXT,
  notes           TEXT,
  custom_fields   JSONB          NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE TABLE contact_tags (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  subaccount_id UUID      NOT NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  name        VARCHAR(80) NOT NULL,
  color       VARCHAR(10) NOT NULL DEFAULT '#6B7280',
  UNIQUE (subaccount_id, name)
);

CREATE TABLE contact_tag_map (
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES contact_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (contact_id, tag_id)
);

-- ============================================================
-- 5. FUNIS & OPORTUNIDADES
-- ============================================================

CREATE TABLE pipelines (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  subaccount_id UUID        NOT NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  name          VARCHAR(150) NOT NULL,
  is_default    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE pipeline_stages (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  pipeline_id   UUID        NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,
  color         VARCHAR(10)  NOT NULL DEFAULT '#6B7280',
  position      SMALLINT     NOT NULL DEFAULT 0,
  is_won        BOOLEAN      NOT NULL DEFAULT FALSE,
  is_lost       BOOLEAN      NOT NULL DEFAULT FALSE
);

CREATE TABLE opportunities (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  subaccount_id   UUID        NOT NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  pipeline_id     UUID        NOT NULL REFERENCES pipelines(id),
  stage_id        UUID        NOT NULL REFERENCES pipeline_stages(id),
  contact_id      UUID        NOT NULL REFERENCES contacts(id),
  assigned_to     UUID        REFERENCES users(id) ON DELETE SET NULL,
  title           VARCHAR(200) NOT NULL,
  value           NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency        CHAR(3)      NOT NULL DEFAULT 'BRL',
  probability     SMALLINT     CHECK (probability BETWEEN 0 AND 100),
  expected_close  DATE,
  status          VARCHAR(30)  NOT NULL DEFAULT 'open',  -- open | won | lost
  lost_reason     TEXT,
  custom_fields   JSONB        NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 6. WHATSAPP — CONEXÕES & INSTÂNCIAS
-- ============================================================

CREATE TABLE whatsapp_instances (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  subaccount_id   UUID        NOT NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  instance_name   VARCHAR(100) NOT NULL,
  phone_number    VARCHAR(30),
  api_provider    VARCHAR(50)  NOT NULL DEFAULT 'evolution',  -- evolution | baileys | official
  api_url         TEXT,
  api_key         TEXT,           -- armazenado criptografado na aplicação
  status          VARCHAR(30)  NOT NULL DEFAULT 'disconnected',
  -- disconnected | connecting | connected | banned
  qr_code         TEXT,
  connected_at    TIMESTAMPTZ,
  disconnected_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (subaccount_id, instance_name)
);

CREATE TABLE whatsapp_webhooks (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  instance_id     UUID        NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  event_type      VARCHAR(80)  NOT NULL,  -- messages.upsert | connection.update | etc
  payload         JSONB        NOT NULL,
  processed       BOOLEAN      NOT NULL DEFAULT FALSE,
  processed_at    TIMESTAMPTZ,
  error           TEXT,
  received_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 7. CONVERSAS & MENSAGENS
-- ============================================================

CREATE TABLE conversations (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  subaccount_id   UUID        NOT NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  contact_id      UUID        NOT NULL REFERENCES contacts(id),
  instance_id     UUID        REFERENCES whatsapp_instances(id) ON DELETE SET NULL,
  channel         VARCHAR(30)  NOT NULL DEFAULT 'whatsapp',  -- whatsapp | email | sms | instagram
  status          VARCHAR(30)  NOT NULL DEFAULT 'open',       -- open | resolved | snoozed
  assigned_to     UUID         REFERENCES users(id) ON DELETE SET NULL,
  unread_count    INT          NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE messages (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id   UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  whatsapp_msg_id   VARCHAR(100),   -- ID retornado pela API do WhatsApp
  direction         VARCHAR(10)  NOT NULL,  -- inbound | outbound
  sender_type       VARCHAR(20)  NOT NULL,  -- contact | user | bot
  sender_id         UUID,
  type              VARCHAR(30)  NOT NULL DEFAULT 'text',
  -- text | image | audio | video | document | sticker | location | template
  content           TEXT,
  media_url         TEXT,
  media_mime        VARCHAR(80),
  metadata          JSONB        NOT NULL DEFAULT '{}',
  status            VARCHAR(20)  NOT NULL DEFAULT 'sent',
  -- sent | delivered | read | failed
  error_message     TEXT,
  sent_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  delivered_at      TIMESTAMPTZ,
  read_at           TIMESTAMPTZ
);

-- ============================================================
-- 8. AUTOMAÇÕES
-- ============================================================

CREATE TABLE automations (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  subaccount_id   UUID        NOT NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  name            VARCHAR(200) NOT NULL,
  description     TEXT,
  is_active       BOOLEAN      NOT NULL DEFAULT FALSE,
  trigger_type    VARCHAR(80)  NOT NULL,
  -- contact_created | tag_added | message_received | stage_changed |
  -- form_submitted | date_based | webhook | manual
  trigger_config  JSONB        NOT NULL DEFAULT '{}',
  run_count       INT          NOT NULL DEFAULT 0,
  last_run_at     TIMESTAMPTZ,
  created_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE automation_steps (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id   UUID        NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  position        SMALLINT     NOT NULL DEFAULT 0,
  type            VARCHAR(80)  NOT NULL,
  -- send_message | send_email | add_tag | remove_tag | move_stage |
  -- assign_user | wait | condition | webhook | ai_reply | create_task
  config          JSONB        NOT NULL DEFAULT '{}',
  next_step_id    UUID         REFERENCES automation_steps(id)
);

CREATE TABLE automation_runs (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id   UUID        NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  contact_id      UUID        NOT NULL REFERENCES contacts(id),
  status          VARCHAR(20)  NOT NULL DEFAULT 'running',
  -- running | completed | failed | cancelled
  current_step_id UUID        REFERENCES automation_steps(id),
  error           TEXT,
  started_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);

CREATE TABLE automation_step_logs (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id      UUID        NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  step_id     UUID        NOT NULL REFERENCES automation_steps(id),
  status      VARCHAR(20)  NOT NULL,   -- success | failed | skipped
  output      JSONB        NOT NULL DEFAULT '{}',
  error       TEXT,
  executed_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 9. AGENTES DE IA
-- ============================================================

CREATE TABLE ai_agents (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  subaccount_id   UUID        NOT NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  name            VARCHAR(150) NOT NULL,
  description     TEXT,
  model           VARCHAR(80)  NOT NULL DEFAULT 'claude-sonnet-4-6',
  system_prompt   TEXT,
  temperature     NUMERIC(3,2) NOT NULL DEFAULT 0.7,
  max_tokens      INT          NOT NULL DEFAULT 1024,
  is_active       BOOLEAN      NOT NULL DEFAULT FALSE,
  attached_to     VARCHAR(30)  NOT NULL DEFAULT 'all',   -- all | specific_instance
  instance_id     UUID         REFERENCES whatsapp_instances(id) ON DELETE SET NULL,
  handoff_keyword VARCHAR(50),   -- palavra para transferir para humano
  config          JSONB        NOT NULL DEFAULT '{}',
  created_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_agent_sessions (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id        UUID        NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  context         JSONB        NOT NULL DEFAULT '[]',   -- histórico de mensagens
  total_tokens    INT          NOT NULL DEFAULT 0,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, conversation_id)
);

CREATE TABLE ai_usage_logs (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  subaccount_id   UUID        NOT NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  agent_id        UUID        REFERENCES ai_agents(id) ON DELETE SET NULL,
  conversation_id UUID        REFERENCES conversations(id) ON DELETE SET NULL,
  model           VARCHAR(80)  NOT NULL,
  prompt_tokens   INT          NOT NULL DEFAULT 0,
  completion_tokens INT        NOT NULL DEFAULT 0,
  total_tokens    INT          NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(10,6) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 10. INTEGRAÇÕES
-- ============================================================

CREATE TABLE integrations (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  subaccount_id   UUID        NOT NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  provider        VARCHAR(80)  NOT NULL,
  -- whatsapp | instagram | facebook | google_calendar | stripe |
  -- hotmart | activecampaign | webhook | openai | gohighlevel
  name            VARCHAR(150) NOT NULL,
  credentials     JSONB        NOT NULL DEFAULT '{}',   -- criptografar antes de salvar
  config          JSONB        NOT NULL DEFAULT '{}',
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  last_tested_at  TIMESTAMPTZ,
  status          VARCHAR(30)  NOT NULL DEFAULT 'pending',
  -- pending | connected | error | expired
  error_message   TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 11. TEMPLATES DE MENSAGEM
-- ============================================================

CREATE TABLE message_templates (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  subaccount_id   UUID        NOT NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  name            VARCHAR(150) NOT NULL,
  channel         VARCHAR(30)  NOT NULL DEFAULT 'whatsapp',
  category        VARCHAR(50)  NOT NULL DEFAULT 'utility',  -- marketing | utility | authentication
  language        VARCHAR(10)  NOT NULL DEFAULT 'pt_BR',
  header_type     VARCHAR(20),   -- text | image | video | document
  header_content  TEXT,
  body            TEXT         NOT NULL,
  footer          TEXT,
  buttons         JSONB        NOT NULL DEFAULT '[]',
  variables       JSONB        NOT NULL DEFAULT '[]',
  wa_template_id  VARCHAR(100),  -- ID aprovado pelo WhatsApp Business
  status          VARCHAR(30)  NOT NULL DEFAULT 'draft',
  -- draft | pending_approval | approved | rejected
  created_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 12. TAREFAS
-- ============================================================

CREATE TABLE tasks (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  subaccount_id   UUID        NOT NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  contact_id      UUID        REFERENCES contacts(id) ON DELETE CASCADE,
  opportunity_id  UUID        REFERENCES opportunities(id) ON DELETE CASCADE,
  assigned_to     UUID        REFERENCES users(id) ON DELETE SET NULL,
  title           VARCHAR(200) NOT NULL,
  description     TEXT,
  due_date        TIMESTAMPTZ,
  priority        VARCHAR(20)  NOT NULL DEFAULT 'medium',  -- low | medium | high | urgent
  status          VARCHAR(30)  NOT NULL DEFAULT 'pending', -- pending | in_progress | done | cancelled
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 13. AUDITORIA
-- ============================================================

CREATE TABLE audit_logs (
  id              BIGSERIAL    PRIMARY KEY,
  account_id      UUID         REFERENCES accounts(id) ON DELETE SET NULL,
  subaccount_id   UUID         REFERENCES subaccounts(id) ON DELETE SET NULL,
  user_id         UUID         REFERENCES users(id) ON DELETE SET NULL,
  action          VARCHAR(100) NOT NULL,   -- contact.created | automation.triggered | etc
  entity_type     VARCHAR(80),
  entity_id       UUID,
  old_data        JSONB,
  new_data        JSONB,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ÍNDICES
-- ============================================================

-- Contatos
CREATE INDEX idx_contacts_subaccount  ON contacts(subaccount_id);
CREATE INDEX idx_contacts_email       ON contacts(email);
CREATE INDEX idx_contacts_phone       ON contacts(phone);
CREATE INDEX idx_contacts_assigned    ON contacts(assigned_to);

-- Conversas & Mensagens
CREATE INDEX idx_conversations_subaccount ON conversations(subaccount_id);
CREATE INDEX idx_conversations_contact    ON conversations(contact_id);
CREATE INDEX idx_conversations_status     ON conversations(status);
CREATE INDEX idx_messages_conversation    ON messages(conversation_id);
CREATE INDEX idx_messages_sent_at        ON messages(sent_at DESC);

-- WhatsApp
CREATE INDEX idx_wh_instances_subaccount ON whatsapp_instances(subaccount_id);
CREATE INDEX idx_wh_webhooks_instance    ON whatsapp_webhooks(instance_id);
CREATE INDEX idx_wh_webhooks_processed   ON whatsapp_webhooks(processed) WHERE processed = FALSE;

-- Automações
CREATE INDEX idx_automations_subaccount  ON automations(subaccount_id);
CREATE INDEX idx_automation_runs_contact ON automation_runs(contact_id);
CREATE INDEX idx_automation_runs_status  ON automation_runs(status);

-- IA
CREATE INDEX idx_ai_usage_subaccount     ON ai_usage_logs(subaccount_id);
CREATE INDEX idx_ai_usage_created        ON ai_usage_logs(created_at DESC);

-- Oportunidades
CREATE INDEX idx_opportunities_pipeline  ON opportunities(pipeline_id);
CREATE INDEX idx_opportunities_stage     ON opportunities(stage_id);
CREATE INDEX idx_opportunities_contact   ON opportunities(contact_id);

-- Auditoria
CREATE INDEX idx_audit_account           ON audit_logs(account_id);
CREATE INDEX idx_audit_subaccount        ON audit_logs(subaccount_id);
CREATE INDEX idx_audit_entity            ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_created           ON audit_logs(created_at DESC);

-- ============================================================
-- TRIGGER: atualiza updated_at automaticamente
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounts','subaccounts','users','contacts','pipelines',
    'opportunities','whatsapp_instances','conversations',
    'automations','ai_agents','ai_agent_sessions','integrations',
    'message_templates','tasks'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at
       BEFORE UPDATE ON %s
       FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t, t
    );
  END LOOP;
END;
$$;
