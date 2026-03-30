// ============================================================
//  driver.js — App Chauffeur Taxi Pointe-Noire (Supabase)
// ============================================================

import { supabase } from './supabase-config.js';
import { updateRideStatus, watchIncomingRides, loadDriverRideHistory } from './rides.js';

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
function loadDashboard() {
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

// ── Présence temps réel ───────────────────────────────────────
function joinPresence() {
  presenceChannel = supabase.channel('drivers-online');
  presenceChannel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await presenceChannel.track({ driver_id: currentPhone });
    }
  });
}

async function leavePresence() {
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
    el.innerHTML = `<img src="${driver.photo}" alt="${driver.prenom || ''}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit" />`;
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
    avatarEl.innerHTML = `<img src="${currentDriver.photo}" alt="${fullName}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit" />`;
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
    avatarEl.innerHTML = `<img src="${preview}" alt="Aperçu" style="width:100%;height:100%;object-fit:cover;border-radius:inherit" />`;

    try {
      const url = await uploadDriverPhoto(file);
      currentDriver.photo = url;
      avatarEl.innerHTML = `<img src="${url}" alt="${fullName}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit" />`;
      updateNavAvatars();
      // Mettre à jour la photo dans le dashboard
      const dashPhoto = document.getElementById('dash-photo');
      if (dashPhoto) dashPhoto.src = url;
    } catch (err) {
      console.error('Erreur upload photo:', err);
      if (currentDriver.photo) {
        avatarEl.innerHTML = `<img src="${currentDriver.photo}" alt="${fullName}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit" />`;
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

function onRideEvent(ride) {
  const isNew     = !ridesMap.has(ride.id);
  const isPending = ride.status === 'pending';

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
    const initiale = (ride.passenger_id || '?').charAt(0).toUpperCase();
    const timeStr  = new Date(ride.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const label    = statusLabel[ride.status] || ride.status;

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

    return `
      <div class="ride-card ${ride.status}" data-ride-id="${ride.id}">
        <div class="ride-card-top"></div>
        <div class="ride-card-body">
          <div class="ride-card-row">
            <div class="ride-card-avatar">${initiale}</div>
            <div class="ride-card-info">
              <div class="ride-card-passenger">${ride.passenger_id}</div>
              <div class="ride-card-meta">
                <span>${timeStr}</span>
                <span class="ride-card-meta-dot"></span>
                <span>${statusIcon[ride.status] || ''} ${label}</span>
              </div>
            </div>
            <span class="ride-card-status ${ride.status}">${label}</span>
          </div>
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

  if (history.length === 0) {
    listEl.innerHTML = `
      <div class="no-rides-msg">
        <div class="no-rides-icon">📋</div>
        <p class="no-rides-text">Aucune course dans l'historique</p>
      </div>`;
    if (pagEl) pagEl.style.display = 'none';
    return;
  }

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

// ── Init section historique (toggle + pagination) ─────────────
function initHistorySection() {
  const toggle = document.getElementById('history-toggle');
  const body   = document.getElementById('history-body');
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
}

async function handleRideAction(rideId, status) {
  const card = document.querySelector(`[data-ride-id="${rideId}"]`);
  if (card) card.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try {
    await updateRideStatus(rideId, status);
    const ride = ridesMap.get(rideId);
    if (ride) {
      ride.status = status;
      ridesMap.set(rideId, ride);
    }
    renderActiveRide();
    renderHistory();
  } catch (err) {
    console.error('Erreur mise à jour course:', err);
    if (card) card.querySelectorAll('button').forEach(b => { b.disabled = false; });
  }
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

  // 2. Mise à jour Supabase en arrière-plan (n'attend pas)
  const phoneToUpdate = currentPhone;
  if (phoneToUpdate) {
    Promise.resolve(
      supabase.from('drivers').update({ disponible: false }).eq('id', phoneToUpdate)
    ).catch(() => {});
  }

  // 3. Effacer la session et rediriger vers la page d'authentification
  localStorage.removeItem('pnr_driver');
  window.location.replace('driver-auth.html');
}

logoutBtn.addEventListener('click', doLogout);

