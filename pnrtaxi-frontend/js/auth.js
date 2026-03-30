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

// ── Vérification compte existant ─────────────────────────────
async function checkExistingAccount(telephone) {
  const { data, error } = await supabase
    .from('passengers')
    .select('telephone, prenom, nom, email, auth_provider, avatar_url, quartier, ville, verified')
    .eq('telephone', telephone)
    .eq('verified', true)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

// ── OTP (stocké en mémoire uniquement, aucune écriture DB) ───
let _pendingOTP = { code: null, expiresAt: 0 };

function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function sendOTP() {
  const code = generateOTP();
  _pendingOTP = { code, expiresAt: Date.now() + OTP_DURATION * 1000 };
  // Production : remplacer par appel SMS / WhatsApp API
  return code;
}

function verifyOTP(code) {
  if (!_pendingOTP.code) return false;
  if (_pendingOTP.code !== code) return false;
  if (Date.now() > _pendingOTP.expiresAt) return false;
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
  const record = {
    telephone, prenom, nom, quartier, ville, verified: true,
    ...(avatarUrl ? { avatar_url: avatarUrl } : {})
  };

  // Premier enregistrement en base — INSERT complet à la fin de la procédure
  const { error } = await supabase
    .from('passengers')
    .upsert(record, { onConflict: 'telephone' });

  if (error) throw error;
  _pendingOTP = { code: null, expiresAt: 0 };
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
    setLoading(btnSend, true, 'Connexion…');

    try {
      // Vérifier si un compte vérifié existe déjà avec ce numéro
      const existing = await checkExistingAccount(currentPhone);

      if (existing) {
        // Compte vérifié trouvé → connexion directe
        saveSession(
          existing.telephone,
          existing.prenom,
          existing.email,
          existing.auth_provider,
          existing.avatar_url,
          existing.quartier,
          existing.ville
        );
        document.getElementById('auth-overlay').classList.remove('visible');
        onComplete({ telephone: existing.telephone, prenom: existing.prenom, nom: existing.nom, quartier: existing.quartier, ville: existing.ville });
        return;
      }

      // Aucun compte vérifié → procédure OTP
      setLoading(btnSend, true, 'Connexion / Recevoir le code');
      currentOTP = sendOTP();

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
      setLoading(btnSend, false, 'Connexion / Recevoir le code');
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

    const ok = verifyOTP(code);

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
  document.getElementById('btn-resend').addEventListener('click', () => {
    currentOTP = sendOTP();
    document.getElementById('demo-code').textContent = currentOTP;
    clearOTPBoxes();
    startTimer(() => { clearOTPBoxes(); btnVerify.disabled = true; });
  });

  // ────────────────────────────────────────────────
  // ÉCRAN 3 — Nom, Prénom & Avatar
  // ────────────────────────────────────────────────
  const nomInput      = document.getElementById('nom-input');
  const prenomInput   = document.getElementById('prenom-input');
  const villeInput    = document.getElementById('ville-input');
  const quartierInput = document.getElementById('quartier-input');
  const btnStart      = document.getElementById('btn-save-name');
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

  // Ouvrir le menu au clic sur le picker
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
      await saveProfile(currentPhone, prenom, nom, quartier, ville, selectedAvatar);

      document.getElementById('auth-overlay').classList.remove('visible');
      onComplete({ telephone: currentPhone, prenom, nom, quartier, ville });
    } catch (err) {
      console.error(err);
      showAuthError('name-error', 'Erreur lors de la sauvegarde. Réessayez.');
      setLoading(btnStart, false, 'Commencer 🚖');
    }
  });
}
