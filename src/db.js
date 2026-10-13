import pg from 'pg';

/*
 * Conexion a PostgreSQL y creacion del esquema.
 *
 * Los valores numericos de PostgreSQL llegan a Node como cadena para no perder
 * precision. Como el inventario trabaja con dos decimales, se convierten a
 * numero solo al momento de responder, y toda la aritmetica de existencias se
 * hace dentro de la base de datos.
 */

const { Pool } = pg;

const esProduccion = process.env.NODE_ENV === 'production';

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@127.0.0.1:5432/invenpyme',
  // Render y Neon exigen TLS; en local no hay certificado que validar.
  ssl: esProduccion ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
});

/** Ejecuta una funcion dentro de una transaccion y hace rollback si algo falla. */
export async function enTransaccion(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
}

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id                SERIAL PRIMARY KEY,
  nombre            VARCHAR(120)  NOT NULL,
  email             VARCHAR(150)  NOT NULL UNIQUE,
  password_hash     VARCHAR(100)  NOT NULL,
  rol               VARCHAR(20)   NOT NULL CHECK (rol IN ('ADMIN','ALMACENISTA','CONSULTA')),
  activo            BOOLEAN       NOT NULL DEFAULT TRUE,
  intentos_fallidos INTEGER       NOT NULL DEFAULT 0,
  bloqueado         BOOLEAN       NOT NULL DEFAULT FALSE,
  creado_en         TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categorias (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(80)  NOT NULL UNIQUE,
  descripcion VARCHAR(250),
  activo      BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS unidades_medida (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(50) NOT NULL UNIQUE,
  abreviatura VARCHAR(10) NOT NULL
);

CREATE TABLE IF NOT EXISTS productos (
  id             SERIAL PRIMARY KEY,
  codigo         VARCHAR(40)  NOT NULL UNIQUE,
  nombre         VARCHAR(150) NOT NULL,
  descripcion    VARCHAR(400),
  categoria_id   INTEGER      NOT NULL REFERENCES categorias(id),
  unidad_id      INTEGER      NOT NULL REFERENCES unidades_medida(id),
  stock_actual   NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock_minimo   NUMERIC(12,2) NOT NULL DEFAULT 0,
  costo_promedio NUMERIC(14,2) NOT NULL DEFAULT 0,
  activo         BOOLEAN       NOT NULL DEFAULT TRUE,
  creado_en      TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS movimientos (
  id               SERIAL PRIMARY KEY,
  producto_id      INTEGER       NOT NULL REFERENCES productos(id),
  tipo             VARCHAR(15)   NOT NULL CHECK (tipo IN ('ENTRADA','SALIDA','AJUSTE')),
  motivo           VARCHAR(15)   CHECK (motivo IN ('VENTA','AVERIA','DEVOLUCION')),
  cantidad         NUMERIC(12,2) NOT NULL,
  costo_unitario   NUMERIC(14,2),
  justificacion    VARCHAR(300),
  stock_resultante NUMERIC(12,2) NOT NULL,
  usuario_id       INTEGER       NOT NULL REFERENCES usuarios(id),
  fecha            TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_movimientos_fecha    ON movimientos (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_movimientos_producto ON movimientos (producto_id);
CREATE INDEX IF NOT EXISTS idx_productos_categoria  ON productos (categoria_id);

CREATE TABLE IF NOT EXISTS alertas (
  id           SERIAL PRIMARY KEY,
  producto_id  INTEGER       NOT NULL REFERENCES productos(id),
  stock_actual NUMERIC(12,2) NOT NULL,
  stock_minimo NUMERIC(12,2) NOT NULL,
  fecha        TIMESTAMP     NOT NULL DEFAULT NOW(),
  atendida     BOOLEAN       NOT NULL DEFAULT FALSE
);
`;

export async function crearEsquema() {
  await pool.query(ESQUEMA);
}

/** Cierra el pool, usado por las pruebas y por el apagado ordenado del servidor. */
export async function cerrar() {
  await pool.end();
}
