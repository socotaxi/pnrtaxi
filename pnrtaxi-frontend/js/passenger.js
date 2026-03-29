// ============================================================
//  passenger.js — App Passager PNR Taxi (Supabase)
// ============================================================

import { supabase } from './supabase-config.js';
import { haversineDistance, formatDistance } from './haversine.js';
import { initAuth, clearSession } from './auth.js';

// ── Constantes ──────────────────────────────────────────────
const CENTER          = { lat: -4.7792, lng: 11.8650 };
const ZOOM            = 13;
const ZONE_RADIUS_KM  = 5; // rayon de la zone en km

// ── État global ──────────────────────────────────────────────
let map        = null;
let userLat    = null;
let userLng    = null;
let userMarker = null;
const driverMarkers = new Map(); // id → marker Leaflet
const driversData   = new Map(); // id → données brutes

// ── Carte ────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', { center: [CENTER.lat, CENTER.lng], zoom: ZOOM });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);
}

// ── Géolocalisation passager ─────────────────────────────────
function locateUser() {
  if (!navigator.geolocation) return;
  showToast('📍 Localisation en cours…');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;

      const icon = L.divIcon({
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
        userMarker = L.marker([userLat, userLng], { icon })
          .addTo(map)
          .bindPopup('<b>📍 Vous êtes ici</b>');
      }

      map.flyTo([userLat, userLng], ZOOM, { animate: true, duration: 1 });
      showToast('✅ Position trouvée', 2000);
      refreshMarkers(); // recalcule les marqueurs selon la zone
    },
    () => showToast('⚠️ Position non disponible', 3000),
    { enableHighAccuracy: true, timeout: 10000 }
  );
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
  const { id, lat, lng, disponible } = driver;
  driversData.set(id, driver); // toujours mémoriser les données brutes
  if (!lat || !lng) return;

  const inZone = isInZone(lat, lng);

  // Si le marqueur existe déjà et que la disponibilité n'a pas changé : mise à jour en place
  if (driverMarkers.has(id)) {
    const m = driverMarkers.get(id);
    if (inZone && m._wasAvailable === disponible) {
      m.setLatLng([lat, lng]);
      m.setIcon(makeCarIcon(disponible));
      m._driverData = driver;
      return;
    }
    // Sinon (hors zone ou changement de dispo) : supprimer et recréer
    map.removeLayer(m);
    driverMarkers.delete(id);
  }

  if (!inZone) return;

  // Créer le marqueur — interactif uniquement si disponible
  const m = L.marker([lat, lng], {
    icon: makeCarIcon(disponible),
    interactive: disponible,
  }).addTo(map);
  m._driverData  = driver;
  m._wasAvailable = disponible;

  if (disponible) {
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

// ── Temps réel Supabase ───────────────────────────────────────
async function watchDrivers() {
  const { data, error } = await supabase.from('drivers').select('*');
  if (error) { console.error('Erreur chargement chauffeurs:', error.message); return; }

  data.forEach(d => upsertDriverMarker(d));
  updateCount();

  supabase.channel('drivers-realtime')
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
      if (status === 'SUBSCRIBED') console.log('[Supabase] Temps réel actif ✅');
    });
}

// ── Panneau chauffeur ────────────────────────────────────────
function openDriverPanel(driver) {
  const panel = document.getElementById('driver-panel');
  panel._currentDriverId = driver.id;

  const driverFullName  = [driver.prenom, driver.nom].filter(Boolean).join(' ') || driver.nom || '—';
  const vehiculeDesc    = [driver.marque, driver.modele].filter(Boolean).join(' ') || '—';
  const couleurDesc     = [driver.couleur, driver.type_vehicule === 'moto' ? 'Moto' : driver.type_vehicule === 'car' ? 'Voiture' : null].filter(Boolean).join(' · ') || null;

  document.getElementById('panel-photo').src           = driver.photo || 'https://i.pravatar.cc/150?img=0';
  document.getElementById('panel-name').textContent    = driverFullName;
  document.getElementById('panel-plate').textContent   = driver.immatriculation || '—';
  document.getElementById('panel-vehicle').textContent = vehiculeDesc;

  const colorEl = document.getElementById('panel-color');
  if (colorEl) colorEl.textContent = couleurDesc || '—';

  // Distance
  const distEl = document.getElementById('panel-distance');
  distEl.textContent = (userLat !== null && driver.lat && driver.lng)
    ? formatDistance(haversineDistance(userLat, userLng, driver.lat, driver.lng))
    : '— km';

  // Disponibilité
  const availEl = document.getElementById('panel-availability');
  availEl.textContent = driver.disponible ? '● Disponible' : '● Non disponible';
  availEl.className   = `dp-chip ${driver.disponible ? 'available' : 'unavailable'}`;

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
      <div style="text-align:center;padding:16px;
        background:rgba(255,68,68,0.08);border:1px solid rgba(255,68,68,0.18);
        border-radius:14px;color:var(--red);font-weight:600;font-size:0.9rem;">
        ❌ Ce chauffeur n'est pas disponible
      </div>`;
  }

  panel.classList.add('open');
}

function closeDriverPanel() {
  document.getElementById('driver-panel').classList.remove('open');
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
    avatarEl.innerHTML = `<img src="${session.avatar_url}" alt="${session.prenom}" />`;
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
    watchDrivers();

    document.getElementById('panel-close').addEventListener('click', closeDriverPanel);
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
    el.innerHTML = `<img src="${session.avatar_url}" alt="${initiale}" />`;
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
    el.innerHTML = `<img src="${url}" alt="Avatar" />`;
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
    } catch (err) {
      console.error('Erreur upload avatar:', err);
      setAvatarDisplay(session.avatar_url || null, initiale);
    }
  });

  const telephone = session.telephone || '';
  const email     = session.email || '';

  document.getElementById('info-prenom').textContent = prenom;
  document.getElementById('info-telephone').textContent = telephone || (email ? '—' : '—');

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
    document.getElementById('edit-prenom').value = session.prenom || '';
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
    const newPrenom = document.getElementById('edit-prenom').value.trim();
    if (newPrenom.length < 2) {
      document.getElementById('prof-save-error').textContent = 'Le prénom doit avoir au moins 2 caractères.';
      return;
    }

    const saveBtn = document.getElementById('prof-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = '…';

    try {
      if (session.telephone) {
        const { error } = await supabase.from('passengers').update({ prenom: newPrenom }).eq('telephone', session.telephone);
        if (error) throw error;
      } else if (session.email) {
        const { error } = await supabase.from('passengers').update({ prenom: newPrenom }).eq('email', session.email);
        if (error) throw error;
      }

      // Mettre à jour la session locale
      session.prenom = newPrenom;
      localStorage.setItem('pnr_passenger', JSON.stringify(session));

      // Rafraîchir l'affichage
      showProfile(session);
      // Mettre à jour la salutation dashboard
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
function startApp(session) {
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
            if (floatEl) floatEl.innerHTML = `<img src="${data.avatar_url}" alt="${session.prenom}" />`;
            setAllAvatars(session);
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
}

// ── Point d'entrée — Splash puis auth ────────────────────────
const splash = document.getElementById('splash-screen');

setTimeout(() => {
  splash.classList.add('splash-exit');
  setTimeout(() => {
    splash.remove();
    initAuth((session) => startApp(session));
  }, 500);
}, 2200);
