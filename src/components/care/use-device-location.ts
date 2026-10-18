import { useCallback, useState } from "react";
import { roundCoords, type LatLng } from "@/lib/care/map-projection";

/**
 * One-shot read of the device's position, for the "use my location" shortcuts.
 *
 * `locate` takes the callback rather than returning a promise so a component
 * that unmounted mid-request simply never hears back.
 */
export function useDeviceLocation() {
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locate = useCallback((onFound: (coords: LatLng) => void) => {
    if (!("geolocation" in navigator)) {
      setError("This browser cannot share a location.");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onFound(roundCoords({ lat: position.coords.latitude, lng: position.coords.longitude }));
        setLocating(false);
      },
      (err) => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location access was refused. Allow it in the browser, or choose the spot on the map."
            : "We could not get your location. Try again, or choose the spot on the map.",
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }, []);

  return { locate, locating, error };
}
