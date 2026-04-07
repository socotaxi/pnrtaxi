// ── PWA Install Logic ──────────────────────────────────────
const DISMISS_KEY  = 'pnr_install_dismissed';
const DISMISS_DAYS = 3; // re-afficher après 3 jours

function wasDismissedRecently() {
  const ts = localStorage.getItem(DISMISS_KEY);
  if (!ts) return false;
  return Date.now() - parseInt(ts) < DISMISS_DAYS * 86400000;
}

function dismiss(key) {
  if (key) localStorage.setItem(key, Date.now());
  document.getElementById('pwa-install-overlay').classList.remove('visible');
  document.getElementById('pwa-ios-overlay').classList.remove('visible');
}

function showOverlay(id) {
  document.getElementById(id).classList.add('visible');
}

const isIOS        = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                  || navigator.standalone === true;

// Ne pas afficher si déjà installé ou refusé récemment
if (!isStandalone && !wasDismissedRecently()) {
  if (isIOS) {
    // iOS : montrer les instructions après 2.5s
    setTimeout(() => showOverlay('pwa-ios-overlay'), 2500);
    document.getElementById('pwa-ios-dismiss-btn').addEventListener('click', () => dismiss(DISMISS_KEY));
    document.getElementById('pwa-ios-close-btn').addEventListener('click', () => dismiss(null));
    document.getElementById('pwa-ios-overlay').addEventListener('click', (e) => {
      if (e.target === document.getElementById('pwa-ios-overlay')) dismiss(null);
    });
  } else {
    // Android/Chrome : écouter beforeinstallprompt
    let deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      setTimeout(() => showOverlay('pwa-install-overlay'), 2000);
    });

    document.getElementById('pwa-install-btn').addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (outcome === 'accepted') dismiss(null);
      else dismiss(DISMISS_KEY);
    });

    document.getElementById('pwa-install-dismiss').addEventListener('click', () => dismiss(DISMISS_KEY));
    document.getElementById('pwa-install-overlay').addEventListener('click', (e) => {
      if (e.target === document.getElementById('pwa-install-overlay')) dismiss(null);
    });
  }
}
