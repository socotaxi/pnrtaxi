// ============================================================
//  admin.js — Dashboard administrateur PNR TAXI
//  Script classique (non-module) — Supabase chargé via CDN UMD
// ============================================================

// ── Supabase init ─────────────────────────────────────────────
const SUPABASE_URL      = 'https://rrisnxbuuoqfdewoqcfp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJyaXNueGJ1dW9xZmRld29xY2ZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2NDAxMjQsImV4cCI6MjA5MDIxNjEyNH0.3p4HkWf_mSPBDS32Yh1VOk6hSjFLAG2lqQg9oXO4_XY';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Audit logging ─────────────────────────────────────────────
async function audit(action, targetId, details) {
  try {
    var session = (await sb.auth.getSession()).data.session;
    if (!session) return;
    await sb.from('audit_log').insert({
      admin_email: session.user.email,
      action:      action,
      target_id:   targetId   || null,
      details:     details    || null,
    });
  } catch (_) {}
}

// ── État ─────────────────────────────────────────────────────
let currentFilter      = 'all';
let grantDriverId      = null;
let allDrivers         = [];
let allPendingPayments = [];
let pendingPage        = 0;
let driversPage        = 0;
const PAGE_SIZE        = 5;

// ── Authentification via Supabase Auth ────────────────────────
async function checkSession() {
  var res = await sb.auth.getSession();
  if (!res.data || !res.data.session) return false;
  var meta = res.data.session.user.user_metadata || {};
  return meta.role === 'admin';
}

async function clearSession() {
  await sb.auth.signOut();
}

// ── Démarrage ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async function () {
  if (await checkSession()) {
    showDashboard();
  } else {
    document.getElementById('login-screen').style.display = '';
    document.getElementById('admin-screen').style.display = 'none';
    setupLogin();
  }
});

function setupLogin() {
  var btn      = document.getElementById('login-btn');
  var emailIn  = document.getElementById('admin-email');
  var pwdIn    = document.getElementById('admin-password');
  var errorEl  = document.getElementById('login-error');
  var attempts = 0;
  var lockUntil = 0;

  async function tryLogin() {
    // Protection brute-force côté client
    if (Date.now() < lockUntil) {
      var secs = Math.ceil((lockUntil - Date.now()) / 1000);
      errorEl.textContent = 'Trop de tentatives. Attendez ' + secs + ' s.';
      return;
    }

    var email    = (emailIn.value || '').trim();
    var password = pwdIn.value;
    if (!email || !password) {
      errorEl.textContent = 'Email et mot de passe requis.';
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'Connexion…';
    errorEl.textContent = '';

    var res = await sb.auth.signInWithPassword({ email: email, password: password });

    if (res.error || !res.data.session) {
      attempts++;
      if (attempts >= 5) {
        lockUntil = Date.now() + 60 * 1000;
        attempts  = 0;
        errorEl.textContent = 'Trop de tentatives. Attendez 60 s.';
      } else {
        errorEl.textContent = 'Email ou mot de passe incorrect.';
      }
      pwdIn.value             = '';
      pwdIn.style.borderColor = 'var(--red)';
      setTimeout(function () { pwdIn.style.borderColor = ''; }, 1500);
      pwdIn.focus();
    } else {
      var meta = res.data.session.user.user_metadata || {};
      if (meta.role !== 'admin') {
        await sb.auth.signOut();
        errorEl.textContent = 'Accès refusé : compte non administrateur.';
        pwdIn.style.borderColor = 'var(--red)';
        setTimeout(function () { pwdIn.style.borderColor = ''; }, 1500);
      } else {
        attempts = 0;
        audit('login', null, { email: email });
        showDashboard();
      }
    }

    btn.disabled    = false;
    btn.textContent = 'Se connecter';
  }

  btn.addEventListener('click', tryLogin);
  pwdIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryLogin(); });
}

// ── Afficher le dashboard ─────────────────────────────────────
async function showDashboard() {
  var loginEl = document.getElementById('login-screen');
  var adminEl = document.getElementById('admin-screen');

  if (loginEl) loginEl.style.display = 'none';
  if (adminEl) {
    adminEl.removeAttribute('style');
    adminEl.style.display = 'block';
  }

  var backBtn = document.getElementById('admin-back-btn');
  if (backBtn) {
    var backTarget = 'index.html';
    try {
      if (localStorage.getItem('pnr_driver'))    backTarget = 'driver.html';
      else if (localStorage.getItem('pnr_passenger')) backTarget = 'passenger.html';
    } catch (_) {}
    backBtn.addEventListener('click', function () {
      window.location.href = backTarget;
    });
  }

  var logoutBtn = document.getElementById('admin-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async function () {
      await audit('logout', null, null);
      await clearSession();
      window.location.reload();
    });
  }

  // Initialisation des UI statiques (ne dépend pas de Supabase)
  setupConfigSave();
  setupTabs();
  setupGrantModal();
  setupAuditRefresh();

  // Chargement des données (chacun gère ses propres erreurs)
  try { await loadConfig(); } catch(_) {}
  try { await loadKPIs(); }   catch(_) {}
  try { await loadPendingPayments(); } catch(_) {
    var w = document.getElementById('pending-table-wrap');
    if (w) w.innerHTML = '<div class="table-empty"><div class="table-empty-icon">⚠️</div><div>Exécutez d\'abord payment.sql dans Supabase</div></div>';
  }
  try { await loadDrivers(); } catch(_) {
    var w2 = document.getElementById('drivers-table-wrap');
    if (w2) w2.innerHTML = '<div class="table-empty"><div>Erreur de chargement des chauffeurs</div></div>';
  }
  try { await loadAuditLog(); } catch(_) {}

  try { setupRealtimeSubscription(); } catch(_) {}
}

// ── Rafraîchissement global ───────────────────────────────────
async function refreshAll() {
  await Promise.all([
    loadKPIs().catch(function(e) { console.warn('KPI error:', e); }),
    loadPendingPayments().catch(function(e) { console.warn('Pending error:', e); }),
    loadDrivers().catch(function(e) { console.warn('Drivers error:', e); }),
  ]);
}

// ── KPIs ──────────────────────────────────────────────────────
async function loadKPIs() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [r1, r2, r3, r4] = await Promise.all([
    sb.from('drivers').select('*', { count: 'exact', head: true }),
    sb.from('drivers').select('*', { count: 'exact', head: true }).eq('disponible', true),
    sb.from('driver_access').select('*', { count: 'exact', head: true }).eq('statut', 'en_attente'),
    sb.from('driver_access').select('montant').eq('statut', 'actif').neq('type', 'gratuit').gte('created_at', startOfMonth),
  ]);

  const revenue = (r4.data || []).reduce(function (s, r) { return s + (r.montant || 0); }, 0);

  setText('kpi-drivers', r1.count ?? 0);
  setText('kpi-online',  r2.count ?? 0);
  setText('kpi-pending', r3.count ?? 0);
  setText('kpi-revenue', revenue.toLocaleString('fr-FR'));

  var badge = document.getElementById('pending-count-badge');
  if (badge) badge.textContent = r3.count ?? 0;
}

// ── Configuration ─────────────────────────────────────────────
async function loadConfig() {
  var res = await sb.from('app_config').select('cle, valeur');
  if (!res.data) return;

  var cfg = {};
  res.data.forEach(function (r) { cfg[r.cle] = r.valeur; });

  var gratuiteEl = document.getElementById('cfg-gratuite');
  var dureeEl    = document.getElementById('cfg-duree');
  var journeeEl  = document.getElementById('cfg-journee');
  var semaineEl  = document.getElementById('cfg-semaine');

  if (gratuiteEl) gratuiteEl.checked = cfg.gratuite_active === 'true';
  if (dureeEl)    dureeEl.value      = cfg.gratuite_duree_mois || '1';
  if (journeeEl)  journeeEl.value    = cfg.tarif_journee || '500';
  if (semaineEl)  semaineEl.value    = cfg.tarif_semaine || '1000';
}

function setupConfigSave() {
  var btn      = document.getElementById('config-save-btn');
  var feedback = document.getElementById('config-feedback');
  if (!btn) return;

  btn.addEventListener('click', async function () {
    btn.disabled    = true;
    btn.textContent = 'Enregistrement…';
    feedback.textContent = '';

    var updates = [
      { cle: 'gratuite_active',     valeur: document.getElementById('cfg-gratuite')?.checked ? 'true' : 'false' },
      { cle: 'gratuite_duree_mois', valeur: document.getElementById('cfg-duree')?.value || '1' },
      { cle: 'tarif_journee',       valeur: document.getElementById('cfg-journee')?.value || '500' },
      { cle: 'tarif_semaine',       valeur: document.getElementById('cfg-semaine')?.value || '1000' },
    ];

    var ok = true;
    for (var i = 0; i < updates.length; i++) {
      var res = await sb.from('app_config').upsert({ cle: updates[i].cle, valeur: updates[i].valeur });
      if (res.error) { ok = false; break; }
    }

    btn.disabled    = false;
    btn.textContent = 'Enregistrer la configuration';

    if (ok) {
      var cfg = {};
      updates.forEach(function (u) { cfg[u.cle] = u.valeur; });
      await audit('update_config', null, cfg);
      feedback.style.color = 'var(--green)';
      feedback.textContent = '✓ Configuration enregistrée';
      showSnackbar('Configuration mise à jour avec succès');
    } else {
      feedback.style.color = 'var(--red)';
      feedback.textContent = '✗ Erreur lors de la sauvegarde';
    }

    setTimeout(function () { feedback.textContent = ''; }, 3000);
  });
}

// ── Paiements en attente ──────────────────────────────────────
async function loadPendingPayments() {
  var wrap = document.getElementById('pending-table-wrap');
  if (!wrap) return;

  var res = await sb
    .from('driver_access')
    .select('id, driver_id, type, montant, ref_paiement, operateur, created_at, drivers ( nom, prenom, telephone, photo )')
    .eq('statut', 'en_attente')
    .order('created_at', { ascending: false });

  var data = res.data;

  if (!data || data.length === 0) {
    allPendingPayments = [];
    pendingPage = 0;
    wrap.innerHTML = '<div class="table-empty"><div class="table-empty-icon">🎉</div><div>Aucun paiement en attente</div></div>';
    return;
  }

  allPendingPayments = data;
  pendingPage = 0;

  var badge = document.getElementById('pending-count-badge');
  if (badge) badge.textContent = data.length;

  renderPendingTable();
}

function renderPendingTable() {
  var wrap = document.getElementById('pending-table-wrap');
  if (!wrap) return;

  var data  = allPendingPayments;
  var total = data.length;
  var slice = data.slice(pendingPage * PAGE_SIZE, (pendingPage + 1) * PAGE_SIZE);

  var rows = slice.map(renderPendingRow).join('');
  wrap.innerHTML = '<div class="table-scroll"><table class="data-table"><thead><tr><th>Chauffeur</th><th>Formule</th><th>Opérateur</th><th>Référence</th><th>Date</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + buildPagination(pendingPage, total, 'pending-prev', 'pending-next');

  wrap.querySelectorAll('[data-action="validate"]').forEach(function (btn) {
    btn.addEventListener('click', function () { validatePayment(btn.dataset.id, btn.dataset.type); });
  });
  wrap.querySelectorAll('[data-action="reject"]').forEach(function (btn) {
    btn.addEventListener('click', function () { rejectPayment(btn.dataset.id); });
  });

  var pp = document.getElementById('pending-prev');
  var pn = document.getElementById('pending-next');
  if (pp) pp.addEventListener('click', function () { pendingPage--; renderPendingTable(); });
  if (pn) pn.addEventListener('click', function () { pendingPage++; renderPendingTable(); });
}

function renderPendingRow(row) {
  var driver   = row.drivers || {};
  var name     = [driver.prenom, driver.nom].filter(Boolean).join(' ') || row.driver_id;
  var initiale = (driver.prenom || driver.nom || '?').charAt(0).toUpperCase();
  var avatar   = driver.photo ? '<img src="' + driver.photo + '" alt="' + name + '" />' : initiale;
  var opBadge  = row.operateur === 'mtn'
    ? '<span class="op-badge op-badge--mtn">🟡 MTN</span>'
    : '<span class="op-badge op-badge--airtel">🔴 Airtel</span>';
  var planLabel = row.type === 'journee' ? '☀️ Journée' : '📅 Semaine';

  return '<tr><td><div class="driver-cell"><div class="driver-avatar">' + avatar + '</div><div><div class="driver-name">' + name + '</div><div class="driver-phone">' + (driver.telephone || row.driver_id) + '</div></div></div></td>'
    + '<td data-label="Formule"><span class="badge badge--blue">' + planLabel + '</span><div style="font-size:.75rem;color:var(--muted);margin-top:3px">' + row.montant + ' FCFA</div></td>'
    + '<td data-label="Opérateur">' + opBadge + '</td>'
    + '<td data-label="Référence"><span class="ref-code">' + (row.ref_paiement || '—') + '</span></td>'
    + '<td data-label="Date" style="font-size:.78rem;color:var(--muted)">' + formatDate(row.created_at) + '</td>'
    + '<td><div class="actions-group"><button class="action-btn action-btn--validate" data-action="validate" data-id="' + row.id + '" data-type="' + row.type + '" title="Valider">✓</button><button class="action-btn action-btn--reject" data-action="reject" data-id="' + row.id + '" title="Rejeter">✕</button></div></td></tr>';
}

async function validatePayment(accessId, type) {
  var now = new Date();
  var exp = new Date(now);
  if (type === 'journee') {
    exp.setHours(23, 59, 59, 999);
  } else {
    exp.setDate(exp.getDate() + 7);
  }

  var res = await sb.from('driver_access').update({ statut: 'actif', date_debut: now.toISOString(), date_expiration: exp.toISOString() }).eq('id', accessId);
  if (res.error) {
    showSnackbar('Erreur lors de la validation', 'error');
  } else {
    await audit('validate_payment', accessId, { type: type, date_expiration: exp.toISOString() });
    showSnackbar('Accès validé avec succès ✓');
    await refreshAll();
  }
}

async function rejectPayment(accessId) {
  if (!confirm('Rejeter cette demande de paiement ?')) return;
  var res = await sb.from('driver_access').delete().eq('id', accessId);
  if (res.error) {
    showSnackbar('Erreur lors du rejet', 'error');
  } else {
    await audit('reject_payment', accessId, null);
    showSnackbar('Demande rejetée');
    await refreshAll();
  }
}

// ── Liste des chauffeurs ──────────────────────────────────────
async function loadDrivers() {
  var wrap = document.getElementById('drivers-table-wrap');
  if (!wrap) return;

  var r1 = await sb.from('drivers').select('*').order('created_at', { ascending: false });
  if (r1.error || !r1.data) { wrap.innerHTML = '<div class="table-empty"><div>Erreur de chargement</div></div>'; return; }

  var r2 = await sb.from('driver_access').select('*').in('statut', ['actif', 'en_attente']).gt('date_expiration', new Date().toISOString());

  var accessMap = {};
  (r2.data || []).forEach(function (a) {
    if (!accessMap[a.driver_id] || a.statut === 'actif') accessMap[a.driver_id] = a;
  });

  allDrivers = r1.data.map(function (d) { return Object.assign({}, d, { access: accessMap[d.id] || null }); });

  var badge = document.getElementById('drivers-count-badge');
  if (badge) badge.textContent = allDrivers.length;

  renderDriversTable();
}

function renderDriversTable() {
  var wrap = document.getElementById('drivers-table-wrap');
  if (!wrap) return;

  var filtered = filterDrivers(allDrivers, currentFilter);

  if (filtered.length === 0) {
    wrap.innerHTML = '<div class="table-empty"><div class="table-empty-icon">🔍</div><div>Aucun chauffeur dans cette catégorie</div></div>';
    return;
  }

  var total = filtered.length;
  var slice = filtered.slice(driversPage * PAGE_SIZE, (driversPage + 1) * PAGE_SIZE);

  var rows = slice.map(renderDriverRow).join('');
  wrap.innerHTML = '<div class="table-scroll"><table class="data-table"><thead><tr><th>Chauffeur</th><th>Statut GPS</th><th>Accès</th><th>Expire le</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + buildPagination(driversPage, total, 'drivers-prev', 'drivers-next');

  wrap.querySelectorAll('[data-action="grant"]').forEach(function (btn) {
    btn.addEventListener('click', function () { openGrantModal(btn.dataset.id, btn.dataset.name); });
  });
  wrap.querySelectorAll('[data-action="disable"]').forEach(function (btn) {
    btn.addEventListener('click', function () { disableDriverAccess(btn.dataset.id); });
  });

  var dp = document.getElementById('drivers-prev');
  var dn = document.getElementById('drivers-next');
  if (dp) dp.addEventListener('click', function () { driversPage--; renderDriversTable(); });
  if (dn) dn.addEventListener('click', function () { driversPage++; renderDriversTable(); });
}

function filterDrivers(drivers, filter) {
  if (filter === 'all') return drivers;
  return drivers.filter(function (d) {
    var a = d.access;
    if (filter === 'actif')   return a && a.statut === 'actif' && a.type !== 'gratuit';
    if (filter === 'gratuit') return a && a.statut === 'actif' && a.type === 'gratuit';
    if (filter === 'expire')  return !a || a.statut === 'en_attente';
    return true;
  });
}

function renderDriverRow(driver) {
  var name     = [driver.prenom, driver.nom].filter(Boolean).join(' ') || '—';
  var initiale = (driver.prenom || driver.nom || '?').charAt(0).toUpperCase();
  var avatar   = driver.photo ? '<img src="' + driver.photo + '" alt="' + name + '" />' : initiale;

  var gpsStatus = driver.disponible
    ? '<span class="badge badge--green">🟢 En service</span>'
    : '<span class="badge" style="background:#f1f5f9;color:var(--muted);border:1px solid var(--border)">⚫ Hors service</span>';

  var accessBadge = '';
  var expireCell  = '—';
  var a = driver.access;

  if (!a) {
    accessBadge = '<span class="badge badge--red">🔒 Aucun accès</span>';
  } else if (a.statut === 'en_attente') {
    accessBadge = '<span class="badge badge--amber">⏳ En attente</span>';
  } else if (a.type === 'gratuit') {
    accessBadge = '<span class="badge badge--blue">🎁 Gratuit</span>';
    expireCell  = formatDate(a.date_expiration, true);
  } else {
    accessBadge = '<span class="badge badge--green">✅ Actif</span>';
    expireCell  = formatDate(a.date_expiration, true);
  }

  return '<tr><td><div class="driver-cell"><div class="driver-avatar">' + avatar + '</div><div><div class="driver-name">' + name + '</div><div class="driver-phone">' + (driver.telephone || driver.id) + '</div></div></div></td>'
    + '<td data-label="GPS">' + gpsStatus + '</td>'
    + '<td data-label="Accès">' + accessBadge + '</td>'
    + '<td data-label="Expire le" style="font-size:.82rem;color:var(--muted)">' + expireCell + '</td>'
    + '<td><div class="actions-group"><button class="action-btn action-btn--grant" data-action="grant" data-id="' + driver.id + '" data-name="' + name + '" title="Offrir accès">🎁</button><button class="action-btn action-btn--disable" data-action="disable" data-id="' + driver.id + '" title="Révoquer accès">🚫</button></div></td></tr>';
}

// ── Tabs ──────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      driversPage = 0;
      renderDriversTable();
    });
  });
}

// ── Modal offrir accès ────────────────────────────────────────
function setupGrantModal() {
  var modal      = document.getElementById('grant-modal');
  var cancelBtn  = document.getElementById('grant-cancel-btn');
  var confirmBtn = document.getElementById('grant-confirm-btn');
  var typeSelect = document.getElementById('grant-type');
  var customWrap = document.getElementById('grant-custom-days-wrap');

  typeSelect && typeSelect.addEventListener('change', function () {
    customWrap.style.display = typeSelect.value === 'gratuit' ? '' : 'none';
  });

  cancelBtn && cancelBtn.addEventListener('click', function () {
    modal.classList.remove('open');
    grantDriverId = null;
  });

  modal && modal.addEventListener('click', function (e) {
    if (e.target === modal) { modal.classList.remove('open'); grantDriverId = null; }
  });

  confirmBtn && confirmBtn.addEventListener('click', async function () {
    if (!grantDriverId) return;
    confirmBtn.disabled    = true;
    confirmBtn.textContent = '…';

    var type = typeSelect.value;
    var days = type === 'journee' ? 1 : type === 'semaine' ? 7 : parseInt(document.getElementById('grant-days')?.value || '7', 10);
    var now  = new Date();
    var exp  = new Date(now);

    if (type === 'journee') {
      exp.setHours(23, 59, 59, 999);
    } else {
      exp.setDate(exp.getDate() + days);
    }

    await sb.from('driver_access').update({ statut: 'expire' }).eq('driver_id', grantDriverId).eq('statut', 'actif');

    var res = await sb.from('driver_access').insert({
      driver_id: grantDriverId, type: type, montant: 0,
      date_debut: now.toISOString(), date_expiration: exp.toISOString(), statut: 'actif',
    });

    var auditTargetId = grantDriverId;
    confirmBtn.disabled    = false;
    confirmBtn.textContent = "Activer l'accès";
    modal.classList.remove('open');
    grantDriverId = null;

    if (res.error) {
      showSnackbar("Erreur lors de l'activation", 'error');
    } else {
      await audit('grant_access', auditTargetId, { type: type, days: days, date_expiration: exp.toISOString() });
      showSnackbar('Accès activé avec succès ✓');
      await refreshAll();
    }
  });
}

function openGrantModal(driverId, driverName) {
  grantDriverId = driverId;
  var modal  = document.getElementById('grant-modal');
  var nameEl = document.getElementById('grant-modal-driver-name');
  if (nameEl) nameEl.textContent = 'Pour : ' + driverName;
  modal && modal.classList.add('open');
}

async function disableDriverAccess(driverId) {
  if (!confirm('Révoquer tous les accès actifs de ce chauffeur ?')) return;
  var res = await sb.from('driver_access').update({ statut: 'expire' }).eq('driver_id', driverId).in('statut', ['actif', 'en_attente']);
  if (res.error) {
    showSnackbar('Erreur lors de la révocation', 'error');
  } else {
    await audit('revoke_access', driverId, null);
    showSnackbar('Accès révoqué');
    await refreshAll();
  }
}

// ── Temps réel ────────────────────────────────────────────────
function setupRealtimeSubscription() {
  sb.channel('admin-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_access' }, async function () { await refreshAll(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' },       async function () { await loadKPIs(); await loadDrivers(); })
    .subscribe();
}

// ── Journal d'audit ───────────────────────────────────────────
var ACTION_LABELS = {
  login:            'Connexion',
  logout:           'Déconnexion',
  validate_payment: 'Paiement validé',
  reject_payment:   'Paiement rejeté',
  grant_access:     'Accès offert',
  revoke_access:    'Accès révoqué',
  update_config:    'Config modifiée',
};

async function loadAuditLog() {
  var wrap = document.getElementById('audit-table-wrap');
  if (!wrap) return;

  var res = await sb
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (res.error || !res.data || res.data.length === 0) {
    wrap.innerHTML = '<div class="table-empty"><div class="table-empty-icon">📋</div><div>Aucune action enregistrée</div></div>';
    return;
  }

  var rows = res.data.map(function (row) {
    var label   = ACTION_LABELS[row.action] || row.action;
    var details = '';
    if (row.details) {
      try {
        var d = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
        details = Object.entries(d).map(function (kv) { return kv[0] + ': ' + kv[1]; }).join(' · ');
      } catch (_) {}
    }
    return '<tr>'
      + '<td data-label="Date" style="font-size:.78rem;color:var(--muted);white-space:nowrap">' + formatDate(row.created_at) + '</td>'
      + '<td data-label="Admin" style="font-size:.82rem">' + (row.admin_email || '—') + '</td>'
      + '<td data-label="Action"><span class="badge badge--blue" style="font-size:.75rem">' + label + '</span></td>'
      + '<td data-label="Cible" style="font-size:.78rem;color:var(--muted);font-family:monospace">' + (row.target_id ? row.target_id.slice(0, 8) + '…' : '—') + '</td>'
      + '<td data-label="Détails" style="font-size:.75rem;color:var(--muted)">' + (details || '—') + '</td>'
      + '</tr>';
  }).join('');

  wrap.innerHTML = '<div class="table-scroll"><table class="data-table">'
    + '<thead><tr><th>Date</th><th>Admin</th><th>Action</th><th>Cible</th><th>Détails</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div>';
}

function setupAuditRefresh() {
  var btn = document.getElementById('audit-refresh-btn');
  if (btn) btn.addEventListener('click', function () { loadAuditLog(); });
}

// ── Pagination ────────────────────────────────────────────────
function buildPagination(page, total, prevId, nextId) {
  var totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages <= 1) return '';
  var from = page * PAGE_SIZE + 1;
  var to   = Math.min((page + 1) * PAGE_SIZE, total);
  return '<div class="pagination">'
    + '<button class="page-btn" id="' + prevId + '"' + (page === 0 ? ' disabled' : '') + '>‹ Préc.</button>'
    + '<span class="page-info">' + from + '–' + to + ' / ' + total + '</span>'
    + '<button class="page-btn" id="' + nextId + '"' + (page >= totalPages - 1 ? ' disabled' : '') + '>Suiv. ›</button>'
    + '</div>';
}

// ── Utilitaires ───────────────────────────────────────────────
function setText(id, value) {
  var el = document.getElementById(id);
  if (el) el.textContent = value;
}

function formatDate(iso, short) {
  if (!iso) return '—';
  var d = new Date(iso);
  if (short) return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function showSnackbar(message, type) {
  var el = document.getElementById('snackbar');
  if (!el) return;
  el.textContent     = type === 'error' ? '⚠️ ' + message : '✓ ' + message;
  el.style.background = type === 'error' ? '#b91c1c' : '#1e293b';
  el.classList.add('show');
  setTimeout(function () { el.classList.remove('show'); }, 3000);
}
