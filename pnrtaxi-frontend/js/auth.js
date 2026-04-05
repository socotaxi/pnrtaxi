// ============================================================
//  auth.js — Système d'authentification PNR Taxi
//  Flow téléphone : Numéro → lookup → mot de passe OU inscription
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

  const provider = user.app_metadata?.provider || 'email';
  if (provider === 'email') {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }

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

// ── RPCs téléphone ────────────────────────────────────────────
async function findPassengerByPhone(telephone) {
  const { data, error } = await supabase.rpc('get_passenger_by_phone', { p_telephone: telephone });
  if (error || !data || data.length === 0) return null;
  return data[0];
}

async function verifyPassword(telephone, password) {
  const { data, error } = await supabase.rpc('verify_passenger_password', {
    p_telephone: telephone,
    p_password:  password,
  });
  if (error || !data || data.length === 0) return null;
  return data[0];
}

async function registerPassenger(telephone, prenom, nom, quartier, ville, password) {
  const { error } = await supabase.rpc('upsert_passenger', {
    p_telephone: telephone,
    p_prenom:    prenom,
    p_nom:       nom,
    p_quartier:  quartier,
    p_ville:     ville,
    p_password:  password,
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

// Bascule afficher / masquer un champ mot de passe
function bindTogglePassword(btnId, inputId, eyeId) {
  const btn   = document.getElementById(btnId);
  const input = document.getElementById(inputId);
  const eye   = document.getElementById(eyeId);
  if (!btn || !input) return;

  const eyeOpen = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  const eyeOff  = `<line x1="1"  y1="1"  x2="23" y2="23"/><path d="M10.58 10.58A2 2 0 0 0 14 12a2 2 0 0 1-2.83 2.83"/><path d="M9.9 4.24A9 9 0 0 1 12 4c7 0 11 8 11 8a18.06 18.06 0 0 1-5.19 5.19M6.53 6.53A18.33 18.33 0 0 0 1 12s4 8 11 8a9 9 0 0 0 4.76-1.37"/>`;

  btn.addEventListener('click', () => {
    const hidden = input.type === 'password';
    input.type   = hidden ? 'text' : 'password';
    if (eye) eye.innerHTML = hidden ? eyeOff : eyeOpen;
  });
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

  // Bascule afficher/masquer (tous les champs PW)
  bindTogglePassword('btn-pw-toggle-login',   'pw-input',          'pw-eye-login');
  bindTogglePassword('btn-pw-toggle-signup',  'signup-pw-input',   'pw-eye-signup');
  bindTogglePassword('btn-pw-toggle-confirm', 'signup-pw-confirm', 'pw-eye-confirm');

  let currentPhone = '';

  // ════════════════════════════════════════════════════════════
  // ÉCRAN 1 — Numéro de téléphone
  // ════════════════════════════════════════════════════════════
  const btnSend      = document.getElementById('btn-send-otp');
  const phoneInput   = document.getElementById('auth-phone-input');
  const prefixSelect = document.getElementById('phone-prefix-select');

  phoneInput.addEventListener('input', () => {
    phoneInput.value = phoneInput.value.replace(/\D/g, '').slice(0, 9);
    btnSend.disabled = phoneInput.value.length < 6;
  });

  btnSend.addEventListener('click', async () => {
    const digits = phoneInput.value.trim();
    if (digits.length < 6) return;

    currentPhone = '+' + prefixSelect.value + digits;
    setLoading(btnSend, true, 'Vérification…');

    try {
      const existing = await findPassengerByPhone(currentPhone);

      if (existing) {
        // Numéro connu → demander le mot de passe
        document.getElementById('pw-phone-display').textContent = currentPhone;
        goTo('screen-password');
        setTimeout(() => document.getElementById('pw-input').focus(), 350);
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

  // ════════════════════════════════════════════════════════════
  // ÉCRAN 1b — Mot de passe (connexion compte existant)
  // ════════════════════════════════════════════════════════════
  const pwInput  = document.getElementById('pw-input');
  const btnLogin = document.getElementById('btn-login-pw');

  // Retour à l'écran téléphone
  document.getElementById('btn-change-phone')?.addEventListener('click', () => {
    pwInput.value    = '';
    btnLogin.disabled = true;
    goTo('screen-phone');
  });

  pwInput?.addEventListener('input', () => {
    btnLogin.disabled = pwInput.value.length < 4;
  });

  btnLogin?.addEventListener('click', async () => {
    const password = pwInput.value;
    if (password.length < 4) return;

    setLoading(btnLogin, true, 'Connexion…');

    try {
      const profile = await verifyPassword(currentPhone, password);

      if (!profile) {
        showAuthError('pw-error', 'Mot de passe incorrect. Réessayez.');
        return;
      }

      saveSession(
        profile.telephone, profile.prenom, profile.nom,
        profile.email, profile.auth_provider, profile.avatar_url,
        profile.quartier, profile.ville
      );
      document.getElementById('auth-overlay').classList.remove('visible');
      onComplete({
        telephone: profile.telephone,
        prenom:    profile.prenom,
        nom:       profile.nom,
        quartier:  profile.quartier,
        ville:     profile.ville,
      });
    } catch {
      showAuthError('pw-error', 'Erreur de connexion. Réessayez.');
    } finally {
      setLoading(btnLogin, false, 'Se connecter');
    }
  });

  // ════════════════════════════════════════════════════════════
  // ÉCRAN 2 — Profil (nouveau passager)
  // ════════════════════════════════════════════════════════════
  const nomInput        = document.getElementById('nom-input');
  const prenomInput     = document.getElementById('prenom-input');
  const villeInput      = document.getElementById('ville-input');
  const quartierInput   = document.getElementById('quartier-input');
  const signupPwInput   = document.getElementById('signup-pw-input');
  const signupPwConfirm = document.getElementById('signup-pw-confirm');
  const btnStart        = document.getElementById('btn-save-name');

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

  // ── Avatar ──────────────────────────────────────
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

  // ── Validation formulaire inscription ──────────
  function checkSignupReady() {
    const pw      = signupPwInput?.value   || '';
    const confirm = signupPwConfirm?.value || '';

    const namesOk = nomInput.value.trim().length >= 2
      && prenomInput.value.trim().length >= 2
      && (villeInput    ? villeInput.value.trim().length    >= 2 : false)
      && (quartierInput ? quartierInput.value.trim().length >= 2 : false);

    const pwOk = pw.length >= 6 && pw === confirm;

    btnStart.disabled = !(namesOk && pwOk);

    // Indicateur visuel si les mots de passe ne correspondent pas
    if (signupPwConfirm && confirm.length > 0 && pw !== confirm) {
      signupPwConfirm.style.borderColor = 'var(--red, #ef4444)';
    } else if (signupPwConfirm) {
      signupPwConfirm.style.borderColor = '';
    }
  }

  nomInput.addEventListener('input',           checkSignupReady);
  prenomInput.addEventListener('input',        checkSignupReady);
  villeInput?.addEventListener('input',        checkSignupReady);
  quartierInput?.addEventListener('input',     checkSignupReady);
  signupPwInput?.addEventListener('input',     checkSignupReady);
  signupPwConfirm?.addEventListener('input',   checkSignupReady);

  btnStart.addEventListener('click', async () => {
    const nom      = nomInput.value.trim();
    const prenom   = prenomInput.value.trim();
    const ville    = villeInput?.value.trim()    || '';
    const quartier = quartierInput?.value.trim() || '';
    const password = signupPwInput?.value        || '';

    if (nom.length < 2 || prenom.length < 2) return;
    if (password.length < 6) {
      showAuthError('name-error', 'Le mot de passe doit faire au moins 6 caractères.');
      return;
    }
    if (password !== (signupPwConfirm?.value || '')) {
      showAuthError('name-error', 'Les mots de passe ne correspondent pas.');
      return;
    }

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
      await registerPassenger(currentPhone, prenom, nom, quartier, ville, password);

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
