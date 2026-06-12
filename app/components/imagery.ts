export type ImageryKey = "sentinel" | "blueMarble" | "night" | "naturalEarth";

export const IMAGERY_OPTIONS: {
  key: ImageryKey;
  label: string;
  credit: string;
}[] = [
  { key: "sentinel", label: "SAT", credit: "SENTINEL-2 CLOUDLESS · EOX" },
  { key: "blueMarble", label: "MARBLE", credit: "BLUE MARBLE · NASA GIBS" },
  { key: "night", label: "NIGHT", credit: "VIIRS CITY LIGHTS · NASA GIBS" },
  { key: "naturalEarth", label: "NE2", credit: "NATURAL EARTH II · OFFLINE" },
];
