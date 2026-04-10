'use strict';

const { z } = require('zod');

const createCustomerSchema = z.object({
  name:  z.string().min(1, 'name es requerido').max(255),
  email: z.string().email('email inválido').max(255),
  phone: z.string().max(50).nullable().optional(),
});

const updateCustomerSchema = z.object({
  name:  z.string().min(1).max(255).optional(),
  email: z.string().email('email inválido').max(255).optional(),
  phone: z.string().max(50).nullable().optional(),
}).refine(
  data => Object.keys(data).length > 0,
  { message: 'Debe enviar al menos un campo para actualizar' }
);

const listQuerySchema = z.object({
  search: z.string().max(100).optional(),
  cursor: z.string().optional(),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
});

module.exports = { createCustomerSchema, updateCustomerSchema, listQuerySchema };
