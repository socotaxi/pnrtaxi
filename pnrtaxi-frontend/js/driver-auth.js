// ============================================================
//  driver-auth.js — Authentification chauffeur PNR Taxi
//  Flow téléphone : Numéro → vérification en base → session
//  Flow OAuth     : Google / Facebook → session
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

// ── OAuth (Google / Facebook) ─────────────────────────────────
export async function loginDriverWithOAuth(provider) {
  const redirectTo = window.location.href.split('?')[0].split('#')[0];
  const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
  if (error) throw error;
}

async function handleDriverOAuthCallback() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const user = session.user;
  if (!user.email) return null;

  const email    = user.email;
  const meta     = user.user_metadata || {};
  const fullName = meta.full_name || meta.name || '';
  const prenom   = fullName.split(' ')[0] || email.split('@')[0] || 'Chauffeur';
  const provider = user.app_metadata?.provider || 'oauth';

  const { data: existing } = await supabase
    .from('drivers')
    .select('telephone, prenom, nom, photo')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    saveDriverSession(null, existing.prenom || prenom, existing.nom, existing.photo, email, provider);
    return { isNew: false };
  }

  await supabase.from('drivers').insert({
    email, prenom, auth_provider: provider, verified: true, telephone: null,
  }).catch(() => {});

  saveDriverSession(null, prenom, null, null, email, provider);
  return { isNew: true };
}

// ── Lookup chauffeur par téléphone (sans OTP) ─────────────────
async function findDriverByPhone(telephone) {
  const { data } = await supabase
    .from('drivers')
    .select('telephone, prenom, nom, photo')
    .eq('telephone', telephone)
    .maybeSingle();
  return data || null;
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

// ── Point d'entrée ───────────────────────────────────────────
export async function initDriverAuth() {
  // 1. Retour OAuth ?
  const oauthResult = await handleDriverOAuthCallback();
  if (oauthResult !== null) {
    window.location.replace(oauthResult.isNew ? 'driver-vehicle.html' : 'driver.html');
    return;
  }

  // 2. Session locale existante ?
  const session = getDriverSession();
  if (session) {
    window.location.replace('driver.html');
    return;
  }

  let currentPhone = '';

  // ── ÉCRAN 1 — Téléphone ─────────────────────────────────────
  const btnSend    = document.getElementById('btn-send-otp');
  const phoneInput = document.getElementById('auth-phone-input');
  const prefixSel  = document.getElementById('phone-prefix-select');

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
        // Chauffeur connu → connexion directe
        saveDriverSession(currentPhone, existing.prenom || 'Chauffeur', existing.nom, existing.photo);
        window.location.replace('driver.html');
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

  // ── ÉCRAN 2 — Profil (nouveau chauffeur) ────────────────────
  const prenomInput    = document.getElementById('prenom-input');
  const nomInput       = document.getElementById('nom-input');
  const btnStart       = document.getElementById('btn-save-name');
  const avatarPicker   = document.getElementById('avatar-picker');
  const avatarFile     = document.getElementById('avatar-file');
  const avatarCamera   = document.getElementById('avatar-camera');
  const avatarPreview  = document.getElementById('avatar-preview');
  const avatarBackdrop = document.getElementById('avatar-menu-backdrop');
  let   selectedAvatar = null;

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

  function checkNameReady() {
    btnStart.disabled = prenomInput.value.trim().length < 2 || nomInput.value.trim().length < 2;
  }
  prenomInput.addEventListener('input', checkNameReady);
  nomInput.addEventListener('input',    checkNameReady);

  btnStart.addEventListener('click', async () => {
    const prenom = prenomInput.value.trim();
    const nom    = nomInput.value.trim();
    if (prenom.length < 2 || nom.length < 2) return;

    setLoading(btnStart, true, 'Continuer');
    try {
      let photoUrl = null;
      if (selectedAvatar) {
        try { photoUrl = await uploadDriverAvatar(currentPhone, selectedAvatar); } catch (_) {}
      }
      saveDriverSession(currentPhone, prenom, nom, photoUrl);
      window.location.replace('driver-vehicle.html');
    } catch (err) {
      const msg = err?.message || 'Erreur lors de la sauvegarde. Réessayez.';
      showAuthError('name-error', msg);
      setLoading(btnStart, false, 'Continuer →');
    }
  });
}
