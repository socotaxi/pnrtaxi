import { initDriverAuth } from './driver-auth.js';

const params   = new URLSearchParams(location.search);
const isSignup = params.get('m') === 'signup';

const chip    = document.getElementById('mode-chip');
const toggle  = document.getElementById('auth-mode-toggle');
const titleEl = document.getElementById('screen-phone-title');
const subEl   = document.getElementById('screen-phone-subtitle');

if (isSignup) {
  chip.textContent    = 'Inscription';
  titleEl.textContent = 'Créer votre compte chauffeur';
  subEl.textContent   = "Entrez votre numéro pour créer votre compte chauffeur";
  toggle.innerHTML    = 'Déjà un compte ? <a href="driver-auth.html">Se connecter</a>';
} else {
  chip.textContent = 'Connexion';
  toggle.innerHTML = "Pas encore de compte ? <a href='driver-auth.html?m=signup'>S'inscrire gratuitement</a>";
}

initDriverAuth();
