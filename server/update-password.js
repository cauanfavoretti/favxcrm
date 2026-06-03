require('dotenv').config();

const bcrypt = require('bcryptjs');
const pool   = require('./db');

const EMAIL    = 'admin@favx.com.br';
const PASSWORD = 'FAVXAdmin@2026!';

async function run() {
  try {
    const hash = await bcrypt.hash(PASSWORD, 12);
    const { rowCount } = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE email = $2',
      [hash, EMAIL]
    );
    if (rowCount) {
      console.log(`[ok] Senha atualizada para ${EMAIL}`);
    } else {
      console.log('[erro] Usuário não encontrado.');
    }
  } catch (err) {
    console.error('[erro]', err.message);
  } finally {
    await pool.end();
  }
}

run();
