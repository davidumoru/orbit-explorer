import {
  propagate,
  gstime,
  eciToEcf,
  ecfToLookAngles,
  degreesToRadians,
  radiansToDegrees,
  type SatRec,
} from "satellite.js";

export type Observer = { lat: number; lon: number };

export type Pass = {
  aosMs: number;
  losMs: number;
  maxElevationDeg: number;
  aosAzimuthDeg: number;
};

const STEP_MS = 30_000;
export const PASS_WINDOW_HOURS = 24;

export function predictPasses(
  satrec: SatRec,
  observer: Observer,
  startMs: number,
  maxPasses = 6,
): Pass[] {
  const observerGd = {
    latitude: degreesToRadians(observer.lat),
    longitude: degreesToRadians(observer.lon),
    height: 0,
  };
  const endMs = startMs + PASS_WINDOW_HOURS * 3_600_000;
  const passes: Pass[] = [];
  let current: Pass | null = null;

  for (let t = startMs; t <= endMs; t += STEP_MS) {
    const date = new Date(t);
    const pv = propagate(satrec, date);
    if (!pv) continue;
    const look = ecfToLookAngles(
      observerGd,
      eciToEcf(pv.position, gstime(date)),
    );
    const elevation = radiansToDegrees(look.elevation);

    if (elevation > 0) {
      if (!current) {
        current = {
          aosMs: t,
          losMs: t,
          maxElevationDeg: elevation,
          aosAzimuthDeg: radiansToDegrees(look.azimuth),
        };
      } else if (elevation > current.maxElevationDeg) {
        current.maxElevationDeg = elevation;
      }
    } else if (current) {
      current.losMs = t;
      passes.push(current);
      current = null;
      if (passes.length >= maxPasses) return passes;
    }
  }

  if (current) {
    current.losMs = endMs;
    passes.push(current);
  }
  return passes;
}

const COMPASS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

export function compass(azimuthDeg: number): string {
  const normalized = ((azimuthDeg % 360) + 360) % 360;
  return COMPASS[Math.round(normalized / 22.5) % 16];
}
