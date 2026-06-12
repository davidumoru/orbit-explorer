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
  const imagery = useSyncExternalStore(
    subscribeToImagery,
    getImagerySnapshot,
    () => "sentinel" as ImageryKey,
  );

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
