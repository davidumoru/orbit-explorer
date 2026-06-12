import { twoline2satrec, type SatRec } from "satellite.js";

export type CatalogGroup = "stations" | "visual" | "gps";

export type CatalogSat = {
  id: string;
  name: string;
  group: CatalogGroup;
  satrec: SatRec;
};

export const CATALOG_GROUPS: { key: CatalogGroup; label: string }[] = [
  { key: "stations", label: "STN" },
  { key: "visual", label: "VIS" },
  { key: "gps", label: "GPS" },
];

export const ISS_ID = "25544";

export function parseCatalog(
  group: CatalogGroup,
  tles: { name: string; line1: string; line2: string }[],
): CatalogSat[] {
  return tles.map((tle) => {
    const satrec = twoline2satrec(tle.line1, tle.line2);
    return { id: satrec.satnum.trim(), name: tle.name, group, satrec };
  });
}

export function orbitRegime(satrec: SatRec): string {
  const periodMin = (2 * Math.PI) / satrec.no;
  if (periodMin < 128) return "LEO";
  if (periodMin < 1300) return "MEO";
  return "GEO";
}
