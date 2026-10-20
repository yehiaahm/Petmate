"use client";

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { LocateFixed, Map as MapIcon, MapPin, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { MapPicker, MapPreview, type ServiceArea } from "./map-picker";
import { useDeviceLocation } from "./use-device-location";

export interface Coords {
  lat: number;
  lng: number;
}

/**
 * Address plus a pin.
 *
 * The address is for the driver; the pin is what distance — and therefore the
 * price and the coverage check — is computed from, on the server. The pin is
 * set on a map, so an owner can pin home from the office and a business can be
 * registered from anywhere; the device's own location is a one-tap shortcut.
 *
 * `area`, when given, draws the provider's coverage on the map. It only helps
 * the owner aim; the server still decides what is in range and what it costs.
 */
export function LocationPin({
  address,
  onAddressChange,
  coords,
  onCoordsChange,
  label = "Your address",
  hint = "Street, building and floor — what the driver needs at the door.",
  error,
  area,
}: {
  address: string;
  onAddressChange: (value: string) => void;
  coords: Coords | null;
  onCoordsChange: (value: Coords | null) => void;
  label?: string;
  hint?: string;
  error?: string | null;
  area?: ServiceArea | null;
}) {
  const { locate, locating, error: locateError } = useDeviceLocation();
  const [picking, setPicking] = useState(false);
  // Stable, because the modal re-runs its focus handling whenever onClose changes.
  const closePicker = useCallback(() => setPicking(false), []);

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

      {coords && (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="group relative block w-full overflow-hidden rounded-[var(--radius-field)] border border-[var(--border)] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          aria-label={`Pinned at ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}. Move the pin on the map.`}
        >
          <MapPreview pin={coords} className="h-36 w-full" />
          <span className="absolute left-2 top-2 rounded-full bg-bg-elevated/90 px-2.5 py-1 text-xs font-semibold text-fg shadow-[var(--shadow-subtle)] transition-colors group-hover:text-brand">
            Move the pin
          </span>
        </button>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setPicking(true)}>
          <MapIcon className="size-4" aria-hidden />
          {coords ? "Change on the map" : "Choose on the map"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => locate(onCoordsChange)}
          loading={locating}
          loadingText="Locating…"
        >
          <LocateFixed className="size-4" aria-hidden />
          {coords ? "Use my current location" : "Pin my current location"}
        </Button>
        {coords && (
          <span className="inline-flex items-center gap-1 text-xs text-[var(--success)]">
            <Check className="size-3.5" aria-hidden />
            Pinned ({coords.lat.toFixed(4)}, {coords.lng.toFixed(4)})
          </span>
        )}
      </div>
      {locateError && <p className="text-xs text-[var(--danger)]">{locateError}</p>}

      {/* Portalled: the forms this sits in can be inside sticky or clipped
          containers, which would trap a fixed-position dialog. */}
      {picking &&
        createPortal(
          <Modal
            open
            onClose={closePicker}
            title="Pin the exact spot"
            description="Tap the map or drag the pin. Zoom in until you can see the building."
            size="lg"
          >
            <PinPicker
              initial={coords}
              area={area}
              onCancel={closePicker}
              onConfirm={(value) => {
                onCoordsChange(value);
                setPicking(false);
              }}
            />
          </Modal>,
          document.body,
        )}
    </div>
  );
}

/**
 * The dialog body. The pin moves freely here and only reaches the form on
 * "Use this spot", so dragging does not fire a re-price on every frame.
 */
function PinPicker({
  initial,
  area,
  onCancel,
  onConfirm,
}: {
  initial: Coords | null;
  area?: ServiceArea | null;
  onCancel: () => void;
  onConfirm: (value: Coords) => void;
}) {
  const [draft, setDraft] = useState<Coords | null>(initial);

  return (
    <div className="space-y-3">
      <MapPicker value={draft} onChange={setDraft} area={area} className="h-[min(55dvh,26rem)]" />
      <p className="text-xs text-fg-muted" aria-live="polite">
        {draft
          ? `Pin at ${draft.lat.toFixed(5)}, ${draft.lng.toFixed(5)}`
          : area
            ? "The dashed circle is the area covered. Tap the map to drop the pin."
            : "Tap the map to drop the pin."}
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" disabled={!draft} onClick={() => draft && onConfirm(draft)}>
          Use this spot
        </Button>
      </div>
    </div>
  );
}
