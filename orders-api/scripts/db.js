'use strict';

require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const mysql = require('mysql2/promise');

const ACTION_TO_FILE = {
  migrate: path.resolve(__dirname, '../../db/schema.sql'),
  seed: path.resolve(__dirname, '../../db/seed.sql'),
};

async function run() {
  const action = process.argv[2];
  const sqlFile = ACTION_TO_FILE[action];

  if (!sqlFile) {
    throw new Error('Uso: node scripts/db.js <migrate|seed>');
  }

  const sql = await fs.readFile(sqlFile, 'utf8');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    multipleStatements: true,
  });

  try {
    await connection.query(sql);
    console.log(`[db] ${action} ejecutado correctamente`);
  } finally {
    await connection.end();
  }
}

run().catch((err) => {
  console.error(`[db] ${err.message}`);
  process.exitCode = 1;
});
