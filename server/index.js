// ======================================
// FAVX CRM — Servidor Express
// ======================================

require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const pool     = require('./db');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(require('path').join(__dirname, '..')));

// ============================================================
// HELPERS
// ============================================================

function signToken(payload, expiresIn) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
}

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Não autorizado.' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: 'Token inválido ou expirado.' });
  }
}

// ============================================================
// AUTH
// ============================================================

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' });

  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, password_hash, role, is_active, account_id, subaccount_id
       FROM users WHERE email = $1 LIMIT 1`,
      [email.toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ message: 'Credenciais inválidas.' });
    if (!user.is_active) return res.status(403).json({ message: 'Conta desativada.' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: 'Credenciais inválidas.' });

    const payload = {
      sub:           user.id,
      email:         user.email,
      role:          user.role,
      account_id:    user.account_id,
      subaccount_id: user.subaccount_id,
    };
    const token        = signToken(payload, process.env.JWT_EXPIRES_IN || '1d');
    const refreshToken = signToken({ sub: user.id }, process.env.JWT_REFRESH_EXPIRES_IN || '30d');

    const ip        = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO user_sessions (user_id, refresh_token, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, refreshToken, ip, userAgent, expiresAt]
    );
    await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);

    return res.json({
      token, refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, account_id: user.account_id },
    });
  } catch (err) {
    console.error('[auth/login]', err.message);
    return res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(204).send();
  try {
    let decoded;
    try { decoded = jwt.verify(token, process.env.JWT_SECRET); } catch { return res.status(204).send(); }
    await pool.query(
      `UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
      [decoded.sub]
    );
    return res.status(204).send();
  } catch (err) {
    console.error('[auth/logout]', err.message);
    return res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'E-mail é obrigatório.' });
  try {
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE email = $1 AND is_active = TRUE LIMIT 1`,
      [email.toLowerCase().trim()]
    );
    if (!rows[0]) return res.json({ message: 'Se o e-mail estiver cadastrado, você receberá o link.' });

    const userId  = rows[0].id;
    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 2 * 60 * 60 * 1000);

    await pool.query(
      `UPDATE user_tokens SET used_at = NOW() WHERE user_id = $1 AND type = 'password_reset' AND used_at IS NULL`,
      [userId]
    );
    await pool.query(
      `INSERT INTO user_tokens (user_id, type, token, expires_at) VALUES ($1, 'password_reset', $2, $3)`,
      [userId, token, expires]
    );
    console.log(`[forgot-password] Token para ${email}: ${token}`);
    return res.json({ message: 'Se o e-mail estiver cadastrado, você receberá o link.' });
  } catch (err) {
    console.error('[auth/forgot-password]', err.message);
    return res.status(500).json({ message: 'Erro interno.' });
  }
});

// ============================================================
// DASHBOARD
// ============================================================

app.get('/api/dashboard/stats', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const [contacts, conversations, agents, tasks] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM contacts WHERE subaccount_id = $1', [subaccount_id]),
      pool.query("SELECT COUNT(*) FROM conversations WHERE subaccount_id = $1 AND status = 'open'", [subaccount_id]),
      pool.query('SELECT COUNT(*) FROM ai_agents WHERE subaccount_id = $1 AND is_active = TRUE', [subaccount_id]),
      pool.query("SELECT COUNT(*) FROM tasks WHERE subaccount_id = $1 AND status = 'pending'", [subaccount_id]),
    ]);
    res.json({
      contacts:             parseInt(contacts.rows[0].count),
      active_conversations: parseInt(conversations.rows[0].count),
      active_agents:        parseInt(agents.rows[0].count),
      pending_tasks:        parseInt(tasks.rows[0].count),
    });
  } catch (err) {
    console.error('[dashboard/stats]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.get('/api/dashboard/advanced', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const [
      revenue,
      pipelineStages,
      pipelineCounts,
      oppsBySource,
      lostOpps,
      lostByReason,
    ] = await Promise.all([
      // 1. Receita: total geral, mês atual, mês anterior
      pool.query(
        `SELECT
           COALESCE(SUM(value), 0)                                                          AS total_won,
           COALESCE(SUM(value) FILTER (WHERE updated_at >= date_trunc('month', NOW())), 0)  AS won_this_month,
           COALESCE(SUM(value) FILTER (
             WHERE updated_at >= date_trunc('month', NOW() - interval '1 month')
               AND updated_at <  date_trunc('month', NOW())), 0)                            AS won_last_month,
           COUNT(*) FILTER (WHERE updated_at >= date_trunc('month', NOW()))                 AS won_count_month
         FROM opportunities
         WHERE subaccount_id = $1 AND status = 'won'`,
        [subaccount_id]
      ),

      // 2. Funis — etapas com contagens (sem carregar as oportunidades completas)
      pool.query(
        `SELECT
           ps.id, ps.name, ps.position, ps.color, ps.pipeline_id,
           COUNT(o.id) FILTER (WHERE o.status = 'open') AS open_count,
           COALESCE(SUM(o.value) FILTER (WHERE o.status = 'open'), 0) AS open_value
         FROM pipeline_stages ps
         JOIN pipelines p ON p.id = ps.pipeline_id AND p.subaccount_id = $1
         LEFT JOIN opportunities o ON o.stage_id = ps.id
         GROUP BY ps.id, ps.name, ps.position, ps.color, ps.pipeline_id
         ORDER BY ps.pipeline_id, ps.position ASC`,
        [subaccount_id]
      ),

      // 3. Funis — totais por pipeline (open/won/lost)
      pool.query(
        `SELECT
           p.id, p.name, p.is_default,
           COUNT(o.id) FILTER (WHERE o.status = 'open')  AS open_count,
           COUNT(o.id) FILTER (WHERE o.status = 'won')   AS won_count,
           COUNT(o.id) FILTER (WHERE o.status = 'lost')  AS lost_count,
           COALESCE(SUM(o.value) FILTER (WHERE o.status = 'won'), 0) AS won_value
         FROM pipelines p
         LEFT JOIN opportunities o ON o.pipeline_id = p.id
         WHERE p.subaccount_id = $1
         GROUP BY p.id, p.name, p.is_default
         ORDER BY p.created_at ASC`,
        [subaccount_id]
      ),

      // 4. Oportunidades por origem (via contato) — TODOS os status
      pool.query(
        `SELECT
           COALESCE(NULLIF(c.source, ''), '__none__') AS source,
           COUNT(o.id) AS count
         FROM opportunities o
         JOIN contacts c ON c.id = o.contact_id
         WHERE o.subaccount_id = $1
         GROUP BY source
         ORDER BY count DESC`,
        [subaccount_id]
      ),

      // 5. Oportunidades perdidas (últimas 30)
      pool.query(
        `SELECT
           o.id, o.title, o.value, o.lost_reason,
           TO_CHAR(o.updated_at, 'DD/MM/YYYY') AS lost_date,
           c.name AS contact_name,
           p.name AS pipeline_name
         FROM opportunities o
         JOIN contacts c ON c.id = o.contact_id
         JOIN pipelines p ON p.id = o.pipeline_id
         WHERE o.subaccount_id = $1 AND o.status = 'lost'
         ORDER BY o.updated_at DESC
         LIMIT 30`,
        [subaccount_id]
      ),

      // 6. Oportunidades perdidas agrupadas por motivo
      pool.query(
        `SELECT
           CASE WHEN lost_reason IS NULL OR TRIM(lost_reason) = '' THEN '__none__'
                ELSE TRIM(lost_reason) END AS reason,
           COUNT(*) AS count,
           COALESCE(SUM(value), 0) AS value
         FROM opportunities
         WHERE subaccount_id = $1 AND status = 'lost'
         GROUP BY reason
         ORDER BY count DESC`,
        [subaccount_id]
      ),
    ]);

    // Monta estrutura de pipelines com etapas aninhadas
    const stagesMap = {};
    pipelineStages.rows.forEach(s => {
      if (!stagesMap[s.pipeline_id]) stagesMap[s.pipeline_id] = [];
      stagesMap[s.pipeline_id].push({
        id:         s.id,
        name:       s.name,
        position:   parseInt(s.position),
        color:      s.color,
        open_count: parseInt(s.open_count),
        open_value: parseFloat(s.open_value),
      });
    });

    const pipelines = pipelineCounts.rows.map(p => ({
      id:         p.id,
      name:       p.name,
      is_default: p.is_default,
      open_count: parseInt(p.open_count),
      won_count:  parseInt(p.won_count),
      lost_count: parseInt(p.lost_count),
      won_value:  parseFloat(p.won_value),
      stages:     stagesMap[p.id] || [],
    }));

    const rev = revenue.rows[0];
    const wonThisMonth  = parseFloat(rev.won_this_month);
    const wonLastMonth  = parseFloat(rev.won_last_month);
    const growth        = wonLastMonth > 0 ? ((wonThisMonth - wonLastMonth) / wonLastMonth * 100) : null;

    res.json({
      revenue: {
        total:      parseFloat(rev.total_won),
        this_month: wonThisMonth,
        last_month: wonLastMonth,
        growth_pct: growth,
        won_count_month: parseInt(rev.won_count_month),
      },
      pipelines,
      opps_by_source: oppsBySource.rows.map(r => ({
        source: r.source,
        count:  parseInt(r.count),
      })),
      lost_opps: lostOpps.rows,
      lost_by_reason: lostByReason.rows.map(r => ({
        reason: r.reason,
        count:  parseInt(r.count),
        value:  parseFloat(r.value),
      })),
    });
  } catch (err) {
    console.error('[dashboard/advanced]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ============================================================
// CUSTOM DASHBOARDS — table init + CRUD + widget data engine
// ============================================================

;(async function initCustomDashboardTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS custom_dashboards (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subaccount_id UUID NOT NULL,
        name          VARCHAR(100) NOT NULL,
        position      INTEGER DEFAULT 0,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dashboard_widgets (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        dashboard_id UUID REFERENCES custom_dashboards(id) ON DELETE CASCADE,
        title        VARCHAR(150),
        pillar       VARCHAR(30) NOT NULL,
        display      VARCHAR(30) NOT NULL DEFAULT 'kpi',
        config       JSONB NOT NULL DEFAULT '{}',
        position     INTEGER DEFAULT 0,
        width        VARCHAR(20) DEFAULT 'third',
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        updated_at   TIMESTAMPTZ DEFAULT NOW()
      )`);
  } catch (err) {
    console.error('[init] custom_dashboard tables:', err.message);
  }
})();

async function executeWidgetQuery(pillar, config, subaccount_id) {
  const params = [subaccount_id];
  const wheres = [];
  function addParam(v) { params.push(v); return `$${params.length}`; }

  // Groups consecutive conditions separated by "or" connector
  function groupConds(conds) {
    if (!conds?.length) return [];
    const groups = [[conds[0]]];
    for (let i = 1; i < conds.length; i++) {
      if (conds[i].connector === 'or') groups.push([conds[i]]);
      else groups[groups.length - 1].push(conds[i]);
    }
    return groups;
  }

  // Pushes OR-grouped clauses into wheres
  function pushGroups(orParts) {
    const filled = orParts.filter(g => g.length > 0);
    if (filled.length === 0) return;
    if (filled.length === 1) { wheres.push(...filled[0]); return; }
    wheres.push(`(${filled.map(g => g.length > 1 ? `(${g.join(' AND ')})` : g[0]).join(' OR ')})`);
  }

  function buildDateWhere(col, op) {
    switch (op) {
      case 'today':       return `DATE(${col}) = CURRENT_DATE`;
      case 'yesterday':   return `DATE(${col}) = CURRENT_DATE - INTERVAL '1 day'`;
      case 'this_week':   return `${col} >= date_trunc('week', NOW())`;
      case 'last_week':   return `${col} >= date_trunc('week', NOW() - interval '1 week') AND ${col} < date_trunc('week', NOW())`;
      case 'this_month':  return `${col} >= date_trunc('month', NOW())`;
      case 'last_month':  return `${col} >= date_trunc('month', NOW() - interval '1 month') AND ${col} < date_trunc('month', NOW())`;
      case 'last_7_days': return `${col} >= NOW() - interval '7 days'`;
      case 'last_30_days':return `${col} >= NOW() - interval '30 days'`;
      case 'last_90_days':return `${col} >= NOW() - interval '90 days'`;
      default: return null;
    }
  }

  const { metric = 'count', conditions = [], group_by, sort = 'desc', limit = 50 } = config;
  const safeLimit = Math.min(Math.max(1, parseInt(limit) || 50), 100);

  if (pillar === 'contacts') {
    wheres.push(`subaccount_id = $1`);
    const ALLOWED = { created_at: 'created_at', updated_at: 'updated_at', source: 'source' };
    pushGroups(groupConds(conditions).map(group => {
      const clauses = [];
      for (const c of group) {
        const col = ALLOWED[c.field];
        if (!col) continue;
        if (c.field === 'source') {
          if (c.operator === 'in' && Array.isArray(c.value) && c.value.length) {
            const valid = c.value.filter(v => typeof v === 'string' && v.length < 60);
            if (valid.length) clauses.push(`${col} IN (${valid.map(addParam).join(',')})`);
          }
        } else {
          const w = buildDateWhere(col, c.operator);
          if (w) clauses.push(w);
        }
      }
      return clauses;
    }));
    const where     = `WHERE ${wheres.join(' AND ')}`;
    const metricSql = 'COUNT(*)';
    const GB_MAP = {
      source:     `COALESCE(NULLIF(source,''),'__none__')`,
      date_day:   `TO_CHAR(created_at,'YYYY-MM-DD')`,
      date_week:  `TO_CHAR(date_trunc('week',created_at),'YYYY-MM-DD')`,
      date_month: `TO_CHAR(date_trunc('month',created_at),'YYYY-MM')`,
    };
    if (group_by && GB_MAP[group_by]) {
      const { rows } = await pool.query(
        `SELECT ${GB_MAP[group_by]} AS label, ${metricSql} AS value FROM contacts ${where}
         GROUP BY 1 ORDER BY value ${sort === 'asc' ? 'ASC' : 'DESC'} LIMIT ${safeLimit}`,
        params
      );
      return { type: 'series', rows: rows.map(r => ({ label: r.label, value: +r.value })) };
    } else {
      const { rows } = await pool.query(`SELECT ${metricSql} AS value FROM contacts ${where}`, params);
      return { type: 'scalar', value: +rows[0]?.value || 0 };
    }
  }

  if (pillar === 'funnels') {
    wheres.push(`o.subaccount_id = $1`);
    const UUID_RE     = /^[0-9a-f-]{36}$/i;
    const VALID_ST    = new Set(['open', 'won', 'lost']);
    const NUM_OPS_MAP = { gt: '>', lt: '<', eq: '=', gte: '>=', lte: '<=' };
    const DATE_COLS   = { created_at: 'o.created_at', updated_at: 'o.updated_at' };
    pushGroups(groupConds(conditions).map(group => {
      const clauses = [];
      for (const c of group) {
        if (c.field === 'pipeline_id' || c.field === 'stage_id') {
          if (c.operator === 'in' && Array.isArray(c.value)) {
            const uuids = c.value.filter(v => UUID_RE.test(v));
            if (uuids.length) clauses.push(`o.${c.field} IN (${uuids.map(addParam).join(',')})`);
          }
        } else if (c.field === 'status') {
          if (c.operator === 'eq' && VALID_ST.has(c.value)) {
            clauses.push(`o.status = ${addParam(c.value)}`);
          } else if (c.operator === 'in' && Array.isArray(c.value)) {
            const valid = c.value.filter(v => VALID_ST.has(v));
            if (valid.length) clauses.push(`o.status IN (${valid.map(addParam).join(',')})`);
          }
        } else if (c.field === 'value') {
          const num = parseFloat(c.value);
          const op  = NUM_OPS_MAP[c.operator];
          if (!isNaN(num) && op) clauses.push(`o.value ${op} ${addParam(num)}`);
        } else if (DATE_COLS[c.field]) {
          const w = buildDateWhere(DATE_COLS[c.field], c.operator);
          if (w) clauses.push(w);
        }
      }
      return clauses;
    }));
    const METRIC_SQL = {
      count:     'COUNT(o.id)',
      sum_value: 'COALESCE(SUM(o.value),0)',
      avg_value: 'ROUND(AVG(o.value)::numeric,2)',
    };
    const metricSql = METRIC_SQL[metric] || 'COUNT(o.id)';
    const joins     = `LEFT JOIN pipeline_stages ps ON ps.id = o.stage_id LEFT JOIN pipelines p ON p.id = o.pipeline_id`;
    const where     = `WHERE ${wheres.join(' AND ')}`;
    const GB_MAP = {
      pipeline:   `COALESCE(p.name,'—')`,
      stage:      `COALESCE(ps.name,'—')`,
      status:     `o.status`,
      date_day:   `TO_CHAR(o.created_at,'YYYY-MM-DD')`,
      date_month: `TO_CHAR(date_trunc('month',o.created_at),'YYYY-MM')`,
    };
    if (group_by && GB_MAP[group_by]) {
      const { rows } = await pool.query(
        `SELECT ${GB_MAP[group_by]} AS label, ${metricSql} AS value FROM opportunities o ${joins} ${where}
         GROUP BY 1 ORDER BY value ${sort === 'asc' ? 'ASC' : 'DESC'} LIMIT ${safeLimit}`,
        params
      );
      return { type: 'series', rows: rows.map(r => ({ label: r.label, value: +r.value })) };
    } else {
      const { rows } = await pool.query(
        `SELECT ${metricSql} AS value FROM opportunities o ${joins} ${where}`, params
      );
      return { type: 'scalar', value: +rows[0]?.value || 0 };
    }
  }

  if (pillar === 'conversations') {
    wheres.push(`subaccount_id = $1`);
    const VALID_ST  = new Set(['open', 'closed', 'resolved']);
    const DATE_COLS = { created_at: 'created_at', updated_at: 'updated_at', last_message_at: 'last_message_at' };
    pushGroups(groupConds(conditions).map(group => {
      const clauses = [];
      for (const c of group) {
        if (c.field === 'status') {
          if (c.operator === 'eq' && VALID_ST.has(c.value)) {
            clauses.push(`status = ${addParam(c.value)}`);
          } else if (c.operator === 'in' && Array.isArray(c.value)) {
            const valid = c.value.filter(v => VALID_ST.has(v));
            if (valid.length) clauses.push(`status IN (${valid.map(addParam).join(',')})`);
          }
        } else if (DATE_COLS[c.field]) {
          const w = buildDateWhere(DATE_COLS[c.field], c.operator);
          if (w) clauses.push(w);
        }
      }
      return clauses;
    }));
    const where = `WHERE ${wheres.join(' AND ')}`;
    const GB_MAP = {
      status:     'status',
      date_day:   `TO_CHAR(created_at,'YYYY-MM-DD')`,
      date_month: `TO_CHAR(date_trunc('month',created_at),'YYYY-MM')`,
    };
    if (group_by && GB_MAP[group_by]) {
      const { rows } = await pool.query(
        `SELECT ${GB_MAP[group_by]} AS label, COUNT(*) AS value FROM conversations ${where}
         GROUP BY 1 ORDER BY value ${sort === 'asc' ? 'ASC' : 'DESC'} LIMIT ${safeLimit}`,
        params
      );
      return { type: 'series', rows: rows.map(r => ({ label: r.label, value: +r.value })) };
    } else {
      const { rows } = await pool.query(`SELECT COUNT(*) AS value FROM conversations ${where}`, params);
      return { type: 'scalar', value: +rows[0]?.value || 0 };
    }
  }

  throw new Error(`Unknown pillar: ${pillar}`);
}

app.get('/api/custom-dashboards', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      `SELECT id, name, position, created_at FROM custom_dashboards
       WHERE subaccount_id = $1 ORDER BY position ASC, created_at ASC`,
      [subaccount_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[custom-dashboards GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/custom-dashboards', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: 'Nome é obrigatório.' });
  try {
    const { rows: pos } = await pool.query(
      `SELECT COALESCE(MAX(position),0)+1 AS p FROM custom_dashboards WHERE subaccount_id=$1`,
      [subaccount_id]
    );
    const { rows } = await pool.query(
      `INSERT INTO custom_dashboards (subaccount_id, name, position) VALUES ($1,$2,$3) RETURNING *`,
      [subaccount_id, name.trim(), pos[0].p]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[custom-dashboards POST]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.put('/api/custom-dashboards/:id', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: 'Nome é obrigatório.' });
  try {
    const { rows } = await pool.query(
      `UPDATE custom_dashboards SET name=$1, updated_at=NOW()
       WHERE id=$2 AND subaccount_id=$3 RETURNING *`,
      [name.trim(), req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Dashboard não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[custom-dashboards PUT]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.delete('/api/custom-dashboards/:id', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM custom_dashboards WHERE id=$1 AND subaccount_id=$2`,
      [req.params.id, subaccount_id]
    );
    if (!rowCount) return res.status(404).json({ message: 'Dashboard não encontrado.' });
    res.status(204).send();
  } catch (err) {
    console.error('[custom-dashboards DELETE]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.get('/api/custom-dashboards/:dashId/widgets', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows: dash } = await pool.query(
      `SELECT id FROM custom_dashboards WHERE id=$1 AND subaccount_id=$2`,
      [req.params.dashId, subaccount_id]
    );
    if (!dash.length) return res.status(404).json({ message: 'Dashboard não encontrado.' });
    const { rows } = await pool.query(
      `SELECT id, title, pillar, display, config, position, width
       FROM dashboard_widgets WHERE dashboard_id=$1 ORDER BY position ASC, created_at ASC`,
      [req.params.dashId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[widgets GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/custom-dashboards/:dashId/widgets', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  const { title, pillar, display, config, width } = req.body;
  const VALID_PILLARS  = ['contacts', 'funnels', 'conversations'];
  const VALID_DISPLAYS = ['kpi', 'bar', 'pie', 'line', 'table'];
  if (!VALID_PILLARS.includes(pillar))   return res.status(400).json({ message: 'Pilar inválido.' });
  if (!VALID_DISPLAYS.includes(display)) return res.status(400).json({ message: 'Display inválido.' });
  try {
    const { rows: dash } = await pool.query(
      `SELECT id FROM custom_dashboards WHERE id=$1 AND subaccount_id=$2`,
      [req.params.dashId, subaccount_id]
    );
    if (!dash.length) return res.status(404).json({ message: 'Dashboard não encontrado.' });
    const { rows: pos } = await pool.query(
      `SELECT COALESCE(MAX(position),0)+1 AS p FROM dashboard_widgets WHERE dashboard_id=$1`,
      [req.params.dashId]
    );
    const { rows } = await pool.query(
      `INSERT INTO dashboard_widgets (dashboard_id,title,pillar,display,config,position,width)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.dashId, title||null, pillar, display, JSON.stringify(config||{}), pos[0].p, width||'third']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[widgets POST]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.put('/api/dashboard-widgets/:id', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  const { title, display, config, width } = req.body;
  const VALID_DISPLAYS = ['kpi', 'bar', 'pie', 'line', 'table'];
  if (display && !VALID_DISPLAYS.includes(display))
    return res.status(400).json({ message: 'Display inválido.' });
  try {
    const { rows } = await pool.query(
      `UPDATE dashboard_widgets SET
         title      = COALESCE($1, title),
         display    = COALESCE($2, display),
         config     = COALESCE($3, config),
         width      = COALESCE($4, width),
         updated_at = NOW()
       WHERE id=$5
         AND dashboard_id IN (SELECT id FROM custom_dashboards WHERE subaccount_id=$6)
       RETURNING *`,
      [title||null, display||null, config ? JSON.stringify(config) : null, width||null,
       req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Widget não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[widget PUT]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.delete('/api/dashboard-widgets/:id', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM dashboard_widgets WHERE id=$1
         AND dashboard_id IN (SELECT id FROM custom_dashboards WHERE subaccount_id=$2)`,
      [req.params.id, subaccount_id]
    );
    if (!rowCount) return res.status(404).json({ message: 'Widget não encontrado.' });
    res.status(204).send();
  } catch (err) {
    console.error('[widget DELETE]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/dashboard-widgets/:id/data', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows: ws } = await pool.query(
      `SELECT dw.pillar, dw.config FROM dashboard_widgets dw
       JOIN custom_dashboards cd ON cd.id = dw.dashboard_id
       WHERE dw.id=$1 AND cd.subaccount_id=$2`,
      [req.params.id, subaccount_id]
    );
    if (!ws.length) return res.status(404).json({ message: 'Widget não encontrado.' });
    const result = await executeWidgetQuery(ws[0].pillar, ws[0].config, subaccount_id);
    res.json(result);
  } catch (err) {
    console.error('[widget/data]', err.message);
    res.status(500).json({ message: 'Erro ao executar query do widget.' });
  }
});

// ============================================================
// CONTACTS
// ============================================================

app.get('/api/contacts', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  const search = (req.query.search || '').trim();
  const status = req.query.status || '';

  try {
    let where    = 'WHERE subaccount_id = $1';
    const params = [subaccount_id];

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (name ILIKE $${params.length} OR email ILIKE $${params.length} OR phone ILIKE $${params.length})`;
    }
    if (status && status !== 'all') {
      params.push(status);
      where += ` AND status = $${params.length}`;
    }

    const [data, total] = await Promise.all([
      pool.query(
        `SELECT id, name, email, phone, company, source, status, created_at
         FROM contacts ${where} ORDER BY created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      pool.query(`SELECT COUNT(*) FROM contacts ${where}`, params),
    ]);

    res.json({ data: data.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (err) {
    console.error('[contacts GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/contacts', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { name, email, phone, company, source, status } = req.body;
  if (!name) return res.status(400).json({ message: 'Nome é obrigatório.' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO contacts (subaccount_id, name, email, phone, company, source, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [subaccount_id, name, email || null, phone || null, company || null, source || 'manual', status || 'lead']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[contacts POST]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.put('/api/contacts/:id', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { name, email, phone, company, source, status, notes } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE contacts SET
         name    = COALESCE($1, name),   email   = COALESCE($2, email),
         phone   = COALESCE($3, phone),  company = COALESCE($4, company),
         source  = COALESCE($5, source), status  = COALESCE($6, status),
         notes   = COALESCE($7, notes)
       WHERE id = $8 AND subaccount_id = $9 RETURNING *`,
      [name, email, phone, company, source, status, notes, req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Contato não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[contacts PUT]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.delete('/api/contacts/:id', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verifica se o contato pertence à subconta
    const check = await client.query(
      'SELECT id FROM contacts WHERE id = $1 AND subaccount_id = $2',
      [req.params.id, subaccount_id]
    );
    if (!check.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Contato não encontrado.' });
    }

    // Remove dependências sem CASCADE
    await client.query('DELETE FROM automation_runs WHERE contact_id = $1', [req.params.id]);
    await client.query('DELETE FROM opportunities   WHERE contact_id = $1', [req.params.id]);
    await client.query('DELETE FROM conversations   WHERE contact_id = $1', [req.params.id]); // mensagens cascadeiam

    await client.query('DELETE FROM contacts WHERE id = $1', [req.params.id]);

    await client.query('COMMIT');
    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[contacts DELETE]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  } finally {
    client.release();
  }
});

// ============================================================
// CONVERSATIONS & MESSAGES
// ============================================================

app.get('/api/conversations', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { contact_id } = req.query;
  try {
    const params = [subaccount_id];
    let where = 'WHERE cv.subaccount_id = $1';
    if (contact_id) { params.push(contact_id); where += ` AND cv.contact_id = $${params.length}`; }
    const { rows } = await pool.query(
      `SELECT cv.id, cv.status, cv.unread_count, cv.last_message_at, cv.channel, cv.contact_id,
              c.name AS contact_name, c.phone AS contact_phone
       FROM conversations cv
       JOIN contacts c ON c.id = cv.contact_id
       ${where}
       ORDER BY cv.last_message_at DESC NULLS LAST, cv.created_at DESC
       LIMIT 60`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[conversations GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/conversations', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { contact_id, channel } = req.body;
  if (!contact_id) return res.status(400).json({ message: 'contact_id é obrigatório.' });
  try {
    const { rows: existing } = await pool.query(
      `SELECT cv.id, cv.status, cv.unread_count, cv.last_message_at, cv.channel, cv.contact_id,
              c.name AS contact_name, c.phone AS contact_phone
       FROM conversations cv JOIN contacts c ON c.id = cv.contact_id
       WHERE cv.subaccount_id = $1 AND cv.contact_id = $2 AND cv.status = 'open' LIMIT 1`,
      [subaccount_id, contact_id]
    );
    if (existing.length) return res.json(existing[0]);

    const { rows: ins } = await pool.query(
      `INSERT INTO conversations (subaccount_id, contact_id, channel, status)
       VALUES ($1, $2, $3, 'open') RETURNING id`,
      [subaccount_id, contact_id, channel || 'whatsapp']
    );
    const { rows: conv } = await pool.query(
      `SELECT cv.id, cv.status, cv.unread_count, cv.last_message_at, cv.channel, cv.contact_id,
              c.name AS contact_name, c.phone AS contact_phone
       FROM conversations cv JOIN contacts c ON c.id = cv.contact_id
       WHERE cv.id = $1`,
      [ins[0].id]
    );
    res.status(201).json(conv[0]);
  } catch (err) {
    console.error('[conversations POST]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.get('/api/conversations/:id/messages', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows: conv } = await pool.query(
      'SELECT id FROM conversations WHERE id = $1 AND subaccount_id = $2',
      [req.params.id, subaccount_id]
    );
    if (!conv.length) return res.status(404).json({ message: 'Conversa não encontrada.' });

    const { since } = req.query;
    const params = [req.params.id];
    let sinceClause = '';
    if (since) { params.push(since); sinceClause = ` AND sent_at > $${params.length}`; }

    const { rows } = await pool.query(
      `SELECT * FROM messages WHERE conversation_id = $1${sinceClause} ORDER BY sent_at ASC LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[messages GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/conversations/:id/messages', auth, async (req, res) => {
  const { subaccount_id, sub: user_id } = req.user;
  const { content } = req.body;
  if (!content) return res.status(400).json({ message: 'Conteúdo é obrigatório.' });

  try {
    const { rows: conv } = await pool.query(
      `SELECT cv.id, cv.channel, c.phone AS contact_phone
       FROM conversations cv JOIN contacts c ON c.id = cv.contact_id
       WHERE cv.id = $1 AND cv.subaccount_id = $2`,
      [req.params.id, subaccount_id]
    );
    if (!conv.length) return res.status(404).json({ message: 'Conversa não encontrada.' });

    const { rows } = await pool.query(
      `INSERT INTO messages (conversation_id, direction, sender_type, sender_id, content)
       VALUES ($1, 'outbound', 'user', $2, $3) RETURNING *`,
      [req.params.id, user_id, content]
    );
    await pool.query('UPDATE conversations SET last_message_at = NOW() WHERE id = $1', [req.params.id]);

    // Send via Evolution API if WhatsApp conversation
    if (conv[0].channel === 'whatsapp' && conv[0].contact_phone) {
      const { rows: cfg } = await pool.query(
        `SELECT evolution_api_url, evolution_api_key, evolution_instance_name FROM subaccount_settings WHERE subaccount_id = $1`,
        [subaccount_id]
      );
      if (cfg[0]?.evolution_api_url && cfg[0]?.evolution_instance_name) {
        const number = conv[0].contact_phone.replace(/\D/g, '');
        evoRequest('POST', cfg[0].evolution_api_url, cfg[0].evolution_api_key,
          `/message/sendText/${cfg[0].evolution_instance_name}`,
          { number, text: content }
        ).catch(e => console.warn('[evo send]', e.message));
      }
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[messages POST]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/conversations/:id/read', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    await pool.query(
      `UPDATE conversations SET unread_count = 0 WHERE id = $1 AND subaccount_id = $2`,
      [req.params.id, subaccount_id]
    );
    res.json({ ok: true });
  } catch { res.json({ ok: true }); }
});

// ============================================================
// PIPELINES & OPPORTUNITIES
// ============================================================

app.get('/api/pipelines', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows: pipelines } = await pool.query(
      'SELECT * FROM pipelines WHERE subaccount_id = $1 ORDER BY created_at ASC',
      [subaccount_id]
    );
    for (const pipeline of pipelines) {
      const { rows: stages } = await pool.query(
        'SELECT * FROM pipeline_stages WHERE pipeline_id = $1 ORDER BY position ASC',
        [pipeline.id]
      );
      for (const stage of stages) {
        const [opps, agg] = await Promise.all([
          pool.query(
            `SELECT o.id, o.title, o.value, o.currency, o.status, o.lost_reason,
                    o.custom_fields, o.stage_id, o.pipeline_id, o.contact_id,
                    c.name AS contact_name, c.phone AS contact_phone, o.created_at
             FROM opportunities o JOIN contacts c ON c.id = o.contact_id
             WHERE o.stage_id = $1 AND o.status = 'open' ORDER BY o.created_at DESC`,
            [stage.id]
          ),
          pool.query(
            `SELECT COUNT(*), COALESCE(SUM(value), 0) AS total
             FROM opportunities WHERE stage_id = $1 AND status = 'open'`,
            [stage.id]
          ),
        ]);
        stage.opportunities = opps.rows;
        stage.count         = parseInt(agg.rows[0].count);
        stage.total_value   = parseFloat(agg.rows[0].total);
      }
      pipeline.stages = stages;
    }
    res.json(pipelines);
  } catch (err) {
    console.error('[pipelines GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.put('/api/pipelines/:id', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: 'Nome é obrigatório.' });
  try {
    const { rows } = await pool.query(
      'UPDATE pipelines SET name = $1 WHERE id = $2 AND subaccount_id = $3 RETURNING *',
      [name, req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Funil não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[pipelines PUT name]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/pipeline_stages', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { pipeline_id, name, color } = req.body;
  if (!pipeline_id || !name) return res.status(400).json({ message: 'pipeline_id e nome são obrigatórios.' });
  try {
    const { rows: pl } = await pool.query(
      'SELECT id FROM pipelines WHERE id = $1 AND subaccount_id = $2', [pipeline_id, subaccount_id]
    );
    if (!pl.length) return res.status(404).json({ message: 'Funil não encontrado.' });
    const { rows: pos } = await pool.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM pipeline_stages WHERE pipeline_id = $1', [pipeline_id]
    );
    const { rows } = await pool.query(
      'INSERT INTO pipeline_stages (pipeline_id, name, color, position) VALUES ($1,$2,$3,$4) RETURNING *',
      [pipeline_id, name, color || '#6b7280', pos[0].p]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[pipeline_stages POST]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.put('/api/pipeline_stages/:id', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { name, color } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE pipeline_stages SET
         name  = COALESCE($1, name),
         color = COALESCE($2, color)
       WHERE id = $3
         AND pipeline_id IN (SELECT id FROM pipelines WHERE subaccount_id = $4)
       RETURNING *`,
      [name || null, color || null, req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Etapa não encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[pipeline_stages PUT]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.delete('/api/pipeline_stages/:id', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM pipeline_stages WHERE id = $1
         AND pipeline_id IN (SELECT id FROM pipelines WHERE subaccount_id = $2)`,
      [req.params.id, subaccount_id]
    );
    if (!rowCount) return res.status(404).json({ message: 'Etapa não encontrada.' });
    res.status(204).send();
  } catch (err) {
    console.error('[pipeline_stages DELETE]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/pipelines', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { name, stages } = req.body;
  if (!name) return res.status(400).json({ message: 'Nome é obrigatório.' });
  if (!stages || !stages.length) return res.status(400).json({ message: 'Adicione pelo menos uma etapa.' });
  if (stages.length > 15) return res.status(400).json({ message: 'Máximo de 15 etapas.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existing } = await client.query(
      'SELECT id FROM pipelines WHERE subaccount_id = $1', [subaccount_id]
    );
    const { rows: pipeline } = await client.query(
      'INSERT INTO pipelines (subaccount_id, name, is_default) VALUES ($1, $2, $3) RETURNING *',
      [subaccount_id, name, existing.length === 0]
    );
    for (let i = 0; i < stages.length; i++) {
      const s = stages[i];
      await client.query(
        'INSERT INTO pipeline_stages (pipeline_id, name, color, position, is_won, is_lost) VALUES ($1,$2,$3,$4,$5,$6)',
        [pipeline[0].id, s.name, s.color || '#6b7280', i, s.is_won || false, s.is_lost || false]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(pipeline[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[pipelines POST]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  } finally {
    client.release();
  }
});

app.delete('/api/pipelines/:id', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT id FROM pipelines WHERE id = $1 AND subaccount_id = $2',
      [req.params.id, subaccount_id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Funil não encontrado.' });
    }

    await client.query('DELETE FROM opportunities   WHERE pipeline_id = $1', [req.params.id]);
    await client.query('DELETE FROM pipeline_stages WHERE pipeline_id = $1', [req.params.id]);
    await client.query('DELETE FROM pipelines       WHERE id          = $1', [req.params.id]);

    await client.query('COMMIT');
    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[pipelines DELETE]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  } finally {
    client.release();
  }
});

app.get('/api/contacts/:id/opportunities', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.title, o.value, o.currency, o.status, o.lost_reason,
              o.custom_fields, o.stage_id, o.pipeline_id, o.created_at,
              p.name  AS pipeline_name,
              ps.name AS stage_name, ps.color AS stage_color
       FROM opportunities o
       JOIN pipelines p      ON p.id  = o.pipeline_id
       JOIN pipeline_stages ps ON ps.id = o.stage_id
       WHERE o.contact_id = $1 AND o.subaccount_id = $2
       ORDER BY o.created_at DESC`,
      [req.params.id, subaccount_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[contacts opportunities GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/opportunities', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { pipeline_id, stage_id, contact_id, title, value } = req.body;
  if (!pipeline_id || !stage_id || !contact_id || !title)
    return res.status(400).json({ message: 'Campos obrigatórios ausentes.' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO opportunities (subaccount_id, pipeline_id, stage_id, contact_id, title, value)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [subaccount_id, pipeline_id, stage_id, contact_id, title, value || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[opportunities POST]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.put('/api/opportunities/:id', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { title, stage_id, pipeline_id, value, status, lost_reason, custom_fields } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE opportunities SET
         title         = COALESCE($1, title),
         stage_id      = COALESCE($2, stage_id),
         pipeline_id   = COALESCE($3, pipeline_id),
         value         = COALESCE($4, value),
         status        = COALESCE($5, status),
         lost_reason   = $6,
         custom_fields = COALESCE($7, custom_fields)
       WHERE id = $8 AND subaccount_id = $9 RETURNING *`,
      [
        title || null, stage_id || null, pipeline_id || null,
        value != null ? value : null, status || null,
        lost_reason || null,
        custom_fields ? JSON.stringify(custom_fields) : null,
        req.params.id, subaccount_id,
      ]
    );
    if (!rows.length) return res.status(404).json({ message: 'Oportunidade não encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[opportunities PUT]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.put('/api/opportunities/:id/stage', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { stage_id } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE opportunities SET stage_id = $1
       WHERE id = $2 AND subaccount_id = $3 RETURNING *`,
      [stage_id, req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Oportunidade não encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[opportunities stage PUT]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ============================================================
// AI AGENTS
// ============================================================

app.get('/api/agents', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM ai_agents WHERE subaccount_id = $1 ORDER BY created_at DESC',
      [subaccount_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[agents GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/agents', auth, async (req, res) => {
  const { subaccount_id, sub: created_by } = req.user;
  const { name, description, model, system_prompt } = req.body;
  if (!name) return res.status(400).json({ message: 'Nome é obrigatório.' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO ai_agents (subaccount_id, name, description, model, system_prompt, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [subaccount_id, name, description || null, model || 'claude-sonnet-4-6', system_prompt || null, created_by]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[agents POST]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.put('/api/agents/:id/toggle', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      `UPDATE ai_agents SET is_active = NOT is_active
       WHERE id = $1 AND subaccount_id = $2 RETURNING *`,
      [req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Agente não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[agents toggle]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ============================================================
// AUTOMATIONS
// ============================================================

app.get('/api/automations', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM automations WHERE subaccount_id = $1 ORDER BY created_at DESC',
      [subaccount_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[automations GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.put('/api/automations/:id/toggle', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      `UPDATE automations SET is_active = NOT is_active
       WHERE id = $1 AND subaccount_id = $2 RETURNING *`,
      [req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Automação não encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[automations toggle]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ============================================================
// INTEGRATIONS
// ============================================================

app.get('/api/integrations', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      `SELECT id, provider, name, is_active, status, last_tested_at, created_at
       FROM integrations WHERE subaccount_id = $1 ORDER BY created_at DESC`,
      [subaccount_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[integrations GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ============================================================
// SUBCONTAS
// ============================================================

function requireAdmin(req, res, next) {
  if (!['super_admin', 'admin'].includes(req.user.role))
    return res.status(403).json({ message: 'Acesso negado.' });
  next();
}

app.get('/api/subaccounts', auth, async (req, res) => {
  const { account_id, role, subaccount_id } = req.user;
  try {
    let rows;
    if (role === 'super_admin') {
      ({ rows } = await pool.query(
        `SELECT s.id, s.name, s.slug, s.timezone, s.is_active, s.created_at,
                COUNT(DISTINCT c.id)::int AS contact_count,
                COUNT(DISTINCT u.id)::int AS user_count
         FROM subaccounts s
         LEFT JOIN contacts c ON c.subaccount_id = s.id
         LEFT JOIN users u    ON u.subaccount_id = s.id
         WHERE s.account_id = $1
         GROUP BY s.id ORDER BY s.created_at ASC`,
        [account_id]
      ));
    } else {
      ({ rows } = await pool.query(
        `SELECT s.id, s.name, s.slug, s.timezone, s.is_active, s.created_at,
                COUNT(DISTINCT c.id)::int AS contact_count,
                COUNT(DISTINCT u.id)::int AS user_count
         FROM subaccounts s
         LEFT JOIN contacts c ON c.subaccount_id = s.id
         LEFT JOIN users u    ON u.subaccount_id = s.id
         WHERE s.id = $1
         GROUP BY s.id`,
        [subaccount_id]
      ));
    }
    res.json(rows);
  } catch (err) {
    console.error('[subaccounts GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/subaccounts', auth, requireAdmin, async (req, res) => {
  const { account_id } = req.user;
  const { name, slug, timezone } = req.body;
  if (!name || !slug) return res.status(400).json({ message: 'Nome e slug são obrigatórios.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO subaccounts (account_id, name, slug, timezone)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [account_id, name, slug.toLowerCase().replace(/\s+/g, '-'), timezone || 'America/Sao_Paulo']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Slug já em uso nesta conta.' });
    console.error('[subaccounts POST]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.put('/api/subaccounts/:id', auth, requireAdmin, async (req, res) => {
  const { account_id } = req.user;
  const { name, timezone, is_active } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE subaccounts SET
         name      = COALESCE($1, name),
         timezone  = COALESCE($2, timezone),
         is_active = COALESCE($3, is_active)
       WHERE id = $4 AND account_id = $5 RETURNING *`,
      [name || null, timezone || null, is_active ?? null, req.params.id, account_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Subconta não encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[subaccounts PUT]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.delete('/api/subaccounts/:id', auth, requireAdmin, async (req, res) => {
  const { account_id } = req.user;
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM subaccounts WHERE id = $1 AND account_id = $2',
      [req.params.id, account_id]
    );
    if (!rowCount) return res.status(404).json({ message: 'Subconta não encontrada.' });
    res.status(204).send();
  } catch (err) {
    console.error('[subaccounts DELETE]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/subaccounts/switch', auth, async (req, res) => {
  const { subaccount_id: target_id } = req.body;
  const { sub: user_id, account_id, role } = req.user;
  if (!target_id) return res.status(400).json({ message: 'subaccount_id é obrigatório.' });

  try {
    let hasAccess = false;
    if (role === 'super_admin') {
      const { rows } = await pool.query(
        'SELECT id FROM subaccounts WHERE id = $1 AND account_id = $2 AND is_active = TRUE',
        [target_id, account_id]
      );
      hasAccess = rows.length > 0;
    } else {
      const { rows } = await pool.query(
        'SELECT id FROM users WHERE id = $1 AND subaccount_id = $2',
        [user_id, target_id]
      );
      hasAccess = rows.length > 0;
    }

    if (!hasAccess) return res.status(403).json({ message: 'Acesso negado a esta subconta.' });

    const { rows: sub } = await pool.query(
      'SELECT id, name, slug FROM subaccounts WHERE id = $1',
      [target_id]
    );
    const { rows: user } = await pool.query(
      'SELECT id, email, role, account_id FROM users WHERE id = $1',
      [user_id]
    );

    const token = signToken({
      sub:           user[0].id,
      email:         user[0].email,
      role:          user[0].role,
      account_id:    user[0].account_id,
      subaccount_id: target_id,
    }, process.env.JWT_EXPIRES_IN || '1d');

    res.json({ token, subaccount: sub[0] });
  } catch (err) {
    console.error('[subaccounts switch]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ============================================================
// USERS (gestão dentro de uma subconta)
// ============================================================

app.get('/api/users', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, is_active, created_at
       FROM users WHERE subaccount_id = $1
       ORDER BY created_at ASC`,
      [subaccount_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[users GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/users', auth, requireAdmin, async (req, res) => {
  const { subaccount_id, account_id } = req.user;
  const { name, email, password, role } = req.body;
  if (!name?.trim())  return res.status(400).json({ message: 'Nome é obrigatório.' });
  if (!email?.trim()) return res.status(400).json({ message: 'Email é obrigatório.' });
  if (!password)      return res.status(400).json({ message: 'Senha é obrigatória.' });
  if (password.length < 6) return res.status(400).json({ message: 'Senha deve ter pelo menos 6 caracteres.' });
  const assignedRole = ['admin', 'user'].includes(role) ? role : 'user';
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (account_id, subaccount_id, name, email, password_hash, role, email_verified)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       RETURNING id, name, email, role, is_active, created_at`,
      [account_id, subaccount_id, name.trim(), email.toLowerCase().trim(), hash, assignedRole]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Este email já está cadastrado.' });
    console.error('[users POST]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.put('/api/users/:id', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  const { name, email, password, is_active, role } = req.body;
  try {
    const sets = [];
    const vals = [];
    let n = 1;
    if (name?.trim())        { sets.push(`name = $${n++}`);          vals.push(name.trim()); }
    if (email?.trim())       { sets.push(`email = $${n++}`);         vals.push(email.toLowerCase().trim()); }
    if (password?.length >= 6) {
      const h = await bcrypt.hash(password, 12);
      sets.push(`password_hash = $${n++}`); vals.push(h);
    }
    if (is_active !== undefined) { sets.push(`is_active = $${n++}`); vals.push(is_active); }
    if (['admin', 'user'].includes(role)) { sets.push(`role = $${n++}`); vals.push(role); }
    if (!sets.length) return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
    vals.push(req.params.id, subaccount_id);
    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(', ')}
       WHERE id = $${n} AND subaccount_id = $${n + 1}
       RETURNING id, name, email, role, is_active, created_at`,
      vals
    );
    if (!rows.length) return res.status(404).json({ message: 'Usuário não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Este email já está em uso.' });
    console.error('[users PUT]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.delete('/api/users/:id', auth, requireAdmin, async (req, res) => {
  const { subaccount_id, sub: self_id } = req.user;
  if (req.params.id === self_id)
    return res.status(400).json({ message: 'Não é possível excluir sua própria conta.' });
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM users WHERE id = $1 AND subaccount_id = $2',
      [req.params.id, subaccount_id]
    );
    if (!rowCount) return res.status(404).json({ message: 'Usuário não encontrado.' });
    res.status(204).send();
  } catch (err) {
    console.error('[users DELETE]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ============================================================
// PROFILE
// ============================================================

app.get('/api/profile', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, last_name, email, phone, role, avatar_url FROM users WHERE id = $1`,
      [req.user.sub]
    );
    if (!rows.length) return res.status(404).json({ message: 'Usuário não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[profile GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.put('/api/profile', auth, async (req, res) => {
  const { name, last_name, email, phone } = req.body;
  const sets = [];
  const vals = [];
  let n = 1;
  if (name?.trim())      { sets.push(`name = $${n++}`);      vals.push(name.trim()); }
  if (last_name !== undefined) { sets.push(`last_name = $${n++}`); vals.push(last_name?.trim() || null); }
  if (email?.trim())     { sets.push(`email = $${n++}`);     vals.push(email.toLowerCase().trim()); }
  if (phone !== undefined)    { sets.push(`phone = $${n++}`);     vals.push(phone?.trim() || null); }
  if (!sets.length) return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
  sets.push(`updated_at = NOW()`);
  vals.push(req.user.sub);
  try {
    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${n} RETURNING id, name, last_name, email, phone, role`,
      vals
    );
    if (!rows.length) return res.status(404).json({ message: 'Usuário não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Este email já está em uso.' });
    console.error('[profile PUT]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ============================================================
// HEALTH
// ============================================================

app.get('/health', async (_req, res) => {
  let host = 'DATABASE_URL not set';
  try { host = new URL(process.env.DATABASE_URL || '').hostname; } catch {}
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', host });
  } catch (err) {
    res.json({ status: 'error', db: err.message, host });
  }
});

// ============================================================
// SUBACCOUNT SETTINGS
// ============================================================

app.get('/api/subaccount-settings', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM subaccount_settings WHERE subaccount_id = $1`,
      [subaccount_id]
    );
    res.json(rows[0] || { subaccount_id });
  } catch (err) {
    console.error('[subaccount-settings GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.put('/api/subaccount-settings', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  const {
    fantasy_name, legal_name, commercial_email, commercial_phone, website,
    industry, industry_other, currency, additional_info,
    company_type, business_sector, registration_id_type, registration_id,
    operating_regions, address, language, authorized_rep,
  } = req.body;
  try {
    const { rows } = await pool.query(`
      INSERT INTO subaccount_settings (
        subaccount_id, fantasy_name, legal_name, commercial_email, commercial_phone, website,
        industry, industry_other, currency, additional_info,
        company_type, business_sector, registration_id_type, registration_id,
        operating_regions, address, language, authorized_rep, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
      ON CONFLICT (subaccount_id) DO UPDATE SET
        fantasy_name = EXCLUDED.fantasy_name,
        legal_name = EXCLUDED.legal_name,
        commercial_email = EXCLUDED.commercial_email,
        commercial_phone = EXCLUDED.commercial_phone,
        website = EXCLUDED.website,
        industry = EXCLUDED.industry,
        industry_other = EXCLUDED.industry_other,
        currency = EXCLUDED.currency,
        additional_info = EXCLUDED.additional_info,
        company_type = EXCLUDED.company_type,
        business_sector = EXCLUDED.business_sector,
        registration_id_type = EXCLUDED.registration_id_type,
        registration_id = EXCLUDED.registration_id,
        operating_regions = EXCLUDED.operating_regions,
        address = EXCLUDED.address,
        language = EXCLUDED.language,
        authorized_rep = EXCLUDED.authorized_rep,
        updated_at = NOW()
      RETURNING *`,
      [subaccount_id, fantasy_name||null, legal_name||null, commercial_email||null,
       commercial_phone||null, website||null, industry||null, industry_other||null,
       currency||'BRL', additional_info||null, company_type||null, business_sector||null,
       registration_id_type||null, registration_id||null, operating_regions||null,
       address||null, language||'pt-BR', authorized_rep||null]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('[subaccount-settings PUT]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ============================================================
// WEBHOOK — Evolution API (incoming WhatsApp messages)
// ============================================================

function waCleanPhone(raw) {
  // "5511999999999@s.whatsapp.net" → "5511999999999"
  return (raw || '').replace(/@.*$/, '').replace(/\D/g, '');
}

function waPhoneVariants(digits) {
  const v = new Set([digits]);
  if (digits.startsWith('55') && digits.length >= 12) v.add(digits.slice(2));
  if (digits.length === 11) v.add('55' + digits);
  if (digits.length === 10) v.add('55' + digits);
  return [...v];
}

function waExtractContent(data) {
  const msg = data.message || {};
  if (msg.conversation)                  return msg.conversation;
  if (msg.extendedTextMessage?.text)     return msg.extendedTextMessage.text;
  if (msg.imageMessage)                  return msg.imageMessage.caption || '[Imagem 🖼️]';
  if (msg.videoMessage)                  return msg.videoMessage.caption || '[Vídeo 🎥]';
  if (msg.audioMessage || msg.pttMessage) return '[Áudio 🎤]';
  if (msg.documentMessage)               return `[Documento 📄 ${msg.documentMessage.fileName || ''}]`.trim();
  if (msg.stickerMessage)                return '[Figurinha 🎉]';
  if (msg.locationMessage)               return '[Localização 📍]';
  if (msg.contactMessage)                return `[Contato: ${msg.contactMessage.displayName || ''}]`;
  if (msg.reactionMessage)               return `[Reação: ${msg.reactionMessage.text || '👍'}]`;
  if (msg.buttonsResponseMessage)        return msg.buttonsResponseMessage.selectedDisplayText || '[Resposta de botão]';
  if (msg.listResponseMessage)           return msg.listResponseMessage.title || '[Resposta de lista]';
  return '[Mensagem]';
}

app.post('/api/webhook/evolution', async (req, res) => {
  res.sendStatus(200); // Always respond fast

  const body = req.body || {};
  const eventRaw = (body.event || body.type || '').toLowerCase().replace(/[-_]/g, '.');
  if (!eventRaw.includes('messages.upsert') && !eventRaw.includes('messages.upsert')) return;

  const instance = body.instance;
  const data     = body.data || body.messages?.[0];
  if (!data) return;

  const key = data.key || {};
  // Skip group messages, status broadcasts, and echoes (fromMe in most cases)
  const jid = key.remoteJid || '';
  if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return;
  // Skip own outbound echoes — they're already saved when we call POST /messages
  if (key.fromMe) return;

  const phone   = waCleanPhone(jid);
  if (!phone) return;

  const content = waExtractContent(data);
  const pushName = data.pushName || null;
  const externalId = key.id || null;

  try {
    // Find subaccount by instance name (multi-instance table first, fallback to settings)
    let cfgRows;
    ({ rows: cfgRows } = await pool.query(
      `SELECT subaccount_id FROM whatsapp_instances WHERE instance_name = $1 LIMIT 1`,
      [instance]
    ));
    if (!cfgRows.length) {
      ({ rows: cfgRows } = await pool.query(
        `SELECT subaccount_id FROM subaccount_settings WHERE evolution_instance_name = $1 LIMIT 1`,
        [instance]
      ));
    }
    if (!cfgRows.length) return;
    const subaccount_id = cfgRows[0].subaccount_id;

    // Find or create contact by phone variants
    const variants = waPhoneVariants(phone);
    const placeholders = variants.map((_, i) => `$${i + 2}`).join(',');
    const { rows: contacts } = await pool.query(
      `SELECT id FROM contacts WHERE subaccount_id = $1
       AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') = ANY(ARRAY[${placeholders}])
       LIMIT 1`,
      [subaccount_id, ...variants]
    );

    let contact_id;
    if (contacts.length) {
      contact_id = contacts[0].id;
    } else {
      const displayPhone = '+' + phone;
      const { rows: newContact } = await pool.query(
        `INSERT INTO contacts (subaccount_id, name, phone) VALUES ($1, $2, $3) RETURNING id`,
        [subaccount_id, pushName || displayPhone, displayPhone]
      );
      contact_id = newContact[0].id;
    }

    // Update contact name if we have a push name and contact has no name
    if (pushName) {
      await pool.query(
        `UPDATE contacts SET name = $1 WHERE id = $2 AND (name IS NULL OR name = phone OR name = $3)`,
        [pushName, contact_id, '+' + phone]
      );
    }

    // Find or create open conversation for this contact (whatsapp channel)
    const { rows: convs } = await pool.query(
      `SELECT id FROM conversations WHERE subaccount_id = $1 AND contact_id = $2 AND channel = 'whatsapp' AND status = 'open' LIMIT 1`,
      [subaccount_id, contact_id]
    );
    let conv_id;
    if (convs.length) {
      conv_id = convs[0].id;
    } else {
      const { rows: newConv } = await pool.query(
        `INSERT INTO conversations (subaccount_id, contact_id, channel, status) VALUES ($1, $2, 'whatsapp', 'open') RETURNING id`,
        [subaccount_id, contact_id]
      );
      conv_id = newConv[0].id;
    }

    // Dedup: skip if this external_id already saved
    if (externalId) {
      const { rows: dup } = await pool.query(
        `SELECT id FROM messages WHERE conversation_id = $1 AND external_id = $2 LIMIT 1`,
        [conv_id, externalId]
      );
      if (dup.length) return;
    }

    // Save message
    await pool.query(
      `INSERT INTO messages (conversation_id, direction, sender_type, content, external_id)
       VALUES ($1, 'inbound', 'contact', $2, $3)`,
      [conv_id, content, externalId]
    );

    // Update conversation
    await pool.query(
      `UPDATE conversations SET last_message_at = NOW(), unread_count = unread_count + 1 WHERE id = $1`,
      [conv_id]
    );
  } catch (err) {
    console.error('[webhook evolution]', err.message);
  }
});

// ============================================================
// INTEGRATIONS — WHATSAPP (Evolution API proxy)
// ============================================================

async function evoRequest(method, baseUrl, apiKey, path, body) {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = {}; }
  if (!res.ok) throw new Error(data.message || data.error || `Evolution API: HTTP ${res.status}`);
  return data;
}

// ── Multi-instance WhatsApp ───────────────────────────────────

app.get('/api/whatsapp-instances', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      `SELECT id, instance_name, phone_number, api_url, status, connected_at, created_at
       FROM whatsapp_instances WHERE subaccount_id = $1 ORDER BY created_at ASC`,
      [subaccount_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/whatsapp-instances', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  const { api_url, api_key } = req.body;
  if (!api_url?.trim() || !api_key?.trim())
    return res.status(400).json({ message: 'URL e chave da API são obrigatórias.' });

  const { rows: cnt } = await pool.query(
    'SELECT COUNT(*) FROM whatsapp_instances WHERE subaccount_id = $1', [subaccount_id]
  );
  const n = parseInt(cnt[0].count) + 1;
  const instanceName = `favx-${subaccount_id.slice(0, 8)}-${n}`;

  try {
    let qrData;
    try {
      qrData = await evoRequest('POST', api_url.trim(), api_key.trim(),
        '/instance/create', { instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' });
    } catch {
      qrData = await evoRequest('GET', api_url.trim(), api_key.trim(),
        `/instance/connect/${instanceName}`);
    }

    const { rows } = await pool.query(
      `INSERT INTO whatsapp_instances (subaccount_id, instance_name, api_url, api_key, api_provider, status)
       VALUES ($1, $2, $3, $4, 'evolution', 'connecting') RETURNING id, instance_name, status`,
      [subaccount_id, instanceName, api_url.trim(), api_key.trim()]
    );

    const webhookBase = (process.env.WEBHOOK_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
    try {
      await evoRequest('POST', api_url.trim(), api_key.trim(),
        `/webhook/set/${instanceName}`, {
          webhook: {
            enabled: true,
            url: `${webhookBase}/api/webhook/evolution`,
            webhookByEvents: false,
            webhookBase64: false,
            events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
          }
        });
    } catch (whErr) {
      console.warn('[evo webhook setup]', whErr.message);
    }

    const base64 = qrData?.qrcode?.base64 || qrData?.base64 || null;
    const state  = qrData?.instance?.state || null;
    res.status(201).json({ ...rows[0], base64, state });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/whatsapp-instances/:id/qr', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM whatsapp_instances WHERE id = $1 AND subaccount_id = $2',
      [req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Instância não encontrada.' });
    const inst = rows[0];
    const data = await evoRequest('GET', inst.api_url, inst.api_key,
      `/instance/connect/${inst.instance_name}`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/whatsapp-instances/:id/status', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM whatsapp_instances WHERE id = $1 AND subaccount_id = $2',
      [req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Instância não encontrada.' });
    const inst = rows[0];
    try {
      const data = await evoRequest('GET', inst.api_url, inst.api_key,
        `/instance/connectionState/${inst.instance_name}`);
      const state = data?.instance?.state || data?.state || null;
      if (state === 'open') {
        await pool.query(
          `UPDATE whatsapp_instances SET status = 'connected', connected_at = NOW() WHERE id = $1`,
          [inst.id]
        );
      }
      res.json({ state, id: inst.id });
    } catch {
      res.json({ state: 'close', id: inst.id });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete('/api/whatsapp-instances/:id', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM whatsapp_instances WHERE id = $1 AND subaccount_id = $2',
      [req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Instância não encontrada.' });
    const inst = rows[0];
    try {
      await evoRequest('DELETE', inst.api_url, inst.api_key,
        `/instance/delete/${inst.instance_name}`);
    } catch {}
    await pool.query('DELETE FROM whatsapp_instances WHERE id = $1', [inst.id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Legacy single-instance endpoints (backwards compat)
app.get('/api/integrations/whatsapp', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      `SELECT id, instance_name, status FROM whatsapp_instances WHERE subaccount_id = $1 LIMIT 1`,
      [subaccount_id]
    );
    const inst = rows[0];
    res.json({ configured: !!inst, instance_name: inst?.instance_name || null, state: inst?.status === 'connected' ? 'open' : null });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ============================================================
// ============================================================

(async function runMigrations() {
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(150)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`);
    await pool.query(`ALTER TABLE subaccount_settings ADD COLUMN IF NOT EXISTS evolution_api_url VARCHAR(500)`);
    await pool.query(`ALTER TABLE subaccount_settings ADD COLUMN IF NOT EXISTS evolution_api_key TEXT`);
    await pool.query(`ALTER TABLE subaccount_settings ADD COLUMN IF NOT EXISTS evolution_instance_name VARCHAR(200)`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS external_id VARCHAR(200)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_external_id ON messages(conversation_id, external_id) WHERE external_id IS NOT NULL`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subaccount_settings (
        subaccount_id        UUID PRIMARY KEY REFERENCES subaccounts(id) ON DELETE CASCADE,
        fantasy_name         VARCHAR(200),
        legal_name           VARCHAR(200),
        commercial_email     VARCHAR(255),
        commercial_phone     VARCHAR(50),
        website              VARCHAR(500),
        industry             VARCHAR(100),
        industry_other       VARCHAR(200),
        currency             VARCHAR(10)  DEFAULT 'BRL',
        additional_info      TEXT,
        company_type         VARCHAR(100),
        business_sector      VARCHAR(100),
        registration_id_type VARCHAR(50),
        registration_id      VARCHAR(60),
        operating_regions    TEXT,
        address              TEXT,
        language             VARCHAR(20)  DEFAULT 'pt-BR',
        authorized_rep       VARCHAR(200),
        updated_at           TIMESTAMPTZ  DEFAULT NOW()
      )
    `);
  } catch {}
})();

if (require.main === module) {
  app.listen(PORT, () => console.log(`[FAVX CRM API] Rodando em http://localhost:${PORT}`));
}

module.exports = app;
