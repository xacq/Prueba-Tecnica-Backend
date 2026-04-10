'use strict';

/**
 * orders-api/src/utils/paginate.js
 *
 * Helper de cursor pagination para listados de productos y órdenes.
 * Evita OFFSET y mantiene el acceso por índice sobre id.
 */

const encodeCursor = (id) =>
  Buffer.from(String(id)).toString('base64');

const decodeCursor = (cursor) =>
  Number(Buffer.from(cursor, 'base64').toString('ascii'));

async function paginate(pool, { table, where = '1=1', params = [],
  cursor, limit = 20, select = '*', orderBy = 'id ASC' }) {

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
    ORDER BY ${orderBy}
    LIMIT ?`;

  args.push(limit + 1);

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
