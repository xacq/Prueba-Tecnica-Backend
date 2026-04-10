'use strict';

const { getPool }            = require('../db/connection');
const { paginate }           = require('../utils/paginate');
const { getCustomerInternal} = require('../utils/customersClient');
const {
  createOrderSchema,
  listOrdersQuerySchema,
} = require('../validators/index');

// Ventana de cancelación para órdenes CONFIRMED (en minutos)
const CANCEL_WINDOW_MIN = 10;

// ─── helpers ────────────────────────────────────────────────

function err(message, status) {
  return Object.assign(new Error(message), { status });
}

function formatOrder(order, items = []) {
  return {
    id:              order.id,
    customer_id:     order.customer_id,
    status:          order.status,
    total_cents:     order.total_cents,
    idempotency_key: order.idempotency_key ?? undefined,
    confirmed_at:    order.confirmed_at  ?? null,
    canceled_at:     order.canceled_at   ?? null,
    canceled_by:     order.canceled_by   ?? null,
    created_at:      order.created_at,
    updated_at:      order.updated_at,
    ...(items.length ? { items } : {}),
  };
}

function formatItem(item) {
  return {
    id:              item.id,
    product_id:      item.product_id,
    qty:             item.qty,
    unit_price_cents: item.unit_price_cents,
    subtotal_cents:  item.subtotal_cents,
  };
}

// Carga los items de una o varias órdenes en una sola query
async function loadItems(pool, orderIds) {
  if (!orderIds.length) return {};
  const placeholders = orderIds.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT * FROM order_items WHERE order_id IN (${placeholders})`,
    orderIds
  );
  // Agrupar por order_id
  return rows.reduce((acc, row) => {
    acc[row.order_id] = acc[row.order_id] || [];
    acc[row.order_id].push(formatItem(row));
    return acc;
  }, {});
}

// Busca en idempotency_keys si la key ya fue procesada
async function checkIdempotency(pool, key) {
  if (!key) return null;
  const [[row]] = await pool.execute(
    `SELECT status, http_status, response_body
     FROM idempotency_keys
     WHERE \`key\` = ? AND expires_at > NOW()
     LIMIT 1`,
    [key]
  );
  return row || null;
}

async function loadOrderByIdempotencyKey(pool, key) {
  const [[order]] = await pool.execute(
    `SELECT * FROM orders
     WHERE idempotency_key = ?
     LIMIT 1`,
    [key]
  );

  if (!order) return null;

  const [items] = await pool.execute(
    `SELECT * FROM order_items WHERE order_id = ?`,
    [order.id]
  );

  return { order, items: items.map(formatItem) };
}

// Guarda resultado en idempotency_keys
async function saveIdempotency(pool, { key, status, httpStatus,
  responseBody, targetType, targetId }) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.execute(
    `INSERT INTO idempotency_keys
       (\`key\`, target_type, target_id, status, http_status, response_body, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       http_status = VALUES(http_status),
       response_body = VALUES(response_body)`,
    [key, targetType, targetId, status, httpStatus,
      JSON.stringify(responseBody), expiresAt]
  );
}

async function saveIdempotencySafely(pool, payload, context) {
  try {
    await saveIdempotency(pool, payload);
  } catch (saveErr) {
    console.warn(
      `[orders-api] No se pudo guardar idempotency key en ${context}:`,
      saveErr.message
    );
  }
}

// ─── POST /orders ────────────────────────────────────────────

async function createOrder(req, res, next) {
  try {
    const data = createOrderSchema.parse(req.body);
    const pool = getPool();

    // 1. Idempotencia: si la key ya existe devolver resultado anterior
    if (data.idempotency_key) {
      const cached = await checkIdempotency(pool, data.idempotency_key);
      if (cached) {
        const body = typeof cached.response_body === 'string'
          ? JSON.parse(cached.response_body)
          : cached.response_body;
        return res
          .status(cached.http_status)
          .set('X-Idempotent-Replay', 'true')
          .json(body);
      }

      const existing = await loadOrderByIdempotencyKey(pool, data.idempotency_key);
      if (existing) {
        const responseData = {
          success: true,
          data:    formatOrder(existing.order, existing.items),
        };

        await saveIdempotencySafely(pool, {
          key:          data.idempotency_key,
          status:       'success',
          httpStatus:   201,
          responseBody: responseData,
          targetType:   'order',
          targetId:     existing.order.id,
        }, 'createOrder replay');

        return res
          .status(201)
          .set('X-Idempotent-Replay', 'true')
          .json(responseData);
      }
    }

    // 2. Validar cliente en Customers API
    const customer = await getCustomerInternal(data.customer_id);

    // 3. Crear orden dentro de una transacción con SELECT FOR UPDATE
    const conn = await pool.getConnection();
    let orderId;
    let totalCents = 0;
    const itemsCreated = [];

    try {
      await conn.beginTransaction();

      // Verificar y bloquear stock de cada producto
      for (const item of data.items) {
        const [[product]] = await conn.execute(
          `SELECT id, name, price_cents, stock
           FROM products WHERE id = ? FOR UPDATE`,
          [item.product_id]
        );

        if (!product)
          throw err(`Producto ${item.product_id} no encontrado`, 404);

        if (product.stock < item.qty)
          throw err(
            `Stock insuficiente para "${product.name}": disponible ${product.stock}, solicitado ${item.qty}`,
            422
          );

        // Descontar stock
        await conn.execute(
          `UPDATE products SET stock = stock - ? WHERE id = ?`,
          [item.qty, item.product_id]
        );

        const subtotal = product.price_cents * item.qty;
        totalCents    += subtotal;

        itemsCreated.push({
          product_id:       item.product_id,
          qty:              item.qty,
          unit_price_cents: product.price_cents,
          subtotal_cents:   subtotal,
        });
      }

      // Crear la orden
      const [result] = await conn.execute(
        `INSERT INTO orders (customer_id, status, total_cents, idempotency_key)
         VALUES (?, 'CREATED', ?, ?)`,
        [data.customer_id, totalCents, data.idempotency_key ?? null]
      );
      orderId = result.insertId;

      // Crear los items
      for (const item of itemsCreated) {
        await conn.execute(
          `INSERT INTO order_items
             (order_id, product_id, qty, unit_price_cents, subtotal_cents)
           VALUES (?, ?, ?, ?, ?)`,
          [orderId, item.product_id, item.qty,
            item.unit_price_cents, item.subtotal_cents]
        );
      }

      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      if (data.idempotency_key && txErr.code === 'ER_DUP_ENTRY') {
        const replay = await loadOrderByIdempotencyKey(pool, data.idempotency_key);
        if (replay) {
          const responseData = {
            success: true,
            data:    formatOrder(replay.order, replay.items),
          };

          await saveIdempotencySafely(pool, {
            key:          data.idempotency_key,
            status:       'success',
            httpStatus:   201,
            responseBody: responseData,
            targetType:   'order',
            targetId:     replay.order.id,
          }, 'createOrder duplicate replay');

          return res
            .status(201)
            .set('X-Idempotent-Replay', 'true')
            .json(responseData);
        }
      }

      throw txErr;
    } finally {
      conn.release();
    }

    // 4. Leer la orden creada con sus items
    const [[order]] = await pool.execute(
      `SELECT * FROM orders WHERE id = ?`, [orderId]
    );
    const [items] = await pool.execute(
      `SELECT * FROM order_items WHERE order_id = ?`, [orderId]
    );

    const responseData = {
      success: true,
      data:    formatOrder(order, items.map(formatItem)),
    };

    // 5. Guardar en idempotency_keys para futuros reintentos
    if (data.idempotency_key) {
      await saveIdempotencySafely(pool, {
        key:          data.idempotency_key,
        status:       'success',
        httpStatus:   201,
        responseBody: responseData,
        targetType:   'order',
        targetId:     orderId,
      }, 'createOrder success');
    }

    res.status(201).json(responseData);
  } catch (err) { next(err); }
}

// ─── GET /orders/:id ─────────────────────────────────────────

async function getOrder(req, res, next) {
  try {
    const pool = getPool();
    const [[order]] = await pool.execute(
      `SELECT * FROM orders WHERE id = ?`, [req.params.id]
    );

    if (!order) return next(err('Orden no encontrada', 404));

    const [items] = await pool.execute(
      `SELECT * FROM order_items WHERE order_id = ?`, [req.params.id]
    );

    res.json({ success: true, data: formatOrder(order, items.map(formatItem)) });
  } catch (e) { next(e); }
}

// ─── GET /orders?status=&from=&to=&cursor=&limit= ────────────

async function listOrders(req, res, next) {
  try {
    const { status, from, to, cursor, limit } =
      listOrdersQuerySchema.parse(req.query);
    const pool = getPool();

    const conditions = [];
    const params     = [];

    if (status) { conditions.push('status = ?');      params.push(status); }
    if (from)   { conditions.push('created_at >= ?'); params.push(new Date(from)); }
    if (to)     { conditions.push('created_at <= ?'); params.push(new Date(to)); }

    const result = await paginate(pool, {
      table:   'orders',
      where:   conditions.length ? conditions.join(' AND ') : '1=1',
      params,
      cursor,
      limit,
      select:  'id, customer_id, status, total_cents, confirmed_at, canceled_at, created_at, updated_at',
    });

    // Cargar items de todas las órdenes en una sola query
    const itemsByOrder = await loadItems(pool, result.data.map(o => o.id));

    res.json({
      success: true,
      data:    result.data.map(o => formatOrder(o, itemsByOrder[o.id] || [])),
      pagination: { nextCursor: result.nextCursor, hasMore: result.hasMore, limit },
    });
  } catch (e) { next(e); }
}

// ─── POST /orders/:id/confirm ─────────────────────────────────

async function confirmOrder(req, res, next) {
  try {
    const idempotencyKey = req.headers['x-idempotency-key'];

    if (!idempotencyKey)
      return next(err('Header X-Idempotency-Key es requerido', 400));

    const pool = getPool();

    // 1. Verificar idempotencia: misma key → mismo resultado
    const cached = await checkIdempotency(pool, idempotencyKey);
    if (cached) {
      const body = typeof cached.response_body === 'string'
        ? JSON.parse(cached.response_body)
        : cached.response_body;
      return res
        .status(cached.http_status)
        .set('X-Idempotent-Replay', 'true')
        .json(body);
    }

    // 2. Buscar la orden
    const [[order]] = await pool.execute(
      `SELECT * FROM orders WHERE id = ?`, [req.params.id]
    );

    if (!order) return next(err('Orden no encontrada', 404));

    if (order.status === 'CONFIRMED') {
      // Ya estaba confirmada: devolver el estado actual (idempotente sin key previa)
      const [items] = await pool.execute(
        `SELECT * FROM order_items WHERE order_id = ?`, [req.params.id]
      );
      return res.json({ success: true, data: formatOrder(order, items.map(formatItem)) });
    }

    if (order.status !== 'CREATED')
      return next(err(`No se puede confirmar una orden en estado ${order.status}`, 422));

    // 3. Confirmar
    await pool.execute(
      `UPDATE orders
       SET status = 'CONFIRMED', confirmed_at = NOW()
       WHERE id = ? AND status = 'CREATED'`,
      [req.params.id]
    );

    const [[updated]] = await pool.execute(
      `SELECT * FROM orders WHERE id = ?`, [req.params.id]
    );
    const [items] = await pool.execute(
      `SELECT * FROM order_items WHERE order_id = ?`, [req.params.id]
    );

    const responseData = {
      success: true,
      data:    formatOrder(updated, items.map(formatItem)),
    };

    // 4. Guardar en idempotency_keys
    await saveIdempotencySafely(pool, {
      key:          idempotencyKey,
      status:       'success',
      httpStatus:   200,
      responseBody: responseData,
      targetType:   'order',
      targetId:     updated.id,
    }, 'confirmOrder');

    res.json(responseData);
  } catch (e) { next(e); }
}

// ─── POST /orders/:id/cancel ──────────────────────────────────

async function cancelOrder(req, res, next) {
  try {
    const pool = getPool();
    const [[order]] = await pool.execute(
      `SELECT * FROM orders WHERE id = ?`, [req.params.id]
    );

    if (!order) return next(err('Orden no encontrada', 404));

    if (order.status === 'CANCELED')
      return next(err('La orden ya está cancelada', 422));

    // Regla: CONFIRMED solo cancela dentro de 10 minutos
    if (order.status === 'CONFIRMED') {
      if (!order.confirmed_at)
        return next(err('No se puede determinar el tiempo de confirmación', 500));

      const elapsed = (Date.now() - new Date(order.confirmed_at).getTime()) / 60000;
      if (elapsed > CANCEL_WINDOW_MIN)
        return next(err(
          `No se puede cancelar: han pasado ${elapsed.toFixed(1)} minutos desde la confirmación (máximo ${CANCEL_WINDOW_MIN})`,
          422
        ));
    }

    // Cancelar y restaurar stock en una transacción
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Restaurar stock solo si la orden estaba CREATED o CONFIRMED válida
      const [items] = await conn.execute(
        `SELECT product_id, qty FROM order_items WHERE order_id = ?`,
        [req.params.id]
      );

      for (const item of items) {
        await conn.execute(
          `UPDATE products SET stock = stock + ? WHERE id = ?`,
          [item.qty, item.product_id]
        );
      }

      await conn.execute(
        `UPDATE orders
         SET status = 'CANCELED', canceled_at = NOW(), canceled_by = 'operator'
         WHERE id = ?`,
        [req.params.id]
      );

      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    const [[canceled]] = await pool.execute(
      `SELECT * FROM orders WHERE id = ?`, [req.params.id]
    );
    const [items] = await pool.execute(
      `SELECT * FROM order_items WHERE order_id = ?`, [req.params.id]
    );

    res.json({ success: true, data: formatOrder(canceled, items.map(formatItem)) });
  } catch (e) { next(e); }
}

module.exports = {
  createOrder,
  getOrder,
  listOrders,
  confirmOrder,
  cancelOrder,
};
