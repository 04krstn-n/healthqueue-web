/**
 * Geocoding Service — converts a clinic's address into coordinates using
 * Google's Geocoding API, so the Facility/Super Admin only ever types an
 * address and never has to look up or enter latitude/longitude by hand.
 *
 * Note on Google's terms: lat/lng values from the Geocoding API are meant to
 * be cached temporarily (Google's Maps Platform terms currently allow up to
 * 30 days) and re-resolved after that, while the `place_id` Google returns
 * alongside them may be stored indefinitely. This service returns both —
 * store latitude/longitude for display today, but keep the placeId so the
 * clinic's location can be re-geocoded/refreshed later without re-typing
 * the address, which is what keeps this comfortably within how Google
 * expects the API to be used (results always end up displayed on a Google
 * Map in this app, which is required either way).
 */
const axios = require('axios');
const { GOOGLE_MAPS_API_KEY } = require('../config/config');

/**
 * @param {{ address?: string, city?: string, province?: string }} parts
 * @returns {Promise<{ lat: number, lng: number, placeId: string|null, formattedAddress: string|null } | null>}
 *   Resolves to null (never throws) when the key isn't configured, the
 *   address is empty, or Google can't find a match — callers should treat
 *   that as "couldn't auto-locate this clinic yet," not a hard failure.
 */
async function geocodeAddress({ address, city, province }) {
  const query = [address, city, province, 'Philippines']
    .map((p) => (p || '').trim())
    .filter(Boolean)
    .join(', ');

  if (!query || !GOOGLE_MAPS_API_KEY) return null;

  try {
    const res = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address: query, key: GOOGLE_MAPS_API_KEY, region: 'ph' },
      timeout: 5000,
    });

    const result = res.data?.results?.[0];
    if (res.data?.status !== 'OK' || !result?.geometry?.location) {
      console.warn(`[Geocode] No match for "${query}" (status: ${res.data?.status}).`);
      return null;
    }

    const { lat, lng } = result.geometry.location;
    return {
      lat,
      lng,
      placeId: result.place_id || null,
      formattedAddress: result.formatted_address || null,
    };
  } catch (err) {
    console.warn('[Geocode] Request failed:', err.message);
    return null;
  }
}

module.exports = { geocodeAddress };
