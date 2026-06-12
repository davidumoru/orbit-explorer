"use client";

import { useEffect, useState } from "react";
import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong,
  radiansToDegrees,
  SatRecError,
  type SatRec,
} from "satellite.js";

type Tle = { name: string; line1: string; line2: string };

type Telemetry = {
  lat: number;
  lon: number;
  altKm: number;
  speedKmS: number;
  time: Date;
};

const JULIAN_UNIX_EPOCH = 2440587.5;
const MS_PER_DAY = 86_400_000;

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

export default function IssTracker() {
  const [satrec, setSatrec] = useState<SatRec | null>(null);
  const [name, setName] = useState<string>("ISS (ZARYA)");
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tle")
      .then((res) => {
        if (!res.ok) throw new Error(`TLE fetch failed (HTTP ${res.status})`);
        return res.json() as Promise<Tle>;
      })
      .then((tle) => {
        if (cancelled) return;
        setName(tle.name);
        setSatrec(twoline2satrec(tle.line1, tle.line2));
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!satrec) return;
    const tick = () => {
      const next = computeTelemetry(satrec, new Date());
      if (next) setTelemetry(next);
      else setError("SGP4 propagation failed — orbital elements may be stale");
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [satrec]);

  const live = telemetry !== null && error === null;
  const periodMin = satrec ? (2 * Math.PI) / satrec.no : null;
  const inclinationDeg = satrec ? radiansToDegrees(satrec.inclo) : null;
  const tleAgeHours =
    satrec && telemetry
      ? (telemetry.time.getTime() -
          (satrec.jdsatepoch - JULIAN_UNIX_EPOCH) * MS_PER_DAY) /
        3_600_000
      : null;

  return (
    <div className="flex flex-1 flex-col">
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
            TGT {name.toUpperCase()} · NORAD 25544 · LEO
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
          <div className="grid flex-1 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
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
      className="reveal flex flex-col justify-center gap-3 border-b border-phosphor/15 px-5 py-8 last:border-b-0 sm:border-r sm:px-8 sm:py-10 sm:nth-[2n]:border-r-0 lg:border-b-0 lg:nth-[2n]:border-r lg:last:border-r-0"
      style={{ animationDelay: `${delay * 90}ms` }}
    >
      <span className="text-[11px] uppercase tracking-[0.3em] text-foreground/50">
        {label}
      </span>
      <span className="text-4xl font-medium text-phosphor tabular-nums xl:text-5xl">
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
