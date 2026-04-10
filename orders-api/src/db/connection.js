'use strict';

/**
 * orders-api/src/db/connection.js
 *
 * Crea y reutiliza el pool MySQL del servicio de órdenes.
 * El pool se comparte entre el bootstrap HTTP y los controladores que leen
 * productos, órdenes y order_items.
 */

const mysql = require('mysql2/promise');

let pool = null;

function getPool() {
  if (pool) return pool;

  pool = mysql.createPool({
    host:               process.env.DB_HOST || '127.0.0.1',
    port:               Number(process.env.DB_PORT) || 3306,
    database:           process.env.DB_NAME,
    user:               process.env.DB_USER,
    password:           process.env.DB_PASS || '',
    waitForConnections: true,
    connectionLimit:    10,
    queueLimit:         0,
    timezone:           'Z',
    typeCast(field, next) {
      if (field.type === 'DATETIME' || field.type === 'TIMESTAMP')
        return field.string() ? new Date(field.string() + 'Z') : null;
      return next();
    },
  });

  return pool;
}

module.exports = { getPool };
