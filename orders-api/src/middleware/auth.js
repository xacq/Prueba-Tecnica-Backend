'use strict';

const jwt = require('jsonwebtoken');

/**
 * orders-api/src/middleware/auth.js
 *
 * Define los guards de autenticación del servicio de órdenes.
 * `authenticate` valida JWT de usuario, `authenticateService` valida
 * SERVICE_TOKEN y `authenticateAny` acepta cualquiera de los dos según la
 * superficie HTTP que expone el Lambda o el operador.
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

function authenticateService(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token || token !== process.env.SERVICE_TOKEN)
    return res.status(401).json({ success: false, error: 'Service token inválido' });

  next();
}

// Orders API acepta tanto JWT de usuario como SERVICE_TOKEN
// (el Lambda llama a /orders con SERVICE_TOKEN)
function authenticateAny(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token)
    return res.status(401).json({ success: false, error: 'Token requerido' });

  // Primero intentar como SERVICE_TOKEN
  if (token === process.env.SERVICE_TOKEN) return next();

  // Si no, intentar como JWT
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Token expirado' : 'Token inválido';
    return res.status(401).json({ success: false, error: msg });
  }
}

module.exports = { authenticate, authenticateService, authenticateAny };
