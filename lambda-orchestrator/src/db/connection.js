'use strict';

const mysql = require('mysql2/promise');

let pool = null;

/**
 * Retorna el pool de conexiones, creándolo si no existe.
 * Lambda reutiliza el contexto de ejecución entre invocaciones
 * en caliente, por eso guardamos el pool en módulo-scope.
 */
function getPool() {
  if (pool) return pool;

  pool = mysql.createPool({
    host:               process.env.DB_HOST,
    port:               Number(process.env.DB_PORT) || 3306,
    database:           process.env.DB_NAME,
    user:               process.env.DB_USER,
    password:           process.env.DB_PASS,
    waitForConnections: true,
    connectionLimit:    5,       // Lambda no necesita más de 5 conexiones
    queueLimit:         0,
    timezone:           'Z',     // UTC estricto en todas las fechas
    typeCast(field, next) {
      // Convertir DATETIME a objetos Date de JS automáticamente
      if (field.type === 'DATETIME') return new Date(field.string() + 'Z');
      return next();
    },
  });

  return pool;
}

module.exports = { getPool };
