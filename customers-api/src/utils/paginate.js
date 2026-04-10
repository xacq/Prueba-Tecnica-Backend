'use strict';

const encodeCursor = (id) =>
  Buffer.from(String(id)).toString('base64');

const decodeCursor = (cursor) =>
  Number(Buffer.from(cursor, 'base64').toString('ascii'));

/**
 * Pagina una consulta usando cursor-based pagination.
 * Usa WHERE id > :last_id ORDER BY id ASC para máxima eficiencia.
 *
 * @param {Pool}   pool
 * @param {Object} opts
 * @param {string} opts.table      - nombre de la tabla
 * @param {string} opts.where      - condición SQL extra (sin WHERE)
 * @param {Array}  opts.params     - parámetros para la condición extra
 * @param {string} opts.cursor     - cursor codificado en base64
 * @param {number} opts.limit      - máximo de resultados
 * @param {string} opts.select     - columnas a seleccionar (default: *)
 */
async function paginate(pool, { table, where = '1=1', params = [],
  cursor, limit = 20, select = '*' }) {

  const conditions = [where];
  const args = [...params];

  if (cursor) {
    const lastId = decodeCursor(cursor);
    if (!Number.isFinite(lastId) || lastId < 1)
      throw Object.assign(new Error('Cursor inválido'), { status: 400 });
    conditions.push('id > ?');
    args.push(lastId);
  }

  const sql = `
    SELECT ${select} FROM \`${table}\`
    WHERE ${conditions.join(' AND ')}
    ORDER BY id ASC
    LIMIT ?`;

  args.push(limit + 1); // pedir uno de más para saber si hay siguiente página

  const [rows] = await pool.execute(sql, args);
  const hasMore = rows.length > limit;
  const data    = hasMore ? rows.slice(0, limit) : rows;

  return {
    data,
    nextCursor: hasMore ? encodeCursor(data.at(-1).id) : null,
    hasMore,
  };
}

module.exports = { paginate, encodeCursor, decodeCursor };
