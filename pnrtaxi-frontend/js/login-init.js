import { initAuth } from './auth.js';

const params   = new URLSearchParams(location.search);
const isSignup = params.get('m') === 'signup';

const chip      = document.getElementById('mode-chip');
const toggle    = document.getElementById('auth-mode-toggle');
const titleEl   = document.getElementById('screen-phone-title');
const subEl     = document.getElementById('screen-phone-subtitle');
const pageTitle = document.querySelector('title');

if (isSignup) {
  chip.textContent      = 'Inscription';
  titleEl.textContent   = 'Créer votre compte';
  subEl.textContent     = "Entrez votre numéro pour recevoir un code d'activation";
  pageTitle.textContent = 'PNR Taxi — Créer un compte';
  toggle.innerHTML      = 'Déjà un compte ? <a href="login.html">Se connecter</a>';
} else {
  chip.textContent = 'Connexion';
  toggle.innerHTML = 'Pas encore de compte ? <a href="login.html?m=signup">Créer un compte gratuit</a>';
}

initAuth(() => {
  window.location.replace('passenger.html');
});
