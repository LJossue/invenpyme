/*
 * Pruebas automatizadas de las reglas de negocio del inventario.
 *
 * Cubren los casos de prueba CP-05 a CP-10 del plan de gestion de la calidad.
 * Se ejecutan con: npm test
 *
 * Requieren una base PostgreSQL disponible en DATABASE_URL. Cada prueba parte
 * de datos propios para no depender del orden de ejecucion.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { pool, crearEsquema, cerrar } from '../src/db.js';
import { registrarMovimiento, ErrorNegocio } from '../src/inventario.js';
import { autenticar, cifrar } from '../src/auth.js';

let usuarioId;
let categoriaId;
let unidadId;
let contador = 0;

/** Crea un producto nuevo para cada prueba, con su codigo irrepetible. */
async function nuevoProducto(stockMinimo = 0) {
  contador += 1;
  const { rows } = await pool.query(
    `INSERT INTO productos (codigo, nombre, categoria_id, unidad_id, stock_minimo)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [`TEST-${Date.now()}-${contador}`, `Producto de prueba ${contador}`,
     categoriaId, unidadId, stockMinimo]
  );
  return rows[0].id;
}

async function leerProducto(id) {
  const { rows } = await pool.query(
    `SELECT stock_actual, costo_promedio FROM productos WHERE id = $1`, [id]);
  return {
    stock: Number(rows[0].stock_actual),
    costo: Number(rows[0].costo_promedio),
  };
}

before(async () => {
  await crearEsquema();

  const usuario = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol)
     VALUES ('Usuario de pruebas', $1, $2, 'ADMIN') RETURNING id`,
    [`pruebas-${Date.now()}@invenpyme.co`, await cifrar('Pruebas2026*')]
  );
  usuarioId = usuario.rows[0].id;

  const categoria = await pool.query(
    `INSERT INTO categorias (nombre) VALUES ($1) RETURNING id`,
    [`Categoria de pruebas ${Date.now()}`]
  );
  categoriaId = categoria.rows[0].id;

  const unidad = await pool.query(
    `INSERT INTO unidades_medida (nombre, abreviatura) VALUES ($1,'ut') RETURNING id`,
    [`Unidad de pruebas ${Date.now()}`]
  );
  unidadId = unidad.rows[0].id;
});

after(async () => {
  await cerrar();
});

// ------------------------------------------------------------------- RF-05

test('CP-05: una entrada suma existencias y fija el costo promedio', async () => {
  const id = await nuevoProducto();
  await registrarMovimiento(
    { productoId: id, tipo: 'ENTRADA', cantidad: 100, costoUnitario: 2000 }, usuarioId);

  const producto = await leerProducto(id);
  assert.equal(producto.stock, 100);
  assert.equal(producto.costo, 2000);
});

test('CP-05b: dos entradas calculan el costo promedio ponderado', async () => {
  const id = await nuevoProducto();
  await registrarMovimiento(
    { productoId: id, tipo: 'ENTRADA', cantidad: 100, costoUnitario: 1000 }, usuarioId);
  await registrarMovimiento(
    { productoId: id, tipo: 'ENTRADA', cantidad: 100, costoUnitario: 2000 }, usuarioId);

  const producto = await leerProducto(id);
  assert.equal(producto.stock, 200);
  // (100*1000 + 100*2000) / 200 = 1500
  assert.equal(producto.costo, 1500);
});

test('CP-05c: la entrada exige costo unitario', async () => {
  const id = await nuevoProducto();
  await assert.rejects(
    () => registrarMovimiento({ productoId: id, tipo: 'ENTRADA', cantidad: 10 }, usuarioId),
    ErrorNegocio
  );
});

// ------------------------------------------------------------------- RF-06

test('CP-06: una salida resta existencias', async () => {
  const id = await nuevoProducto();
  await registrarMovimiento(
    { productoId: id, tipo: 'ENTRADA', cantidad: 50, costoUnitario: 1000 }, usuarioId);
  await registrarMovimiento(
    { productoId: id, tipo: 'SALIDA', cantidad: 20, motivo: 'VENTA' }, usuarioId);

  assert.equal((await leerProducto(id)).stock, 30);
});

test('CP-06b: la salida exige un motivo valido', async () => {
  const id = await nuevoProducto();
  await registrarMovimiento(
    { productoId: id, tipo: 'ENTRADA', cantidad: 10, costoUnitario: 500 }, usuarioId);

  await assert.rejects(
    () => registrarMovimiento({ productoId: id, tipo: 'SALIDA', cantidad: 5 }, usuarioId),
    /motivo/
  );
  await assert.rejects(
    () => registrarMovimiento(
      { productoId: id, tipo: 'SALIDA', cantidad: 5, motivo: 'REGALO' }, usuarioId),
    /motivo/
  );
});

test('CP-07: no se puede sacar mas de lo disponible', async () => {
  const id = await nuevoProducto();
  await registrarMovimiento(
    { productoId: id, tipo: 'ENTRADA', cantidad: 10, costoUnitario: 1000 }, usuarioId);

  await assert.rejects(
    () => registrarMovimiento(
      { productoId: id, tipo: 'SALIDA', cantidad: 11, motivo: 'VENTA' }, usuarioId),
    /insuficientes/
  );
  // El rechazo no debe alterar las existencias.
  assert.equal((await leerProducto(id)).stock, 10);
});

// ------------------------------------------------------------------- RF-07

test('CP-08: el ajuste iguala las existencias al conteo fisico', async () => {
  const id = await nuevoProducto();
  await registrarMovimiento(
    { productoId: id, tipo: 'ENTRADA', cantidad: 100, costoUnitario: 1000 }, usuarioId);
  await registrarMovimiento(
    { productoId: id, tipo: 'AJUSTE', cantidad: 93, justificacion: 'Faltante en conteo' },
    usuarioId);

  assert.equal((await leerProducto(id)).stock, 93);
});

test('CP-08b: el ajuste exige justificacion', async () => {
  const id = await nuevoProducto();
  await assert.rejects(
    () => registrarMovimiento({ productoId: id, tipo: 'AJUSTE', cantidad: 5 }, usuarioId),
    /justificacion/
  );
});

// ------------------------------------------------------------------- RF-10

test('CP-09: al llegar al nivel minimo se genera una alerta', async () => {
  const id = await nuevoProducto(10);
  await registrarMovimiento(
    { productoId: id, tipo: 'ENTRADA', cantidad: 30, costoUnitario: 1000 }, usuarioId);

  const sinAlerta = await pool.query(
    `SELECT COUNT(*)::int AS total FROM alertas WHERE producto_id = $1`, [id]);
  assert.equal(sinAlerta.rows[0].total, 0, 'no debe haber alerta por encima del minimo');

  const resultado = await registrarMovimiento(
    { productoId: id, tipo: 'SALIDA', cantidad: 20, motivo: 'VENTA' }, usuarioId);

  assert.equal(resultado.alertaGenerada, true);
  const conAlerta = await pool.query(
    `SELECT COUNT(*)::int AS total FROM alertas WHERE producto_id = $1 AND atendida = FALSE`,
    [id]
  );
  assert.equal(conAlerta.rows[0].total, 1);
});

test('CP-09b: no se duplica la alerta mientras siga sin atender', async () => {
  const id = await nuevoProducto(10);
  await registrarMovimiento(
    { productoId: id, tipo: 'ENTRADA', cantidad: 30, costoUnitario: 1000 }, usuarioId);
  await registrarMovimiento(
    { productoId: id, tipo: 'SALIDA', cantidad: 20, motivo: 'VENTA' }, usuarioId);
  await registrarMovimiento(
    { productoId: id, tipo: 'SALIDA', cantidad: 5, motivo: 'VENTA' }, usuarioId);

  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM alertas WHERE producto_id = $1`, [id]);
  assert.equal(rows[0].total, 1);
});

// --------------------------------------------------------- RNF-07 auditoria

test('CP-10: cada movimiento guarda usuario, fecha y existencias resultantes', async () => {
  const id = await nuevoProducto();
  await registrarMovimiento(
    { productoId: id, tipo: 'ENTRADA', cantidad: 7, costoUnitario: 300 }, usuarioId);

  const { rows } = await pool.query(
    `SELECT usuario_id, fecha, stock_resultante FROM movimientos
      WHERE producto_id = $1 ORDER BY id DESC LIMIT 1`, [id]);

  assert.equal(rows[0].usuario_id, usuarioId);
  assert.ok(rows[0].fecha instanceof Date);
  assert.equal(Number(rows[0].stock_resultante), 7);
});

// ------------------------------------------------------------------- RF-01

test('CP-01: el quinto intento fallido bloquea la cuenta', async () => {
  const correo = `bloqueo-${Date.now()}@invenpyme.co`;
  await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol)
     VALUES ('Cuenta de bloqueo', $1, $2, 'CONSULTA')`,
    [correo, await cifrar('Correcta2026*')]
  );

  for (let intento = 1; intento <= 5; intento += 1) {
    await assert.rejects(() => autenticar(correo, 'incorrecta'), ErrorNegocio);
  }

  // Con la contrasena correcta ya no debe dejar entrar.
  await assert.rejects(() => autenticar(correo, 'Correcta2026*'), /bloqueada/);

  const { rows } = await pool.query(
    `SELECT bloqueado, intentos_fallidos FROM usuarios WHERE email = $1`, [correo]);
  assert.equal(rows[0].bloqueado, true);
  assert.equal(rows[0].intentos_fallidos, 5);
});

test('CP-02: un ingreso correcto reinicia el contador de intentos', async () => {
  const correo = `reinicio-${Date.now()}@invenpyme.co`;
  await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol)
     VALUES ('Cuenta de reinicio', $1, $2, 'CONSULTA')`,
    [correo, await cifrar('Correcta2026*')]
  );

  await assert.rejects(() => autenticar(correo, 'mala'), ErrorNegocio);
  await assert.rejects(() => autenticar(correo, 'mala'), ErrorNegocio);

  const usuario = await autenticar(correo, 'Correcta2026*');
  assert.equal(usuario.rol, 'CONSULTA');

  const { rows } = await pool.query(
    `SELECT intentos_fallidos FROM usuarios WHERE email = $1`, [correo]);
  assert.equal(rows[0].intentos_fallidos, 0);
});

test('CP-03: la contrasena nunca se guarda en texto plano', async () => {
  const correo = `cifrado-${Date.now()}@invenpyme.co`;
  const clave = 'ClaveEnTextoPlano2026*';
  await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol)
     VALUES ('Cuenta de cifrado', $1, $2, 'CONSULTA')`,
    [correo, await cifrar(clave)]
  );

  const { rows } = await pool.query(
    `SELECT password_hash FROM usuarios WHERE email = $1`, [correo]);

  assert.notEqual(rows[0].password_hash, clave);
  assert.match(rows[0].password_hash, /^\$2[aby]\$/, 'debe ser un hash BCrypt');
});
