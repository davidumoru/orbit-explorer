"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { IMAGERY_OPTIONS, type ImageryKey } from "./imagery";
import {
  CATALOG_GROUPS,
  ISS_ID,
  orbitRegime,
  parseCatalog,
  type CatalogSat,
} from "./catalog";
import {
  compass,
  predictPasses,
  PASS_WINDOW_HOURS,
  type Observer,
} from "./passes";
import {
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong,
  radiansToDegrees,
  SatRecError,
  type SatRec,
} from "satellite.js";

type Telemetry = {
  lat: number;
  lon: number;
  altKm: number;
  speedKmS: number;
  time: Date;
};

const JULIAN_UNIX_EPOCH = 2440587.5;
const MS_PER_DAY = 86_400_000;
const IMAGERY_STORAGE_KEY = "orbit-explorer:imagery";

function subscribeToImagery(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getImagerySnapshot(): ImageryKey {
  const stored = window.localStorage.getItem(IMAGERY_STORAGE_KEY);
  return IMAGERY_OPTIONS.some((option) => option.key === stored)
    ? (stored as ImageryKey)
    : "sentinel";
}

function selectImagery(key: ImageryKey) {
  window.localStorage.setItem(IMAGERY_STORAGE_KEY, key);
  window.dispatchEvent(
    new StorageEvent("storage", { key: IMAGERY_STORAGE_KEY }),
  );
}

const OBSERVER_STORAGE_KEY = "orbit-explorer:observer";

function subscribeToObserver(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getObserverSnapshot(): string | null {
  return window.localStorage.getItem(OBSERVER_STORAGE_KEY);
}

function storeObserver(observer: Observer | null) {
  if (observer) {
    window.localStorage.setItem(OBSERVER_STORAGE_KEY, JSON.stringify(observer));
  } else {
    window.localStorage.removeItem(OBSERVER_STORAGE_KEY);
  }
  window.dispatchEvent(
    new StorageEvent("storage", { key: OBSERVER_STORAGE_KEY }),
  );
}

function parseObserver(raw: string | null): Observer | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Observer>;
    if (typeof parsed.lat === "number" && typeof parsed.lon === "number") {
      return { lat: parsed.lat, lon: parsed.lon };
    }
  } catch {}
  return null;
}

function formatPassTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPassDay(ms: number): string {
  return new Date(ms)
    .toLocaleDateString([], { month: "short", day: "2-digit" })
    .toUpperCase();
}

const Globe = dynamic(() => import("./globe"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center">
      <span className="animate-blink text-xs tracking-[0.3em] text-foreground/40">
        LOADING GLOBE
      </span>
    </div>
  ),
});

function computeTelemetry(satrec: SatRec, time: Date): Telemetry | null {
  const pv = propagate(satrec, time);
  if (!pv || satrec.error !== SatRecError.None) return null;

  const geo = eciToGeodetic(pv.position, gstime(time));
  const { x, y, z } = pv.velocity;

  return {
    lat: degreesLat(geo.latitude),
    lon: degreesLong(geo.longitude),
    altKm: geo.height,
    speedKmS: Math.sqrt(x * x + y * y + z * z),
    time,
  };
}

function formatUtc(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export default function MissionConsole() {
  const [catalog, setCatalog] = useState<CatalogSat[]>([]);
  const [selectedId, setSelectedId] = useState<string>(ISS_ID);
  const [query, setQuery] = useState("");
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const imagery = useSyncExternalStore(
    subscribeToImagery,
    getImagerySnapshot,
    () => "sentinel" as ImageryKey,
  );
  const observerRaw = useSyncExternalStore(
    subscribeToObserver,
    getObserverSnapshot,
    () => null,
  );
  const observer = useMemo(() => parseObserver(observerRaw), [observerRaw]);

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setGeoError("Geolocation unavailable in this browser");
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        storeObserver({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
        setLocating(false);
      },
      (err) => {
        setGeoError(err.message);
        setLocating(false);
      },
      { timeout: 10_000 },
    );
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      CATALOG_GROUPS.map((group) =>
        fetch(`/api/satellites?group=${group.key}`)
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json() as Promise<
              { name: string; line1: string; line2: string }[]
            >;
          })
          .then((tles) => parseCatalog(group.key, tles))
          .catch(() => [] as CatalogSat[]),
      ),
    ).then((groups) => {
      if (cancelled) return;
      const merged = new Map<string, CatalogSat>();
      for (const sat of groups.flat()) {
        if (!merged.has(sat.id)) merged.set(sat.id, sat);
      }
      if (merged.size === 0) {
        setError("Catalog fetch failed — CelesTrak unreachable");
      } else {
        setCatalog(
          [...merged.values()].sort((a, b) => a.name.localeCompare(b.name)),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(
    () => catalog.find((sat) => sat.id === selectedId) ?? null,
    [catalog, selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    const tick = () => {
      const next = computeTelemetry(selected.satrec, new Date());
      if (next) setTelemetry(next);
      else setError("SGP4 propagation failed — orbital elements may be stale");
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return catalog;
    return catalog.filter(
      (sat) => sat.name.toUpperCase().includes(q) || sat.id.includes(q),
    );
  }, [catalog, query]);

  const passAnchorMs = telemetry
    ? Math.floor(telemetry.time.getTime() / 600_000) * 600_000
    : null;
  const passes = useMemo(
    () =>
      selected && observer && passAnchorMs !== null
        ? predictPasses(selected.satrec, observer, passAnchorMs)
        : null,
    [selected, observer, passAnchorMs],
  );
  const continuouslyVisible =
    passes?.length === 1 &&
    passAnchorMs !== null &&
    passes[0].aosMs === passAnchorMs &&
    passes[0].losMs >= passAnchorMs + PASS_WINDOW_HOURS * 3_600_000;

  const live = telemetry !== null && error === null;
  const periodMin = selected ? (2 * Math.PI) / selected.satrec.no : null;
  const inclinationDeg = selected
    ? radiansToDegrees(selected.satrec.inclo)
    : null;
  const tleAgeHours =
    selected && telemetry
      ? (telemetry.time.getTime() -
          (selected.satrec.jdsatepoch - JULIAN_UNIX_EPOCH) * MS_PER_DAY) /
        3_600_000
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="reveal flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-phosphor/15 px-5 py-3 sm:px-8">
        <div className="flex items-center gap-4">
          <span
            className={`inline-block size-2 rounded-full ${
              live ? "animate-blink bg-phosphor" : "bg-phosphor/30"
            }`}
            aria-hidden
          />
          <span className="text-xs tracking-[0.3em] text-phosphor">
            {live ? "LIVE" : error ? "FAULT" : "ACQUIRING"}
          </span>
          <span className="text-xs tracking-[0.2em] text-foreground/60">
            TGT {(selected?.name ?? "ISS (ZARYA)").toUpperCase()} · NORAD{" "}
            {selectedId}
            {selected ? ` · ${orbitRegime(selected.satrec)}` : ""}
          </span>
        </div>
        <span className="text-xs tracking-[0.2em] text-foreground/60 tabular-nums">
          {telemetry ? formatUtc(telemetry.time) : "––:––:–– UTC"}
        </span>
      </div>

      {error ? (
        <div className="flex flex-1 items-center justify-center px-8 py-20">
          <div className="max-w-md border border-phosphor/30 px-8 py-6 text-center">
            <p className="mb-2 text-xs tracking-[0.3em] text-phosphor">
              SIGNAL FAULT
            </p>
            <p className="text-sm text-foreground/70">{error}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex min-h-80 flex-1 border-b border-phosphor/15 md:min-h-0">
            <aside className="hidden w-72 flex-col border-r border-phosphor/15 md:flex">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="SEARCH TARGET / NORAD ID"
                className="border-b border-phosphor/15 bg-transparent px-4 py-3 text-xs tracking-[0.15em] text-foreground placeholder:text-foreground/30 focus:outline-none"
              />
              <div className="flex-1 overflow-y-auto">
                {filtered.map((sat) => (
                  <button
                    key={sat.id}
                    type="button"
                    onClick={() => setSelectedId(sat.id)}
                    className={`flex w-full items-baseline justify-between gap-2 px-4 py-2 text-left text-xs transition-colors ${
                      sat.id === selectedId
                        ? "bg-phosphor/10 text-phosphor"
                        : "text-foreground/65 hover:bg-phosphor/5 hover:text-foreground"
                    }`}
                  >
                    <span className="truncate">{sat.name}</span>
                    <span className="shrink-0 text-[9px] text-foreground/35 tabular-nums">
                      {sat.id}
                    </span>
                  </button>
                ))}
                {catalog.length > 0 && filtered.length === 0 && (
                  <p className="px-4 py-3 text-[10px] tracking-[0.2em] text-foreground/35">
                    NO MATCHES
                  </p>
                )}
              </div>
              <div className="border-t border-phosphor/15 px-4 py-2 text-[10px] tracking-[0.2em] text-foreground/40">
                {catalog.length} OBJECTS TRACKED
              </div>
            </aside>

            <div className="relative flex-1">
              <Globe
                satellites={catalog}
                selectedId={selectedId}
                onSelect={setSelectedId}
                imagery={imagery}
                observer={observer}
              />
              <div className="absolute right-3 top-3 z-10 flex border border-phosphor/25 bg-background/70 backdrop-blur-sm">
                {IMAGERY_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => selectImagery(option.key)}
                    className={`px-3 py-1.5 text-[10px] tracking-[0.2em] transition-colors ${
                      option.key === imagery
                        ? "bg-phosphor/15 text-phosphor"
                        : "text-foreground/50 hover:text-foreground/80"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="absolute bottom-2 right-3 z-10 text-[9px] tracking-[0.2em] text-foreground/35">
                {
                  IMAGERY_OPTIONS.find((option) => option.key === imagery)
                    ?.credit
                }
              </div>
            </div>

            <aside className="hidden w-80 flex-col border-l border-phosphor/15 lg:flex">
              <div className="flex items-center justify-between border-b border-phosphor/15 px-4 py-3">
                <span className="text-[10px] tracking-[0.25em] text-foreground/50">
                  PASS PREDICTIONS
                </span>
                {observer && (
                  <button
                    type="button"
                    onClick={() => storeObserver(null)}
                    className="text-[9px] tracking-[0.2em] text-foreground/35 transition-colors hover:text-foreground/70"
                  >
                    CLEAR LOC
                  </button>
                )}
              </div>

              {!observer ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
                  <p className="text-[11px] leading-relaxed text-foreground/50">
                    Set your ground position to predict when the selected
                    target rises above your horizon.
                  </p>
                  <button
                    type="button"
                    onClick={requestLocation}
                    disabled={locating}
                    className="border border-phosphor/30 px-4 py-2 text-[10px] tracking-[0.25em] text-phosphor transition-colors hover:bg-phosphor/10 disabled:opacity-50"
                  >
                    {locating ? "LOCATING…" : "USE MY LOCATION"}
                  </button>
                  {geoError && (
                    <p className="text-[10px] text-foreground/40">{geoError}</p>
                  )}
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="border-b border-phosphor/10 px-4 py-2 text-[10px] tracking-[0.2em] text-foreground/40 tabular-nums">
                    OBS {Math.abs(observer.lat).toFixed(3)}°
                    {observer.lat >= 0 ? "N" : "S"} ·{" "}
                    {Math.abs(observer.lon).toFixed(3)}°
                    {observer.lon >= 0 ? "E" : "W"}
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {!passes ? (
                      <p className="px-4 py-4 text-[10px] tracking-[0.2em] text-foreground/35">
                        COMPUTING…
                      </p>
                    ) : continuouslyVisible ? (
                      <p className="px-4 py-4 text-[10px] leading-relaxed tracking-[0.2em] text-foreground/50">
                        CONTINUOUSLY IN VIEW FROM YOUR POSITION
                      </p>
                    ) : passes.length === 0 ? (
                      <p className="px-4 py-4 text-[10px] leading-relaxed tracking-[0.2em] text-foreground/50">
                        NO PASSES IN NEXT {PASS_WINDOW_HOURS} H
                      </p>
                    ) : (
                      passes.map((pass) => (
                        <div
                          key={pass.aosMs}
                          className="border-b border-phosphor/10 px-4 py-3"
                        >
                          <div className="flex items-baseline justify-between text-xs text-foreground/85 tabular-nums">
                            <span>
                              {formatPassDay(pass.aosMs)}{" "}
                              {formatPassTime(pass.aosMs)} →{" "}
                              {formatPassTime(pass.losMs)}
                            </span>
                            <span className="text-phosphor">
                              {Math.round(pass.maxElevationDeg)}°
                            </span>
                          </div>
                          <div className="mt-1 flex justify-between text-[10px] tracking-[0.15em] text-foreground/40 tabular-nums">
                            <span>
                              RISE {compass(pass.aosAzimuthDeg)} ·{" "}
                              {Math.round((pass.losMs - pass.aosMs) / 60_000)}{" "}
                              MIN
                            </span>
                            <span>MAX EL</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="border-t border-phosphor/15 px-4 py-2 text-[10px] tracking-[0.2em] text-foreground/40">
                    NEXT {PASS_WINDOW_HOURS} H · LOCAL TIME
                  </div>
                </div>
              )}
            </aside>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <TelemetryCell
              label="Latitude"
              value={
                telemetry ? `${Math.abs(telemetry.lat).toFixed(4)}°` : undefined
              }
              unit={telemetry ? (telemetry.lat >= 0 ? "N" : "S") : ""}
              delay={1}
            />
            <TelemetryCell
              label="Longitude"
              value={
                telemetry ? `${Math.abs(telemetry.lon).toFixed(4)}°` : undefined
              }
              unit={telemetry ? (telemetry.lon >= 0 ? "E" : "W") : ""}
              delay={2}
            />
            <TelemetryCell
              label="Altitude"
              value={telemetry ? telemetry.altKm.toFixed(2) : undefined}
              unit="KM"
              delay={3}
            />
            <TelemetryCell
              label="Velocity"
              value={telemetry ? telemetry.speedKmS.toFixed(4) : undefined}
              unit="KM/S"
              delay={4}
            />
          </div>

          <div className="reveal grid grid-cols-2 border-t border-phosphor/15 sm:grid-cols-4 [animation-delay:500ms]">
            <OrbitStat
              label="Period"
              value={periodMin ? `${periodMin.toFixed(1)} MIN` : "–"}
            />
            <OrbitStat
              label="Inclination"
              value={inclinationDeg ? `${inclinationDeg.toFixed(2)}°` : "–"}
            />
            <OrbitStat
              label="Ground speed"
              value={
                telemetry
                  ? `${Math.round(telemetry.speedKmS * 3600).toLocaleString("en-US")} KM/H`
                  : "–"
              }
            />
            <OrbitStat
              label="TLE age"
              value={tleAgeHours !== null ? `${tleAgeHours.toFixed(1)} H` : "–"}
            />
          </div>
        </>
      )}
    </div>
  );
}

function TelemetryCell({
  label,
  value,
  unit,
  delay,
}: {
  label: string;
  value?: string;
  unit: string;
  delay: number;
}) {
  return (
    <div
      className="reveal flex flex-col justify-center gap-2 border-b border-phosphor/15 px-5 py-4 last:border-b-0 sm:border-r sm:px-8 sm:py-5 sm:nth-[2n]:border-r-0 lg:border-b-0 lg:nth-[2n]:border-r lg:last:border-r-0"
      style={{ animationDelay: `${delay * 90}ms` }}
    >
      <span className="text-[11px] uppercase tracking-[0.3em] text-foreground/50">
        {label}
      </span>
      <span className="text-2xl font-medium text-phosphor tabular-nums xl:text-3xl">
        {value ?? <span className="text-phosphor/30">––.––––</span>}
        <span className="ml-2 text-base text-foreground/60">{unit}</span>
      </span>
    </div>
  );
}

function OrbitStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-r border-phosphor/15 px-5 py-4 last:border-r-0 sm:px-8 max-sm:nth-[2n]:border-r-0">
      <span className="text-[10px] uppercase tracking-[0.25em] text-foreground/40">
        {label}
      </span>
      <span className="text-sm text-foreground/85 tabular-nums">{value}</span>
    </div>
  );
}
