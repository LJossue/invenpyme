import { enTransaccion } from './db.js';

/*
 * Reglas de negocio del inventario (RF-05 a RF-10).
 *
 * Todo movimiento se procesa dentro de una transaccion y bloquea la fila del
 * producto con SELECT ... FOR UPDATE. Esto evita que dos movimientos
 * simultaneos del mismo producto dejen las existencias descuadradas, que es el
 * riesgo R-07 del registro de riesgos del proyecto.
 */

export class ErrorNegocio extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorNegocio';
    this.esDeNegocio = true;
  }
}

const TIPOS = ['ENTRADA', 'SALIDA', 'AJUSTE'];
const MOTIVOS = ['VENTA', 'AVERIA', 'DEVOLUCION'];

function aNumero(valor, campo) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) {
    throw new ErrorNegocio(`El campo ${campo} debe ser un numero`);
  }
  return numero;
}

/**
 * Registra un movimiento, actualiza las existencias del producto y genera la
 * alerta de stock minimo cuando corresponde.
 */
export async function registrarMovimiento(datos, usuarioId) {
  const tipo = String(datos.tipo || '').toUpperCase();
  if (!TIPOS.includes(tipo)) {
    throw new ErrorNegocio('El tipo de movimiento debe ser ENTRADA, SALIDA o AJUSTE');
  }

  const productoId = Number(datos.productoId);
  if (!Number.isInteger(productoId)) {
    throw new ErrorNegocio('Seleccione un producto');
  }

  const cantidad = aNumero(datos.cantidad, 'cantidad');

  return enTransaccion(async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT id, nombre, stock_actual, stock_minimo, costo_promedio, activo
         FROM productos WHERE id = $1 FOR UPDATE`,
      [productoId]
    );
    const producto = rows[0];
    if (!producto) throw new ErrorNegocio('El producto no existe');
    if (!producto.activo) {
      throw new ErrorNegocio('No se pueden registrar movimientos de un producto inactivo');
    }

    const stockPrevio = Number(producto.stock_actual);
    const costoPrevio = Number(producto.costo_promedio);

    let stockNuevo;
    let costoNuevo = costoPrevio;
    let motivo = null;
    let costoUnitario = null;
    let justificacion = datos.justificacion ? String(datos.justificacion).trim() : null;

    if (tipo === 'ENTRADA') {
      // RF-05: entrada de mercancia con cantidad y costo unitario.
      if (cantidad <= 0) throw new ErrorNegocio('La cantidad debe ser mayor que cero');
      costoUnitario = aNumero(datos.costoUnitario, 'costo unitario');
      if (costoUnitario < 0) throw new ErrorNegocio('El costo unitario no puede ser negativo');

      stockNuevo = stockPrevio + cantidad;
      // Costo promedio ponderado entre lo que ya habia y lo que entra.
      costoNuevo = stockNuevo > 0
        ? (stockPrevio * costoPrevio + cantidad * costoUnitario) / stockNuevo
        : costoUnitario;

    } else if (tipo === 'SALIDA') {
      // RF-06: salida por venta, averia o devolucion.
      if (cantidad <= 0) throw new ErrorNegocio('La cantidad debe ser mayor que cero');
      motivo = String(datos.motivo || '').toUpperCase();
      if (!MOTIVOS.includes(motivo)) {
        throw new ErrorNegocio('La salida requiere un motivo: venta, averia o devolucion');
      }
      if (cantidad > stockPrevio) {
        throw new ErrorNegocio(
          `Existencias insuficientes. Disponible: ${stockPrevio.toFixed(2)}`
        );
      }
      stockNuevo = stockPrevio - cantidad;
      costoUnitario = costoPrevio;

    } else {
      // RF-07: ajuste por conteo fisico, con justificacion obligatoria.
      if (cantidad < 0) throw new ErrorNegocio('El conteo fisico no puede ser negativo');
      if (!justificacion) throw new ErrorNegocio('El ajuste requiere una justificacion');
      stockNuevo = cantidad;
      costoUnitario = costoPrevio;
    }

    await cliente.query(
      `UPDATE productos SET stock_actual = $1, costo_promedio = $2 WHERE id = $3`,
      [stockNuevo.toFixed(2), costoNuevo.toFixed(2), productoId]
    );

    // RNF-07: el movimiento guarda quien lo hizo y cuando.
    const insercion = await cliente.query(
      `INSERT INTO movimientos
         (producto_id, tipo, motivo, cantidad, costo_unitario,
          justificacion, stock_resultante, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, fecha`,
      [
        productoId, tipo, motivo, cantidad.toFixed(2),
        costoUnitario === null ? null : costoUnitario.toFixed(2),
        justificacion, stockNuevo.toFixed(2), usuarioId,
      ]
    );

    // RF-10: alerta cuando el producto queda en su nivel minimo o por debajo.
    const stockMinimo = Number(producto.stock_minimo);
    let alertaGenerada = false;
    if (stockNuevo <= stockMinimo) {
      const pendiente = await cliente.query(
        `SELECT 1 FROM alertas WHERE producto_id = $1 AND atendida = FALSE LIMIT 1`,
        [productoId]
      );
      if (pendiente.rowCount === 0) {
        await cliente.query(
          `INSERT INTO alertas (producto_id, stock_actual, stock_minimo)
           VALUES ($1,$2,$3)`,
          [productoId, stockNuevo.toFixed(2), stockMinimo.toFixed(2)]
        );
        alertaGenerada = true;
      }
    }

    return {
      id: insercion.rows[0].id,
      fecha: insercion.rows[0].fecha,
      producto: producto.nombre,
      tipo,
      motivo,
      cantidad,
      stockResultante: stockNuevo,
      alertaGenerada,
    };
  });
}
