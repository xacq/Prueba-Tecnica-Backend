'use strict';

/**
 * handler.js — Lambda orquestador: create-and-confirm-order
 *
 * Flujo completo con idempotencia end-to-end:
 *
 *  ┌─────────────────────────────────────────────────────────┐
 *  │  Recibe request                                          │
 *  │  ↓                                                       │
 *  │  checkIdempotencyKey                                     │
 *  │    'success' / 'failed' → devuelve respuesta almacenada  │
 *  │    'pending'            → 409 Conflict                   │
 *  │    'miss'               → continúa                       │
 *  │  ↓                                                       │
 *  │  initIdempotencyKey (INSERT IGNORE → marca 'pending')    │
 *  │  ↓                                                       │
 *  │  getCustomerInternal  → valida que el cliente exista     │
 *  │  createOrder          → crea la orden en CREATED         │
 *  │  confirmOrder         → pasa la orden a CONFIRMED        │
 *  │  ↓                                                       │
 *  │  saveIdempotencyKey('success', response)                  │
 *  │  ↓                                                       │
 *  │  Devuelve 201 con JSON consolidado                        │
 *  └─────────────────────────────────────────────────────────┘
 *
 *  Si cualquier paso falla con un error de negocio (cliente no existe,
 *  stock insuficiente) → markIdempotencyKeyFailed → 4xx
 *
 *  Si falla con un error de infraestructura (timeout, 5xx) → no guarda
 *  la key como 'failed' para permitir el reintento.
 */

const {
  checkIdempotencyKey,
  initIdempotencyKey,
  saveIdempotencyKey,
  markIdempotencyKeyFailed,
  purgeExpiredKeys,
} = require('./db/idempotency');

const {
  getCustomerInternal,
  createOrder,
  confirmOrder,
  ApiError,
} = require('./apiClient');

// ─────────────────────────────────────────────────────────────────
// Validación del body de entrada (sin dependencias externas)
// ─────────────────────────────────────────────────────────────────

function validateBody(body) {
  const errors = [];

  if (!body.customer_id || typeof body.customer_id !== 'number')
    errors.push('customer_id debe ser un número entero positivo');

  if (!Array.isArray(body.items) || body.items.length === 0)
    errors.push('items debe ser un array no vacío');
  else {
    body.items.forEach((item, i) => {
      if (!item.product_id || typeof item.product_id !== 'number')
        errors.push(`items[${i}].product_id inválido`);
      if (!item.qty || typeof item.qty !== 'number' || item.qty < 1)
        errors.push(`items[${i}].qty debe ser >= 1`);
    });
  }

  if (!body.idempotency_key || typeof body.idempotency_key !== 'string')
    errors.push('idempotency_key es requerido y debe ser string');
  else if (body.idempotency_key.length > 255)
    errors.push('idempotency_key no puede superar 255 caracteres');

  return errors;
}

// ─────────────────────────────────────────────────────────────────
// Builders de respuesta HTTP (formato API Gateway)
// ─────────────────────────────────────────────────────────────────

function response(statusCode, body, extra = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type':  'application/json',
      'Cache-Control': 'no-store',
      ...extra,
    },
    body: JSON.stringify(body),
  };
}

function ok(data, correlationId) {
  return response(201, {
    success:       true,
    correlationId: correlationId || undefined,
    data,
  });
}

function conflict(correlationId) {
  return response(409, {
    success:       false,
    correlationId: correlationId || undefined,
    error:         'Request already in progress. Retry in a few seconds.',
  });
}

function clientError(errors, correlationId) {
  return response(400, {
    success:       false,
    correlationId: correlationId || undefined,
    error:         'Validation failed',
    details:       errors,
  });
}

function upstreamError(err, correlationId) {
  // Errores de negocio de las APIs downstream (4xx) los propagamos al cliente
  const isBusiness = err instanceof ApiError && err.status >= 400 && err.status < 500;
  const statusCode = isBusiness ? err.status : 502;

  return response(statusCode, {
    success:       false,
    correlationId: correlationId || undefined,
    error:         err.message,
    ...(err.body ? { upstream: err.body } : {}),
  });
}

// ─────────────────────────────────────────────────────────────────
// Determina si un error merece guardar la key como 'failed'
// (no reintentar) o si debe quedar como 'miss' para reintentos
// ─────────────────────────────────────────────────────────────────

function isBusinessError(err) {
  if (!(err instanceof ApiError)) return false;
  // 4xx = error de negocio (cliente no existe, stock insuficiente, etc.)
  // 5xx / timeout = error de infraestructura → no marcar como failed
  return err.status >= 400 && err.status < 500;
}

// ─────────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  // Parsear body (API Gateway lo envía como string)
  let body;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch {
    return response(400, { success: false, error: 'Body JSON inválido' });
  }

  const correlationId = body.correlation_id || event.requestContext?.requestId || null;

  // Log de entrada para trazabilidad en CloudWatch
  console.log(JSON.stringify({
    type:           'orchestrator_start',
    correlationId,
    customer_id:    body.customer_id,
    items_count:    Array.isArray(body.items) ? body.items.length : 0,
    idempotency_key: body.idempotency_key,
  }));

  // ── 1. Validar entrada ───────────────────────────────────────
  const errors = validateBody(body);
  if (errors.length > 0) return clientError(errors, correlationId);

  const { customer_id, items, idempotency_key } = body;

  // ── 2. Verificar idempotencia ────────────────────────────────
  const cached = await checkIdempotencyKey(idempotency_key);

  if (cached.status === 'success') {
    console.log(JSON.stringify({ type: 'idempotency_hit', correlationId, key: idempotency_key }));
    // Devolver exactamente el mismo response que la primera vez
    return response(cached.httpStatus, cached.data, { 'X-Idempotent-Replay': 'true' });
  }

  if (cached.status === 'failed') {
    console.log(JSON.stringify({ type: 'idempotency_failed_hit', correlationId, key: idempotency_key }));
    return response(cached.httpStatus, cached.data, { 'X-Idempotent-Replay': 'true' });
  }

  if (cached.status === 'pending') {
    console.log(JSON.stringify({ type: 'idempotency_conflict', correlationId, key: idempotency_key }));
    return conflict(correlationId);
  }

  // ── 3. Reservar el key en 'pending' ──────────────────────────
  const won = await initIdempotencyKey(idempotency_key);
  if (!won) {
    // Otra invocación ganó la carrera en el instante entre check e init
    return conflict(correlationId);
  }

  // ── 4. Flujo de negocio ───────────────────────────────────────
  try {

    // 4a. Validar que el cliente existe
    const customerData = await getCustomerInternal(customer_id, correlationId);
    const customer     = customerData.data ?? customerData; // normalizar wrapper

    // 4b. Crear la orden (CREATED) — idempotente gracias al key
    const orderCreated = await createOrder({
      customerId:      customer_id,
      items,
      idempotencyKey:  idempotency_key,
      correlationId,
    });
    const order = orderCreated.data ?? orderCreated;

    // 4c. Confirmar la orden (CONFIRMED)
    const orderConfirmed = await confirmOrder({
      orderId:         order.id,
      idempotencyKey:  idempotency_key,
      correlationId,
    });
    const confirmedOrder = orderConfirmed.data ?? orderConfirmed;

    // ── 5. Construir respuesta consolidada ────────────────────────
    const payload = {
      customer: {
        id:    customer.id,
        name:  customer.name,
        email: customer.email,
        phone: customer.phone,
      },
      order: {
        id:          confirmedOrder.id,
        status:      confirmedOrder.status,
        total_cents: confirmedOrder.total_cents,
        items:       confirmedOrder.items ?? items,
        created_at:  confirmedOrder.created_at,
      },
    };

    const successResponse = ok(payload, correlationId);

    // ── 6. Guardar resultado exitoso ──────────────────────────────
    await saveIdempotencyKey(idempotency_key, {
      status:       'success',
      responseBody: JSON.parse(successResponse.body),
      httpStatus:   201,
      targetType:   'order',
      targetId:     confirmedOrder.id,
    });

    // Limpieza oportunista de keys expiradas (~1% de las veces)
    // para no necesitar un Lambda de mantenimiento dedicado
    if (Math.random() < 0.01) {
      purgeExpiredKeys().catch(err =>
        console.warn('[idempotency] purge error (non-critical):', err.message)
      );
    }

    console.log(JSON.stringify({
      type:           'orchestrator_success',
      correlationId,
      order_id:       confirmedOrder.id,
      idempotency_key,
    }));

    return successResponse;

  } catch (err) {

    console.error(JSON.stringify({
      type:           'orchestrator_error',
      correlationId,
      idempotency_key,
      error:          err.message,
      stack:          err.stack,
    }));

    const errResponse = upstreamError(err, correlationId);

    // Solo marcar como 'failed' si es un error de negocio determinista
    // (no queremos bloquear reintentos ante fallos de infraestructura)
    if (isBusinessError(err)) {
      await markIdempotencyKeyFailed(
        idempotency_key,
        err,
        errResponse.statusCode
      );
    } else {
      // Infraestructura: borrar el 'pending' para que el reintento pueda correr
      await _releasePendingKey(idempotency_key);
    }

    return errResponse;
  }
};

// Libera la reserva 'pending' cuando hay error de infraestructura
async function _releasePendingKey(key) {
  const { getPool } = require('./db/connection');
  try {
    await getPool().execute(
      `DELETE FROM idempotency_keys WHERE \`key\` = ? AND status = 'pending'`,
      [key]
    );
  } catch (e) {
    console.error('[idempotency] Error liberando pending key:', e.message);
  }
}
