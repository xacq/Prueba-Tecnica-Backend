'use strict';

/**
 * customers-api/src/controllers/customerController.js
 *
 * Implementa el CRUD de clientes, la búsqueda paginada y el endpoint interno.
 * Valida entrada con Zod, consulta MySQL y expone el shape de respuesta que
 * consumen Orders API y el Lambda orquestador.
 *
 * Dependencias cruzadas:
 * - validators/customer.js: contratos de entrada
 * - utils/paginate.js: cursor pagination
 * - db/connection.js: pool MySQL compartido
 */

const { getPool }    = require('../db/connection');
const { paginate }   = require('../utils/paginate');
const {
  createCustomerSchema,
  updateCustomerSchema,
  listQuerySchema,
} = require('../validators/customer');

// ─── helpers ────────────────────────────────────────────────

function notFound() {
  return Object.assign(new Error('Cliente no encontrado'), { status: 404 });
}

// Formatea una fila de DB al shape de respuesta pública
function formatCustomer(row) {
  return {
    id:         row.id,
    name:       row.name,
    email:      row.email,
    phone:      row.phone ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── POST /customers ─────────────────────────────────────────

async function createCustomer(req, res, next) {
  try {
    const data = createCustomerSchema.parse(req.body);
    const pool = getPool();

    const [result] = await pool.execute(
      `INSERT INTO customers (name, email, phone)
       VALUES (?, ?, ?)`,
      [data.name, data.email, data.phone ?? null]
    );

    const [[customer]] = await pool.execute(
      `SELECT * FROM customers WHERE id = ?`,
      [result.insertId]
    );

    res.status(201).json({ success: true, data: formatCustomer(customer) });
  } catch (err) { next(err); }
}

// ─── GET /customers/:id ───────────────────────────────────────

async function getCustomer(req, res, next) {
  try {
    const pool = getPool();
    const [[customer]] = await pool.execute(
      `SELECT * FROM customers
       WHERE id = ? AND deleted_at IS NULL`,
      [req.params.id]
    );

    if (!customer) return next(notFound());
    res.json({ success: true, data: formatCustomer(customer) });
  } catch (err) { next(err); }
}

// ─── GET /customers?search=&cursor=&limit= ────────────────────

async function listCustomers(req, res, next) {
  try {
    const { search, cursor, limit } = listQuerySchema.parse(req.query);
    const pool = getPool();

    // Construir condición dinámica según si hay búsqueda
    let where  = 'deleted_at IS NULL';
    let params = [];

    if (search) {
      where += ' AND (name LIKE ? OR email LIKE ?)';
      params = [`%${search}%`, `%${search}%`];
    }

    const result = await paginate(pool, {
      table: 'customers',
      where,
      params,
      cursor,
      limit,
      select: 'id, name, email, phone, created_at, updated_at',
    });

    res.json({
      success: true,
      data:    result.data.map(formatCustomer),
      pagination: {
        nextCursor: result.nextCursor,
        hasMore:    result.hasMore,
        limit,
      },
    });
  } catch (err) { next(err); }
}

// ─── PUT /customers/:id ───────────────────────────────────────

async function updateCustomer(req, res, next) {
  try {
    const data = updateCustomerSchema.parse(req.body);
    const pool = getPool();

    // Verificar que el cliente existe y no está eliminado
    const [[existing]] = await pool.execute(
      `SELECT id FROM customers WHERE id = ? AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!existing) return next(notFound());

    // Construir SET dinámico solo con los campos enviados
    const fields = Object.keys(data);
    const values = Object.values(data);
    const setClause = fields.map(f => `\`${f}\` = ?`).join(', ');

    await pool.execute(
      `UPDATE customers SET ${setClause} WHERE id = ?`,
      [...values, req.params.id]
    );

    const [[updated]] = await pool.execute(
      `SELECT * FROM customers WHERE id = ?`,
      [req.params.id]
    );

    res.json({ success: true, data: formatCustomer(updated) });
  } catch (err) { next(err); }
}

// ─── DELETE /customers/:id  (soft-delete) ────────────────────

async function deleteCustomer(req, res, next) {
  try {
    const pool = getPool();

    const [[existing]] = await pool.execute(
      `SELECT id FROM customers WHERE id = ? AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!existing) return next(notFound());

    await pool.execute(
      `UPDATE customers SET deleted_at = NOW() WHERE id = ?`,
      [req.params.id]
    );

    res.status(204).send();
  } catch (err) { next(err); }
}

// ─── GET /internal/customers/:id  (para servicios internos) ──

async function getCustomerInternal(req, res, next) {
  try {
    const pool = getPool();

    // El endpoint interno NO filtra por deleted_at a propósito:
    // si una orden ya existía para un cliente eliminado, Orders API
    // necesita poder recuperar esos datos para mostrar el histórico.
    const [[customer]] = await pool.execute(
      `SELECT * FROM customers WHERE id = ?`,
      [req.params.id]
    );

    if (!customer) return next(notFound());
    res.json({ success: true, data: formatCustomer(customer) });
  } catch (err) { next(err); }
}

module.exports = {
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
  deleteCustomer,
  getCustomerInternal,
};
