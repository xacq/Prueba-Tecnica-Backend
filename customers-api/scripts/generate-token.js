#!/usr/bin/env node
'use strict';

/**
 * scripts/generate-token.js
 *
 * Genera un JWT de desarrollo para probar los endpoints protegidos.
 * Uso: node scripts/generate-token.js
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');

const payload = {
  sub:   1,
  email: 'admin@backoffice.com',
  role:  'operator',
};

const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });

console.log('\n──────────────────────────────────────────────────');
console.log('JWT para desarrollo (válido 24h):');
console.log('──────────────────────────────────────────────────');
console.log(token);
console.log('──────────────────────────────────────────────────');
console.log('\nUso en cURL:');
console.log(`  -H "Authorization: Bearer ${token}"`);
console.log('\nUso como SERVICE_TOKEN en .env:');
console.log(`  SERVICE_TOKEN=${process.env.SERVICE_TOKEN}`);
console.log('──────────────────────────────────────────────────\n');
