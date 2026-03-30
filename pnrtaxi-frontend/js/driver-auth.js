// ============================================================
//  driver-auth.js — Authentification chauffeur PNR Taxi
//  Flow connexion  : Téléphone → OTP → driver.html
//  Flow inscription: Téléphone → OTP → Prénom → driver-vehicle.html
// ============================================================

import { supabase } from './supabase-config.js';

const SESSION_KEY  = 'pnr_driver';
const OTP_DURATION = 5 * 60; // secondes

// ── Session ──────────────────────────────────────────────────
export function getDriverSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveDriverSession(telephone, prenom, nom = null, photo = null, email = null, auth_provider = null) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ telephone, prenom, nom, photo, email, auth_provider, role: 'driver' }));
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

// ── OTP (stocké en mémoire uniquement, aucune écriture DB) ───
let _pendingDriverOTP = { code: null, expiresAt: 0 };

function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

async function sendDriverOTP(telephone) {
  const code = generateOTP();
  _pendingDriverOTP = { code, expiresAt: Date.now() + OTP_DURATION * 1000 };

  // Lecture seule — vérifie si le chauffeur existe déjà (compte vérifié)
  const { data: existing } = await supabase
    .from('drivers')
    .select('telephone, prenom')
    .eq('telephone', telephone)
    .eq('verified', true)
    .maybeSingle();

  // Production : remplacer par appel SMS / WhatsApp API
  return { otp: code, isNew: !existing, existingPrenom: existing?.prenom || null };
}

function verifyDriverOTP(code) {
  if (!_pendingDriverOTP.code) return false;
  if (_pendingDriverOTP.code !== code) return false;
  if (Date.now() > _pendingDriverOTP.expiresAt) return false;
  return true;
}

async function uploadDriverAvatar(telephone, file) {
  if (!file) return null;
  const ext  = file.name.split('.').pop();
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
  _pendingDriverOTP = { code: null, expiresAt: 0 };
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

  let currentPhone    = '';
  let currentOTP      = '';
  let isNewDriver     = false;
  let existingPrenom  = null;

  // ── ÉCRAN 1 — Téléphone ─────────────────────────────────────
  const btnSend     = document.getElementById('btn-send-otp');
  const phoneInput  = document.getElementById('auth-phone-input');
  const prefixSel   = document.getElementById('phone-prefix-select');

  phoneInput.addEventListener('input', () => {
    phoneInput.value  = phoneInput.value.replace(/\D/g, '').slice(0, 9);
    btnSend.disabled  = phoneInput.value.length < 6;
  });

  btnSend.addEventListener('click', async () => {
    const digits = phoneInput.value.trim();
    if (digits.length < 6) return;

    const dialCode = prefixSel.value;
    currentPhone   = dialCode + digits;
    setLoading(btnSend, true, 'Connexion / Recevoir le code');

    try {
      // Vérifier si le chauffeur existe déjà en base
      const { data: existing } = await supabase
        .from('drivers')
        .select('telephone, prenom')
        .eq('telephone', currentPhone)
        .eq('verified', true)
        .maybeSingle();

      if (existing) {
        // Chauffeur connu → accès direct sans OTP
        saveDriverSession(currentPhone, existing.prenom || 'Chauffeur');
        window.location.replace('driver.html');
        return;
      }

      // Nouveau chauffeur → flow OTP
      const result = await sendDriverOTP(currentPhone);
      currentOTP     = result.otp;
      isNewDriver    = true;
      existingPrenom = null;

      const masked = '+' + dialCode + ' ' + digits.slice(0, 2) + ' *** ** ' + digits.slice(-2);
      document.getElementById('otp-subtitle').textContent = `Envoyé au ${masked}`;
      document.getElementById('demo-code').textContent    = currentOTP;

      startTimer(() => { clearOTPBoxes(); document.getElementById('btn-verify-otp').disabled = true; });
      goTo('screen-otp');
      setTimeout(() => document.querySelector('.otp-box').focus(), 350);

    } catch (err) {
      console.error('[driver-auth] sendOTP error:', err);
      const msg = err?.message || JSON.stringify(err);
      showAuthError('phone-error', `Erreur : ${msg}`);
    } finally {
      setLoading(btnSend, false, 'Connexion / Recevoir le code');
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
    if (code.length < 4) return;

    setLoading(btnVerify, true, 'Vérifier');
    const ok = verifyDriverOTP(code);

    if (!ok) {
      showAuthError('otp-error', 'Code incorrect ou expiré.');
      clearOTPBoxes();
      setLoading(btnVerify, false, 'Vérifier');
      return;
    }

    clearInterval(timerInterval);
    setLoading(btnVerify, false, 'Vérifier');

    if (isNewDriver) {
      // Inscription → prénom
      goTo('screen-name');
      setTimeout(() => document.getElementById('prenom-input').focus(), 350);
    } else {
      // Connexion → prénom déjà chargé lors de sendDriverOTP
      saveDriverSession(currentPhone, existingPrenom || 'Chauffeur');
      window.location.replace('driver.html');
    }
  });

  document.getElementById('btn-resend').addEventListener('click', async () => {
    try {
      const result = await sendDriverOTP(currentPhone);
      currentOTP   = result.otp;
      document.getElementById('demo-code').textContent = currentOTP;
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
      console.error(err);
      showAuthError('name-error', 'Erreur lors de la sauvegarde. Réessayez.');
      setLoading(btnStart, false, 'Continuer');
    }
  });
}
