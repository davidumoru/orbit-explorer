"use client";

import { useEffect, useRef, useState } from "react";
import type * as CesiumNS from "cesium";
import {
  propagate,
  gstime,
  eciToEcf,
  eciToGeodetic,
  degreesLat,
  degreesLong,
  type SatRec,
} from "satellite.js";
import type { ImageryKey } from "./imagery";
import type { CatalogSat } from "./catalog";
import type { Observer } from "./passes";

type Cesium = typeof CesiumNS;

declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
    Cesium?: Cesium;
  }
}

const ORBIT_WINDOW_MIN = 45;
const ORBIT_STEP_SEC = 30;

let cesiumLoader: Promise<Cesium> | null = null;

function loadCesium(): Promise<Cesium> {
  if (!cesiumLoader) {
    cesiumLoader = new Promise((resolve, reject) => {
      window.CESIUM_BASE_URL = "/cesium";
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "/cesium/Widgets/widgets.css";
      document.head.appendChild(css);
      const script = document.createElement("script");
      script.src = "/cesium/Cesium.js";
      script.onload = () =>
        window.Cesium
          ? resolve(window.Cesium)
          : reject(new Error("Cesium script loaded but did not initialize"));
      script.onerror = () =>
        reject(new Error("Failed to load /cesium/Cesium.js"));
      document.head.appendChild(script);
    });
  }
  return cesiumLoader;
}

function phosphor(Cesium: Cesium) {
  return Cesium.Color.fromCssColorString("#ffb000");
}

function gibsProvider(Cesium: Cesium, layer: string) {
  return new Cesium.UrlTemplateImageryProvider({
    url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`,
    maximumLevel: 8,
    credit: new Cesium.Credit("NASA GIBS"),
  });
}

function createImageryProvider(
  Cesium: Cesium,
  key: ImageryKey,
): CesiumNS.ImageryProvider | Promise<CesiumNS.ImageryProvider> {
  switch (key) {
    case "sentinel":
      return new Cesium.UrlTemplateImageryProvider({
        url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg",
        maximumLevel: 14,
        credit: new Cesium.Credit("Sentinel-2 cloudless by EOX"),
      });
    case "blueMarble":
      return gibsProvider(Cesium, "BlueMarble_ShadedRelief_Bathymetry");
    case "night":
      return gibsProvider(Cesium, "VIIRS_CityLights_2012");
    case "naturalEarth":
      return Cesium.TileMapServiceImageryProvider.fromUrl(
        Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
      );
  }
}

function satellitePosition(
  Cesium: Cesium,
  satrec: SatRec,
  time: Date,
): CesiumNS.Cartesian3 | undefined {
  const pv = propagate(satrec, time);
  if (!pv) return undefined;
  const ecf = eciToEcf(pv.position, gstime(time));
  return new Cesium.Cartesian3(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000);
}

function orbitPath(
  Cesium: Cesium,
  satrec: SatRec,
  around: Date,
): CesiumNS.Cartesian3[] {
  const positions: CesiumNS.Cartesian3[] = [];
  const start = around.getTime() - ORBIT_WINDOW_MIN * 60_000;
  const end = around.getTime() + ORBIT_WINDOW_MIN * 60_000;
  for (let t = start; t <= end; t += ORBIT_STEP_SEC * 1000) {
    const pos = satellitePosition(Cesium, satrec, new Date(t));
    if (pos) positions.push(pos);
  }
  return positions;
}

function groundTrackPath(
  Cesium: Cesium,
  satrec: SatRec,
  around: Date,
): CesiumNS.Cartesian3[] {
  const positions: CesiumNS.Cartesian3[] = [];
  const start = around.getTime() - ORBIT_WINDOW_MIN * 60_000;
  const end = around.getTime() + ORBIT_WINDOW_MIN * 60_000;
  for (let t = start; t <= end; t += ORBIT_STEP_SEC * 1000) {
    const date = new Date(t);
    const pv = propagate(satrec, date);
    if (!pv) continue;
    const geo = eciToGeodetic(pv.position, gstime(date));
    positions.push(
      Cesium.Cartesian3.fromRadians(geo.longitude, geo.latitude, 5_000),
    );
  }
  return positions;
}

export default function Globe({
  satellites,
  selectedId,
  onSelect,
  imagery,
  observer,
}: {
  satellites: CatalogSat[];
  selectedId: string;
  onSelect: (id: string) => void;
  imagery: ImageryKey;
  observer: Observer | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const creditRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CesiumNS.Viewer | null>(null);
  const cesiumRef = useRef<Cesium | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCesium()
      .then((Cesium) => {
        if (cancelled || !containerRef.current || !creditRef.current) return;

        const instance = new Cesium.Viewer(containerRef.current, {
          creditContainer: creditRef.current,
          baseLayer: false,
          animation: false,
          timeline: false,
          baseLayerPicker: false,
          fullscreenButton: false,
          geocoder: false,
          homeButton: false,
          navigationHelpButton: false,
          sceneModePicker: false,
          selectionIndicator: false,
          infoBox: false,
        });

        instance.scene.globe.enableLighting = true;
        instance.scene.globe.baseColor =
          Cesium.Color.fromCssColorString("#0a0805");

        cesiumRef.current = Cesium;
        viewerRef.current = instance;
        setReady(true);
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;
    let cancelled = false;
    Promise.resolve(createImageryProvider(Cesium, imagery)).then((provider) => {
      if (cancelled || viewer.isDestroyed()) return;
      viewer.imageryLayers.removeAll();
      viewer.imageryLayers.addImageryProvider(provider);
      viewer.scene.globe.enableLighting = imagery !== "night";
    });
    return () => {
      cancelled = true;
    };
  }, [ready, imagery]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || satellites.length === 0) return;

    const points = new Cesium.PointPrimitiveCollection();
    const pointsById = new Map<string, CesiumNS.PointPrimitive>();
    const now = new Date();
    for (const sat of satellites) {
      const position = satellitePosition(Cesium, sat.satrec, now);
      if (!position) continue;
      pointsById.set(
        sat.id,
        points.add({
          id: sat.id,
          position,
          pixelSize: 3,
          color: phosphor(Cesium).withAlpha(0.45),
        }),
      );
    }
    viewer.scene.primitives.add(points);

    const interval = setInterval(() => {
      const time = new Date();
      for (const sat of satellites) {
        const point = pointsById.get(sat.id);
        if (!point) continue;
        const position = satellitePosition(Cesium, sat.satrec, time);
        if (position) point.position = position;
      }
    }, 1000);

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(
      (movement: CesiumNS.ScreenSpaceEventHandler.PositionedEvent) => {
        const picked = viewer.scene.pick(movement.position);
        if (picked && typeof picked.id === "string") onSelect(picked.id);
      },
      Cesium.ScreenSpaceEventType.LEFT_CLICK,
    );

    return () => {
      clearInterval(interval);
      handler.destroy();
      if (!viewer.isDestroyed()) viewer.scene.primitives.remove(points);
    };
  }, [ready, satellites, onSelect]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    const sat = satellites.find((s) => s.id === selectedId);
    if (!viewer || !Cesium || !sat) return;

    const PHOSPHOR = phosphor(Cesium);
    const target = viewer.entities.add({
      name: sat.name,
      position: new Cesium.CallbackPositionProperty(
        () => satellitePosition(Cesium, sat.satrec, new Date()),
        false,
        Cesium.ReferenceFrame.FIXED,
      ),
      point: {
        pixelSize: 7,
        color: PHOSPHOR,
        outlineColor: PHOSPHOR.withAlpha(0.25),
        outlineWidth: 5,
      },
      label: {
        text: sat.name,
        font: "12px 'IBM Plex Mono', monospace",
        fillColor: PHOSPHOR,
        pixelOffset: new Cesium.Cartesian2(0, -20),
      },
    });

    const orbit = viewer.entities.add({
      polyline: {
        positions: orbitPath(Cesium, sat.satrec, new Date()),
        width: 4,
        material: new Cesium.PolylineGlowMaterialProperty({
          color: PHOSPHOR.withAlpha(0.6),
          glowPower: 0.15,
        }),
      },
    });

    const groundTrack = viewer.entities.add({
      polyline: {
        positions: groundTrackPath(Cesium, sat.satrec, new Date()),
        width: 1.5,
        material: new Cesium.ColorMaterialProperty(PHOSPHOR.withAlpha(0.3)),
      },
    });

    const now = new Date();
    const pv = propagate(sat.satrec, now);
    if (pv) {
      const geo = eciToGeodetic(pv.position, gstime(now));
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          degreesLong(geo.longitude),
          degreesLat(geo.latitude),
          Math.max(geo.height * 1000 * 3, 22_000_000),
        ),
        duration: 1.5,
      });
    }

    return () => {
      if (!viewer.isDestroyed()) {
        viewer.entities.remove(target);
        viewer.entities.remove(orbit);
        viewer.entities.remove(groundTrack);
      }
    };
  }, [ready, satellites, selectedId]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || !observer) return;

    const marker = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(observer.lon, observer.lat),
      point: {
        pixelSize: 5,
        color: Cesium.Color.WHITE.withAlpha(0.85),
        outlineColor: Cesium.Color.WHITE.withAlpha(0.2),
        outlineWidth: 4,
      },
      label: {
        text: "OBS",
        font: "11px 'IBM Plex Mono', monospace",
        fillColor: Cesium.Color.WHITE.withAlpha(0.7),
        pixelOffset: new Cesium.Cartesian2(0, -16),
      },
    });

    return () => {
      if (!viewer.isDestroyed()) viewer.entities.remove(marker);
    };
  }, [ready, observer]);

  return (
    <>
      <div ref={containerRef} className="absolute inset-0" />
      <div ref={creditRef} className="hidden" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={
              loadError
                ? "text-xs tracking-[0.3em] text-foreground/40"
                : "animate-blink text-xs tracking-[0.3em] text-foreground/40"
            }
          >
            {loadError ? `GLOBE FAULT: ${loadError}` : "LOADING GLOBE"}
          </span>
        </div>
      )}
    </>
  );
}
