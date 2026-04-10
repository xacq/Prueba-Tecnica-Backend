'use strict';

/**
 * apiClient.js
 *
 * Wrapper sobre fetch nativo (Node 22 lo incluye) para las llamadas
 * a Customers API y Orders API desde el Lambda orquestador.
 *
 * Características:
 *  - Timeout configurable por llamada (default 8s)
 *  - Parsing automático de respuestas JSON
 *  - Errores HTTP convertidos a excepciones tipadas con el status code
 *  - Logs de correlación para trazabilidad en CloudWatch
 */

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name      = 'ApiError';
    this.status    = status;
    this.body      = body;
  }
}

/**
 * Hace un fetch con timeout y manejo de errores HTTP unificado.
 *
 * @param {string} url
 * @param {RequestInit} options
 * @param {number}      timeoutMs
 * @param {string}      correlationId - Para logs en CloudWatch
 */
async function request(url, options = {}, timeoutMs = 8000, correlationId = '-') {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);

  const start = Date.now();

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const elapsed = Date.now() - start;
    const body    = await res.json().catch(() => ({}));

    console.log(JSON.stringify({
      type:          'upstream_call',
      correlationId,
      url,
      method:        options.method || 'GET',
      status:        res.status,
      elapsed_ms:    elapsed,
    }));

    if (!res.ok) {
      throw new ApiError(
        body?.error || `HTTP ${res.status} from ${url}`,
        res.status,
        body
      );
    }

    return body;

  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError(`Timeout after ${timeoutMs}ms calling ${url}`, 504, null);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────
// CUSTOMERS API
// ─────────────────────────────────────────────────────────────────

/**
 * Llama a GET /internal/customers/:id con SERVICE_TOKEN.
 * Este endpoint está pensado para comunicación entre servicios.
 */
async function getCustomerInternal(customerId, correlationId) {
  const url = `${process.env.CUSTOMERS_API_BASE}/internal/customers/${customerId}`;
  return request(
    url,
    {
      method:  'GET',
      headers: { Authorization: `Bearer ${process.env.SERVICE_TOKEN}` },
    },
    8000,
    correlationId
  );
}

// ─────────────────────────────────────────────────────────────────
// ORDERS API
// ─────────────────────────────────────────────────────────────────

/**
 * Llama a POST /orders.
 * Pasa el idempotency_key para que Orders API también sea idempotente
 * en la creación (resuelve la trampa crítica #1 del requerimiento).
 */
async function createOrder({ customerId, items, idempotencyKey, correlationId }) {
  const url = `${process.env.ORDERS_API_BASE}/orders`;
  return request(
    url,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${process.env.SERVICE_TOKEN}` },
      body:    JSON.stringify({
        customer_id:     customerId,
        items,
        idempotency_key: idempotencyKey,   // clave para idempotencia en Orders API
      }),
    },
    10000,
    correlationId
  );
}

/**
 * Llama a POST /orders/:id/confirm con X-Idempotency-Key.
 */
async function confirmOrder({ orderId, idempotencyKey, correlationId }) {
  const url = `${process.env.ORDERS_API_BASE}/orders/${orderId}/confirm`;
  return request(
    url,
    {
      method:  'POST',
      headers: {
        Authorization:       `Bearer ${process.env.SERVICE_TOKEN}`,
        'X-Idempotency-Key': idempotencyKey,
      },
    },
    10000,
    correlationId
  );
}

module.exports = { getCustomerInternal, createOrder, confirmOrder, ApiError };
