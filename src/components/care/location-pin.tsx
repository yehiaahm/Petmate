"use client";

import { useState } from "react";
import { LocateFixed, MapPin, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export interface Coords {
  lat: number;
  lng: number;
}

/**
 * Address plus a pin.
 *
 * The address is for the driver; the pin is what distance — and therefore the
 * price and the coverage check — is computed from. The pin comes from the
 * device's own location, so it is where the owner actually is, not a guess
 * from a typed street name.
 */
export function LocationPin({
  address,
  onAddressChange,
  coords,
  onCoordsChange,
  label = "Your address",
  hint = "Street, building and floor — what the driver needs at the door.",
  error,
}: {
  address: string;
  onAddressChange: (value: string) => void;
  coords: Coords | null;
  onCoordsChange: (value: Coords | null) => void;
  label?: string;
  hint?: string;
  error?: string | null;
}) {
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  function locate() {
    if (!("geolocation" in navigator)) {
      setLocateError("This browser cannot share a location.");
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onCoordsChange({
          lat: Number(position.coords.latitude.toFixed(6)),
          lng: Number(position.coords.longitude.toFixed(6)),
        });
        setLocating(false);
      },
      (err) => {
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? "Location access was refused. Allow it in the browser to pin your address."
            : "We could not get your location. Try again outdoors or near a window.",
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  return (
    <div className="space-y-3">
      <Field label={label} hint={hint} required error={error}>
        {({ id, invalid, describedBy }) => (
          <Input
            id={id}
            invalid={invalid}
            aria-describedby={describedBy}
            maxLength={300}
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
            autoComplete="street-address"
            leading={<MapPin className="size-4" aria-hidden />}
            placeholder="12 Road 9, Maadi, 3rd floor"
          />
        )}
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={locate} loading={locating} loadingText="Locating…">
          <LocateFixed className="size-4" aria-hidden />
          {coords ? "Update my pin" : "Pin my current location"}
        </Button>
        {coords && (
          <span className="inline-flex items-center gap-1 text-xs text-[var(--success)]">
            <Check className="size-3.5" aria-hidden />
            Pinned ({coords.lat.toFixed(4)}, {coords.lng.toFixed(4)})
          </span>
        )}
      </div>
      {locateError && <p className="text-xs text-[var(--danger)]">{locateError}</p>}
    </div>
  );
}
