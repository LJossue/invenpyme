import { Router } from 'express';
import { pool } from './db.js';
import { autenticar, cifrar, requiereRol, requiereSesion } from './auth.js';
import { ErrorNegocio, registrarMovimiento } from './inventario.js';

/*
 * API REST de InvenPyme. Cada bloque esta marcado con el requerimiento
 * funcional del documento de requerimientos que implementa.
 */

export const api = Router();

/** Envuelve un manejador asincrono para que los errores lleguen al middleware. */
const asinc = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const numero = (valor) => (valor === null || valor === undefined ? null : Number(valor));

function productoSalida(fila) {
  const stock = numero(fila.stock_actual);
  const minimo = numero(fila.stock_minimo);
  const costo = numero(fila.costo_promedio);
  return {
    id: fila.id,
    codigo: fila.codigo,
    nombre: fila.nombre,
    descripcion: fila.descripcion,
    categoriaId: fila.categoria_id,
    categoria: fila.categoria,
    unidadId: fila.unidad_id,
    unidad: fila.unidad,
    stockActual: stock,
    stockMinimo: minimo,
    costoPromedio: costo,
    valorizado: Number((stock * costo).toFixed(2)),
    enNivelMinimo: stock <= minimo,
    activo: fila.activo,
  };
}

function movimientoSalida(fila) {
  return {
    id: fila.id,
    productoId: fila.producto_id,
    producto: fila.producto,
    codigo: fila.codigo,
    tipo: fila.tipo,
    motivo: fila.motivo,
    cantidad: numero(fila.cantidad),
    costoUnitario: numero(fila.costo_unitario),
    stockResultante: numero(fila.stock_resultante),
    justificacion: fila.justificacion,
    usuario: fila.usuario,
    fecha: fila.fecha,
  };
}

const SELECT_PRODUCTO = `
  SELECT p.id, p.codigo, p.nombre, p.descripcion, p.stock_actual, p.stock_minimo,
         p.costo_promedio, p.activo,
         c.id AS categoria_id, c.nombre AS categoria,
         u.id AS unidad_id, u.abreviatura AS unidad
    FROM productos p
    JOIN categorias c      ON c.id = p.categoria_id
    JOIN unidades_medida u ON u.id = p.unidad_id`;

const SELECT_MOVIMIENTO = `
  SELECT m.id, m.producto_id, m.tipo, m.motivo, m.cantidad, m.costo_unitario,
         m.justificacion, m.stock_resultante, m.fecha,
         p.nombre AS producto, p.codigo,
         us.nombre AS usuario
    FROM movimientos m
    JOIN productos p ON p.id = m.producto_id
    JOIN usuarios us ON us.id = m.usuario_id`;

// ============================================================ RF-01 y RF-02

api.post('/auth/login', asinc(async (req, res) => {
  const { email, password } = req.body ?? {};
  const usuario = await autenticar(email, password);
  // Renovar el identificador de sesion al iniciar sesion evita la fijacion de sesion.
  await new Promise((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve())));
  req.session.usuario = usuario;
  res.json(usuario);
}));

api.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('invenpyme.sid');
    res.status(204).end();
  });
});

api.get('/auth/estado', (req, res) => {
  if (!req.session?.usuario) {
    return res.status(401).json({ mensaje: 'Sin sesion activa' });
  }
  res.json(req.session.usuario);
});

// ================================================================== catalogo

api.get('/categorias', requiereSesion, asinc(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, nombre, descripcion FROM categorias WHERE activo = TRUE ORDER BY nombre`
  );
  res.json(rows);
}));

api.get('/unidades', requiereSesion, asinc(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, nombre, abreviatura FROM unidades_medida ORDER BY nombre`
  );
  res.json(rows);
}));

// =========================================================== RF-03 y RF-04

api.get('/productos', requiereSesion, asinc(async (req, res) => {
  const { texto, categoriaId, incluirInactivos } = req.query;
  const condiciones = [];
  const valores = [];

  if (incluirInactivos !== 'true') {
    condiciones.push('p.activo = TRUE');
  }
  if (texto) {
    valores.push(`%${String(texto).trim()}%`);
    condiciones.push(`(p.nombre ILIKE $${valores.length} OR p.codigo ILIKE $${valores.length})`);
  }
  if (categoriaId) {
    valores.push(Number(categoriaId));
    condiciones.push(`p.categoria_id = $${valores.length}`);
  }

  const where = condiciones.length ? ` WHERE ${condiciones.join(' AND ')}` : '';
  const { rows } = await pool.query(`${SELECT_PRODUCTO}${where} ORDER BY p.nombre`, valores);
  res.json(rows.map(productoSalida));
}));

api.get('/productos/:id', requiereSesion, asinc(async (req, res) => {
  const { rows } = await pool.query(`${SELECT_PRODUCTO} WHERE p.id = $1`, [Number(req.params.id)]);
  if (!rows[0]) throw new ErrorNegocio('El producto no existe');
  res.json(productoSalida(rows[0]));
}));

function validarProducto(cuerpo) {
  const codigo = String(cuerpo.codigo || '').trim();
  const nombre = String(cuerpo.nombre || '').trim();
  const categoriaId = Number(cuerpo.categoriaId);
  const unidadId = Number(cuerpo.unidadId);
  const stockMinimo = Number(cuerpo.stockMinimo ?? 0);

  if (!codigo) throw new ErrorNegocio('El codigo es obligatorio');
  if (!nombre) throw new ErrorNegocio('El nombre es obligatorio');
  if (!Number.isInteger(categoriaId)) throw new ErrorNegocio('Seleccione una categoria');
  if (!Number.isInteger(unidadId)) throw new ErrorNegocio('Seleccione una unidad de medida');
  if (!Number.isFinite(stockMinimo) || stockMinimo < 0) {
    throw new ErrorNegocio('El stock minimo no puede ser negativo');
  }

  return {
    codigo, nombre, categoriaId, unidadId, stockMinimo,
    descripcion: cuerpo.descripcion ? String(cuerpo.descripcion).trim() : null,
  };
}

api.post('/productos', requiereRol('ADMIN', 'ALMACENISTA'), asinc(async (req, res) => {
  const datos = validarProducto(req.body ?? {});

  const existe = await pool.query(`SELECT 1 FROM productos WHERE lower(codigo) = lower($1)`,
    [datos.codigo]);
  if (existe.rowCount > 0) {
    throw new ErrorNegocio(`Ya existe un producto con el codigo ${datos.codigo}`);
  }

  const { rows } = await pool.query(
    `INSERT INTO productos (codigo, nombre, descripcion, categoria_id, unidad_id, stock_minimo)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [datos.codigo, datos.nombre, datos.descripcion, datos.categoriaId,
     datos.unidadId, datos.stockMinimo.toFixed(2)]
  );

  const creado = await pool.query(`${SELECT_PRODUCTO} WHERE p.id = $1`, [rows[0].id]);
  res.status(201).json(productoSalida(creado.rows[0]));
}));

api.put('/productos/:id', requiereRol('ADMIN', 'ALMACENISTA'), asinc(async (req, res) => {
  const id = Number(req.params.id);
  const datos = validarProducto(req.body ?? {});

  const repetido = await pool.query(
    `SELECT 1 FROM productos WHERE lower(codigo) = lower($1) AND id <> $2`, [datos.codigo, id]);
  if (repetido.rowCount > 0) {
    throw new ErrorNegocio(`Ya existe otro producto con el codigo ${datos.codigo}`);
  }

  const actualizado = await pool.query(
    `UPDATE productos
        SET codigo = $1, nombre = $2, descripcion = $3,
            categoria_id = $4, unidad_id = $5, stock_minimo = $6
      WHERE id = $7 RETURNING id`,
    [datos.codigo, datos.nombre, datos.descripcion, datos.categoriaId,
     datos.unidadId, datos.stockMinimo.toFixed(2), id]
  );
  if (actualizado.rowCount === 0) throw new ErrorNegocio('El producto no existe');

  const fila = await pool.query(`${SELECT_PRODUCTO} WHERE p.id = $1`, [id]);
  res.json(productoSalida(fila.rows[0]));
}));

/** RF-03: la baja es logica, para conservar el historial de movimientos. */
api.delete('/productos/:id', requiereRol('ADMIN'), asinc(async (req, res) => {
  const resultado = await pool.query(
    `UPDATE productos SET activo = FALSE WHERE id = $1`, [Number(req.params.id)]);
  if (resultado.rowCount === 0) throw new ErrorNegocio('El producto no existe');
  res.status(204).end();
}));

api.put('/productos/:id/reactivar', requiereRol('ADMIN'), asinc(async (req, res) => {
  await pool.query(`UPDATE productos SET activo = TRUE WHERE id = $1`, [Number(req.params.id)]);
  res.status(204).end();
}));

// ===================================================== RF-05, RF-06 y RF-07

api.get('/movimientos', requiereSesion, asinc(async (req, res) => {
  const { productoId } = req.query;
  const { rows } = productoId
    ? await pool.query(`${SELECT_MOVIMIENTO} WHERE m.producto_id = $1 ORDER BY m.fecha DESC`,
        [Number(productoId)])
    : await pool.query(`${SELECT_MOVIMIENTO} ORDER BY m.fecha DESC LIMIT 50`);
  res.json(rows.map(movimientoSalida));
}));

api.post('/movimientos', requiereRol('ADMIN', 'ALMACENISTA'), asinc(async (req, res) => {
  const resultado = await registrarMovimiento(req.body ?? {}, req.session.usuario.id);
  res.status(201).json(resultado);
}));

// ==================================================================== RF-10

api.get('/alertas', requiereSesion, asinc(async (req, res) => {
  const todas = req.query.todas === 'true';
  const { rows } = await pool.query(
    `SELECT a.id, a.producto_id, a.stock_actual, a.stock_minimo, a.fecha, a.atendida,
            p.nombre AS producto, p.codigo
       FROM alertas a
       JOIN productos p ON p.id = a.producto_id
      ${todas ? '' : 'WHERE a.atendida = FALSE'}
      ORDER BY a.fecha DESC`
  );
  res.json(rows.map((f) => ({
    id: f.id,
    productoId: f.producto_id,
    producto: f.producto,
    codigo: f.codigo,
    stockActual: numero(f.stock_actual),
    stockMinimo: numero(f.stock_minimo),
    fecha: f.fecha,
    atendida: f.atendida,
  })));
}));

api.put('/alertas/:id/atender', requiereRol('ADMIN', 'ALMACENISTA'), asinc(async (req, res) => {
  const resultado = await pool.query(
    `UPDATE alertas SET atendida = TRUE WHERE id = $1`, [Number(req.params.id)]);
  if (resultado.rowCount === 0) throw new ErrorNegocio('La alerta no existe');
  res.status(204).end();
}));

// =========================================================== RF-11 y RF-12

/** Tablero inicial. */
api.get('/reportes/resumen', requiereSesion, asinc(async (_req, res) => {
  const totales = await pool.query(
    `SELECT COUNT(*)::int AS productos,
            COALESCE(SUM(stock_actual * costo_promedio), 0) AS valor,
            COUNT(*) FILTER (WHERE stock_actual <= stock_minimo)::int AS en_minimo
       FROM productos WHERE activo = TRUE`
  );
  const alertas = await pool.query(
    `SELECT COUNT(*)::int AS pendientes FROM alertas WHERE atendida = FALSE`);
  const ultimos = await pool.query(`${SELECT_MOVIMIENTO} ORDER BY m.fecha DESC LIMIT 8`);

  res.json({
    productosActivos: totales.rows[0].productos,
    productosEnMinimo: totales.rows[0].en_minimo,
    valorInventario: numero(totales.rows[0].valor),
    alertasPendientes: alertas.rows[0].pendientes,
    ultimosMovimientos: ultimos.rows.map(movimientoSalida),
  });
}));

/** RF-11: existencias por categoria y por producto. */
api.get('/reportes/existencias', requiereSesion, asinc(async (req, res) => {
  const { categoriaId } = req.query;
  const valores = [];
  let filtro = ' WHERE p.activo = TRUE';
  if (categoriaId) {
    valores.push(Number(categoriaId));
    filtro += ` AND p.categoria_id = $1`;
  }

  const { rows } = await pool.query(
    `${SELECT_PRODUCTO}${filtro} ORDER BY c.nombre, p.nombre`, valores);
  const productos = rows.map(productoSalida);

  const mapa = new Map();
  for (const producto of productos) {
    if (!mapa.has(producto.categoria)) {
      mapa.set(producto.categoria, { categoria: producto.categoria, detalle: [] });
    }
    mapa.get(producto.categoria).detalle.push(producto);
  }

  const grupos = [...mapa.values()].map((grupo) => ({
    categoria: grupo.categoria,
    productos: grupo.detalle.length,
    unidades: Number(grupo.detalle.reduce((s, p) => s + p.stockActual, 0).toFixed(2)),
    valorizado: Number(grupo.detalle.reduce((s, p) => s + p.valorizado, 0).toFixed(2)),
    detalle: grupo.detalle,
  }));

  res.json({
    grupos,
    totalProductos: productos.length,
    productosEnMinimo: productos.filter((p) => p.enNivelMinimo).length,
    totalUnidades: Number(grupos.reduce((s, g) => s + g.unidades, 0).toFixed(2)),
    totalValorizado: Number(grupos.reduce((s, g) => s + g.valorizado, 0).toFixed(2)),
  });
}));

/** RF-12: movimientos de un rango de fechas. */
api.get('/reportes/movimientos', requiereSesion, asinc(async (req, res) => {
  const { desde, hasta } = req.query;
  if (!desde || !hasta) {
    throw new ErrorNegocio('Indique la fecha inicial y la fecha final');
  }
  if (String(desde) > String(hasta)) {
    throw new ErrorNegocio('La fecha inicial no puede ser posterior a la final');
  }

  const { rows } = await pool.query(
    `${SELECT_MOVIMIENTO}
      WHERE m.fecha >= $1::date AND m.fecha < ($2::date + INTERVAL '1 day')
      ORDER BY m.fecha DESC`,
    [String(desde), String(hasta)]
  );
  const movimientos = rows.map(movimientoSalida);

  const sumaPorTipo = (tipo) => Number(
    movimientos.filter((m) => m.tipo === tipo)
      .reduce((s, m) => s + m.cantidad, 0).toFixed(2));

  res.json({
    movimientos,
    cantidadMovimientos: movimientos.length,
    totalEntradas: sumaPorTipo('ENTRADA'),
    totalSalidas: sumaPorTipo('SALIDA'),
    totalAjustes: sumaPorTipo('AJUSTE'),
  });
}));

// ==================================================================== RF-02

api.get('/usuarios', requiereRol('ADMIN'), asinc(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, nombre, email, rol, activo, bloqueado, intentos_fallidos
       FROM usuarios ORDER BY nombre`
  );
  res.json(rows.map((f) => ({
    id: f.id, nombre: f.nombre, email: f.email, rol: f.rol,
    activo: f.activo, bloqueado: f.bloqueado, intentosFallidos: f.intentos_fallidos,
  })));
}));

api.post('/usuarios', requiereRol('ADMIN'), asinc(async (req, res) => {
  const { nombre, email, password, rol } = req.body ?? {};
  if (!String(nombre || '').trim()) throw new ErrorNegocio('El nombre es obligatorio');
  if (!String(email || '').includes('@')) throw new ErrorNegocio('Indique un correo valido');
  if (!['ADMIN', 'ALMACENISTA', 'CONSULTA'].includes(rol)) {
    throw new ErrorNegocio('Seleccione un perfil valido');
  }
  if (!password || String(password).length < 6) {
    throw new ErrorNegocio('La contrasena debe tener al menos 6 caracteres');
  }

  const correo = String(email).trim().toLowerCase();
  const existe = await pool.query(`SELECT 1 FROM usuarios WHERE lower(email) = $1`, [correo]);
  if (existe.rowCount > 0) throw new ErrorNegocio('Ya existe un usuario con ese correo');

  const { rows } = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol)
     VALUES ($1,$2,$3,$4) RETURNING id, nombre, email, rol, activo, bloqueado`,
    [String(nombre).trim(), correo, await cifrar(String(password)), rol]
  );
  res.status(201).json(rows[0]);
}));

/** RF-01: el administrador libera una cuenta bloqueada. */
api.put('/usuarios/:id/desbloquear', requiereRol('ADMIN'), asinc(async (req, res) => {
  const resultado = await pool.query(
    `UPDATE usuarios SET bloqueado = FALSE, intentos_fallidos = 0 WHERE id = $1`,
    [Number(req.params.id)]
  );
  if (resultado.rowCount === 0) throw new ErrorNegocio('El usuario no existe');
  res.status(204).end();
}));

api.put('/usuarios/:id/estado', requiereRol('ADMIN'), asinc(async (req, res) => {
  const activo = req.body?.activo === true;
  if (Number(req.params.id) === req.session.usuario.id && !activo) {
    throw new ErrorNegocio('No puede inactivar su propia cuenta');
  }
  await pool.query(`UPDATE usuarios SET activo = $1 WHERE id = $2`,
    [activo, Number(req.params.id)]);
  res.status(204).end();
}));
