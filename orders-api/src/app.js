'use strict';

/**
 * orders-api/src/app.js
 *
 * Punto de entrada HTTP del servicio de productos y órdenes.
 * Monta el healthcheck, el router de productos, el router de órdenes y el
 * error handler global.
 *
 * Dependencias cruzadas:
 * - routes/index.js: composición de routers
 * - middleware/auth.js: JWT de usuario y SERVICE_TOKEN
 * - controllers/productController.js y controllers/orderController.js
 * - db/connection.js: pool MySQL reutilizable
 */

require('dotenv').config();

const express              = require('express');
const { productRouter,
        orderRouter }      = require('./routes/index');
const { errorHandler }     = require('./middleware/errorHandler');
const { getPool }          = require('./db/connection');

const app  = express();
const PORT = process.env.PORT || 3002;

// ── Middlewares globales ──────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// ── Health check ──────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await getPool().execute('SELECT 1');
    res.json({ status: 'ok', service: 'orders-api', db: 'ok' });
  } catch {
    res.status(503).json({ status: 'error', service: 'orders-api', db: 'unreachable' });
  }
});

// ── Rutas ─────────────────────────────────────────────────────
app.use('/products', productRouter);
app.use('/orders',   orderRouter);

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Ruta ${req.method} ${req.path} no encontrada`,
  });
});

// ── Error handler (siempre al final) ─────────────────────────
app.use(errorHandler);

// ── Arranque ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[orders-api] corriendo en http://localhost:${PORT}`);
  console.log(`[orders-api] NODE_ENV=${process.env.NODE_ENV}`);
  console.log(`[orders-api] CUSTOMERS_INTERNAL_URL=${process.env.CUSTOMERS_INTERNAL_URL}`);
});

module.exports = app;
