// ============================================================
//  auth.js — Système d'inscription passager PNR Taxi
//  Flow : Numéro → OTP (4 chiffres) → Prénom
// ============================================================

import { supabase } from './supabase-config.js';

const SESSION_KEY = 'pnr_passenger';
const OTP_DURATION = 5 * 60; // secondes

// ── Session ──────────────────────────────────────────────────
export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveSession(telephone, prenom, email = null, auth_provider = null, avatar_url = null, quartier = null, ville = null) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ telephone, prenom, email, auth_provider, avatar_url, quartier, ville }));
}

export async function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  // Déconnecter aussi la session Supabase Auth (OAuth)
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

  const user     = session.user;
  const email    = user.email;
  const meta     = user.user_metadata || {};
  const fullName = meta.full_name || meta.name || '';
  const prenom   = fullName.split(' ')[0] || email?.split('@')[0] || 'Passager';
  const provider = user.app_metadata?.provider || 'oauth';

  // Upsert dans la table passengers (email comme clé OAuth)
  try {
    await supabase.from('passengers').upsert(
      { email, prenom, auth_provider: provider, verified: true, telephone: null },
      { onConflict: 'email' }
    );
  } catch (_) {}

  saveSession(null, prenom, email, provider);
  return { prenom, email, auth_provider: provider };
}

// ── OTP ──────────────────────────────────────────────────────
function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

async function sendOTP(telephone) {
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + OTP_DURATION * 1000).toISOString();

  const { error } = await supabase.from('passengers').upsert(
    { telephone, otp, otp_expires_at: expiresAt, verified: false },
    { onConflict: 'telephone' }
  );

  if (error) throw error;

  // Production : remplacer par appel SMS / WhatsApp API
  return otp;
}

async function verifyOTP(telephone, code) {
  const { data, error } = await supabase
    .from('passengers')
    .select('otp, otp_expires_at')
    .eq('telephone', telephone)
    .single();

  if (error || !data) return false;
  if (data.otp !== code) return false;
  if (new Date(data.otp_expires_at) < new Date()) return false;

  await supabase.from('passengers')
    .update({ verified: true, otp: null, otp_expires_at: null })
    .eq('telephone', telephone);

  return true;
}

async function uploadAvatar(telephone, file) {
  if (!file) return null;
  const ext  = file.name.split('.').pop();
  const path = `passengers/${telephone}.${ext}`;
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}

async function saveProfile(telephone, prenom, nom, quartier, ville, avatarFile) {
  const avatarUrl = await uploadAvatar(telephone, avatarFile);
  const update    = { prenom, nom, quartier, ville, ...(avatarUrl ? { avatar_url: avatarUrl } : {}) };

  const { error } = await supabase
    .from('passengers')
    .update(update)
    .eq('telephone', telephone);

  if (error) throw error;
  saveSession(telephone, prenom, null, null, avatarUrl, quartier, ville);
}

// ── Timer countdown ───────────────────────────────────────────
let timerInterval = null;

function startTimer(onExpire) {
  const timerEl  = document.getElementById('otp-timer');
  const resendBtn = document.getElementById('btn-resend');
  let remaining = OTP_DURATION;

  clearInterval(timerInterval);
  resendBtn.disabled = true;
  timerEl.style.color = 'var(--text-muted)';

  timerInterval = setInterval(() => {
    remaining--;
    const m = Math.floor(remaining / 60).toString().padStart(2, '0');
    const s = (remaining % 60).toString().padStart(2, '0');
    timerEl.textContent = `⏱ ${m}:${s}`;

    if (remaining <= 60) timerEl.style.color = 'var(--red)';
    if (remaining <= 0) {
      clearInterval(timerInterval);
      timerEl.textContent = '⏱ Code expiré';
      resendBtn.disabled = false;
      onExpire();
    }
  }, 1000);
}

// ── Navigation entre écrans ───────────────────────────────────
function goTo(screenId) {
  document.querySelectorAll('.auth-screen').forEach(s => {
    s.classList.remove('active', 'exit');
  });
  const target = document.getElementById(screenId);
  // Petit délai pour déclencher la transition CSS
  requestAnimationFrame(() => target.classList.add('active'));
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
  setTimeout(() => el.classList.remove('show'), 4000);
}

// ── OTP boxes : auto-avance et paste ─────────────────────────
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
      const lastFilled = Math.min(pasted.length, boxes.length - 1);
      boxes[lastFilled].focus();
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
  const btn = document.getElementById('btn-verify-otp');
  btn.disabled = getOTPValue().length < 4;
}

// ── Point d'entrée principal ──────────────────────────────────
export async function initAuth(onComplete) {
  // 1. Retour de redirection OAuth ?
  const oauthSession = await handleOAuthCallback();
  if (oauthSession) {
    onComplete(oauthSession);
    return;
  }

  // 2. Session locale existante → directement dans l'app
  const session = getSession();
  if (session) {
    onComplete(session);
    return;
  }

  // Afficher l'auth (splash déjà masqué par passenger.js)
  document.getElementById('auth-overlay').classList.add('visible');
  initOTPBoxes();

  // ── Boutons OAuth ────────────────────────────────────────────
  document.getElementById('btn-oauth-google').addEventListener('click', async () => {
    try { await loginWithOAuth('google'); }
    catch (err) { console.error(err); showAuthError('phone-error', 'Erreur Google. Réessayez.'); }
  });

  document.getElementById('btn-oauth-facebook').addEventListener('click', async () => {
    try { await loginWithOAuth('facebook'); }
    catch (err) { console.error(err); showAuthError('phone-error', 'Erreur Facebook. Réessayez.'); }
  });

  let currentPhone = '';
  let currentOTP   = '';

  // ────────────────────────────────────────────────
  // ÉCRAN 1 — Numéro de téléphone
  // ────────────────────────────────────────────────
  const btnSend = document.getElementById('btn-send-otp');
  const phoneInput = document.getElementById('auth-phone-input');
  const prefixSelect = document.getElementById('phone-prefix-select');

  // Forcer chiffres uniquement
  phoneInput.addEventListener('input', () => {
    phoneInput.value = phoneInput.value.replace(/\D/g, '').slice(0, 9);
    btnSend.disabled = phoneInput.value.length < 6;
  });

  btnSend.addEventListener('click', async () => {
    const digits = phoneInput.value.trim();
    if (digits.length < 6) return;

    const dialCode = prefixSelect.value;
    currentPhone = dialCode + digits;
    setLoading(btnSend, true, 'Recevoir le code');

    try {
      currentOTP = await sendOTP(currentPhone);

      // Afficher le numéro masqué dans l'écran OTP
      const masked = '+' + dialCode + ' ' + digits.slice(0, 2) + ' *** ** ' + digits.slice(-2);
      document.getElementById('otp-subtitle').textContent = `Envoyé au ${masked}`;
      document.getElementById('demo-code').textContent = currentOTP;

      startTimer(() => {
        // Code expiré — vider les boxes
        clearOTPBoxes();
        document.getElementById('btn-verify-otp').disabled = true;
      });

      goTo('screen-otp');
      setTimeout(() => document.querySelector('.otp-box').focus(), 350);

    } catch (err) {
      console.error(err);
      showAuthError('phone-error', 'Erreur réseau. Vérifiez votre connexion.');
    } finally {
      setLoading(btnSend, false, 'Recevoir le code');
    }
  });

  // ────────────────────────────────────────────────
  // ÉCRAN 2 — OTP
  // ────────────────────────────────────────────────
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

    const ok = await verifyOTP(currentPhone, code);

    if (!ok) {
      showAuthError('otp-error', 'Code incorrect ou expiré. Réessayez.');
      clearOTPBoxes();
      setLoading(btnVerify, false, 'Vérifier');
      return;
    }

    clearInterval(timerInterval);
    goTo('screen-name');
    setTimeout(() => document.getElementById('nom-input').focus(), 350);
    setLoading(btnVerify, false, 'Vérifier');
  });

  // Renvoyer le code
  document.getElementById('btn-resend').addEventListener('click', async () => {
    try {
      currentOTP = await sendOTP(currentPhone);
      document.getElementById('demo-code').textContent = currentOTP;
      clearOTPBoxes();
      startTimer(() => { clearOTPBoxes(); btnVerify.disabled = true; });
    } catch (err) {
      showAuthError('otp-error', 'Erreur lors du renvoi. Réessayez.');
    }
  });

  // ────────────────────────────────────────────────
  // ÉCRAN 3 — Nom, Prénom & Avatar
  // ────────────────────────────────────────────────
  const nomInput      = document.getElementById('nom-input');
  const prenomInput   = document.getElementById('prenom-input');
  const villeInput    = document.getElementById('ville-input');
  const quartierInput = document.getElementById('quartier-input');
  const btnStart      = document.getElementById('btn-save-name');

  function checkNameReady() {
    btnStart.disabled = nomInput.value.trim().length < 2
      || prenomInput.value.trim().length < 2
      || villeInput.value.trim().length < 2
      || quartierInput.value.trim().length < 2;
  }

  nomInput.addEventListener('input',      checkNameReady);
  prenomInput.addEventListener('input',   checkNameReady);
  villeInput.addEventListener('input',    checkNameReady);
  quartierInput.addEventListener('input', checkNameReady);

  btnStart.addEventListener('click', async () => {
    const nom      = nomInput.value.trim();
    const prenom   = prenomInput.value.trim();
    const ville    = villeInput.value.trim();
    const quartier = quartierInput.value.trim();
    if (nom.length < 2 || prenom.length < 2 || ville.length < 2 || quartier.length < 2) return;

    setLoading(btnStart, true, 'Commencer 🚖');

    try {
      await saveProfile(currentPhone, prenom, nom, quartier, ville, null);

      document.getElementById('auth-overlay').classList.remove('visible');
      onComplete({ telephone: currentPhone, prenom, nom, quartier, ville });
    } catch (err) {
      console.error(err);
      showAuthError('name-error', 'Erreur lors de la sauvegarde. Réessayez.');
      setLoading(btnStart, false, 'Commencer 🚖');
    }
  });
}
