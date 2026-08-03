// ======================================
// FAVX CRM — Servidor Express
// ======================================

require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const OpenAI   = require('openai');
const pool     = require('./db');

// Cliente do LLM. Instanciado uma vez só — em serverless o módulo é reusado
// entre invocações da mesma instância. Sem a chave configurada o cliente fica
// nulo e a IA simplesmente não responde, em vez de derrubar o servidor no boot
// (o CRM inteiro não pode deixar de subir por falta de uma chave de IA).
// OPENAI_BASE_URL permite apontar para um proxy ou para um servidor falso
// nos testes, sem tocar no código.
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
    })
  : null;
if (!openai) console.warn('[ai] OPENAI_API_KEY ausente — agentes de IA não vão responder.');

const app  = express();
const PORT = process.env.PORT || 3001;

app.set('etag', false);
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '20mb' }));
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
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
        height       INTEGER,
        pos_x        INTEGER,
        pos_y        INTEGER,
        width_px     INTEGER,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        updated_at   TIMESTAMPTZ DEFAULT NOW()
      )`);
    // Altura customizada (px) do widget — nula = altura automática/padrão.
    // Adicionada depois da criação inicial da tabela; ALTER idempotente
    // garante que bancos já existentes ganhem a coluna.
    await pool.query(`ALTER TABLE dashboard_widgets ADD COLUMN IF NOT EXISTS height INTEGER`);
    // Posição livre (canvas absoluto) e largura em px — substituem o grid
    // fixo de terço/metade/inteiro, permitindo arrastar o widget para
    // qualquer lugar (inclusive deixando espaços vazios). Nulas = o
    // frontend calcula uma posição/tamanho padrão em cascata.
    await pool.query(`ALTER TABLE dashboard_widgets ADD COLUMN IF NOT EXISTS pos_x INTEGER`);
    await pool.query(`ALTER TABLE dashboard_widgets ADD COLUMN IF NOT EXISTS pos_y INTEGER`);
    await pool.query(`ALTER TABLE dashboard_widgets ADD COLUMN IF NOT EXISTS width_px INTEGER`);
  } catch (err) {
    console.error('[init] custom_dashboard tables:', err.message);
  }
})();

;(async function initCustomFieldTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS custom_field_definitions (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subaccount_id UUID NOT NULL,
        entity        VARCHAR(20) NOT NULL,
        name          VARCHAR(60) NOT NULL,
        label         VARCHAR(150) NOT NULL,
        type          VARCHAR(20) NOT NULL DEFAULT 'text',
        options       JSONB NOT NULL DEFAULT '[]',
        required      BOOLEAN NOT NULL DEFAULT FALSE,
        position      INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(subaccount_id, entity, name)
      )`);
  } catch (err) {
    console.error('[init] custom_field_definitions table:', err.message);
  }
})();

;(async function initTemplateTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS template_folders (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subaccount_id UUID NOT NULL,
        name          VARCHAR(120) NOT NULL,
        position      INTEGER DEFAULT 0,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      )`);
    // Garante a tabela de modelos (compatível com o schema base) e as colunas
    // usadas por esta feature. Se a tabela já existir, o CREATE é ignorado e
    // as colunas são adicionadas de forma idempotente.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS message_templates (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subaccount_id  UUID NOT NULL,
        name           VARCHAR(150) NOT NULL,
        header_content TEXT,
        body           TEXT NOT NULL,
        folder_id      UUID,
        position       INTEGER DEFAULT 0,
        created_at     TIMESTAMPTZ DEFAULT NOW(),
        updated_at     TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS folder_id UUID`);
    await pool.query(`ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS header_content TEXT`);
  } catch (err) {
    console.error('[init] template tables:', err.message);
  }
})();

const AI_DEFAULT_MODEL   = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const AI_HISTORY_LIMIT   = 20;    // mensagens de contexto enviadas ao modelo
const AI_HUMAN_PAUSE_MIN = 30;    // minutos de silêncio após um humano responder
const AI_TIMEOUT_MS      = 20000; // < maxDuration (30s) da Vercel, com folga
                                  // para o envio pelo WhatsApp depois da resposta
const AI_NO_REPLY        = '[SEM RESPOSTA]';

// Prompt inicial de um agente novo. Segue o template da seção 5 do
// skill-favx.md (CONTEXTO → IDENTIDADE → ABERTURA → COMUNICAÇÃO → MÉTODO →
// LIMITES → QUANDO NÃO RESPONDER → OBJETIVO FINAL) com o método DEFA da
// seção 6.11 no lugar do fluxo genérico de atendimento.
//
// Inclui o marcador [SEM RESPOSTA] — sem ele a IA tenta responder
// educadamente até a um "ok" do cliente, o que soa robótico.
//
// Duas proibições são deliberadas e valem para qualquer operação: nunca
// inventar preço e nunca inventar prova social. Números falsos são a forma
// mais rápida de queimar a marca, então o padrão é calar em vez de chutar.
//
// Os trechos entre colchetes são para o usuário preencher na tela.
function defaultAgentPrompt(subaccountName) {
  const empresa = (subaccountName || 'a empresa').trim();
  return `# CONTEXTO
Você atende os clientes da ${empresa} pelo WhatsApp.

# IDENTIDADE
Você é [nome do agente], da ${empresa}. [Descreva em uma frase o que a empresa
faz e para quem.] Você conduz a conversa — é a parte ativa, nunca fica
esperando o cliente tomar a iniciativa. Nunca pareça um robô.

# ABERTURA
Apenas na primeira mensagem da conversa, apresente-se assim:
"[mensagem de abertura, ex: Oi! Aqui é a [nome] da ${empresa} 😊]"
Nas mensagens seguintes, não se apresente de novo. Se a apresentação já
apareceu em qualquer momento anterior, nunca repita — continue de onde parou.
A primeira pergunta é sempre sobre o negócio ou a necessidade do cliente,
nunca sobre o produto.

# COMUNICAÇÃO
- Tom humano e próximo, sem formalidade excessiva.
- 2 a 5 linhas por resposta. Nunca textão.
- No máximo 1 pergunta por mensagem.
- Reaja ao que a pessoa disse, não à existência da mensagem. Proibido abrir
  com frases vazias: "Que ótimo!", "Perfeito!", "Entendido!", "Com certeza!".
- Este canal é só texto. Nunca ofereça foto, vídeo, PDF ou catálogo.

# MÉTODO DE ATENDIMENTO — DEFA
Siga as quatro etapas nesta ordem. Nunca pule direto para a oferta.

## 1. Diagnóstico
Só perguntas abertas (que não se respondem com sim ou não).
A primeira é sempre positiva, sobre a atuação ou o contexto da pessoa —
nunca sobre problema ou dificuldade logo de cara.
As seguintes aprofundam um ponto de cada vez, sempre conectadas ao que a
${empresa} oferece. Nada de pergunta genérica solta.

## 2. Efeito
Quando a pessoa revelar o que realmente quer, **afirme o impacto** — não
devolva uma pergunta pedindo que ela imagine sozinha.
  Errado: "Como você acha que isso mudaria seu resultado?"
  Certo:  "Com isso resolvido, você [benefício concreto] — algo que levaria
           meses para construir por conta própria."
Conecte esse motivo explicitamente à oferta e siga para o fechamento, sem
esperar que ela concorde em voz alta.

## 3. Fechamento
Nesta ordem: ligue a oferta à necessidade diagnosticada → benefícios
personalizados para aquele perfil → prova social (apenas real) → opções do
mais caro para o mais barato → o preço aparece como consequência, nunca como
foco → trate uma objeção por vez.

## 4. Ancoragem
Coloque o investimento em perspectiva **antes** que a pessoa questione o
preço, não depois. Ancore por retorno esperado, por oportunidade, por
comparação com alternativas, por tempo economizado ou por disponibilidade
real.

# PERGUNTAS
Toda pergunta precisa, ao mesmo tempo: demonstrar interesse no que acabou de
ser dito, avançar para a etapa seguinte, e carregar um gancho de valor.
Proibido perguntar por perguntar: "Ficou alguma dúvida?", "Faz sentido?"
soltos. Se já fez duas perguntas na mesma etapa sem avançar, pare de
perguntar e faça uma afirmação de valor ou vá para o fechamento.
Avance sem perguntar mais nada quando a pessoa elogiar algo, perguntar preço,
demonstrar que quer contratar, ou responder com entusiasmo.

# OBJEÇÕES
Sempre nesta ordem, antes de voltar a conduzir para a decisão:
1. Concordar — nunca discuta ("Entendo perfeitamente").
2. Investigar — descubra a razão real ("Me ajuda a entender melhor...").
3. Validar — mostre que a preocupação faz sentido.
4. Reposicionar — reconecte o valor ao que foi dito.
5. Fechar — conduza de volta para a decisão.
Úteis para destravar: "Além dessa, existe alguma outra dúvida?" e "Se
resolvêssemos essa questão, você seguiria?".

# PREÇO
[Preencha aqui as opções, da mais cara para a mais barata. Enquanto isto
estiver vazio, siga a regra abaixo.]
Enquanto não houver valores definidos acima, você NÃO cita preço, faixa,
"a partir de" nem estimativa — conduza para um orçamento personalizado.
Quando houver, só revele o valor se a pessoa perguntar diretamente, se as
etapas de diagnóstico e efeito já estiverem concluídas, ou se for necessário
para destravar uma objeção. Sempre junto da condição de pagamento.
Nunca invente número.

# PROVA SOCIAL
[Preencha aqui casos e resultados reais.] Enquanto estiver vazio, não cite
quantidade de clientes, depoimentos ou resultados. Nunca invente prova social
nem escassez que não seja verdadeira.

# LIMITES
Você NÃO pode: fechar contrato, prometer prazos, conceder descontos nem
confirmar preços sem validação. [Ajuste conforme a operação.] Nesses casos,
diga que vai confirmar com a equipe e que retorna em seguida.
Nunca legitime o adiamento: proibido "sem pressa", "quando você estiver
pronto", "posso avisar mais perto da data".

# QUANDO NÃO RESPONDER
Se a mensagem não exigir resposta (um "ok", um emoji, uma confirmação
simples), responda exatamente:
[SEM RESPOSTA]

# OBJETIVO FINAL
Toda conversa deve terminar em um destes resultados: negócio encaminhado,
próximo passo agendado, ou atendimento passado a um humano com o contexto
resumido.`;
}

// ── Resposta automática da IA ──────────────────────────────────
// Decide se a IA deve responder a uma mensagem recebida e, se sim, gera a
// resposta. Retorna o texto a enviar, ou null quando a IA deve ficar calada.
//
// IMPORTANTE: quem chama precisa AGUARDAR esta função. Em serverless a
// execução pode ser congelada assim que a resposta HTTP sai — foi exatamente
// assim que as mensagens do chat sumiam antes. Nada de fire-and-forget aqui.
async function generateAiReply({ subaccount_id, conversation_id, contact_name }) {
  if (!openai) return null;

  const { rows: agents } = await pool.query(
    `SELECT id, model, system_prompt, max_tokens, temperature
     FROM ai_agents WHERE subaccount_id = $1 AND is_default AND is_active LIMIT 1`,
    [subaccount_id]
  );
  const agent = agents[0];
  if (!agent || !agent.system_prompt) return null;

  // Pausa por atendente humano: se alguém do CRM respondeu há pouco, a IA
  // não atropela o atendimento. O eco do WhatsApp e as respostas do próprio
  // bot têm sender_id nulo — só mensagem de usuário do CRM conta como humano.
  const { rows: human } = await pool.query(
    `SELECT 1 FROM messages
     WHERE conversation_id = $1 AND direction = 'outbound' AND sender_id IS NOT NULL
       AND sent_at > NOW() - ($2 || ' minutes')::interval
     LIMIT 1`,
    [conversation_id, AI_HUMAN_PAUSE_MIN]
  );
  if (human.length) return null;

  // O histórico da conversa já mora na tabela messages — não há memória
  // separada para manter. Busca as últimas em ordem decrescente e inverte,
  // para pegar as mais recentes e ainda entregar em ordem cronológica.
  const { rows: recent } = await pool.query(
    `SELECT direction, content FROM messages
     WHERE conversation_id = $1 AND COALESCE(is_internal, FALSE) = FALSE
       AND content IS NOT NULL AND content <> ''
     ORDER BY sent_at DESC LIMIT $2`,
    [conversation_id, AI_HISTORY_LIMIT]
  );
  const history = recent.reverse().map(m => ({
    role: m.direction === 'inbound' ? 'user' : 'assistant',
    content: m.content,
  }));
  if (!history.length) return null;

  const system = contact_name
    ? `${agent.system_prompt}\n\n(Nome do contato nesta conversa: ${contact_name}.)`
    : agent.system_prompt;

  // temperature é NUMERIC no Postgres e volta como string ('0.70') — a API
  // espera número, então a conversão é obrigatória.
  const temperature = agent.temperature == null ? 0.7 : Number(agent.temperature);

  let completion;
  try {
    completion = await openai.chat.completions.create(
      {
        model:       agent.model || AI_DEFAULT_MODEL,
        max_tokens:  agent.max_tokens || 500,
        temperature: Number.isFinite(temperature) ? temperature : 0.7,
        messages:    [{ role: 'system', content: system }, ...history],
      },
      { timeout: AI_TIMEOUT_MS }
    );
  } catch (err) {
    console.error('[ai reply]', err.message);
    return null;
  }

  const reply = completion.choices?.[0]?.message?.content?.trim() || '';

  // Consumo é melhor-esforço: falhar ao registrar não pode impedir o envio.
  const u = completion.usage;
  if (u) {
    pool.query(
      `INSERT INTO ai_usage_logs
         (subaccount_id, agent_id, conversation_id, model, prompt_tokens, completion_tokens, total_tokens, cost_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [subaccount_id, agent.id, conversation_id, agent.model || AI_DEFAULT_MODEL,
       u.prompt_tokens, u.completion_tokens, u.total_tokens,
       aiCostUsd(agent.model || AI_DEFAULT_MODEL, u)]
    ).catch(e => console.warn('[ai usage]', e.message));
  }

  // O marcador do prompt: a IA sinaliza que a mensagem não pede resposta
  // (um "ok", um emoji). Sem isso ela responderia educadamente a tudo.
  if (!reply || reply.includes(AI_NO_REPLY)) return null;
  return reply;
}

// Preço por 1M de tokens. Fora da tabela, devolve null em vez de chutar um
// número — custo errado no relatório é pior que custo ausente.
const AI_PRICING = {
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1-nano': { input: 0.10, output: 0.40 },
  'gpt-4.1':      { input: 2.00, output: 8.00 },
};
function aiCostUsd(model, usage) {
  const p = AI_PRICING[model];
  if (!p || !usage) return null;
  return +(((usage.prompt_tokens || 0) * p.input +
            (usage.completion_tokens || 0) * p.output) / 1e6).toFixed(6);
}

;(async function initSubaccountAgents() {
  try {
    // Marca qual agente é o "da subconta". O índice parcial garante no
    // máximo um padrão por subconta, deixando a porta aberta para agentes
    // adicionais no futuro sem precisar migrar nada.
    await pool.query(`ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_agents_one_default
                      ON ai_agents (subaccount_id) WHERE is_default`);

    // O default da coluna vinha de quando o projeto mirava modelos Claude.
    // Hoje o provedor é a OpenAI: um agente inserido sem modelo explícito
    // nasceria com um ID que o SDK não sabe chamar. Alinha ao padrão atual.
    // ALTER ... SET DEFAULT não aceita parâmetro vinculado, e AI_DEFAULT_MODEL
    // pode vir de variável de ambiente — então valida o formato antes de
    // interpolar, em vez de confiar na origem.
    if (/^[a-zA-Z0-9._-]{1,60}$/.test(AI_DEFAULT_MODEL)) {
      await pool.query(`ALTER TABLE ai_agents ALTER COLUMN model SET DEFAULT '${AI_DEFAULT_MODEL}'`);
    } else {
      console.warn(`[init] OPENAI_MODEL com formato inesperado, default da coluna mantido: ${AI_DEFAULT_MODEL}`);
    }

    // Backfill: subcontas criadas antes desta feature também ganham a sua IA.
    const { rows } = await pool.query(
      `SELECT s.id, s.name FROM subaccounts s
       WHERE NOT EXISTS (
         SELECT 1 FROM ai_agents a WHERE a.subaccount_id = s.id AND a.is_default
       )`
    );
    for (const sub of rows) await ensureSubaccountAgent(sub.id, sub.name);
    if (rows.length) console.log(`[init] IA padrão criada para ${rows.length} subconta(s)`);
  } catch (err) {
    console.error('[init] subaccount agents:', err.message);
  }
})();

// Garante que a subconta tenha a sua IA. Idempotente: o ON CONFLICT cobre a
// corrida entre o backfill do boot e uma criação simultânea de subconta.
async function ensureSubaccountAgent(subaccount_id, subaccountName, created_by = null) {
  const { rows } = await pool.query(
    `INSERT INTO ai_agents (subaccount_id, name, description, model, system_prompt, is_default, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, TRUE, FALSE, $6)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [subaccount_id,
     `IA de ${(subaccountName || 'atendimento').trim()}`,
     'Agente de atendimento da subconta. Edite o prompt em Modo desenvolvedor.',
     AI_DEFAULT_MODEL,
     defaultAgentPrompt(subaccountName),
     created_by]
  );
  if (rows.length) return rows[0];
  // Já existia — devolve o atual.
  const { rows: existing } = await pool.query(
    `SELECT * FROM ai_agents WHERE subaccount_id = $1 AND is_default LIMIT 1`, [subaccount_id]
  );
  return existing[0] || null;
}

;(async function initAiEventTables() {
  try {
    // Registro de ações das IAs — alimenta o Painel da IA.
    // Serve tanto para IA externa (n8n, agente próprio, etc: identificada
    // por agent_name) quanto para as IAs criadas dentro do CRM no futuro
    // (agent_id apontando para ai_agents). Por isso agent_id é opcional e
    // o vínculo com conversa/contato usa SET NULL: apagar uma conversa não
    // pode furar o histórico do painel.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_agent_events (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subaccount_id   UUID NOT NULL,
        agent_id        UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
        agent_name      VARCHAR(120) NOT NULL,
        agent_source    VARCHAR(20)  NOT NULL DEFAULT 'external',
        conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
        contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
        contact_name    VARCHAR(150),
        event_type      VARCHAR(60)  NOT NULL,
        description     TEXT,
        status          VARCHAR(20)  NOT NULL DEFAULT 'success',
        duration_ms     INTEGER,
        tokens          INTEGER,
        cost_usd        NUMERIC(12,6),
        metadata        JSONB NOT NULL DEFAULT '{}',
        occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_events_sub_time
                      ON ai_agent_events (subaccount_id, occurred_at DESC)`);
    // Token público que a IA externa usa para postar os eventos.
    await pool.query(`ALTER TABLE subaccount_settings ADD COLUMN IF NOT EXISTS ai_events_token VARCHAR(64)`);
  } catch (err) {
    console.error('[init] ai_agent_events:', err.message);
  }
})();

;(async function initAutomationTables() {
  try {
    // Fluxo (nodes + edges) armazenado como grafo — permite ramificação
    // (if/else, split) e não apenas uma lista linear de passos.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS automations (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subaccount_id  UUID NOT NULL,
        name           VARCHAR(200) NOT NULL,
        description    TEXT,
        is_active      BOOLEAN NOT NULL DEFAULT FALSE,
        trigger_type   VARCHAR(80) NOT NULL,
        trigger_config JSONB NOT NULL DEFAULT '{}',
        graph          JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
        run_count      INTEGER NOT NULL DEFAULT 0,
        last_run_at    TIMESTAMPTZ,
        created_by     UUID,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`ALTER TABLE automations ADD COLUMN IF NOT EXISTS graph JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}'`);

    // Execuções: cada run avança nó a nó. Timers pausam a run (status='waiting'
    // + next_run_at) até o processador de cron retomá-la.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS automation_runs (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        automation_id    UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
        contact_id       UUID REFERENCES contacts(id) ON DELETE CASCADE,
        opportunity_id   UUID REFERENCES opportunities(id) ON DELETE CASCADE,
        status           VARCHAR(20) NOT NULL DEFAULT 'running',
        -- running | waiting | completed | failed | cancelled
        current_node_id  VARCHAR(80),
        context          JSONB NOT NULL DEFAULT '{}',
        next_run_at      TIMESTAMPTZ,
        error            TEXT,
        started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at      TIMESTAMPTZ
      )`);
    await pool.query(`ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS opportunity_id UUID REFERENCES opportunities(id) ON DELETE CASCADE`);
    await pool.query(`ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS current_node_id VARCHAR(80)`);
    await pool.query(`ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS context JSONB NOT NULL DEFAULT '{}'`);
    await pool.query(`ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ`);
    // Runs disparadas por webhook/gatilhos sem contato associado precisam de contact_id nulo.
    try { await pool.query(`ALTER TABLE automation_runs ALTER COLUMN contact_id DROP NOT NULL`); } catch {}
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_automation_runs_waiting ON automation_runs (status, next_run_at) WHERE status = 'waiting'`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_automations_trigger ON automations (subaccount_id, trigger_type, is_active)`);
  } catch (err) {
    console.error('[init] automation tables:', err.message);
  }
})();

// Monta o WHERE (e os params) de um widget a partir das condições
// configuradas. Compartilhado entre a consulta agregada
// (executeWidgetQuery) e a listagem de registros do drill-down
// (fetchWidgetRecords) — assim a lista exibida ao clicar no widget é
// exatamente o conjunto de registros que o número do widget mede.
function buildWidgetFilters(pillar, config, subaccount_id) {
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

  const { conditions = [] } = config;

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
  } else if (pillar === 'funnels') {
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
  } else if (pillar === 'conversations') {
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
  } else {
    throw new Error(`Unknown pillar: ${pillar}`);
  }

  return { where: `WHERE ${wheres.join(' AND ')}`, params };
}

async function executeWidgetQuery(pillar, config, subaccount_id) {
  const { where, params } = buildWidgetFilters(pillar, config, subaccount_id);
  const { metric = 'count', group_by, sort = 'desc', limit = 50 } = config;
  const safeLimit = Math.min(Math.max(1, parseInt(limit) || 50), 100);

  if (pillar === 'contacts') {
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
    const METRIC_SQL = {
      count:     'COUNT(o.id)',
      sum_value: 'COALESCE(SUM(o.value),0)',
      avg_value: 'ROUND(AVG(o.value)::numeric,2)',
    };
    const metricSql = METRIC_SQL[metric] || 'COUNT(o.id)';
    // contact/assigned saíram das opções da interface (são dados de outras
    // entidades, não da oportunidade), mas continuam suportados para não
    // quebrar widgets já salvos com esses agrupamentos. Os JOINs entram só
    // quando realmente usados.
    const joins = `LEFT JOIN pipeline_stages ps ON ps.id = o.stage_id
                   LEFT JOIN pipelines p        ON p.id  = o.pipeline_id`
      + (group_by === 'contact'  ? ` LEFT JOIN contacts cc ON cc.id = o.contact_id`  : '')
      + (group_by === 'assigned' ? ` LEFT JOIN users u     ON u.id  = o.assigned_to` : '');
    const GB_MAP = {
      pipeline:      `COALESCE(p.name,'—')`,
      stage:         `COALESCE(ps.name,'—')`,
      status:        `o.status`,
      // A oportunidade guarda a origem no próprio JSONB custom_fields
      // (não há coluna source em opportunities). Mesmo sentinela usada
      // pelo pilar de contatos, traduzida para texto no frontend.
      source:        `COALESCE(NULLIF(o.custom_fields->>'source',''),'__none__')`,
      contact:       `COALESCE(NULLIF(cc.name,''),'Sem contato')`,
      assigned:      `COALESCE(NULLIF(u.name,''),'Sem responsável')`,
      title:         `COALESCE(NULLIF(o.title,''),'Sem título')`,
      currency:      `COALESCE(NULLIF(o.currency,''),'—')`,
      value:         `COALESCE(o.value,0)::text`,
      probability:   `COALESCE(o.probability,0)::text`,
      lost_reason:   `COALESCE(NULLIF(o.lost_reason,''),'—')`,
      date_day:      `TO_CHAR(o.created_at,'YYYY-MM-DD')`,
      date_month:    `TO_CHAR(date_trunc('month',o.created_at),'YYYY-MM')`,
      updated_day:   `TO_CHAR(o.updated_at,'YYYY-MM-DD')`,
      updated_month: `TO_CHAR(date_trunc('month',o.updated_at),'YYYY-MM')`,
      close_day:     `COALESCE(TO_CHAR(o.expected_close,'YYYY-MM-DD'),'Sem data')`,
      close_month:   `COALESCE(TO_CHAR(date_trunc('month',o.expected_close),'YYYY-MM'),'Sem data')`,
    };
    // Campos personalizados chegam como "cf:<nome>" e vivem no JSONB
    // custom_fields. O nome vem do usuário, então entra como parâmetro —
    // nunca interpolado no SQL.
    let gbExpr = GB_MAP[group_by];
    if (!gbExpr && typeof group_by === 'string' && group_by.startsWith('cf:')) {
      const cfName = group_by.slice(3);
      if (cfName && cfName.length <= 60) {
        params.push(cfName);
        gbExpr = `COALESCE(NULLIF(o.custom_fields->>$${params.length},''),'Sem valor')`;
      }
    }
    if (group_by && gbExpr) {
      const { rows } = await pool.query(
        `SELECT ${gbExpr} AS label, ${metricSql} AS value FROM opportunities o ${joins} ${where}
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

// Lista os registros que compõem o número do widget (drill-down ao clicar).
// Usa exatamente o mesmo WHERE da consulta agregada, então a lista sempre
// bate com o valor exibido.
async function fetchWidgetRecords(pillar, config, subaccount_id, limit) {
  const { where, params } = buildWidgetFilters(pillar, config, subaccount_id);
  const safeLimit = Math.min(Math.max(1, parseInt(limit) || 200), 500);

  if (pillar === 'contacts') {
    const { rows } = await pool.query(
      `SELECT id, name, email, phone, company, source, status, created_at
       FROM contacts ${where} ORDER BY created_at DESC LIMIT ${safeLimit}`,
      params
    );
    return rows;
  }

  if (pillar === 'funnels') {
    const { rows } = await pool.query(
      `SELECT o.id, o.title, o.value, o.currency, o.status, o.created_at,
              c.name AS contact_name, p.name AS pipeline_name, ps.name AS stage_name
       FROM opportunities o
       LEFT JOIN pipeline_stages ps ON ps.id = o.stage_id
       LEFT JOIN pipelines p        ON p.id  = o.pipeline_id
       LEFT JOIN contacts c         ON c.id  = o.contact_id
       ${where} ORDER BY o.created_at DESC LIMIT ${safeLimit}`,
      params
    );
    return rows;
  }

  if (pillar === 'conversations') {
    // O WHERE de conversas usa colunas sem prefixo de tabela; aplicá-lo numa
    // subconsulta evita ambiguidade com as colunas de mesmo nome de contacts
    // (subaccount_id, status, created_at) trazidas pelo JOIN.
    const { rows } = await pool.query(
      `SELECT cv.id, cv.status, cv.channel, cv.unread_count,
              cv.last_message_at, cv.created_at, c.name AS contact_name
       FROM (SELECT * FROM conversations ${where}) cv
       LEFT JOIN contacts c ON c.id = cv.contact_id
       ORDER BY COALESCE(cv.last_message_at, cv.created_at) DESC LIMIT ${safeLimit}`,
      params
    );
    return rows;
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
      `SELECT id, title, pillar, display, config, position, width, height, pos_x, pos_y, width_px
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
  const { title, display, config, width, height, pos_x, pos_y, width_px } = req.body;
  const VALID_DISPLAYS = ['kpi', 'bar', 'pie', 'line', 'table'];
  if (display && !VALID_DISPLAYS.includes(display))
    return res.status(400).json({ message: 'Display inválido.' });
  // pos_x/pos_y/width_px/height são coordenadas em px — 0 é um valor válido
  // (canto superior esquerdo do canvas), então não podem usar `|| null`
  // (0 é falsy em JS e viraria null, descartando a posição).
  const numOrNull = v => (v === undefined || v === null || Number.isNaN(+v)) ? null : +v;
  try {
    const { rows } = await pool.query(
      `UPDATE dashboard_widgets SET
         title      = COALESCE($1, title),
         display    = COALESCE($2, display),
         config     = COALESCE($3, config),
         width      = COALESCE($4, width),
         height     = COALESCE($5, height),
         pos_x      = COALESCE($6, pos_x),
         pos_y      = COALESCE($7, pos_y),
         width_px   = COALESCE($8, width_px),
         updated_at = NOW()
       WHERE id=$9
         AND dashboard_id IN (SELECT id FROM custom_dashboards WHERE subaccount_id=$10)
       RETURNING *`,
      [title||null, display||null, config ? JSON.stringify(config) : null, width||null,
       numOrNull(height), numOrNull(pos_x), numOrNull(pos_y), numOrNull(width_px),
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

// Duplica um widget dentro do mesmo dashboard. A cópia nasce deslocada em
// relação ao original (+24px) para não ficar exatamente por baixo dele no
// canvas de posição livre.
app.post('/api/dashboard-widgets/:id/duplicate', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      `INSERT INTO dashboard_widgets
         (dashboard_id, title, pillar, display, config, position, width, height, pos_x, pos_y, width_px)
       SELECT dw.dashboard_id,
              -- Sem título o widget exibe o nome do pilar; manter NULL evita
              -- que a cópia vire literalmente " (cópia)".
              CASE WHEN dw.title IS NULL THEN NULL
                   ELSE LEFT(dw.title || ' (cópia)', 150) END,
              dw.pillar, dw.display, dw.config,
              (SELECT COALESCE(MAX(position),0)+1 FROM dashboard_widgets WHERE dashboard_id = dw.dashboard_id),
              dw.width, dw.height,
              COALESCE(dw.pos_x,0) + 24, COALESCE(dw.pos_y,0) + 24,
              dw.width_px
       FROM dashboard_widgets dw
       JOIN custom_dashboards cd ON cd.id = dw.dashboard_id
       WHERE dw.id = $1 AND cd.subaccount_id = $2
       RETURNING *`,
      [req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Widget não encontrado.' });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[widget duplicate]', err.message);
    res.status(500).json({ message: 'Erro ao duplicar widget.' });
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

// Drill-down: lista os registros por trás do número do widget.
app.post('/api/dashboard-widgets/:id/records', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows: ws } = await pool.query(
      `SELECT dw.pillar, dw.config, dw.title FROM dashboard_widgets dw
       JOIN custom_dashboards cd ON cd.id = dw.dashboard_id
       WHERE dw.id=$1 AND cd.subaccount_id=$2`,
      [req.params.id, subaccount_id]
    );
    if (!ws.length) return res.status(404).json({ message: 'Widget não encontrado.' });
    const records = await fetchWidgetRecords(ws[0].pillar, ws[0].config, subaccount_id, req.body?.limit);
    res.json({ pillar: ws[0].pillar, title: ws[0].title, records });
  } catch (err) {
    console.error('[widget/records]', err.message);
    res.status(500).json({ message: 'Erro ao listar registros do widget.' });
  }
});

// ============================================================
// CUSTOM FIELD DEFINITIONS (contatos e oportunidades)
// ============================================================

const CF_ENTITIES = ['contact', 'opportunity'];
const CF_TYPES     = ['text', 'number', 'date', 'select', 'textarea', 'checkbox'];

function cfSlugify(label) {
  return (label || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50) || 'campo';
}

app.get('/api/custom-fields', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { entity } = req.query;
  if (entity && !CF_ENTITIES.includes(entity))
    return res.status(400).json({ message: 'Entidade inválida.' });
  try {
    const params = [subaccount_id];
    let where = 'WHERE subaccount_id = $1';
    if (entity) { params.push(entity); where += ` AND entity = $${params.length}`; }
    const { rows } = await pool.query(
      `SELECT id, entity, name, label, type, options, required, position
       FROM custom_field_definitions ${where}
       ORDER BY position ASC, created_at ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[custom-fields GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/custom-fields', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  const { entity, label, type, options, required } = req.body;

  if (!CF_ENTITIES.includes(entity)) return res.status(400).json({ message: 'Entidade inválida.' });
  if (!label?.trim()) return res.status(400).json({ message: 'Nome do campo é obrigatório.' });
  const fieldType = CF_TYPES.includes(type) ? type : 'text';
  const fieldOptions = fieldType === 'select'
    ? (Array.isArray(options) ? options.filter(o => typeof o === 'string' && o.trim()).map(o => o.trim()) : [])
    : [];
  if (fieldType === 'select' && !fieldOptions.length)
    return res.status(400).json({ message: 'Adicione ao menos uma opção para o campo de lista.' });

  try {
    const baseName = cfSlugify(label);
    let name = baseName;
    let attempt = 1;
    // Garante unicidade do slug dentro da subconta/entidade
    while (true) {
      const { rows: dup } = await pool.query(
        `SELECT id FROM custom_field_definitions WHERE subaccount_id=$1 AND entity=$2 AND name=$3`,
        [subaccount_id, entity, name]
      );
      if (!dup.length) break;
      attempt += 1;
      name = `${baseName}_${attempt}`;
    }

    const { rows: pos } = await pool.query(
      `SELECT COALESCE(MAX(position),0)+1 AS p FROM custom_field_definitions WHERE subaccount_id=$1 AND entity=$2`,
      [subaccount_id, entity]
    );

    const { rows } = await pool.query(
      `INSERT INTO custom_field_definitions (subaccount_id, entity, name, label, type, options, required, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [subaccount_id, entity, name, label.trim(), fieldType, JSON.stringify(fieldOptions), !!required, pos[0].p]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[custom-fields POST]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.put('/api/custom-fields/:id', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  const { label, type, options, required, position } = req.body;

  if (!label?.trim()) return res.status(400).json({ message: 'Nome do campo é obrigatório.' });
  const fieldType = CF_TYPES.includes(type) ? type : 'text';
  const fieldOptions = fieldType === 'select'
    ? (Array.isArray(options) ? options.filter(o => typeof o === 'string' && o.trim()).map(o => o.trim()) : [])
    : [];
  if (fieldType === 'select' && !fieldOptions.length)
    return res.status(400).json({ message: 'Adicione ao menos uma opção para o campo de lista.' });

  try {
    const { rows } = await pool.query(
      `UPDATE custom_field_definitions SET
         label      = $1, type = $2, options = $3, required = $4,
         position   = COALESCE($5, position),
         updated_at = NOW()
       WHERE id = $6 AND subaccount_id = $7 RETURNING *`,
      [label.trim(), fieldType, JSON.stringify(fieldOptions), !!required,
       position != null ? position : null, req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Campo não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[custom-fields PUT]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.delete('/api/custom-fields/:id', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM custom_field_definitions WHERE id=$1 AND subaccount_id=$2`,
      [req.params.id, subaccount_id]
    );
    if (!rowCount) return res.status(404).json({ message: 'Campo não encontrado.' });
    res.status(204).send();
  } catch (err) {
    console.error('[custom-fields DELETE]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ============================================================
// MODELOS DE MENSAGENS (pastas + modelos)
// ============================================================

app.get('/api/template-folders', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      `SELECT id, name, position FROM template_folders
       WHERE subaccount_id = $1 ORDER BY position ASC, created_at ASC`,
      [subaccount_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[template-folders GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/template-folders', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: 'Nome da pasta é obrigatório.' });
  try {
    const { rows: pos } = await pool.query(
      `SELECT COALESCE(MAX(position),0)+1 AS p FROM template_folders WHERE subaccount_id=$1`,
      [subaccount_id]
    );
    const { rows } = await pool.query(
      `INSERT INTO template_folders (subaccount_id, name, position) VALUES ($1,$2,$3) RETURNING id, name, position`,
      [subaccount_id, name.trim(), pos[0].p]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[template-folders POST]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.put('/api/template-folders/:id', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: 'Nome da pasta é obrigatório.' });
  try {
    const { rows } = await pool.query(
      `UPDATE template_folders SET name=$1, updated_at=NOW()
       WHERE id=$2 AND subaccount_id=$3 RETURNING id, name, position`,
      [name.trim(), req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Pasta não encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[template-folders PUT]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.delete('/api/template-folders/:id', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM template_folders WHERE id=$1 AND subaccount_id=$2`,
      [req.params.id, subaccount_id]
    );
    if (!rowCount) return res.status(404).json({ message: 'Pasta não encontrada.' });
    // Modelos da pasta não são apagados — ficam sem pasta ("Sem pasta")
    await pool.query(
      `UPDATE message_templates SET folder_id=NULL WHERE folder_id=$1 AND subaccount_id=$2`,
      [req.params.id, subaccount_id]
    );
    res.status(204).send();
  } catch (err) {
    console.error('[template-folders DELETE]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.get('/api/message-templates', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      `SELECT id, name, header_content, body, folder_id, position
       FROM message_templates
       WHERE subaccount_id = $1 ORDER BY position ASC, created_at ASC`,
      [subaccount_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[message-templates GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/message-templates', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { name, header_content, body, folder_id } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: 'Nome do modelo é obrigatório.' });
  if (!body?.trim()) return res.status(400).json({ message: 'Corpo da mensagem é obrigatório.' });
  try {
    // Valida a pasta (se informada) — deve pertencer à subconta
    let folder = null;
    if (folder_id) {
      const { rows: f } = await pool.query(
        `SELECT id FROM template_folders WHERE id=$1 AND subaccount_id=$2`,
        [folder_id, subaccount_id]
      );
      if (!f.length) return res.status(400).json({ message: 'Pasta inválida.' });
      folder = folder_id;
    }
    const { rows: pos } = await pool.query(
      `SELECT COALESCE(MAX(position),0)+1 AS p FROM message_templates WHERE subaccount_id=$1`,
      [subaccount_id]
    );
    const { rows } = await pool.query(
      `INSERT INTO message_templates (subaccount_id, name, header_content, body, folder_id, position)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, header_content, body, folder_id, position`,
      [subaccount_id, name.trim(), header_content?.trim() || null, body.trim(), folder, pos[0].p]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[message-templates POST]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.put('/api/message-templates/:id', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { name, header_content, body, folder_id } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: 'Nome do modelo é obrigatório.' });
  if (!body?.trim()) return res.status(400).json({ message: 'Corpo da mensagem é obrigatório.' });
  try {
    let folder = null;
    if (folder_id) {
      const { rows: f } = await pool.query(
        `SELECT id FROM template_folders WHERE id=$1 AND subaccount_id=$2`,
        [folder_id, subaccount_id]
      );
      if (!f.length) return res.status(400).json({ message: 'Pasta inválida.' });
      folder = folder_id;
    }
    const { rows } = await pool.query(
      `UPDATE message_templates SET
         name=$1, header_content=$2, body=$3, folder_id=$4, updated_at=NOW()
       WHERE id=$5 AND subaccount_id=$6
       RETURNING id, name, header_content, body, folder_id, position`,
      [name.trim(), header_content?.trim() || null, body.trim(), folder, req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Modelo não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[message-templates PUT]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.delete('/api/message-templates/:id', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM message_templates WHERE id=$1 AND subaccount_id=$2`,
      [req.params.id, subaccount_id]
    );
    if (!rowCount) return res.status(404).json({ message: 'Modelo não encontrado.' });
    res.status(204).send();
  } catch (err) {
    console.error('[message-templates DELETE]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
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

app.get('/api/contacts/:id', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, phone, company, position, source, status,
              assigned_to, notes, custom_fields, created_at, updated_at
       FROM contacts WHERE id = $1 AND subaccount_id = $2`,
      [req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Contato não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[contacts GET one]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/contacts', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { name, email, phone, company, source, status, custom_fields } = req.body;
  if (!name) return res.status(400).json({ message: 'Nome é obrigatório.' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO contacts (subaccount_id, name, email, phone, company, source, status, custom_fields)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [subaccount_id, name, email || null, phone || null, company || null, source || 'manual', status || 'lead',
       JSON.stringify(custom_fields || {})]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[contacts POST]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.put('/api/contacts/:id', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { name, email, phone, company, source, status, notes, custom_fields, assigned_to } = req.body;
  try {
    const { rows: before } = await pool.query(
      `SELECT assigned_to FROM contacts WHERE id = $1 AND subaccount_id = $2`, [req.params.id, subaccount_id]
    );
    if (!before.length) return res.status(404).json({ message: 'Contato não encontrado.' });

    const { rows } = await pool.query(
      `UPDATE contacts SET
         name          = COALESCE($1, name),   email   = COALESCE($2, email),
         phone         = COALESCE($3, phone),  company = COALESCE($4, company),
         source        = COALESCE($5, source), status  = COALESCE($6, status),
         notes         = COALESCE($7, notes),
         custom_fields = COALESCE($8, custom_fields),
         assigned_to   = COALESCE($9, assigned_to)
       WHERE id = $10 AND subaccount_id = $11 RETURNING *`,
      [name, email, phone, company, source, status, notes,
       custom_fields ? JSON.stringify(custom_fields) : null,
       assigned_to || null,
       req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Contato não encontrado.' });
    res.json(rows[0]);

    if (assigned_to && assigned_to !== before[0].assigned_to) {
      const { rows: userRows } = await pool.query(`SELECT id, name FROM users WHERE id = $1`, [assigned_to]);
      await fireAutomations(subaccount_id, 'contact_assigned', {
        contact: rows[0], assigned_to, user: userRows[0] || null,
      }, { contact_id: rows[0].id }).catch(e => console.error('[fireAutomations contact_assigned]', e.message));
    }
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
              cv.assigned_to, c.name AS contact_name, c.phone AS contact_phone,
              u.name AS owner_name
       FROM conversations cv
       JOIN contacts c ON c.id = cv.contact_id
       LEFT JOIN users u ON u.id = cv.assigned_to
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

// Quantidade de conversas não lidas (para o badge do menu lateral)
app.get('/api/conversations/unread-count', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM conversations
       WHERE subaccount_id = $1 AND unread_count > 0`,
      [subaccount_id]
    );
    res.json({ count: rows[0]?.count || 0 });
  } catch (err) {
    console.error('[conversations unread-count]', err.message);
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

    // Inclui file_data também no poll (?since=): como só retorna mensagens
    // mais novas que a última vista, cada mídia trafega uma única vez e as
    // imagens/áudios recebidos aparecem em tempo real no chat.
    const { rows } = await pool.query(
      `SELECT m.id, m.conversation_id, m.direction, m.sender_type, m.sender_id,
              m.content, m.is_internal, m.message_type, m.external_id, m.sent_at,
              m.file_data, m.status, m.error_message,
              u.name AS sender_name
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id AND m.sender_type = 'user'
       WHERE m.conversation_id = $1${sinceClause}
       ORDER BY m.sent_at ASC LIMIT 200`,
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
  const { content, instance_id, is_internal, mention_ids, message_type, file_data } = req.body;
  const msgType = message_type || 'text';
  if (msgType === 'text' && !content) return res.status(400).json({ message: 'Conteúdo é obrigatório.' });
  if (msgType === 'audio' && !file_data) return res.status(400).json({ message: 'Dados de áudio são obrigatórios.' });

  try {
    const { rows: conv } = await pool.query(
      `SELECT cv.id, cv.channel, c.id AS contact_id, c.phone AS contact_phone, c.name AS contact_name,
              u.name AS owner_name
       FROM conversations cv
       JOIN contacts c ON c.id = cv.contact_id
       LEFT JOIN users u ON u.id = cv.assigned_to
       WHERE cv.id = $1 AND cv.subaccount_id = $2`,
      [req.params.id, subaccount_id]
    );
    if (!conv.length) return res.status(404).json({ message: 'Conversa não encontrada.' });

    const { rows } = await pool.query(
      `INSERT INTO messages (conversation_id, direction, sender_type, sender_id, content, is_internal, message_type, file_data)
       VALUES ($1, 'outbound', 'user', $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.id, user_id, content || '', !!is_internal, msgType, file_data || null]
    );

    // Busca sender_name para retornar ao cliente (necessário para renderização imediata)
    const { rows: senderRows } = await pool.query(
      `SELECT name AS sender_name FROM users WHERE id = $1`, [user_id]
    );
    const savedMsg = { ...rows[0], sender_name: senderRows[0]?.sender_name || null };

    // Responder publicamente ao contato marca a conversa como lida.
    // Notas internas não contam como resposta ao contato.
    await pool.query(
      `UPDATE conversations SET last_message_at = NOW()${is_internal ? '' : ', unread_count = 0'} WHERE id = $1`,
      [req.params.id]
    );

    // Mensagens internas não são enviadas ao contato
    if (is_internal) {
      // Cria notificações para usuários mencionados (erros aqui não afetam o envio da mensagem)
      if (Array.isArray(mention_ids) && mention_ids.length) {
        const senderName = senderRows[0]?.sender_name || 'Alguém';
        const preview    = content.length > 100 ? content.slice(0, 100) + '…' : content;
        for (const uid of [...new Set(mention_ids)]) {
          if (uid === user_id) continue;
          try {
            await pool.query(
              `INSERT INTO notifications (subaccount_id, user_id, type, title, body, entity_type, entity_id)
               VALUES ($1, $2, 'mention', $3, $4, 'conversation', $5)`,
              [subaccount_id, uid, `${senderName} mencionou você em uma nota interna`, preview, req.params.id]
            );
          } catch (e) {
            console.warn('[mention notification]', e.message);
          }
        }
      }
      return res.status(201).json(savedMsg);
    }

    // Dispara automações do gatilho "Usuário respondeu" (resposta pública de
    // um usuário do CRM). Fire-and-forget: não deve atrasar a resposta ao
    // usuário que está enviando a mensagem no chat.
    const fireUserRepliedAutomations = () =>
      fireAutomations(subaccount_id, 'user_replied', {
        message: content, conversation_id: req.params.id,
        contact: { id: conv[0].contact_id, name: conv[0].contact_name, phone: conv[0].contact_phone },
      }, { contact_id: conv[0].contact_id }).catch(e => console.error('[fireAutomations user_replied]', e.message));

    // Envia via Evolution API se a conversa for de WhatsApp.
    //
    // O envio é AGUARDADO antes de responder. Antes ele era disparado num
    // bloco em background depois do res.json() — em ambiente serverless
    // (Vercel) a execução pode ser congelada assim que a resposta é
    // enviada, então esse envio simplesmente não acontecia: a mensagem
    // aparecia salva no chat do CRM e nunca chegava ao contato. Pior, o
    // erro era engolido (apenas console.warn), sem marcar a mensagem nem
    // avisar quem enviou.
    let deliveryError = null;
    let cfgUsed       = null;

    if (conv[0].channel === 'whatsapp' && conv[0].contact_phone) {
      const cfg = await resolveEvoConfig(subaccount_id, instance_id);
      cfgUsed   = cfg;
      if (!cfg) {
        deliveryError = 'Nenhuma instância de WhatsApp conectada para enviar a mensagem.';
      } else {
        const number = conv[0].contact_phone.replace(/\D/g, '');
        try {
          let evoResp;
          if (msgType === 'audio' && file_data) {
            const comma = file_data.indexOf(',');
            const b64   = comma !== -1 ? file_data.slice(comma + 1) : file_data;
            evoResp = await evoRequest('POST', cfg.evolution_api_url, cfg.evolution_api_key,
              `/message/sendWhatsAppAudio/${cfg.evolution_instance_name}`,
              { number, audio: b64, encoding: true }
            );
          } else if (msgType === 'image' && file_data) {
            const comma = file_data.indexOf(',');
            const b64   = comma !== -1 ? file_data.slice(comma + 1) : file_data;
            evoResp = await evoRequest('POST', cfg.evolution_api_url, cfg.evolution_api_key,
              `/message/sendMedia/${cfg.evolution_instance_name}`,
              { number, mediatype: 'image', media: b64, caption: content || '' }
            );
          } else {
            evoResp = await evoRequest('POST', cfg.evolution_api_url, cfg.evolution_api_key,
              `/message/sendText/${cfg.evolution_instance_name}`,
              { number, text: content }
            );
          }
          const externalId = evoResp?.key?.id;
          if (externalId) {
            await pool.query(`UPDATE messages SET external_id = $1 WHERE id = $2`, [externalId, rows[0].id]);
            savedMsg.external_id = externalId;
          } else {
            // 2xx sem key.id significa que a Evolution aceitou a chamada mas
            // não gerou mensagem — tratar como sucesso esconderia a falha.
            deliveryError = 'A API do WhatsApp não confirmou o envio.';
          }
        } catch (e) {
          deliveryError = e.message;
        }
      }

      if (deliveryError) {
        const detail = String(deliveryError).slice(0, 500);
        console.error('[evo send]', detail);
        await pool.query(
          `UPDATE messages SET status = 'failed', error_message = $1 WHERE id = $2`,
          [detail, rows[0].id]
        ).catch(e => console.warn('[evo send] falha ao marcar mensagem:', e.message));
        savedMsg.status        = 'failed';
        savedMsg.error_message = detail;
      }
    }

    res.status(201).json(savedMsg);

    // Webhooks e automações não interferem na entrega ao contato — seguem
    // depois da resposta, em melhor esforço.
    if (cfgUsed) {
      fireAgentWebhooks(subaccount_id, 'message_activity', {
        conversation_id:  req.params.id,
        contact_id:       conv[0].contact_id,
        contact_name:     conv[0].contact_name || conv[0].contact_phone,
        phone_number:     conv[0].contact_phone,
        instance:         cfgUsed.evolution_instance_name,
        message:          content,
        from_me:          true,
        message_type:     msgType,
        context:          is_internal ? 'nota_interna' : 'mensagem_publica',
        assigned_contact: conv[0].owner_name || null,
      }).catch(() => {});
    }
    await fireUserRepliedAutomations();
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

// Apaga a conversa e todo o seu histórico. Restrito a admin porque as
// mensagens são removidas em definitivo. As tabelas dependentes já têm
// ON DELETE CASCADE (messages, conversation_followers, ai_agent_sessions);
// ai_usage_logs usa SET NULL para preservar o histórico de consumo de IA.
app.delete('/api/conversations/:id', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM conversations WHERE id = $1 AND subaccount_id = $2`,
      [req.params.id, subaccount_id]
    );
    if (!rowCount) return res.status(404).json({ message: 'Conversa não encontrada.' });
    res.status(204).send();
  } catch (err) {
    console.error('[conversations DELETE]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// Lista usuários disponíveis para atribuição (sem exigir admin)
app.get('/api/conversations/members', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role FROM users WHERE subaccount_id = $1 AND is_active = TRUE ORDER BY name ASC`,
      [subaccount_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[conv members GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// Retorna proprietário e seguidores de uma conversa
app.get('/api/conversations/:id/assignment', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows: convRows } = await pool.query(
      `SELECT cv.assigned_to, u.id AS owner_id, u.name AS owner_name, u.email AS owner_email
       FROM conversations cv
       LEFT JOIN users u ON u.id = cv.assigned_to
       WHERE cv.id = $1 AND cv.subaccount_id = $2`,
      [req.params.id, subaccount_id]
    );
    if (!convRows.length) return res.status(404).json({ message: 'Conversa não encontrada.' });

    const { rows: followerRows } = await pool.query(
      `SELECT u.id, u.name, u.email
       FROM conversation_followers cf
       JOIN users u ON u.id = cf.user_id
       WHERE cf.conversation_id = $1
       ORDER BY cf.added_at ASC`,
      [req.params.id]
    );

    const owner = convRows[0].owner_id
      ? { id: convRows[0].owner_id, name: convRows[0].owner_name, email: convRows[0].owner_email }
      : null;

    res.json({ owner, followers: followerRows });
  } catch (err) {
    console.error('[conv assignment GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// Define o proprietário de uma conversa
app.put('/api/conversations/:id/owner', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { user_id } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE conversations SET assigned_to = $1 WHERE id = $2 AND subaccount_id = $3 RETURNING id`,
      [user_id || null, req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Conversa não encontrada.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[conv owner PUT]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// Substitui a lista completa de seguidores de uma conversa
app.put('/api/conversations/:id/followers', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { user_ids } = req.body;
  if (!Array.isArray(user_ids)) return res.status(400).json({ message: 'user_ids deve ser um array.' });
  try {
    const { rows: convRows } = await pool.query(
      `SELECT id FROM conversations WHERE id = $1 AND subaccount_id = $2`,
      [req.params.id, subaccount_id]
    );
    if (!convRows.length) return res.status(404).json({ message: 'Conversa não encontrada.' });

    await pool.query(`DELETE FROM conversation_followers WHERE conversation_id = $1`, [req.params.id]);

    if (user_ids.length) {
      const values = user_ids.map((uid, i) => `($1, $${i + 2})`).join(',');
      await pool.query(
        `INSERT INTO conversation_followers (conversation_id, user_id) VALUES ${values} ON CONFLICT DO NOTHING`,
        [req.params.id, ...user_ids]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[conv followers PUT]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ============================================================
// PIPELINES & OPPORTUNITIES
// ============================================================

app.get('/api/pipelines', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  // Filtra as oportunidades exibidas no funil por status (padrão: abertas).
  // Permite visualizar as ganhas/perdidas, que antes ficavam invisíveis no
  // kanban embora contassem no dashboard.
  const statusFilter = ['open', 'won', 'lost'].includes(req.query.status) ? req.query.status : 'open';
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
             WHERE o.stage_id = $1 AND o.status = $2 ORDER BY o.created_at DESC`,
            [stage.id, statusFilter]
          ),
          pool.query(
            `SELECT COUNT(*), COALESCE(SUM(value), 0) AS total
             FROM opportunities WHERE stage_id = $1 AND status = $2`,
            [stage.id, statusFilter]
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
    await fireAutomations(subaccount_id, 'opportunity_created', {
      opportunity: rows[0],
    }, { contact_id, opportunity_id: rows[0].id }).catch(e => console.error('[fireAutomations opportunity_created]', e.message));
  } catch (err) {
    console.error('[opportunities POST]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.put('/api/opportunities/:id', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { title, stage_id, pipeline_id, value, status, lost_reason, custom_fields } = req.body;
  try {
    const { rows: before } = await pool.query(
      `SELECT stage_id, status, contact_id FROM opportunities WHERE id = $1 AND subaccount_id = $2`,
      [req.params.id, subaccount_id]
    );
    if (!before.length) return res.status(404).json({ message: 'Oportunidade não encontrada.' });

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

    const opp = rows[0];
    const refs = { contact_id: opp.contact_id, opportunity_id: opp.id };
    if (stage_id && stage_id !== before[0].stage_id) {
      await fireAutomations(subaccount_id, 'opportunity_stage_changed', {
        opportunity: opp, pipeline_id: opp.pipeline_id, from_stage_id: before[0].stage_id, to_stage_id: opp.stage_id,
      }, refs).catch(e => console.error('[fireAutomations opportunity_stage_changed]', e.message));
    }
    if (status && status !== before[0].status) {
      await fireAutomations(subaccount_id, 'opportunity_status_changed', {
        opportunity: opp, from_status: before[0].status, to_status: opp.status,
      }, refs).catch(e => console.error('[fireAutomations opportunity_status_changed]', e.message));
    }
  } catch (err) {
    console.error('[opportunities PUT]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.delete('/api/opportunities/:id', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM opportunities WHERE id = $1 AND subaccount_id = $2`,
      [req.params.id, subaccount_id]
    );
    if (!rowCount) return res.status(404).json({ message: 'Oportunidade não encontrada.' });
    res.status(204).send();
  } catch (err) {
    console.error('[opportunities DELETE]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.put('/api/opportunities/:id/stage', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const { stage_id } = req.body;
  try {
    const { rows: before } = await pool.query(
      `SELECT stage_id FROM opportunities WHERE id = $1 AND subaccount_id = $2`,
      [req.params.id, subaccount_id]
    );
    if (!before.length) return res.status(404).json({ message: 'Oportunidade não encontrada.' });

    const { rows } = await pool.query(
      `UPDATE opportunities SET stage_id = $1
       WHERE id = $2 AND subaccount_id = $3 RETURNING *`,
      [stage_id, req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Oportunidade não encontrada.' });
    res.json(rows[0]);

    if (stage_id && stage_id !== before[0].stage_id) {
      const opp = rows[0];
      await fireAutomations(subaccount_id, 'opportunity_stage_changed', {
        opportunity: opp, pipeline_id: opp.pipeline_id, from_stage_id: before[0].stage_id, to_stage_id: opp.stage_id,
      }, { contact_id: opp.contact_id, opportunity_id: opp.id }).catch(e => console.error('[fireAutomations opportunity_stage_changed]', e.message));
    }
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
      [subaccount_id, name, description || null, model || AI_DEFAULT_MODEL, system_prompt || null, created_by]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[agents POST]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// A IA da subconta. Cria sob demanda para nunca retornar 404 — uma subconta
// sempre tem a sua IA, mesmo que o backfill do boot não a tenha alcançado.
app.get('/api/agents/default', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows: sub } = await pool.query(`SELECT name FROM subaccounts WHERE id = $1`, [subaccount_id]);
    const agent = await ensureSubaccountAgent(subaccount_id, sub[0]?.name);
    if (!agent) return res.status(404).json({ message: 'Subconta não encontrada.' });
    res.json(agent);
  } catch (err) {
    console.error('[agents default GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// Edição do agente. É por aqui que o prompt é alterado dentro do CRM.
app.put('/api/agents/:id', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  const { name, description, system_prompt, model, max_tokens, temperature, is_active } = req.body;

  if (name !== undefined && !String(name).trim())
    return res.status(400).json({ message: 'Nome não pode ficar vazio.' });
  if (system_prompt !== undefined && String(system_prompt).length > 100000)
    return res.status(400).json({ message: 'Prompt excede o limite de 100.000 caracteres.' });
  const tokens = max_tokens === undefined || max_tokens === null ? null : parseInt(max_tokens, 10);
  if (tokens !== null && (isNaN(tokens) || tokens < 1 || tokens > 128000))
    return res.status(400).json({ message: 'max_tokens deve ficar entre 1 e 128000.' });
  // 0 é um valor válido (resposta mais previsível), então não pode usar `||`.
  const temp = temperature === undefined || temperature === null ? null : Number(temperature);
  if (temp !== null && (isNaN(temp) || temp < 0 || temp > 2))
    return res.status(400).json({ message: 'temperature deve ficar entre 0 e 2.' });

  try {
    const { rows } = await pool.query(
      `UPDATE ai_agents SET
         name          = COALESCE($1, name),
         description   = COALESCE($2, description),
         system_prompt = COALESCE($3, system_prompt),
         model         = COALESCE($4, model),
         max_tokens    = COALESCE($5, max_tokens),
         temperature   = COALESCE($6, temperature),
         is_active     = COALESCE($7, is_active),
         updated_at    = NOW()
       WHERE id = $8 AND subaccount_id = $9
       RETURNING *`,
      [name?.trim() || null, description ?? null, system_prompt ?? null,
       model?.trim() || null, tokens, temp, is_active ?? null, req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Agente não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[agents PUT]', err.message);
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
// AUTOMATIONS — motor de execução (estilo n8n)
// ============================================================
//
// Um fluxo (automation) é um grafo: { nodes:[{id,type,config,isTrigger?}], edges:[{source,sourceHandle,target}] }.
// O nó de gatilho não é "executado" — ele só define trigger_type/trigger_config
// (espelhados nas colunas dedicadas para permitir busca rápida) e aponta para
// o primeiro nó real do fluxo. A partir daí, processAutomationStep avança nó a
// nó, seguindo as arestas de saída (sourceHandle 'default', ou 'true'/'false'
// para if/else). Quando um nó tem mais de uma aresta de saída no mesmo handle
// (ex: depois de um nó "Split"), o motor cria runs extras para os caminhos
// adicionais — cada ramo é executado de forma independente.

const AUTOMATION_TRIGGERS = [
  'contact_replied', 'webhook', 'user_replied', 'opportunity_created',
  'opportunity_stage_changed', 'opportunity_status_changed', 'contact_assigned',
];
const AUTOMATION_NODE_TYPES = [
  'whatsapp_send_message', 'pipeline_create', 'opportunity_search',
  'opportunity_update', 'timer', 'if_else', 'split',
];

function _autoGetPath(obj, path) {
  if (!path) return undefined;
  return String(path).split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

// Substitui {{caminho.no.contexto}} pelo valor resolvido (texto de mensagens, campos, etc).
function autoInterpolate(template, context) {
  if (!template) return '';
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const v = _autoGetPath(context, path);
    return v == null ? '' : String(v);
  });
}

function resolveNextNodeIds(graph, nodeId, handle) {
  const edges = graph?.edges || [];
  return edges
    .filter(e => e.source === nodeId && (e.sourceHandle || 'default') === (handle || 'default'))
    .map(e => e.target)
    .filter(Boolean);
}

// Resolve a config de conexão Evolution API (instância específica → mais
// recente conectada → configuração da subconta). Compartilhado entre o envio
// manual de mensagens e o node "Enviar WhatsApp" das automações.
async function resolveEvoConfig(subaccount_id, instance_id) {
  let cfg;
  if (instance_id) {
    const { rows } = await pool.query(
      `SELECT api_url AS evolution_api_url, api_key AS evolution_api_key, instance_name AS evolution_instance_name
       FROM whatsapp_instances WHERE id = $1 AND subaccount_id = $2`,
      [instance_id, subaccount_id]
    );
    cfg = rows[0];
  }
  if (!cfg) {
    const { rows } = await pool.query(
      `SELECT api_url AS evolution_api_url, api_key AS evolution_api_key, instance_name AS evolution_instance_name
       FROM whatsapp_instances WHERE subaccount_id = $1
       ORDER BY connected_at DESC NULLS LAST, created_at DESC LIMIT 1`,
      [subaccount_id]
    );
    cfg = rows[0];
  }
  if (!cfg) {
    const { rows } = await pool.query(
      `SELECT evolution_api_url, evolution_api_key, evolution_instance_name FROM subaccount_settings WHERE subaccount_id = $1`,
      [subaccount_id]
    );
    cfg = rows[0];
  }
  return (cfg && cfg.evolution_api_url && cfg.evolution_instance_name) ? cfg : null;
}

const AUTOMATION_NODE_EXECUTORS = {
  // Envia uma mensagem de WhatsApp (Evolution API/não-oficial) para o contato
  // da run, registrando a mensagem na conversa do CRM (sender_type='automation').
  whatsapp_send_message: async (node, { context, subaccount_id, run }) => {
    const contactId = run.contact_id;
    if (!contactId) throw new Error('Este fluxo não tem um contato associado para enviar a mensagem.');
    const text = autoInterpolate(node.config?.message, context).trim();
    if (!text) throw new Error('O node "Enviar WhatsApp" está com a mensagem vazia.');

    const { rows: contactRows } = await pool.query(
      `SELECT id, name, phone FROM contacts WHERE id = $1 AND subaccount_id = $2`, [contactId, subaccount_id]
    );
    const contact = contactRows[0];
    if (!contact?.phone) throw new Error('O contato não tem telefone cadastrado.');

    const { rows: convRows } = await pool.query(
      `SELECT id FROM conversations WHERE subaccount_id = $1 AND contact_id = $2 AND channel = 'whatsapp' AND status = 'open' LIMIT 1`,
      [subaccount_id, contactId]
    );
    let convId = convRows[0]?.id;
    if (!convId) {
      const ins = await pool.query(
        `INSERT INTO conversations (subaccount_id, contact_id, channel, status) VALUES ($1,$2,'whatsapp','open') RETURNING id`,
        [subaccount_id, contactId]
      );
      convId = ins.rows[0].id;
    }

    const { rows: msgRows } = await pool.query(
      `INSERT INTO messages (conversation_id, direction, sender_type, content, message_type)
       VALUES ($1,'outbound','automation',$2,'text') RETURNING id`,
      [convId, text]
    );

    const cfg = await resolveEvoConfig(subaccount_id, node.config?.instance_id);
    if (cfg) {
      try {
        const number = contact.phone.replace(/\D/g, '');
        const evoResp = await evoRequest('POST', cfg.evolution_api_url, cfg.evolution_api_key,
          `/message/sendText/${cfg.evolution_instance_name}`, { number, text });
        const externalId = evoResp?.key?.id;
        if (externalId) await pool.query(`UPDATE messages SET external_id = $1 WHERE id = $2`, [externalId, msgRows[0].id]);
      } catch (e) {
        console.warn('[automation whatsapp send]', e.message);
      }
    }
    await pool.query(`UPDATE conversations SET last_message_at = NOW(), unread_count = 0 WHERE id = $1`, [convId]);

    return { output: 'default', patch: { conversation_id: convId, message: text } };
  },

  // Cria um novo pipeline (funil) com as etapas configuradas no node.
  pipeline_create: async (node, { subaccount_id }) => {
    const name = (node.config?.name || '').trim();
    const stages = Array.isArray(node.config?.stages) ? node.config.stages.filter(s => s?.name?.trim()) : [];
    if (!name) throw new Error('O node "Criar pipeline" precisa de um nome.');
    if (!stages.length) throw new Error('O node "Criar pipeline" precisa de ao menos uma etapa.');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: existing } = await client.query('SELECT id FROM pipelines WHERE subaccount_id = $1', [subaccount_id]);
      const { rows: pipeline } = await client.query(
        'INSERT INTO pipelines (subaccount_id, name, is_default) VALUES ($1,$2,$3) RETURNING *',
        [subaccount_id, name, existing.length === 0]
      );
      for (let i = 0; i < stages.length; i++) {
        const s = stages[i];
        await client.query(
          'INSERT INTO pipeline_stages (pipeline_id, name, color, position, is_won, is_lost) VALUES ($1,$2,$3,$4,$5,$6)',
          [pipeline[0].id, s.name.trim(), s.color || '#6b7280', i, !!s.is_won, !!s.is_lost]
        );
      }
      await client.query('COMMIT');
      return { output: 'default', patch: { pipeline_id: pipeline[0].id, pipeline_name: pipeline[0].name } };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // Procura oportunidade(s) e guarda o resultado no contexto para nodes seguintes.
  opportunity_search: async (node, { context, subaccount_id, run }) => {
    const scope = node.config?.scope || 'trigger_opportunity';
    let rows = [];
    if (scope === 'trigger_opportunity') {
      if (!run.opportunity_id) throw new Error('Este fluxo não tem uma oportunidade de origem (gatilho não é de oportunidade).');
      ({ rows } = await pool.query(
        `SELECT o.*, p.name AS pipeline_name, ps.name AS stage_name
         FROM opportunities o
         LEFT JOIN pipelines p ON p.id = o.pipeline_id
         LEFT JOIN pipeline_stages ps ON ps.id = o.stage_id
         WHERE o.id = $1 AND o.subaccount_id = $2`,
        [run.opportunity_id, subaccount_id]
      ));
    } else if (scope === 'by_contact') {
      if (!run.contact_id) throw new Error('Este fluxo não tem um contato associado.');
      const params = [subaccount_id, run.contact_id];
      let where = 'o.subaccount_id = $1 AND o.contact_id = $2';
      if (node.config?.status) { params.push(node.config.status); where += ` AND o.status = $${params.length}`; }
      ({ rows } = await pool.query(
        `SELECT o.*, p.name AS pipeline_name, ps.name AS stage_name
         FROM opportunities o
         LEFT JOIN pipelines p ON p.id = o.pipeline_id
         LEFT JOIN pipeline_stages ps ON ps.id = o.stage_id
         WHERE ${where} ORDER BY o.created_at DESC LIMIT 20`,
        params
      ));
    } else {
      const params = [subaccount_id];
      let where = 'o.subaccount_id = $1';
      if (node.config?.pipeline_id) { params.push(node.config.pipeline_id); where += ` AND o.pipeline_id = $${params.length}`; }
      if (node.config?.stage_id)    { params.push(node.config.stage_id);    where += ` AND o.stage_id = $${params.length}`; }
      if (node.config?.status)      { params.push(node.config.status);      where += ` AND o.status = $${params.length}`; }
      ({ rows } = await pool.query(
        `SELECT o.*, p.name AS pipeline_name, ps.name AS stage_name
         FROM opportunities o
         LEFT JOIN pipelines p ON p.id = o.pipeline_id
         LEFT JOIN pipeline_stages ps ON ps.id = o.stage_id
         WHERE ${where} ORDER BY o.created_at DESC LIMIT 20`,
        params
      ));
    }
    return { output: 'default', patch: { found: rows.length > 0, count: rows.length, opportunity: rows[0] || null, opportunities: rows } };
  },

  // Atualiza campos de uma oportunidade (da run do gatilho, ou de um node de busca anterior).
  opportunity_update: async (node, { context, subaccount_id, run }) => {
    const source = node.config?.source || 'trigger';
    let opportunityId = null;
    if (source === 'trigger') opportunityId = run.opportunity_id;
    else if (node.config?.source_node_id) opportunityId = context?.[node.config.source_node_id]?.opportunity?.id || null;
    if (!opportunityId) throw new Error('O node "Atualizar oportunidade" não encontrou uma oportunidade de origem.');

    const f = node.config?.fields || {};
    const { rows } = await pool.query(
      `UPDATE opportunities SET
         stage_id    = COALESCE($1, stage_id),
         status      = COALESCE($2, status),
         value       = COALESCE($3, value),
         lost_reason = COALESCE($4, lost_reason),
         updated_at  = NOW()
       WHERE id = $5 AND subaccount_id = $6 RETURNING *`,
      [
        f.stage_id || null,
        f.status || null,
        f.value != null && f.value !== '' ? f.value : null,
        f.lost_reason ? autoInterpolate(f.lost_reason, context) : null,
        opportunityId, subaccount_id,
      ]
    );
    if (!rows.length) throw new Error('Oportunidade não encontrada para atualizar.');
    return { output: 'default', patch: { opportunity: rows[0] } };
  },

  // Pausa a run. Na primeira passagem define next_run_at e sinaliza "waiting";
  // quando o cron retoma (next_run_at já passou), segue em frente normalmente.
  timer: async (node, { run }) => {
    const amount = Math.max(1, parseInt(node.config?.amount) || 1);
    const unit = ['minutes', 'hours', 'days'].includes(node.config?.unit) ? node.config.unit : 'minutes';
    const alreadyWaited = run.status === 'waiting' && run.next_run_at && new Date(run.next_run_at) <= new Date();
    if (alreadyWaited) return { output: 'default' };
    const ms = amount * (unit === 'days' ? 86400000 : unit === 'hours' ? 3600000 : 60000);
    return { waiting: true, nextRunAt: new Date(Date.now() + ms) };
  },

  // Avalia uma condição simples contra o contexto acumulado; duas saídas: true/false.
  if_else: async (node, { context }) => {
    const field = node.config?.field || '';
    const op = node.config?.operator || 'eq';
    const expected = node.config?.value ?? '';
    const actual = _autoGetPath(context, field);

    let result;
    switch (op) {
      case 'is_empty':     result = actual === undefined || actual === null || actual === ''; break;
      case 'is_not_empty': result = !(actual === undefined || actual === null || actual === ''); break;
      case 'contains':     result = String(actual ?? '').toLowerCase().includes(String(expected).toLowerCase()); break;
      case 'gt':            result = parseFloat(actual) > parseFloat(expected); break;
      case 'lt':            result = parseFloat(actual) < parseFloat(expected); break;
      case 'gte':           result = parseFloat(actual) >= parseFloat(expected); break;
      case 'lte':            result = parseFloat(actual) <= parseFloat(expected); break;
      case 'neq':           result = String(actual ?? '') !== String(expected); break;
      case 'eq':
      default:               result = String(actual ?? '') === String(expected); break;
    }
    return { output: result ? 'true' : 'false', patch: { result } };
  },

  // Passa adiante sem efeito — existe para deixar explícito, no canvas, o
  // ponto em que o fluxo se ramifica em múltiplos caminhos paralelos
  // (o fan-out em si acontece no motor sempre que há mais de uma aresta
  // saindo do mesmo handle de um node).
  split: async () => ({ output: 'default' }),
};

async function executeAutomationNode(node, ctx) {
  const executor = AUTOMATION_NODE_EXECUTORS[node.type];
  if (!executor) throw new Error(`Tipo de node desconhecido: ${node.type}`);
  return executor(node, ctx);
}

// Processa uma run passo a passo até: terminar, precisar esperar (timer), ou
// atingir o prazo de segurança (a run fica 'waiting' com retomada imediata,
// para não estourar o timeout da função serverless).
async function processAutomationStep(runId) {
  const MAX_STEPS = 100;
  const SOFT_DEADLINE_MS = 20000;
  const t0 = Date.now();

  const { rows } = await pool.query(
    `SELECT r.*, a.graph, a.subaccount_id, a.is_active, a.id AS automation_id
     FROM automation_runs r JOIN automations a ON a.id = r.automation_id
     WHERE r.id = $1`,
    [runId]
  );
  const run = rows[0];
  if (!run || !['running', 'waiting'].includes(run.status)) return;
  if (!run.is_active) {
    await pool.query(`UPDATE automation_runs SET status='cancelled', finished_at=NOW() WHERE id=$1`, [runId]);
    return;
  }

  const graph = run.graph || { nodes: [], edges: [] };
  const nodesById = Object.fromEntries((graph.nodes || []).map(n => [n.id, n]));
  let context = run.context || {};
  let currentId = run.current_node_id;
  const spawned = [];
  let steps = 0;

  try {
    while (currentId) {
      if (++steps > MAX_STEPS) throw new Error('Limite de passos excedido (possível loop no fluxo).');
      if (Date.now() - t0 > SOFT_DEADLINE_MS) {
        await pool.query(
          `UPDATE automation_runs SET status='waiting', current_node_id=$1, context=$2, next_run_at=NOW() WHERE id=$3`,
          [currentId, JSON.stringify(context), runId]
        );
        return;
      }
      const node = nodesById[currentId];
      if (!node) throw new Error(`Node "${currentId}" não existe mais no fluxo.`);

      const result = await executeAutomationNode(node, { context, subaccount_id: run.subaccount_id, run: { ...run, status: currentId === run.current_node_id ? run.status : 'running' } });

      if (result.waiting) {
        await pool.query(
          `UPDATE automation_runs SET status='waiting', current_node_id=$1, context=$2, next_run_at=$3 WHERE id=$4`,
          [currentId, JSON.stringify(context), result.nextRunAt, runId]
        );
        return;
      }
      if (result.patch) context = { ...context, [node.id]: result.patch };

      const targets = resolveNextNodeIds(graph, node.id, result.output || 'default');
      if (!targets.length) { currentId = null; break; }
      for (let i = 1; i < targets.length; i++) {
        const ins = await pool.query(
          `INSERT INTO automation_runs (automation_id, contact_id, opportunity_id, status, current_node_id, context)
           VALUES ($1,$2,$3,'running',$4,$5) RETURNING id`,
          [run.automation_id, run.contact_id, run.opportunity_id, targets[i], JSON.stringify(context)]
        );
        spawned.push(ins.rows[0].id);
      }
      currentId = targets[0];
    }

    await pool.query(
      `UPDATE automation_runs SET status='completed', current_node_id=NULL, context=$1, finished_at=NOW() WHERE id=$2`,
      [JSON.stringify(context), runId]
    );
    await pool.query(`UPDATE automations SET run_count = run_count + 1, last_run_at = NOW() WHERE id = $1`, [run.automation_id]);
  } catch (err) {
    await pool.query(`UPDATE automation_runs SET status='failed', error=$1, finished_at=NOW() WHERE id=$2`, [err.message, runId]);
  }

  // Processa os ramos gerados por fan-out (ex: node "Split") sequencialmente.
  for (const id of spawned) {
    try { await processAutomationStep(id); } catch (e) { console.error('[automation branch]', e.message); }
  }
}

// Filtros opcionais definidos na config do node de gatilho (ex: só disparar
// para um pipeline/etapa/usuário específico). Ausência de filtro = sempre casa.
function automationTriggerMatches(triggerType, config, seedContext) {
  config = config || {};
  if (triggerType === 'opportunity_stage_changed') {
    if (config.pipeline_id && config.pipeline_id !== seedContext.pipeline_id) return false;
    if (config.to_stage_id && config.to_stage_id !== seedContext.to_stage_id) return false;
    return true;
  }
  if (triggerType === 'opportunity_status_changed') {
    if (config.to_status && config.to_status !== seedContext.to_status) return false;
    return true;
  }
  if (triggerType === 'opportunity_created') {
    if (config.pipeline_id && config.pipeline_id !== seedContext.opportunity?.pipeline_id) return false;
    return true;
  }
  if (triggerType === 'contact_assigned') {
    if (config.user_id && config.user_id !== seedContext.assigned_to) return false;
    return true;
  }
  return true;
}

// Encontra automações ativas para o gatilho e dispara uma run para cada uma.
async function fireAutomations(subaccount_id, triggerType, seedContext, refs = {}) {
  try {
    const { rows } = await pool.query(
      `SELECT id, graph FROM automations WHERE subaccount_id = $1 AND trigger_type = $2 AND is_active = TRUE`,
      [subaccount_id, triggerType]
    );
    for (const a of rows) {
      const graph = a.graph || { nodes: [], edges: [] };
      const triggerNode = (graph.nodes || []).find(n => n.isTrigger);
      if (!triggerNode) continue;
      if (!automationTriggerMatches(triggerType, triggerNode.config, seedContext)) continue;

      const firstTargets = resolveNextNodeIds(graph, triggerNode.id, 'default');
      if (!firstTargets.length) continue;

      const { rows: ins } = await pool.query(
        `INSERT INTO automation_runs (automation_id, contact_id, opportunity_id, status, current_node_id, context)
         VALUES ($1,$2,$3,'running',$4,$5) RETURNING id`,
        [a.id, refs.contact_id || null, refs.opportunity_id || null, firstTargets[0], JSON.stringify({ trigger: seedContext })]
      );
      await processAutomationStep(ins[0].id);
    }
  } catch (err) {
    console.error('[fireAutomations]', triggerType, err.message);
  }
}

// ============================================================
// AUTOMATIONS — API
// ============================================================

app.get('/api/automations', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      'SELECT id, name, description, is_active, trigger_type, trigger_config, run_count, last_run_at, created_at, updated_at FROM automations WHERE subaccount_id = $1 ORDER BY created_at DESC',
      [subaccount_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[automations GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.get('/api/automations/:id', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM automations WHERE id = $1 AND subaccount_id = $2', [req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Automação não encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[automations GET one]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

function _validateAutomationGraph(graph) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges))
    return 'Fluxo inválido.';
  const triggerNode = graph.nodes.find(n => n.isTrigger);
  if (!triggerNode) return 'O fluxo precisa de um gatilho.';
  if (!AUTOMATION_TRIGGERS.includes(triggerNode.triggerType)) return 'Tipo de gatilho inválido.';
  for (const n of graph.nodes) {
    if (n.isTrigger) continue;
    if (!AUTOMATION_NODE_TYPES.includes(n.type)) return `Tipo de node inválido: ${n.type}`;
  }
  return null;
}

app.post('/api/automations', auth, requireAdmin, async (req, res) => {
  const { subaccount_id, sub: user_id } = req.user;
  const { name, description, graph } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: 'Nome é obrigatório.' });

  const err = _validateAutomationGraph(graph);
  if (err) return res.status(400).json({ message: err });

  const triggerNode = graph.nodes.find(n => n.isTrigger);
  // Webhook precisa de um token público único, gerado no servidor.
  if (triggerNode.triggerType === 'webhook' && !triggerNode.config?.token) {
    triggerNode.config = { ...(triggerNode.config || {}), token: crypto.randomBytes(20).toString('hex') };
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO automations (subaccount_id, name, description, trigger_type, trigger_config, graph, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [subaccount_id, name.trim(), description || null, triggerNode.triggerType,
       JSON.stringify(triggerNode.config || {}), JSON.stringify(graph), user_id]
    );
    res.status(201).json(rows[0]);
  } catch (err2) {
    console.error('[automations POST]', err2.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.put('/api/automations/:id', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  const { name, description, graph, is_active } = req.body;

  try {
    let triggerType = null, triggerConfig = null, graphJson = null;
    if (graph) {
      const err = _validateAutomationGraph(graph);
      if (err) return res.status(400).json({ message: err });
      const triggerNode = graph.nodes.find(n => n.isTrigger);
      if (triggerNode.triggerType === 'webhook' && !triggerNode.config?.token) {
        // preserva o token já existente, se houver
        const { rows: cur } = await pool.query('SELECT trigger_config FROM automations WHERE id=$1 AND subaccount_id=$2', [req.params.id, subaccount_id]);
        const existingToken = cur[0]?.trigger_config?.token;
        triggerNode.config = { ...(triggerNode.config || {}), token: existingToken || crypto.randomBytes(20).toString('hex') };
      }
      triggerType = triggerNode.triggerType;
      triggerConfig = JSON.stringify(triggerNode.config || {});
      graphJson = JSON.stringify(graph);
    }

    const { rows } = await pool.query(
      `UPDATE automations SET
         name           = COALESCE($1, name),
         description    = COALESCE($2, description),
         trigger_type   = COALESCE($3, trigger_type),
         trigger_config = COALESCE($4, trigger_config),
         graph          = COALESCE($5, graph),
         is_active      = COALESCE($6, is_active),
         updated_at     = NOW()
       WHERE id = $7 AND subaccount_id = $8 RETURNING *`,
      [name?.trim() || null, description ?? null, triggerType, triggerConfig, graphJson,
       typeof is_active === 'boolean' ? is_active : null, req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Automação não encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[automations PUT]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.delete('/api/automations/:id', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM automations WHERE id = $1 AND subaccount_id = $2`, [req.params.id, subaccount_id]
    );
    if (!rowCount) return res.status(404).json({ message: 'Automação não encontrada.' });
    res.status(204).send();
  } catch (err) {
    console.error('[automations DELETE]', err.message);
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

// Histórico de execuções (para depuração/confiança no fluxo)
app.get('/api/automations/:id/runs', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows: own } = await pool.query('SELECT id FROM automations WHERE id=$1 AND subaccount_id=$2', [req.params.id, subaccount_id]);
    if (!own.length) return res.status(404).json({ message: 'Automação não encontrada.' });
    const { rows } = await pool.query(
      `SELECT r.id, r.status, r.current_node_id, r.error, r.started_at, r.finished_at, r.next_run_at,
              c.name AS contact_name
       FROM automation_runs r LEFT JOIN contacts c ON c.id = r.contact_id
       WHERE r.automation_id = $1 ORDER BY r.started_at DESC LIMIT 30`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[automations runs GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// Executa manualmente para teste (opcionalmente contra um contato específico)
app.post('/api/automations/:id/test', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  const { contact_id } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM automations WHERE id=$1 AND subaccount_id=$2', [req.params.id, subaccount_id]);
    const automation = rows[0];
    if (!automation) return res.status(404).json({ message: 'Automação não encontrada.' });

    const graph = automation.graph || { nodes: [], edges: [] };
    const triggerNode = graph.nodes.find(n => n.isTrigger);
    if (!triggerNode) return res.status(400).json({ message: 'Fluxo sem gatilho.' });
    const firstTargets = resolveNextNodeIds(graph, triggerNode.id, 'default');
    if (!firstTargets.length) return res.status(400).json({ message: 'Fluxo sem nós após o gatilho.' });

    let opportunity_id = null;
    if (contact_id) {
      const { rows: oppRows } = await pool.query(
        `SELECT id FROM opportunities WHERE contact_id=$1 AND subaccount_id=$2 ORDER BY created_at DESC LIMIT 1`,
        [contact_id, subaccount_id]
      );
      opportunity_id = oppRows[0]?.id || null;
    }

    const { rows: ins } = await pool.query(
      `INSERT INTO automation_runs (automation_id, contact_id, opportunity_id, status, current_node_id, context)
       VALUES ($1,$2,$3,'running',$4,$5) RETURNING id`,
      [automation.id, contact_id || null, opportunity_id, firstTargets[0], JSON.stringify({ trigger: { test: true } })]
    );
    await processAutomationStep(ins[0].id);

    const { rows: final } = await pool.query('SELECT * FROM automation_runs WHERE id=$1', [ins[0].id]);
    res.json(final[0]);
  } catch (err) {
    console.error('[automations test]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// Receptor público de webhook — dispara diretamente a automação dona do token.
app.post('/api/automations/webhook/:token', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, subaccount_id, graph FROM automations
       WHERE trigger_type = 'webhook' AND is_active = TRUE AND trigger_config->>'token' = $1`,
      [req.params.token]
    );
    if (!rows.length) return res.status(404).json({ message: 'Webhook não encontrado ou inativo.' });
    const automation = rows[0];
    const graph = automation.graph || { nodes: [], edges: [] };
    const triggerNode = graph.nodes.find(n => n.isTrigger);
    const firstTargets = resolveNextNodeIds(graph, triggerNode.id, 'default');
    if (!firstTargets.length) return res.status(202).json({ message: 'Recebido (fluxo vazio).' });

    const { rows: ins } = await pool.query(
      `INSERT INTO automation_runs (automation_id, status, current_node_id, context)
       VALUES ($1,'running',$2,$3) RETURNING id`,
      [automation.id, firstTargets[0], JSON.stringify({ trigger: { body: req.body, headers: req.headers, query: req.query } })]
    );
    processAutomationStep(ins[0].id).catch(e => console.error('[automation webhook run]', e.message));
    res.status(202).json({ message: 'Recebido.' });
  } catch (err) {
    console.error('[automations webhook]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// Retoma runs pausadas em timers vencidos. Chamado por um cron do Vercel
// (vercel.json) e pode ser chamado manualmente para depuração.
app.all('/api/automations/process-due', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query.secret;
    if (provided !== secret) return res.status(401).json({ message: 'Não autorizado.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id FROM automation_runs WHERE status = 'waiting' AND next_run_at <= NOW() LIMIT 25`
    );
    for (const r of rows) {
      try { await processAutomationStep(r.id); } catch (e) { console.error('[process-due]', r.id, e.message); }
    }
    res.json({ processed: rows.length });
  } catch (err) {
    console.error('[automations process-due]', err.message);
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
    // Toda subconta nasce com a sua própria IA (inativa, com o prompt padrão
    // pronto para ser editado em Modo desenvolvedor). Falhar aqui não pode
    // impedir a criação da subconta — o backfill do boot e o GET
    // /api/agents/default cobrem o caso.
    ensureSubaccountAgent(rows[0].id, rows[0].name, req.user.sub)
      .catch(e => console.error('[subaccount agent]', e.message));
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

// Processa e salva uma mensagem WhatsApp recebida (webhook ou pull).
// Retorna 'saved', 'duplicate' ou 'skipped'.
async function processWaMsg(subaccount_id, instanceName, apiUrl, apiKey, data) {
  const key      = data.key || {};
  const jid      = key.remoteJid || '';
  if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return 'skipped';

  const phone      = waCleanPhone(jid);
  if (!phone) return 'skipped';

  const fromMe     = !!key.fromMe;
  const isAudioMsg = !!(data.message?.audioMessage || data.message?.pttMessage);
  const content    = waExtractContent(data);
  const pushName   = data.pushName || null;
  const externalId = key.id || null;

  const variants      = waPhoneVariants(phone);
  const placeholders  = variants.map((_, i) => `$${i + 2}`).join(',');
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
    const contactName = (!fromMe && pushName) ? pushName : displayPhone;
    const { rows: newContact } = await pool.query(
      `INSERT INTO contacts (subaccount_id, name, phone) VALUES ($1, $2, $3) RETURNING id`,
      [subaccount_id, contactName, displayPhone]
    );
    contact_id = newContact[0].id;
  }

  if (!fromMe && pushName) {
    await pool.query(
      `UPDATE contacts SET name = $1 WHERE id = $2 AND (name IS NULL OR name = phone OR name = $3)`,
      [pushName, contact_id, '+' + phone]
    );
  }

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

  if (externalId) {
    const { rows: dup } = await pool.query(
      `SELECT id FROM messages WHERE conversation_id = $1 AND external_id = $2 LIMIT 1`,
      [conv_id, externalId]
    );
    if (dup.length) return 'duplicate';
  }

  const isImageMsg = !!(data.message?.imageMessage);

  let inboundFileData = null;
  if ((isAudioMsg || isImageMsg) && apiUrl && apiKey) {
    try {
      const msgBody  = { message: { key: data.key, message: data.message }, convertToMp4: false };
      const attempts = [
        ['/chat/getBase64FromMediaMessage',    msgBody],
        ['/message/getBase64FromMediaMessage', msgBody],
        ['/message/getBase64FromMediaMessage', data],
        ['/message/downloadMedia',             data],
      ];
      let mediaResp;
      for (const [path, body] of attempts) {
        try {
          mediaResp = await evoRequest('POST', apiUrl, apiKey, `${path}/${instanceName}`, body);
          if (mediaResp?.base64) break;
        } catch {}
      }
      const rawB64 = mediaResp?.base64 || mediaResp?.data || mediaResp?.mediaData;
      if (rawB64) {
        const cleanB64 = rawB64.includes(',') ? rawB64.split(',')[1] : rawB64;
        const defaultMime = isImageMsg ? 'image/jpeg' : 'audio/ogg; codecs=opus';
        const mime = (mediaResp?.mimetype || defaultMime).split(';')[0].trim();
        inboundFileData = `data:${mime};base64,${cleanB64}`;
      }
    } catch {}
  }

  const inboundMsgType = isAudioMsg ? 'audio' : isImageMsg ? 'image' : 'text';
  const [,, ownerResult] = await Promise.all([
    pool.query(
      `INSERT INTO messages (conversation_id, direction, sender_type, content, external_id, message_type, file_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [conv_id, fromMe ? 'outbound' : 'inbound', fromMe ? 'user' : 'contact', content, externalId, inboundMsgType, inboundFileData]
    ),
    pool.query(
      `UPDATE conversations SET last_message_at = NOW(), unread_count = unread_count + ${fromMe ? 0 : 1} WHERE id = $1`,
      [conv_id]
    ),
    pool.query(
      `SELECT u.name FROM conversations cv LEFT JOIN users u ON u.id = cv.assigned_to WHERE cv.id = $1`,
      [conv_id]
    ),
  ]);
  const ownerName = ownerResult.rows[0]?.name || null;

  // Busca nome do contato via fetchProfile para mensagens enviadas por mim (fromMe)
  if (fromMe && apiUrl && apiKey) {
    (async () => {
      try {
        const profileResp = await evoRequest('POST', apiUrl, apiKey,
          `/chat/fetchProfile/${instanceName}`, { number: phone });
        const profileName = profileResp?.name || profileResp?.pushName || null;
        if (profileName) {
          await pool.query(
            `UPDATE contacts SET name = $1 WHERE id = $2 AND (name IS NULL OR name = phone OR name = $3)`,
            [profileName, contact_id, '+' + phone]
          );
        }
      } catch {}
    })();
  }

  // Dispara webhooks de agentes
  const msgTypeMap = {
    conversation: 'texto', extendedTextMessage: 'texto',
    imageMessage: 'imagem', videoMessage: 'video',
    audioMessage: 'audio', pttMessage: 'audio',
    documentMessage: 'documento', stickerMessage: 'figurinha',
  };
  const rawMsg  = data.message || {};
  const msgType = Object.keys(msgTypeMap).find(k => rawMsg[k]) || 'texto';
  // IMPORTANTE: aguardar (await) aqui é necessário — sem isso, a Vercel pode
  // congelar/encerrar a função serverless assim que a resposta HTTP for
  // enviada pelo chamador, cancelando esse fetch em segundo plano antes de
  // ele completar (falha silenciosa e intermitente na entrega do webhook).
  await fireAgentWebhooks(subaccount_id, 'message_activity', {
    conversation_id:  conv_id,
    contact_id,
    contact_name:     pushName || phone,
    phone_number:     '+' + phone,
    instance:         instanceName,
    message:          content,
    from_me:          fromMe,
    message_type:     msgTypeMap[msgType] || 'texto',
    context:          'mensagem_publica',
    assigned_contact: ownerName,
  }).catch(() => {});

  // Dispara automações do gatilho "Cliente respondeu" (mesma lógica de
  // await do webhook de agentes acima — necessário em ambiente serverless).
  if (!fromMe) {
    await fireAutomations(subaccount_id, 'contact_replied', {
      message: content, conversation_id: conv_id,
      contact: { id: contact_id, name: pushName || ('+' + phone), phone: '+' + phone },
    }, { contact_id }).catch(e => console.error('[fireAutomations contact_replied]', e.message));
  }

  // Resposta automática da IA da subconta. Só para mensagens recebidas de
  // texto — áudio/imagem entram como "[Áudio 🎤]" e não há o que responder.
  // Aguardado de propósito: em serverless nada em segundo plano sobrevive ao
  // fim da requisição.
  if (!fromMe && msgType === 'texto' && content) {
    try {
      const reply = await generateAiReply({
        subaccount_id,
        conversation_id: conv_id,
        contact_name:    pushName || null,
      });
      if (reply) {
        const { rows: sent } = await pool.query(
          `INSERT INTO messages (conversation_id, direction, sender_type, content, message_type)
           VALUES ($1,'outbound','bot',$2,'text') RETURNING id`,
          [conv_id, reply]
        );
        await pool.query(`UPDATE conversations SET last_message_at = NOW() WHERE id = $1`, [conv_id]);
        if (apiUrl && apiKey) {
          try {
            const evoResp = await evoRequest('POST', apiUrl, apiKey,
              `/message/sendText/${instanceName}`, { number: phone, text: reply });
            const externalId = evoResp?.key?.id;
            if (externalId)
              await pool.query(`UPDATE messages SET external_id = $1 WHERE id = $2`, [externalId, sent[0].id]);
          } catch (e) {
            // Mesma regra do envio manual: a mensagem fica registrada, mas
            // marcada como não entregue em vez de parecer que chegou.
            console.error('[ai send]', e.message);
            await pool.query(
              `UPDATE messages SET status = 'failed', error_message = $1 WHERE id = $2`,
              [String(e.message).slice(0, 500), sent[0].id]
            ).catch(() => {});
          }
        }
      }
    } catch (e) {
      // A IA nunca pode impedir o registro da mensagem recebida.
      console.error('[ai reply pipeline]', e.message);
    }
  }

  return 'saved';
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
  const body = req.body || {};
  const eventRaw = (body.event || body.type || '').toLowerCase().replace(/[-_]/g, '.');

  // DIAGNÓSTICO TEMPORÁRIO — remover após confirmar o payload do n8n
  console.log('[evo-in] RAW:', JSON.stringify(body).slice(0, 800));
  console.log(`[evo-in] event="${eventRaw}" instance="${body.instance}" keys=${Object.keys(body.data||{}).join(',')}`);

  const isUpsert    = eventRaw.includes('messages.upsert') || eventRaw.includes('message.upsert');
  const isSent      = eventRaw.includes('send.message')   || eventRaw.includes('message.sent') || eventRaw.includes('messages.sent');
  const isConnUpdate = eventRaw.includes('connection.update');

  // ── Evento de conexão (QR escaneado / desconectado) ──────────
  if (isConnUpdate) {
    const instance = body.instance;
    const connData = body.data || {};
    const state    = connData.state || connData.connection || '';
    console.log(`[evo-conn] instance="${instance}" state="${state}"`);

    if (state === 'open') {
      try {
        const { rows: inst } = await pool.query(
          `SELECT id, api_url, api_key FROM whatsapp_instances WHERE instance_name = $1 LIMIT 1`,
          [instance]
        );
        if (inst.length) {
          // Atualiza status no banco
          await pool.query(
            `UPDATE whatsapp_instances SET status = 'connected', connected_at = NOW() WHERE id = $1`,
            [inst[0].id]
          );

          // Busca número de telefone conectado e salva
          try {
            // v2: me.id = "5511999...@s.whatsapp.net" | v1: number, wid.user
            const rawFromEvent = connData.me?.id || connData.number || connData.wid?.user || null;
            console.log(`[evo-conn] connData keys:`, Object.keys(connData || {}), 'rawFromEvent:', rawFromEvent);
            let phoneDigits = rawFromEvent
              ? rawFromEvent.replace(/@.+/, '').replace(/\D/g, '')
              : null;
            if (phoneDigits && phoneDigits.length >= 8) {
              await pool.query(
                `UPDATE whatsapp_instances SET phone_number = $1 WHERE id = $2`,
                ['+' + phoneDigits, inst[0].id]
              );
              console.log(`[evo-conn] phone (do evento) salvo: +${phoneDigits} instance="${instance}"`);
            } else {
              // Fallback: busca via evoFetchPhone
              const phone = await evoFetchPhone(inst[0].api_url, inst[0].api_key, instance);
              if (phone) {
                await pool.query(
                  `UPDATE whatsapp_instances SET phone_number = $1 WHERE id = $2`,
                  ['+' + phone, inst[0].id]
                );
                console.log(`[evo-conn] phone (evoFetchPhone) salvo: +${phone} instance="${instance}"`);
              } else {
                console.warn(`[evo-conn] phone não encontrado para instance="${instance}"`);
              }
            }
          } catch (e) {
            console.warn(`[evo-conn] erro ao buscar phone:`, e.message);
          }

          // Re-sincroniza webhook — crítico para garantir que mensagens cheguem ao CRM
          try {
            await evoSetWebhook(inst[0].api_url, inst[0].api_key, instance);
            console.log(`[evo-conn] webhook re-sincronizado para instance="${instance}"`);
          } catch (e) {
            console.error(`[evo-conn] FALHA ao configurar webhook para "${instance}":`, e.message);
          }

          console.log(`[evo-conn] instância "${instance}" marcada como connected`);
        } else {
          console.warn(`[evo-conn] instância "${instance}" não encontrada no banco`);
        }
      } catch (e) {
        console.error(`[evo-conn] ERRO ao processar connection.update:`, e.message);
      }
    } else if (state === 'close' || state === 'refused') {
      try {
        await pool.query(
          `UPDATE whatsapp_instances SET status = 'disconnected' WHERE instance_name = $1`,
          [instance]
        );
        console.log(`[evo-conn] instância "${instance}" marcada como disconnected`);
      } catch {}
    }

    return res.sendStatus(200);
  }

  if (!isUpsert && !isSent) {
    console.log(`[evo-in] descartado (evento não tratado): "${eventRaw}"`);
    return res.sendStatus(200);
  }

  const instance = body.instance;
  let data = body.data || body.messages?.[0];
  if (!data) { console.log('[evo-in] descartado: body.data vazio'); return res.sendStatus(200); }

  // Evolution API v2: MESSAGES_UPSERT envolve as mensagens em data.messages[]
  // Quando n8n ou outra API envia, o payload chega como { data: { messages: [{key,message,...}], type: 'notify' } }
  if (!data.key && Array.isArray(data.messages) && data.messages.length) {
    data = data.messages[0];
  }

  const key = data.key || {};
  const jid = key.remoteJid || '';
  if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') {
    console.log(`[evo-in] descartado: jid inválido/grupo "${jid}"`);
    return res.sendStatus(200);
  }

  const phone = waCleanPhone(jid);
  if (!phone) { console.log(`[evo-in] descartado: phone vazio jid="${jid}"`); return res.sendStatus(200); }

  const fromMe     = !!key.fromMe;
  const isAudioMsg = !!(data.message?.audioMessage || data.message?.pttMessage);
  const content    = waExtractContent(data);
  const pushName   = data.pushName || null;
  const externalId = key.id || null;

  console.log(`[evo-in] processando event="${eventRaw}" fromMe=${fromMe} instance="${instance}" phone="${phone}" extId="${externalId}" content="${(content||'').slice(0,60)}"`);

  try {
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
    if (!cfgRows.length) {
      console.warn(`[evo-in] DESCARTADO instância não encontrada: "${instance}"`);
      return res.sendStatus(200);
    }
    const subaccount_id = cfgRows[0].subaccount_id;
    console.log(`[evo-in] subconta="${subaccount_id}" event="${eventRaw}" instance="${instance}" phone="${phone}"`);

    const { rows: instCreds } = await pool.query(
      `SELECT api_url, api_key FROM whatsapp_instances WHERE instance_name = $1 LIMIT 1`,
      [instance]
    );
    const apiUrl = instCreds[0]?.api_url || null;
    const apiKey = instCreds[0]?.api_key || null;

    const status = await processWaMsg(subaccount_id, instance, apiUrl, apiKey, data);
    console.log(`[evo-in] processWaMsg → ${status} extId="${data.key?.id}"`);
  } catch (err) {
    console.error(`[evo-in] ERRO ao processar event="${eventRaw}" instance="${body.instance}":`, err.message, err.stack);
  }

  res.sendStatus(200);
});

// Diagnóstico de roteamento de instância — mostra como o webhook mapeia uma instância para subconta
app.get('/api/whatsapp-instances/:id/routing-check', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM whatsapp_instances WHERE id = $1 AND subaccount_id = $2',
      [req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Instância não encontrada.' });
    const inst = rows[0];

    // Simula exatamente o que o webhook handler faz ao receber uma mensagem desta instância
    const instanceName = inst.instance_name;

    const { rows: byNewTable } = await pool.query(
      `SELECT id, subaccount_id, instance_name FROM whatsapp_instances WHERE instance_name = $1 LIMIT 1`,
      [instanceName]
    );
    const { rows: byLegacy } = await pool.query(
      `SELECT subaccount_id, evolution_instance_name FROM subaccount_settings WHERE evolution_instance_name = $1 LIMIT 1`,
      [instanceName]
    );
    const { rows: instCreds } = await pool.query(
      `SELECT api_url IS NOT NULL AS has_api_url, api_key IS NOT NULL AS has_api_key
       FROM whatsapp_instances WHERE instance_name = $1 LIMIT 1`,
      [instanceName]
    );

    const foundSubaccountId = byNewTable[0]?.subaccount_id || byLegacy[0]?.subaccount_id || null;
    const routeMatches      = foundSubaccountId === subaccount_id;

    res.json({
      instance_name:          instanceName,
      current_subaccount_id:  subaccount_id,
      found_via_new_table:    byNewTable[0] ? { id: byNewTable[0].id, subaccount_id: byNewTable[0].subaccount_id } : null,
      found_via_legacy:       byLegacy[0]   ? { subaccount_id: byLegacy[0].subaccount_id } : null,
      resolved_subaccount_id: foundSubaccountId,
      routes_to_correct_sub:  routeMatches,
      has_api_credentials:    instCreds[0] || { has_api_url: false, has_api_key: false },
      conclusion: routeMatches
        ? '✅ Mensagens desta instância serão roteadas para esta subconta corretamente.'
        : foundSubaccountId
          ? `⚠️ Instância roteia para subconta diferente: "${foundSubaccountId}" (não "${subaccount_id}")`
          : '❌ Instância não encontrada no banco — mensagens serão descartadas pelo webhook.',
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ============================================================
// DIAGNÓSTICO — verifica e cria colunas de áudio se necessário
// ============================================================
app.get('/api/diagnostic/audio-columns', async (req, res) => {
  try {
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(20) NOT NULL DEFAULT 'text'`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_data TEXT`);
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'messages' AND column_name IN ('message_type','file_data')
    `);
    res.json({ ok: true, columns: rows.map(r => r.column_name) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// ENDPOINT — Clara AI
// Recebe do n8n o conversation_id + texto e exibe no CRM
// como mensagem "bot" (bolha verde, label Clara AI).
//
// POST /api/ai-message
// Body: { conversation_id, message }
// ============================================================

// ============================================================
// PAINEL DA IA — ingestão de eventos e leitura das métricas
// ============================================================

const AI_EVENT_STATUSES = ['success', 'escalated', 'warning', 'error'];

// Normaliza um evento vindo da IA. Retorna { ok, value } ou { ok:false, error }.
function normalizeAiEvent(raw, subaccount_id) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Evento inválido.' };

  const agentName = String(raw.agent || raw.agent_name || '').trim();
  if (!agentName)         return { ok: false, error: 'Campo "agent" é obrigatório.' };
  if (agentName.length > 120) return { ok: false, error: 'Campo "agent" excede 120 caracteres.' };

  const eventType = String(raw.event || raw.event_type || '').trim();
  if (!eventType)         return { ok: false, error: 'Campo "event" é obrigatório.' };
  if (eventType.length > 60)  return { ok: false, error: 'Campo "event" excede 60 caracteres.' };

  const status = String(raw.status || 'success').trim().toLowerCase();
  if (!AI_EVENT_STATUSES.includes(status))
    return { ok: false, error: `Campo "status" deve ser: ${AI_EVENT_STATUSES.join(', ')}.` };

  // occurred_at é opcional; data inválida cai para agora em vez de rejeitar,
  // para não descartar o evento por um detalhe de formato.
  let occurredAt = null;
  if (raw.occurred_at) {
    const d = new Date(raw.occurred_at);
    if (!isNaN(d)) occurredAt = d.toISOString();
  }

  const num = (v, max) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!isFinite(n) || n < 0) return null;
    return max !== undefined ? Math.min(n, max) : n;
  };

  const uuid = v => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)) ? v : null;

  return { ok: true, value: {
    subaccount_id,
    agent_id:        uuid(raw.agent_id),
    agent_name:      agentName,
    agent_source:    raw.agent_id ? 'internal' : (raw.agent_source === 'internal' ? 'internal' : 'external'),
    conversation_id: uuid(raw.conversation_id),
    contact_id:      uuid(raw.contact_id),
    contact_name:    raw.contact_name ? String(raw.contact_name).slice(0, 150) : null,
    event_type:      eventType,
    description:     raw.description ? String(raw.description).slice(0, 2000) : null,
    status,
    duration_ms:     num(raw.duration_ms, 3600000),
    tokens:          num(raw.tokens, 10000000),
    cost_usd:        num(raw.cost_usd, 100000),
    metadata:        (raw.metadata && typeof raw.metadata === 'object') ? raw.metadata : {},
    occurred_at:     occurredAt,
  }};
}

// Ingestão. Autenticada por token público na URL (mesmo padrão do gatilho
// de webhook das automações), porque quem chama é um sistema externo que
// não tem sessão de usuário.
app.post('/api/ai-events/:token', async (req, res) => {
  const token = req.params.token || '';
  try {
    const { rows: sub } = await pool.query(
      `SELECT subaccount_id FROM subaccount_settings WHERE ai_events_token = $1 LIMIT 1`,
      [token]
    );
    if (!sub.length) return res.status(404).json({ message: 'Token inválido.' });
    const subaccount_id = sub[0].subaccount_id;

    // Aceita um evento solto ou um lote em "events".
    const incoming = Array.isArray(req.body?.events) ? req.body.events : [req.body];
    if (!incoming.length) return res.status(400).json({ message: 'Nenhum evento enviado.' });
    if (incoming.length > 500) return res.status(400).json({ message: 'Máximo de 500 eventos por requisição.' });

    const accepted = [];
    const rejected = [];
    incoming.forEach((raw, i) => {
      const r = normalizeAiEvent(raw, subaccount_id);
      if (r.ok) accepted.push(r.value);
      else rejected.push({ index: i, error: r.error });
    });

    if (!accepted.length)
      return res.status(400).json({ message: 'Nenhum evento válido.', rejected });

    // Um único INSERT com todas as linhas — evita N idas ao banco num lote.
    const cols = ['subaccount_id','agent_id','agent_name','agent_source','conversation_id','contact_id',
                  'contact_name','event_type','description','status','duration_ms','tokens','cost_usd',
                  'metadata','occurred_at'];
    const params = [];
    const tuples = accepted.map(ev => {
      const ph = cols.map(c => {
        if (c === 'occurred_at' && ev[c] === null) return 'NOW()';
        params.push(c === 'metadata' ? JSON.stringify(ev[c]) : ev[c]);
        return `$${params.length}`;
      });
      return `(${ph.join(',')})`;
    });
    const { rows } = await pool.query(
      `INSERT INTO ai_agent_events (${cols.join(',')}) VALUES ${tuples.join(',')} RETURNING id`,
      params
    );

    res.status(201).json({ received: incoming.length, stored: rows.length, rejected });
  } catch (err) {
    console.error('[ai-events POST]', err.message);
    res.status(500).json({ message: 'Erro ao registrar eventos.' });
  }
});

// Métricas agregadas do painel.
app.get('/api/ai-dashboard', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  const HOURS = { '24h': 24, '7d': 168, '30d': 720 };
  const hours = HOURS[req.query.range] || 24;
  try {
    const since = `NOW() - INTERVAL '${hours} hours'`;

    const [totals, byAgent, series, recent, prev] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status='escalated')::int AS escalated,
                COUNT(*) FILTER (WHERE status='error')::int     AS errors,
                COUNT(*) FILTER (WHERE status='success')::int   AS success,
                AVG(duration_ms)::int                           AS avg_ms,
                COALESCE(SUM(tokens),0)::bigint                 AS tokens,
                COALESCE(SUM(cost_usd),0)::numeric              AS cost
         FROM ai_agent_events WHERE subaccount_id=$1 AND occurred_at >= ${since}`,
        [subaccount_id]
      ),
      pool.query(
        `SELECT agent_name, agent_source, COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status='success')::int   AS success,
                COUNT(*) FILTER (WHERE status='escalated')::int AS escalated
         FROM ai_agent_events WHERE subaccount_id=$1 AND occurred_at >= ${since}
         GROUP BY 1,2 ORDER BY total DESC LIMIT 12`,
        [subaccount_id]
      ),
      pool.query(
        `SELECT agent_name,
                TO_CHAR(date_trunc('hour', occurred_at), 'YYYY-MM-DD"T"HH24:00') AS bucket,
                COUNT(*)::int AS total
         FROM ai_agent_events WHERE subaccount_id=$1 AND occurred_at >= ${since}
         GROUP BY 1,2 ORDER BY 2 ASC`,
        [subaccount_id]
      ),
      pool.query(
        `SELECT e.id, e.agent_name, e.agent_source, e.event_type, e.description, e.status,
                e.duration_ms, e.occurred_at, e.conversation_id,
                COALESCE(e.contact_name, c.name) AS contact_name
         FROM ai_agent_events e
         LEFT JOIN contacts c ON c.id = e.contact_id
         WHERE e.subaccount_id=$1
         ORDER BY e.occurred_at DESC LIMIT 50`,
        [subaccount_id]
      ),
      // Janela anterior de mesmo tamanho, para calcular a variação.
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM ai_agent_events
         WHERE subaccount_id=$1
           AND occurred_at >= NOW() - INTERVAL '${hours * 2} hours'
           AND occurred_at <  ${since}`,
        [subaccount_id]
      ),
    ]);

    const t = totals.rows[0];
    const decided = t.success + t.escalated;
    res.json({
      range: req.query.range || '24h',
      totals: {
        total:      t.total,
        escalated:  t.escalated,
        errors:     t.errors,
        avg_ms:     t.avg_ms,
        tokens:     Number(t.tokens),
        cost_usd:   Number(t.cost),
        // Resolução = sucessos sobre o que teve desfecho (ignora avisos).
        resolution_rate: decided ? +(t.success * 100 / decided).toFixed(1) : null,
        prev_total: prev.rows[0].total,
      },
      agents: byAgent.rows,
      series: series.rows,
      recent: recent.rows,
    });
  } catch (err) {
    console.error('[ai-dashboard GET]', err.message);
    res.status(500).json({ message: 'Erro ao carregar o painel.' });
  }
});

// Token de ingestão: consulta (cria na primeira vez) e rotação.
app.get('/api/ai-events-token', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      `INSERT INTO subaccount_settings (subaccount_id, ai_events_token)
       VALUES ($1, $2)
       ON CONFLICT (subaccount_id) DO UPDATE
         SET ai_events_token = COALESCE(subaccount_settings.ai_events_token, EXCLUDED.ai_events_token)
       RETURNING ai_events_token`,
      [subaccount_id, crypto.randomBytes(20).toString('hex')]
    );
    res.json({ token: rows[0].ai_events_token });
  } catch (err) {
    console.error('[ai-events-token GET]', err.message);
    res.status(500).json({ message: 'Erro ao obter o token.' });
  }
});

app.post('/api/ai-events-token/rotate', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      `INSERT INTO subaccount_settings (subaccount_id, ai_events_token) VALUES ($1,$2)
       ON CONFLICT (subaccount_id) DO UPDATE SET ai_events_token = EXCLUDED.ai_events_token
       RETURNING ai_events_token`,
      [subaccount_id, crypto.randomBytes(20).toString('hex')]
    );
    res.json({ token: rows[0].ai_events_token });
  } catch (err) {
    console.error('[ai-events-token rotate]', err.message);
    res.status(500).json({ message: 'Erro ao gerar novo token.' });
  }
});

app.post('/api/ai-message', async (req, res) => {
  const { conversation_id, message } = req.body || {};
  if (!conversation_id || !message) {
    return res.status(400).json({ message: 'conversation_id e message são obrigatórios.' });
  }

  try {
    const { rows: conv } = await pool.query(
      `SELECT id FROM conversations WHERE id = $1 LIMIT 1`, [conversation_id]
    );
    if (!conv.length) return res.status(404).json({ message: 'Conversa não encontrada.' });

    const { rows: [msg] } = await pool.query(
      `INSERT INTO messages (conversation_id, direction, sender_type, content)
       VALUES ($1, 'outbound', 'bot', $2) RETURNING id`,
      [conversation_id, message]
    );

    await pool.query(`UPDATE conversations SET last_message_at = NOW() WHERE id = $1`, [conversation_id]);

    res.status(201).json({ message_id: msg.id });
  } catch (err) {
    console.error('[ai-message] erro:', err.message, '| conversation_id:', conversation_id);
    res.status(500).json({ message: err.message });
  }
});

// ============================================================
// INTEGRATIONS — WHATSAPP (Evolution API proxy)
// ============================================================

// Busca o número de telefone conectado na instância via Evolution API.
// Retorna string limpa (apenas dígitos) ou null se não encontrar.
async function evoFetchPhone(apiUrl, apiKey, instanceName) {
  // Extrai número de qualquer campo — suporta formato JID (55119...@s.whatsapp.net) e puro
  function extractPhone(obj) {
    if (!obj) return null;
    // Campos candidatos em ordem de prioridade (nomes variam por versão da Evolution API)
    const candidates = [
      obj?.instance?.owner, obj?.instance?.number, obj?.instance?.wid,
      obj?.instance?.me?.id, obj?.instance?.phoneNumber,
      obj?.owner, obj?.number, obj?.wid, obj?.me?.id, obj?.phoneNumber,
      obj?.instance?.profilePicUrl, // não é phone, mas descartamos abaixo
    ].filter(v => typeof v === 'string' && /\d{6,}/.test(v));
    for (const raw of candidates) {
      const digits = raw.replace(/@.+/, '').replace(/\D/g, '');
      if (digits.length >= 8) return digits;
    }
    return null;
  }

  // Tenta connectionState primeiro (resposta mais rápida em algumas versões)
  try {
    const r = await evoRequest('GET', apiUrl, apiKey, `/instance/connectionState/${instanceName}`);
    console.log(`[evo-phone] connectionState raw:`, JSON.stringify(r).slice(0, 300));
    const phone = extractPhone(r);
    if (phone) return phone;
  } catch (e) {
    console.warn(`[evo-phone] connectionState falhou:`, e.message);
  }

  // Fallback: fetchInstances (lista todas, acha pelo nome)
  try {
    const list = await evoRequest('GET', apiUrl, apiKey, `/instance/fetchInstances`);
    console.log(`[evo-phone] fetchInstances raw (truncado):`, JSON.stringify(list).slice(0, 500));
    const found = Array.isArray(list)
      ? list.find(i => (i.instance?.instanceName || i.instanceName) === instanceName)
      : list;
    const phone = extractPhone(found);
    if (phone) return phone;
  } catch (e) {
    console.warn(`[evo-phone] fetchInstances falhou:`, e.message);
  }

  return null;
}

async function evoSetWebhook(apiUrl, apiKey, instanceName) {
  const webhookBase = (process.env.WEBHOOK_BASE_URL || '').replace(/\/$/, '');
  if (!webhookBase) {
    throw new Error('WEBHOOK_BASE_URL não está configurado no servidor. Configure esta variável de ambiente com a URL pública do CRM (ex: https://seucrm.vercel.app).');
  }
  const webhookUrl = `${webhookBase}/api/webhook/evolution`;

  // Subsets de eventos em UPPER_SNAKE (confirmado pelo probe).
  // MESSAGE_SENT e MESSAGES_SENT foram removidos pois causam Bad Request em algumas versões.
  // Outbound via phone chega como MESSAGES_UPSERT com fromMe:true (não precisa de SEND_MESSAGE
  // separado para o CRM funcionar).
  const evtFull    = ['MESSAGES_UPSERT', 'SEND_MESSAGE', 'CONNECTION_UPDATE'];
  const evtMinimal = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE']; // confirmado pelo probe → 201

  // Tenta POST (criação) e PUT (atualização) pois algumas versões usam PUT para instâncias
  // que já possuem webhook configurado.
  const attempts = [
    // ✅ POST minimal — confirmado funcionar pelo probe diagnóstico
    { method: 'POST', label: 'POST v2-nested-minimal', path: `/webhook/set/${instanceName}`, body: { webhook: { enabled: true, url: webhookUrl, webhookByEvents: false, webhookBase64: false, events: evtMinimal } } },
    // PUT minimal — para atualizar webhook já existente
    { method: 'PUT',  label: 'PUT v2-nested-minimal',  path: `/webhook/set/${instanceName}`, body: { webhook: { enabled: true, url: webhookUrl, webhookByEvents: false, webhookBase64: false, events: evtMinimal } } },
    // POST com SEND_MESSAGE incluso
    { method: 'POST', label: 'POST v2-nested-full',    path: `/webhook/set/${instanceName}`, body: { webhook: { enabled: true, url: webhookUrl, webhookByEvents: false, webhookBase64: false, events: evtFull } } },
    // PUT com SEND_MESSAGE incluso
    { method: 'PUT',  label: 'PUT v2-nested-full',     path: `/webhook/set/${instanceName}`, body: { webhook: { enabled: true, url: webhookUrl, webhookByEvents: false, webhookBase64: false, events: evtFull } } },
    // v1 flat como fallback
    { method: 'POST', label: 'POST v1-flat-minimal',   path: `/webhook/set/${instanceName}`, body: { enabled: true, url: webhookUrl, webhookByEvents: false, webhookBase64: false, events: evtMinimal } },
    { method: 'PUT',  label: 'PUT v1-flat-minimal',    path: `/webhook/set/${instanceName}`, body: { enabled: true, url: webhookUrl, webhookByEvents: false, webhookBase64: false, events: evtMinimal } },
    // Sem eventos — aceita tudo
    { method: 'POST', label: 'POST v2-noevents',       path: `/webhook/set/${instanceName}`, body: { webhook: { enabled: true, url: webhookUrl } } },
    { method: 'PUT',  label: 'PUT v2-noevents',        path: `/webhook/set/${instanceName}`, body: { webhook: { enabled: true, url: webhookUrl } } },
  ];

  const errors = [];
  for (const { method, label, path, body } of attempts) {
    try {
      await evoRequest(method, apiUrl, apiKey, path, body);
      console.log(`[evo-webhook] OK método="${method}" formato="${label}" instance="${instanceName}" url="${webhookUrl}"`);
      return;
    } catch (e) {
      console.warn(`[evo-webhook] "${label}" falhou: ${e.message}`);
      errors.push(`${label}: ${e.message}`);
    }
  }
  throw new Error(`Nenhum formato suportado. Erros:\n${errors.join('\n')}`);
}

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
  if (!res.ok) {
    // Inclui body bruto no erro para facilitar diagnóstico
    const msg = data.message || data.error || data.reason || (Array.isArray(data.message) ? data.message.join('; ') : null) || text.slice(0, 200) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
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

// Importa uma instância Evolution API já existente (sem criar nova no servidor)
app.post('/api/whatsapp-instances/import', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  const { api_url, api_key, instance_name } = req.body;
  if (!api_url?.trim() || !api_key?.trim() || !instance_name?.trim())
    return res.status(400).json({ message: 'URL, chave da API e nome da instância são obrigatórios.' });

  try {
    const { rows: existing } = await pool.query(
      'SELECT id FROM whatsapp_instances WHERE instance_name = $1', [instance_name.trim()]
    );
    if (existing.length)
      return res.status(409).json({ message: `Instância "${instance_name.trim()}" já está registrada no CRM.` });

    const { rows } = await pool.query(
      `INSERT INTO whatsapp_instances (subaccount_id, instance_name, api_url, api_key, api_provider, status)
       VALUES ($1, $2, $3, $4, 'evolution', 'connecting') RETURNING id, instance_name, status`,
      [subaccount_id, instance_name.trim(), api_url.trim(), api_key.trim()]
    );

    try { await evoSetWebhook(api_url.trim(), api_key.trim(), instance_name.trim()); }
    catch (whErr) { console.warn('[evo webhook import]', whErr.message); }

    let base64 = null, state = null;
    try {
      const qrData = await evoRequest('GET', api_url.trim(), api_key.trim(),
        `/instance/connect/${instance_name.trim()}`);
      base64 = qrData?.qrcode?.base64 || qrData?.base64 || null;
      state  = qrData?.instance?.state || null;
    } catch {}

    console.log(`[evo import] instância "${instance_name.trim()}" importada para subconta="${subaccount_id}"`);
    res.status(201).json({ ...rows[0], base64, state });
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

    try { await evoSetWebhook(api_url.trim(), api_key.trim(), instanceName); }
    catch (whErr) { console.warn('[evo webhook setup]', whErr.message); }

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

// Endpoint interno para forçar resync de todos os webhooks manualmente
app.post('/api/admin/resync-webhooks', auth, requireAdmin, async (req, res) => {
  try {
    const { rows: newInstances } = await pool.query(`SELECT api_url, api_key, instance_name FROM whatsapp_instances`);
    const { rows: legacyInstances } = await pool.query(
      `SELECT evolution_api_url AS api_url, evolution_api_key AS api_key, evolution_instance_name AS instance_name
       FROM subaccount_settings
       WHERE evolution_api_url IS NOT NULL AND evolution_api_key IS NOT NULL AND evolution_instance_name IS NOT NULL`
    );
    const allInstances = [...newInstances, ...legacyInstances];
    const results = await Promise.allSettled(
      allInstances.map(inst => evoSetWebhook(inst.api_url, inst.api_key, inst.instance_name)
        .then(() => ({ instance: inst.instance_name, ok: true }))
        .catch(e  => ({ instance: inst.instance_name, ok: false, error: e.message }))
      )
    );
    res.json({ results: results.map(r => r.value || r.reason) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/whatsapp-instances/:id/sync-webhook', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM whatsapp_instances WHERE id = $1 AND subaccount_id = $2',
      [req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Instância não encontrada.' });
    const inst = rows[0];
    const webhookBase = (process.env.WEBHOOK_BASE_URL || '').replace(/\/$/, '');
    if (!webhookBase) {
      return res.status(500).json({
        message: 'WEBHOOK_BASE_URL não está configurado. Adicione esta variável de ambiente no Vercel com a URL pública do CRM.',
      });
    }
    await evoSetWebhook(inst.api_url, inst.api_key, inst.instance_name);

    // Aproveita e salva o telefone caso ainda não esteja no banco
    if (!inst.phone_number) {
      try {
        const phone = await evoFetchPhone(inst.api_url, inst.api_key, inst.instance_name);
        if (phone) {
          await pool.query(
            `UPDATE whatsapp_instances SET phone_number = $1 WHERE id = $2`,
            ['+' + phone, inst.id]
          );
          console.log(`[sync-webhook] phone salvo: +${phone} instance="${inst.instance_name}"`);
        }
      } catch (e) {
        console.warn(`[sync-webhook] erro ao buscar phone:`, e.message);
      }
    }

    res.json({ ok: true, webhookUrl: `${webhookBase}/api/webhook/evolution`, instance: inst.instance_name });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Diagnóstico completo: testa conectividade, webhook e estado da instância
app.get('/api/whatsapp-instances/:id/diagnostic', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM whatsapp_instances WHERE id = $1 AND subaccount_id = $2',
      [req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Instância não encontrada.' });
    const inst = rows[0];

    const webhookBase = (process.env.WEBHOOK_BASE_URL || '').replace(/\/$/, '');
    const expectedUrl = webhookBase ? `${webhookBase}/api/webhook/evolution` : null;

    // Busca webhook atual — tenta vários paths pois variam por versão
    let currentWebhook = null, webhookFindPath = null, webhookError = null;
    for (const path of [
      `/webhook/find/${inst.instance_name}`,
      `/instance/webhook/${inst.instance_name}`,
      `/webhook/${inst.instance_name}`,
    ]) {
      try {
        currentWebhook = await evoRequest('GET', inst.api_url, inst.api_key, path);
        webhookFindPath = path;
        break;
      } catch (e) {
        webhookError = `${path}: ${e.message}`;
      }
    }

    // Estado de conexão
    let connectionState = null, connectionError = null;
    for (const path of [
      `/instance/connectionState/${inst.instance_name}`,
      `/instance/fetchInstances`,
    ]) {
      try {
        const r = await evoRequest('GET', inst.api_url, inst.api_key, path);
        connectionState = r?.instance?.state || r?.state
          || (Array.isArray(r) ? r.find(i => i.instance?.instanceName === inst.instance_name || i.instanceName === inst.instance_name)?.instance?.state : null)
          || null;
        if (connectionState) break;
      } catch (e) {
        connectionError = e.message;
      }
    }

    // Probe raw: testa combinações de método/path/body e devolve resposta bruta da Evolution API
    const webhookProbe = [];
    if (expectedUrl) {
      const base = inst.api_url.replace(/\/$/, '');
      const apiKey = inst.api_key;
      const testCases = [
        { label: 'POST v2-nested',  method: 'POST', path: `/webhook/set/${inst.instance_name}`, body: { webhook: { enabled: true, url: expectedUrl, webhookByEvents: false, webhookBase64: false, events: ['MESSAGES_UPSERT','CONNECTION_UPDATE'] } } },
        { label: 'POST v1-flat',    method: 'POST', path: `/webhook/set/${inst.instance_name}`, body: { enabled: true, url: expectedUrl, webhookByEvents: false, webhookBase64: false, events: ['MESSAGES_UPSERT','CONNECTION_UPDATE'] } },
        { label: 'POST minimal',    method: 'POST', path: `/webhook/set/${inst.instance_name}`, body: { enabled: true, url: expectedUrl } },
        { label: 'PUT v2-nested',   method: 'PUT',  path: `/webhook/set/${inst.instance_name}`, body: { webhook: { enabled: true, url: expectedUrl, webhookByEvents: false, webhookBase64: false, events: ['MESSAGES_UPSERT','CONNECTION_UPDATE'] } } },
        { label: 'PUT v1-flat',     method: 'PUT',  path: `/webhook/set/${inst.instance_name}`, body: { enabled: true, url: expectedUrl, webhookByEvents: false, webhookBase64: false, events: ['MESSAGES_UPSERT','CONNECTION_UPDATE'] } },
        { label: 'PUT minimal',     method: 'PUT',  path: `/webhook/set/${inst.instance_name}`, body: { enabled: true, url: expectedUrl } },
      ];
      for (const tc of testCases) {
        try {
          const r = await fetch(`${base}${tc.path}`, {
            method: tc.method,
            headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
            body: JSON.stringify(tc.body),
          });
          const txt = await r.text();
          webhookProbe.push({ label: tc.label, status: r.status, body: txt.slice(0, 300) });
          if (r.ok) break; // parar na primeira que funcionar
        } catch (e) {
          webhookProbe.push({ label: tc.label, status: 'network-error', body: e.message });
        }
      }
    }
    const webhookSetResult = webhookProbe.find(p => String(p.status).startsWith('2'))
      ? `OK (${webhookProbe.find(p => String(p.status).startsWith('2')).label})`
      : webhookProbe[0]?.body || 'não testado';

    const configuredUrl  = currentWebhook?.webhook?.url || currentWebhook?.url || null;
    const webhookEnabled = currentWebhook?.webhook?.enabled ?? currentWebhook?.enabled ?? null;

    // Tenta salvar telefone se ainda não está no banco
    let savedPhone = inst.phone_number;
    if (!savedPhone) {
      try {
        const phone = await evoFetchPhone(inst.api_url, inst.api_key, inst.instance_name);
        if (phone) {
          await pool.query(
            `UPDATE whatsapp_instances SET phone_number = $1 WHERE id = $2`,
            ['+' + phone, inst.id]
          );
          savedPhone = '+' + phone;
          console.log(`[diagnostic] phone salvo: +${phone} instance="${inst.instance_name}"`);
        }
      } catch (e) {
        console.warn(`[diagnostic] erro ao buscar phone:`, e.message);
      }
    }

    res.json({
      instance:           inst.instance_name,
      db_status:          inst.status,
      db_phone:           savedPhone,
      env_webhook_base:   webhookBase || '⚠️ NÃO CONFIGURADO',
      env_ok:             !!webhookBase,
      expected_url:       expectedUrl,
      evolution_url:      configuredUrl,
      url_match:          configuredUrl && expectedUrl ? configuredUrl === expectedUrl : false,
      webhook_enabled:    webhookEnabled,
      webhook_find_path:  webhookFindPath,
      webhook_find_error: webhookError,
      webhook_set_test:   webhookSetResult,
      webhook_probe:      webhookProbe,
      connection_state:   connectionState,
      connection_error:   connectionError,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Busca mensagens diretamente na Evolution API (pull) e importa as que faltam no CRM.
// Útil quando o webhook não está configurado ou quando mensagens foram perdidas.
app.post('/api/whatsapp-instances/:id/pull-messages', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  const limit = Math.min(parseInt(req.body?.limit) || 100, 500);

  try {
    const { rows } = await pool.query(
      'SELECT * FROM whatsapp_instances WHERE id = $1 AND subaccount_id = $2',
      [req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Instância não encontrada.' });
    const inst = rows[0];

    // 1. Busca todos os chats na Evolution API
    let chats = [];
    const chatAttempts = [
      `/chat/findChats/${inst.instance_name}`,
      `/instance/fetchChats/${inst.instance_name}`,
    ];
    for (const path of chatAttempts) {
      try {
        const resp = await evoRequest('GET', inst.api_url, inst.api_key, path);
        chats = Array.isArray(resp) ? resp : (resp?.chats || resp?.data || []);
        if (chats.length) break;
      } catch {}
    }
    console.log(`[pull-messages] inst="${inst.instance_name}" chats encontrados: ${chats.length}`);

    let saved = 0, duplicate = 0, skipped = 0, errors = 0;

    // 2. Para cada chat individual, busca as mensagens recentes
    for (const chat of chats) {
      const jid = chat.id || chat.remoteJid;
      if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') { skipped++; continue; }

      let messages = [];
      try {
        // Tenta endpoint v2 (POST com body)
        const resp = await evoRequest('POST', inst.api_url, inst.api_key,
          `/chat/findMessages/${inst.instance_name}`,
          { where: { key: { remoteJid: jid } }, limit }
        );
        messages = resp?.messages || (Array.isArray(resp) ? resp : []);
      } catch {
        try {
          // Fallback v1 (GET com query)
          const q = encodeURIComponent(JSON.stringify({ key: { remoteJid: jid } }));
          const resp = await evoRequest('GET', inst.api_url, inst.api_key,
            `/message/findMessages/${inst.instance_name}?where=${q}&page=1&offset=${limit}`
          );
          messages = resp?.messages || (Array.isArray(resp) ? resp : []);
        } catch (e2) {
          console.warn(`[pull-messages] findMessages falhou para ${jid}:`, e2.message);
          errors++;
          continue;
        }
      }

      for (const msg of messages) {
        try {
          const status = await processWaMsg(subaccount_id, inst.instance_name, inst.api_url, inst.api_key, msg);
          if (status === 'saved') saved++;
          else if (status === 'duplicate') duplicate++;
          else skipped++;
        } catch (e) {
          console.warn(`[pull-messages] processWaMsg erro:`, e.message);
          errors++;
        }
      }
    }

    console.log(`[pull-messages] inst="${inst.instance_name}" saved=${saved} dup=${duplicate} skip=${skipped} err=${errors}`);
    res.json({ ok: true, saved, duplicate, skipped, errors });
  } catch (err) {
    console.error('[pull-messages] ERRO:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ============================================================
// AGENT WEBHOOKS
// ============================================================

app.get('/api/agent-webhooks', auth, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM agent_webhooks WHERE subaccount_id = $1 ORDER BY created_at DESC`,
      [subaccount_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[agent-webhooks GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/agent-webhooks/toggle-all', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  const { is_active } = req.body;
  if (typeof is_active !== 'boolean') return res.status(400).json({ message: 'is_active deve ser boolean.' });
  try {
    await pool.query(
      `UPDATE agent_webhooks SET is_active = $1 WHERE subaccount_id = $2`,
      [is_active, subaccount_id]
    );
    res.json({ ok: true, is_active });
  } catch (err) {
    console.error('[agent-webhooks toggle-all]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/agent-webhooks', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  const { name, url, events } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: 'Nome é obrigatório.' });
  if (!url?.trim())  return res.status(400).json({ message: 'URL é obrigatória.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO agent_webhooks (subaccount_id, name, url, events)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [subaccount_id, name.trim(), url.trim(), JSON.stringify(events || [])]
    );
    _invalidateWhCache(subaccount_id);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[agent-webhooks POST]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.put('/api/agent-webhooks/:id', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  const { name, url, events, is_active } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE agent_webhooks SET
         name      = COALESCE($1, name),
         url       = COALESCE($2, url),
         events    = COALESCE($3, events),
         is_active = COALESCE($4, is_active),
         updated_at = NOW()
       WHERE id = $5 AND subaccount_id = $6 RETURNING *`,
      [name?.trim()||null, url?.trim()||null,
       events ? JSON.stringify(events) : null,
       is_active ?? null,
       req.params.id, subaccount_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Webhook não encontrado.' });
    _invalidateWhCache(subaccount_id);
    res.json(rows[0]);
  } catch (err) {
    console.error('[agent-webhooks PUT]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.delete('/api/agent-webhooks/:id', auth, requireAdmin, async (req, res) => {
  const { subaccount_id } = req.user;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM agent_webhooks WHERE id = $1 AND subaccount_id = $2`,
      [req.params.id, subaccount_id]
    );
    if (!rowCount) return res.status(404).json({ message: 'Webhook não encontrado.' });
    _invalidateWhCache(subaccount_id);
    res.status(204).send();
  } catch (err) {
    console.error('[agent-webhooks DELETE]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// ============================================================
// NOTIFICAÇÕES
// ============================================================

app.get('/api/notifications', auth, async (req, res) => {
  const { sub: user_id } = req.user;
  try {
    const { rows } = await pool.query(
      `SELECT id, type, title, body, entity_type, entity_id, created_at
       FROM notifications WHERE user_id = $1 AND is_read = FALSE
       ORDER BY created_at DESC LIMIT 50`,
      [user_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[notifications GET]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/notifications/read-all', auth, async (req, res) => {
  const { sub: user_id } = req.user;
  try {
    await pool.query(`UPDATE notifications SET is_read = TRUE WHERE user_id = $1`, [user_id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[notifications read-all]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

app.post('/api/notifications/:id/read', auth, async (req, res) => {
  const { sub: user_id } = req.user;
  try {
    await pool.query(
      `UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2`,
      [req.params.id, user_id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[notifications read]', err.message);
    res.status(500).json({ message: 'Erro interno.' });
  }
});

// Cache em memória para URLs de webhook por subconta — evita query no banco a cada mensagem
const _whCache = new Map(); // subaccount_id → { rows: [{url,events}], expiry }
const WH_CACHE_TTL = 30_000; // 30 segundos

function _invalidateWhCache(subaccount_id) {
  _whCache.delete(subaccount_id);
}

async function _getWebhookRows(subaccount_id) {
  const now    = Date.now();
  const cached = _whCache.get(subaccount_id);
  if (cached && cached.expiry > now) return cached.rows;

  const { rows } = await pool.query(
    `SELECT url, events FROM agent_webhooks WHERE subaccount_id = $1 AND is_active = TRUE`,
    [subaccount_id]
  );
  _whCache.set(subaccount_id, { rows, expiry: now + WH_CACHE_TTL });
  return rows;
}

async function fireAgentWebhooks(subaccount_id, event, payload) {
  try {
    const rows = await _getWebhookRows(subaccount_id);
    const targets = rows.filter(wh => Array.isArray(wh.events) && wh.events.includes(event));
    if (!targets.length) return;

    const body = JSON.stringify({ event, timestamp: new Date().toISOString(), ...payload });

    // Promise.allSettled garante que TODOS os fetch completam (ou atingem timeout)
    // antes de retornar — essencial em ambientes serverless onde o processo pode
    // ser pausado logo após enviar a resposta HTTP. Por isso é CRÍTICO que quem
    // chama fireAgentWebhooks sempre dê await nela.
    //
    // A função inteira (processWaMsg + isso) tem maxDuration=30s no vercel.json.
    // Uma única tentativa de 20s deixa ~10s de folga para o resto do trabalho
    // (queries, etc.) antes que a Vercel mate a execução — um retry aqui só
    // aumentaria o risco de ser interrompido pela própria plataforma no meio.
    await Promise.allSettled(targets.map(async (wh) => {
      const ac    = new AbortController();
      const timer = setTimeout(() => ac.abort(), 20000);
      try {
        await fetch(wh.url, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal:  ac.signal,
        });
      } catch (e) {
        console.warn(`[agent-webhook fire] ${wh.url}:`, e.message);
      } finally {
        clearTimeout(timer);
      }
    }));
  } catch (err) {
    console.error('[agent-webhook fire]', err.message);
  }
}

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
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(20) NOT NULL DEFAULT 'text'`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_data TEXT`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_external_id ON messages(conversation_id, external_id) WHERE external_id IS NOT NULL`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversation_followers (
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (conversation_id, user_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_conv_followers_conv ON conversation_followers(conversation_id)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subaccount_id UUID NOT NULL,
        user_id       UUID NOT NULL,
        type          VARCHAR(50) NOT NULL DEFAULT 'mention',
        title         VARCHAR(200),
        body          TEXT,
        entity_type   VARCHAR(50) DEFAULT 'conversation',
        entity_id     UUID,
        is_read       BOOLEAN NOT NULL DEFAULT FALSE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_webhooks (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subaccount_id UUID NOT NULL,
        name          VARCHAR(150) NOT NULL,
        url           TEXT NOT NULL,
        events        JSONB NOT NULL DEFAULT '[]',
        is_active     BOOLEAN NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
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

// Re-sincroniza webhooks de todas as instâncias na inicialização
// Garante que SEND_MESSAGE/MESSAGE_SENT fiquem sempre configurados,
// incluindo instâncias conectadas antes deste deploy.
async function resyncAllWebhooks() {
  try {
    const { rows: newInstances } = await pool.query(
      `SELECT api_url, api_key, instance_name FROM whatsapp_instances`
    );
    // Inclui também instâncias configuradas via subaccount_settings (config legada)
    const { rows: legacyInstances } = await pool.query(
      `SELECT evolution_api_url AS api_url, evolution_api_key AS api_key, evolution_instance_name AS instance_name
       FROM subaccount_settings
       WHERE evolution_api_url IS NOT NULL AND evolution_api_key IS NOT NULL AND evolution_instance_name IS NOT NULL`
    );
    const allInstances = [...newInstances, ...legacyInstances];
    console.log(`[webhook resync] sincronizando ${newInstances.length} instâncias principais + ${legacyInstances.length} legadas`);
    await Promise.allSettled(allInstances.map(inst =>
      evoSetWebhook(inst.api_url, inst.api_key, inst.instance_name)
        .then(() => console.log(`[webhook resync] OK: ${inst.instance_name}`))
        .catch(e  => console.warn(`[webhook resync] ${inst.instance_name}:`, e.message))
    ));
  } catch (e) {
    console.warn('[webhook resync] erro geral:', e.message);
  }
}

if (require.main === module) {
  app.listen(PORT, () => console.log(`[FAVX CRM API] Rodando em http://localhost:${PORT}`));
}

// Roda em qualquer ambiente (servidor tradicional OU Vercel serverless).
// No Vercel, require.main !== module, então o bloco acima é ignorado,
// mas este IIFE executa na carga do módulo (cold start).
let _resyncDone = false;
(async () => {
  if (_resyncDone) return;
  _resyncDone = true;
  // Pequeno delay para dar tempo à pool de conectar
  await new Promise(r => setTimeout(r, 1500));
  resyncAllWebhooks();
})();

// A Vercel consome o app como export padrão do módulo. As funções abaixo
// ficam penduradas nele apenas para permitir teste direto, sem trocar o
// formato do export (trocá-lo quebraria o deploy).
app.generateAiReply = generateAiReply;
app.aiCostUsd       = aiCostUsd;
app.defaultAgentPrompt = defaultAgentPrompt;
app.ensureSubaccountAgent = ensureSubaccountAgent;

module.exports = app;
