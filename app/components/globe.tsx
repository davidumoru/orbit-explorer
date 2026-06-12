"use client";

import { useEffect, useRef } from "react";
import * as Cesium from "cesium";
import {
  propagate,
  gstime,
  eciToEcf,
  eciToGeodetic,
  degreesLat,
  degreesLong,
  type SatRec,
} from "satellite.js";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { ImageryKey } from "./imagery";

declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
  }
}

if (typeof window !== "undefined") {
  window.CESIUM_BASE_URL = "/cesium";
}

const PHOSPHOR = Cesium.Color.fromCssColorString("#ffb000");
const ORBIT_WINDOW_MIN = 45;
const ORBIT_STEP_SEC = 30;

function gibsProvider(layer: string) {
  return new Cesium.WebMapTileServiceImageryProvider({
    url: "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi",
    layer,
    style: "default",
    format: "image/jpeg",
    tileMatrixSetID: "500m",
    tilingScheme: new Cesium.GeographicTilingScheme(),
    maximumLevel: 8,
    credit: new Cesium.Credit("NASA GIBS"),
  });
}

function createImageryProvider(
  key: ImageryKey,
): Cesium.ImageryProvider | Promise<Cesium.ImageryProvider> {
  switch (key) {
    case "sentinel":
      return new Cesium.UrlTemplateImageryProvider({
        url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg",
        maximumLevel: 14,
        credit: new Cesium.Credit("Sentinel-2 cloudless by EOX"),
      });
    case "blueMarble":
      return gibsProvider("BlueMarble_ShadedRelief_Bathymetry");
    case "night":
      return gibsProvider("VIIRS_CityLights_2012");
    case "naturalEarth":
      return Cesium.TileMapServiceImageryProvider.fromUrl(
        Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
      );
  }
}

function satellitePosition(
  satrec: SatRec,
  time: Date,
): Cesium.Cartesian3 | undefined {
  const pv = propagate(satrec, time);
  if (!pv) return undefined;
  const ecf = eciToEcf(pv.position, gstime(time));
  return new Cesium.Cartesian3(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000);
}

function orbitPath(satrec: SatRec, around: Date): Cesium.Cartesian3[] {
  const positions: Cesium.Cartesian3[] = [];
  const start = around.getTime() - ORBIT_WINDOW_MIN * 60_000;
  const end = around.getTime() + ORBIT_WINDOW_MIN * 60_000;
  for (let t = start; t <= end; t += ORBIT_STEP_SEC * 1000) {
    const pos = satellitePosition(satrec, new Date(t));
    if (pos) positions.push(pos);
  }
  return positions;
}

export default function Globe({
  satrec,
  imagery,
}: {
  satrec: SatRec | null;
  imagery: ImageryKey;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const creditRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);

  useEffect(() => {
    if (!containerRef.current || !creditRef.current) return;

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
    instance.scene.globe.baseColor = Cesium.Color.fromCssColorString("#0a0805");

    viewerRef.current = instance;
    return () => {
      viewerRef.current = null;
      instance.destroy();
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let cancelled = false;
    Promise.resolve(createImageryProvider(imagery)).then((provider) => {
      if (cancelled || viewer.isDestroyed()) return;
      viewer.imageryLayers.removeAll();
      viewer.imageryLayers.addImageryProvider(provider);
      viewer.scene.globe.enableLighting = imagery !== "night";
    });
    return () => {
      cancelled = true;
    };
  }, [imagery]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !satrec) return;

    const iss = viewer.entities.add({
      name: "ISS (ZARYA)",
      position: new Cesium.CallbackPositionProperty(
        () => satellitePosition(satrec, new Date()),
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
        text: "ISS",
        font: "12px 'IBM Plex Mono', monospace",
        fillColor: PHOSPHOR,
        pixelOffset: new Cesium.Cartesian2(0, -20),
      },
    });

    const orbit = viewer.entities.add({
      polyline: {
        positions: orbitPath(satrec, new Date()),
        width: 4,
        material: new Cesium.PolylineGlowMaterialProperty({
          color: PHOSPHOR.withAlpha(0.6),
          glowPower: 0.15,
        }),
      },
    });

    const now = new Date();
    const pv = propagate(satrec, now);
    if (pv) {
      const geo = eciToGeodetic(pv.position, gstime(now));
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
          degreesLong(geo.longitude),
          degreesLat(geo.latitude),
          22_000_000,
        ),
      });
    }

    return () => {
      if (!viewer.isDestroyed()) {
        viewer.entities.remove(iss);
        viewer.entities.remove(orbit);
      }
    };
  }, [satrec]);

  return (
    <>
      <div ref={containerRef} className="absolute inset-0" />
      <div ref={creditRef} className="hidden" />
    </>
  );
}
