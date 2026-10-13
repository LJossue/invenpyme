import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pool, crearEsquema } from './db.js';
import { cargarDatosIniciales } from './datos-iniciales.js';
import { api } from './rutas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(__dirname, '..');

const app = express();
const puerto = Number(process.env.PORT) || 8080;
const esProduccion = process.env.NODE_ENV === 'production';

// Render y Neon sirven detras de un proxy con TLS. Sin esto la cookie segura
// no se envia porque Express cree que la conexion es HTTP.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '256kb' }));

const AlmacenSesiones = connectPgSimple(session);

app.use(session({
  name: 'invenpyme.sid',
  store: new AlmacenSesiones({ pool, tableName: 'sesiones', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'invenpyme-secreto-de-desarrollo',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,                 // RNF-04: la cookie no es accesible desde JavaScript
    secure: esProduccion,           // RNF-04: en produccion solo viaja por HTTPS
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8,     // ocho horas, una jornada de trabajo
  },
}));

app.use('/api', api);

// Comprobacion de estado, util para el monitoreo del servidor de despliegue.
app.get('/salud', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ estado: 'ok', fecha: new Date().toISOString() });
  } catch {
    res.status(503).json({ estado: 'sin base de datos' });
  }
});

app.use(express.static(path.join(raiz, 'public'), { maxAge: esProduccion ? '1h' : 0 }));

// Cualquier ruta que no sea de la API devuelve la aplicacion de pagina unica.
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(raiz, 'public', 'index.html'));
});

// Manejo central de errores: los de negocio se devuelven con su mensaje; el
// resto se registra en el log y se responde de forma generica.
app.use((error, _req, res, _next) => {
  if (error?.esDeNegocio) {
    return res.status(400).json({ mensaje: error.message });
  }
  console.error('[InvenPyme] error no controlado:', error);
  res.status(500).json({ mensaje: 'Ocurrio un error inesperado. Intente de nuevo.' });
});

export async function iniciar() {
  await crearEsquema();
  const resultado = await cargarDatosIniciales();
  if (resultado.cargado) {
    console.log(`[InvenPyme] base inicializada con ${resultado.productos} productos de ejemplo`);
  }
  return new Promise((resolve) => {
    const servidor = app.listen(puerto, () => {
      console.log(`[InvenPyme] escuchando en el puerto ${puerto}`);
      resolve(servidor);
    });
  });
}

// Solo arranca el servidor cuando el archivo se ejecuta directamente, para que
// las pruebas puedan importar la aplicacion sin levantar el puerto.
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  iniciar().catch((error) => {
    console.error('[InvenPyme] no fue posible iniciar:', error);
    process.exit(1);
  });
}

export { app };
