'use strict';

const { z } = require('zod');

// ── Productos ────────────────────────────────────────────────

const createProductSchema = z.object({
  sku:         z.string().min(1).max(100),
  name:        z.string().min(1).max(255),
  price_cents: z.number().int().positive('price_cents debe ser positivo'),
  stock:       z.number().int().min(0, 'stock no puede ser negativo').default(0),
});

const patchProductSchema = z.object({
  price_cents: z.number().int().positive().optional(),
  stock:       z.number().int().min(0).optional(),
  name:        z.string().min(1).max(255).optional(),
}).refine(
  d => Object.keys(d).length > 0,
  { message: 'Debe enviar al menos un campo para actualizar' }
);

// ── Órdenes ──────────────────────────────────────────────────

const orderItemSchema = z.object({
  product_id: z.number().int().positive('product_id inválido'),
  qty:        z.number().int().min(1, 'qty debe ser al menos 1'),
});

const createOrderSchema = z.object({
  customer_id:     z.number().int().positive('customer_id inválido'),
  items:           z.array(orderItemSchema).min(1, 'Debe incluir al menos un item'),
  idempotency_key: z.string().max(255).optional(),
});

// ── Queries de listado ───────────────────────────────────────

const listQuerySchema = z.object({
  search: z.string().max(100).optional(),
  cursor: z.string().optional(),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
});

const listOrdersQuerySchema = z.object({
  status: z.enum(['CREATED', 'CONFIRMED', 'CANCELED']).optional(),
  from:   z.string().datetime({ offset: true }).optional(),
  to:     z.string().datetime({ offset: true }).optional(),
  cursor: z.string().optional(),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
});

module.exports = {
  createProductSchema,
  patchProductSchema,
  createOrderSchema,
  listQuerySchema,
  listOrdersQuerySchema,
};
