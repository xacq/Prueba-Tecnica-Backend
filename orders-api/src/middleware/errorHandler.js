'use strict';

/**
 * orders-api/src/middleware/errorHandler.js
 *
 * Traduce errores de validación, duplicados, dominio y fallos inesperados
 * a respuestas HTTP consistentes para el servicio de órdenes.
 */

const { ZodError } = require('zod');

function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error:   'Error de validación',
      details: err.errors.map(e => ({
        field:   e.path.join('.'),
        message: e.message,
      })),
    });
  }

  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({
      success: false,
      error:   'Registro duplicado',
    });
  }

  if (err.status) {
    return res.status(err.status).json({
      success: false,
      error:   err.message,
    });
  }

  console.error('[orders-api][error]', err);
  res.status(500).json({
    success: false,
    error:   'Error interno del servidor',
    ...(process.env.NODE_ENV === 'development' && { detail: err.message }),
  });
}

module.exports = { errorHandler };
