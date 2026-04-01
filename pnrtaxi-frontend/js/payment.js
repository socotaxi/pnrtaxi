// ============================================================
//  payment.js — Système d'accès payant PNR TAXI
//  Flux : Vérification accès → Modal paiement USSD → Attente admin
// ============================================================

// ── Vérification de l'accès driver ──────────────────────────
/**
 * Vérifie si le driver a un accès actif.
 * Gère aussi la création automatique de la période gratuite.
 *
 * @returns {{ status: 'gratuit'|'actif'|'en_attente'|'expire'|'none', expiration: string|null }}
 */
export async function checkDriverAccess(driverId, supabase) {
  // 1. Récupérer TOUS les accès actifs non expirés + config en parallèle
  const [{ data: actifRows }, config] = await Promise.all([
    supabase
      .from('driver_access')
      .select('*')
      .eq('driver_id', driverId)
      .eq('statut', 'actif')
      .gt('date_expiration', new Date().toISOString())
      .order('date_expiration', { ascending: false }),
    getAppConfig(supabase),
  ]);

  if (actifRows && actifRows.length > 0) {
    const gratuiteActive = config.gratuite_active === 'true';

    // Priorité 1 : accès payant (journee ou semaine)
    const paidRow = actifRows.find(r => r.type !== 'gratuit');
    if (paidRow) {
      return { status: 'actif', expiration: paidRow.date_expiration, row: paidRow };
    }

    // Priorité 2 : accès gratuit (seulement si la gratuite est active)
    const gratuitRow = actifRows.find(r => r.type === 'gratuit');
    if (gratuitRow && gratuiteActive) {
      return { status: 'gratuit', expiration: gratuitRow.date_expiration, row: gratuitRow };
    }
  }

  // 2. Chercher un accès en attente de validation
  const { data: pendingRows } = await supabase
    .from('driver_access')
    .select('*')
    .eq('driver_id', driverId)
    .eq('statut', 'en_attente')
    .order('created_at', { ascending: false })
    .limit(1);

  if (pendingRows && pendingRows.length > 0) {
    return { status: 'en_attente', expiration: null, row: pendingRows[0] };
  }

  // 3. Aucun accès → vérifier si la période gratuite peut être créée
  if (config.gratuite_active === 'true') {
    const created = await createFreeAccess(driverId, supabase, parseInt(config.gratuite_duree_mois, 10));
    if (created) {
      return { status: 'gratuit', expiration: created.date_expiration, row: created };
    }
  }

  // 4. Vérifier s'il y a un accès expiré (pour info)
  const { data: expiredRows } = await supabase
    .from('driver_access')
    .select('id')
    .eq('driver_id', driverId)
    .limit(1);

  return {
    status:     expiredRows && expiredRows.length > 0 ? 'expire' : 'none',
    expiration: null,
    row:        null,
  };
}

// ── Récupérer la configuration globale ──────────────────────
async function getAppConfig(supabase) {
  const { data } = await supabase.from('app_config').select('cle, valeur');
  if (!data) return {};
  return data.reduce((acc, row) => { acc[row.cle] = row.valeur; return acc; }, {});
}

// ── Créer la période gratuite ────────────────────────────────
async function createFreeAccess(driverId, supabase, mois = 1) {
  const now = new Date();
  const exp = new Date(now);
  exp.setMonth(exp.getMonth() + mois);

  const { data, error } = await supabase
    .from('driver_access')
    .insert({
      driver_id:       driverId,
      type:            'gratuit',
      montant:         0,
      date_debut:      now.toISOString(),
      date_expiration: exp.toISOString(),
      statut:          'actif',
    })
    .select()
    .single();

  if (error) { console.warn('Erreur création accès gratuit:', error.message); return null; }
  return data;
}

// ── Initialisation du modal ──────────────────────────────────
export async function initPaymentModal(driverId, supabase, onSuccess) {
  const overlay       = document.getElementById('pay-overlay');
  const pendingOvl    = document.getElementById('pending-overlay');
  const cancelBtn     = document.getElementById('pay-cancel-btn');
  const submitBtn     = document.getElementById('pay-submit-btn');
  const submitLabel   = document.getElementById('pay-submit-label');
  const spinner       = document.getElementById('pay-spinner');
  const errorEl       = document.getElementById('pay-error');
  const refInput      = document.getElementById('pay-ref-input');
  const pendingClose  = document.getElementById('pending-close-btn');

  if (!overlay) return;

  // ── Subscription Realtime — écoute les changements d'accès ─
  supabase
    .channel(`driver-access-${driverId}`)
    .on(
      'postgres_changes',
      {
        event:  'UPDATE',
        schema: 'public',
        table:  'driver_access',
        filter: `driver_id=eq.${driverId}`,
      },
      async (payload) => {
        const newRow = payload.new;

        // Fermer la modale "en attente" si elle est ouverte
        if (pendingOvl) {
          pendingOvl.classList.remove('open');
          pendingOvl.setAttribute('aria-hidden', 'true');
        }

        if (newRow.statut === 'actif') {
          // Accès validé par l'admin → son + notification + rafraîchissement
          playBeep();
          showAccessToast('✅ Votre accès a été activé ! Vous pouvez vous mettre en service.');
        } else if (newRow.statut === 'expire') {
          showAccessToast('⚠️ Votre accès a expiré. Renouvelez votre abonnement.');
        }

        if (onSuccess) onSuccess();
      }
    )
    .subscribe();

  // ── Plan sélectionné dans la modal ───────────────────────
  function getSelectedPlan() {
    const active = overlay.querySelector('.pay-plan-btn.active');
    return active ? active.dataset.plan : 'journee';
  }

  function updateAmountDisplay() {
    const amount   = getSelectedPlan() === 'semaine' ? 1000 : 500;
    const mtnEl    = document.getElementById('mtn-amount');
    const airtelEl = document.getElementById('airtel-amount');
    if (mtnEl)    mtnEl.textContent    = amount;
    if (airtelEl) airtelEl.textContent = amount;
  }

  // ── Sélection de la formule dans la modal ─────────────────
  overlay.querySelectorAll('.pay-plan-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.pay-plan-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateAmountDisplay();
    });
  });

  // ── Sélection de l'opérateur ───────────────────────────────
  const opBtns   = overlay.querySelectorAll('.pay-op');
  let currentOp  = 'mtn';

  opBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      opBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentOp = btn.dataset.op;

      document.getElementById('steps-mtn').style.display    = currentOp === 'mtn'    ? '' : 'none';
      document.getElementById('steps-airtel').style.display = currentOp === 'airtel' ? '' : 'none';
    });
  });

  // Mise à jour initiale du montant affiché
  updateAmountDisplay();

  // ── Fermeture ──────────────────────────────────────────────
  function closeModal() {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    refInput.value      = '';
    errorEl.textContent = '';
  }

  function openModal() {
    updateAmountDisplay(); // synchronise le montant avec le plan choisi dans le dashboard
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
  }

  cancelBtn?.addEventListener('click', closeModal);

  // Fermer en cliquant sur le backdrop
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  // Fermer la modale "en attente"
  pendingClose?.addEventListener('click', () => {
    pendingOvl.classList.remove('open');
    pendingOvl.setAttribute('aria-hidden', 'true');
  });

  // ── Soumission ─────────────────────────────────────────────
  submitBtn?.addEventListener('click', async () => {
    const ref  = refInput.value.trim();
    const plan = getSelectedPlan();

    errorEl.textContent = '';

    if (!ref || ref.length < 4) {
      errorEl.textContent = 'Veuillez saisir la référence de votre transaction.';
      refInput.focus();
      return;
    }

    // Désactiver le bouton
    submitBtn.disabled       = true;
    submitLabel.style.display = 'none';
    spinner.style.display     = '';

    try {
      const { error } = await supabase
        .from('driver_access')
        .insert({
          driver_id:       driverId,
          type:            plan,
          montant:         plan === 'semaine' ? 1000 : 500,
          date_debut:      new Date().toISOString(),
          // date_expiration provisoire — l'admin la confirme lors de la validation
          date_expiration: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          statut:          'en_attente',
          ref_paiement:    ref.toUpperCase(),
          operateur:       currentOp,
        });

      if (error) throw error;

      // Succès
      closeModal();
      pendingOvl.classList.add('open');
      pendingOvl.setAttribute('aria-hidden', 'false');
      if (onSuccess) onSuccess();

    } catch (err) {
      console.error('Erreur soumission paiement:', err);
      errorEl.textContent = 'Une erreur est survenue. Vérifiez votre connexion et réessayez.';
    } finally {
      submitBtn.disabled       = false;
      submitLabel.style.display = '';
      spinner.style.display     = 'none';
    }
  });

  return { openModal };
}

// ── Toast de notification d'accès ────────────────────────────
function showAccessToast(message) {
  let toast = document.getElementById('access-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'access-toast';
    toast.style.cssText = [
      'position:fixed', 'bottom:90px', 'left:50%',
      'transform:translateX(-50%) translateY(20px)',
      'background:#1e293b', 'color:white',
      'padding:13px 20px', 'border-radius:14px',
      'font-size:0.875rem', 'font-weight:600',
      'box-shadow:0 8px 30px rgba(0,0,0,0.25)',
      'z-index:999', 'max-width:320px', 'text-align:center',
      'opacity:0', 'transition:opacity 0.3s ease, transform 0.3s ease',
    ].join(';');
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  requestAnimationFrame(() => {
    toast.style.opacity   = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity   = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
  }, 4000);
}

// ── Son de notification d'activation ─────────────────────────
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Deux bips courts montants (do → mi)
    const notes = [
      { freq: 523.25, start: 0,    duration: 0.12 },  // do5
      { freq: 659.25, start: 0.15, duration: 0.18 },  // mi5
    ];

    notes.forEach(({ freq, start, duration }) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type      = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);

      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);

      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration + 0.05);
    });

    // Fermer le contexte après la fin des sons
    setTimeout(() => ctx.close(), 600);
  } catch (e) {
    // Web Audio non supporté ou bloqué → pas de son, pas d'erreur
  }
}
