'use strict';

const jwt = require('jsonwebtoken');

/**
 * customers-api/src/middleware/auth.js
 *
 * Define los guards de autenticación del servicio de clientes.
 * `authenticate` valida JWT de usuario para las rutas públicas y
 * `authenticateService` valida el SERVICE_TOKEN para el endpoint interno.
 */

/**
 * Verifica JWT de usuario para rutas públicas del backoffice.
 * Header esperado: Authorization: Bearer <token>
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token)
    return res.status(401).json({ success: false, error: 'Token requerido' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Token expirado' : 'Token inválido';
    return res.status(401).json({ success: false, error: msg });
  }
}

/**
 * Verifica SERVICE_TOKEN para rutas internas (/internal/*).
 * Solo accesible por otros servicios (Orders API, Lambda).
 */
function authenticateService(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token || token !== process.env.SERVICE_TOKEN)
    return res.status(401).json({ success: false, error: 'Service token inválido' });

  next();
}

module.exports = { authenticate, authenticateService };
