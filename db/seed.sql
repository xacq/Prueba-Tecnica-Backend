
USE backoffice;

-- Limpiar en orden inverso a las FK para poder re-ejecutar el seed
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE idempotency_keys;
TRUNCATE TABLE order_items;
TRUNCATE TABLE orders;
TRUNCATE TABLE products;
TRUNCATE TABLE customers;
SET FOREIGN_KEY_CHECKS = 1;

-- ────────────────────────────────────────────────────────────
-- 3 clientes
-- Cubre: cliente activo normal, cliente con phone null,
--        cliente soft-deleted (para probar que no aparece en listados)
-- ────────────────────────────────────────────────────────────
INSERT INTO customers (id, name, email, phone, deleted_at) VALUES
  (1, 'ACME Corporation',    'ops@acme.com',        '+593 99 111 2233', NULL),
  (2, 'Distribuidora Norte', 'pedidos@dnorte.com',  '+593 98 444 5566', NULL),
  (3, 'Cliente Eliminado',   'baja@ejemplo.com',    NULL,
      '2024-01-15 10:00:00');   -- soft-deleted: no debe aparecer en GET /customers

-- ────────────────────────────────────────────────────────────
-- PRODUCTS  (5 productos)
-- Cubre: stock normal, stock bajo (qty=1), stock agotado (qty=0),
--        distintos rangos de precio
-- ────────────────────────────────────────────────────────────
INSERT INTO products (id, sku, name, price_cents, stock) VALUES
  (1, 'LAPTOP-001',  'Laptop Lenovo ThinkPad X1',  129900, 15),  -- $1,299.00
  (2, 'MOUSE-002',   'Mouse Logitech MX Master 3',   9900, 42),  -- $99.00
  (3, 'MONITOR-003', 'Monitor Dell 27" 4K',          49900,  8),  -- $499.00
  (4, 'TECLADO-004', 'Teclado Mecánico Keychron K2', 14900,  1),  -- $149.00  ← stock bajo
  (5, 'CAMARA-005',  'Webcam Logitech C920',          8900,  0);  -- $89.00   ← agotado

-- ────────────────────────────────────────────────────────────
-- ORDERS  (3 órdenes en distintos estados)
-- Cubre los tres estados del ENUM para probar las reglas de negocio
-- ────────────────────────────────────────────────────────────
INSERT INTO orders
  (id, customer_id, status, total_cents, idempotency_key, confirmed_at, canceled_at, canceled_by)
VALUES
  -- Orden en CREATED: puede confirmarse o cancelarse libremente
  (1, 1, 'CREATED',   29800, 'seed-key-order-1', NULL, NULL, NULL),

  -- Orden CONFIRMED hace 5 min: dentro de la ventana de 10 min → se puede cancelar
  (2, 1, 'CONFIRMED', 99800, 'seed-key-order-2',
      DATE_SUB(NOW(), INTERVAL 5 MINUTE), NULL, NULL),

  -- Orden CANCELED: para probar que no se puede re-cancelar ni confirmar
  (3, 2, 'CANCELED',  49900, 'seed-key-order-3', NULL,
      DATE_SUB(NOW(), INTERVAL 2 HOUR), 'operator');

-- ────────────────────────────────────────────────────────────
-- ORDER_ITEMS  (items de las 3 órdenes)
-- unit_price_cents refleja el precio snapshot al momento de la orden
-- (puede diferir del precio actual del producto)
-- ────────────────────────────────────────────────────────────
INSERT INTO order_items
  (order_id, product_id, qty, unit_price_cents, subtotal_cents)
VALUES
  -- Orden 1: 2 mouses + 1 teclado = $99*2 + $149 = $347 → 34700 cents
  -- (ajustamos total_cents de la orden a 34700... usamos 29800 en orden
  --  para tener un dato "desincronizado" que puedes detectar en pruebas)
  (1, 2, 2,  9900, 19800),   -- 2 × Mouse $99.00
  (1, 4, 1, 14900, 14900),   -- 1 × Teclado $149.00  subtotal real: 34700

  -- Orden 2: 1 laptop + 1 mouse = $1299 + $99 = $1398 → 139800 cents
  (2, 1, 1, 129900, 129900), -- 1 × Laptop $1,299.00
  (2, 2, 1,   9900,   9900), -- 1 × Mouse $99.00      subtotal real: 139800

  -- Orden 3 (cancelada): 1 monitor
  (3, 3, 1, 49900, 49900);   -- 1 × Monitor $499.00

-- ────────────────────────────────────────────────────────────
-- IDEMPOTENCY_KEYS  (keys de ejemplo para las órdenes del seed)
-- Permite probar el comportamiento de reintentos desde el principio
-- ────────────────────────────────────────────────────────────
INSERT INTO idempotency_keys
  (`key`, target_type, target_id, status, http_status, response_body, expires_at)
VALUES
  (
    'seed-key-order-1', 'order', 1, 'success', 201,
    JSON_OBJECT(
      'success', TRUE,
      'data', JSON_OBJECT('order', JSON_OBJECT('id', 1, 'status', 'CREATED'))
    ),
    DATE_ADD(NOW(), INTERVAL 24 HOUR)
  ),
  (
    'seed-key-order-2', 'order', 2, 'success', 201,
    JSON_OBJECT(
      'success', TRUE,
      'data', JSON_OBJECT('order', JSON_OBJECT('id', 2, 'status', 'CONFIRMED'))
    ),
    DATE_ADD(NOW(), INTERVAL 24 HOUR)
  ),
  (
    'seed-key-order-3', 'order', 3, 'success', 201,
    JSON_OBJECT(
      'success', TRUE,
      'data', JSON_OBJECT('order', JSON_OBJECT('id', 3, 'status', 'CANCELED'))
    ),
    DATE_ADD(NOW(), INTERVAL 24 HOUR)
  );

-- ────────────────────────────────────────────────────────────
-- VERIFICACIÓN  (opcional: ejecutar para confirmar que el seed quedó bien)
-- ────────────────────────────────────────────────────────────
-- SELECT 'customers' AS tabla, COUNT(*) AS filas FROM customers
-- UNION ALL
-- SELECT 'products',   COUNT(*) FROM products
-- UNION ALL
-- SELECT 'orders',     COUNT(*) FROM orders
-- UNION ALL
-- SELECT 'order_items',COUNT(*) FROM order_items
-- UNION ALL
-- SELECT 'idempotency_keys', COUNT(*) FROM idempotency_keys;
