import * as Location from 'expo-location';

// One foreground fix for course search. Asks for permission if it hasn't been
// asked yet; returns null if denied or if no fix is available.
export async function getOneShotLocation() {
  try {
    let { status } = await Location.getForegroundPermissionsAsync();
    if (status === 'undetermined') {
      ({ status } = await Location.requestForegroundPermissionsAsync());
    }
    if (status !== 'granted') return null;
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const { latitude, longitude } = pos?.coords || {};
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return [latitude, longitude];
  } catch {
    return null;
  }
}

export default getOneShotLocation;
