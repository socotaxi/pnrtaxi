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

function saveDriverSession(telephone, prenom, email = null, auth_provider = null) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ telephone, prenom, email, auth_provider, role: 'driver' }));
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

// ── OTP ──────────────────────────────────────────────────────
function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

async function sendDriverOTP(telephone) {
  const otp       = generateOTP();
  const expiresAt = new Date(Date.now() + OTP_DURATION * 1000).toISOString();

  // Vérifie si le chauffeur existe déjà
  const { data: existing } = await supabase
    .from('drivers')
    .select('telephone')
    .eq('telephone', telephone)
    .maybeSingle();

  if (existing) {
    // Connexion — met à jour l'OTP
    const { error } = await supabase
      .from('drivers')
      .update({ otp, otp_expires_at: expiresAt })
      .eq('telephone', telephone);
    if (error) throw error;
    return { otp, isNew: false };
  } else {
    // Inscription — crée l'entrée (id = telephone, clé primaire de la table)
    const { error } = await supabase
      .from('drivers')
      .insert({ id: telephone, telephone, otp, otp_expires_at: expiresAt, verified: false });
    if (error) throw error;
    return { otp, isNew: true };
  }
}

async function verifyDriverOTP(telephone, code) {
  const { data, error } = await supabase
    .from('drivers')
    .select('otp, otp_expires_at')
    .eq('telephone', telephone)
    .single();

  if (error || !data)           return false;
  if (data.otp !== code)        return false;
  if (new Date(data.otp_expires_at) < new Date()) return false;

  await supabase
    .from('drivers')
    .update({ verified: true, otp: null, otp_expires_at: null })
    .eq('telephone', telephone);

  return true;
}

async function saveDriverProfile(telephone, prenom, nom) {
  const { error } = await supabase
    .from('drivers')
    .update({ prenom, nom })
    .eq('telephone', telephone);
  if (error) throw error;
  saveDriverSession(telephone, prenom);
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
  let currentOTP   = '';
  let isNewDriver  = false;

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
    setLoading(btnSend, true, 'Recevoir le code');

    try {
      const result = await sendDriverOTP(currentPhone);
      currentOTP  = result.otp;
      isNewDriver = result.isNew;

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
    if (code.length < 4) return;

    setLoading(btnVerify, true, 'Vérifier');
    const ok = await verifyDriverOTP(currentPhone, code);

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
      // Connexion → charger le prénom depuis la DB puis rediriger
      const { data } = await supabase
        .from('drivers')
        .select('prenom')
        .eq('telephone', currentPhone)
        .single();
      const prenom = data?.prenom || 'Chauffeur';
      saveDriverSession(currentPhone, prenom);
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

  // ── ÉCRAN 3 — Nom & Prénom (inscription seulement) ───────────
  const prenomInput = document.getElementById('prenom-input');
  const nomInput    = document.getElementById('nom-input');
  const btnStart    = document.getElementById('btn-save-name');

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
      await saveDriverProfile(currentPhone, prenom, nom);
      window.location.replace('driver-vehicle.html');
    } catch (err) {
      console.error(err);
      showAuthError('name-error', 'Erreur lors de la sauvegarde. Réessayez.');
      setLoading(btnStart, false, 'Continuer');
    }
  });
}
