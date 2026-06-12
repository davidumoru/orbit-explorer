import { cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = `${root}node_modules/cesium/Build/Cesium`;
const target = `${root}public/cesium`;

await rm(target, { recursive: true, force: true });
for (const dir of ["Workers", "ThirdParty", "Assets", "Widgets"]) {
  await cp(`${source}/${dir}`, `${target}/${dir}`, { recursive: true });
}
console.log("Copied Cesium static assets to public/cesium");
