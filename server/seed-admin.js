// ======================================
// FAVX CRM — Cria usuário admin inicial
// Uso: node seed-admin.js
// ======================================

require('dotenv').config();

const bcrypt = require('bcrypt');
const pool   = require('./db');

const ADMIN_NAME     = 'Admin FAVX';
const ADMIN_EMAIL    = 'admin@favx.com.br';
const ADMIN_PASSWORD = 'FAVXAdmin@2026!';  
async function seed() {
  try {
    // 1. Conta-mãe
    const { rows: accountRows } = await pool.query(
      `INSERT INTO accounts (name, slug, plan)
       VALUES ('FAVX', 'favx', 'enterprise')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    const accountId = accountRows[0].id;
    console.log(`[seed] Account ID: ${accountId}`);

    // 2. Subconta padrão
    const { rows: subRows } = await pool.query(
      `INSERT INTO subaccounts (account_id, name, slug)
       VALUES ($1, 'Principal', 'principal')
       ON CONFLICT (account_id, slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [accountId]
    );
    const subaccountId = subRows[0].id;
    console.log(`[seed] Subaccount ID: ${subaccountId}`);

    // 3. Verifica se admin já existe
    const { rows: existing } = await pool.query(
      `SELECT id FROM users WHERE email = $1`,
      [ADMIN_EMAIL]
    );
    if (existing.length > 0) {
      console.log('[seed] Usuário admin já existe. Abortando.');
      process.exit(0);
    }

    // 4. Cria admin
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    const { rows: userRows } = await pool.query(
      `INSERT INTO users (account_id, subaccount_id, name, email, password_hash, role, email_verified)
       VALUES ($1, $2, $3, $4, $5, 'super_admin', TRUE)
       RETURNING id`,
      [accountId, subaccountId, ADMIN_NAME, ADMIN_EMAIL, hash]
    );

    console.log(`[seed] Admin criado com sucesso!`);
    console.log(`  ID:    ${userRows[0].id}`);
    console.log(`  Email: ${ADMIN_EMAIL}`);
    console.log(`  Senha: ${ADMIN_PASSWORD}`);
    console.log('\n  IMPORTANTE: Troque a senha após o primeiro login!');

  } catch (err) {
    console.error('[seed] Erro:', err.message);
  } finally {
    await pool.end();
  }
}

seed();
