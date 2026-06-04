// ======================================
// FAVX CRM — Conexão PostgreSQL
// ======================================

const { Pool } = require('pg');
require('dotenv').config();

const isSSL = process.env.DATABASE_URL?.includes('sslmode=require') ||
              process.env.DATABASE_URL?.includes('neon.tech') ||
              process.env.DATABASE_URL?.includes('supabase') ||
              process.env.DATABASE_URL?.includes('railway') ||
              process.env.DB_SSL === 'true';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isSSL ? { rejectUnauthorized: false } : false,
  max: 1,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 8000,
  allowExitOnIdle: true,
});

pool.on('error', (err) => {
  console.error('[DB] Erro inesperado no pool:', err.message);
});

module.exports = pool;
