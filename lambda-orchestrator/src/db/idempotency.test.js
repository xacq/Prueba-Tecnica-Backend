'use strict';

/**
 * idempotency.test.js
 *
 * Tests unitarios con mocks de MySQL para cubrir todos los estados
 * posibles del flujo de idempotencia sin necesitar una BD real.
 *
 * Requiere: npm install --save-dev jest
 */

jest.mock('./connection', () => ({
  getPool: jest.fn(),
}));

const { getPool } = require('./connection');
const {
  checkIdempotencyKey,
  initIdempotencyKey,
  saveIdempotencyKey,
  markIdempotencyKeyFailed,
} = require('./idempotency');

// ─── Helpers para construir mocks de pool ────────────────────────

function mockPool(executeResponses) {
  let callIndex = 0;
  const pool = {
    execute: jest.fn().mockImplementation(() => {
      const res = executeResponses[callIndex++];
      return Promise.resolve(res);
    }),
  };
  getPool.mockReturnValue(pool);
  return pool;
}

// ─── checkIdempotencyKey ─────────────────────────────────────────

describe('checkIdempotencyKey', () => {

  test('miss: no encuentra ningún registro', async () => {
    mockPool([[[]]]); // execute devuelve rows vacías
    const result = await checkIdempotencyKey('key-1');
    expect(result.status).toBe('miss');
    expect(result.data).toBeNull();
  });

  test('success: devuelve el response almacenado correctamente', async () => {
    const stored = { success: true, data: { order: { id: 101 } } };
    mockPool([[[{
      key:           'key-2',
      status:        'success',
      http_status:   201,
      target_type:   'order',
      target_id:     101,
      response_body: JSON.stringify(stored),
      created_at:    new Date(),
      expires_at:    new Date(Date.now() + 86400000),
    }]]]);

    const result = await checkIdempotencyKey('key-2');
    expect(result.status).toBe('success');
    expect(result.httpStatus).toBe(201);
    expect(result.data).toEqual(stored);
    expect(result.targetId).toBe(101);
  });

  test('failed: devuelve el error almacenado', async () => {
    const stored = { success: false, error: 'Customer not found' };
    mockPool([[[{
      key:           'key-3',
      status:        'failed',
      http_status:   404,
      target_type:   null,
      target_id:     null,
      response_body: JSON.stringify(stored),
      created_at:    new Date(),
      expires_at:    new Date(Date.now() + 86400000),
    }]]]);

    const result = await checkIdempotencyKey('key-3');
    expect(result.status).toBe('failed');
    expect(result.httpStatus).toBe(404);
    expect(result.data.error).toBe('Customer not found');
  });

  test('pending: key reciente → devuelve conflict', async () => {
    mockPool([[[{
      key:         'key-4',
      status:      'pending',
      http_status: null,
      target_type: null,
      target_id:   null,
      response_body: null,
      created_at:  new Date(),  // recién creada
      expires_at:  new Date(Date.now() + 86400000),
    }]]]);

    const result = await checkIdempotencyKey('key-4');
    expect(result.status).toBe('pending');
    expect(result.httpStatus).toBe(409);
  });

  test('pending huérfana: key antigua → limpia y retorna miss', async () => {
    const pool = mockPool([
      // Primera execute: SELECT encuentra la key huérfana
      [[[{
        key:         'key-5',
        status:      'pending',
        http_status: null,
        target_type: null,
        target_id:   null,
        response_body: null,
        created_at:  new Date(Date.now() - 25 * 60 * 1000), // 25 min atrás
        expires_at:  new Date(Date.now() + 86400000),
      }]]],
      // Segunda execute: DELETE de la key huérfana
      [{ affectedRows: 1 }],
    ]);

    const result = await checkIdempotencyKey('key-5');
    expect(result.status).toBe('miss');
    expect(pool.execute).toHaveBeenCalledTimes(2);
    // Verificar que el segundo execute fue el DELETE
    expect(pool.execute.mock.calls[1][0]).toContain('DELETE');
  });

});

// ─── initIdempotencyKey ──────────────────────────────────────────

describe('initIdempotencyKey', () => {

  test('gana la carrera → devuelve true', async () => {
    mockPool([[{ affectedRows: 1 }]]);
    const won = await initIdempotencyKey('key-new');
    expect(won).toBe(true);
  });

  test('pierde la carrera (ya existe) → devuelve false', async () => {
    mockPool([[{ affectedRows: 0 }]]);
    const won = await initIdempotencyKey('key-existing');
    expect(won).toBe(false);
  });

});

// ─── saveIdempotencyKey ──────────────────────────────────────────

describe('saveIdempotencyKey', () => {

  test('actualiza el registro con todos los campos', async () => {
    const pool = mockPool([[{ affectedRows: 1 }]]);
    const responseBody = { success: true, data: { order: { id: 42 } } };

    await saveIdempotencyKey('key-save', {
      status:       'success',
      responseBody,
      httpStatus:   201,
      targetType:   'order',
      targetId:     42,
    });

    expect(pool.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.execute.mock.calls[0];
    expect(sql).toContain('UPDATE idempotency_keys');
    expect(params[0]).toBe('success');
    expect(params[1]).toBe(JSON.stringify(responseBody));
    expect(params[2]).toBe(201);
    expect(params[3]).toBe('order');
    expect(params[4]).toBe(42);
    expect(params[5]).toBe('key-save');
  });

});

// ─── markIdempotencyKeyFailed ────────────────────────────────────

describe('markIdempotencyKeyFailed', () => {

  test('guarda el mensaje de error sin propagar excepciones de DB', async () => {
    // Simular que el UPDATE falla (no debería propagar)
    getPool.mockReturnValue({
      execute: jest.fn().mockRejectedValue(new Error('DB connection lost')),
    });

    // No debe lanzar excepción
    await expect(
      markIdempotencyKeyFailed('key-err', new Error('Customer not found'), 404)
    ).resolves.not.toThrow();
  });

  test('llama a saveIdempotencyKey con status failed', async () => {
    const pool = mockPool([[{ affectedRows: 1 }]]);
    await markIdempotencyKeyFailed('key-fail', new Error('Stock insuficiente'), 422);

    const [sql, params] = pool.execute.mock.calls[0];
    expect(sql).toContain('UPDATE');
    expect(params[0]).toBe('failed');
    expect(params[2]).toBe(422);
  });

});
