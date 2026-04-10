
CREATE DATABASE IF NOT EXISTS backoffice
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE backoffice;

-- ────────────────────────────────────────────────────────────
-- CUSTOMERS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  name        VARCHAR(255)    NOT NULL,
  email       VARCHAR(255)    NOT NULL,
  phone       VARCHAR(50)     NULL,
  deleted_at  DATETIME        NULL,                 -- soft-delete opcional
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE  KEY uq_customers_email  (email),
  INDEX        idx_customers_name (name),
  INDEX        idx_customers_del  (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────────────────────
-- PRODUCTS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  sku         VARCHAR(100)    NOT NULL,
  name        VARCHAR(255)    NOT NULL,
  price_cents INT UNSIGNED    NOT NULL,             -- precio en centavos (evita flotantes)
  stock       INT             NOT NULL DEFAULT 0,   -- INT con signo para detectar negativo
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE  KEY uq_products_sku  (sku),
  INDEX        idx_products_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────────────────────
-- ORDERS
-- Campos agregados respecto al schema original del requerimiento:
--   · idempotency_key  → idempotencia en POST /orders
--   · confirmed_at     → regla de cancelación de 10 min
--   · canceled_at      → auditoría de cancelaciones
--   · canceled_by      → quién canceló ('operator' | 'system')
--   · updated_at       → filtrado por fecha de cambio de estado
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  customer_id     INT UNSIGNED    NOT NULL,
  status          ENUM('CREATED','CONFIRMED','CANCELED')
                                  NOT NULL DEFAULT 'CREATED',
  total_cents     INT UNSIGNED    NOT NULL,

  idempotency_key VARCHAR(255)    NULL,             -- ← faltaba en el requerimiento
  confirmed_at    DATETIME        NULL,             -- ← faltaba en el requerimiento
  canceled_at     DATETIME        NULL,
  canceled_by     VARCHAR(50)     NULL,

  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE  KEY uq_orders_idempotency (idempotency_key),
  INDEX        idx_orders_customer  (customer_id),
  INDEX        idx_orders_status    (status),
  INDEX        idx_orders_created   (created_at),
  INDEX        idx_orders_updated   (updated_at),

  CONSTRAINT fk_orders_customer
    FOREIGN KEY (customer_id) REFERENCES customers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────────────────────
-- ORDER_ITEMS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id         INT UNSIGNED NOT NULL,
  product_id       INT UNSIGNED NOT NULL,
  qty              INT UNSIGNED NOT NULL,
  unit_price_cents INT UNSIGNED NOT NULL,           -- precio snapshot al momento de la orden
  subtotal_cents   INT UNSIGNED NOT NULL,           -- qty * unit_price_cents

  PRIMARY KEY (id),
  INDEX idx_items_order   (order_id),
  INDEX idx_items_product (product_id),

  CONSTRAINT fk_items_order
    FOREIGN KEY (order_id)   REFERENCES orders   (id),
  CONSTRAINT fk_items_product
    FOREIGN KEY (product_id) REFERENCES products (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────────────────────
-- IDEMPOTENCY_KEYS
-- Usada por Orders API y por el Lambda orquestador.
-- Campos agregados respecto al requerimiento original:
--   · http_status → para reproducir exactamente la respuesta HTTP
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS idempotency_keys (
  `key`         VARCHAR(255)    NOT NULL,
  target_type   VARCHAR(50)     NULL,               -- 'order', 'orchestrator', etc.
  target_id     INT UNSIGNED    NULL,
  status        ENUM('pending','success','failed')
                                NOT NULL DEFAULT 'pending',
  http_status   SMALLINT UNSIGNED NULL,             -- ← faltaba en el requerimiento
  response_body JSON            NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    DATETIME        NOT NULL,            -- TTL: 24h recomendado

  PRIMARY KEY (`key`),
  INDEX idx_idempotency_expires (expires_at),
  INDEX idx_idempotency_status  (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
