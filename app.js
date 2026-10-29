/* =========================================================
   BOÎTE À IDÉES – application (HTML/CSS/JS + data.json)
   ---------------------------------------------------------
   Les données de départ viennent de data.json. Ensuite, tout est
   enregistré dans le localStorage du navigateur (mode démo).
   ========================================================= */
(() => {
  'use strict';

  const STORE_KEY = 'idees-app-v1';
  const SESSION_KEY = 'idees-app-session';
  const COOLDOWN_KEY = 'idees-app-last-submit';
  const COOLDOWN_MS = 10000;

  const STATUS = {
    nouvelle: { label: 'Nouvelle', plural: 'Nouvelles' },
    retenue:  { label: 'Retenue',  plural: 'Retenues' },
    rejetee:  { label: 'Rejetée',  plural: 'Rejetées' },
    publiee:  { label: 'Publiée',  plural: 'Publiées' },
  };

  const $header = document.getElementById('header');
  const $app = document.getElementById('app');
  const $toasts = document.getElementById('toasts');

  let db = null;
  let lastSubmitted = null;
  const listState = { q: '', promo: '', status: '', sort: 'desc' };
  const cal = { y: new Date().getFullYear(), m: new Date().getMonth() };

  /* ---------------------------------------------------------
     Utilitaires
     --------------------------------------------------------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const pad = (n) => String(n).padStart(2, '0');
  const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayISO = () => toISODate(new Date());
  const parseISODate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDateLong = (s) => parseISODate(s).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtDateShort = (s) => parseISODate(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const fmtDateTime = (iso) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const authorLabel = (i) => (i.anonymous || !i.author) ? 'Anonyme' : i.author;
  const badge = (status) => `<span class="badge st-${esc(status)}">${esc(STATUS[status]?.label || status)}</span>`;
  const go = (path) => { location.hash = '#' + path; };

  function toast(msg, type = 'ok') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    $toasts.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3200);
  }

  /* ---------- Fenêtres modales ---------- */
  function makeDialog(html, { wide = false, onClose } = {}) {
    const d = document.createElement('dialog');
    d.className = 'modal' + (wide ? ' wide' : '');
    d.innerHTML = html;
    d.addEventListener('click', (e) => {
      if (e.target === d || e.target.closest('[data-close]')) d.close();
    });
    d.addEventListener('close', () => { if (onClose) onClose(d); d.remove(); });
    document.body.appendChild(d);
    d.showModal();
    return d;
  }

  // Résout avec { text } si confirmé, null si annulé
  function confirmBox({ title, message = '', ok = 'Confirmer', danger = false, textLabel = '' }) {
    return new Promise((resolve) => {
      makeDialog(`
        <form method="dialog" class="modal-body">
          <h2>${esc(title)}</h2>
          ${message ? `<p>${esc(message)}</p>` : ''}
          ${textLabel ? `<label class="stack">${esc(textLabel)}<textarea rows="3" maxlength="300"></textarea></label>` : ''}
          <div class="modal-actions">
            <button class="btn btn-ghost" value="cancel">Annuler</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" value="ok">${esc(ok)}</button>
          </div>
        </form>`, {
        onClose: (d) => resolve(d.returnValue === 'ok'
          ? { text: (d.querySelector('textarea')?.value || '').trim() }
          : null),
      });
    });
  }

  /* ---------------------------------------------------------
     Données
     --------------------------------------------------------- */
  async function loadData(force = false) {
    if (!force) {
      try {
        const saved = localStorage.getItem(STORE_KEY);
        if (saved) { db = JSON.parse(saved); normalize(); return; }
      } catch (e) { /* on retombe sur data.json */ }
    }
    const res = await fetch('data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    db = await res.json();
    normalize();
    save();
  }
  function normalize() {
    db.community = db.community || { name: 'Boîte à idées' };
    db.promotions = db.promotions || [];
    db.admins = db.admins || [];
    db.ideas = db.ideas || [];
    db.schedule = db.schedule || [];
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { /* ignoré */ }
  }

  const getSession = () => { try { return sessionStorage.getItem(SESSION_KEY); } catch (e) { return null; } };
  const setSession = (id) => { try { id ? sessionStorage.setItem(SESSION_KEY, id) : sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignoré */ } };
  const currentAdmin = () => db.admins.find((a) => a.id === getSession()) || null;

  /* ---------------------------------------------------------
     Routeur
     --------------------------------------------------------- */
  function render() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const admin = currentAdmin();
    window.scrollTo(0, 0);

    if (parts[0] === 'admin') {
      const page = parts[1] || 'login';
      if (page === 'login') {
        if (admin) return go('/admin/idees');
        renderHeader('public');
        return viewLogin();
      }
      if (!admin) return go('/admin/login');
      renderHeader('admin', page);
      if (page === 'idees') return viewIdeas();
      if (page === 'calendrier') return viewCalendar();
      if (page === 'inserer') return viewScheduleForm('insert', parts[2]);
      if (page === 'modifier') return viewScheduleForm('edit', parts[2]);
      return viewNotFound();
    }

    renderHeader('public');
    if (parts.length === 0) return viewWelcome();
    if (parts[0] === 'idee') return viewIdeaForm();
    if (parts[0] === 'merci') return viewThanks();
    return viewNotFound();
  }

  function renderHeader(mode, active = '') {
    const name = esc(db.community.name || 'Boîte à idées');
    if (mode === 'admin') {
      const a = currentAdmin();
      const onIdeas = active === 'idees' || active === 'inserer';
      const onCal = active === 'calendrier' || active === 'modifier';
      $header.innerHTML = `
        <div class="bar container">
          <a class="brand" href="#/admin/idees"><span class="logo">💡</span>${name}</a>
          <button class="burger" id="burger" aria-label="Ouvrir le menu" aria-expanded="false">☰</button>
          <nav class="nav" id="nav">
            <a href="#/admin/idees" class="${onIdeas ? 'active' : ''}">Idées</a>
            <a href="#/admin/calendrier" class="${onCal ? 'active' : ''}">Tableau éditorial</a>
            <span class="who">Connecté : ${esc(a.name)}</span>
            <button class="btn btn-ghost btn-sm" id="logout">Déconnexion</button>
          </nav>
        </div>`;
      $header.querySelector('#logout').addEventListener('click', () => {
        setSession(null);
        toast('Vous êtes déconnecté.');
        go('/');
      });
    } else {
      $header.innerHTML = `
        <div class="bar container">
          <a class="brand" href="#/"><span class="logo">💡</span>${name}</a>
          <button class="burger" id="burger" aria-label="Ouvrir le menu" aria-expanded="false">☰</button>
          <nav class="nav" id="nav">
            <a href="#/idee" class="btn btn-accent btn-sm">Proposer une idée</a>
            <a href="#/admin/login">Espace admin</a>
          </nav>
        </div>`;
    }
    const burger = $header.querySelector('#burger');
    const nav = $header.querySelector('#nav');
    burger.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      burger.setAttribute('aria-expanded', String(open));
    });
  }

  /* ---------------------------------------------------------
     CÔTÉ CLIENT
     --------------------------------------------------------- */
  function viewWelcome() {
    $app.innerHTML = `
      <section class="hero">
        <div class="container">
          <h1>Une idée de contenu ?<br>Partagez-la avec la communauté</h1>
          <p>Proposez un thème pour nos prochaines publications. Ça prend deux minutes, et vous pouvez rester anonyme.</p>
          <a class="btn btn-accent btn-lg" href="#/idee">Proposer une idée</a>
        </div>
      </section>
      <section class="container steps">
        <div class="step"><span class="num">1</span><h3>Remplissez le formulaire</h3><p>Choisissez votre promotion, donnez un thème et expliquez pourquoi il serait utile.</p></div>
        <div class="step"><span class="num">2</span><h3>L'équipe l'étudie</h3><p>Les admins lisent chaque idée et décident de la retenir ou non.</p></div>
        <div class="step"><span class="num">3</span><h3>Elle est publiée</h3><p>Les idées retenues sont planifiées dans notre calendrier éditorial.</p></div>
      </section>`;
  }

  function setFieldError(form, name, msg) {
    const wrap = form.querySelector(`[data-field="${name}"]`);
    if (!wrap) return;
    const err = wrap.querySelector('.err');
    wrap.classList.toggle('invalid', !!msg);
    err.textContent = msg;
    err.hidden = !msg;
    const input = wrap.querySelector('input:not([type=checkbox]), select, textarea');
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  function viewIdeaForm() {
    $app.innerHTML = `
      <div class="container narrow">
        <a class="back" href="#/">← Retour à l'accueil</a>
        <div class="card">
          <h1>Proposer une idée</h1>
          <p class="muted">Tous les champs sont obligatoires. Votre nom n'est pas demandé si vous choisissez de rester anonyme.</p>
          <form id="ideaForm" novalidate>
            <div class="field" data-field="author">
              <label for="f-author">Votre nom</label>
              <input id="f-author" name="author" type="text" maxlength="60" autocomplete="name" placeholder="Ex. Hasina">
              <label class="check"><input type="checkbox" name="anonymous"> Je préfère rester anonyme</label>
              <p class="err" hidden></p>
            </div>
            <div class="field" data-field="promotion">
              <label for="f-promo">Promotion</label>
              <select id="f-promo" name="promotion">
                <option value="">Choisir…</option>
                ${db.promotions.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}
              </select>
              <p class="err" hidden></p>
            </div>
            <div class="field" data-field="theme">
              <label for="f-theme">Thème / idée de contenu</label>
              <input id="f-theme" name="theme" type="text" maxlength="100" placeholder="Ex. Astuces pour réviser les partiels">
              <p class="err" hidden></p>
            </div>
            <div class="field" data-field="description">
              <label for="f-desc">Description</label>
              <textarea id="f-desc" name="description" maxlength="600" placeholder="Expliquez en quelques phrases de quoi il s'agit"></textarea>
              <small class="count" data-count="description">0 / 600</small>
              <p class="err" hidden></p>
            </div>
            <div class="field" data-field="reason">
              <label for="f-reason">Pourquoi cette idée ?</label>
              <textarea id="f-reason" name="reason" maxlength="400" placeholder="En quoi serait-elle utile à la communauté ?"></textarea>
              <small class="count" data-count="reason">0 / 400</small>
              <p class="err" hidden></p>
            </div>
            <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
            <div class="form-actions">
              <button type="button" class="btn btn-ghost" id="cancel">Annuler</button>
              <button type="submit" class="btn btn-primary">Envoyer mon idée</button>
            </div>
          </form>
        </div>
      </div>`;

    const form = $app.querySelector('#ideaForm');
    const el = form.elements;
    const val = (n) => el[n].value.trim();

    const validators = {
      author: () => (el.anonymous.checked || val('author')) ? '' : 'Indiquez votre nom ou cochez « anonyme ».',
      promotion: () => el.promotion.value ? '' : 'Choisissez votre promotion.',
      theme: () => val('theme').length >= 3 ? '' : 'Indiquez un thème (3 caractères minimum).',
      description: () => val('description').length >= 10 ? '' : 'Décrivez votre idée (10 caractères minimum).',
      reason: () => val('reason').length >= 5 ? '' : 'Expliquez le choix de cette idée (5 caractères minimum).',
    };
    const check = (n) => { const msg = validators[n](); setFieldError(form, n, msg); return !msg; };

    Object.keys(validators).forEach((n) => {
      el[n].addEventListener('blur', () => check(n));
      el[n].addEventListener('input', () => {
        if (form.querySelector(`[data-field="${n}"].invalid`)) check(n);
      });
    });
    el.anonymous.addEventListener('change', () => {
      el.author.disabled = el.anonymous.checked;
      check('author');
    });
    [['description', 600], ['reason', 400]].forEach(([n, max]) => {
      el[n].addEventListener('input', () => {
        form.querySelector(`[data-count="${n}"]`).textContent = `${el[n].value.length} / ${max}`;
      });
    });

    const isDirty = () => ['author', 'theme', 'description', 'reason'].some((n) => val(n)) || el.promotion.value || el.anonymous.checked;

    form.querySelector('#cancel').addEventListener('click', async () => {
      if (isDirty()) {
        const r = await confirmBox({
          title: 'Abandonner cette idée ?',
          message: 'Les informations saisies seront perdues.',
          ok: 'Oui, abandonner', danger: true,
        });
        if (!r) return;
      }
      go('/');
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const results = Object.keys(validators).map((n) => [n, check(n)]);
      const firstBad = results.find(([, ok]) => !ok);
      if (firstBad) { el[firstBad[0]].focus(); return; }

      const anonymous = el.anonymous.checked;
      const name = anonymous ? '' : val('author');

      // Anti-spam : champ piège + délai minimum entre deux envois
      if (el.website.value) { lastSubmitted = { name }; return go('/merci'); }
      try {
        const last = Number(localStorage.getItem(COOLDOWN_KEY) || 0);
        if (Date.now() - last < COOLDOWN_MS) {
          return toast('Patientez quelques secondes avant d\'envoyer une autre idée.', 'error');
        }
      } catch (err) { /* ignoré */ }

      db.ideas.push({
        id: 'i' + uid(),
        createdAt: new Date().toISOString(),
        author: name,
        anonymous,
        promotion: el.promotion.value,
        theme: val('theme'),
        description: val('description'),
        reason: val('reason'),
        status: 'nouvelle',
      });
      save();
      try { localStorage.setItem(COOLDOWN_KEY, String(Date.now())); } catch (err) { /* ignoré */ }
      lastSubmitted = { name };
      go('/merci');
    });
  }

  function viewThanks() {
    if (!lastSubmitted) return go('/');
    const who = lastSubmitted.name ? ` ${esc(lastSubmitted.name)}` : '';
    $app.innerHTML = `
      <div class="container narrow" style="margin-top:32px">
        <div class="card done">
          <div class="big">🎉</div>
          <h1>Idée reçue !</h1>
          <p>Merci${who} pour votre participation. L'équipe va étudier votre proposition.</p>
          <div class="form-actions">
            <a class="btn btn-primary" href="#/idee">Ajouter une autre idée</a>
            <a class="btn btn-ghost" href="#/">Retour à l'accueil</a>
          </div>
        </div>
      </div>`;
  }

  function viewNotFound() {
    $app.innerHTML = `
      <div class="container narrow" style="margin-top:32px">
        <div class="card done">
          <h1>Page introuvable</h1>
          <p class="muted">Cette page n'existe pas.</p>
          <a class="btn btn-primary" href="#/">Retour à l'accueil</a>
        </div>
      </div>`;
  }

  /* ---------------------------------------------------------
     CÔTÉ ADMIN
     --------------------------------------------------------- */
  function viewLogin() {
    $app.innerHTML = `
      <div class="container narrow" style="margin-top:32px">
        <div class="card">
          <h1>Espace admin</h1>
          <p class="muted">Connectez-vous pour gérer les idées et le tableau éditorial.</p>
          <form id="loginForm" novalidate>
            <div class="field">
              <label for="l-user">Compte</label>
              <select id="l-user" name="user">
                ${db.admins.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="l-pw">Mot de passe</label>
              <input id="l-pw" name="pw" type="password" autocomplete="current-password">
              <p class="err" id="loginErr" hidden></p>
            </div>
            <div class="form-actions">
              <a class="btn btn-ghost" href="#/">Retour</a>
              <button class="btn btn-primary" type="submit">Se connecter</button>
            </div>
          </form>
        </div>
      </div>`;
    const form = $app.querySelector('#loginForm');
    const err = form.querySelector('#loginErr');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const admin = db.admins.find((a) => a.id === form.elements.user.value);
      if (admin && admin.password === form.elements.pw.value) {
        setSession(admin.id);
        toast(`Bienvenue ${admin.name} !`);
        go('/admin/idees');
      } else {
        err.textContent = 'Mot de passe incorrect.';
        err.hidden = false;
        form.elements.pw.focus();
      }
    });
  }

  /* ---------- Liste des idées ---------- */
  function viewIdeas() {
    const st = listState;
    $app.innerHTML = `
      <div class="container">
        <div class="page-head">
          <div><h1>Idées des élèves</h1><p class="muted" id="count"></p></div>
          <div class="stats" id="stats"></div>
        </div>
        <div class="toolbar">
          <input type="search" id="q" placeholder="Rechercher (thème, nom, description…)" aria-label="Rechercher" value="${esc(st.q)}">
          <select id="fPromo" aria-label="Filtrer par promotion">
            <option value="">Toutes les promotions</option>
            ${db.promotions.map((p) => `<option value="${esc(p)}" ${st.promo === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}
          </select>
          <select id="fStatus" aria-label="Filtrer par statut">
            <option value="">Tous les statuts</option>
            ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${st.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
          <select id="fSort" aria-label="Trier par date">
            <option value="desc" ${st.sort === 'desc' ? 'selected' : ''}>Plus récentes d'abord</option>
            <option value="asc" ${st.sort === 'asc' ? 'selected' : ''}>Plus anciennes d'abord</option>
          </select>
        </div>
        <div id="listWrap"></div>
        <div class="footer-actions">
          <button class="btn btn-ghost btn-sm" id="reset">Réinitialiser les données de démo</button>
        </div>
      </div>`;

    const q = $app.querySelector('#q');
    q.addEventListener('input', () => { st.q = q.value; renderList(); });
    $app.querySelector('#fPromo').addEventListener('change', (e) => { st.promo = e.target.value; renderList(); });
    $app.querySelector('#fStatus').addEventListener('change', (e) => { st.status = e.target.value; renderList(); });
    $app.querySelector('#fSort').addEventListener('change', (e) => { st.sort = e.target.value; renderList(); });

    $app.querySelector('#stats').addEventListener('click', (e) => {
      const b = e.target.closest('[data-status]');
      if (!b) return;
      st.status = st.status === b.dataset.status ? '' : b.dataset.status;
      $app.querySelector('#fStatus').value = st.status;
      renderList();
    });

    $app.querySelector('#listWrap').addEventListener('click', onListClick);

    $app.querySelector('#reset').addEventListener('click', async () => {
      const r = await confirmBox({
        title: 'Réinitialiser les données ?',
        message: 'Toutes les modifications seront remplacées par le contenu de data.json.',
        ok: 'Réinitialiser', danger: true,
      });
      if (!r) return;
      try {
        try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignoré */ }
        await loadData(true);
        toast('Données de démo rechargées.');
        render();
      } catch (e) {
        toast('Impossible de recharger data.json.', 'error');
      }
    });

    renderList();
  }

  function renderList() {
    const { q, promo, status, sort } = listState;
    const needle = q.trim().toLowerCase();

    // Compteurs par statut
    $app.querySelector('#stats').innerHTML = Object.entries(STATUS).map(([k, v]) => {
      const n = db.ideas.filter((i) => i.status === k).length;
      return `<button class="stat ${status === k ? 'on' : ''}" data-status="${k}"><b>${n}</b> ${v.plural}</button>`;
    }).join('');

    const rows = db.ideas
      .filter((i) => (!promo || i.promotion === promo)
        && (!status || i.status === status)
        && (!needle || [i.theme, i.description, i.reason, authorLabel(i), i.promotion].join(' ').toLowerCase().includes(needle)))
      .sort((a, b) => sort === 'asc' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt));

    $app.querySelector('#count').textContent =
      `${rows.length} idée${rows.length > 1 ? 's' : ''} affichée${rows.length > 1 ? 's' : ''} sur ${db.ideas.length}`;

    const wrap = $app.querySelector('#listWrap');
    if (!rows.length) {
      wrap.innerHTML = `<div class="table-wrap"><div class="empty">Aucune idée ne correspond à votre recherche.</div></div>`;
      return;
    }

    wrap.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Date de soumission</th><th>Promotion</th><th>Thème</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>
            ${rows.map((i) => {
              const canInsert = i.status === 'nouvelle';
              const insertTitle = canInsert ? 'Planifier dans le tableau éditorial'
                : i.status === 'rejetee' ? 'Restaurez d\'abord cette idée' : 'Déjà planifiée';
              const rejectBtn = i.status === 'rejetee'
                ? `<button class="btn btn-ghost btn-sm" data-act="restore">Restaurer</button>`
                : `<button class="btn btn-ghost btn-sm" data-act="reject" ${canInsert ? '' : 'disabled'}
                     title="${canInsert ? 'Rejeter / archiver cette idée' : 'Retirez-la d\'abord du tableau éditorial'}">Rejeter</button>`;
              return `
              <tr data-id="${esc(i.id)}">
                <td data-label="Date">${fmtDateTime(i.createdAt)}</td>
                <td data-label="Promotion"><span class="tag">${esc(i.promotion)}</span></td>
                <td data-label="Thème">
                  <div><button class="linklike" data-act="view">${esc(i.theme)}</button>
                  <div class="sub">${esc(authorLabel(i))}</div></div>
                </td>
                <td data-label="Statut">${badge(i.status)}</td>
                <td class="actions">
                  <button class="btn btn-primary btn-sm" data-act="insert" ${canInsert ? '' : 'disabled'} title="${esc(insertTitle)}">Insérer</button>
                  ${rejectBtn}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  async function onListClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const id = btn.closest('tr').dataset.id;
    const idea = db.ideas.find((i) => i.id === id);
    if (!idea) return;

    if (btn.dataset.act === 'view') return showIdeaDialog(id);
    if (btn.dataset.act === 'insert') return go('/admin/inserer/' + encodeURIComponent(id));

    if (btn.dataset.act === 'reject') {
      const r = await confirmBox({
        title: 'Rejeter cette idée ?',
        message: `« ${idea.theme} » sera archivée. Vous pourrez la restaurer à tout moment.`,
        textLabel: 'Motif (facultatif, visible des admins uniquement)',
        ok: 'Rejeter', danger: true,
      });
      if (!r) return;
      idea.status = 'rejetee';
      if (r.text) idea.rejectReason = r.text; else delete idea.rejectReason;
      save(); renderList();
      toast('Idée rejetée.');
    }

    if (btn.dataset.act === 'restore') {
      idea.status = 'nouvelle';
      delete idea.rejectReason;
      save(); renderList();
      toast('Idée restaurée.');
    }
  }

  function showIdeaDialog(id) {
    const i = db.ideas.find((x) => x.id === id);
    if (!i) return;
    const s = db.schedule.find((x) => x.ideaId === id);
    const d = makeDialog(`
      <div class="modal-body">
        <div class="modal-head"><h2>${esc(i.theme)}</h2>${badge(i.status)}</div>
        <dl class="details">
          <dt>Promotion</dt><dd>${esc(i.promotion)}</dd>
          <dt>Proposée par</dt><dd>${esc(authorLabel(i))}</dd>
          <dt>Soumise le</dt><dd>${fmtDateTime(i.createdAt)}</dd>
          <dt>Description</dt><dd class="pre">${esc(i.description)}</dd>
          <dt>Raison du choix</dt><dd class="pre">${esc(i.reason)}</dd>
          ${s ? `<dt>Planifiée</dt><dd>${esc(fmtDateLong(s.date))} à ${esc(s.time)}</dd>` : ''}
          ${i.status === 'rejetee' && i.rejectReason ? `<dt>Motif du rejet</dt><dd class="pre">${esc(i.rejectReason)}</dd>` : ''}
        </dl>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-close>Fermer</button>
          ${i.status === 'nouvelle' ? '<button class="btn btn-primary" data-insert>Insérer</button>' : ''}
        </div>
      </div>`, { wide: true });
    const ins = d.querySelector('[data-insert]');
    if (ins) ins.addEventListener('click', () => { d.close(); go('/admin/inserer/' + encodeURIComponent(id)); });
  }

  /* ---------- Formulaire de planification (insertion / modification) ---------- */
  function viewScheduleForm(mode, id) {
    let item = null;
    let idea = null;
    if (mode === 'insert') {
      idea = db.ideas.find((i) => i.id === id);
      if (!idea) { toast('Idée introuvable.', 'error'); return go('/admin/idees'); }
      if (idea.status !== 'nouvelle') { toast('Cette idée est déjà traitée.', 'error'); return go('/admin/idees'); }
    } else {
      item = db.schedule.find((s) => s.id === id);
      if (!item) { toast('Publication introuvable.', 'error'); return go('/admin/calendrier'); }
      idea = db.ideas.find((i) => i.id === item.ideaId) || null;
    }

    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const init = {
      title: item ? item.title : idea.theme,
      date: item ? item.date : toISODate(tomorrow),
      time: item ? item.time : '18:00',
    };
    const back = mode === 'insert' ? '/admin/idees' : '/admin/calendrier';

    $app.innerHTML = `
      <div class="container">
        <a class="back" href="#${back}">← Retour</a>
        <h1>${mode === 'insert' ? 'Insérer dans le tableau éditorial' : 'Modifier la publication'}</h1>
        <div class="two-col">
          <div class="card">
            <form id="schedForm" novalidate>
              <div class="field" data-field="title">
                <label for="s-title">Titre</label>
                <input id="s-title" name="title" type="text" maxlength="120" value="${esc(init.title)}">
                <p class="err" hidden></p>
              </div>
              <div class="row-2">
                <div class="field" data-field="date">
                  <label for="s-date">Date</label>
                  <input id="s-date" name="date" type="date" value="${esc(init.date)}">
                  <p class="err" hidden></p>
                </div>
                <div class="field" data-field="time">
                  <label for="s-time">Heure</label>
                  <input id="s-time" name="time" type="time" value="${esc(init.time)}">
                  <p class="err" hidden></p>
                </div>
              </div>
              <div class="form-actions">
                <button type="button" class="btn btn-ghost" id="cancel">Annuler</button>
                <button type="submit" class="btn btn-primary">Valider</button>
              </div>
            </form>
          </div>
          <div class="card summary">
            <h3>Idée d'origine</h3>
            ${idea ? `
              <div class="modal-head"><h2>${esc(idea.theme)}</h2><span class="tag">${esc(idea.promotion)}</span></div>
              <dl class="details">
                <dt>Proposée par</dt><dd>${esc(authorLabel(idea))}</dd>
                <dt>Description</dt><dd class="pre">${esc(idea.description)}</dd>
                <dt>Raison du choix</dt><dd class="pre">${esc(idea.reason)}</dd>
              </dl>` : '<p class="muted">L\'idée d\'origine n\'existe plus.</p>'}
          </div>
        </div>
      </div>`;

    const form = $app.querySelector('#schedForm');
    const el = form.elements;
    const validators = {
      title: () => el.title.value.trim() ? '' : 'Le titre est obligatoire.',
      date: () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(el.date.value)) return 'Choisissez une date.';
        if (mode === 'insert' && el.date.value < todayISO()) return 'La date ne peut pas être dans le passé.';
        return '';
      },
      time: () => /^\d{2}:\d{2}$/.test(el.time.value) ? '' : 'Choisissez une heure.',
    };
    const check = (n) => { const m = validators[n](); setFieldError(form, n, m); return !m; };
    Object.keys(validators).forEach((n) => {
      el[n].addEventListener('blur', () => check(n));
      el[n].addEventListener('input', () => { if (form.querySelector(`[data-field="${n}"].invalid`)) check(n); });
    });

    const isDirty = () => el.title.value !== init.title || el.date.value !== init.date || el.time.value !== init.time;
    form.querySelector('#cancel').addEventListener('click', async () => {
      if (isDirty()) {
        const r = await confirmBox({ title: 'Annuler les modifications ?', message: 'Les changements saisis seront perdus.', ok: 'Oui, annuler', danger: true });
        if (!r) return;
      }
      go(back);
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const bad = Object.keys(validators).map((n) => [n, check(n)]).find(([, ok]) => !ok);
      if (bad) { el[bad[0]].focus(); return; }

      const title = el.title.value.trim();
      const date = el.date.value;
      const time = el.time.value;

      const clash = db.schedule.find((s) => (!item || s.id !== item.id) && s.date === date && s.time === time);
      if (clash) {
        const r = await confirmBox({
          title: 'Créneau déjà occupé',
          message: `« ${clash.title} » est déjà prévu le ${fmtDateShort(date)} à ${time}. Continuer quand même ?`,
          ok: 'Continuer',
        });
        if (!r) return;
      }

      if (mode === 'insert') {
        // Revérifie au cas où l'idée aurait changé entre-temps
        if (idea.status !== 'nouvelle') { toast('Cette idée est déjà traitée.', 'error'); return go('/admin/idees'); }
        db.schedule.push({ id: 's' + uid(), ideaId: idea.id, title, date, time, createdBy: currentAdmin().name });
        idea.status = 'retenue';
        toast('Idée retenue et ajoutée au tableau éditorial.');
      } else {
        Object.assign(item, { title, date, time });
        toast('Publication modifiée.');
      }
      save();
      const d = parseISODate(date);
      cal.y = d.getFullYear(); cal.m = d.getMonth();
      go('/admin/calendrier');
    });
  }

  /* ---------- Calendrier ---------- */
  function viewCalendar() {
    $app.innerHTML = `
      <div class="container">
        <div class="page-head">
          <div><h1>Tableau éditorial</h1><p class="muted">Cliquez sur une publication pour voir le détail.</p></div>
        </div>
        <div class="cal-toolbar">
          <button class="btn btn-ghost" id="prev" aria-label="Mois précédent">‹</button>
          <h2 id="calTitle"></h2>
          <button class="btn btn-ghost" id="next" aria-label="Mois suivant">›</button>
          <button class="btn btn-ghost btn-sm" id="today">Aujourd'hui</button>
        </div>
        <div class="cal" id="cal"></div>
        <div class="legend">
          <span><i style="background:var(--c-primary)"></i>Retenue (à publier)</span>
          <span><i style="background:var(--ok)"></i>Publiée</span>
        </div>
        <div class="agenda" id="agenda"></div>
      </div>`;

    const shift = (delta) => {
      const d = new Date(cal.y, cal.m + delta, 1);
      cal.y = d.getFullYear(); cal.m = d.getMonth();
      drawCalendar();
    };
    $app.querySelector('#prev').addEventListener('click', () => shift(-1));
    $app.querySelector('#next').addEventListener('click', () => shift(1));
    $app.querySelector('#today').addEventListener('click', () => {
      const n = new Date(); cal.y = n.getFullYear(); cal.m = n.getMonth(); drawCalendar();
    });
    drawCalendar();
  }

  function itemStatus(s) {
    const idea = db.ideas.find((i) => i.id === s.ideaId);
    return idea && idea.status === 'publiee' ? 'publiee' : 'retenue';
  }

  function drawCalendar() {
    const root = $app.querySelector('#cal');
    if (!root) return;
    $app.querySelector('#calTitle').textContent =
      new Date(cal.y, cal.m, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

    const byDate = {};
    db.schedule.forEach((s) => { (byDate[s.date] = byDate[s.date] || []).push(s); });
    Object.values(byDate).forEach((arr) => arr.sort((a, b) => a.time.localeCompare(b.time)));

    const offset = (new Date(cal.y, cal.m, 1).getDay() + 6) % 7; // lundi = 0
    const daysInMonth = new Date(cal.y, cal.m + 1, 0).getDate();
    const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
    const today = todayISO();

    let html = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => `<div class="dow">${d}</div>`).join('');
    for (let k = 0; k < cells; k++) {
      const d = new Date(cal.y, cal.m, 1 - offset + k);
      const iso = toISODate(d);
      const evs = byDate[iso] || [];
      html += `
        <div class="day ${d.getMonth() !== cal.m ? 'other' : ''} ${iso === today ? 'today' : ''}">
          <span class="num">${d.getDate()}</span>
          <div class="ev">
            ${evs.map((s) => `
              <button class="chip st-${itemStatus(s)}" data-sid="${esc(s.id)}" title="${esc(s.time + ' – ' + s.title)}">
                <span class="t">${esc(s.time)}</span><span class="n">${esc(s.title)}</span>
              </button>`).join('')}
          </div>
        </div>`;
    }
    root.innerHTML = html;

    // Agenda du mois (utile sur mobile)
    const monthPrefix = `${cal.y}-${pad(cal.m + 1)}-`;
    const monthItems = db.schedule.filter((s) => s.date.startsWith(monthPrefix))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    $app.querySelector('#agenda').innerHTML = `
      <h3>Publications du mois</h3>
      ${monthItems.length ? monthItems.map((s) => `
        <button class="agenda-item st-${itemStatus(s)}" data-sid="${esc(s.id)}">
          <span class="when">${esc(fmtDateShort(s.date))} · ${esc(s.time)}</span>
          <span class="ttl">${esc(s.title)}</span>
        </button>`).join('') : '<p class="muted">Aucune publication prévue ce mois-ci.</p>'}`;
  }

  function onCalendarClick(e) {
    // Écouteur attaché à #app : on ignore s'il ne s'agit pas de la vue calendrier
    if (!$app.querySelector('#cal')) return;
    const b = e.target.closest('[data-sid]');
    if (b) showScheduleDialog(b.dataset.sid);
  }

  function showScheduleDialog(sid) {
    const s = db.schedule.find((x) => x.id === sid);
    if (!s) return;
    const idea = db.ideas.find((i) => i.id === s.ideaId) || null;
    const status = itemStatus(s);

    const d = makeDialog(`
      <div class="modal-body">
        <div class="modal-head"><h2>${esc(s.title)}</h2>${badge(status)}</div>
        <p class="when">📅 ${esc(fmtDateLong(s.date))} · 🕒 ${esc(s.time)}</p>
        <dl class="details">
          ${idea ? `
            <dt>Idée d'origine</dt><dd>${esc(idea.theme)}</dd>
            <dt>Promotion</dt><dd>${esc(idea.promotion)}</dd>
            <dt>Proposée par</dt><dd>${esc(authorLabel(idea))}</dd>
            <dt>Description</dt><dd class="pre">${esc(idea.description)}</dd>
            <dt>Raison du choix</dt><dd class="pre">${esc(idea.reason)}</dd>` : '<dt>Idée d\'origine</dt><dd>Introuvable</dd>'}
          <dt>Planifiée par</dt><dd>${esc(s.createdBy || '—')}</dd>
        </dl>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-close>Fermer</button>
          <button class="btn btn-ghost" data-act="toggle">${status === 'publiee' ? 'Repasser en « Retenue »' : 'Marquer comme publiée'}</button>
          <button class="btn btn-ghost" data-act="edit">Modifier</button>
          <button class="btn btn-danger" data-act="delete">Supprimer</button>
        </div>
      </div>`, { wide: true });

    d.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;

      if (act === 'edit') { d.close(); return go('/admin/modifier/' + encodeURIComponent(s.id)); }

      if (act === 'toggle') {
        if (idea) { idea.status = status === 'publiee' ? 'retenue' : 'publiee'; save(); }
        d.close(); drawCalendar();
        return toast(status === 'publiee' ? 'Repassée en « Retenue ».' : 'Marquée comme publiée.');
      }

      if (act === 'delete') {
        const r = await confirmBox({
          title: 'Supprimer cette publication ?',
          message: 'Elle sera retirée du tableau éditorial et l\'idée repassera en « Nouvelle ».',
          ok: 'Supprimer', danger: true,
        });
        if (!r) return;
        db.schedule = db.schedule.filter((x) => x.id !== s.id);
        if (idea) idea.status = 'nouvelle';
        save();
        d.close(); drawCalendar();
        toast('Publication supprimée.');
      }
    });
  }

  /* ---------------------------------------------------------
     Démarrage
     --------------------------------------------------------- */
  function renderLoadError(err) {
    $header.innerHTML = '';
    $app.innerHTML = `
      <div class="container narrow" style="margin-top:32px">
        <div class="alert">
          <h2>Impossible de charger data.json</h2>
          <p>Les navigateurs bloquent la lecture de fichiers locaux quand la page est ouverte en double-cliquant sur <code>index.html</code>.
          Lancez un petit serveur local dans le dossier de l'application :</p>
          <p><code>python -m http.server 8000</code> puis ouvrez <code>http://localhost:8000</code></p>
          <p class="muted">Ou utilisez l'extension « Live Server » de VS Code. (${esc(err.message)})</p>
        </div>
      </div>`;
  }

  async function init() {
    try {
      await loadData();
    } catch (err) {
      return renderLoadError(err);
    }
    window.addEventListener('hashchange', render);
    $app.addEventListener('click', onCalendarClick); // une seule fois (délégation)
    render();
  }
  init();
})();