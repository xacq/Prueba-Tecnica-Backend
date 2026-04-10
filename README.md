# B2B — Monorepo

Sistema de gestión de pedidos B2B compuesto por dos APIs REST, un Lambda orquestador y una base de datos MySQL.

Revisar PR para observaciones iniciales para cumplimiento de requerimientos iniciales ([Comentario](https://github.com/xacq/Prueba-Tecnica-Backend/pull/1#issuecomment-4225644046)) y PR pendiente (Mejoras a aprobar https://github.com/xacq/Prueba-Tecnica-Backend/pull/1#issue-4240772804)

## Estructura del repositorio

```
/
├── customers-api/          API de clientes (puerto 3001)
├── orders-api/             API de productos y órdenes (puerto 3002)
├── lambda-orchestrator/    Lambda orquestador serverless
├── db/
│   ├── schema.sql          Definición de tablas
│   └── seed.sql            Datos de ejemplo
├── docker-compose.yml
├── .env.example
└── README.md
```

## Mapa documental y relaciones cruzadas

> Nota de lectura: los archivos `app.js` son los puntos de entrada reales en runtime.
> Los archivos `routes/*.js` documentan o agrupan la composición HTTP por dominio.
> Los `openapi.yaml` deben permanecer alineados con los controladores y validadores.

### Raíz y base de datos

| Archivo | Responsabilidad | Relación cruzada |
|---|---|---|
| `README.md` | Índice profesional, guía de arranque y mapa de lectura del sistema. | Resume el comportamiento de `docker-compose.yml`, `db/schema.sql`, `db/seed.sql`, `customers-api`, `orders-api` y `lambda-orchestrator`. |
| `docker-compose.yml` | Orquesta MySQL, Customers API y Orders API en local. | Usa `customers-api/Dockerfile`, `orders-api/Dockerfile`, `db/schema.sql` y `db/seed.sql`. |
| `db/schema.sql` | Define tablas, FKs, índices y el contrato mínimo de persistencia. | Soporta `orders-api/src/controllers/orderController.js` y `lambda-orchestrator/src/db/idempotency.js`. |
| `db/seed.sql` | Carga datos de ejemplo para clientes, productos, órdenes e idempotencia. | Se apoya en `db/schema.sql` y alimenta las pruebas descritas en `README.md`. |

### Customers API

| Archivo | Responsabilidad | Relación cruzada |
|---|---|---|
| `customers-api/package.json` | Scripts y dependencias del servicio de clientes. | Ejecuta `customers-api/src/app.js` y `customers-api/scripts/generate-token.js`. |
| `customers-api/Dockerfile` | Construye la imagen del servicio de clientes. | Arranca `customers-api/src/app.js` y se consume desde `docker-compose.yml`. |
| `customers-api/openapi.yaml` | Contrato OpenAPI 3.0 de clientes. | Debe coincidir con `src/app.js`, `controllers/customerController.js` y `middleware/auth.js`. |
| `customers-api/scripts/generate-token.js` | Genera un JWT de desarrollo para probar rutas protegidas. | Se usa con `middleware/auth.js` y se documenta en esta guía. |
| `customers-api/src/app.js` | Punto de entrada HTTP, healthcheck y montaje de rutas públicas/internas. | Depende de `middleware/auth.js`, `controllers/customerController.js`, `middleware/errorHandler.js` y `db/connection.js`. |
| `customers-api/src/routes/customers.js` | Router declarativo del contrato de clientes. | Refuerza la misma superficie HTTP que `src/app.js` y consume `controllers/customerController.js`. |
| `customers-api/src/controllers/customerController.js` | CRUD de clientes, búsqueda paginada y lookup interno. | Usa `validators/customer.js`, `utils/paginate.js` y `db/connection.js`. |
| `customers-api/src/middleware/auth.js` | Valida JWT de usuario y `SERVICE_TOKEN`. | Protege las rutas montadas por `src/app.js` y el router de clientes. |
| `customers-api/src/middleware/errorHandler.js` | Traduce errores de validación, duplicados y dominio a HTTP. | Recibe errores lanzados por `controllers/customerController.js`. |
| `customers-api/src/validators/customer.js` | Esquemas Zod para create, update y list de clientes. | Se consumen antes de ejecutar la lógica de `controllers/customerController.js`. |
| `customers-api/src/utils/paginate.js` | Helper de paginación por cursor sobre MySQL. | Lo utiliza `controllers/customerController.js` para listados consistentes. |
| `customers-api/src/db/connection.js` | Pool MySQL compartido del servicio. | Lo consumen `src/app.js` y `controllers/customerController.js`. |

### Orders API

| Archivo | Responsabilidad | Relación cruzada |
|---|---|---|
| `orders-api/package.json` | Scripts y dependencias del servicio de órdenes. | Ejecuta `orders-api/src/app.js` y habilita pruebas de `controllers/*`. |
| `orders-api/Dockerfile` | Construye la imagen del servicio de órdenes. | Arranca `orders-api/src/app.js` y se consume desde `docker-compose.yml`. |
| `orders-api/openapi.yaml` | Contrato OpenAPI 3.0 de productos y órdenes. | Debe coincidir con `src/app.js`, `routes/index.js` y los controladores. |
| `orders-api/src/app.js` | Punto de entrada HTTP, healthcheck y montaje de routers. | Depende de `routes/index.js`, `middleware/auth.js`, `middleware/errorHandler.js` y `db/connection.js`. |
| `orders-api/src/routes/index.js` | Agrupa `productRouter` y `orderRouter`. | Centraliza la composición usada por `src/app.js`. |
| `orders-api/src/controllers/productController.js` | CRUD de productos y stock. | Usa `validators/index.js` y `db/connection.js`. |
| `orders-api/src/controllers/orderController.js` | Creación, consulta, confirmación y cancelación de órdenes. | Usa `validators/index.js`, `utils/customersClient.js`, `utils/paginate.js` y `db/connection.js`. |
| `orders-api/src/middleware/auth.js` | Permite JWT de usuario y `SERVICE_TOKEN` según la ruta. | Protege `productRouter` y `orderRouter`. |
| `orders-api/src/middleware/errorHandler.js` | Traduce errores de validación, duplicados y dominio a HTTP. | Recibe errores lanzados por los controladores de órdenes y productos. |
| `orders-api/src/validators/index.js` | Esquemas Zod para productos, órdenes y filtros. | Se consumen en `controllers/productController.js` y `controllers/orderController.js`. |
| `orders-api/src/utils/paginate.js` | Helper de paginación por cursor compartido por listados. | Lo usan `productController.js` y `orderController.js` para listados consistentes. |
| `orders-api/src/utils/customersClient.js` | Cliente HTTP para validar clientes en Customers API. | Lo usa `controllers/orderController.js` para crear órdenes con cliente válido. |
| `orders-api/src/db/connection.js` | Pool MySQL compartido del servicio. | Lo consumen `src/app.js` y los controladores de órdenes/productos. |

### Lambda Orchestrator

| Archivo | Responsabilidad | Relación cruzada |
|---|---|---|
| `lambda-orchestrator/package.json` | Scripts y dependencias del orquestador. | Ejecuta `src/handler.js` con `serverless-offline` o `serverless deploy`. |
| `lambda-orchestrator/serverless.yml` | Configura runtime Node 22, variables y endpoint HTTP. | Apunta a `src/handler.js` y recibe `CUSTOMERS_API_BASE`, `ORDERS_API_BASE` y `SERVICE_TOKEN`. |
| `lambda-orchestrator/db/migration_idempotency.sql` | Migración auxiliar para ajustar la tabla de idempotencia. | Complementa `db/schema.sql` y las funciones de `src/db/idempotency.js`. |
| `lambda-orchestrator/src/handler.js` | Handler principal del flujo create-and-confirm-order. | Usa `src/apiClient.js` y `src/db/idempotency.js`. |
| `lambda-orchestrator/src/apiClient.js` | Cliente HTTP con timeout, logging y errores tipados. | Consume Customers API y Orders API usando `SERVICE_TOKEN`. |
| `lambda-orchestrator/src/db/connection.js` | Pool MySQL reutilizable para el manejo de idempotencia. | Lo consume `src/db/idempotency.js`. |
| `lambda-orchestrator/src/db/idempotency.js` | Reserva, consulta y actualiza `idempotency_keys`. | Se usa desde `src/handler.js` para hacer el flujo replay-safe. |
| `lambda-orchestrator/src/db/idempotency.test.js` | Pruebas unitarias del comportamiento de idempotencia. | Verifica la lógica implementada en `src/db/idempotency.js`. |

### Regla de trazabilidad

- Si cambia un controlador, actualizar su `openapi.yaml` y su validador asociado.
- Si cambia persistencia, revisar `db/schema.sql`, `db/seed.sql` y las consultas de los controladores.
- Si cambia el flujo orquestado, sincronizar `lambda-orchestrator/src/handler.js`, `src/apiClient.js` y `src/db/idempotency.js`.
- Si cambia variables de entorno, actualizar el README, `docker-compose.yml` y `serverless.yml`.

---

## Opción A — Levantar con Docker Compose (recomendado)

### Requisitos
- Docker Desktop instalado y corriendo
- Node.js 22+ (solo para el Lambda)

### Pasos

```bash
# 1. Clonar el repositorio
git clone <url-del-repo>
cd backoffice-b2b

# 2. Crear el .env raíz
cp .env.example .env
# Editar .env si quieres cambiar contraseñas

# 3. Construir imágenes
docker-compose build

# 4. Levantar todos los servicios
docker-compose up -d

# 5. Verificar que todo está en pie
curl http://localhost:3001/health
curl http://localhost:3002/health
```

> MySQL puede tardar 20-30 segundos en el primer arranque mientras inicializa
> el schema y el seed. Los servicios esperan automáticamente gracias a `depends_on`.

### Detener los servicios

```bash
docker-compose down          # detiene y elimina contenedores (datos persisten)
docker-compose down -v       # detiene y elimina contenedores + volumen MySQL
```

---

## Opción B — Levantar en local con XAMPP (sin Docker)

### Requisitos
- XAMPP con MySQL corriendo en puerto 3306
- Node.js 22+

### Pasos

```bash
# 1. Crear la base de datos
#    Abrir phpMyAdmin → pestaña SQL → pegar y ejecutar:
#      db/schema.sql
#      db/seed.sql

# 2. Configurar customers-api
cd customers-api
cp .env.example .env
# Editar .env: DB_PASS= (vacío si XAMPP no tiene contraseña en root)
npm install
npm run dev        # puerto 3001

# 3. Configurar orders-api (nueva terminal)
cd orders-api
cp .env.example .env
# Editar .env: DB_PASS=, CUSTOMERS_INTERNAL_URL=http://localhost:3001
npm install
npm run dev        # puerto 3002

# 4. Verificar
curl http://localhost:3001/health
curl http://localhost:3002/health
```

---

## Variables de entorno

### Raíz `.env` (para docker-compose)

| Variable             | Descripción                                  | Default  |
|----------------------|----------------------------------------------|----------|
| `MYSQL_ROOT_PASSWORD`| Contraseña root de MySQL                     | `secret` |
| `MYSQL_DATABASE`     | Nombre de la base de datos                   | `backoffice` |
| `JWT_SECRET`         | Secreto para firmar JWT de usuarios          | *(requerido)* |
| `SERVICE_TOKEN`      | Token para comunicación entre servicios      | *(requerido)* |
| `NODE_ENV`           | Entorno de ejecución                         | `production` |

### `customers-api/.env`

| Variable        | Descripción                        | Default local        |
|-----------------|------------------------------------|----------------------|
| `PORT`          | Puerto del servidor                | `3001`               |
| `DB_HOST`       | Host de MySQL                      | `127.0.0.1`          |
| `DB_PORT`       | Puerto de MySQL                    | `3306`               |
| `DB_NAME`       | Nombre de la base de datos         | `backoffice`         |
| `DB_USER`       | Usuario de MySQL                   | `root`               |
| `DB_PASS`       | Contraseña de MySQL                | *(vacío en XAMPP)*   |
| `JWT_SECRET`    | Secreto JWT (igual en todos)       | `dev-jwt-secret`     |
| `SERVICE_TOKEN` | Token entre servicios (igual en todos) | `dev-service-token` |

### `orders-api/.env`

Igual que `customers-api` más:

| Variable                 | Descripción                              | Default local              |
|--------------------------|------------------------------------------|----------------------------|
| `PORT`                   | Puerto del servidor                      | `3002`                     |
| `CUSTOMERS_INTERNAL_URL` | URL base de Customers API                | `http://localhost:3001`    |

> En Docker Compose este valor es `http://customers-api:3001` (nombre del servicio en la red interna). En local con XAMPP es `http://localhost:3001`.

### `lambda-orchestrator/.env`

| Variable               | Descripción                          | Default local           |
|------------------------|--------------------------------------|-------------------------|
| `CUSTOMERS_API_BASE`   | URL base de Customers API            | `http://localhost:3001` |
| `ORDERS_API_BASE`      | URL base de Orders API               | `http://localhost:3002` |
| `SERVICE_TOKEN`        | Token entre servicios (igual en todos)| `dev-service-token`    |
| `DB_HOST`              | Host de MySQL para idempotency_keys  | `127.0.0.1`             |
| `DB_NAME`              | Nombre de la base de datos           | `backoffice`            |
| `DB_USER`              | Usuario de MySQL                     | `root`                  |
| `DB_PASS`              | Contraseña de MySQL                  | *(vacío en XAMPP)*      |

---

## Generar JWT para pruebas

```bash
cd customers-api
cp .env.example .env
node scripts/generate-token.js
# Imprime el token listo para copiar en Authorization: Bearer <token>
```

---

## Ejemplos cURL

### Customers API

```bash
# Exportar el JWT para no repetirlo
export JWT="Bearer TU_TOKEN_AQUI"

# Crear cliente
curl -X POST http://localhost:3001/customers \
  -H "Authorization: $JWT" \
  -H "Content-Type: application/json" \
  -d '{"name":"ACME Corp","email":"ops@acme.com","phone":"+593 99 111 2233"}'

# Obtener cliente
curl http://localhost:3001/customers/1 \
  -H "Authorization: $JWT"

# Buscar clientes
curl "http://localhost:3001/customers?search=acme&limit=10" \
  -H "Authorization: $JWT"

# Actualizar cliente
curl -X PUT http://localhost:3001/customers/1 \
  -H "Authorization: $JWT" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+593 99 999 9999"}'

# Soft-delete
curl -X DELETE http://localhost:3001/customers/1 \
  -H "Authorization: $JWT"

# Endpoint interno (usa SERVICE_TOKEN)
curl http://localhost:3001/internal/customers/1 \
  -H "Authorization: Bearer dev-service-token"
```

### Orders API — Productos

```bash
# Crear producto
curl -X POST http://localhost:3002/products \
  -H "Authorization: $JWT" \
  -H "Content-Type: application/json" \
  -d '{"sku":"PROD-X1","name":"Producto X","price_cents":9900,"stock":50}'

# Actualizar stock y precio
curl -X PATCH http://localhost:3002/products/1 \
  -H "Authorization: $JWT" \
  -H "Content-Type: application/json" \
  -d '{"stock":100,"price_cents":8900}'

# Listar productos
curl "http://localhost:3002/products?search=laptop&limit=5" \
  -H "Authorization: $JWT"
```

### Orders API — Órdenes

```bash
# Crear orden
curl -X POST http://localhost:3002/orders \
  -H "Authorization: $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": 1,
    "items": [
      {"product_id": 1, "qty": 2},
      {"product_id": 2, "qty": 1}
    ],
    "idempotency_key": "orden-001"
  }'

# Confirmar orden (idempotente)
curl -X POST http://localhost:3002/orders/1/confirm \
  -H "Authorization: $JWT" \
  -H "X-Idempotency-Key: confirm-orden-001"

# Cancelar orden
curl -X POST http://localhost:3002/orders/1/cancel \
  -H "Authorization: $JWT"

# Obtener orden con items
curl http://localhost:3002/orders/1 \
  -H "Authorization: $JWT"

# Listar órdenes con filtros
curl "http://localhost:3002/orders?status=CONFIRMED&limit=10" \
  -H "Authorization: $JWT"
```

### Lambda orquestador

```bash
# Invocar en local (con serverless-offline corriendo)
curl -X POST http://localhost:3000/orchestrator/create-and-confirm-order \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": 1,
    "items": [{"product_id": 2, "qty": 3}],
    "idempotency_key": "lambda-test-001",
    "correlation_id": "req-001"
  }'

# Reintentar con la misma key → debe devolver exactamente la misma respuesta
curl -X POST http://localhost:3000/orchestrator/create-and-confirm-order \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": 1,
    "items": [{"product_id": 2, "qty": 3}],
    "idempotency_key": "lambda-test-001",
    "correlation_id": "req-001"
  }'
```

---

## Invocar el Lambda

### Local con serverless-offline

```bash
cd lambda-orchestrator
cp .env.example .env
# Asegurarse de que CUSTOMERS_API_BASE=http://localhost:3001
# y ORDERS_API_BASE=http://localhost:3002
npm install
npm run dev    # levanta en http://localhost:3000
```

### Exponer con ngrok (para pruebas desde fuera de la máquina)

```bash
# En una terminal: serverless-offline corriendo en 3000
npm run dev

# En otra terminal
ngrok http 3000
# ngrok mostrará una URL pública tipo https://abc123.ngrok.io
# Endpoint: https://abc123.ngrok.io/orchestrator/create-and-confirm-order
```

### Desplegar en AWS

```bash
# Configurar credenciales AWS primero
aws configure

# Setear las variables de entorno con las URLs reales de las APIs desplegadas
export CUSTOMERS_API_BASE=https://tu-customers-api.ejemplo.com
export ORDERS_API_BASE=https://tu-orders-api.ejemplo.com
export SERVICE_TOKEN=token-seguro-de-produccion
export DB_HOST=tu-rds-host.rds.amazonaws.com
export DB_NAME=backoffice
export DB_USER=admin
export DB_PASS=contraseña-segura

cd lambda-orchestrator
serverless deploy --stage prod

# El output mostrará la URL del endpoint:
# endpoint: POST - https://xxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/orchestrator/create-and-confirm-order
```

---

## Respuesta esperada del Lambda (201)

```json
{
  "success": true,
  "correlationId": "req-001",
  "data": {
    "customer": {
      "id": 1,
      "name": "ACME Corporation",
      "email": "ops@acme.com",
      "phone": "+593 99 111 2233"
    },
    "order": {
      "id": 4,
      "status": "CONFIRMED",
      "total_cents": 29700,
      "items": [
        {
          "product_id": 2,
          "qty": 3,
          "unit_price_cents": 9900,
          "subtotal_cents": 29700
        }
      ],
      "confirmed_at": "2025-01-15T14:32:10.000Z"
    }
  }
}
```

---

## URLs base

| Servicio            | Local                                      |
|---------------------|--------------------------------------------|
| Customers API       | http://localhost:3001                      |
| Orders API          | http://localhost:3002                      |
| Lambda (offline)    | http://localhost:3000                      |
| MySQL               | localhost:3306 / base de datos: backoffice |

---

## Notas sobre XAMPP vs Docker

Cuando use **XAMPP** el Lambda y los scripts locales de Node apuntan a `localhost`. Cuando use **Docker Compose**, los servicios se comunican por nombre de servicio (`customers-api`, `orders-api`, `mysql`). Las variables de entorno en `docker-compose.yml` ya están configuradas con los nombres correctos para la red interna de Docker.

El Lambda **siempre corre fuera de Docker** (con `serverless-offline`), por lo que su `.env` siempre debe apuntar a `localhost:3001` y `localhost:3002`.
