// ============================================================
//  auth.js — Système d'authentification PNR Taxi
//  Flow téléphone : Numéro → vérification en base → session
//  Flow OAuth     : Google / Facebook → session
// ============================================================

import { supabase } from './supabase-config.js';

const SESSION_KEY    = 'pnr_passenger';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

// ── Session ──────────────────────────────────────────────────
export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch { return null; }
}

function saveSession(telephone, prenom, nom = null, email = null, auth_provider = null, avatar_url = null, quartier = null, ville = null) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    telephone, prenom, nom, email, auth_provider, avatar_url, quartier, ville,
    expiresAt: Date.now() + SESSION_TTL_MS,
  }));
}

export async function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  await supabase.auth.signOut().catch(() => {});
}

// ── OAuth (Google / Facebook) ─────────────────────────────────
export async function loginWithOAuth(provider) {
  const redirectTo = window.location.href.split('?')[0].split('#')[0];
  const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
  if (error) throw error;
}

async function handleOAuthCallback() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const user = session.user;

  // Ignorer les connexions email/password (admin ou autre) — seul OAuth est concerné ici
  const provider = user.app_metadata?.provider || 'email';
  if (provider === 'email') {
    localStorage.removeItem(SESSION_KEY); // purger toute session passager stale liée à ce compte
    return null;
  }

  // Ne pas traiter le compte admin comme un passager OAuth
  const sessionMeta = user.user_metadata || {};
  if (sessionMeta.role === 'admin') {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }

  if (!user.email) return null;

  const email    = user.email;
  const meta     = user.user_metadata || {};
  const fullName = meta.full_name || meta.name || '';
  const prenom   = fullName.split(' ')[0] || email.split('@')[0] || 'Passager';
  const nom      = fullName.split(' ').slice(1).join(' ') || '';

  try {
    await supabase.from('passengers').upsert(
      { email, prenom, nom, auth_provider: provider, verified: true, telephone: null },
      { onConflict: 'email' }
    );
  } catch (_) {}

  saveSession(null, prenom, nom, email, provider);
  return { prenom, nom, email, auth_provider: provider };
}

// ── Lookup téléphone via RPC (sans OTP) ──────────────────────
async function findPassengerByPhone(telephone) {
  const { data, error } = await supabase.rpc('get_passenger_by_phone', { p_telephone: telephone });
  if (error || !data || data.length === 0) return null;
  return data[0];
}

async function registerPassenger(telephone, prenom, nom, quartier, ville) {
  const { error } = await supabase.rpc('upsert_passenger', {
    p_telephone: telephone,
    p_prenom:    prenom,
    p_nom:       nom,
    p_quartier:  quartier,
    p_ville:     ville,
  });
  if (error) throw error;
}

// ── Avatar upload ─────────────────────────────────────────────
const AVATAR_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const AVATAR_MAX_SIZE_MB   = 5;

async function uploadAvatar(telephone, file) {
  if (!file) return null;
  if (!AVATAR_ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Format non supporté. Utilisez JPEG, PNG, WebP ou GIF.');
  }
  if (file.size > AVATAR_MAX_SIZE_MB * 1024 * 1024) {
    throw new Error(`Image trop lourde. Maximum ${AVATAR_MAX_SIZE_MB} Mo.`);
  }
  const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  const ext  = extMap[file.type];
  const path = `passengers/${telephone}.${ext}`;
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}

// ── Navigation entre écrans ───────────────────────────────────
function goTo(screenId) {
  document.querySelectorAll('.auth-screen').forEach(s => s.classList.remove('active'));
  requestAnimationFrame(() => document.getElementById(screenId).classList.add('active'));
}

// ── Helpers UI ────────────────────────────────────────────────
function setLoading(btn, loading, label) {
  btn.disabled = loading;
  btn.textContent = loading ? '…' : label;
}

function showAuthError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 5000);
}

// ── Point d'entrée principal ──────────────────────────────────
export async function initAuth(onComplete) {
  // 1. Retour de redirection OAuth ?
  const oauthSession = await handleOAuthCallback();
  if (oauthSession) {
    onComplete(oauthSession);
    return;
  }

  // 2. Session locale existante ?
  const session = getSession();
  if (session) {
    onComplete(session);
    return;
  }

  document.getElementById('auth-overlay').classList.add('visible');

  // ── Boutons OAuth ────────────────────────────────────────────
  document.getElementById('btn-oauth-google').addEventListener('click', async () => {
    try { await loginWithOAuth('google'); }
    catch { showAuthError('phone-error', 'Erreur Google. Réessayez.'); }
  });

  document.getElementById('btn-oauth-facebook').addEventListener('click', async () => {
    try { await loginWithOAuth('facebook'); }
    catch { showAuthError('phone-error', 'Erreur Facebook. Réessayez.'); }
  });

  let currentPhone = '';

  // ────────────────────────────────────────────────
  // ÉCRAN 1 — Numéro de téléphone
  // ────────────────────────────────────────────────
  const btnSend      = document.getElementById('btn-send-otp');
  const phoneInput   = document.getElementById('auth-phone-input');
  const prefixSelect = document.getElementById('phone-prefix-select');

  phoneInput.addEventListener('input', () => {
    phoneInput.value  = phoneInput.value.replace(/\D/g, '').slice(0, 9);
    btnSend.disabled  = phoneInput.value.length < 6;
  });

  btnSend.addEventListener('click', async () => {
    const digits = phoneInput.value.trim();
    if (digits.length < 6) return;

    currentPhone = '+' + prefixSelect.value + digits;
    setLoading(btnSend, true, 'Vérification…');

    try {
      const existing = await findPassengerByPhone(currentPhone);

      if (existing) {
        // Numéro connu → connexion directe
        saveSession(
          existing.telephone, existing.prenom, existing.nom,
          existing.email, existing.auth_provider, existing.avatar_url,
          existing.quartier, existing.ville
        );
        document.getElementById('auth-overlay').classList.remove('visible');
        onComplete({
          telephone: existing.telephone,
          prenom:    existing.prenom,
          nom:       existing.nom,
          quartier:  existing.quartier,
          ville:     existing.ville,
        });
      } else {
        // Numéro inconnu → inscription
        goTo('screen-name');
        setTimeout(() => document.getElementById('prenom-input').focus(), 350);
      }
    } catch {
      showAuthError('phone-error', 'Erreur de connexion. Réessayez.');
    } finally {
      setLoading(btnSend, false, 'Continuer');
    }
  });

  // ────────────────────────────────────────────────
  // ÉCRAN 2 — Profil (nouveau passager)
  // ────────────────────────────────────────────────
  const nomInput      = document.getElementById('nom-input');
  const prenomInput   = document.getElementById('prenom-input');
  const villeInput    = document.getElementById('ville-input');
  const quartierInput = document.getElementById('quartier-input');
  const btnStart      = document.getElementById('btn-save-name');

  // ── Sélecteur de rôle ──────────────────────────
  let selectedRole = 'passenger';
  const rolePassenger = document.getElementById('role-passenger');
  const roleDriver    = document.getElementById('role-driver');

  if (rolePassenger && roleDriver) {
    rolePassenger.addEventListener('click', () => {
      selectedRole = 'passenger';
      rolePassenger.classList.add('active');
      roleDriver.classList.remove('active');
      btnStart.textContent = 'Commencer 🚖';
    });
    roleDriver.addEventListener('click', () => {
      selectedRole = 'driver';
      roleDriver.classList.add('active');
      rolePassenger.classList.remove('active');
      btnStart.textContent = 'Continuer →';
    });
  }

  // ── Avatar (présent sur login.html, absent sur passenger.html) ─
  const avatarPicker   = document.getElementById('avatar-picker');
  const avatarFile     = document.getElementById('avatar-file');
  const avatarCamera   = document.getElementById('avatar-camera');
  const avatarPreview  = document.getElementById('avatar-preview');
  const avatarBackdrop = document.getElementById('avatar-menu-backdrop');
  let   selectedAvatar = null;

  if (avatarPicker && avatarBackdrop) {
    function applyAvatarFile(file) {
      if (!file) return;
      avatarBackdrop.classList.remove('open');
      selectedAvatar = file;
      avatarPreview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="aperçu" />`;
      avatarPicker.classList.add('has-photo');
    }

    avatarPicker.addEventListener('click', () => avatarBackdrop.classList.add('open'));
    document.getElementById('btn-pick-gallery').addEventListener('click', () => {
      avatarBackdrop.classList.remove('open'); avatarFile.click();
    });
    document.getElementById('btn-pick-camera').addEventListener('click', () => {
      avatarBackdrop.classList.remove('open'); avatarCamera.click();
    });
    document.getElementById('btn-pick-cancel').addEventListener('click', () => {
      avatarBackdrop.classList.remove('open');
    });
    avatarBackdrop.addEventListener('click', (e) => {
      if (e.target === avatarBackdrop) avatarBackdrop.classList.remove('open');
    });
    avatarFile.addEventListener('change',   () => applyAvatarFile(avatarFile.files[0]));
    avatarCamera.addEventListener('change', () => applyAvatarFile(avatarCamera.files[0]));
  }

  function checkNameReady() {
    btnStart.disabled = nomInput.value.trim().length < 2
      || prenomInput.value.trim().length < 2
      || (villeInput    ? villeInput.value.trim().length < 2    : false)
      || (quartierInput ? quartierInput.value.trim().length < 2 : false);
  }

  nomInput.addEventListener('input',    checkNameReady);
  prenomInput.addEventListener('input', checkNameReady);
  villeInput?.addEventListener('input',    checkNameReady);
  quartierInput?.addEventListener('input', checkNameReady);

  btnStart.addEventListener('click', async () => {
    const nom      = nomInput.value.trim();
    const prenom   = prenomInput.value.trim();
    const ville    = villeInput?.value.trim()    || '';
    const quartier = quartierInput?.value.trim() || '';
    if (nom.length < 2 || prenom.length < 2) return;

    // ── Rôle Chauffeur → redirection avec prefill ──
    if (selectedRole === 'driver') {
      sessionStorage.setItem('pnr_driver_prefill', JSON.stringify({
        telephone: currentPhone,
        prenom,
        nom,
      }));
      window.location.replace('driver-auth.html?prefill=1');
      return;
    }

    // ── Rôle Passager → inscription normale ────────
    setLoading(btnStart, true, 'Inscription…');

    try {
      await registerPassenger(currentPhone, prenom, nom, quartier, ville);

      let avatarUrl = null;
      if (selectedAvatar) {
        try { avatarUrl = await uploadAvatar(currentPhone, selectedAvatar); } catch (_) {}
      }

      saveSession(currentPhone, prenom, nom, null, null, avatarUrl, quartier, ville);
      document.getElementById('auth-overlay').classList.remove('visible');
      onComplete({ telephone: currentPhone, prenom, nom, quartier, ville });
    } catch (err) {
      const msg = err?.message || 'Erreur lors de l\'inscription. Réessayez.';
      showAuthError('name-error', msg);
      setLoading(btnStart, false, 'Commencer 🚖');
    }
  });
}
