'use strict';

/**
 * customers-api/src/app.js
 *
 * Punto de entrada HTTP del servicio de clientes.
 * Monta el healthcheck, las rutas públicas de /customers y el endpoint
 * interno /internal/customers/:id que consume Orders API y el Lambda.
 *
 * Dependencias cruzadas:
 * - middleware/auth.js: JWT de usuario y SERVICE_TOKEN
 * - controllers/customerController.js: CRUD y lookup interno
 * - db/connection.js: pool MySQL reutilizable
 * - middleware/errorHandler.js: traducción uniforme de errores
 */

require('dotenv').config();

const express          = require('express');
const { Router }       = require('express');
const { authenticate, authenticateService } = require('./middleware/auth');
const {
  createCustomer, getCustomer, listCustomers,
  updateCustomer, deleteCustomer, getCustomerInternal,
} = require('./controllers/customerController');
const { errorHandler } = require('./middleware/errorHandler');
const { getPool }      = require('./db/connection');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });

// Health check
app.get('/health', async (req, res) => {
  try {
    await getPool().execute('SELECT 1');
    res.json({ status: 'ok', service: 'customers-api', db: 'ok' });
  } catch {
    res.status(503).json({ status: 'error', service: 'customers-api', db: 'unreachable' });
  }
});

// Rutas públicas del backoffice (JWT)
const pub = Router();
pub.post  ('/',    authenticate, createCustomer);
pub.get   ('/',    authenticate, listCustomers);
pub.get   ('/:id', authenticate, getCustomer);
pub.put   ('/:id', authenticate, updateCustomer);
pub.delete('/:id', authenticate, deleteCustomer);
app.use('/customers', pub);

// Ruta interna (SERVICE_TOKEN)
app.get('/internal/customers/:id', authenticateService, getCustomerInternal);

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Ruta ${req.method} ${req.path} no encontrada` });
});

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[customers-api] corriendo en http://localhost:${PORT}`);
  console.log(`[customers-api] NODE_ENV=${process.env.NODE_ENV}`);
});

module.exports = app;
