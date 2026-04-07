// Effacer le mot de passe temporaire si l'utilisateur quitte la page
// sans terminer l'inscription (navigation arrière, fermeture onglet…)
window.addEventListener('pagehide', () => {
  sessionStorage.removeItem('pnr_driver_pending_pw');
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js')
    .catch(err => console.warn('SW error:', err));
}
