-- ============================================================
-- Migración: ajustes al schema original del requerimiento
-- Ejecutar después del schema.sql base
-- ============================================================

-- 1. Agregar http_status a idempotency_keys
--    (necesario para guardar y reproducir el código HTTP exacto)
ALTER TABLE idempotency_keys
  ADD COLUMN http_status SMALLINT UNSIGNED NULL
    AFTER status;

-- 2. Cambiar response_body a tipo JSON
--    (si se creó como TEXT, convertirlo para validación automática de MySQL)
ALTER TABLE idempotency_keys
  MODIFY COLUMN response_body JSON NULL;

-- 3. Agregar confirmed_at a orders
--    (necesario para la regla de cancelación de 10 minutos sobre CONFIRMED)
ALTER TABLE orders
  ADD COLUMN confirmed_at DATETIME NULL
    AFTER total_cents;

-- 4. Índice en expires_at para que el DELETE de limpieza sea eficiente
CREATE INDEX IF NOT EXISTS idx_idempotency_expires
  ON idempotency_keys (expires_at);

-- 5. Índice en status para las consultas por key+status
CREATE INDEX IF NOT EXISTS idx_idempotency_status
  ON idempotency_keys (status);
