// ============================================================
//  driver-auth.js — Authentification chauffeur PNR Taxi
//  Flow connexion  : Téléphone → OTP → driver.html
//  Flow inscription: Téléphone → OTP → Prénom → driver-vehicle.html
// ============================================================

import { supabase } from './supabase-config.js';

const SESSION_KEY    = 'pnr_driver';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours
const OTP_DURATION   = 5 * 60; // secondes

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

  const user     = session.user;
  // Session Phone Auth (OTP SMS) — ne pas traiter ici, géré dans initDriverAuth
  if (!user.email) return null;

  const email    = user.email;
  const meta     = user.user_metadata || {};
  const fullName = meta.full_name || meta.name || '';
  const prenom   = fullName.split(' ')[0] || email?.split('@')[0] || 'Chauffeur';
  const provider = user.app_metadata?.provider || 'oauth';

  // Vérifie si ce chauffeur existe déjà (par email OAuth)
  const { data: existing } = await supabase
    .from('drivers')
    .select('telephone, prenom, immatriculation')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    // Chauffeur connu → connexion directe
    saveDriverSession(null, existing.prenom || prenom, email, provider);
    return { isNew: false };
  }

  // Nouveau chauffeur OAuth → on l'insère
  await supabase.from('drivers').insert({
    email,
    prenom,
    auth_provider : provider,
    verified      : true,
    telephone     : null,
  }).catch(() => {});

  saveDriverSession(null, prenom, email, provider);
  return { isNew: true };
}

// ── OTP via Supabase Phone Auth ───────────────────────────────
async function sendDriverOTP(phone) {
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (error) throw error;
}

async function verifyDriverOTP(phone, token) {
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
  if (error) throw error;
}

async function checkExistingDriver(telephone) {
  const { data } = await supabase
    .from('drivers')
    .select('telephone, prenom, nom, photo')
    .eq('telephone', telephone)
    .maybeSingle();
  return data || null;
}

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

async function saveDriverProfile(telephone, prenom, nom, avatarFile) {
  // Upload photo vers le storage uniquement — aucune écriture en DB
  // L'INSERT complet se fait à la fin de driver-vehicle.html
  const avatarUrl = await uploadDriverAvatar(telephone, avatarFile);
  saveDriverSession(telephone, prenom, nom, avatarUrl);
}

// ── Timer countdown ───────────────────────────────────────────
let timerInterval = null;

function startTimer(onExpire) {
  const timerEl   = document.getElementById('otp-timer');
  const resendBtn = document.getElementById('btn-resend');
  let remaining   = OTP_DURATION;

  clearInterval(timerInterval);
  resendBtn.disabled    = true;
  timerEl.style.color   = 'var(--text-muted)';

  timerInterval = setInterval(() => {
    remaining--;
    const m = Math.floor(remaining / 60).toString().padStart(2, '0');
    const s = (remaining % 60).toString().padStart(2, '0');
    timerEl.textContent = `⏱ ${m}:${s}`;

    if (remaining <= 60) timerEl.style.color = 'var(--red)';
    if (remaining <= 0) {
      clearInterval(timerInterval);
      timerEl.textContent   = '⏱ Code expiré';
      resendBtn.disabled    = false;
      onExpire();
    }
  }, 1000);
}

// ── Navigation entre écrans ───────────────────────────────────
function goTo(screenId) {
  document.querySelectorAll('.auth-screen').forEach(s => s.classList.remove('active'));
  requestAnimationFrame(() =>
    document.getElementById(screenId).classList.add('active')
  );
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
  setTimeout(() => el.classList.remove('show'), 4000);
}

// ── OTP boxes ────────────────────────────────────────────────
function initOTPBoxes() {
  const boxes = document.querySelectorAll('.otp-box');
  boxes.forEach((box, i) => {
    box.addEventListener('input', (e) => {
      const val = e.target.value.replace(/\D/g, '');
      e.target.value = val.slice(-1);
      if (val && i < boxes.length - 1) boxes[i + 1].focus();
      checkVerifyReady();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && i > 0) {
        boxes[i - 1].focus();
        boxes[i - 1].value = '';
      }
    });
    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
      [...pasted].forEach((ch, j) => { if (boxes[j]) boxes[j].value = ch; });
      boxes[Math.min(pasted.length, boxes.length - 1)].focus();
      checkVerifyReady();
    });
  });
}

function getOTPValue() {
  return [...document.querySelectorAll('.otp-box')].map(b => b.value).join('');
}

function clearOTPBoxes() {
  document.querySelectorAll('.otp-box').forEach(b => b.value = '');
  document.querySelector('.otp-box').focus();
}

function checkVerifyReady() {
  document.getElementById('btn-verify-otp').disabled = getOTPValue().length < 4;
}

// ── Point d'entrée ───────────────────────────────────────────
export async function initDriverAuth() {
  // 1. Retour de redirection OAuth ?
  const oauthResult = await handleDriverOAuthCallback();
  if (oauthResult !== null) {
    window.location.replace(oauthResult.isNew ? 'driver-vehicle.html' : 'driver.html');
    return;
  }

  // 2. Session locale existante → vers l'app chauffeur
  const session = getDriverSession();
  if (session) {
    window.location.replace('driver.html');
    return;
  }

  initOTPBoxes();

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

    // Format E.164 requis par Supabase Phone Auth
    currentPhone = '+' + prefixSel.value + digits;
    setLoading(btnSend, true, 'Envoi du code…');

    try {
      await sendDriverOTP(currentPhone);

      const masked = currentPhone.slice(0, 4) + ' *** ** ' + digits.slice(-2);
      document.getElementById('otp-subtitle').textContent = `Code envoyé au ${masked}`;

      startTimer(() => { clearOTPBoxes(); document.getElementById('btn-verify-otp').disabled = true; });
      goTo('screen-otp');
      setTimeout(() => document.querySelector('.otp-box').focus(), 350);

    } catch {
      showAuthError('phone-error', 'Impossible d\'envoyer le code. Vérifiez le numéro.');
    } finally {
      setLoading(btnSend, false, 'Recevoir le code');
    }
  });

  // ── ÉCRAN 2 — OTP ───────────────────────────────────────────
  document.getElementById('btn-back-phone').addEventListener('click', () => {
    clearInterval(timerInterval);
    goTo('screen-phone');
  });

  const btnVerify = document.getElementById('btn-verify-otp');
  btnVerify.disabled = true;

  btnVerify.addEventListener('click', async () => {
    const code = getOTPValue();
    if (code.length < 6) return;

    setLoading(btnVerify, true, 'Vérification…');

    try {
      await verifyDriverOTP(currentPhone, code);
    } catch {
      showAuthError('otp-error', 'Code incorrect ou expiré.');
      clearOTPBoxes();
      setLoading(btnVerify, false, 'Vérifier');
      return;
    }

    clearInterval(timerInterval);
    setLoading(btnVerify, false, 'Vérifier');

    // OTP valide — vérifier si le chauffeur a déjà un compte
    const existing = await checkExistingDriver(currentPhone);
    if (existing) {
      saveDriverSession(currentPhone, existing.prenom || 'Chauffeur', existing.nom, existing.photo);
      window.location.replace('driver.html');
    } else {
      goTo('screen-name');
      setTimeout(() => document.getElementById('prenom-input').focus(), 350);
    }
  });

  document.getElementById('btn-resend').addEventListener('click', async () => {
    try {
      await sendDriverOTP(currentPhone);
      clearOTPBoxes();
      startTimer(() => { clearOTPBoxes(); btnVerify.disabled = true; });
    } catch {
      showAuthError('otp-error', 'Erreur lors du renvoi.');
    }
  });

  // ── ÉCRAN 3 — Nom, Prénom & Avatar (inscription seulement) ──
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
    avatarBackdrop.classList.remove('open');
    avatarFile.click();
  });
  document.getElementById('btn-pick-camera').addEventListener('click', () => {
    avatarBackdrop.classList.remove('open');
    avatarCamera.click();
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
      await saveDriverProfile(currentPhone, prenom, nom, selectedAvatar);
      window.location.replace('driver-vehicle.html');
    } catch (err) {
      const msg = err?.message || 'Erreur lors de la sauvegarde. Réessayez.';
      showAuthError('name-error', msg);
      setLoading(btnStart, false, 'Continuer');
    }
  });
}
