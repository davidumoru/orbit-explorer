const CELESTRAK_GROUPS: Record<string, string> = {
  stations: "stations",
  visual: "visual",
  gps: "gps-ops",
};

const REVALIDATE_SECONDS = 7200;

export async function GET(request: Request) {
  const group = new URL(request.url).searchParams.get("group") ?? "";
  const celestrakGroup = CELESTRAK_GROUPS[group];
  if (!celestrakGroup) {
    return Response.json(
      { error: `Unknown group "${group}"` },
      { status: 400 },
    );
  }

  const res = await fetch(
    `https://celestrak.org/NORAD/elements/gp.php?GROUP=${celestrakGroup}&FORMAT=TLE`,
    { next: { revalidate: REVALIDATE_SECONDS } },
  );

  if (!res.ok) {
    return Response.json(
      { error: `CelesTrak responded with ${res.status}` },
      { status: 502 },
    );
  }

  const lines = (await res.text())
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim());

  const satellites = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    if (lines[i + 1].startsWith("1 ") && lines[i + 2].startsWith("2 ")) {
      satellites.push({
        name: lines[i],
        line1: lines[i + 1],
        line2: lines[i + 2],
      });
    }
  }

  if (satellites.length === 0) {
    return Response.json(
      { error: "Unexpected TLE format from CelesTrak" },
      { status: 502 },
    );
  }

  return Response.json(satellites);
}
