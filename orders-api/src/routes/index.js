'use strict';

/**
 * orders-api/src/routes/index.js
 *
 * Agrupa los routers de productos y órdenes para montarlos desde app.js.
 * Deja explícita la separación entre el dominio de catálogo y el de pedidos.
 */

const { Router }                          = require('express');
const { authenticateAny, authenticate }   = require('../middleware/auth');
const { createProduct, patchProduct,
        getProduct, listProducts }         = require('../controllers/productController');
const { createOrder, getOrder, listOrders,
        confirmOrder, cancelOrder }        = require('../controllers/orderController');

// ── Productos ────────────────────────────────────────────────
const productRouter = Router();

productRouter.post  ('/',    authenticate, createProduct);
productRouter.patch ('/:id', authenticate, patchProduct);
productRouter.get   ('/:id', authenticate, getProduct);
productRouter.get   ('/',    authenticate, listProducts);

// ── Órdenes ──────────────────────────────────────────────────
// authenticateAny: acepta JWT de usuario O SERVICE_TOKEN del Lambda
const orderRouter = Router();

orderRouter.post  ('/',             authenticateAny, createOrder);
orderRouter.get   ('/:id',          authenticateAny, getOrder);
orderRouter.get   ('/',             authenticateAny, listOrders);
orderRouter.post  ('/:id/confirm',  authenticateAny, confirmOrder);
orderRouter.post  ('/:id/cancel',   authenticateAny, cancelOrder);

module.exports = { productRouter, orderRouter };
