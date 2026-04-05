// ============================================================
//  driver-auth.js — Authentification chauffeur PNR Taxi
//  Flow téléphone : Numéro → lookup → mot de passe OU inscription
// ============================================================

import { supabase } from './supabase-config.js';

const SESSION_KEY    = 'pnr_driver';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

// ── Session ──────────────────────────────────────────────────
export function getDriverSession() {
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

function saveDriverSession(telephone, prenom, nom = null, photo = null, email = null, auth_provider = null) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    telephone, prenom, nom, photo, email, auth_provider, role: 'driver',
    expiresAt: Date.now() + SESSION_TTL_MS,
  }));
}

export async function clearDriverSession() {
  localStorage.removeItem(SESSION_KEY);
}

// ── RPCs téléphone ────────────────────────────────────────────
async function findDriverByPhone(telephone) {
  const { data } = await supabase
    .from('drivers')
    .select('telephone, prenom, nom, photo')
    .eq('telephone', telephone)
    .maybeSingle();
  return data || null;
}

async function verifyDriverPassword(telephone, password) {
  const { data, error } = await supabase.rpc('verify_driver_password', {
    p_telephone: telephone,
    p_password:  password,
  });
  if (error || !data || data.length === 0) return null;
  return data[0];
}

// ── Avatar upload ─────────────────────────────────────────────
const AVATAR_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const AVATAR_MAX_SIZE_MB   = 5;

async function uploadDriverAvatar(telephone, file) {
  if (!file) return null;
  if (!AVATAR_ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Format non supporté. Utilisez JPEG, PNG, WebP ou GIF.');
  }
  if (file.size > AVATAR_MAX_SIZE_MB * 1024 * 1024) {
    throw new Error(`Image trop lourde. Maximum ${AVATAR_MAX_SIZE_MB} Mo.`);
  }
  const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  const ext  = extMap[file.type];
  const path = `drivers/${telephone}.${ext}`;
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}

// ── Navigation ────────────────────────────────────────────────
function goTo(screenId) {
  document.querySelectorAll('.auth-screen').forEach(s => s.classList.remove('active'));
  requestAnimationFrame(() => document.getElementById(screenId).classList.add('active'));
}

// ── Helpers UI ────────────────────────────────────────────────
function setLoading(btn, loading, label) {
  btn.disabled    = loading;
  btn.textContent = loading ? '…' : label;
}

function showAuthError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 5000);
}

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

// ── Point d'entrée ───────────────────────────────────────────
export async function initDriverAuth() {
  // 1. Session locale existante ?
  const session = getDriverSession();
  if (session) {
    window.location.replace('driver.html');
    return;
  }

  // Bascule afficher/masquer
  bindTogglePassword('btn-pw-toggle-login',   'pw-input',          'pw-eye-login');
  bindTogglePassword('btn-pw-toggle-signup',  'signup-pw-input',   'pw-eye-signup');
  bindTogglePassword('btn-pw-toggle-confirm', 'signup-pw-confirm', 'pw-eye-confirm');

  // 2. Prefill depuis le formulaire passager ?
  const params  = new URLSearchParams(location.search);
  const prefill = params.get('prefill') === '1'
    ? (() => { try { return JSON.parse(sessionStorage.getItem('pnr_driver_prefill') || ''); } catch { return null; } })()
    : null;

  if (prefill) {
    sessionStorage.removeItem('pnr_driver_prefill');
  }

  let currentPhone = prefill?.telephone || '';

  // ════════════════════════════════════════════════════════════
  // ÉCRAN 1 — Téléphone
  // ════════════════════════════════════════════════════════════
  const btnSend    = document.getElementById('btn-send-otp');
  const phoneInput = document.getElementById('auth-phone-input');
  const prefixSel  = document.getElementById('phone-prefix-select');

  // Si prefill : aller directement au formulaire profil
  if (prefill) {
    goTo('screen-name');
    const prenomEl = document.getElementById('prenom-input');
    const nomEl    = document.getElementById('nom-input');
    if (prenomEl) prenomEl.value = prefill.prenom || '';
    if (nomEl)    nomEl.value    = prefill.nom    || '';
    setTimeout(() => {
      prenomEl?.dispatchEvent(new Event('input'));
      nomEl?.dispatchEvent(new Event('input'));
      prenomEl?.focus();
    }, 350);
  }

  phoneInput.addEventListener('input', () => {
    phoneInput.value = phoneInput.value.replace(/\D/g, '').slice(0, 9);
    btnSend.disabled = phoneInput.value.length < 6;
  });

  btnSend.addEventListener('click', async () => {
    const digits = phoneInput.value.trim();
    if (digits.length < 6) return;

    currentPhone = '+' + prefixSel.value + digits;
    setLoading(btnSend, true, 'Vérification…');

    try {
      const existing = await findDriverByPhone(currentPhone);

      if (existing) {
        // Chauffeur connu → demander le mot de passe
        document.getElementById('pw-phone-display').textContent = currentPhone;
        goTo('screen-password');
        setTimeout(() => document.getElementById('pw-input').focus(), 350);
      } else {
        // Nouveau chauffeur → écran profil
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

  document.getElementById('btn-change-phone')?.addEventListener('click', () => {
    pwInput.value     = '';
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
      const profile = await verifyDriverPassword(currentPhone, password);

      if (!profile) {
        showAuthError('pw-error', 'Mot de passe incorrect. Réessayez.');
        return;
      }

      saveDriverSession(profile.telephone, profile.prenom, profile.nom, profile.photo);
      window.location.replace('driver.html');
    } catch {
      showAuthError('pw-error', 'Erreur de connexion. Réessayez.');
    } finally {
      setLoading(btnLogin, false, 'Se connecter');
    }
  });

  // ════════════════════════════════════════════════════════════
  // ÉCRAN 2 — Profil (nouveau chauffeur)
  // ════════════════════════════════════════════════════════════
  const prenomInput     = document.getElementById('prenom-input');
  const nomInput        = document.getElementById('nom-input');
  const signupPwInput   = document.getElementById('signup-pw-input');
  const signupPwConfirm = document.getElementById('signup-pw-confirm');
  const btnStart        = document.getElementById('btn-save-name');
  const avatarPicker    = document.getElementById('avatar-picker');
  const avatarFile      = document.getElementById('avatar-file');
  const avatarCamera    = document.getElementById('avatar-camera');
  const avatarPreview   = document.getElementById('avatar-preview');
  const avatarBackdrop  = document.getElementById('avatar-menu-backdrop');
  let   selectedAvatar  = null;

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

  function checkSignupReady() {
    const pw      = signupPwInput?.value   || '';
    const confirm = signupPwConfirm?.value || '';

    const namesOk = prenomInput.value.trim().length >= 2
      && nomInput.value.trim().length >= 2;

    const pwOk = pw.length >= 6 && pw === confirm;

    btnStart.disabled = !(namesOk && pwOk);

    if (signupPwConfirm && confirm.length > 0 && pw !== confirm) {
      signupPwConfirm.style.borderColor = 'var(--red, #ef4444)';
    } else if (signupPwConfirm) {
      signupPwConfirm.style.borderColor = '';
    }
  }

  prenomInput.addEventListener('input',        checkSignupReady);
  nomInput.addEventListener('input',           checkSignupReady);
  signupPwInput?.addEventListener('input',     checkSignupReady);
  signupPwConfirm?.addEventListener('input',   checkSignupReady);

  btnStart.addEventListener('click', async () => {
    const prenom   = prenomInput.value.trim();
    const nom      = nomInput.value.trim();
    const password = signupPwInput?.value || '';

    if (prenom.length < 2 || nom.length < 2) return;
    if (password.length < 6) {
      showAuthError('name-error', 'Le mot de passe doit faire au moins 6 caractères.');
      return;
    }
    if (password !== (signupPwConfirm?.value || '')) {
      showAuthError('name-error', 'Les mots de passe ne correspondent pas.');
      return;
    }

    setLoading(btnStart, true, 'Continuer');
    try {
      let photoUrl = null;
      if (selectedAvatar) {
        try { photoUrl = await uploadDriverAvatar(currentPhone, selectedAvatar); } catch (_) {}
      }

      // Stocker le mot de passe temporairement pour driver-vehicle.html
      sessionStorage.setItem('pnr_driver_pending_pw', password);

      saveDriverSession(currentPhone, prenom, nom, photoUrl);
      window.location.replace('driver-vehicle.html');
    } catch (err) {
      const msg = err?.message || 'Erreur lors de la sauvegarde. Réessayez.';
      showAuthError('name-error', msg);
      setLoading(btnStart, false, 'Continuer →');
    }
  });
}
