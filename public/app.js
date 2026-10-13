/*
 * InvenPyme — interfaz web.
 *
 * Aplicacion de pagina unica construida con React. Se usa htm en lugar de JSX
 * para que el proyecto no necesite un paso de compilacion: el navegador carga
 * el archivo tal como esta y el despliegue se reduce a publicar el servidor.
 */

const { useState, useEffect, useCallback } = React;
const html = htm.bind(React.createElement);

// --------------------------------------------------------------- utilidades

async function api(ruta, opciones = {}) {
  const respuesta = await fetch('/api' + ruta, {
    method: opciones.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
  });

  if (respuesta.status === 204) return null;

  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error(datos.mensaje || 'Ocurrio un error inesperado');
  }
  return datos;
}

const pesos = (valor) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0,
  }).format(Number(valor) || 0);

const numero = (valor) =>
  new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(Number(valor) || 0);

const fechaHora = (iso) =>
  new Date(iso).toLocaleString('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

const hoy = () => new Date().toISOString().slice(0, 10);
const haceUnMes = () => {
  const fecha = new Date();
  fecha.setMonth(fecha.getMonth() - 1);
  return fecha.toISOString().slice(0, 10);
};

const puedeEditar = (rol) => rol === 'ADMIN' || rol === 'ALMACENISTA';

// ------------------------------------------------------------- componentes

function Aviso({ tipo, children }) {
  if (!children) return null;
  return html`<div class=${'aviso aviso--' + tipo}>${children}</div>`;
}

function Vacio({ children }) {
  return html`<div class="vacio">${children}</div>`;
}

function Modal({ titulo, children, onCerrar }) {
  return html`
    <div class="modal-fondo" onClick=${(e) => e.target === e.currentTarget && onCerrar()}>
      <div class="modal" role="dialog" aria-modal="true">
        <h3 class="modal__titulo">${titulo}</h3>
        ${children}
      </div>
    </div>`;
}

// ------------------------------------------------------------------ ingreso

function Ingreso({ onEntrar }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento) {
    evento.preventDefault();
    setError('');
    setEnviando(true);
    try {
      const usuario = await api('/auth/login', { method: 'POST', cuerpo: { email, password } });
      onEntrar(usuario);
    } catch (e) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return html`
    <div class="ingreso">
      <form class="ingreso__tarjeta" onSubmit=${enviar}>
        <h1 class="ingreso__marca">InvenPyme</h1>
        <p class="ingreso__lema">Gestión de inventarios para pequeños comercios</p>

        <${Aviso} tipo="error">${error}<//>

        <div class="campo">
          <label for="correo">Correo electrónico</label>
          <input id="correo" type="email" value=${email} autoComplete="username"
                 onChange=${(e) => setEmail(e.target.value)} required />
        </div>

        <div class="campo">
          <label for="clave">Contraseña</label>
          <input id="clave" type="password" value=${password} autoComplete="current-password"
                 onChange=${(e) => setPassword(e.target.value)} required />
        </div>

        <button class="boton boton--ancho" type="submit" disabled=${enviando}>
          ${enviando ? 'Verificando…' : 'Entrar'}
        </button>

        <div class="ingreso__ayuda">
          <strong>Usuarios de prueba</strong><br />
          Administrador: <code>admin@invenpyme.co</code> / <code>Admin2026*</code><br />
          Almacenista: <code>almacen@invenpyme.co</code> / <code>Almacen2026*</code><br />
          Consulta: <code>consulta@invenpyme.co</code> / <code>Consulta2026*</code>
        </div>
      </form>
    </div>`;
}

// ------------------------------------------------------------------ tablero

function Tablero() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/reportes/resumen').then(setDatos).catch((e) => setError(e.message));
  }, []);

  if (error) return html`<${Aviso} tipo="error">${error}<//>`;
  if (!datos) return html`<${Vacio}>Cargando…<//>`;

  return html`
    <div>
      <h2>Tablero</h2>
      <p class="subtitulo">Estado del inventario al día de hoy</p>

      <div class="indicadores">
        <div class="indicador">
          <div class="indicador__etiqueta">Productos activos</div>
          <div class="indicador__valor">${datos.productosActivos}</div>
        </div>
        <div class="indicador">
          <div class="indicador__etiqueta">Valor del inventario</div>
          <div class="indicador__valor">${pesos(datos.valorInventario)}</div>
        </div>
        <div class=${'indicador' + (datos.productosEnMinimo > 0 ? ' indicador--alerta' : '')}>
          <div class="indicador__etiqueta">En nivel mínimo</div>
          <div class="indicador__valor">${datos.productosEnMinimo}</div>
        </div>
        <div class=${'indicador' + (datos.alertasPendientes > 0 ? ' indicador--alerta' : '')}>
          <div class="indicador__etiqueta">Alertas sin atender</div>
          <div class="indicador__valor">${datos.alertasPendientes}</div>
        </div>
      </div>

      <div class="tarjeta">
        <p class="tarjeta__titulo">Últimos movimientos</p>
        ${datos.ultimosMovimientos.length === 0
          ? html`<${Vacio}>Todavía no se han registrado movimientos.<//>`
          : html`
            <div class="tabla-envoltura">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th><th>Tipo</th><th>Producto</th>
                    <th class="num">Cantidad</th><th class="num">Existencias</th><th>Usuario</th>
                  </tr>
                </thead>
                <tbody>
                  ${datos.ultimosMovimientos.map((m) => html`
                    <tr key=${m.id}>
                      <td>${fechaHora(m.fecha)}</td>
                      <td><span class=${'etiqueta etiqueta--' + m.tipo.toLowerCase()}>${m.tipo}</span></td>
                      <td>${m.producto}</td>
                      <td class="num">${numero(m.cantidad)}</td>
                      <td class="num">${numero(m.stockResultante)}</td>
                      <td>${m.usuario}</td>
                    </tr>`)}
                </tbody>
              </table>
            </div>`}
      </div>
    </div>`;
}

// ----------------------------------------------------------------- productos

function FormularioProducto({ producto, categorias, unidades, onGuardar, onCerrar }) {
  const [valores, setValores] = useState({
    codigo: producto?.codigo || '',
    nombre: producto?.nombre || '',
    descripcion: producto?.descripcion || '',
    categoriaId: producto?.categoriaId || categorias[0]?.id || '',
    unidadId: producto?.unidadId || unidades[0]?.id || '',
    stockMinimo: producto?.stockMinimo ?? 0,
  });
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cambiar = (campo) => (e) => setValores({ ...valores, [campo]: e.target.value });

  async function enviar(evento) {
    evento.preventDefault();
    setError('');
    setEnviando(true);
    try {
      const cuerpo = {
        ...valores,
        categoriaId: Number(valores.categoriaId),
        unidadId: Number(valores.unidadId),
        stockMinimo: Number(valores.stockMinimo),
      };
      if (producto) {
        await api(`/productos/${producto.id}`, { method: 'PUT', cuerpo });
      } else {
        await api('/productos', { method: 'POST', cuerpo });
      }
      onGuardar();
    } catch (e) {
      setError(e.message);
      setEnviando(false);
    }
  }

  return html`
    <${Modal} titulo=${producto ? 'Editar producto' : 'Nuevo producto'} onCerrar=${onCerrar}>
      <form onSubmit=${enviar}>
        <${Aviso} tipo="error">${error}<//>

        <div class="rejilla">
          <div class="campo">
            <label>Código</label>
            <input value=${valores.codigo} onChange=${cambiar('codigo')} required />
          </div>
          <div class="campo">
            <label>Nivel mínimo</label>
            <input type="number" step="0.01" min="0" value=${valores.stockMinimo}
                   onChange=${cambiar('stockMinimo')} required />
            <div class="pista">Al llegar a este valor se genera la alerta</div>
          </div>
        </div>

        <div class="campo">
          <label>Nombre</label>
          <input value=${valores.nombre} onChange=${cambiar('nombre')} required />
        </div>

        <div class="campo">
          <label>Descripción</label>
          <input value=${valores.descripcion} onChange=${cambiar('descripcion')} />
        </div>

        <div class="rejilla">
          <div class="campo">
            <label>Categoría</label>
            <select value=${valores.categoriaId} onChange=${cambiar('categoriaId')}>
              ${categorias.map((c) => html`<option key=${c.id} value=${c.id}>${c.nombre}</option>`)}
            </select>
          </div>
          <div class="campo">
            <label>Unidad de medida</label>
            <select value=${valores.unidadId} onChange=${cambiar('unidadId')}>
              ${unidades.map((u) => html`
                <option key=${u.id} value=${u.id}>${u.nombre} (${u.abreviatura})</option>`)}
            </select>
          </div>
        </div>

        <div class="modal__pie">
          <button type="button" class="boton boton--suave" onClick=${onCerrar}>Cancelar</button>
          <button type="submit" class="boton" disabled=${enviando}>
            ${enviando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    <//>`;
}

function Productos({ rol }) {
  const [productos, setProductos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [unidades, setUnidades] = useState([]);
  const [texto, setTexto] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [editando, setEditando] = useState(null);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState('');
  const [exito, setExito] = useState('');

  const cargar = useCallback(async () => {
    try {
      const parametros = new URLSearchParams();
      if (texto) parametros.set('texto', texto);
      if (categoriaId) parametros.set('categoriaId', categoriaId);
      setProductos(await api('/productos?' + parametros.toString()));
    } catch (e) {
      setError(e.message);
    }
  }, [texto, categoriaId]);

  useEffect(() => {
    api('/categorias').then(setCategorias).catch(() => {});
    api('/unidades').then(setUnidades).catch(() => {});
  }, []);

  useEffect(() => {
    const retraso = setTimeout(cargar, 250);
    return () => clearTimeout(retraso);
  }, [cargar]);

  async function inactivar(producto) {
    if (!confirm(`¿Inactivar el producto ${producto.nombre}?\n\nNo se elimina: deja de aparecer en el catálogo pero conserva su historial.`)) {
      return;
    }
    try {
      await api(`/productos/${producto.id}`, { method: 'DELETE' });
      setExito(`${producto.nombre} quedó inactivo`);
      cargar();
    } catch (e) {
      setError(e.message);
    }
  }

  function alGuardar() {
    setCreando(false);
    setEditando(null);
    setExito('Producto guardado');
    cargar();
  }

  return html`
    <div>
      <h2>Catálogo de productos</h2>
      <p class="subtitulo">Registre, consulte y actualice los productos del comercio</p>

      <${Aviso} tipo="error">${error}<//>
      <${Aviso} tipo="exito">${exito}<//>

      <div class="barra-acciones">
        <div class="campo" style=${{ minWidth: '240px' }}>
          <label>Buscar</label>
          <input placeholder="Código o nombre" value=${texto}
                 onChange=${(e) => setTexto(e.target.value)} />
        </div>
        <div class="campo">
          <label>Categoría</label>
          <select value=${categoriaId} onChange=${(e) => setCategoriaId(e.target.value)}>
            <option value="">Todas</option>
            ${categorias.map((c) => html`<option key=${c.id} value=${c.id}>${c.nombre}</option>`)}
          </select>
        </div>
        ${puedeEditar(rol) && html`
          <button class="boton" onClick=${() => setCreando(true)}>Nuevo producto</button>`}
      </div>

      <div class="tarjeta">
        ${productos.length === 0
          ? html`<${Vacio}>No hay productos que coincidan con la búsqueda.<//>`
          : html`
            <div class="tabla-envoltura">
              <table>
                <thead>
                  <tr>
                    <th>Código</th><th>Producto</th><th>Categoría</th>
                    <th class="num">Existencias</th><th class="num">Mínimo</th>
                    <th class="num">Costo prom.</th><th class="num">Valorizado</th>
                    ${puedeEditar(rol) && html`<th></th>`}
                  </tr>
                </thead>
                <tbody>
                  ${productos.map((p) => html`
                    <tr key=${p.id}>
                      <td>${p.codigo}</td>
                      <td>
                        ${p.nombre}
                        ${p.enNivelMinimo && html`<br /><span class="etiqueta etiqueta--minimo">En nivel mínimo</span>`}
                      </td>
                      <td>${p.categoria}</td>
                      <td class="num">${numero(p.stockActual)} ${p.unidad}</td>
                      <td class="num">${numero(p.stockMinimo)}</td>
                      <td class="num">${pesos(p.costoPromedio)}</td>
                      <td class="num">${pesos(p.valorizado)}</td>
                      ${puedeEditar(rol) && html`
                        <td class="num">
                          <button class="boton boton--suave boton--chico"
                                  onClick=${() => setEditando(p)}>Editar</button>
                          ${rol === 'ADMIN' && html`
                            <button class="boton boton--peligro boton--chico"
                                    style=${{ marginLeft: '6px' }}
                                    onClick=${() => inactivar(p)}>Inactivar</button>`}
                        </td>`}
                    </tr>`)}
                </tbody>
              </table>
            </div>`}
      </div>

      ${(creando || editando) && html`
        <${FormularioProducto}
          producto=${editando}
          categorias=${categorias}
          unidades=${unidades}
          onGuardar=${alGuardar}
          onCerrar=${() => { setCreando(false); setEditando(null); }} />`}
    </div>`;
}

// --------------------------------------------------------------- movimientos

function Movimientos({ rol, onCambio }) {
  const [productos, setProductos] = useState([]);
  const [movimientos, setMovimientos] = useState([]);
  const [valores, setValores] = useState({
    productoId: '', tipo: 'ENTRADA', cantidad: '',
    costoUnitario: '', motivo: 'VENTA', justificacion: '',
  });
  const [error, setError] = useState('');
  const [exito, setExito] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [listaProductos, lista] = await Promise.all([
        api('/productos'), api('/movimientos'),
      ]);
      setProductos(listaProductos);
      setMovimientos(lista);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const cambiar = (campo) => (e) => setValores({ ...valores, [campo]: e.target.value });
  const seleccionado = productos.find((p) => String(p.id) === String(valores.productoId));

  async function enviar(evento) {
    evento.preventDefault();
    setError('');
    setExito('');
    setEnviando(true);
    try {
      const cuerpo = {
        productoId: Number(valores.productoId),
        tipo: valores.tipo,
        cantidad: Number(valores.cantidad),
      };
      if (valores.tipo === 'ENTRADA') cuerpo.costoUnitario = Number(valores.costoUnitario);
      if (valores.tipo === 'SALIDA') cuerpo.motivo = valores.motivo;
      if (valores.justificacion) cuerpo.justificacion = valores.justificacion;

      const resultado = await api('/movimientos', { method: 'POST', cuerpo });
      setExito(
        `Movimiento registrado. ${resultado.producto} queda con ${numero(resultado.stockResultante)} unidades.` +
        (resultado.alertaGenerada ? ' Se generó una alerta de stock mínimo.' : '')
      );
      setValores({ ...valores, cantidad: '', costoUnitario: '', justificacion: '' });
      cargar();
      onCambio?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return html`
    <div>
      <h2>Movimientos de inventario</h2>
      <p class="subtitulo">Entradas, salidas y ajustes por conteo físico</p>

      <${Aviso} tipo="error">${error}<//>
      <${Aviso} tipo="exito">${exito}<//>

      ${puedeEditar(rol) ? html`
        <div class="tarjeta">
          <p class="tarjeta__titulo">Registrar movimiento</p>
          <form onSubmit=${enviar}>
            <div class="rejilla">
              <div class="campo">
                <label>Producto</label>
                <select value=${valores.productoId} onChange=${cambiar('productoId')} required>
                  <option value="">Seleccione…</option>
                  ${productos.map((p) => html`
                    <option key=${p.id} value=${p.id}>${p.codigo} — ${p.nombre}</option>`)}
                </select>
                ${seleccionado && html`
                  <div class="pista">
                    Existencias: ${numero(seleccionado.stockActual)} ${seleccionado.unidad} ·
                    mínimo ${numero(seleccionado.stockMinimo)}
                  </div>`}
              </div>

              <div class="campo">
                <label>Tipo</label>
                <select value=${valores.tipo} onChange=${cambiar('tipo')}>
                  <option value="ENTRADA">Entrada de mercancía</option>
                  <option value="SALIDA">Salida de mercancía</option>
                  <option value="AJUSTE">Ajuste por conteo físico</option>
                </select>
              </div>

              <div class="campo">
                <label>${valores.tipo === 'AJUSTE' ? 'Conteo físico real' : 'Cantidad'}</label>
                <input type="number" step="0.01" min="0" value=${valores.cantidad}
                       onChange=${cambiar('cantidad')} required />
                ${valores.tipo === 'AJUSTE' && html`
                  <div class="pista">Las existencias quedarán igualadas a este valor</div>`}
              </div>

              ${valores.tipo === 'ENTRADA' && html`
                <div class="campo">
                  <label>Costo unitario</label>
                  <input type="number" step="0.01" min="0" value=${valores.costoUnitario}
                         onChange=${cambiar('costoUnitario')} required />
                  <div class="pista">Recalcula el costo promedio del producto</div>
                </div>`}

              ${valores.tipo === 'SALIDA' && html`
                <div class="campo">
                  <label>Motivo</label>
                  <select value=${valores.motivo} onChange=${cambiar('motivo')}>
                    <option value="VENTA">Venta</option>
                    <option value="AVERIA">Avería</option>
                    <option value="DEVOLUCION">Devolución</option>
                  </select>
                </div>`}
            </div>

            <div class="campo">
              <label>
                ${valores.tipo === 'AJUSTE' ? 'Justificación (obligatoria)' : 'Observación'}
              </label>
              <input value=${valores.justificacion} onChange=${cambiar('justificacion')}
                     required=${valores.tipo === 'AJUSTE'}
                     placeholder=${valores.tipo === 'AJUSTE'
                       ? 'Motivo del ajuste: faltante, sobrante, error de digitación…'
                       : 'Opcional'} />
            </div>

            <button class="boton" type="submit" disabled=${enviando}>
              ${enviando ? 'Registrando…' : 'Registrar movimiento'}
            </button>
          </form>
        </div>`
      : html`<${Aviso} tipo="info">Su perfil permite consultar los movimientos, pero no registrarlos.<//>`}

      <div class="tarjeta">
        <p class="tarjeta__titulo">Historial reciente</p>
        ${movimientos.length === 0
          ? html`<${Vacio}>Todavía no hay movimientos registrados.<//>`
          : html`
            <div class="tabla-envoltura">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th><th>Tipo</th><th>Producto</th><th>Motivo</th>
                    <th class="num">Cantidad</th><th class="num">Existencias</th>
                    <th>Usuario</th><th>Observación</th>
                  </tr>
                </thead>
                <tbody>
                  ${movimientos.map((m) => html`
                    <tr key=${m.id}>
                      <td>${fechaHora(m.fecha)}</td>
                      <td><span class=${'etiqueta etiqueta--' + m.tipo.toLowerCase()}>${m.tipo}</span></td>
                      <td>${m.codigo} — ${m.producto}</td>
                      <td>${m.motivo || '—'}</td>
                      <td class="num">${numero(m.cantidad)}</td>
                      <td class="num">${numero(m.stockResultante)}</td>
                      <td>${m.usuario}</td>
                      <td>${m.justificacion || '—'}</td>
                    </tr>`)}
                </tbody>
              </table>
            </div>`}
      </div>
    </div>`;
}

// ------------------------------------------------------------------ alertas

function Alertas({ rol, onCambio }) {
  const [alertas, setAlertas] = useState([]);
  const [todas, setTodas] = useState(false);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    try {
      setAlertas(await api('/alertas?todas=' + todas));
    } catch (e) {
      setError(e.message);
    }
  }, [todas]);

  useEffect(() => { cargar(); }, [cargar]);

  async function atender(alerta) {
    try {
      await api(`/alertas/${alerta.id}/atender`, { method: 'PUT' });
      cargar();
      onCambio?.();
    } catch (e) {
      setError(e.message);
    }
  }

  return html`
    <div>
      <h2>Alertas de stock mínimo</h2>
      <p class="subtitulo">Productos que alcanzaron o bajaron de su nivel mínimo</p>

      <${Aviso} tipo="error">${error}<//>

      <div class="barra-acciones">
        <button class=${'boton ' + (todas ? 'boton--suave' : '')} onClick=${() => setTodas(false)}>
          Sin atender
        </button>
        <button class=${'boton ' + (todas ? '' : 'boton--suave')} onClick=${() => setTodas(true)}>
          Todas
        </button>
      </div>

      <div class="tarjeta">
        ${alertas.length === 0
          ? html`<${Vacio}>No hay alertas ${todas ? 'registradas' : 'pendientes'}.<//>`
          : html`
            <div class="tabla-envoltura">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th><th>Producto</th>
                    <th class="num">Existencias</th><th class="num">Mínimo</th>
                    <th>Estado</th>${puedeEditar(rol) && html`<th></th>`}
                  </tr>
                </thead>
                <tbody>
                  ${alertas.map((a) => html`
                    <tr key=${a.id}>
                      <td>${fechaHora(a.fecha)}</td>
                      <td>${a.codigo} — ${a.producto}</td>
                      <td class="num">${numero(a.stockActual)}</td>
                      <td class="num">${numero(a.stockMinimo)}</td>
                      <td>
                        <span class=${'etiqueta ' + (a.atendida ? 'etiqueta--entrada' : 'etiqueta--minimo')}>
                          ${a.atendida ? 'Atendida' : 'Pendiente'}
                        </span>
                      </td>
                      ${puedeEditar(rol) && html`
                        <td class="num">
                          ${!a.atendida && html`
                            <button class="boton boton--suave boton--chico"
                                    onClick=${() => atender(a)}>Marcar atendida</button>`}
                        </td>`}
                    </tr>`)}
                </tbody>
              </table>
            </div>`}
      </div>
    </div>`;
}

// ----------------------------------------------------------------- reportes

function Reportes() {
  const [pestana, setPestana] = useState('existencias');
  const [categorias, setCategorias] = useState([]);
  const [categoriaId, setCategoriaId] = useState('');
  const [existencias, setExistencias] = useState(null);
  const [desde, setDesde] = useState(haceUnMes());
  const [hasta, setHasta] = useState(hoy());
  const [movimientos, setMovimientos] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { api('/categorias').then(setCategorias).catch(() => {}); }, []);

  useEffect(() => {
    if (pestana !== 'existencias') return;
    api('/reportes/existencias' + (categoriaId ? `?categoriaId=${categoriaId}` : ''))
      .then(setExistencias)
      .catch((e) => setError(e.message));
  }, [pestana, categoriaId]);

  async function consultarMovimientos() {
    setError('');
    try {
      setMovimientos(await api(`/reportes/movimientos?desde=${desde}&hasta=${hasta}`));
    } catch (e) {
      setError(e.message);
      setMovimientos(null);
    }
  }

  useEffect(() => {
    if (pestana === 'movimientos' && !movimientos) consultarMovimientos();
  }, [pestana]);

  /** Descarga el reporte en CSV, para abrirlo en una hoja de cálculo. */
  function exportar(nombre, encabezados, filas) {
    const contenido = [encabezados, ...filas]
      .map((fila) => fila.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';'))
      .join('\n');
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(new Blob(['﻿' + contenido], { type: 'text/csv' }));
    enlace.download = `${nombre}-${hoy()}.csv`;
    enlace.click();
    URL.revokeObjectURL(enlace.href);
  }

  return html`
    <div>
      <h2>Reportes</h2>
      <p class="subtitulo">Existencias por categoría y movimientos por rango de fechas</p>

      <${Aviso} tipo="error">${error}<//>

      <div class="barra-acciones">
        <button class=${'boton ' + (pestana === 'existencias' ? '' : 'boton--suave')}
                onClick=${() => setPestana('existencias')}>Existencias</button>
        <button class=${'boton ' + (pestana === 'movimientos' ? '' : 'boton--suave')}
                onClick=${() => setPestana('movimientos')}>Movimientos</button>
      </div>

      ${pestana === 'existencias' && html`
        <div>
          <div class="barra-acciones">
            <div class="campo">
              <label>Categoría</label>
              <select value=${categoriaId} onChange=${(e) => setCategoriaId(e.target.value)}>
                <option value="">Todas</option>
                ${categorias.map((c) => html`<option key=${c.id} value=${c.id}>${c.nombre}</option>`)}
              </select>
            </div>
            ${existencias && html`
              <button class="boton boton--suave" onClick=${() => exportar(
                'existencias',
                ['Categoria', 'Codigo', 'Producto', 'Existencias', 'Minimo', 'Costo promedio', 'Valorizado'],
                existencias.grupos.flatMap((g) => g.detalle.map((p) => [
                  g.categoria, p.codigo, p.nombre, p.stockActual,
                  p.stockMinimo, p.costoPromedio, p.valorizado,
                ]))
              )}>Exportar CSV</button>`}
          </div>

          ${!existencias ? html`<${Vacio}>Cargando…<//>` : html`
            <div>
              <div class="indicadores">
                <div class="indicador">
                  <div class="indicador__etiqueta">Productos</div>
                  <div class="indicador__valor">${existencias.totalProductos}</div>
                </div>
                <div class="indicador">
                  <div class="indicador__etiqueta">Unidades en existencia</div>
                  <div class="indicador__valor">${numero(existencias.totalUnidades)}</div>
                </div>
                <div class="indicador">
                  <div class="indicador__etiqueta">Valor del inventario</div>
                  <div class="indicador__valor">${pesos(existencias.totalValorizado)}</div>
                </div>
                <div class=${'indicador' + (existencias.productosEnMinimo > 0 ? ' indicador--alerta' : '')}>
                  <div class="indicador__etiqueta">En nivel mínimo</div>
                  <div class="indicador__valor">${existencias.productosEnMinimo}</div>
                </div>
              </div>

              ${existencias.grupos.map((grupo) => html`
                <div class="tarjeta" key=${grupo.categoria}>
                  <p class="tarjeta__titulo">
                    ${grupo.categoria} · ${grupo.productos} producto(s) · ${pesos(grupo.valorizado)}
                  </p>
                  <div class="tabla-envoltura">
                    <table>
                      <thead>
                        <tr>
                          <th>Código</th><th>Producto</th>
                          <th class="num">Existencias</th><th class="num">Mínimo</th>
                          <th class="num">Costo prom.</th><th class="num">Valorizado</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${grupo.detalle.map((p) => html`
                          <tr key=${p.id}>
                            <td>${p.codigo}</td>
                            <td>
                              ${p.nombre}
                              ${p.enNivelMinimo && html` <span class="etiqueta etiqueta--minimo">mínimo</span>`}
                            </td>
                            <td class="num">${numero(p.stockActual)} ${p.unidad}</td>
                            <td class="num">${numero(p.stockMinimo)}</td>
                            <td class="num">${pesos(p.costoPromedio)}</td>
                            <td class="num">${pesos(p.valorizado)}</td>
                          </tr>`)}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan="2">Subtotal</td>
                          <td class="num">${numero(grupo.unidades)}</td>
                          <td></td><td></td>
                          <td class="num">${pesos(grupo.valorizado)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>`)}
            </div>`}
        </div>`}

      ${pestana === 'movimientos' && html`
        <div>
          <div class="barra-acciones">
            <div class="campo">
              <label>Desde</label>
              <input type="date" value=${desde} onChange=${(e) => setDesde(e.target.value)} />
            </div>
            <div class="campo">
              <label>Hasta</label>
              <input type="date" value=${hasta} onChange=${(e) => setHasta(e.target.value)} />
            </div>
            <button class="boton" onClick=${consultarMovimientos}>Consultar</button>
            ${movimientos && movimientos.movimientos.length > 0 && html`
              <button class="boton boton--suave" onClick=${() => exportar(
                'movimientos',
                ['Fecha', 'Tipo', 'Motivo', 'Codigo', 'Producto', 'Cantidad', 'Existencias', 'Usuario', 'Observacion'],
                movimientos.movimientos.map((m) => [
                  fechaHora(m.fecha), m.tipo, m.motivo || '', m.codigo, m.producto,
                  m.cantidad, m.stockResultante, m.usuario, m.justificacion || '',
                ])
              )}>Exportar CSV</button>`}
          </div>

          ${!movimientos ? html`<${Vacio}>Seleccione un rango y consulte.<//>` : html`
            <div>
              <div class="indicadores">
                <div class="indicador">
                  <div class="indicador__etiqueta">Movimientos</div>
                  <div class="indicador__valor">${movimientos.cantidadMovimientos}</div>
                </div>
                <div class="indicador">
                  <div class="indicador__etiqueta">Unidades que entraron</div>
                  <div class="indicador__valor">${numero(movimientos.totalEntradas)}</div>
                </div>
                <div class="indicador">
                  <div class="indicador__etiqueta">Unidades que salieron</div>
                  <div class="indicador__valor">${numero(movimientos.totalSalidas)}</div>
                </div>
              </div>

              <div class="tarjeta">
                ${movimientos.movimientos.length === 0
                  ? html`<${Vacio}>No hubo movimientos en ese rango de fechas.<//>`
                  : html`
                    <div class="tabla-envoltura">
                      <table>
                        <thead>
                          <tr>
                            <th>Fecha</th><th>Tipo</th><th>Producto</th><th>Motivo</th>
                            <th class="num">Cantidad</th><th class="num">Existencias</th><th>Usuario</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${movimientos.movimientos.map((m) => html`
                            <tr key=${m.id}>
                              <td>${fechaHora(m.fecha)}</td>
                              <td><span class=${'etiqueta etiqueta--' + m.tipo.toLowerCase()}>${m.tipo}</span></td>
                              <td>${m.codigo} — ${m.producto}</td>
                              <td>${m.motivo || '—'}</td>
                              <td class="num">${numero(m.cantidad)}</td>
                              <td class="num">${numero(m.stockResultante)}</td>
                              <td>${m.usuario}</td>
                            </tr>`)}
                        </tbody>
                      </table>
                    </div>`}
              </div>
            </div>`}
        </div>`}
    </div>`;
}

// ----------------------------------------------------------------- usuarios

function Usuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [creando, setCreando] = useState(false);
  const [valores, setValores] = useState({ nombre: '', email: '', password: '', rol: 'CONSULTA' });
  const [error, setError] = useState('');
  const [exito, setExito] = useState('');

  const cargar = useCallback(async () => {
    try {
      setUsuarios(await api('/usuarios'));
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function crear(evento) {
    evento.preventDefault();
    setError('');
    try {
      await api('/usuarios', { method: 'POST', cuerpo: valores });
      setExito(`Usuario ${valores.nombre} creado`);
      setValores({ nombre: '', email: '', password: '', rol: 'CONSULTA' });
      setCreando(false);
      cargar();
    } catch (e) {
      setError(e.message);
    }
  }

  async function desbloquear(usuario) {
    try {
      await api(`/usuarios/${usuario.id}/desbloquear`, { method: 'PUT' });
      setExito(`La cuenta de ${usuario.nombre} quedó liberada`);
      cargar();
    } catch (e) {
      setError(e.message);
    }
  }

  const cambiar = (campo) => (e) => setValores({ ...valores, [campo]: e.target.value });

  return html`
    <div>
      <h2>Usuarios y perfiles</h2>
      <p class="subtitulo">Administre quién entra al sistema y con qué permisos</p>

      <${Aviso} tipo="error">${error}<//>
      <${Aviso} tipo="exito">${exito}<//>

      <div class="barra-acciones">
        <button class="boton" onClick=${() => setCreando(true)}>Nuevo usuario</button>
      </div>

      <div class="tarjeta">
        <div class="tabla-envoltura">
          <table>
            <thead>
              <tr>
                <th>Nombre</th><th>Correo</th><th>Perfil</th>
                <th>Estado</th><th class="num">Intentos fallidos</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${usuarios.map((u) => html`
                <tr key=${u.id}>
                  <td>${u.nombre}</td>
                  <td>${u.email}</td>
                  <td>${u.rol}</td>
                  <td>
                    <span class=${'etiqueta ' + (u.bloqueado ? 'etiqueta--minimo' : 'etiqueta--entrada')}>
                      ${u.bloqueado ? 'Bloqueado' : u.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td class="num">${u.intentosFallidos}</td>
                  <td class="num">
                    ${u.bloqueado && html`
                      <button class="boton boton--suave boton--chico"
                              onClick=${() => desbloquear(u)}>Desbloquear</button>`}
                  </td>
                </tr>`)}
            </tbody>
          </table>
        </div>
      </div>

      <div class="tarjeta">
        <p class="tarjeta__titulo">Qué puede hacer cada perfil</p>
        <div class="tabla-envoltura">
          <table>
            <thead>
              <tr><th>Perfil</th><th>Permisos</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>ADMIN</strong></td>
                <td>Todo el sistema: productos, movimientos, reportes, usuarios e inactivación de productos.</td>
              </tr>
              <tr>
                <td><strong>ALMACENISTA</strong></td>
                <td>Crear y editar productos, registrar movimientos, atender alertas y consultar reportes.</td>
              </tr>
              <tr>
                <td><strong>CONSULTA</strong></td>
                <td>Solo lectura: catálogo, historial de movimientos, alertas y reportes.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      ${creando && html`
        <${Modal} titulo="Nuevo usuario" onCerrar=${() => setCreando(false)}>
          <form onSubmit=${crear}>
            <div class="campo">
              <label>Nombre</label>
              <input value=${valores.nombre} onChange=${cambiar('nombre')} required />
            </div>
            <div class="campo">
              <label>Correo electrónico</label>
              <input type="email" value=${valores.email} onChange=${cambiar('email')} required />
            </div>
            <div class="rejilla">
              <div class="campo">
                <label>Contraseña</label>
                <input type="password" value=${valores.password}
                       onChange=${cambiar('password')} minLength="6" required />
                <div class="pista">Mínimo seis caracteres</div>
              </div>
              <div class="campo">
                <label>Perfil</label>
                <select value=${valores.rol} onChange=${cambiar('rol')}>
                  <option value="CONSULTA">Consulta</option>
                  <option value="ALMACENISTA">Almacenista</option>
                  <option value="ADMIN">Administrador</option>
                </select>
              </div>
            </div>
            <div class="modal__pie">
              <button type="button" class="boton boton--suave"
                      onClick=${() => setCreando(false)}>Cancelar</button>
              <button type="submit" class="boton">Crear usuario</button>
            </div>
          </form>
        <//>`}
    </div>`;
}

// ---------------------------------------------------------------------- app

function App() {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState('tablero');
  const [pendientes, setPendientes] = useState(0);

  const contarAlertas = useCallback(() => {
    api('/alertas').then((lista) => setPendientes(lista.length)).catch(() => {});
  }, []);

  useEffect(() => {
    api('/auth/estado')
      .then((u) => { setUsuario(u); contarAlertas(); })
      .catch(() => setUsuario(null))
      .finally(() => setCargando(false));
  }, [contarAlertas]);

  async function salir() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUsuario(null);
    setVista('tablero');
  }

  if (cargando) return html`<${Vacio}>Cargando…<//>`;

  if (!usuario) {
    return html`<${Ingreso} onEntrar=${(u) => { setUsuario(u); contarAlertas(); }} />`;
  }

  const opciones = [
    ['tablero', 'Tablero'],
    ['productos', 'Productos'],
    ['movimientos', 'Movimientos'],
    ['alertas', 'Alertas'],
    ['reportes', 'Reportes'],
  ];
  if (usuario.rol === 'ADMIN') opciones.push(['usuarios', 'Usuarios']);

  return html`
    <div>
      <header class="cabecera">
        <div class="cabecera__marca">InvenPyme</div>
        <div class="cabecera__usuario">
          <span class="nombre">${usuario.nombre}</span>
          <span class="cabecera__rol">${usuario.rol}</span>
          <button class="boton boton--suave boton--chico" onClick=${salir}>Salir</button>
        </div>
      </header>

      <nav class="menu">
        ${opciones.map(([clave, titulo]) => html`
          <button key=${clave} class=${vista === clave ? 'activo' : ''}
                  onClick=${() => setVista(clave)}>
            ${titulo}
            ${clave === 'alertas' && pendientes > 0 && html`<span class="insignia">${pendientes}</span>`}
          </button>`)}
      </nav>

      <main>
        ${vista === 'tablero' && html`<${Tablero} />`}
        ${vista === 'productos' && html`<${Productos} rol=${usuario.rol} />`}
        ${vista === 'movimientos' && html`<${Movimientos} rol=${usuario.rol} onCambio=${contarAlertas} />`}
        ${vista === 'alertas' && html`<${Alertas} rol=${usuario.rol} onCambio=${contarAlertas} />`}
        ${vista === 'reportes' && html`<${Reportes} />`}
        ${vista === 'usuarios' && usuario.rol === 'ADMIN' && html`<${Usuarios} />`}
      </main>
    </div>`;
}

ReactDOM.createRoot(document.getElementById('raiz')).render(html`<${App} />`);
