"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { LocateFixed, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  centerFor,
  clampZoom,
  latLngToPoint,
  metersPerPixel,
  panBy,
  pointToLatLng,
  roundCoords,
  visibleTiles,
  zoomAround,
  zoomToFit,
  type LatLng,
  type Point,
  type View,
} from "@/lib/care/map-projection";
import { useDeviceLocation } from "./use-device-location";

/**
 * Map tiles: any XYZ raster source served over https.
 *
 * Tiles are plain images, which the page CSP already allows (`img-src https:`),
 * so the map needs no CSP change and no map library. Nothing here calls an API
 * from the browser.
 *
 * The OpenStreetMap default suits development and light use. Its tile usage
 * policy rules out heavy production traffic, so production should point this
 * at a commercial provider or its own tile server. Whatever the source, it
 * sees which area the visitor is looking at, as any embedded map does.
 */
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION || "© OpenStreetMap contributors";

function tileUrl(z: number, x: number, y: number): string {
  return TILE_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

/** Used only when there is neither a pin nor a service area to start from. */
const FALLBACK_CENTER: LatLng = { lat: 30.0444, lng: 31.2357 };
const FALLBACK_ZOOM = 11;
/** Close enough to tell one building from the next. */
const PIN_ZOOM = 17;
/** How far a press may wander and still count as a tap rather than a drag. */
const TAP_SLOP_PX = 6;

/** The circle a provider covers: shown for orientation, never used to price. */
export interface ServiceArea {
  lat: number;
  lng: number;
  radiusKm: number;
}

function useElementSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** The pin's tip sits exactly on the coordinate; the box around it is the touch target. */
const PIN_BOX = { width: 44, height: 52, tipX: 22, tipY: 51 };

function MapLayers({
  view,
  backdropZoom,
  pin,
  area,
}: {
  view: View;
  backdropZoom: number | null;
  pin: LatLng | null;
  area?: ServiceArea | null;
}) {
  const tiles = visibleTiles(view);
  // While the tiles of a new zoom level load, the level just left stays
  // underneath them (scaled), so zooming never flashes an empty grid.
  const backdrop =
    backdropZoom != null && tiles[0] && Math.abs(backdropZoom - tiles[0].z) === 1
      ? visibleTiles(view, backdropZoom)
      : [];

  const pinAt = pin ? latLngToPoint(pin, view) : null;
  const areaAt = area ? latLngToPoint(area, view) : null;
  const areaRadius = area ? (area.radiusKm * 1000) / metersPerPixel(area.lat, view.zoom) : 0;

  return (
    <>
      {[...backdrop, ...tiles].map((tile) => (
        // eslint-disable-next-line @next/next/no-img-element -- map tiles: next/image would route every 256 px tile through the optimiser for nothing
        <img
          key={tile.key}
          src={tileUrl(tile.z, tile.x, tile.y)}
          alt=""
          draggable={false}
          decoding="async"
          className="pointer-events-none absolute max-w-none select-none"
          style={{ left: tile.left, top: tile.top, width: tile.width, height: tile.height }}
        />
      ))}

      {areaAt && view.width > 0 && (
        <svg className="pointer-events-none absolute inset-0" width={view.width} height={view.height} aria-hidden>
          {/* A white halo under the dashed line keeps it readable on any tile colour. */}
          <circle cx={areaAt.x} cy={areaAt.y} r={areaRadius} fill="var(--brand)" fillOpacity={0.1} stroke="white" strokeOpacity={0.85} strokeWidth={5} />
          <circle
            cx={areaAt.x}
            cy={areaAt.y}
            r={areaRadius}
            fill="none"
            stroke="var(--brand)"
            strokeWidth={2.5}
            strokeDasharray="8 6"
          />
          <circle cx={areaAt.x} cy={areaAt.y} r={6} fill="var(--brand)" stroke="white" strokeWidth={2} />
        </svg>
      )}

      {pinAt && (
        <>
          <span
            className="pointer-events-none absolute h-1.5 w-3 rounded-full bg-black/35 blur-[1px]"
            style={{ left: pinAt.x - 6, top: pinAt.y - 3 }}
            aria-hidden
          />
          <div
            data-map-pin
            className="absolute cursor-grab active:cursor-grabbing"
            style={{
              left: pinAt.x - PIN_BOX.tipX,
              top: pinAt.y - PIN_BOX.tipY,
              width: PIN_BOX.width,
              height: PIN_BOX.height,
            }}
          >
            <svg
              width="34"
              height="44"
              viewBox="0 0 34 44"
              className="absolute bottom-[1px] left-[5px] drop-shadow-[0_2px_3px_rgb(0_0_0/0.35)]"
              aria-hidden
            >
              <path
                d="M17 43C17 43 2.5 27.6 2.5 16.5a14.5 14.5 0 0 1 29 0C31.5 27.6 17 43 17 43Z"
                fill="var(--brand)"
                stroke="white"
                strokeWidth="2"
              />
              <circle cx="17" cy="16.5" r="5.5" fill="white" />
            </svg>
          </div>
        </>
      )}
    </>
  );
}

function Attribution({ link }: { link: boolean }) {
  const className =
    "absolute bottom-0 right-0 rounded-tl-md bg-bg-elevated/85 px-1.5 py-0.5 text-[10px] leading-tight text-fg-muted";
  return link ? (
    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className={cn(className, "hover:text-fg")}>
      {ATTRIBUTION}
    </a>
  ) : (
    <span className={className}>{ATTRIBUTION}</span>
  );
}

/** A still map centred on a pin, for showing what was chosen. Not interactive. */
export function MapPreview({ pin, className }: { pin: LatLng; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useElementSize(ref);
  const view: View = { center: pin, zoom: 15, ...size };

  return (
    <div ref={ref} className={cn("relative overflow-hidden bg-bg-sunken", className)}>
      <MapLayers view={view} backdropZoom={null} pin={pin} />
      <Attribution link={false} />
    </div>
  );
}

interface Camera {
  center: LatLng;
  zoom: number;
  /** The tile zoom shown underneath while the current level loads. */
  backdrop: number | null;
}

interface Gesture {
  pointers: Map<number, Point>;
  mode: "idle" | "pan" | "pin" | "pinch";
  start: Point;
  last: Point;
  moved: boolean;
  /** Offset from the finger to the pin's tip, so grabbing the pin does not make it jump. */
  grab: Point;
  pinch: { distance: number; zoom: number; anchor: LatLng } | null;
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function initialCamera(value: LatLng | null, area: ServiceArea | null | undefined): Camera {
  if (value) return { center: value, zoom: PIN_ZOOM, backdrop: null };
  // The picker's size is not known before it mounts; this is close to it on
  // phones and desktops alike, and only decides the opening zoom.
  if (area) return { center: area, zoom: zoomToFit(area.lat, area.radiusKm, 360, 320), backdrop: null };
  return { center: FALLBACK_CENTER, zoom: FALLBACK_ZOOM, backdrop: null };
}

/**
 * Interactive map for choosing a point.
 *
 * Tap or click to drop the pin, drag the pin to move it, drag the map to look
 * around; pinch, scroll or the buttons zoom. From the keyboard, the arrows move
 * the map and Enter drops the pin in the middle. Pointer Events cover mouse,
 * touch and pen with one code path.
 */
export function MapPicker({
  value,
  onChange,
  area,
  className,
}: {
  value: LatLng | null;
  onChange: (value: LatLng) => void;
  area?: ServiceArea | null;
  className?: string;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(surfaceRef);
  const [camera, setCameraState] = useState(() => initialCamera(value, area));
  // Gesture handlers run between renders, so they read the camera from here.
  const cameraRef = useRef(camera);
  const gesture = useRef<Gesture>({
    pointers: new Map(),
    mode: "idle",
    start: { x: 0, y: 0 },
    last: { x: 0, y: 0 },
    moved: false,
    grab: { x: 0, y: 0 },
    pinch: null,
  });
  const { locate, locating, error: locateError } = useDeviceLocation();
  const instructionsId = useId();

  const setCamera = useCallback((center: LatLng, zoom: number) => {
    const prev = cameraRef.current;
    const prevTiles = Math.round(prev.zoom);
    const nextTiles = Math.round(zoom);
    const next = { center, zoom, backdrop: prevTiles !== nextTiles ? prevTiles : prev.backdrop };
    cameraRef.current = next;
    setCameraState(next);
  }, []);

  const currentView = useCallback((): View => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    return { ...cameraRef.current, width: rect?.width ?? 0, height: rect?.height ?? 0 };
  }, []);

  const localPoint = useCallback((event: { clientX: number; clientY: number }): Point => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }, []);

  const zoomTo = useCallback(
    (zoom: number, point?: Point) => {
      const view = currentView();
      const next = clampZoom(zoom);
      setCamera(zoomAround(view, next, point ?? { x: view.width / 2, y: view.height / 2 }), next);
    },
    [currentView, setCamera],
  );

  // React registers wheel listeners as passive, so preventDefault — needed to
  // stop the dialog scrolling while the map zooms — requires a native one.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      // A trackpad pinch arrives as a wheel event with ctrlKey set and small deltas.
      const pxPerLevel = event.ctrlKey ? 60 : 180;
      zoomTo(cameraRef.current.zoom - (event.deltaY * unit) / pxPerLevel, localPoint(event));
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo, localPoint]);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const g = gesture.current;
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = localPoint(event);
    g.pointers.set(event.pointerId, p);

    if (g.pointers.size === 1) {
      const onPin = value != null && (event.target as Element).closest("[data-map-pin]") != null;
      g.mode = onPin ? "pin" : "pan";
      g.start = p;
      g.last = p;
      g.moved = false;
      if (onPin && value) {
        const tip = latLngToPoint(value, currentView());
        g.grab = { x: tip.x - p.x, y: tip.y - p.y };
      }
    } else if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()] as [Point, Point];
      g.mode = "pinch";
      g.moved = true;
      g.pinch = {
        distance: Math.max(1, distance(a, b)),
        zoom: cameraRef.current.zoom,
        anchor: pointToLatLng(midpoint(a, b), currentView()),
      };
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g.pointers.has(event.pointerId)) return;
    const p = localPoint(event);
    g.pointers.set(event.pointerId, p);

    if (g.mode === "pinch" && g.pinch && g.pointers.size >= 2) {
      const [a, b] = [...g.pointers.values()] as [Point, Point];
      const zoom = clampZoom(g.pinch.zoom + Math.log2(distance(a, b) / g.pinch.distance));
      setCamera(centerFor(g.pinch.anchor, midpoint(a, b), { ...currentView(), zoom }), zoom);
      return;
    }

    if (!g.moved) {
      if (distance(p, g.start) < TAP_SLOP_PX) return;
      g.moved = true;
    }

    if (g.mode === "pan") {
      const view = currentView();
      setCamera(panBy(view, p.x - g.last.x, p.y - g.last.y), view.zoom);
    } else if (g.mode === "pin") {
      onChange(roundCoords(pointToLatLng({ x: p.x + g.grab.x, y: p.y + g.grab.y }, currentView())));
    }
    g.last = p;
  }

  function onPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g.pointers.has(event.pointerId)) return;
    g.pointers.delete(event.pointerId);

    if (event.type === "pointerup" && g.mode === "pan" && !g.moved) {
      onChange(roundCoords(pointToLatLng(localPoint(event), currentView())));
    }

    const [rest] = [...g.pointers.values()];
    if (rest) {
      // One finger lifted mid-pinch: keep panning with the other, and never
      // treat the lift as a tap.
      g.mode = "pan";
      g.moved = true;
      g.start = rest;
      g.last = rest;
      g.pinch = null;
    } else {
      g.mode = "idle";
      g.pinch = null;
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 200 : 60;
    const view = currentView();
    switch (event.key) {
      case "ArrowLeft":
        setCamera(panBy(view, step, 0), view.zoom);
        break;
      case "ArrowRight":
        setCamera(panBy(view, -step, 0), view.zoom);
        break;
      case "ArrowUp":
        setCamera(panBy(view, 0, step), view.zoom);
        break;
      case "ArrowDown":
        setCamera(panBy(view, 0, -step), view.zoom);
        break;
      case "+":
      case "=":
        zoomTo(Math.round(view.zoom) + 1);
        break;
      case "-":
      case "_":
        zoomTo(Math.round(view.zoom) - 1);
        break;
      case "Enter":
      case " ":
        onChange(roundCoords(view.center));
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function locateMe() {
    locate((coords) => {
      onChange(coords);
      setCamera(coords, Math.max(PIN_ZOOM, cameraRef.current.zoom));
    });
  }

  const view: View = { ...camera, ...size };
  const controlClass =
    "grid size-10 place-items-center rounded-full border border-[var(--border)] bg-bg-elevated text-fg shadow-[var(--shadow-subtle)] transition-colors hover:text-brand disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]";

  return (
    <div className="space-y-1.5">
      <div className={cn("relative overflow-hidden rounded-[var(--radius-field)] border border-[var(--border)] bg-bg-sunken", className)}>
        <div
          ref={surfaceRef}
          role="application"
          aria-roledescription="map"
          aria-label="Map"
          aria-describedby={instructionsId}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onDoubleClick={(event) => zoomTo(Math.round(cameraRef.current.zoom) + 1, localPoint(event))}
          onKeyDown={onKeyDown}
          className="group absolute inset-0 cursor-crosshair touch-none select-none overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          <MapLayers view={view} backdropZoom={camera.backdrop} pin={value} area={area} />
          {/* Where Enter drops the pin, shown only to keyboard users. */}
          <span
            className="pointer-events-none absolute left-1/2 top-1/2 hidden size-6 -translate-x-1/2 -translate-y-1/2 group-focus-visible:block"
            aria-hidden
          >
            <span className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-fg/70" />
            <span className="absolute left-0 top-1/2 h-0.5 w-full -translate-y-1/2 bg-fg/70" />
          </span>
        </div>

        <div className="absolute right-2 top-2 flex flex-col gap-1.5">
          <button
            type="button"
            className={controlClass}
            onClick={() => zoomTo(Math.round(camera.zoom) + 1)}
            disabled={camera.zoom >= MAX_ZOOM}
            aria-label="Zoom in"
          >
            <Plus className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className={controlClass}
            onClick={() => zoomTo(Math.round(camera.zoom) - 1)}
            disabled={camera.zoom <= MIN_ZOOM}
            aria-label="Zoom out"
          >
            <Minus className="size-4" aria-hidden />
          </button>
        </div>
        <button
          type="button"
          className={cn(controlClass, "absolute bottom-6 right-2")}
          onClick={locateMe}
          disabled={locating}
          aria-label={locating ? "Finding your location…" : "Go to my current location"}
        >
          <LocateFixed className={cn("size-4", locating && "animate-pulse")} aria-hidden />
        </button>
        <Attribution link />
      </div>

      <p id={instructionsId} className="sr-only">
        Tap or click to drop the pin, or drag it. Drag the map to move around; pinch, scroll or use the buttons to
        zoom. With a keyboard, the arrow keys move the map, plus and minus zoom, and Enter drops the pin in the middle.
      </p>
      {locateError && <p className="text-xs text-[var(--danger)]">{locateError}</p>}
    </div>
  );
}
