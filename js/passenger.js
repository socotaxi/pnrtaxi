// ============================================================
//  passenger.js — App Passager Taxi Pointe-Noire (Supabase)
// ============================================================

import { supabase } from './supabase-config.js';
import { haversineDistance, formatDistance } from './haversine.js';

// ── Constantes ──────────────────────────────────────────────
const POINTE_NOIRE = { lat: -4.7792, lng: 11.8650 };
const ZOOM_DEFAULT = 13;

// ── État global ──────────────────────────────────────────────
let map        = null;
let userLat    = null;
let userLng    = null;
let userMarker = null;
const driverMarkers = new Map(); // telephone → marker Leaflet

// ── Initialisation carte ─────────────────────────────────────
function initMap() {
  map = L.map('map', {
    center: [POINTE_NOIRE.lat, POINTE_NOIRE.lng],
    zoom: ZOOM_DEFAULT,
    zoomControl: true,
  });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);

  document.getElementById('loading-overlay').classList.add('hidden');
}

// ── Géolocalisation passager ─────────────────────────────────
function locateUser() {
  if (!navigator.geolocation) return;
  showToast('📍 Localisation en cours…');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;

      const userIcon = L.divIcon({
        className: '',
        html: `<div style="
          width:18px;height:18px;border-radius:50%;
          background:#4a90e2;border:3px solid white;
          box-shadow:0 0 0 4px rgba(74,144,226,0.3);
        "></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });

      if (userMarker) {
        userMarker.setLatLng([userLat, userLng]);
      } else {
        userMarker = L.marker([userLat, userLng], { icon: userIcon })
          .addTo(map)
          .bindPopup('<b>📍 Vous êtes ici</b>');
      }

      map.flyTo([userLat, userLng], ZOOM_DEFAULT, { animate: true, duration: 1 });
      showToast('✅ Position trouvée', 2000);
    },
    () => showToast('⚠️ Position non disponible', 3000),
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ── Icône véhicule ───────────────────────────────────────────
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

// ── Mise à jour marqueur chauffeur ───────────────────────────
function upsertDriverMarker(driver) {
  const { id, lat, lng, disponible } = driver;
  if (!lat || !lng) return;

  const icon = makeCarIcon(disponible);

  if (driverMarkers.has(id)) {
    const marker = driverMarkers.get(id);
    marker.setLatLng([lat, lng]);
    marker.setIcon(icon);
    marker._driverData = driver;
  } else {
    const marker = L.marker([lat, lng], { icon }).addTo(map);
    marker._driverData = driver;
    marker.on('click', () => openDriverPanel(marker._driverData));
    driverMarkers.set(id, marker);
  }
}

function removeDriverMarker(id) {
  if (driverMarkers.has(id)) {
    map.removeLayer(driverMarkers.get(id));
    driverMarkers.delete(id);
  }
}

function updateCount() {
  const count = driverMarkers.size;
  document.getElementById('driver-count').textContent =
    `${count} chauffeur${count > 1 ? 's' : ''}`;
}

// ── Chargement initial + temps réel Supabase ─────────────────
async function watchDrivers() {
  // 1. Chargement initial de tous les chauffeurs
  const { data, error } = await supabase.from('drivers').select('*');

  if (error) {
    console.error('Erreur chargement chauffeurs:', error.message);
    return;
  }

  data.forEach(driver => upsertDriverMarker(driver));
  updateCount();

  // 2. Abonnement temps réel aux modifications
  supabase
    .channel('drivers-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'drivers' },
      (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload;

        if (eventType === 'INSERT' || eventType === 'UPDATE') {
          upsertDriverMarker(newRow);
          // Mettre à jour les données dans le panneau si ouvert
          const panel = document.getElementById('driver-panel');
          if (panel.classList.contains('open') && panel._currentDriverId === newRow.id) {
            openDriverPanel(newRow);
          }
        }

        if (eventType === 'DELETE') {
          removeDriverMarker(oldRow.id);
        }

        updateCount();
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[Supabase] Temps réel actif ✅');
      }
    });
}

// ── Panneau chauffeur ────────────────────────────────────────
function openDriverPanel(driver) {
  const panel = document.getElementById('driver-panel');
  panel._currentDriverId = driver.id;

  document.getElementById('panel-photo').src    = driver.photo || 'https://i.pravatar.cc/150?img=0';
  document.getElementById('panel-photo').alt    = `Photo de ${driver.nom}`;
  document.getElementById('panel-name').textContent    = driver.nom || '—';
  document.getElementById('panel-plate').textContent   = `🚗 ${driver.plaque || '—'}`;
  document.getElementById('panel-vehicle').textContent = driver.vehicule || '—';

  // Distance
  const distEl = document.getElementById('panel-distance');
  if (userLat !== null && driver.lat && driver.lng) {
    const km = haversineDistance(userLat, userLng, driver.lat, driver.lng);
    distEl.textContent = formatDistance(km);
  } else {
    distEl.textContent = 'Position inconnue';
  }

  // Disponibilité
  const availEl = document.getElementById('panel-availability');
  if (driver.disponible) {
    availEl.textContent = '● Disponible';
    availEl.className   = 'availability-badge available';
  } else {
    availEl.textContent = '● Non disponible';
    availEl.className   = 'availability-badge unavailable';
  }

  // CTA
  const ctaEl = document.getElementById('panel-cta');
  if (driver.disponible && driver.telephone) {
    const tel = driver.telephone.replace(/\D/g, '');
    ctaEl.innerHTML = `
      <a class="btn-whatsapp" href="https://wa.me/${tel}" target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
          <path d="M16.002 3C9.375 3 4 8.373 4 15c0 2.385.68 4.61 1.857 6.497L4 29l7.742-1.83A12.94 12.94 0 0016.002 28c6.626 0 12-5.373 12-12S22.628 3 16.002 3zm0 21.6a10.55 10.55 0 01-5.37-1.47l-.385-.229-3.986.942.988-3.875-.25-.4A10.56 10.56 0 015.4 15c0-5.848 4.755-10.6 10.6-10.6S26.6 9.152 26.6 15 21.848 24.6 16.002 24.6zm5.814-7.946c-.318-.16-1.887-.93-2.18-1.037-.294-.107-.508-.16-.721.16-.213.32-.826 1.037-.012 1.25.293.106 1.032.373 1.967.774.938.4 1.574 1.009 1.95 1.25.376.24.08.534-.054.72-.133.186-.373.32-.72.534-.347.213-.508.373-.828.188-.32-.186-1.24-.64-2.36-1.44-.89-.64-1.494-1.44-1.66-1.68-.168-.24-.018-.373.125-.48.128-.093.32-.24.48-.373.16-.133.213-.24.32-.4.107-.16.053-.32-.027-.453-.08-.133-.72-1.733-.986-2.374-.266-.64-.533-.56-.72-.56h-.613c-.213 0-.56.08-.853.373-.294.293-1.12 1.093-1.12 2.668 0 1.573 1.147 3.093 1.307 3.307.16.213 2.24 3.44 5.44 4.826.76.333 1.36.533 1.827.68.76.24 1.454.207 2 .127.614-.094 1.887-.773 2.147-1.52.267-.746.267-1.386.187-1.52-.08-.133-.294-.213-.614-.373z"/>
        </svg>
        📞 Appeler via WhatsApp
      </a>`;
  } else {
    ctaEl.innerHTML = `
      <div style="
        text-align:center;padding:16px;
        background:rgba(255,68,68,0.08);
        border:1px solid rgba(255,68,68,0.2);
        border-radius:12px;color:var(--red);
        font-weight:600;font-size:0.9rem;">
        ❌ Ce chauffeur n'est pas disponible actuellement
      </div>`;
  }

  panel.classList.add('open');
}

function closeDriverPanel() {
  document.getElementById('driver-panel').classList.remove('open');
}

// ── Toast ────────────────────────────────────────────────────
function showToast(msg, duration = 0) {
  const toast = document.getElementById('gps-toast');
  toast.textContent = msg;
  toast.classList.add('show');
  if (duration > 0) setTimeout(() => toast.classList.remove('show'), duration);
}

// ── Événements fermeture panneau ─────────────────────────────
document.getElementById('panel-close').addEventListener('click', closeDriverPanel);
document.getElementById('map').addEventListener('click', closeDriverPanel);

let touchStartY = 0;
const panel = document.getElementById('driver-panel');
panel.addEventListener('touchstart', (e) => { touchStartY = e.touches[0].clientY; }, { passive: true });
panel.addEventListener('touchend', (e) => {
  if (e.changedTouches[0].clientY - touchStartY > 60) closeDriverPanel();
}, { passive: true });

// ── Lancement ────────────────────────────────────────────────
initMap();
locateUser();
watchDrivers();
