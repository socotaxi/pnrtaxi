// ============================================================
//  ratings.js — Système d'évaluation PicknRide
// ============================================================

import { supabase } from './supabase-config.js';

// ── API Supabase ─────────────────────────────────────────────

/**
 * Soumettre une évaluation (upsert : une seule note par rôle par course)
 */
export async function submitRating({ rideId, fromRole, toId, score, comment = '' }) {
  const { error } = await supabase
    .from('ratings')
    .upsert(
      { ride_id: rideId, from_role: fromRole, to_id: toId, score, comment: comment || null },
      { onConflict: 'ride_id,from_role' }
    );
  if (error) throw error;
}

/**
 * Vérifier si une note a déjà été soumise pour cette course / rôle
 */
export async function hasRated(rideId, fromRole) {
  const { data } = await supabase
    .from('ratings')
    .select('id')
    .eq('ride_id', rideId)
    .eq('from_role', fromRole)
    .maybeSingle();
  return !!data;
}

/**
 * Récupérer la note moyenne d'un chauffeur
 */
export async function getDriverRatingInfo(driverId) {
  const { data } = await supabase
    .from('drivers')
    .select('rating_avg, rating_count')
    .eq('id', driverId)
    .maybeSingle();
  return data || { rating_avg: null, rating_count: 0 };
}

/**
 * Récupérer les derniers avis (avec commentaire) laissés pour un chauffeur
 */
export async function getDriverReviews(driverId, limit = 5) {
  const { data } = await supabase
    .from('ratings')
    .select('score, comment, created_at')
    .eq('to_id', driverId)
    .eq('from_role', 'passenger')
    .not('comment', 'is', null)
    .neq('comment', '')
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

// ── Modale d'évaluation (injection unique dans le DOM) ───────

function ensureModal() {
  if (document.getElementById('rating-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id        = 'rating-modal-overlay';
  overlay.className = 'rating-modal-overlay hidden';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  overlay.innerHTML = `
    <div class="rating-modal-card">
      <div class="rating-modal-icon" id="rmt-icon">⭐</div>
      <h3 class="rating-modal-title" id="rmt-title">Notez votre trajet</h3>
      <p  class="rating-modal-sub"   id="rmt-sub"></p>
      <div class="rating-stars" id="rmt-stars" role="group" aria-label="Note de 1 à 5">
        <button class="rating-star" data-v="1" type="button" aria-label="1 étoile">★</button>
        <button class="rating-star" data-v="2" type="button" aria-label="2 étoiles">★</button>
        <button class="rating-star" data-v="3" type="button" aria-label="3 étoiles">★</button>
        <button class="rating-star" data-v="4" type="button" aria-label="4 étoiles">★</button>
        <button class="rating-star" data-v="5" type="button" aria-label="5 étoiles">★</button>
      </div>
      <textarea class="rating-comment-input" id="rmt-comment"
        placeholder="Commentaire optionnel…" rows="2" maxlength="300"></textarea>
      <div class="rating-modal-actions">
        <button class="btn-rating-skip"   id="rmt-skip"   type="button">Passer</button>
        <button class="btn-rating-submit" id="rmt-submit" type="button" disabled>Envoyer</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
}

/**
 * Afficher la modale d'évaluation.
 * @param {object} opts
 * @param {string} opts.title     - Titre affiché dans la modale
 * @param {string} opts.subtitle  - Sous-titre (ex : nom de la personne notée)
 * @param {string} opts.rideId    - UUID de la course
 * @param {string} opts.fromRole  - 'passenger' | 'driver'
 * @param {string} opts.toId      - id du destinataire de la note
 */
export function showRatingModal({ title, subtitle, rideId, fromRole, toId }) {
  ensureModal();

  const overlay   = document.getElementById('rating-modal-overlay');
  const titleEl   = document.getElementById('rmt-title');
  const subEl     = document.getElementById('rmt-sub');
  const commentEl = document.getElementById('rmt-comment');
  const skipBtn   = document.getElementById('rmt-skip');
  const submitBtn = document.getElementById('rmt-submit');

  // Textes
  titleEl.textContent = title    || 'Notez votre trajet';
  subEl.textContent   = subtitle || '';
  commentEl.value     = '';
  submitBtn.disabled  = true;
  submitBtn.textContent = 'Envoyer';

  let selectedScore = 0;

  function close() {
    overlay.classList.add('hidden');
  }

  // Recloner les boutons d'action pour supprimer anciens listeners
  const newSkip   = skipBtn.cloneNode(true);
  const newSubmit = submitBtn.cloneNode(true);
  skipBtn.replaceWith(newSkip);
  submitBtn.replaceWith(newSubmit);

  // Références fraîches après clonage
  const freshSubmit = document.getElementById('rmt-submit');

  // Rafraîchir les étoiles (innerHTML = supprime anciens listeners)
  const starsContainer = document.getElementById('rmt-stars');
  starsContainer.innerHTML = [1, 2, 3, 4, 5].map(v =>
    `<button class="rating-star" data-v="${v}" type="button" aria-label="${v} étoile${v > 1 ? 's' : ''}">★</button>`
  ).join('');

  function paintStars(val) {
    starsContainer.querySelectorAll('.rating-star').forEach(s => {
      s.classList.toggle('active', parseInt(s.dataset.v) <= val);
    });
  }

  // Lier les étoiles APRÈS le clonage pour utiliser freshSubmit
  starsContainer.querySelectorAll('.rating-star').forEach(star => {
    star.addEventListener('mouseenter', () => paintStars(parseInt(star.dataset.v)));
    star.addEventListener('mouseleave', () => paintStars(selectedScore));
    star.addEventListener('click', () => {
      selectedScore = parseInt(star.dataset.v);
      paintStars(selectedScore);
      freshSubmit.disabled = false;
    });
  });

  document.getElementById('rmt-skip').addEventListener('click', close);

  // freshSubmit déjà déclaré ci-dessus
  freshSubmit.addEventListener('click', async () => {
    if (!selectedScore) return;
    freshSubmit.disabled     = true;
    freshSubmit.textContent  = 'Envoi…';
    try {
      await submitRating({
        rideId,
        fromRole,
        toId,
        score:   selectedScore,
        comment: document.getElementById('rmt-comment').value.trim(),
      });
      close();
    } catch (err) {
      console.error('Erreur évaluation:', err);
      freshSubmit.disabled    = false;
      freshSubmit.textContent = 'Envoyer';
    }
  });

  overlay.classList.remove('hidden');
}
