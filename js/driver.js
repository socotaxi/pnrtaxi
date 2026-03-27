// ============================================================
//  driver.js — App Chauffeur Taxi Pointe-Noire (Supabase)
// ============================================================

import { supabase } from './supabase-config.js';

// ── État global ──────────────────────────────────────────────
let currentDriver = null;
let currentPhone  = null;
let isAvailable   = false;
let driverMap     = null;
let driverMarker  = null;
let watchId       = null;
let lastLat       = null;
let lastLng       = null;

// ── DOM refs ─────────────────────────────────────────────────
const loginScreen     = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const loginForm       = document.getElementById('login-form');
const phoneInput      = document.getElementById('phone-input');
const loginBtn        = document.getElementById('login-btn');
const errorMsg        = document.getElementById('error-msg');
const statusToggle    = document.getElementById('status-toggle');
const toggleIcon      = document.getElementById('toggle-icon');
const toggleLabel     = document.getElementById('toggle-label');
const statusDetail    = document.getElementById('status-detail');
const logoutBtn       = document.getElementById('logout-btn');
const gpsDot          = document.getElementById('gps-dot');
const gpsText         = document.getElementById('gps-text');

document.getElementById('loading-overlay').classList.add('hidden');

// ── Connexion ────────────────────────────────────────────────
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const phone = phoneInput.value.trim().replace(/\s/g, '');
  if (!phone || phone.length < 9) {
    showError('Entrez un numéro valide (ex: 242XXXXXXXXX)');
    return;
  }

  hideError();
  loginBtn.disabled = true;
  loginBtn.textContent = 'Recherche en cours…';

  const { data, error } = await supabase
    .from('drivers')
    .select('*')
    .eq('id', phone)
    .single();

  if (error || !data) {
    showError('❌ Chauffeur non enregistré. Contactez l\'administrateur.');
    loginBtn.disabled = false;
    loginBtn.textContent = 'Se connecter';
    return;
  }

  currentDriver = data;
  currentPhone  = phone;
  isAvailable   = data.disponible ?? false;

  loadDashboard();
});

// ── Tableau de bord ──────────────────────────────────────────
function loadDashboard() {
  document.getElementById('dash-photo').src           = currentDriver.photo || 'https://i.pravatar.cc/150?img=0';
  document.getElementById('dash-photo').alt           = `Photo de ${currentDriver.nom}`;
  document.getElementById('dash-name').textContent    = currentDriver.nom || '—';
  document.getElementById('dash-plate').textContent   = `${currentDriver.plaque || '—'} · ${currentDriver.vehicule || '—'}`;

  renderToggle();

  loginScreen.style.display = 'none';
  dashboardScreen.classList.add('active');

  initDriverMap();
  startGPS();
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

      // Envoyer à Supabase uniquement si position significativement changée
      const moved =
        lastLat === null ||
        Math.abs(lat - lastLat) > 0.00005 ||
        Math.abs(lng - lastLng) > 0.00005;

      if (moved) {
        lastLat = lat;
        lastLng = lng;

        const { error } = await supabase
          .from('drivers')
          .update({ lat, lng, last_seen: new Date().toISOString() })
          .eq('id', currentPhone);

        if (error) console.warn('GPS update error:', error.message);
      }
    },
    (err) => {
      console.warn('GPS error:', err.message);
      gpsDot.classList.remove('active');
      gpsText.textContent = 'Impossible d\'obtenir la position GPS';
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  );
}

function stopGPS() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

// ── Déconnexion ───────────────────────────────────────────────
logoutBtn.addEventListener('click', async () => {
  if (!confirm('Voulez-vous vous déconnecter ?')) return;

  // Passer hors service
  await supabase
    .from('drivers')
    .update({ disponible: false })
    .eq('id', currentPhone)
    .catch(() => {});

  stopGPS();

  if (driverMap) {
    driverMap.remove();
    driverMap = null;
    driverMarker = null;
  }

  currentDriver = null;
  currentPhone  = null;
  isAvailable   = false;
  lastLat = null;
  lastLng = null;

  dashboardScreen.classList.remove('active');
  loginScreen.style.display = '';
  phoneInput.value = '';
  loginBtn.disabled = false;
  loginBtn.textContent = 'Se connecter';
  gpsDot.classList.remove('active');
  gpsText.textContent = 'En attente du GPS…';
});

// ── Helpers ───────────────────────────────────────────────────
function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.add('show');
}
function hideError() {
  errorMsg.classList.remove('show');
}
phoneInput.addEventListener('input', hideError);
