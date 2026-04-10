# B2B — Monorepo

Sistema de gestión de pedidos B2B compuesto por dos APIs REST, un Lambda orquestador y una base de datos MySQL.

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

Cuando usas **XAMPP** el Lambda y los scripts locales de Node apuntan a `localhost`. Cuando usas **Docker Compose**, los servicios se comunican por nombre de servicio (`customers-api`, `orders-api`, `mysql`). Las variables de entorno en `docker-compose.yml` ya están configuradas con los nombres correctos para la red interna de Docker.

El Lambda **siempre corre fuera de Docker** (con `serverless-offline`), por lo que su `.env` siempre debe apuntar a `localhost:3001` y `localhost:3002`.
