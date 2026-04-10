'use strict';

/**
 * orders-api/src/controllers/productController.js
 *
 * Implementa el CRUD de productos y stock.
 * Se apoya en los validadores de orders-api, el helper de paginación y el
 * pool MySQL compartido.
 */

const { getPool }  = require('../db/connection');
const { paginate } = require('../utils/paginate');
const {
  createProductSchema,
  patchProductSchema,
  listQuerySchema,
} = require('../validators/index');

function formatProduct(row) {
  return {
    id:          row.id,
    sku:         row.sku,
    name:        row.name,
    price_cents: row.price_cents,
    stock:       row.stock,
    created_at:  row.created_at,
    updated_at:  row.updated_at,
  };
}

// POST /products
async function createProduct(req, res, next) {
  try {
    const data = createProductSchema.parse(req.body);
    const pool = getPool();

    const [result] = await pool.execute(
      `INSERT INTO products (sku, name, price_cents, stock) VALUES (?, ?, ?, ?)`,
      [data.sku, data.name, data.price_cents, data.stock]
    );

    const [[product]] = await pool.execute(
      `SELECT * FROM products WHERE id = ?`, [result.insertId]
    );

    res.status(201).json({ success: true, data: formatProduct(product) });
  } catch (err) { next(err); }
}

// PATCH /products/:id  (precio y/o stock)
async function patchProduct(req, res, next) {
  try {
    const data = patchProductSchema.parse(req.body);
    const pool = getPool();

    const [[existing]] = await pool.execute(
      `SELECT id FROM products WHERE id = ?`, [req.params.id]
    );
    if (!existing)
      return next(Object.assign(new Error('Producto no encontrado'), { status: 404 }));

    const fields = Object.keys(data);
    const values = Object.values(data);
    const setClause = fields.map(f => `\`${f}\` = ?`).join(', ');

    await pool.execute(
      `UPDATE products SET ${setClause} WHERE id = ?`,
      [...values, req.params.id]
    );

    const [[updated]] = await pool.execute(
      `SELECT * FROM products WHERE id = ?`, [req.params.id]
    );

    res.json({ success: true, data: formatProduct(updated) });
  } catch (err) { next(err); }
}

// GET /products/:id
async function getProduct(req, res, next) {
  try {
    const pool = getPool();
    const [[product]] = await pool.execute(
      `SELECT * FROM products WHERE id = ?`, [req.params.id]
    );

    if (!product)
      return next(Object.assign(new Error('Producto no encontrado'), { status: 404 }));

    res.json({ success: true, data: formatProduct(product) });
  } catch (err) { next(err); }
}

// GET /products?search=&cursor=&limit=
async function listProducts(req, res, next) {
  try {
    const { search, cursor, limit } = listQuerySchema.parse(req.query);
    const pool = getPool();

    let where  = '1=1';
    let params = [];

    if (search) {
      where  = '(name LIKE ? OR sku LIKE ?)';
      params = [`%${search}%`, `%${search}%`];
    }

    const result = await paginate(pool, {
      table: 'products', where, params, cursor, limit,
      select: 'id, sku, name, price_cents, stock, created_at, updated_at',
    });

    res.json({
      success: true,
      data:    result.data.map(formatProduct),
      pagination: { nextCursor: result.nextCursor, hasMore: result.hasMore, limit },
    });
  } catch (err) { next(err); }
}

module.exports = { createProduct, patchProduct, getProduct, listProducts };
