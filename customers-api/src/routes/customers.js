'use strict';

/**
 * customers-api/src/routes/customers.js
 *
 * Router declarativo del contrato HTTP de clientes.
 * Mantiene visible la composición de rutas públicas e internas y documenta
 * qué controladores y middlewares sostienen cada endpoint.
 */

const { Router } = require('express');
const { authenticate, authenticateService } = require('../middleware/auth');
const {
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
  deleteCustomer,
  getCustomerInternal,
} = require('../controllers/customerController');

const router = Router();

// ── Rutas públicas del backoffice (requieren JWT de usuario) ──
router.post  ('/',    authenticate, createCustomer);
router.get   ('/',    authenticate, listCustomers);
router.get   ('/:id', authenticate, getCustomer);
router.put   ('/:id', authenticate, updateCustomer);
router.delete('/:id', authenticate, deleteCustomer);

// ── Ruta interna (solo para servicios con SERVICE_TOKEN) ──────
router.get('/internal/customers/:id', authenticateService, getCustomerInternal);

module.exports = router;
