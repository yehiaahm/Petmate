/**
 * Web Mercator, for the location picker's map.
 *
 * The projection every slippy map uses (OpenStreetMap, Google, Mapbox): at zoom
 * z the world is a square 256 × 2^z pixels wide, and tile (x, y) is the 256 px
 * square whose top-left corner is (256x, 256y). Zoom may be fractional; tiles
 * are fetched at the nearest whole zoom and scaled.
 *
 * Pure and dependency-free so the maths is tested without a DOM, and so it can
 * never pull a server module into the browser.
 *
 * Nothing here prices anything. The server recomputes distance from the
 * coordinates it is sent; this only decides where on screen a coordinate is.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Point {
  x: number;
  y: number;
}

export const TILE_SIZE = 256;
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 19;

/** Mercator stretches to infinity at the poles; every web map stops here. */
const MAX_LAT = 85.05112878;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function clampLat(lat: number): number {
  return Math.min(MAX_LAT, Math.max(-MAX_LAT, lat));
}

/** Longitude folded into [-180, 180), so panning round the world stays valid. */
export function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** Six decimals is ~10 cm, the same precision the device-location button sends. */
export function roundCoords({ lat, lng }: LatLng): LatLng {
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
}

export function worldSize(zoom: number): number {
  return TILE_SIZE * 2 ** zoom;
}

/** Coordinate to world pixel at `zoom`. */
export function project({ lat, lng }: LatLng, zoom: number): Point {
  const size = worldSize(zoom);
  const sin = Math.sin((clampLat(lat) * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

/** World pixel at `zoom` to coordinate. */
export function unproject({ x, y }: Point, zoom: number): LatLng {
  const size = worldSize(zoom);
  const n = Math.PI - (2 * Math.PI * y) / size;
  return {
    lat: clampLat((180 / Math.PI) * Math.atan(Math.sinh(n))),
    lng: wrapLng((x / size) * 360 - 180),
  };
}

/** Ground metres covered by one screen pixel at `lat`. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((clampLat(lat) * Math.PI) / 180)) / worldSize(zoom);
}

/** What the map shows: the coordinate at the middle of a `width` × `height` box. */
export interface View {
  center: LatLng;
  zoom: number;
  width: number;
  height: number;
}

/** Screen point (from the map's top-left corner) to the coordinate under it. */
export function pointToLatLng(point: Point, view: View): LatLng {
  const c = project(view.center, view.zoom);
  return unproject({ x: c.x + point.x - view.width / 2, y: c.y + point.y - view.height / 2 }, view.zoom);
}

/**
 * Coordinate to screen point. Of the world's repeated copies, the one nearest
 * the middle of the view is used, so a pin near the 180th meridian is drawn on
 * the side the user is looking at.
 */
export function latLngToPoint(latLng: LatLng, view: View): Point {
  const c = project(view.center, view.zoom);
  const p = project(latLng, view.zoom);
  const size = worldSize(view.zoom);
  let dx = p.x - c.x;
  dx -= Math.round(dx / size) * size;
  return { x: view.width / 2 + dx, y: view.height / 2 + p.y - c.y };
}

/** The centre that puts `latLng` under screen `point` at the view's zoom. */
export function centerFor(latLng: LatLng, point: Point, view: View): LatLng {
  const a = project(latLng, view.zoom);
  return unproject({ x: a.x - (point.x - view.width / 2), y: a.y - (point.y - view.height / 2) }, view.zoom);
}

/** The centre after zooming to `zoom` while the coordinate under `point` stays put. */
export function zoomAround(view: View, zoom: number, point: Point): LatLng {
  return centerFor(pointToLatLng(point, view), point, { ...view, zoom });
}

/** The centre after dragging the map by (dx, dy) screen pixels. */
export function panBy(view: View, dx: number, dy: number): LatLng {
  const c = project(view.center, view.zoom);
  // Stop at the poles instead of sliding off the top of the world.
  const y = Math.min(worldSize(view.zoom), Math.max(0, c.y - dy));
  return unproject({ x: c.x - dx, y }, view.zoom);
}

/** Largest whole zoom at which a circle of `radiusKm` fills at most `fraction` of the shorter side. */
export function zoomToFit(lat: number, radiusKm: number, width: number, height: number, fraction = 0.85): number {
  const fitPx = Math.max(1, Math.min(width, height) * fraction);
  const metersPerPx = Math.max(1e-6, radiusKm * 2000) / fitPx;
  const zoom = Math.log2(metersPerPixel(lat, 0) / metersPerPx);
  return clampZoom(Math.floor(zoom));
}

export interface TilePlacement {
  key: string;
  z: number;
  /** Tile column, folded into the world. */
  x: number;
  y: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Tiles covering the view, positioned in screen pixels.
 *
 * Fetched at `tileZoom` (by default the nearest whole zoom) and scaled to the
 * view's fractional zoom. Edges are rounded from shared boundaries, so
 * neighbouring tiles always meet exactly and no hairline seam shows between.
 */
export function visibleTiles(view: View, tileZoom = Math.round(clampZoom(view.zoom))): TilePlacement[] {
  const { width, height } = view;
  if (width <= 0 || height <= 0) return [];

  const scale = 2 ** (view.zoom - tileZoom);
  const c = project(view.center, tileZoom);
  const left = c.x - width / 2 / scale;
  const top = c.y - height / 2 / scale;
  const count = 2 ** tileZoom;

  const edgeX = (tx: number) => Math.round((tx * TILE_SIZE - left) * scale);
  const edgeY = (ty: number) => Math.round((ty * TILE_SIZE - top) * scale);

  const tiles: TilePlacement[] = [];
  const firstY = Math.max(0, Math.floor(top / TILE_SIZE));
  const lastY = Math.min(count - 1, Math.floor((top + height / scale) / TILE_SIZE));
  const firstX = Math.floor(left / TILE_SIZE);
  const lastX = Math.floor((left + width / scale) / TILE_SIZE);

  for (let ty = firstY; ty <= lastY; ty++) {
    for (let tx = firstX; tx <= lastX; tx++) {
      tiles.push({
        key: `${tileZoom}/${tx}/${ty}`,
        z: tileZoom,
        x: ((tx % count) + count) % count,
        y: ty,
        left: edgeX(tx),
        top: edgeY(ty),
        width: edgeX(tx + 1) - edgeX(tx),
        height: edgeY(ty + 1) - edgeY(ty),
      });
    }
  }
  return tiles;
}
