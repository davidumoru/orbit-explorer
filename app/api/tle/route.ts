const ISS_CATALOG_NUMBER = 25544;
const CELESTRAK_URL = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${ISS_CATALOG_NUMBER}&FORMAT=TLE`;

const REVALIDATE_SECONDS = 7200;

export async function GET() {
  const res = await fetch(CELESTRAK_URL, {
    next: { revalidate: REVALIDATE_SECONDS },
  });

  if (!res.ok) {
    return Response.json(
      { error: `CelesTrak responded with ${res.status}` },
      { status: 502 },
    );
  }

  const text = await res.text();
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim());

  if (
    lines.length < 3 ||
    !lines[1].startsWith("1 ") ||
    !lines[2].startsWith("2 ")
  ) {
    return Response.json(
      { error: "Unexpected TLE format from CelesTrak" },
      { status: 502 },
    );
  }

  return Response.json({
    name: lines[0],
    line1: lines[1],
    line2: lines[2],
  });
}
