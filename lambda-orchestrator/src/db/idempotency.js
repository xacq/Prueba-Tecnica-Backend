'use strict';

/**
 * idempotency.js
 *
 * Maneja la tabla idempotency_keys para que el Lambda orquestador
 * sea seguro ante reintentos. Cubre tres escenarios:
 *
 *  1. Key nueva          → no existe nada, continúa el flujo normal.
 *  2. Key en vuelo       → otra invocación está procesando el mismo key
 *                          (estado 'pending'), devuelve 409 Conflict para
 *                          evitar ejecuciones paralelas del mismo pedido.
 *  3. Key ya resuelta    → estado 'success' o 'failed', devuelve el
 *                          resultado almacenado sin re-ejecutar nada.
 */

const { getPool } = require('./connection');

// TTL de las keys: 24 horas en milisegundos
const TTL_MS = 24 * 60 * 60 * 1000;

// Tiempo máximo que una key puede estar en estado 'pending'
// antes de considerarla huérfana (Lambda timeout máximo = 15 min)
const PENDING_STALE_MS = 20 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────
// TIPOS DE RESULTADO
// ─────────────────────────────────────────────────────────────────

/**
 * @typedef {'miss' | 'pending' | 'success' | 'failed'} IdempotencyStatus
 *
 * @typedef {Object} IdempotencyResult
 * @property {IdempotencyStatus} status
 * @property {Object|null}       data          - Payload almacenado (success/failed)
 * @property {number|null}       httpStatus    - HTTP status code almacenado
 * @property {string|null}       targetType    - Tipo de recurso creado
 * @property {number|null}       targetId      - ID del recurso creado
 */

// ─────────────────────────────────────────────────────────────────
// checkIdempotencyKey
// ─────────────────────────────────────────────────────────────────

/**
 * Busca si el idempotency_key ya fue procesado.
 *
 * Flujo:
 *   - Si no existe o está expirada → {status: 'miss'}
 *   - Si existe en 'pending' y no está huérfana → {status: 'pending'}
 *   - Si existe en 'pending' pero está huérfana → la resetea a 'miss'
 *     para que el reintento pueda continuar
 *   - Si existe en 'success' o 'failed' → {status, data, httpStatus}
 *
 * @param {string} key  - El idempotency_key enviado por el cliente
 * @returns {Promise<IdempotencyResult>}
 */
async function checkIdempotencyKey(key) {
  const pool = getPool();

  const [rows] = await pool.execute(
    `SELECT
       \`key\`,
       status,
       target_type,
       target_id,
       http_status,
       response_body,
       created_at,
       expires_at
     FROM idempotency_keys
     WHERE \`key\` = ?
       AND expires_at > NOW()
     LIMIT 1`,
    [key]
  );

  if (rows.length === 0) {
    return { status: 'miss', data: null, httpStatus: null, targetType: null, targetId: null };
  }

  const row = rows[0];

  // Key en estado 'pending': otra invocación está procesando este pedido
  if (row.status === 'pending') {
    const ageMs = Date.now() - new Date(row.created_at).getTime();

    // Si lleva más tiempo del timeout de Lambda, está huérfana: reiniciar
    if (ageMs > PENDING_STALE_MS) {
      await _deleteStalePendingKey(key);
      return { status: 'miss', data: null, httpStatus: null, targetType: null, targetId: null };
    }

    return { status: 'pending', data: null, httpStatus: 409, targetType: null, targetId: null };
  }

  // Key resuelta (success o failed): devolver resultado almacenado
  return {
    status:     row.status,
    data:       typeof row.response_body === 'string'
                  ? JSON.parse(row.response_body)
                  : row.response_body,
    httpStatus: row.http_status,
    targetType: row.target_type,
    targetId:   row.target_id,
  };
}

// ─────────────────────────────────────────────────────────────────
// initIdempotencyKey
// ─────────────────────────────────────────────────────────────────

/**
 * Reserva el key en estado 'pending' ANTES de comenzar el flujo.
 * Usa INSERT IGNORE para que si dos invocaciones llegan simultáneamente,
 * solo una gane la carrera.
 *
 * Devuelve true si ganó la carrera (insertó el registro),
 * false si otra invocación ya lo insertó primero.
 *
 * @param {string} key
 * @returns {Promise<boolean>}
 */
async function initIdempotencyKey(key) {
  const pool = getPool();
  const expiresAt = new Date(Date.now() + TTL_MS);

  const [result] = await pool.execute(
    `INSERT IGNORE INTO idempotency_keys
       (\`key\`, status, created_at, expires_at)
     VALUES
       (?, 'pending', NOW(), ?)`,
    [key, expiresAt]
  );

  // affectedRows = 1 → insertó (ganó la carrera)
  // affectedRows = 0 → ya existía (perdió la carrera)
  return result.affectedRows === 1;
}

// ─────────────────────────────────────────────────────────────────
// saveIdempotencyKey
// ─────────────────────────────────────────────────────────────────

/**
 * Actualiza el key al estado final con el resultado del flujo.
 * Se llama tanto en el camino feliz (success) como en errores
 * de negocio que no deben reintentarse (failed).
 *
 * @param {string}  key
 * @param {Object}  opts
 * @param {'success'|'failed'} opts.status
 * @param {Object}  opts.responseBody  - Objeto que se devolverá en futuros reintentos
 * @param {number}  opts.httpStatus    - Código HTTP asociado (201, 400, 422, etc.)
 * @param {string}  [opts.targetType]  - 'order', 'customer', etc.
 * @param {number}  [opts.targetId]    - ID del recurso creado/afectado
 * @returns {Promise<void>}
 */
async function saveIdempotencyKey(key, {
  status,
  responseBody,
  httpStatus,
  targetType = null,
  targetId   = null,
}) {
  const pool = getPool();

  await pool.execute(
    `UPDATE idempotency_keys
     SET
       status        = ?,
       response_body = ?,
       http_status   = ?,
       target_type   = ?,
       target_id     = ?
     WHERE \`key\` = ?`,
    [
      status,
      JSON.stringify(responseBody),
      httpStatus,
      targetType,
      targetId,
      key,
    ]
  );
}

// ─────────────────────────────────────────────────────────────────
// markIdempotencyKeyFailed
// ─────────────────────────────────────────────────────────────────

/**
 * Versión corta para marcar un key como fallido con un error.
 * Útil en el catch del handler para no dejar keys huérfanos en 'pending'.
 *
 * @param {string} key
 * @param {Error}  error
 * @param {number} [httpStatus=500]
 */
async function markIdempotencyKeyFailed(key, error, httpStatus = 500) {
  try {
    await saveIdempotencyKey(key, {
      status:       'failed',
      responseBody: { success: false, error: error.message },
      httpStatus,
      targetType:   null,
      targetId:     null,
    });
  } catch (dbErr) {
    // No propagar: ya estamos en un catch, no queremos enmascarar el error original
    console.error('[idempotency] Error al marcar key como failed:', dbErr.message);
  }
}

// ─────────────────────────────────────────────────────────────────
// purgeExpiredKeys  (mantenimiento opcional)
// ─────────────────────────────────────────────────────────────────

/**
 * Elimina keys expiradas de la tabla.
 * Puede llamarse al inicio del handler o en un Lambda de limpieza aparte.
 * Limita a 500 filas por ejecución para no bloquear la tabla.
 *
 * @returns {Promise<number>} - Cantidad de filas eliminadas
 */
async function purgeExpiredKeys() {
  const pool = getPool();
  const [result] = await pool.execute(
    `DELETE FROM idempotency_keys
     WHERE expires_at <= NOW()
     LIMIT 500`
  );
  return result.affectedRows;
}

// ─────────────────────────────────────────────────────────────────
// Helper interno
// ─────────────────────────────────────────────────────────────────

async function _deleteStalePendingKey(key) {
  const pool = getPool();
  await pool.execute(
    `DELETE FROM idempotency_keys WHERE \`key\` = ? AND status = 'pending'`,
    [key]
  );
}

module.exports = {
  checkIdempotencyKey,
  initIdempotencyKey,
  saveIdempotencyKey,
  markIdempotencyKeyFailed,
  purgeExpiredKeys,
};
