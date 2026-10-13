import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { ErrorNegocio } from './inventario.js';

/*
 * RF-01 y RF-02. Autenticacion, bloqueo de cuenta tras cinco intentos fallidos
 * y control de acceso por rol.
 *
 * RNF-04: las contrasenas se guardan con hash BCrypt, nunca en texto plano.
 */

export const MAX_INTENTOS = 5;

export async function cifrar(password) {
  return bcrypt.hash(password, 10);
}

/**
 * Valida las credenciales. Devuelve el usuario o lanza un error de negocio con
 * el motivo exacto del rechazo.
 */
export async function autenticar(email, password) {
  const correo = String(email || '').trim().toLowerCase();
  const { rows } = await pool.query(
    `SELECT id, nombre, email, password_hash, rol, activo, intentos_fallidos, bloqueado
       FROM usuarios WHERE lower(email) = $1`,
    [correo]
  );
  const usuario = rows[0];

  // Mismo mensaje para usuario inexistente y contrasena incorrecta, para no
  // revelar que correos estan registrados.
  if (!usuario) throw new ErrorNegocio('Correo o contrasena incorrectos');

  if (usuario.bloqueado) {
    throw new ErrorNegocio(
      'La cuenta esta bloqueada por superar los cinco intentos fallidos. ' +
      'Solicite al administrador que la libere.'
    );
  }
  if (!usuario.activo) {
    throw new ErrorNegocio('La cuenta esta inactiva. Comuniquese con el administrador.');
  }

  const correcta = await bcrypt.compare(String(password || ''), usuario.password_hash);

  if (!correcta) {
    const intentos = usuario.intentos_fallidos + 1;
    const bloquear = intentos >= MAX_INTENTOS;
    await pool.query(
      `UPDATE usuarios SET intentos_fallidos = $1, bloqueado = $2 WHERE id = $3`,
      [intentos, bloquear, usuario.id]
    );
    if (bloquear) {
      throw new ErrorNegocio(
        'La cuenta quedo bloqueada por superar los cinco intentos fallidos. ' +
        'Solicite al administrador que la libere.'
      );
    }
    const restantes = MAX_INTENTOS - intentos;
    throw new ErrorNegocio(
      `Correo o contrasena incorrectos. Le quedan ${restantes} intento(s) antes del bloqueo.`
    );
  }

  if (usuario.intentos_fallidos > 0) {
    await pool.query(`UPDATE usuarios SET intentos_fallidos = 0 WHERE id = $1`, [usuario.id]);
  }

  return {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
  };
}

/** Exige que haya una sesion abierta. */
export function requiereSesion(req, res, next) {
  if (!req.session?.usuario) {
    return res.status(401).json({ mensaje: 'Debe iniciar sesion' });
  }
  next();
}

/** RF-02: restringe una operacion a los roles indicados. */
export function requiereRol(...roles) {
  return (req, res, next) => {
    const usuario = req.session?.usuario;
    if (!usuario) {
      return res.status(401).json({ mensaje: 'Debe iniciar sesion' });
    }
    if (!roles.includes(usuario.rol)) {
      return res.status(403).json({
        mensaje: 'Su perfil no tiene permiso para realizar esta operacion',
      });
    }
    next();
  };
}
