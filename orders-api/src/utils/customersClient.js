'use strict';

/**
 * orders-api/src/utils/customersClient.js
 *
 * Cliente HTTP para validar la existencia del cliente antes de crear órdenes.
 * Se comunica con GET /internal/customers/:id usando SERVICE_TOKEN.
 */

/**
 * Llama a GET /internal/customers/:id en Customers API.
 * Usado por Orders API para validar que el cliente existe
 * antes de crear una orden.
 */
async function getCustomerInternal(customerId) {
  const base = process.env.CUSTOMERS_INTERNAL_URL;
  const url  = `${base}/internal/customers/${customerId}`;

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.SERVICE_TOKEN}` },
      signal:  controller.signal,
    });

    const body = await res.json().catch(() => ({}));

    if (res.status === 404)
      throw Object.assign(
        new Error(`Cliente ${customerId} no encontrado`),
        { status: 404 }
      );

    if (!res.ok)
      throw Object.assign(
        new Error(`Error al validar cliente: ${body.error || res.status}`),
        { status: 502 }
      );

    return body.data;

  } catch (err) {
    if (err.name === 'AbortError')
      throw Object.assign(
        new Error('Timeout al contactar Customers API'),
        { status: 504 }
      );
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { getCustomerInternal };
