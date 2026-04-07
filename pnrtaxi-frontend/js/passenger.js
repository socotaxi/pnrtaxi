// ============================================================
//  passenger.js — App Passager PNR Taxi (Supabase)
// ============================================================

import { supabase } from './supabase-config.js';
import { haversineDistance, formatDistance } from './haversine.js';
import { initAuth, clearSession } from './auth.js';
import { requestRide, updateRideStatus, watchActiveRide } from './rides.js';
import { showRatingModal, getDriverRatingInfo, getDriverReviews } from './ratings.js';

// ── Sécurité : sanitize URL pour attributs src/href ──────────
// Autorise uniquement https:// et les blob: locaux (aperçu avatar)
function sanitizeUrl(url) {
  if (!url) return '';
  const s = String(url).trim();
  if (s.startsWith('https://') || s.startsWith('blob:')) return s;
  return '';
}

// ── Constantes ──────────────────────────────────────────────
const CENTER             = { lat: -4.7792, lng: 11.8650 };
const ZOOM               = 13;
const ZONE_RADIUS_KM     = 5;   // rayon de la zone en km
// IDs des drivers dont la connexion WebSocket est active (Supabase Presence)
const onlineDriverIds = new Set();

// Retourne true uniquement si le driver est disponible ET sa connexion est active
function isDriverConnected(driver) {
  if (!driver.disponible) return false;
  return onlineDriverIds.has(driver.id);
}

// ── État global ──────────────────────────────────────────────
let map              = null;
let userLat          = null;
let userLng          = null;
let userMarker       = null;
let userWatchId      = null;   // watchPosition handle
let session          = null;   // session passager courante
let activeRide       = null;   // course active (pending | accepted)
let ridePollingTimer   = null;   // intervalle de polling pour le statut de la course
let contactCountdown   = null;   // countdown de la fenêtre de contact (après acceptation)

const CONTACT_WINDOW_S = 30; // doit correspondre à la valeur dans driver.js
const driverMarkers = new Map(); // id → marker Leaflet
const driversData   = new Map(); // id → données brutes

// ── Polling de statut de course ───────────────────────────────
function startRidePoll(rideId) {
  stopRidePoll();
  ridePollingTimer = setInterval(async () => {
    if (!activeRide || activeRide.id !== rideId) { stopRidePoll(); return; }
    try {
      const { data } = await supabase
        .from('rides')
        .select('*, drivers(*)')
        .eq('id', rideId)
        .maybeSingle();
      if (!data) return;
      // Toujours appeler updateRideBanner si le statut a changé
      if (data.status !== activeRide.status) updateRideBanner(data);
      // Arrêter le polling uniquement pour les statuts finaux (rejected/cancelled/completed)
      const finalStatuses = ['rejected', 'cancelled', 'completed'];
      if (finalStatuses.includes(data.status)) stopRidePoll();
    } catch (_) {}
  }, 3000);
}

function stopRidePoll() {
  if (ridePollingTimer) { clearInterval(ridePollingTimer); ridePollingTimer = null; }
}

// ── Carte ────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', { center: [CENTER.lat, CENTER.lng], zoom: ZOOM });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);
}

// ── Géolocalisation passager (suivi continu) ─────────────────
function makeUserIcon(avatarUrl) {
  if (avatarUrl) {
    return L.divIcon({
      className: '',
      html: `<div style="
        width:20px;height:20px;border-radius:50%;
        border:2px solid white;
        box-shadow:0 0 0 2px #4a90e2, 0 2px 6px rgba(0,0,0,0.3);
        overflow:hidden;background:#4a90e2;
        flex-shrink:0;
      "><img src="${sanitizeUrl(avatarUrl)}" alt="" style="
        width:100%;height:100%;object-fit:cover;display:block;
      " onerror="this.parentElement.style.background='#4a90e2';this.remove();" /></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
  }
  return L.divIcon({
    className: '',
    html: `<div style="
      width:18px;height:18px;border-radius:50%;
      background:#4a90e2;border:3px solid white;
      box-shadow:0 0 0 4px rgba(74,144,226,0.3);
    "></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function locateUser() {
  if (!navigator.geolocation) {
    showToast('⚠️ GPS non disponible sur cet appareil', 3000);
    return;
  }
  showToast('📍 Localisation en cours…');

  // Arrêter un éventuel watch précédent
  if (userWatchId !== null) {
    navigator.geolocation.clearWatch(userWatchId);
    userWatchId = null;
  }

  let firstFix    = true;
  let lastUserLat = null;
  let lastUserLng = null;

  userWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      // Throttle : ignorer les micro-déplacements < ~11m (0.0001°)
      const moved = lastUserLat === null
        || Math.abs(lat - lastUserLat) > 0.0001
        || Math.abs(lng - lastUserLng) > 0.0001;

      if (!moved && !firstFix) return;

      userLat     = lat;
      userLng     = lng;
      lastUserLat = lat;
      lastUserLng = lng;

      if (userMarker) {
        userMarker.setLatLng([userLat, userLng]);
      } else {
        userMarker = L.marker([userLat, userLng], { icon: makeUserIcon(session?.avatar_url) })
          .addTo(map)
          .bindPopup('<b>📍 Vous êtes ici</b>');
      }

      // Centrage automatique uniquement au premier fix
      if (firstFix) {
        firstFix = false;
        map.flyTo([userLat, userLng], ZOOM, { animate: true, duration: 1 });
        showToast('✅ Position trouvée', 2000);
        // Activer le bouton centrer
        const btn = document.getElementById('locate-me-btn');
        if (btn) btn.classList.add('active');
      }

      refreshMarkers();
    },
    (err) => {
      const msgs = {
        1: '⚠️ Permission GPS refusée',
        2: '⚠️ Signal GPS indisponible',
        3: '⚠️ GPS trop lent',
      };
      showToast(msgs[err.code] || '⚠️ Position non disponible', 3000);
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );
}

// Recentrer la carte sur la position du passager
function centerOnUser() {
  if (userLat !== null && userLng !== null) {
    map.flyTo([userLat, userLng], ZOOM, { animate: true, duration: 0.8 });
  } else {
    showToast('📍 Position non encore disponible…', 2000);
  }
}

// ── Icône voiture ────────────────────────────────────────────
function makeCarIcon(disponible) {
  const color = disponible ? '#00c851' : '#ff4444';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="36" height="36">
      <rect x="4" y="16" width="28" height="12" rx="3" fill="${color}"/>
      <path d="M10 16 L13 8 H23 L26 16 Z" fill="${color}" opacity="0.85"/>
      <path d="M14 15 L15.5 9.5 H20.5 L22 15 Z" fill="rgba(200,240,255,0.7)"/>
      <circle cx="10" cy="28" r="4" fill="#1a1a2e" stroke="${color}" stroke-width="2"/>
      <circle cx="26" cy="28" r="4" fill="#1a1a2e" stroke="${color}" stroke-width="2"/>
      <rect x="4" y="20" width="4" height="3" rx="1" fill="rgba(255,255,200,0.9)"/>
      <rect x="28" y="20" width="4" height="3" rx="1" fill="rgba(255,100,100,0.9)"/>
    </svg>`;

  return L.divIcon({
    className: '',
    html: `<div class="car-marker">${svg}</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 28],
  });
}

// ── Zone ─────────────────────────────────────────────────────
function isInZone(lat, lng) {
  if (userLat === null || userLng === null) return true; // position inconnue : on accepte tout
  return haversineDistance(userLat, userLng, lat, lng) <= ZONE_RADIUS_KM;
}

// ── Marqueurs chauffeurs ──────────────────────────────────────
function upsertDriverMarker(driver) {
  const { id, lat, lng } = driver;
  driversData.set(id, driver); // toujours mémoriser les données brutes
  if (!lat || !lng) return;

  const inZone    = isInZone(lat, lng);
  const connected = isDriverConnected(driver);

  // Si le marqueur existe déjà et que l'état de connexion n'a pas changé : mise à jour en place
  if (driverMarkers.has(id)) {
    const m = driverMarkers.get(id);
    if (inZone && m._wasAvailable === connected) {
      m.setLatLng([lat, lng]);
      m.setIcon(makeCarIcon(connected));
      m._driverData = driver;
      return;
    }
    // Sinon (hors zone ou changement d'état) : supprimer et recréer
    map.removeLayer(m);
    driverMarkers.delete(id);
  }

  if (!inZone) return;

  // Créer le marqueur — interactif uniquement si connecté
  const m = L.marker([lat, lng], {
    icon: makeCarIcon(connected),
    interactive: connected,
  }).addTo(map);
  m._driverData   = driver;
  m._wasAvailable = connected;

  if (connected) {
    m.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      openDriverPanel(m._driverData);
    });
  }

  driverMarkers.set(id, m);
}

function removeDriverMarker(id) {
  driversData.delete(id);
  if (driverMarkers.has(id)) {
    map.removeLayer(driverMarkers.get(id));
    driverMarkers.delete(id);
  }
}

// Recalcule tous les marqueurs (appelé après obtention de la position)
function refreshMarkers() {
  driversData.forEach(driver => upsertDriverMarker(driver));
  updateCount();
}

function updateCount() {
  let n = 0;
  driverMarkers.forEach(m => { if (m._wasAvailable) n++; });
  document.getElementById('driver-count').textContent =
    `${n} chauffeur${n > 1 ? 's' : ''} disponible${n > 1 ? 's' : ''} à proximité`;
}

// ── Présence temps réel (connexion/déconnexion instantanée) ──
function watchDriverPresence() {
  const channel = supabase.channel('drivers-online');

  channel
    .on('presence', { event: 'sync' }, () => {
      onlineDriverIds.clear();
      Object.values(channel.presenceState()).flat().forEach(p => {
        if (p.driver_id) onlineDriverIds.add(p.driver_id);
      });
      refreshMarkers();
    })
    .on('presence', { event: 'join' }, ({ newPresences }) => {
      newPresences.forEach(p => { if (p.driver_id) onlineDriverIds.add(p.driver_id); });
      refreshMarkers();
    })
    .on('presence', { event: 'leave' }, ({ leftPresences }) => {
      leftPresences.forEach(p => { if (p.driver_id) onlineDriverIds.delete(p.driver_id); });
      refreshMarkers();
    })
    .subscribe();
}

// ── Temps réel Supabase ───────────────────────────────────────
async function watchDrivers() {
  const { data, error } = await supabase.from('drivers').select('*');
  if (error) { console.error('Erreur chargement chauffeurs:', error.message); return; }

  data.forEach(d => upsertDriverMarker(d));
  updateCount();

  let realtimeChannel = null;

  function subscribeDrivers() {
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
    }

    realtimeChannel = supabase.channel('drivers-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, ({ eventType, new: n, old: o }) => {
        if (eventType === 'INSERT' || eventType === 'UPDATE') {
          upsertDriverMarker(n);
          const panel = document.getElementById('driver-panel');
          if (panel.classList.contains('open') && panel._currentDriverId === n.id) openDriverPanel(n);
        }
        if (eventType === 'DELETE') removeDriverMarker(o.id);
        updateCount();
      })
      .subscribe(status => {
        const countEl = document.getElementById('driver-count');
        if (status === 'SUBSCRIBED') {
          console.log('[Supabase] Temps réel actif ✅');
          if (countEl) countEl.style.color = '';
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[Supabase] Connexion perdue, reconnexion dans 5s…');
          if (countEl) countEl.style.color = '#ff9800';
          setTimeout(subscribeDrivers, 5000);
        } else if (status === 'CLOSED') {
          console.warn('[Supabase] Canal fermé');
        }
      });
  }

  subscribeDrivers();
}

// ── Notifications passager (son + vibration) ─────────────────
function notifyPassenger(type) {
  // Vibration
  if (navigator.vibrate) {
    navigator.vibrate(type === 'accepted' ? [100, 50, 100, 50, 200] : [400, 100, 400]);
  }

  // Son via Web Audio API
  try {
    const AudioCtx = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    const ctx = new AudioCtx();

    if (type === 'accepted') {
      // Deux notes montantes (Do → Mi) — ton positif
      [{ freq: 523, t: 0 }, { freq: 659, t: 0.2 }].forEach(({ freq, t }) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.7, ctx.currentTime + t);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.25);
        osc.start(ctx.currentTime + t);
        osc.stop(ctx.currentTime + t + 0.25);
      });
      setTimeout(() => ctx.close(), 800);
    } else {
      // Une note basse unique — ton négatif
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.value = 220;
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
      setTimeout(() => ctx.close(), 700);
    }
  } catch (err) {
    console.warn('Audio non disponible:', err);
  }
}

// ── Bandeau statut de course ─────────────────────────────────
function updateRideBanner(ride) {
  const banner    = document.getElementById('ride-banner');
  const iconEl    = document.getElementById('ride-banner-icon');
  const titleEl   = document.getElementById('ride-banner-title');
  const driverEl  = document.getElementById('ride-banner-driver');
  const cancelBtn = document.getElementById('ride-banner-cancel');

  const dismissedKey = ride ? `dismissed_ride_${ride.id}` : null;
  const isDismissed  = dismissedKey && localStorage.getItem(dismissedKey);

  if (!ride || ride.status === 'cancelled' || isDismissed) {
    banner.className = 'ride-banner hidden';
    activeRide = null;
    stopRidePoll();
    if (contactCountdown) { clearInterval(contactCountdown); contactCountdown = null; }
    const rbcBox = document.getElementById('rbc-box');
    if (rbcBox) rbcBox.style.display = 'none';
    syncBannerWithPanel();
    return;
  }

  // Course terminée par le chauffeur (realtime) → modale de notation
  if (ride.status === 'completed') {
    banner.className = 'ride-banner hidden';
    activeRide = null;
    stopRidePoll();
    if (contactCountdown) { clearInterval(contactCountdown); contactCountdown = null; }
    const rbcBox2 = document.getElementById('rbc-box');
    if (rbcBox2) rbcBox2.style.display = 'none';
    syncBannerWithPanel();
    const driverName = ride.drivers
      ? [ride.drivers.prenom, ride.drivers.nom].filter(Boolean).join(' ') || ride.driver_id
      : ride.driver_id;
    showRatingModal({
      title:    'Course terminée !',
      subtitle: `Comment était ${driverName} ?`,
      rideId:   ride.id,
      fromRole: 'passenger',
      toId:     ride.driver_id,
    });
    return;
  }

  activeRide = ride;

  const driverName = ride.drivers
    ? [ride.drivers.prenom, ride.drivers.nom].filter(Boolean).join(' ') || ride.driver_id
    : ride.driver_id;

  if (ride.status === 'pending') {
    banner.className = 'ride-banner';
    iconEl.textContent    = '⏳';
    titleEl.textContent   = 'En attente de confirmation…';
    cancelBtn.textContent = 'Annuler';
    cancelBtn.style.display = '';
    cancelBtn.onclick = async () => {
      if (!activeRide) return;
      cancelBtn.disabled = true;
      try {
        await updateRideStatus(activeRide.id, 'cancelled');
        updateRideBanner(null);
      } catch (err) {
        console.error('Erreur annulation course:', err);
        cancelBtn.disabled = false;
      }
    };
  } else if (ride.status === 'accepted') {
    banner.className = 'ride-banner accepted';
    iconEl.textContent    = '✅';
    titleEl.textContent   = 'Course acceptée !';
    cancelBtn.textContent = 'Fermer';
    cancelBtn.style.display = '';
    notifyPassenger('accepted');
    cancelBtn.onclick = async () => {
      if (contactCountdown) { clearInterval(contactCountdown); contactCountdown = null; }
      const box = document.getElementById('rbc-box');
      if (box) box.style.display = 'none';
      localStorage.setItem(`dismissed_ride_${ride.id}`, '1');
      try { await updateRideStatus(ride.id, 'completed'); } catch (_) {}
      banner.classList.add('hidden');
      syncBannerWithPanel();
      activeRide = null;
      refreshRideButtonInPanel();
      // Modale de notation chauffeur
      const driverName = ride.drivers
        ? [ride.drivers.prenom, ride.drivers.nom].filter(Boolean).join(' ') || ride.driver_id
        : ride.driver_id;
      showRatingModal({
        title:    'Course terminée !',
        subtitle: `Comment était ${driverName} ?`,
        rideId:   ride.id,
        fromRole: 'passenger',
        toId:     ride.driver_id,
      });
    };

    // ── Countdown fenêtre de contact (grand affichage) ───────
    const rbcBox    = document.getElementById('rbc-box');
    const rbcNumber = document.getElementById('rbc-number');

    // N'afficher la boîte que si le countdown est en cours
    if (rbcBox) rbcBox.style.display = '';

    // Ne relancer le countdown que s'il n'est pas déjà actif
    if (!contactCountdown) {
      const base     = ride.updated_at ? new Date(ride.updated_at).getTime() : Date.now();
      const computed = base + CONTACT_WINDOW_S * 1000;
      const endAt    = computed > Date.now() ? computed : Date.now() + CONTACT_WINDOW_S * 1000;

      contactCountdown = setInterval(async () => {
        const remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
        const urgent    = remaining <= 5;

        // Boîte chiffrée passager
        if (rbcNumber) rbcNumber.textContent = remaining;
        if (rbcBox)    rbcBox.classList.toggle('urgent', urgent);

        // Sous-titre bannière
        if (remaining > 0) {
          driverEl.textContent = `📞 Appelez le chauffeur maintenant !`;
          driverEl.style.color = urgent ? '#ef4444' : '#16a34a';
        } else {
          clearInterval(contactCountdown); contactCountdown = null;
          if (rbcBox) rbcBox.style.display = 'none';
          // Fermer automatiquement la bannière et marquer la course comme terminée
          const completedRide = activeRide;
          localStorage.setItem(`dismissed_ride_${completedRide?.id}`, '1');
          try { if (completedRide) await updateRideStatus(completedRide.id, 'completed'); } catch (_) {}
          banner.classList.add('hidden');
          syncBannerWithPanel();
          activeRide = null;
          stopRidePoll();
          refreshRideButtonInPanel();
          // Modale de notation chauffeur
          if (completedRide) {
            const driverName = completedRide.drivers
              ? [completedRide.drivers.prenom, completedRide.drivers.nom].filter(Boolean).join(' ') || completedRide.driver_id
              : completedRide.driver_id;
            showRatingModal({
              title:    'Course terminée !',
              subtitle: `Comment était ${driverName} ?`,
              rideId:   completedRide.id,
              fromRole: 'passenger',
              toId:     completedRide.driver_id,
            });
          }
          return; // ne pas appeler refreshRideButtonInPanel une 2e fois
        }
        refreshRideButtonInPanel();
      }, 1000);

      // Affichage immédiat sans attendre le premier tick
      const initRemaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      if (rbcNumber) rbcNumber.textContent = initRemaining;
      driverEl.textContent = `📞 Appelez le chauffeur maintenant !`;
      driverEl.style.color = '#16a34a';
    }
  } else if (ride.status === 'rejected') {
    banner.className = 'ride-banner rejected';
    iconEl.textContent  = '❌';
    titleEl.textContent = 'Course refusée par le chauffeur';
    cancelBtn.textContent    = 'Fermer';
    cancelBtn.style.display  = '';
    stopRidePoll();
    cancelBtn.onclick = () => {
      banner.classList.add('hidden');
      activeRide = null;
      refreshRideButtonInPanel();
    };
    notifyPassenger('rejected');
    showRejectedModal();   // modale proéminente au-dessus de tout
    // Masquer automatiquement après 8 s si pas fermé manuellement
    setTimeout(() => {
      if (activeRide?.status === 'rejected') {
        banner.classList.add('hidden');
        activeRide = null;
        refreshRideButtonInPanel();
      }
    }, 8000);
  }

  // Pour accepted : le countdown gère driverEl, ne pas l'écraser avec le nom
  if (ride.status !== 'accepted') {
    driverEl.textContent = driverName;
    driverEl.style.color = '';
  }
  banner.classList.remove('hidden');
  syncBannerWithPanel();

  // Recalcule le bouton dans le panneau si ouvert
  refreshRideButtonInPanel();
}

// Masque le bandeau derrière le panel uniquement pour "pending" (le panel affiche déjà le bouton)
// Pour "accepted" et "rejected" : toujours visible, le passager doit voir le countdown / la notif
function syncBannerWithPanel() {
  const panel  = document.getElementById('driver-panel');
  const banner = document.getElementById('ride-banner');
  if (!panel || !banner) return;

  const status           = activeRide?.status;
  const panelOpen        = panel.classList.contains('open');
  const rideIsThisDriver = activeRide && panel._currentDriverId === activeRide.driver_id;

  if (panelOpen && rideIsThisDriver && status === 'pending') {
    // Cacher uniquement quand en attente : le bouton dans le panel suffit
    banner.classList.add('hidden');
  } else if (status === 'pending' || status === 'accepted' || status === 'rejected') {
    // Pour tous les autres statuts visibles : toujours montrer
    banner.classList.remove('hidden');
  }
}

// ── Modale de notification de refus ──────────────────────────
function showRejectedModal() {
  const modal   = document.getElementById('ride-rejected-modal');
  const closeBtn = document.getElementById('ride-rejected-close');
  if (!modal) return;

  modal.classList.remove('hidden');

  function dismiss() {
    modal.classList.add('hidden');
    // Fermer aussi le panel chauffeur si ouvert
    const panel = document.getElementById('driver-panel');
    if (panel?.classList.contains('open')) {
      panel.classList.remove('open');
      syncBannerWithPanel();
    }
  }

  closeBtn.onclick = dismiss;
  // Fermer en cliquant sur le fond
  modal.querySelector('.ride-rejected-backdrop').onclick = dismiss;
}

function refreshRideButtonInPanel() {
  const panel = document.getElementById('driver-panel');
  if (!panel.classList.contains('open')) return;
  const driverId = panel._currentDriverId;
  if (!driverId) return;
  const driver = driversData.get(driverId);
  if (!driver) return;
  renderRideButton(driver);
  renderWhatsAppCta(driver);
}

function renderRideButton(driver) {
  const el = document.getElementById('panel-ride-request');
  if (!el) return;

  const passengerId = session?.telephone || session?.email;
  if (!passengerId) { el.innerHTML = ''; return; }

  // Course active sur CE chauffeur — toujours afficher même si le chauffeur est indisponible
  if (activeRide && activeRide.driver_id === driver.id) {
    if (activeRide.status === 'pending') {
      el.innerHTML = `
        <div class="ride-request-wrap">
          <button class="btn-request-ride pending" disabled>
            <span class="ride-spinner"></span>
            En attente de confirmation…
          </button>
          <div class="ride-progress-bar"><div class="ride-progress-bar-fill"></div></div>
        </div>`;
      return;
    }
    if (activeRide.status === 'accepted') {
      el.innerHTML = `
        <div class="ride-request-wrap">
          <button class="btn-request-ride accepted" disabled>
            ✅ Course acceptée !
          </button>
        </div>`;
      return;
    }
  }

  // Course active sur un AUTRE chauffeur
  if (activeRide && activeRide.driver_id !== driver.id &&
      (activeRide.status === 'pending' || activeRide.status === 'accepted')) {
    el.innerHTML = `
      <div class="ride-request-wrap">
        <button class="btn-request-ride" disabled>🚫 Course déjà en cours</button>
      </div>`;
    return;
  }

  // Aucune course active : vérifier que le chauffeur est bien connecté avant d'afficher le bouton
  if (!isDriverConnected(driver)) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="ride-request-wrap">
      <button class="btn-request-ride" id="btn-request-ride-action">
        🚖 Demander ce taxi
      </button>
    </div>`;
  document.getElementById('btn-request-ride-action').addEventListener('click', async () => {
    const btn = document.getElementById('btn-request-ride-action');
    btn.disabled = true;
    btn.innerHTML = '<span class="ride-spinner"></span> Envoi en cours…';
    try {
      const ride = await requestRide({
        passengerId,
        driverId:     driver.id,
        passengerLat: userLat,
        passengerLng: userLng,
      });
      updateRideBanner(ride);
      startRidePoll(ride.id); // polling toutes les 3s jusqu'à réponse du chauffeur
    } catch (err) {
      console.error('Erreur demande de course:', err);
      btn.disabled = false;
      btn.innerHTML = '🚖 Demander ce taxi';
      showToast('❌ Impossible d\'envoyer la demande', 3000);
    }
  });
}

// ── Boutons Appel direct + WhatsApp ──────────────────────────
const PHONE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
  width="20" height="20">
  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07
    A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.68A2 2 0 012 1h3
    a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91
    8.91A16 16 0 0015.1 17.1l1.27-1.27a2 2 0 012.11-.45
    c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
</svg>`;

const WA_SVG = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" width="20" height="20">
  <path fill="currentColor" d="M16.002 3C9.375 3 4 8.373 4 15c0 2.385.68 4.61 1.857 6.497L4 29l7.742-1.83A12.94 12.94 0 0016.002 28c6.626 0 12-5.373 12-12S22.628 3 16.002 3zm0 21.6a10.55 10.55 0 01-5.37-1.47l-.385-.229-3.986.942.988-3.875-.25-.4A10.56 10.56 0 015.4 15c0-5.848 4.755-10.6 10.6-10.6S26.6 9.152 26.6 15 21.848 24.6 16.002 24.6zm5.814-7.946c-.318-.16-1.887-.93-2.18-1.037-.294-.107-.508-.16-.721.16-.213.32-.826 1.037-.012 1.25.293.106 1.032.373 1.967.774.938.4 1.574 1.009 1.95 1.25.376.24.08.534-.054.72-.133.186-.373.32-.72.534-.347.213-.508.373-.828.188-.32-.186-1.24-.64-2.36-1.44-.89-.64-1.494-1.44-1.66-1.68-.168-.24-.018-.373.125-.48.128-.093.32-.24.48-.373.16-.133.213-.24.32-.4.107-.16.053-.32-.027-.453-.08-.133-.72-1.733-.986-2.374-.266-.64-.533-.56-.72-.56h-.613c-.213 0-.56.08-.853.373-.294.293-1.12 1.093-1.12 2.668 0 1.573 1.147 3.093 1.307 3.307.16.213 2.24 3.44 5.44 4.826.76.333 1.36.533 1.827.68.76.24 1.454.207 2 .127.614-.094 1.887-.773 2.147-1.52.267-.746.267-1.386.187-1.52-.08-.133-.294-.213-.614-.373z"/>
</svg>`;

function renderWhatsAppCta(driver) {
  const ctaEl = document.getElementById('panel-cta');
  if (!ctaEl) return;

  if (!driver.telephone) { ctaEl.innerHTML = ''; return; }

  const tel      = driver.telephone.replace(/\s/g, '');
  const waNum    = tel.replace(/\D/g, '');
  const accepted = activeRide?.driver_id === driver.id && activeRide?.status === 'accepted';

  if (!accepted && !isDriverConnected(driver)) {
    const msg = driver.disponible
      ? '🔌 Ce chauffeur est hors ligne'
      : '❌ Ce chauffeur n\'est pas disponible';
    ctaEl.innerHTML = `
      <div style="text-align:center;padding:16px;
        background:rgba(255,68,68,0.08);border:1px solid rgba(255,68,68,0.18);
        border-radius:14px;color:var(--red);font-weight:600;font-size:0.9rem;">
        ${msg}
      </div>`;
    return;
  }

  if (accepted) {
    ctaEl.innerHTML = `
      <div class="cta-call-row">
        <a class="btn-call-direct" href="tel:${tel}">
          ${PHONE_SVG} Appel direct
        </a>
        <a class="btn-whatsapp" href="https://wa.me/${waNum}" target="_blank" rel="noopener noreferrer">
          ${WA_SVG} WhatsApp
        </a>
      </div>`;
  } else {
    ctaEl.innerHTML = `
      <div class="cta-call-row">
        <button class="btn-call-direct" disabled>${PHONE_SVG} Appel direct</button>
        <button class="btn-whatsapp"    disabled>${WA_SVG} WhatsApp</button>
      </div>
      <p class="cta-lock-hint">🔒 Disponible après acceptation de la course</p>`;
  }
}

// ── Panneau chauffeur ────────────────────────────────────────
function openDriverPanel(driver) {
  const panel = document.getElementById('driver-panel');
  panel._currentDriverId = driver.id;

  const driverFullName  = [driver.prenom, driver.nom].filter(Boolean).join(' ') || driver.nom || '—';
  const vehiculeDesc    = [driver.marque, driver.modele].filter(Boolean).join(' ') || '—';
  const couleurDesc     = [driver.couleur, driver.type_vehicule === 'moto' ? 'Moto' : driver.type_vehicule === 'car' ? 'Voiture' : null].filter(Boolean).join(' · ') || null;

  document.getElementById('panel-photo').src           = sanitizeUrl(driver.photo) || 'https://i.pravatar.cc/150?img=0';
  document.getElementById('panel-name').textContent    = driverFullName;
  document.getElementById('panel-plate').textContent   = driver.immatriculation || '—';
  document.getElementById('panel-vehicle').textContent = vehiculeDesc;

  const colorEl = document.getElementById('panel-color');
  if (colorEl) colorEl.textContent = couleurDesc || '—';

  const climEl = document.getElementById('panel-clim');
  if (climEl) {
    if (driver.climatisation === true) {
      climEl.innerHTML = '<span style="color:#0891b2;font-weight:600">❄️ Climatisée</span>';
    } else if (driver.climatisation === false) {
      climEl.innerHTML = '<span style="color:#64748b;font-weight:600">🚫❄️ Non climatisée</span>';
    } else {
      climEl.textContent = '—';
    }
  }

  // Distance
  const distEl = document.getElementById('panel-distance');
  distEl.textContent = (userLat !== null && driver.lat && driver.lng)
    ? formatDistance(haversineDistance(userLat, userLng, driver.lat, driver.lng))
    : '— km';

  // Disponibilité
  const availEl = document.getElementById('panel-availability');
  const connected = isDriverConnected(driver);
  availEl.textContent = connected ? '● Disponible' : (driver.disponible ? '● Hors ligne' : '● Non disponible');
  availEl.className   = `dp-chip ${connected ? 'available' : 'unavailable'}`;

  renderWhatsAppCta(driver);
  renderRideButton(driver);

  // Note moyenne + avis (chargement asynchrone)
  renderDriverRating(driver.id);

  panel.classList.add('open');
  syncBannerWithPanel();
}

function starsHtml(avg, count) {
  if (!avg || count === 0) return '<span style="color:var(--text-muted);font-size:0.8rem">Pas encore noté</span>';
  const full  = Math.floor(avg);
  const half  = avg - full >= 0.4 ? 1 : 0;
  const empty = 5 - full - half;
  const stars = '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
  return `<span style="color:#f59e0b">${stars}</span> <span style="color:var(--text-muted);font-size:0.78rem">${Number(avg).toFixed(1)} · ${count} avis</span>`;
}

async function renderDriverRating(driverId) {
  const starsEl   = document.getElementById('panel-stars');
  const ratingsEl = document.getElementById('panel-ratings');
  if (!starsEl || !ratingsEl) return;

  starsEl.innerHTML   = '<span style="color:var(--text-muted);font-size:0.8rem">…</span>';
  ratingsEl.innerHTML = '';

  const [info, reviews] = await Promise.all([
    getDriverRatingInfo(driverId),
    getDriverReviews(driverId, 5),
  ]);

  starsEl.innerHTML = starsHtml(info.rating_avg, info.rating_count);

  if (reviews.length === 0) return;

  const items = reviews.map(r => {
    const date  = new Date(r.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    const stars = '★'.repeat(r.score) + '☆'.repeat(5 - r.score);
    return `
      <div class="review-item">
        <div class="review-header">
          <span class="review-stars">${stars}</span>
          <span class="review-date">${date}</span>
        </div>
        <p class="review-comment">${r.comment}</p>
      </div>`;
  }).join('');

  ratingsEl.innerHTML = `
    <button class="review-toggle" aria-expanded="false" aria-controls="review-list">
      <span class="review-toggle-label">Voir les avis (${reviews.length})</span>
      <svg class="review-toggle-chevron" width="16" height="16" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="2.5"
           stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>
    <div class="review-list" id="review-list" hidden>
      ${items}
    </div>`;

  ratingsEl.querySelector('.review-toggle').addEventListener('click', function () {
    const list     = document.getElementById('review-list');
    const expanded = this.getAttribute('aria-expanded') === 'true';
    this.setAttribute('aria-expanded', String(!expanded));
    this.querySelector('.review-toggle-label').textContent =
      expanded ? `Voir les avis (${reviews.length})` : `Masquer les avis`;
    list.hidden = expanded;
  });
}

function closeDriverPanel() {
  document.getElementById('driver-panel').classList.remove('open');
  syncBannerWithPanel();
}

// ── Toast GPS ────────────────────────────────────────────────
function showToast(msg, duration = 0) {
  const t = document.getElementById('gps-toast');
  t.textContent = msg;
  t.classList.add('show');
  if (duration > 0) setTimeout(() => t.classList.remove('show'), duration);
}

// ── Menu utilisateur ─────────────────────────────────────────
function initUserMenu(session) {
  const btn      = document.getElementById('user-menu-btn');
  const dropdown = document.getElementById('user-dropdown');
  const nameEl   = document.getElementById('user-name');
  const avatarEl = document.getElementById('float-avatar');

  nameEl.textContent = session.prenom;

  // Avatar float + toutes les navs
  if (session.avatar_url) {
    avatarEl.innerHTML = `<img src="${sanitizeUrl(session.avatar_url)}" alt="" />`;
  } else {
    avatarEl.textContent = (session.prenom || '?').charAt(0).toUpperCase();
  }
  setAllAvatars(session);

  document.getElementById('dropdown-name').textContent  = `👤 ${session.prenom}`;
  document.getElementById('dropdown-phone').textContent = session.email || session.telephone || '';

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('hidden');
  });

  document.addEventListener('click', () => dropdown.classList.add('hidden'));

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await clearSession();
    window.location.href = 'index.html';
  });
}

// ── Carte (chargement différé) ───────────────────────────────
let mapInitialized = false;

function showMap() {
  document.getElementById('passenger-dashboard').style.display = 'none';
  const appEl = document.getElementById('app');
  appEl.style.display = '';

  if (!mapInitialized) {
    mapInitialized = true;
    initMap();
    requestAnimationFrame(() => map.invalidateSize());
    locateUser();
    watchDriverPresence();
    watchDrivers();

    document.getElementById('panel-close').addEventListener('click', closeDriverPanel);
    document.getElementById('locate-me-btn').addEventListener('click', centerOnUser);
    map.on('click', closeDriverPanel);

    let touchStartY = 0;
    const panel = document.getElementById('driver-panel');
    panel.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
    panel.addEventListener('touchend', e => {
      if (e.changedTouches[0].clientY - touchStartY > 60) closeDriverPanel();
    }, { passive: true });

    // Bouton retour au dashboard
    document.getElementById('nav-home-map-btn').addEventListener('click', () => {
      appEl.style.display = 'none';
      document.getElementById('passenger-dashboard').style.display = '';
    });

    // Profil depuis carte
    document.getElementById('nav-profile-map-btn').addEventListener('click', () => {
      document.getElementById('app').style.display = 'none';
      showProfile(session);
    });
  } else {
    requestAnimationFrame(() => map.invalidateSize());
  }
}

// ── Helpers avatar ────────────────────────────────────────────
function setAvatarEl(el, session) {
  if (!el) return;
  const initiale = (session.prenom || '?').charAt(0).toUpperCase();
  if (session.avatar_url) {
    el.innerHTML = `<img src="${sanitizeUrl(session.avatar_url)}" alt="" />`;
  } else {
    el.textContent = initiale;
  }
}

function setAllAvatars(session) {
  ['nav-avatar-map', 'nav-avatar-dash', 'nav-avatar-prof', 'dash-avatar'].forEach(id => {
    setAvatarEl(document.getElementById(id), session);
  });
}

function setAvatarDisplay(url, initiale) {
  const el = document.getElementById('prof-avatar');
  if (url) {
    el.innerHTML = `<img src="${sanitizeUrl(url)}" alt="" />`;
  } else {
    el.textContent = initiale;
  }
}

async function uploadAvatar(file, session) {
  const ext      = file.name.split('.').pop();
  const key      = session.telephone || session.email || 'unknown';
  const filePath = `passengers/${key.replace(/\W/g, '_')}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('avatars')
    .upload(filePath, file, { upsert: true, contentType: file.type });

  if (upErr) throw upErr;

  const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
  const url = data.publicUrl;

  // Sauvegarder dans la table passengers
  if (session.telephone) {
    await supabase.from('passengers').update({ avatar_url: url }).eq('telephone', session.telephone);
  } else if (session.email) {
    await supabase.from('passengers').update({ avatar_url: url }).eq('email', session.email);
  }

  return url;
}

// ── Page Profil ──────────────────────────────────────────────
function showProfile(session) {
  document.getElementById('passenger-dashboard').style.display = 'none';
  document.getElementById('app').style.display = 'none';
  document.getElementById('profile-screen').style.display = '';

  // Remplir les infos depuis la session
  const prenom = session.prenom || '—';
  const initiale = prenom.charAt(0).toUpperCase();

  setAvatarDisplay(session.avatar_url || null, initiale);
  document.getElementById('prof-display-name').textContent = prenom;

  // Upload avatar au changement de fichier
  const fileInput = document.getElementById('avatar-file-input');
  // Cloner pour éviter les doublons de listeners
  const newFileInput = fileInput.cloneNode(true);
  fileInput.parentNode.replaceChild(newFileInput, fileInput);

  newFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Prévisualisation immédiate
    const preview = URL.createObjectURL(file);
    setAvatarDisplay(preview, initiale);

    try {
      const url = await uploadAvatar(file, session);
      session.avatar_url = url;
      localStorage.setItem('pnr_passenger', JSON.stringify(session));
      setAvatarDisplay(url, initiale);
      // Mettre à jour le bouton flottant sur la carte
      const floatEl = document.getElementById('float-avatar');
      if (floatEl) floatEl.innerHTML = `<img src="${url}" alt="${session.prenom}" />`;
      // Mettre à jour le marqueur sur la carte
      if (userMarker) userMarker.setIcon(makeUserIcon(url));
    } catch (err) {
      console.error('Erreur upload avatar:', err);
      setAvatarDisplay(session.avatar_url || null, initiale);
    }
  });

  const telephone = session.telephone || '';
  const email     = session.email || '';

  document.getElementById('info-nom').textContent      = session.nom      || '—';
  document.getElementById('info-prenom').textContent   = prenom;
  document.getElementById('info-ville').textContent    = session.ville    || '—';
  document.getElementById('info-quartier').textContent = session.quartier || '—';
  document.getElementById('info-telephone').textContent = telephone || '—';

  if (email) {
    document.getElementById('info-email').textContent = email;
    document.getElementById('info-email-row').style.display = '';
    document.getElementById('prof-display-contact').textContent = email;
  } else {
    document.getElementById('prof-display-contact').textContent = telephone;
  }

  // Mode vue par défaut
  document.getElementById('prof-view').style.display = '';
  document.getElementById('prof-edit-form').style.display = 'none';

  // Bouton "Modifier"
  document.getElementById('prof-edit-btn').onclick = () => {
    document.getElementById('edit-nom').value      = session.nom      || '';
    document.getElementById('edit-prenom').value   = session.prenom   || '';
    document.getElementById('edit-ville').value    = session.ville    || '';
    document.getElementById('edit-quartier').value = session.quartier || '';
    document.getElementById('prof-view').style.display = 'none';
    document.getElementById('prof-edit-form').style.display = '';
    document.getElementById('prof-save-error').textContent = '';
  };

  // Annuler
  document.getElementById('prof-cancel-btn').onclick = () => {
    document.getElementById('prof-view').style.display = '';
    document.getElementById('prof-edit-form').style.display = 'none';
  };

  // Enregistrer
  document.getElementById('prof-save-btn').onclick = async () => {
    const newNom      = document.getElementById('edit-nom').value.trim();
    const newPrenom   = document.getElementById('edit-prenom').value.trim();
    const newVille    = document.getElementById('edit-ville').value.trim();
    const newQuartier = document.getElementById('edit-quartier').value.trim();

    if (newNom.length < 2 || newPrenom.length < 2) {
      document.getElementById('prof-save-error').textContent = 'Le nom et le prénom doivent avoir au moins 2 caractères.';
      return;
    }

    const saveBtn = document.getElementById('prof-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = '…';

    try {
      const update = { nom: newNom, prenom: newPrenom, ville: newVille, quartier: newQuartier };
      if (session.telephone) {
        const { error } = await supabase.from('passengers').update(update).eq('telephone', session.telephone);
        if (error) throw error;
      } else if (session.email) {
        const { error } = await supabase.from('passengers').update(update).eq('email', session.email);
        if (error) throw error;
      }

      // Mettre à jour la session locale
      session.nom      = newNom;
      session.prenom   = newPrenom;
      session.ville    = newVille;
      session.quartier = newQuartier;
      localStorage.setItem('pnr_passenger', JSON.stringify(session));

      // Rafraîchir l'affichage
      showProfile(session);
      const nameEl = document.getElementById('dash-user-name');
      if (nameEl) nameEl.textContent = newPrenom;

    } catch (err) {
      document.getElementById('prof-save-error').textContent = 'Erreur lors de la sauvegarde. Réessayez.';
      saveBtn.disabled = false;
      saveBtn.textContent = 'Enregistrer';
    }
  };

  // Déconnexion
  document.getElementById('prof-logout-btn').onclick = async () => {
    await clearSession();
    window.location.href = 'index.html';
  };

  // Bottom nav profil → retour
  document.getElementById('nav-home-prof-btn').onclick = () => {
    document.getElementById('profile-screen').style.display = 'none';
    document.getElementById('passenger-dashboard').style.display = '';
  };
  document.getElementById('nav-map-prof-btn').onclick = () => {
    document.getElementById('profile-screen').style.display = 'none';
    showMap();
  };
}

// ── Dashboard passager ───────────────────────────────────────
function startApp(s) {
  session = s;
  const dashEl = document.getElementById('passenger-dashboard');
  dashEl.style.display = '';

  // Salutation
  document.getElementById('dash-user-name').textContent = session.prenom;

  // Compteur chauffeurs disponibles (chargement initial)
  supabase.from('drivers').select('id').eq('disponible', true)
    .then(({ data }) => {
      const el = document.getElementById('dash-driver-count');
      if (el) el.textContent = data ? data.length : '0';
      const dot = document.getElementById('dash-live-dot');
      if (dot) dot.classList.add('active');
    });

  // Charger avatar_url depuis la DB si pas en session
  if (!session.avatar_url) {
    const col = session.telephone ? 'telephone' : 'email';
    const val = session.telephone || session.email;
    if (val) {
      supabase.from('passengers').select('avatar_url').eq(col, val).single()
        .then(({ data }) => {
          if (data?.avatar_url) {
            session.avatar_url = data.avatar_url;
            localStorage.setItem('pnr_passenger', JSON.stringify(session));
            // Mettre à jour float-avatar + navs maintenant que l'URL est chargée
            const floatEl = document.getElementById('float-avatar');
            if (floatEl) floatEl.innerHTML = `<img src="${sanitizeUrl(data.avatar_url)}" alt="" />`;
            setAllAvatars(session);
            // Mettre à jour le marqueur sur la carte
            if (userMarker) userMarker.setIcon(makeUserIcon(data.avatar_url));
          }
        });
    }
  }

  initUserMenu(session);

  // Navigation depuis le dashboard
  document.getElementById('btn-go-to-map').addEventListener('click', showMap);
  document.getElementById('nav-map-btn-dash').addEventListener('click', showMap);

  // Profil depuis dashboard
  document.getElementById('nav-profile-dash-btn').addEventListener('click', () => showProfile(session));

  // ── Courses en temps réel ────────────────────────────────
  const passengerId = session.telephone || session.email;
  if (passengerId && !isAdminSession(session)) {
    watchActiveRide(passengerId, updateRideBanner);
  }
}

// ── Détection admin ──────────────────────────────────────────
// Vérification via la session admin posée automatiquement au login
// Le numéro admin n'est jamais comparé côté frontend
function isAdminSession(_s) {
  return sessionStorage.getItem('pnr_admin') === 'authenticated';
}

function injectAdminNav() {
  document.querySelectorAll('.bottom-nav').forEach(nav => {
    if (nav.querySelector('.nav-admin-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'bottom-nav-item nav-admin-btn';
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="bottom-nav-svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg><span>Admin</span>`;
    btn.addEventListener('click', () => { window.location.href = 'admin.html'; });
    nav.appendChild(btn);
  });
}

// ── Point d'entrée — Splash puis auth ────────────────────────
const splash = document.getElementById('splash-screen');

setTimeout(() => {
  splash.classList.add('splash-exit');
  setTimeout(() => {
    splash.remove();
    initAuth((session) => {
      startApp(session);
      if (isAdminSession(session)) injectAdminNav();
    });
  }, 500);
}, 2200);
