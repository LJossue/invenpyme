# InvenPyme

Sistema web de gestión de inventarios para pequeños comercios.

Proyecto del módulo **Gerencia de Proyectos Informáticos** — Politécnico Grancolombiano,
subgrupo 24.

---

## Qué hace

Cubre los doce requerimientos funcionales del documento de requerimientos:

| ID | Requerimiento | Dónde se ve |
|----|---------------|-------------|
| RF-01 | Autenticación con bloqueo tras cinco intentos fallidos | Pantalla de ingreso |
| RF-02 | Perfiles de administrador, almacenista y consulta | Menú **Usuarios** |
| RF-03 | Registrar, editar, consultar e inactivar productos | Menú **Productos** |
| RF-04 | Clasificar por categoría y unidad de medida | Formulario de producto |
| RF-05 | Registrar entradas con cantidad y costo unitario | Menú **Movimientos** |
| RF-06 | Registrar salidas por venta, avería o devolución | Menú **Movimientos** |
| RF-07 | Registrar ajustes con justificación obligatoria | Menú **Movimientos** |
| RF-08 | Mostrar existencias en tiempo real | Tablero y catálogo |
| RF-09 | Definir un nivel mínimo por producto | Formulario de producto |
| RF-10 | Avisar cuando un producto llega a su nivel mínimo | Menú **Alertas** |
| RF-11 | Reporte de existencias por categoría y producto | Menú **Reportes** |
| RF-12 | Reporte de movimientos por rango de fechas | Menú **Reportes** |

---

## Tecnología

- **Servidor:** Node.js 20+ con Express, API REST
- **Base de datos:** PostgreSQL
- **Interfaz:** React servido como página única, sin paso de compilación
- **Sesiones:** cookie firmada, almacenada en la propia base de datos
- **Contraseñas:** cifradas con BCrypt

No hay build de frontend: las librerías viven en `public/vendor/` y se sirven desde el
mismo servidor. Publicar la aplicación es publicar un solo servicio.

---

## Usuarios de prueba

Se crean solos la primera vez que arranca, cuando la base está vacía.

| Perfil | Correo | Contraseña |
|--------|--------|------------|
| Administrador | `admin@invenpyme.co` | `Admin2026*` |
| Almacenista | `almacen@invenpyme.co` | `Almacen2026*` |
| Consulta | `consulta@invenpyme.co` | `Consulta2026*` |

> Cambie estas contraseñas si el sistema va a manejar datos reales.

---

## Ejecutar en el computador

```bash
# 1. Instalar dependencias
npm install

# 2. Crear la base de datos (una sola vez)
createdb invenpyme

# 3. Configurar el entorno
cp .env.example .env     # y ajustar DATABASE_URL si hace falta

# 4. Arrancar
npm start
```

Abrir <http://localhost:8080>.

El esquema de tablas y los datos de ejemplo se crean automáticamente en el primer arranque.

### Pruebas

```bash
npm test
```

Ejecuta 14 pruebas sobre las reglas de negocio: costo promedio ponderado, existencias
insuficientes, justificación obligatoria del ajuste, generación de alertas, auditoría de
movimientos y bloqueo de cuenta.

---

## Publicar en internet

Son dos servicios gratuitos: **Neon** para la base de datos y **Render** para la aplicación.
Toma unos veinte minutos.

### Paso 1 — Base de datos en Neon

1. Crear cuenta en <https://neon.tech> (el plan gratuito no caduca).
2. **Create project**, nombre `invenpyme`, región la más cercana.
3. Copiar la cadena de conexión que aparece en *Connection string*. Se ve así:

   ```
   postgresql://usuario:clave@ep-algo-123.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

   Guárdela: es el valor de `DATABASE_URL`.

> Se recomienda Neon antes que la base gratuita de Render porque esta última se borra a los
> treinta días. Si el tutor revisa el aplicativo después de esa fecha, lo encontraría vacío.

### Paso 2 — Subir el código a GitHub

```bash
git init
git add .
git commit -m "InvenPyme: entrega final"
git branch -M main
git remote add origin https://github.com/USUARIO/invenpyme.git
git push -u origin main
```

El archivo `.gitignore` ya excluye `node_modules` y `.env`, así que las credenciales no se
suben al repositorio.

### Paso 3 — Desplegar en Render

1. Crear cuenta en <https://render.com> y conectarla con GitHub.
2. **New → Web Service** y elegir el repositorio.
3. Render lee `render.yaml` y completa la configuración solo. Si pide los datos a mano:
   - **Runtime:** Node
   - **Build command:** `npm install --omit=dev`
   - **Start command:** `npm start`
   - **Health check path:** `/salud`
4. En **Environment**, agregar estas variables:

   | Clave | Valor |
   |-------|-------|
   | `DATABASE_URL` | la cadena de Neon del paso 1 |
   | `NODE_ENV` | `production` |
   | `SESSION_SECRET` | una cadena larga y aleatoria |

   Para generar el secreto:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

5. **Create Web Service** y esperar a que el despliegue termine.

La aplicación queda en una dirección del estilo `https://invenpyme.onrender.com`.

### Verificar que quedó bien

1. Abrir `https://SU-DIRECCION/salud` — debe responder `{"estado":"ok"}`.
2. Abrir la raíz e ingresar con el usuario administrador.
3. Registrar un movimiento y comprobar que las existencias cambian.

> **Sobre el plan gratuito de Render:** el servicio se suspende tras quince minutos sin
> visitas y la primera petición después tarda cerca de un minuto en responder. No es una
> falla. Si va a mostrar el aplicativo en la sustentación, ábralo unos minutos antes.

---

## Estructura del proyecto

```
invenpyme/
├── src/
│   ├── server.js          Arranque, sesiones y archivos estáticos
│   ├── db.js              Conexión a PostgreSQL y esquema de tablas
│   ├── auth.js            Autenticación, bloqueo de cuenta y roles
│   ├── inventario.js      Reglas de negocio de los movimientos
│   ├── rutas.js           API REST
│   └── datos-iniciales.js Carga inicial de usuarios y catálogo
├── public/
│   ├── index.html
│   ├── app.js             Interfaz React
│   ├── estilos.css
│   └── vendor/            React y htm servidos localmente
├── test/
│   └── reglas.test.js     14 pruebas de las reglas de negocio
├── render.yaml            Configuración de despliegue
└── .env.example
```

---

## Modelo de datos

| Tabla | Para qué sirve |
|-------|----------------|
| `usuarios` | Cuentas, perfil, intentos fallidos y estado de bloqueo |
| `categorias` | Clasificación de productos |
| `unidades_medida` | Unidad en que se cuantifica cada producto |
| `productos` | Catálogo, existencias, nivel mínimo y costo promedio |
| `movimientos` | Historial de entradas, salidas y ajustes |
| `alertas` | Avisos de stock mínimo |
| `sesiones` | Sesiones activas (la crea `connect-pg-simple`) |

Las existencias nunca se calculan sumando el historial: viven en `productos.stock_actual` y
se actualizan dentro de la misma transacción que inserta el movimiento, con la fila del
producto bloqueada. Así dos movimientos simultáneos del mismo producto no pueden dejar el
inventario descuadrado.

---

## Decisiones que vale la pena conocer

**Las bajas son lógicas.** Inactivar un producto no lo borra: conserva su historial de
movimientos, que es lo que permite auditar el inventario hacia atrás.

**El ajuste iguala, no suma.** En un ajuste la cantidad que se escribe es el conteo físico
real, y las existencias quedan en ese valor. Es como trabaja un inventario de verdad.

**El costo es promedio ponderado.** Cada entrada recalcula el costo del producto mezclando
lo que ya había con lo que entra. Las salidas usan ese costo.

**La alerta no se repite.** Mientras haya una alerta sin atender para un producto, los
movimientos siguientes no generan otra.
