// ============================================================
//  driver.js — App Chauffeur Taxi Pointe-Noire (Supabase)
// ============================================================

import { supabase } from './supabase-config.js';
import { updateRideStatus, watchIncomingRides, loadDriverRideHistory } from './rides.js';
import { initPaymentModal, checkDriverAccess } from './payment.js';
import { haversineDistance, formatDistance } from './haversine.js';

const CONTACT_WINDOW_S = 30; // secondes d'indisponibilité après acceptation

// ── Sécurité : sanitize URL pour attributs src ────────────────
function sanitizeUrl(url) {
  if (!url) return '';
  const s = String(url).trim();
  if (s.startsWith('https://') || s.startsWith('blob:')) return s;
  return '';
}

// ── État global ──────────────────────────────────────────────
let currentDriver   = null;
let currentPhone    = null;
let isAvailable     = false;
let driverMap       = null;
let driverMarker    = null;
let watchId         = null;
let lastLat         = null;
let lastLng         = null;
let passengerMarker = null;
let presenceChannel = null;
let configChannel   = null;

// Cache des profils passagers (passenger_id → { prenom, nom, avatar_url })
const passengersCache = new Map();

async function fetchPassengerProfile(passengerId) {
  if (passengersCache.has(passengerId)) return passengersCache.get(passengerId);
  const { data } = await supabase
    .from('passengers')
    .select('prenom, nom, avatar_url')
    .or(`telephone.eq.${passengerId},email.eq.${passengerId}`)
    .maybeSingle();
  const profile = data || {};
  passengersCache.set(passengerId, profile);
  return profile;
}

// ── DOM refs ─────────────────────────────────────────────────
const loginScreen     = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const statusToggle    = document.getElementById('status-toggle');
const toggleIcon      = document.getElementById('toggle-icon');
const toggleLabel     = document.getElementById('toggle-label');
const statusDetail    = document.getElementById('status-detail');
const logoutBtn       = document.getElementById('logout-btn');
const gpsDot          = document.getElementById('gps-dot');
const gpsText         = document.getElementById('gps-text');

// ── Connexion automatique via session ────────────────────────
(async () => {
  const overlay = document.getElementById('loading-overlay');

  try {
    const raw = localStorage.getItem('pnr_driver');
    const session = raw ? JSON.parse(raw) : null;

    if (!session?.telephone) {
      window.location.replace('driver-auth.html');
      return;
    }

    const { data, error } = await supabase
      .from('drivers')
      .select('*')
      .eq('telephone', session.telephone)
      .single();

    if (error || !data) {
      localStorage.removeItem('pnr_driver');
      window.location.replace('driver-auth.html');
      return;
    }

    currentDriver = data;
    currentPhone  = session.telephone;
    isAvailable   = data.disponible ?? false;

    overlay.classList.add('hidden');
    loginScreen.style.display = 'none';
    loadDashboard();

  } catch {
    localStorage.removeItem('pnr_driver');
    window.location.replace('driver-auth.html');
  }
})();

// ── Tableau de bord ──────────────────────────────────────────
async function loadDashboard() {
  const displayName = [currentDriver.prenom, currentDriver.nom].filter(Boolean).join(' ') || currentDriver.nom || '—';
  const vehiculeDesc = [currentDriver.marque, currentDriver.modele].filter(Boolean).join(' ') || '—';

  document.getElementById('dash-photo').src           = currentDriver.photo || 'https://i.pravatar.cc/150?img=0';
  document.getElementById('dash-photo').alt           = `Photo de ${displayName}`;
  document.getElementById('dash-name').textContent    = displayName;
  document.getElementById('dash-plate').textContent   = `${currentDriver.immatriculation || '—'} · ${vehiculeDesc}`;

  renderToggle();
  updateNavAvatars();

  loginScreen.style.display = 'none';
  dashboardScreen.classList.add('active');

  document.getElementById('nav-profile-dash-btn').addEventListener('click', showProfile);

  initDriverMap();
  startGPS();
  startRideWatch();
  initHistorySection();
  joinPresence();

  // Vérification de l'accès et initialisation du modal paiement
  const { openModal, cleanup: cleanupPayment } = await initPaymentModal(currentPhone, supabase, onAccessGranted);
  window._openPayModal   = openModal;
  window._cleanupPayment = cleanupPayment;
  await refreshAccessBadge();

  // Mise à jour immédiate si la config change côté admin (ex: période gratuite)
  // Channel stocké dans une variable globale pour être fermé au logout.
  configChannel = supabase
    .channel('config-changes')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_config' }, () => {
      refreshAccessBadge();
    })
    .subscribe();

  if (isAdminDriver()) injectAdminNavDriver();
}

// ── Détection admin chauffeur ────────────────────────────────
function isAdminDriver() {
  return sessionStorage.getItem('pnr_admin') === 'authenticated';
}

function injectAdminNavDriver() {
  document.querySelectorAll('.bottom-nav').forEach(nav => {
    if (nav.querySelector('.nav-admin-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'bottom-nav-item nav-admin-btn';
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="bottom-nav-svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg><span>Admin</span>`;
    btn.addEventListener('click', () => { window.location.href = 'admin.html'; });
    nav.appendChild(btn);
  });
}

// Callback déclenché quand un paiement en attente est soumis ou accès confirmé
function onAccessGranted() {
  refreshAccessBadge();
}

// Met à jour la carte d'accès dans le dashboard
async function refreshAccessBadge() {
  const access = await checkDriverAccess(currentPhone, supabase);

  // --- badge sous le toggle (petit) ---
  const badge = document.getElementById('access-badge');
  if (badge) badge.style.display = 'none'; // on n'utilise plus le badge, on a la carte

  // --- carte d'accès ---
  const card      = document.getElementById('access-card');
  const cardIcon  = document.getElementById('access-card-icon');
  const cardTitle = document.getElementById('access-card-title');
  const cardSub   = document.getElementById('access-card-sub');
  const cardBadge = document.getElementById('access-card-badge');
  if (!card) return;

  card.style.display = '';

  if (access.status === 'gratuit') {
    const days = Math.ceil((new Date(access.expiration) - new Date()) / 86400000);
    card.className        = 'access-card access-card--free';
    cardIcon.textContent  = '🎁';
    cardTitle.textContent = 'Période d\'essai gratuite';
    cardSub.textContent   = `Expire dans ${days} jour${days > 1 ? 's' : ''}`;
    cardBadge.className   = 'access-card-pill access-card-pill--free';
    cardBadge.textContent = 'Offert';

  } else if (access.status === 'actif') {
    const days = Math.ceil((new Date(access.expiration) - new Date()) / 86400000);
    const type = access.row?.type === 'semaine' ? 'Semaine' : 'Journée';
    card.className        = 'access-card access-card--active';
    cardIcon.textContent  = '✅';
    cardTitle.textContent = `Accès ${type} actif`;
    cardSub.textContent   = `Expire dans ${days} jour${days > 1 ? 's' : ''}`;
    cardBadge.className   = 'access-card-pill access-card-pill--active';
    cardBadge.textContent = 'Actif';

  } else if (access.status === 'en_attente') {
    card.className        = 'access-card access-card--pending';
    cardIcon.textContent  = '⏳';
    cardTitle.textContent = 'Paiement en vérification';
    cardSub.textContent   = 'L\'administrateur va valider votre accès';
    cardBadge.className   = 'access-card-pill access-card-pill--pending';
    cardBadge.textContent = 'En attente';

  } else {
    card.className        = 'access-card access-card--locked';
    cardIcon.textContent  = '🔒';
    cardTitle.textContent = 'Aucun accès actif';
    cardSub.textContent   = 'Choisissez une formule ci-dessous';
    cardBadge.className   = 'access-card-pill access-card-pill--locked';
    cardBadge.textContent = 'Inactif';
  }

}

// ── Toggle ───────────────────────────────────────────────────
function renderToggle() {
  if (isAvailable) {
    statusToggle.className     = 'big-toggle available';
    toggleIcon.textContent     = '✅';
    toggleLabel.textContent    = 'Disponible';
    statusDetail.textContent   = 'Les passagers peuvent vous voir. Appuyez pour arrêter.';
  } else {
    statusToggle.className     = 'big-toggle unavailable';
    toggleIcon.textContent     = '❌';
    toggleLabel.textContent    = 'Non disponible';
    statusDetail.textContent   = 'Appuyez pour vous mettre en service.';
  }
}

statusToggle.addEventListener('click', async () => {
  // Vérifier l'accès avant d'autoriser le toggle
  const access = await checkDriverAccess(currentPhone, supabase);

  if (access.status === 'none' || access.status === 'expire') {
    if (window._openPayModal) window._openPayModal();
    return;
  }

  if (access.status === 'en_attente') {
    document.getElementById('pending-overlay').classList.add('open');
    document.getElementById('pending-overlay').setAttribute('aria-hidden', 'false');
    return;
  }

  // Accès valide → basculer le statut
  const newStatus = !isAvailable;
  statusToggle.disabled = true;

  const { error } = await supabase
    .from('drivers')
    .update({ disponible: newStatus })
    .eq('id', currentPhone);

  if (error) {
    console.error('Erreur mise à jour statut:', error.message);
    alert('Impossible de mettre à jour le statut. Vérifiez le réseau.');
  } else {
    isAvailable = newStatus;
    renderToggle();
  }

  statusToggle.disabled = false;
});

// ── Mini-carte ────────────────────────────────────────────────
function initDriverMap() {
  const startLat = currentDriver.lat || -4.7792;
  const startLng = currentDriver.lng || 11.8650;

  driverMap = L.map('driver-map', {
    center: [startLat, startLng],
    zoom: 15,
    zoomControl: false,
    attributionControl: false,
  });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
  }).addTo(driverMap);

  L.control.zoom({ position: 'bottomright' }).addTo(driverMap);

  driverMarker = L.marker([startLat, startLng], {
    icon: L.divIcon({
      className: '',
      html: `<div style="font-size:2rem;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6))">🚖</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 36],
    })
  }).addTo(driverMap);
}

// ── GPS ───────────────────────────────────────────────────────
function startGPS() {
  if (!navigator.geolocation) {
    gpsText.textContent = 'GPS non disponible sur cet appareil';
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;

      if (driverMap && driverMarker) {
        driverMarker.setLatLng([lat, lng]);
        driverMap.panTo([lat, lng], { animate: true });
      }

      gpsDot.classList.add('active');
      gpsText.textContent = `GPS actif · Précision ±${Math.round(accuracy)}m`;

      // Envoyer à Supabase uniquement si position significativement changée (~11m)
      const moved =
        lastLat === null ||
        Math.abs(lat - lastLat) > 0.0001 ||
        Math.abs(lng - lastLng) > 0.0001;

      if (moved) {
        lastLat = lat;
        lastLng = lng;

        const { error } = await supabase
          .from('drivers')
          .update({ lat, lng, last_seen: new Date().toISOString() })
          .eq('id', currentPhone);

        if (error) {
          console.warn('GPS update error:', error.message);
          gpsText.textContent = `⚠️ Erreur sync · Précision ±${Math.round(accuracy)}m`;
        }
      }
    },
    (err) => {
      console.warn('GPS error:', err.message);
      gpsDot.classList.remove('active');
      const msgs = {
        1: 'Permission GPS refusée — activez la localisation',
        2: 'Signal GPS indisponible — vérifiez votre connexion',
        3: 'GPS trop lent — vérifiez votre réseau',
      };
      gpsText.textContent = msgs[err.code] || 'Impossible d\'obtenir la position GPS';
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );
}

function stopGPS() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

// ── Présence temps réel avec reconnexion auto ─────────────────
var _presenceReconnectTimer = null;

function joinPresence() {
  if (_presenceReconnectTimer) {
    clearTimeout(_presenceReconnectTimer);
    _presenceReconnectTimer = null;
  }

  presenceChannel = supabase.channel('drivers-online');
  presenceChannel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await presenceChannel.track({ driver_id: currentPhone });
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn('[Presence] Connexion perdue, reconnexion dans 5s…');
      await supabase.removeChannel(presenceChannel);
      presenceChannel = null;
      _presenceReconnectTimer = setTimeout(joinPresence, 5000);
    }
  });
}

async function leavePresence() {
  if (_presenceReconnectTimer) {
    clearTimeout(_presenceReconnectTimer);
    _presenceReconnectTimer = null;
  }
  if (presenceChannel) {
    await presenceChannel.untrack();
    await supabase.removeChannel(presenceChannel);
    presenceChannel = null;
  }
}

// ── Profil ────────────────────────────────────────────────────
function setDriverAvatarEl(el, driver) {
  if (!el) return;
  if (driver.photo) {
    el.innerHTML = `<img src="${sanitizeUrl(driver.photo)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit" />`;
  } else {
    el.textContent = ((driver.prenom || driver.nom || '?').charAt(0)).toUpperCase();
  }
}

function updateNavAvatars() {
  ['driver-nav-avatar', 'driver-nav-avatar-prof'].forEach(id => {
    setDriverAvatarEl(document.getElementById(id), currentDriver);
  });
}

async function uploadDriverPhoto(file) {
  const ext      = file.name.split('.').pop();
  const filePath = `drivers/${currentPhone.replace(/\W/g, '_')}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('avatars')
    .upload(filePath, file, { upsert: true, contentType: file.type });

  if (upErr) throw upErr;

  const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
  const url = data.publicUrl;

  await supabase.from('drivers').update({ photo: url }).eq('id', currentPhone);
  return url;
}

function showProfile() {
  document.getElementById('dashboard-screen').classList.remove('active');
  document.getElementById('profile-screen').style.display = '';

  const prenom   = currentDriver.prenom || '—';
  const nom      = currentDriver.nom    || '—';
  const fullName = [prenom, nom].filter(s => s !== '—').join(' ') || '—';
  const initiale = (prenom !== '—' ? prenom : nom !== '—' ? nom : '?').charAt(0).toUpperCase();

  // Avatar
  const avatarEl = document.getElementById('driver-prof-avatar');
  if (currentDriver.photo) {
    avatarEl.innerHTML = `<img src="${sanitizeUrl(currentDriver.photo)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit" />`;
  } else {
    avatarEl.textContent = initiale;
  }

  document.getElementById('driver-prof-name').textContent  = fullName;
  document.getElementById('driver-prof-phone').textContent = currentDriver.telephone || currentPhone || '—';

  const vehiculeDesc = [currentDriver.marque, currentDriver.modele].filter(Boolean).join(' ') || '—';
  const couleurType  = [currentDriver.couleur, currentDriver.type_vehicule === 'moto' ? 'Moto' : currentDriver.type_vehicule === 'car' ? 'Voiture' : null].filter(Boolean).join(' · ') || '—';

  document.getElementById('info-prenom').textContent        = prenom;
  document.getElementById('info-nom').textContent           = nom;
  document.getElementById('info-telephone').textContent     = currentDriver.telephone || currentPhone || '—';
  document.getElementById('info-vehicule').textContent      = vehiculeDesc;
  document.getElementById('info-couleur-type').textContent  = couleurType;
  document.getElementById('info-plaque').textContent        = currentDriver.immatriculation || '—';
  document.getElementById('info-etat').textContent          = currentDriver.etat_vehicule === 'neuf' ? 'Neuf' : currentDriver.etat_vehicule === 'occasion' ? 'Occasion' : '—';

  updateNavAvatars();

  // Mode vue par défaut
  document.getElementById('driver-prof-view').style.display      = '';
  document.getElementById('driver-prof-edit-form').style.display = 'none';

  // Upload photo
  const fileInput    = document.getElementById('driver-avatar-input');
  const newFileInput = fileInput.cloneNode(true);
  fileInput.parentNode.replaceChild(newFileInput, fileInput);

  newFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const preview = URL.createObjectURL(file);
    avatarEl.innerHTML = `<img src="${sanitizeUrl(preview)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit" />`;

    try {
      const url = await uploadDriverPhoto(file);
      currentDriver.photo = url;
      avatarEl.innerHTML = `<img src="${sanitizeUrl(url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit" />`;
      updateNavAvatars();
      // Mettre à jour la photo dans le dashboard
      const dashPhoto = document.getElementById('dash-photo');
      if (dashPhoto) dashPhoto.src = sanitizeUrl(url);
    } catch (err) {
      console.error('Erreur upload photo:', err);
      if (currentDriver.photo) {
        avatarEl.innerHTML = `<img src="${sanitizeUrl(currentDriver.photo)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit" />`;
      } else {
        avatarEl.textContent = initiale;
      }
    }
  });

  // Bouton Modifier
  document.getElementById('driver-prof-edit-btn').onclick = () => {
    document.getElementById('driver-edit-prenom').value = currentDriver.prenom || '';
    document.getElementById('driver-edit-nom').value    = currentDriver.nom    || '';
    document.getElementById('driver-prof-view').style.display      = 'none';
    document.getElementById('driver-prof-edit-form').style.display = '';
    document.getElementById('driver-prof-save-error').textContent  = '';
  };

  // Annuler
  document.getElementById('driver-prof-cancel-btn').onclick = () => {
    document.getElementById('driver-prof-view').style.display      = '';
    document.getElementById('driver-prof-edit-form').style.display = 'none';
  };

  // Enregistrer
  document.getElementById('driver-prof-save-btn').onclick = async () => {
    const newPrenom = document.getElementById('driver-edit-prenom').value.trim();
    const newNom    = document.getElementById('driver-edit-nom').value.trim();

    if (newPrenom.length < 2) {
      document.getElementById('driver-prof-save-error').textContent = 'Le prénom doit avoir au moins 2 caractères.';
      return;
    }
    if (newNom.length < 2) {
      document.getElementById('driver-prof-save-error').textContent = 'Le nom doit avoir au moins 2 caractères.';
      return;
    }

    const saveBtn = document.getElementById('driver-prof-save-btn');
    saveBtn.disabled    = true;
    saveBtn.textContent = '…';

    try {
      const { error } = await supabase
        .from('drivers')
        .update({ prenom: newPrenom, nom: newNom })
        .eq('id', currentPhone);
      if (error) throw error;

      currentDriver.prenom = newPrenom;
      currentDriver.nom    = newNom;

      // Rafraîchir le dashboard
      const updatedName    = [newPrenom, newNom].filter(Boolean).join(' ');
      const updatedVehicle = [currentDriver.marque, currentDriver.modele].filter(Boolean).join(' ') || '—';
      document.getElementById('dash-name').textContent  = updatedName;
      document.getElementById('dash-plate').textContent = `${currentDriver.immatriculation || '—'} · ${updatedVehicle}`;

      showProfile(); // rechargement de la vue profil

    } catch (err) {
      document.getElementById('driver-prof-save-error').textContent = 'Erreur lors de la sauvegarde. Réessayez.';
      saveBtn.disabled    = false;
      saveBtn.textContent = 'Enregistrer';
    }
  };

  // Déconnexion depuis profil
  document.getElementById('driver-prof-logout-btn').onclick = doLogout;

  // Retour au dashboard depuis profil
  document.getElementById('nav-home-prof-btn').onclick = () => {
    document.getElementById('profile-screen').style.display = 'none';
    document.getElementById('dashboard-screen').classList.add('active');
  };
}

// ── Demandes de course ────────────────────────────────────────
const ridesMap       = new Map(); // rideId → statut connu
let   historyPage    = 0;
const HISTORY_PER_PAGE = 3;

async function startRideWatch() {
  watchIncomingRides(currentPhone, onRideEvent);
  const history = await loadDriverRideHistory(currentPhone);
  history.forEach(r => ridesMap.set(r.id, r));
  renderHistory();
}

function showPassengerOnMap(lat, lng) {
  if (!driverMap) return;

  if (passengerMarker) {
    passengerMarker.setLatLng([lat, lng]);
  } else {
    passengerMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="font-size:2rem;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6))">📍</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
      })
    }).addTo(driverMap);
    passengerMarker.bindPopup('Position du passager').openPopup();
  }

  // Adapter la vue pour montrer driver + passager
  if (driverMarker) {
    const bounds = L.latLngBounds([driverMarker.getLatLng(), [lat, lng]]);
    driverMap.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 });
  } else {
    driverMap.setView([lat, lng], 15);
  }
}

function removePassengerMarker() {
  if (passengerMarker) {
    passengerMarker.remove();
    passengerMarker = null;
  }
}

async function onRideEvent(ride) {
  const isNew     = !ridesMap.has(ride.id);
  const isPending = ride.status === 'pending';

  // Pré-charger le profil passager pour l'afficher dans la carte
  if (isPending) await fetchPassengerProfile(ride.passenger_id);

  ridesMap.set(ride.id, ride);
  renderActiveRide();
  renderHistory();

  if (isPending && ride.passenger_lat && ride.passenger_lng) {
    showPassengerOnMap(ride.passenger_lat, ride.passenger_lng);
  } else if (!isPending) {
    const hasPending = [...ridesMap.values()].some(r => r.status === 'pending' && r.passenger_lat && r.passenger_lng);
    if (!hasPending) removePassengerMarker();
  }

  if (isNew && isPending) {
    playRequestBeep();
    vibrateRequest();
  }
}

function playRequestBeep() {
  try {
    const AudioCtx = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    const ctx = new AudioCtx();

    // Deux bips courts successifs
    [0, 0.25].forEach(offset => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type      = 'sine';
      osc.frequency.value = 880; // La5 — ton clair et perçant
      gain.gain.setValueAtTime(0.8, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.18);

      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.18);
    });

    // Fermer le contexte après la fin
    setTimeout(() => ctx.close(), 700);
  } catch (err) {
    console.warn('Audio non disponible:', err);
  }
}

function vibrateRequest() {
  if (!navigator.vibrate) return;
  // Deux pulses : 200ms ON, 100ms OFF, 200ms ON
  navigator.vibrate([200, 100, 200]);
}

// ── Course en cours (pending / accepted) ─────────────────────
function renderActiveRide() {
  const section   = document.getElementById('active-ride-section');
  const container = document.getElementById('active-ride-container');
  const badgeEl   = document.getElementById('active-ride-badge');
  if (!section || !container) return;

  const active = [...ridesMap.values()]
    .filter(r => r.status === 'pending' || r.status === 'accepted')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (active.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  const pendingCount = active.filter(r => r.status === 'pending').length;
  if (badgeEl) {
    badgeEl.textContent    = pendingCount;
    badgeEl.style.display  = pendingCount > 0 ? 'inline-block' : 'none';
  }

  const statusLabel = { pending: 'En attente', accepted: 'Acceptée' };
  const statusIcon  = { pending: '⏳', accepted: '✅' };

  container.innerHTML = active.map(ride => {
    const profile  = passengersCache.get(ride.passenger_id) || {};
    const fullName = [profile.prenom, profile.nom].filter(Boolean).join(' ') || ride.passenger_id;
    const initiale = (profile.prenom || ride.passenger_id || '?').charAt(0).toUpperCase();
    const timeStr  = new Date(ride.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const label    = statusLabel[ride.status] || ride.status;

    // Avatar : photo si disponible, sinon initiale
    const avatarHtml = profile.avatar_url
      ? `<img src="${sanitizeUrl(profile.avatar_url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" onerror="this.parentElement.textContent='${initiale}'" />`
      : initiale;

    // Distance chauffeur ↔ passager
    let distanceHtml = '';
    if (lastLat !== null && lastLng !== null && ride.passenger_lat && ride.passenger_lng) {
      const km  = haversineDistance(lastLat, lastLng, ride.passenger_lat, ride.passenger_lng);
      const str = formatDistance(km);
      distanceHtml = `<span class="ride-card-meta-dot"></span><span>📍 ${str}</span>`;
    }

    const actions = ride.status === 'pending' ? `
      <div class="ride-card-divider"></div>
      <div class="ride-card-actions">
        <button class="btn-accept" data-id="${ride.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Accepter
        </button>
        <button class="btn-reject" data-id="${ride.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          Refuser
        </button>
      </div>` : '';

    // Countdown côté chauffeur pour les courses acceptées
    let countdownHtml = '';
    if (ride.status === 'accepted' && driverCountdownEndAt) {
      const remaining = Math.max(0, Math.ceil((driverCountdownEndAt - Date.now()) / 1000));
      const urgent    = remaining <= 5;
      countdownHtml = `
        <div class="ride-card-countdown${urgent ? ' urgent' : ''}" id="countdown-${ride.id}">
          <span class="rcd-number" id="rcd-num-${ride.id}">${remaining > 0 ? remaining : '✅'}</span>
          <div class="rcd-right">
            <span class="rcd-label">${remaining > 0 ? 'secondes' : 'Terminé'}</span>
            <span class="rcd-desc">${remaining > 0 ? 'Le passager peut vous appeler' : 'Fenêtre de contact écoulée'}</span>
          </div>
        </div>`;
    }

    return `
      <div class="ride-card ${ride.status}" data-ride-id="${ride.id}">
        <div class="ride-card-top"></div>
        <div class="ride-card-body">
          <div class="ride-card-row">
            <div class="ride-card-avatar">${avatarHtml}</div>
            <div class="ride-card-info">
              <div class="ride-card-passenger">${fullName}</div>
              <div class="ride-card-meta">
                <span>${timeStr}</span>
                <span class="ride-card-meta-dot"></span>
                <span>${statusIcon[ride.status] || ''} ${label}</span>
                ${distanceHtml}
              </div>
            </div>
            <span class="ride-card-status ${ride.status}">${label}</span>
          </div>
          ${countdownHtml}
          ${actions}
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.btn-accept').forEach(btn => {
    btn.addEventListener('click', () => handleRideAction(btn.dataset.id, 'accepted'));
  });
  container.querySelectorAll('.btn-reject').forEach(btn => {
    btn.addEventListener('click', () => handleRideAction(btn.dataset.id, 'rejected'));
  });
}

// ── Historique des courses (rejected / cancelled) ─────────────
function renderHistory() {
  const listEl   = document.getElementById('history-list');
  const countEl  = document.getElementById('history-count');
  const pagEl    = document.getElementById('history-pagination');
  const pageInfo = document.getElementById('history-page-info');
  const prevBtn  = document.getElementById('history-prev');
  const nextBtn  = document.getElementById('history-next');
  if (!listEl) return;

  const history = [...ridesMap.values()]
    .filter(r => r.status === 'rejected' || r.status === 'cancelled')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const totalPages = Math.max(1, Math.ceil(history.length / HISTORY_PER_PAGE));
  historyPage      = Math.min(historyPage, totalPages - 1);

  if (countEl) countEl.textContent = history.length > 0 ? String(history.length) : '';

  const clearBtn     = document.getElementById('history-clear-btn');
  const clearConfirm = document.getElementById('history-clear-confirm');

  if (history.length === 0) {
    listEl.innerHTML = `
      <div class="no-rides-msg">
        <div class="no-rides-icon">📋</div>
        <p class="no-rides-text">Aucune course dans l'historique</p>
      </div>`;
    if (pagEl)        pagEl.style.display        = 'none';
    if (clearBtn)     clearBtn.style.display     = 'none';
    if (clearConfirm) clearConfirm.style.display = 'none';
    return;
  }

  if (clearBtn)     clearBtn.style.display     = '';
  if (clearConfirm) clearConfirm.style.display = 'none';

  const page        = history.slice(historyPage * HISTORY_PER_PAGE, (historyPage + 1) * HISTORY_PER_PAGE);
  const statusLabel = { accepted: 'Acceptée', rejected: 'Refusée', cancelled: 'Annulée' };
  const statusIcon  = { accepted: '✅', rejected: '❌', cancelled: '🚫' };

  listEl.innerHTML = page.map(ride => {
    const initiale = (ride.passenger_id || '?').charAt(0).toUpperCase();
    const dateStr  = new Date(ride.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    const timeStr  = new Date(ride.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const label    = statusLabel[ride.status] || ride.status;

    return `
      <div class="ride-card ${ride.status}" data-ride-id="${ride.id}">
        <div class="ride-card-top"></div>
        <div class="ride-card-body">
          <div class="ride-card-row" style="margin-bottom:0">
            <div class="ride-card-avatar">${initiale}</div>
            <div class="ride-card-info">
              <div class="ride-card-passenger">${ride.passenger_id}</div>
              <div class="ride-card-meta">
                <span>${dateStr} ${timeStr}</span>
                <span class="ride-card-meta-dot"></span>
                <span>${statusIcon[ride.status] || ''} ${label}</span>
              </div>
            </div>
            <span class="ride-card-status ${ride.status}">${label}</span>
          </div>
        </div>
      </div>`;
  }).join('');

  if (pagEl) {
    pagEl.style.display = totalPages > 1 ? 'flex' : 'none';
    if (pageInfo) pageInfo.textContent = `${historyPage + 1} / ${totalPages}`;
    if (prevBtn)  prevBtn.disabled     = historyPage === 0;
    if (nextBtn)  nextBtn.disabled     = historyPage >= totalPages - 1;
  }
}

// ── Init section historique (toggle + pagination + effacement) ──
function initHistorySection() {
  const toggle       = document.getElementById('history-toggle');
  const body         = document.getElementById('history-body');
  const clearBtn     = document.getElementById('history-clear-btn');
  const clearConfirm = document.getElementById('history-clear-confirm');
  const clearYes     = document.getElementById('history-clear-yes');
  const clearNo      = document.getElementById('history-clear-no');
  if (!toggle || !body) return;

  toggle.addEventListener('click', () => {
    const isOpen = body.classList.contains('open');
    body.classList.toggle('open', !isOpen);
    toggle.setAttribute('aria-expanded', String(!isOpen));
  });

  document.getElementById('history-prev').addEventListener('click', () => {
    if (historyPage > 0) { historyPage--; renderHistory(); }
  });
  document.getElementById('history-next').addEventListener('click', () => {
    historyPage++;
    renderHistory();
  });

  // Afficher la confirmation inline
  clearBtn?.addEventListener('click', () => {
    clearConfirm.style.display = '';
    clearBtn.style.display     = 'none';
  });

  // Annuler
  clearNo?.addEventListener('click', () => {
    clearConfirm.style.display = 'none';
    clearBtn.style.display     = '';
  });

  // Confirmer l'effacement
  clearYes?.addEventListener('click', async () => {
    clearYes.disabled = true;
    clearYes.textContent = '…';
    await clearHistory();
    clearConfirm.style.display = 'none';
    clearYes.disabled    = false;
    clearYes.textContent = 'Effacer';
  });
}

async function clearHistory() {
  const { error } = await supabase
    .from('rides')
    .delete()
    .eq('driver_id', currentPhone)
    .in('status', ['rejected', 'cancelled']);

  if (error) {
    console.error('Erreur suppression historique:', error.message);
    alert('Impossible d\'effacer l\'historique. Vérifiez votre connexion.');
    return;
  }

  // Nettoyer le cache local
  for (const [id, ride] of ridesMap) {
    if (ride.status === 'rejected' || ride.status === 'cancelled') {
      ridesMap.delete(id);
    }
  }
  historyPage = 0;
  renderHistory();
}

async function handleRideAction(rideId, status) {
  const card = document.querySelector(`[data-ride-id="${rideId}"]`);
  if (card) card.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try {
    await updateRideStatus(rideId, status);
    const ride = ridesMap.get(rideId);
    if (ride) {
      ride.status     = status;
      ride.updated_at = new Date().toISOString();
      ridesMap.set(rideId, ride);
    }

    // À l'acceptation : marquer indisponible immédiatement
    if (status === 'accepted') {
      isAvailable = false;
      await supabase.from('drivers').update({ disponible: false }).eq('id', currentPhone);
      renderToggle();
      startAcceptedCountdown(rideId);
    }

    renderActiveRide();
    renderHistory();
  } catch (err) {
    console.error('Erreur mise à jour course:', err);
    if (card) card.querySelectorAll('button').forEach(b => { b.disabled = false; });
  }
}

let driverCountdownTimer = null;
let driverCountdownEndAt = null; // timestamp absolu de fin (ms)

function startAcceptedCountdown(rideId) {
  if (driverCountdownTimer) { clearInterval(driverCountdownTimer); driverCountdownTimer = null; }

  // On fixe endAt au moment exact de l'acceptation, sans dépendre de ride.updated_at
  driverCountdownEndAt = Date.now() + CONTACT_WINDOW_S * 1000;

  driverCountdownTimer = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((driverCountdownEndAt - Date.now()) / 1000));
    const card      = document.getElementById(`countdown-${rideId}`);
    const numEl     = document.getElementById(`rcd-num-${rideId}`);
    const descEl    = card?.querySelector('.rcd-desc');
    const labelEl   = card?.querySelector('.rcd-label');
    const urgent    = remaining <= 5;

    if (numEl)  numEl.textContent  = remaining > 0 ? remaining : '✅';
    if (labelEl)  labelEl.textContent  = remaining > 0 ? 'secondes' : 'Terminé';
    if (descEl)   descEl.textContent   = remaining > 0 ? 'Le passager peut vous appeler' : 'Fenêtre de contact écoulée';
    if (card)     card.classList.toggle('urgent', urgent && remaining > 0);

    if (remaining === 0) {
      clearInterval(driverCountdownTimer);
      driverCountdownTimer = null;
    }
  }, 1000);
}

// ── Déconnexion ───────────────────────────────────────────────
async function doLogout() {
  // 1. Quitter la présence immédiatement (marqueur rouge côté passager)
  await leavePresence();

  // 2. Nettoyage GPS et carte
  stopGPS();
  if (driverMap) {
    driverMap.remove();
    driverMap    = null;
    driverMarker = null;
  }

  // 3. Fermer les subscriptions Realtime (évite les fuites mémoire)
  if (configChannel) {
    await supabase.removeChannel(configChannel);
    configChannel = null;
  }
  if (window._cleanupPayment) {
    await window._cleanupPayment();
    window._cleanupPayment = null;
  }

  // 4. Mise à jour Supabase en arrière-plan (n'attend pas)
  const phoneToUpdate = currentPhone;
  if (phoneToUpdate) {
    Promise.resolve(
      supabase.from('drivers').update({ disponible: false }).eq('id', phoneToUpdate)
    ).catch(() => {});
  }

  // 5. Effacer la session et rediriger vers la page d'authentification
  localStorage.removeItem('pnr_driver');
  window.location.replace('driver-auth.html');
}

logoutBtn.addEventListener('click', doLogout);

