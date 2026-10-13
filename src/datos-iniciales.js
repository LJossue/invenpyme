import { pool } from './db.js';
import { cifrar } from './auth.js';
import { registrarMovimiento } from './inventario.js';

/*
 * Carga la informacion minima para que el sistema sea utilizable apenas se
 * despliega. Solo se ejecuta cuando la base de datos esta vacia, de modo que
 * nunca sobrescribe los datos reales del comercio.
 */

export async function cargarDatosIniciales() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM usuarios');
  if (rows[0].total > 0) {
    return { cargado: false };
  }

  // -------------------------------------------------------------- usuarios
  const usuarios = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES
       ($1,$2,$3,'ADMIN'),
       ($4,$5,$6,'ALMACENISTA'),
       ($7,$8,$9,'CONSULTA')
     RETURNING id, rol`,
    [
      'Administrador del comercio', 'admin@invenpyme.co', await cifrar('Admin2026*'),
      'Almacenista', 'almacen@invenpyme.co', await cifrar('Almacen2026*'),
      'Usuario de consulta', 'consulta@invenpyme.co', await cifrar('Consulta2026*'),
    ]
  );
  const adminId = usuarios.rows.find((u) => u.rol === 'ADMIN').id;

  // ------------------------------------------------------------ categorias
  const categorias = await pool.query(
    `INSERT INTO categorias (nombre, descripcion) VALUES
       ('Abarrotes','Productos de despensa'),
       ('Bebidas','Bebidas frias y calientes'),
       ('Aseo','Productos de aseo del hogar'),
       ('Papeleria','Utiles escolares y de oficina')
     RETURNING id, nombre`
  );
  const cat = Object.fromEntries(categorias.rows.map((c) => [c.nombre, c.id]));

  // -------------------------------------------------------------- unidades
  const unidades = await pool.query(
    `INSERT INTO unidades_medida (nombre, abreviatura) VALUES
       ('Unidad','und'), ('Libra','lb'), ('Kilogramo','kg'),
       ('Litro','L'), ('Paquete','paq')
     RETURNING id, nombre`
  );
  const uni = Object.fromEntries(unidades.rows.map((u) => [u.nombre, u.id]));

  // -------------------------------------------------------------- catalogo
  const catalogo = [
    ['ABA-001', 'Arroz blanco', 'Arroz blanco de primera', 'Abarrotes', 'Libra', 20],
    ['ABA-002', 'Panela cuadrada', 'Panela de cana', 'Abarrotes', 'Unidad', 15],
    ['ABA-003', 'Aceite de cocina', 'Aceite vegetal de 1 litro', 'Abarrotes', 'Litro', 10],
    ['ABA-004', 'Azucar refinada', 'Azucar blanca', 'Abarrotes', 'Libra', 25],
    ['BEB-001', 'Gaseosa 1.5 L', 'Bebida gaseosa familiar', 'Bebidas', 'Unidad', 24],
    ['BEB-002', 'Cafe molido 500 g', 'Cafe tostado y molido', 'Bebidas', 'Unidad', 12],
    ['BEB-003', 'Agua en botella 600 ml', 'Agua sin gas', 'Bebidas', 'Unidad', 30],
    ['ASE-001', 'Jabon en polvo 1 kg', 'Detergente para ropa', 'Aseo', 'Unidad', 18],
    ['ASE-002', 'Limpiador multiusos', 'Limpiador liquido', 'Aseo', 'Litro', 10],
    ['PAP-001', 'Cuaderno cuadriculado', 'Cuaderno de 100 hojas', 'Papeleria', 'Unidad', 20],
  ];

  const productos = {};
  for (const [codigo, nombre, descripcion, categoria, unidad, minimo] of catalogo) {
    const fila = await pool.query(
      `INSERT INTO productos (codigo, nombre, descripcion, categoria_id, unidad_id, stock_minimo)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [codigo, nombre, descripcion, cat[categoria], uni[unidad], minimo]
    );
    productos[codigo] = fila.rows[0].id;
  }

  // ---------------------------------------------------- entradas iniciales
  const entradas = [
    ['ABA-001', 150, 2800], ['ABA-002', 80, 3200], ['ABA-003', 60, 9500],
    ['ABA-004', 120, 2600], ['BEB-001', 120, 3900], ['BEB-002', 40, 14500],
    ['BEB-003', 200, 1100], ['ASE-001', 35, 11200], ['ASE-002', 25, 7800],
    ['PAP-001', 60, 4300],
  ];
  for (const [codigo, cantidad, costo] of entradas) {
    await registrarMovimiento({
      productoId: productos[codigo], tipo: 'ENTRADA',
      cantidad, costoUnitario: costo, justificacion: 'Inventario inicial',
    }, adminId);
  }

  // Algunas ventas. La del cafe y la del limpiador dejan esos productos en su
  // nivel minimo, de modo que las alertas se vean desde el primer ingreso.
  const salidas = [
    ['ABA-001', 35], ['ABA-004', 40], ['BEB-001', 48],
    ['BEB-002', 28], ['BEB-003', 65], ['ASE-002', 15],
  ];
  for (const [codigo, cantidad] of salidas) {
    await registrarMovimiento({
      productoId: productos[codigo], tipo: 'SALIDA',
      cantidad, motivo: 'VENTA', justificacion: 'Venta de mostrador',
    }, adminId);
  }

  return { cargado: true, productos: catalogo.length };
}
