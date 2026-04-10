'use strict';

const { ZodError } = require('zod');

function errorHandler(err, req, res, next) {
  // Errores de validación Zod
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

  // Email duplicado en MySQL
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({
      success: false,
      error:   'El email ya está registrado',
    });
  }

  // Errores con status explícito (lanzados en los controllers)
  if (err.status) {
    return res.status(err.status).json({
      success: false,
      error:   err.message,
    });
  }

  // Error inesperado
  console.error('[error]', err);
  res.status(500).json({
    success: false,
    error:   'Error interno del servidor',
    ...(process.env.NODE_ENV === 'development' && { detail: err.message }),
  });
}

module.exports = { errorHandler };
