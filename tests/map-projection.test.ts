import { describe, it, expect } from "vitest";
import {
  TILE_SIZE,
  latLngToPoint,
  metersPerPixel,
  panBy,
  pointToLatLng,
  project,
  roundCoords,
  unproject,
  visibleTiles,
  wrapLng,
  zoomAround,
  zoomToFit,
  type View,
} from "@/lib/care/map-projection";

/**
 * The location picker's map maths.
 *
 * A wrong projection does not crash: it puts the pin a street away from where
 * the owner tapped, and the server then prices a trip to the wrong door. So
 * the conversions are pinned against the standard slippy-map tile formula and
 * checked to round-trip.
 */

const cairo = { lat: 30.0444, lng: 31.2357 };
const view = (over: Partial<View> = {}): View => ({ center: cairo, zoom: 15, width: 400, height: 300, ...over });

describe("web mercator projection", () => {
  it("puts the origin in the middle of the world", () => {
    expect(project({ lat: 0, lng: 0 }, 0)).toEqual({ x: 128, y: 128 });
  });

  it("agrees with the standard tile formula", () => {
    // OSM wiki: x = (lng + 180) / 360 · 2^z, y = (1 − asinh(tan φ) / π) / 2 · 2^z
    for (const zoom of [3, 12, 17]) {
      const n = 2 ** zoom;
      const p = project(cairo, zoom);
      expect(Math.floor(p.x / TILE_SIZE)).toBe(Math.floor(((cairo.lng + 180) / 360) * n));
      expect(Math.floor(p.y / TILE_SIZE)).toBe(
        Math.floor(((1 - Math.asinh(Math.tan((cairo.lat * Math.PI) / 180)) / Math.PI) / 2) * n),
      );
    }
    expect(Math.floor(project(cairo, 12).x / TILE_SIZE)).toBe(2403);
    expect(Math.floor(project(cairo, 12).y / TILE_SIZE)).toBe(1689);
  });

  it("round-trips coordinates at every zoom", () => {
    const places = [cairo, { lat: 51.5074, lng: -0.1278 }, { lat: -33.8688, lng: 151.2093 }, { lat: 0, lng: 0 }];
    for (const place of places) {
      for (const zoom of [3, 10.5, 19]) {
        const back = unproject(project(place, zoom), zoom);
        expect(back.lat).toBeCloseTo(place.lat, 9);
        expect(back.lng).toBeCloseTo(place.lng, 9);
      }
    }
  });

  it("wraps longitude into [-180, 180)", () => {
    expect(wrapLng(190)).toBeCloseTo(-170);
    expect(wrapLng(-190)).toBeCloseTo(170);
    expect(wrapLng(180)).toBe(-180);
  });

  it("measures about 4.1 m per pixel at zoom 15 in Cairo", () => {
    expect(metersPerPixel(cairo.lat, 15)).toBeGreaterThan(4.1);
    expect(metersPerPixel(cairo.lat, 15)).toBeLessThan(4.2);
    expect(metersPerPixel(0, 0)).toBeCloseTo(156_543.03, 1);
  });

  it("rounds to six decimals, the precision the API stores", () => {
    expect(roundCoords({ lat: 30.04441234567, lng: 31.23579876543 })).toEqual({ lat: 30.044412, lng: 31.235799 });
  });
});

describe("screen conversions", () => {
  it("maps the middle of the view to its centre", () => {
    const v = view();
    expect(latLngToPoint(cairo, v)).toEqual({ x: 200, y: 150 });
    const mid = pointToLatLng({ x: 200, y: 150 }, v);
    expect(mid.lat).toBeCloseTo(cairo.lat, 9);
    expect(mid.lng).toBeCloseTo(cairo.lng, 9);
  });

  it("round-trips a tapped point", () => {
    const v = view({ zoom: 16.4 });
    const tapped = { x: 37, y: 251 };
    const back = latLngToPoint(pointToLatLng(tapped, v), v);
    expect(back.x).toBeCloseTo(tapped.x, 6);
    expect(back.y).toBeCloseTo(tapped.y, 6);
  });

  it("draws a pin across the 180th meridian on the visible side", () => {
    const v = view({ center: { lat: 0, lng: 179.99 }, zoom: 10 });
    const p = latLngToPoint({ lat: 0, lng: -179.99 }, v);
    expect(p.x).toBeGreaterThan(200);
    expect(p.x).toBeLessThan(220);
  });

  it("keeps the coordinate under the cursor fixed while zooming", () => {
    const v = view();
    const cursor = { x: 320, y: 40 };
    const under = pointToLatLng(cursor, v);
    const zoomed = { ...v, center: zoomAround(v, 17.25, cursor), zoom: 17.25 };
    const after = latLngToPoint(under, zoomed);
    expect(after.x).toBeCloseTo(cursor.x, 6);
    expect(after.y).toBeCloseTo(cursor.y, 6);
  });

  it("moves the map with the finger", () => {
    const v = view();
    const grabbed = pointToLatLng({ x: 100, y: 100 }, v);
    const moved = { ...v, center: panBy(v, 30, -20) };
    const after = latLngToPoint(grabbed, moved);
    expect(after.x).toBeCloseTo(130, 6);
    expect(after.y).toBeCloseTo(80, 6);
  });

  it("does not pan past the poles", () => {
    const v = view({ center: { lat: 85, lng: 0 }, zoom: 3 });
    expect(panBy(v, 0, 5_000).lat).toBeLessThanOrEqual(85.06);
  });
});

describe("tiles", () => {
  it("covers the whole view with no gaps or overlaps", () => {
    for (const zoom of [12, 14.4, 15.6]) {
      const v = view({ zoom, width: 413, height: 297 });
      const tiles = visibleTiles(v);
      const xs = [...new Set(tiles.map((t) => t.left))].sort((a, b) => a - b);
      const ys = [...new Set(tiles.map((t) => t.top))].sort((a, b) => a - b);
      expect(xs[0]).toBeLessThanOrEqual(0);
      expect(ys[0]).toBeLessThanOrEqual(0);

      const row = tiles.filter((t) => t.top === ys[0]).sort((a, b) => a.left - b.left);
      for (let i = 1; i < row.length; i++) expect(row[i]!.left).toBe(row[i - 1]!.left + row[i - 1]!.width);
      const last = row[row.length - 1]!;
      expect(last.left + last.width).toBeGreaterThanOrEqual(v.width);

      const column = tiles.filter((t) => t.left === xs[0]).sort((a, b) => a.top - b.top);
      for (let i = 1; i < column.length; i++) expect(column[i]!.top).toBe(column[i - 1]!.top + column[i - 1]!.height);
      const bottom = column[column.length - 1]!;
      expect(bottom.top + bottom.height).toBeGreaterThanOrEqual(v.height);

      expect(new Set(tiles.map((t) => t.key)).size).toBe(tiles.length);
    }
  });

  it("fetches the nearest whole zoom and folds columns into the world", () => {
    const tiles = visibleTiles(view({ center: { lat: 0, lng: 179.9 }, zoom: 3.4, width: 600 }));
    expect(tiles.every((t) => t.z === 3)).toBe(true);
    expect(tiles.every((t) => t.x >= 0 && t.x < 8)).toBe(true);
    expect(tiles.every((t) => t.y >= 0 && t.y < 8)).toBe(true);
  });

  it("returns nothing before the map has a size", () => {
    expect(visibleTiles(view({ width: 0 }))).toEqual([]);
  });
});

describe("zoom to fit a service area", () => {
  it("fits the circle inside the shorter side", () => {
    const zoom = zoomToFit(cairo.lat, 25, 360, 320);
    const diameterPx = (25_000 * 2) / metersPerPixel(cairo.lat, zoom);
    expect(diameterPx).toBeLessThanOrEqual(320 * 0.85);
    expect((25_000 * 2) / metersPerPixel(cairo.lat, zoom + 1)).toBeGreaterThan(320 * 0.85);
  });

  it("stays within the zoom range for tiny and huge radii", () => {
    expect(zoomToFit(cairo.lat, 0.001, 360, 320)).toBe(19);
    expect(zoomToFit(cairo.lat, 20_000, 360, 320)).toBe(3);
  });
});
