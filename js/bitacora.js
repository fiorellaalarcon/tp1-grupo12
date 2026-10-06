/**
 * EXIMIA CODE · Historial verificable de la Bitácora
 *
 * Qué hace:
 *   1. Consulta commits de las ramas configuradas en GitHub.
 *   2. Conserva una instantánea HTML si GitHub no responde.
 *   3. Muestra cada commit como una tarjeta apilable para evitar overflow horizontal.
 *   4. Conserva título y descripción del mensaje del commit cuando GitHub los entrega.
 *   5. Permite filtrar por integrante y tipo de cambio.
 */
(function () {
  'use strict';

  /* ---------- Configuración ---------- */
  const REPO = 'fiorellaalarcon/tp1-grupo12';
  const API = 'https://api.github.com/repos/' + REPO;
  const BRANCHES = ['main', 'feat/fiorella', 'feat/malena', 'feat/javier', 'feat/axel', 'feat/selene'];
  const CACHE_KEY = 'eximia-bitacora-historial-v2';
  const CACHE_MINUTES = 10;
  const TIME_ZONE = 'America/Argentina/Buenos_Aires';

  const PERSONAS = [
    { nombre: 'Fiorella Alarcón', rama: 'feat/fiorella', claves: ['fiorella', 'alarcon'] },
    { nombre: 'Axel Alva', rama: 'feat/axel', claves: ['axel', 'alva'] },
    { nombre: 'Malena Jasque', rama: 'feat/malena', claves: ['malena', 'jasque'] },
    { nombre: 'Javier Churquina', rama: 'feat/javier', claves: ['javier', 'churquina', 'freddy', 'beboaven'] },
    { nombre: 'Selene Pais', rama: 'feat/selene', claves: ['selene', 'pais', 'selepais'] }
  ];

  const TIPOS = {
    feat: 'Función', style: 'Estilos', docs: 'Documentación', chore: 'Estructura',
    fix: 'Corrección', refactor: 'Reorganización', perf: 'Rendimiento', test: 'Pruebas'
  };

  /* ---------- Elementos ---------- */
  const history = document.querySelector('[data-log-table]');
  const controls = document.querySelector('[data-log-filters]');
  if (!history || !controls) return;

  const selectPersona = controls.querySelector('[name="persona"]');
  const selectTipo = controls.querySelector('[name="tipo"]');
  const resetButton = controls.querySelector('[data-log-reset]');
  const counter = controls.querySelector('[data-log-count]');
  const sourceNote = document.querySelector('[data-log-source]');

  function reconocer(nombre, email, login) {
    const clave = (nombre + ' ' + email + ' ' + login).toLowerCase();
    return PERSONAS.find(function (p) {
      return p.claves.some(function (c) { return clave.indexOf(c) !== -1; });
    }) || null;
  }

  function clasificar(asunto) {
    let m = asunto.match(/^Merge pull request #(\d+) from [^/\s]+\/(\S+)/);
    if (m) return { tipo: 'Integración', texto: 'Integra la rama ' + m[2] + ' a main (PR #' + m[1] + ')', pr: m[1] };
    m = asunto.match(/^Merge branch '([^']+)'/);
    if (m) return { tipo: 'Integración', texto: 'Integra la rama ' + m[1], pr: null };
    m = asunto.match(/^(\w+)(\([^)]*\))?!?:\s*(.+)/);
    if (m && TIPOS[m[1].toLowerCase()]) return { tipo: TIPOS[m[1].toLowerCase()], texto: m[3], pr: null };
    return { tipo: 'Cambio', texto: asunto, pr: null };
  }

  function formatear(iso) {
    const partes = {};
    new Intl.DateTimeFormat('es-AR', {
      timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(iso)).forEach(function (p) { partes[p.type] = p.value; });
    return partes.day + '/' + partes.month + '/' + partes.year + ' ' + partes.hour + ':' + partes.minute;
  }

  function el(tag, text, attrs) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  function cargarCache() {
    try {
      const guardado = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (guardado && Date.now() - guardado.t < CACHE_MINUTES * 60000) return guardado.commits;
    } catch (e) {}
    return null;
  }

  function guardarCache(commits) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), commits: commits })); } catch (e) {}
  }

  function pedir(url, controller) {
    return fetch(url, { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal })
      .then(function (r) { if (!r.ok) throw new Error('GitHub respondió ' + r.status); return r.json(); });
  }

  /* Reúne commits de todas las ramas y conserva el mensaje completo. */
  function obtenerCommits() {
    const cache = cargarCache();
    if (cache) return Promise.resolve(cache);

    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 8000);

    return Promise.allSettled(BRANCHES.map(function (rama) {
      return pedir(API + '/commits?per_page=100&sha=' + encodeURIComponent(rama), controller);
    })).then(function (resultados) {
      clearTimeout(timer);
      if (resultados[0].status !== 'fulfilled') throw new Error('No se pudo leer main');

      const vistos = {};
      const commits = [];
      resultados.forEach(function (r) {
        if (r.status !== 'fulfilled' || !Array.isArray(r.value)) return;
        r.value.forEach(function (c) {
          if (vistos[c.sha]) return;
          vistos[c.sha] = true;
          const mensaje = c.commit.message || '';
          const partes = mensaje.split('\n');
          commits.push({
            sha: c.sha,
            iso: c.commit.author.date,
            nombre: c.commit.author.name,
            email: c.commit.author.email,
            login: c.author ? c.author.login : '',
            asunto: partes[0] || 'Cambio sin título',
            descripcion: partes.slice(1).join('\n').trim(),
            url: c.html_url
          });
        });
      });
      commits.sort(function (a, b) { return new Date(a.iso) - new Date(b.iso); });
      guardarCache(commits);
      return commits;
    });
  }

  /* Dibuja tarjetas, no una tabla: así el historial conserva lectura vertical en móvil. */
  function dibujarRegistro(commits) {
    history.textContent = '';
    commits.forEach(function (c) {
      const persona = reconocer(c.nombre, c.email, c.login);
      const info = clasificar(c.asunto);
      const card = el('article', null, { class: 'commit-card' });
      card.appendChild(el('p', formatear(c.iso) + ' · ' + (persona ? persona.nombre : c.nombre) + ' · ' + info.tipo, { class: 'commit-meta' }));
      card.appendChild(el('h3', c.sha.slice(0, 7) + ' · ' + info.texto));
      card.appendChild(el('p', null)).appendChild(el('strong', 'Título:'));
      card.lastChild.parentNode.appendChild(document.createTextNode(' ' + c.asunto));
      const descripcion = c.descripcion || 'El mensaje no contiene una descripción adicional; el título identifica el cambio realizado.';
      const pDesc = el('p');
      pDesc.appendChild(el('strong', 'Descripción:'));
      pDesc.appendChild(document.createTextNode(' ' + descripcion));
      card.appendChild(pDesc);
      const link = el('a', 'Abrir commit ↗', { href: c.url, target: '_blank', rel: 'noopener noreferrer' });
      card.appendChild(link);
      history.appendChild(card);
    });
  }

  function tarjetas() {
    return Array.prototype.slice.call(history.querySelectorAll('.commit-card'));
  }

  function llenarOpciones(select, key) {
    const actual = select.value;
    while (select.options.length > 1) select.remove(1);
    const valores = Array.from(new Set(tarjetas().map(function (card) {
      return key === 'persona' ? card.querySelector('.commit-meta').textContent.split(' · ')[1] : card.querySelector('.commit-meta').textContent.split(' · ')[2];
    }))).sort(function (a, b) { return a.localeCompare(b, 'es'); });
    valores.forEach(function (valor) { select.appendChild(el('option', valor, { value: valor })); });
    select.value = valores.indexOf(actual) !== -1 ? actual : '';
  }

  function aplicarFiltros() {
    const persona = selectPersona.value;
    const tipo = selectTipo.value;
    const todas = tarjetas();
    let visibles = 0;
    todas.forEach(function (card) {
      const meta = card.querySelector('.commit-meta').textContent.split(' · ');
      const coincide = (!persona || meta[1] === persona) && (!tipo || meta[2] === tipo);
      card.hidden = !coincide;
      if (coincide) visibles += 1;
    });
    counter.textContent = visibles === todas.length ? 'Mostrando los ' + todas.length + ' registros.' : 'Mostrando ' + visibles + ' de ' + todas.length + ' registros.';
  }

  function prepararFiltros() {
    llenarOpciones(selectPersona, 'persona');
    llenarOpciones(selectTipo, 'tipo');
    aplicarFiltros();
  }

  resetButton.addEventListener('click', function () {
    selectPersona.value = '';
    selectTipo.value = '';
    aplicarFiltros();
    selectPersona.focus();
  });
  selectPersona.addEventListener('change', aplicarFiltros);
  selectTipo.addEventListener('change', aplicarFiltros);

  controls.hidden = false;
  prepararFiltros();

  obtenerCommits().then(function (commits) {
    if (!commits.length) return;
    dibujarRegistro(commits);
    prepararFiltros();
    if (sourceNote) sourceNote.textContent = 'Actualizado desde GitHub el ' + formatear(new Date().toISOString()) + ' (hora de Argentina). Cada tarjeta conserva el título y la descripción del mensaje del commit cuando fueron publicados.';
  }).catch(function () {
    if (sourceNote) sourceNote.textContent = 'GitHub no respondió; se conserva la instantánea documental incluida en la Bitácora.';
  });
})();