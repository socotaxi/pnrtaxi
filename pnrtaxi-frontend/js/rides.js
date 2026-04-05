// ============================================================
//  rides.js — Gestion des courses (demande / acceptation / refus)
// ============================================================

import { supabase } from './supabase-config.js';

/**
 * Créer une demande de course (statut = pending)
 */
export async function requestRide({ passengerId, driverId, passengerLat, passengerLng }) {
  const { data, error } = await supabase
    .from('rides')
    .insert({
      passenger_id:  passengerId,
      driver_id:     driverId,
      status:        'pending',
      passenger_lat: passengerLat ?? null,
      passenger_lng: passengerLng ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Mettre à jour le statut d'une course
 * @param {string} rideId
 * @param {'accepted'|'rejected'|'cancelled'} status
 */
export async function updateRideStatus(rideId, status) {
  const { error } = await supabase
    .from('rides')
    .update({ status })
    .eq('id', rideId);

  if (error) throw error;
}

/**
 * Écouter les mises à jour de la course active d'un passager (pending ou accepted)
 * Appelle callback(ride) à chaque changement.
 * @returns {object} canal Supabase (appeler .unsubscribe() pour arrêter)
 */
export function watchActiveRide(passengerId, callback) {
  // Charger la course active existante
  supabase
    .from('rides')
    .select('*, drivers(*)')
    .eq('passenger_id', passengerId)
    .in('status', ['pending', 'accepted'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
    .then(({ data }) => { if (data) callback(data); });

  // Écouter les changements en temps réel
  const channel = supabase
    .channel(`ride-passenger-${passengerId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'rides', filter: `passenger_id=eq.${passengerId}` },
      async ({ new: ride }) => {
        if (!ride) return;
        // Tenter d'enrichir avec les données du chauffeur, mais toujours appeler le callback
        const { data } = await supabase
          .from('rides')
          .select('*, drivers(*)')
          .eq('id', ride.id)
          .maybeSingle();
        callback(data ?? ride); // fallback sur les données realtime si le SELECT échoue
      }
    )
    .subscribe();

  return channel;
}

/**
 * Charger l'historique des courses d'un chauffeur (rejected + cancelled)
 */
export async function loadDriverRideHistory(driverId, limit = 50) {
  const { data } = await supabase
    .from('rides')
    .select('*')
    .eq('driver_id', driverId)
    .in('status', ['rejected', 'cancelled'])
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

/**
 * Écouter les demandes de course entrant pour un chauffeur
 * Appelle callback(ride) à chaque INSERT ou UPDATE.
 * @returns {object} canal Supabase
 */
export function watchIncomingRides(driverId, callback) {
  // Charger les demandes pending existantes
  supabase
    .from('rides')
    .select('*')
    .eq('driver_id', driverId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .then(({ data }) => { if (data) data.forEach(callback); });

  const channel = supabase
    .channel(`ride-driver-${driverId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'rides', filter: `driver_id=eq.${driverId}` },
      ({ new: ride }) => { if (ride) callback(ride); }
    )
    .subscribe();

  return channel;
}
