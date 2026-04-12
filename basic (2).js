const https = require("https");
const sense = require("sense-hat-led").sync;

const apiKey = "zP5Apf6BLYXLsCErrgfsRNbST8PmxlwM";
const longitude = -75.1802;
const southLat = 39.902430;
const northLat = 39.995431;
const n = 500;
const refreshMs = 5000;

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    }).on("error", reject);
  });
}

function buildLatitudes(count, south, north) {
  return Array.from(
    { length: count },
    (_, i) => south + i * (north - south) / (count - 1)
  );
}

function mean(arr, fn) {
  if (!arr.length) return 0;
  return arr.reduce((sum, x) => sum + fn(x), 0) / arr.length;
}

function congestionColor(percent) {
  if (percent < 40) return [139, 0, 0];
  if (percent < 60) return [255, 69, 0];
  if (percent < 80) return [255, 223, 40];
  return [50, 205, 50];
}

async function getTraffic(lat, lon) {
  const url =
    `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json` +
    `?point=${lat},${lon}&key=${apiKey}`;

  const data = await getJson(url);
  const s = data.flowSegmentData;
  if (!s) return null;

  return {
    latitude: lat,
    longitude: lon,
    currentSpeed: s.currentSpeed,
    freeFlowSpeed: s.freeFlowSpeed,
    frc: s.frc
  };
}

async function loadTrafficSlice() {
  const latitudes = buildLatitudes(n, southLat, northLat);

  const allPoints = await Promise.all(
    latitudes.map(async lat => {
      try {
        return await getTraffic(lat, longitude);
      } catch {
        return null;
      }
    })
  );

  return allPoints
    .filter(d => d && (d.frc === "FRC0" || d.frc === "FRC1"))
    .map(d => ({
      ...d,
      congestionPercent: d.freeFlowSpeed
        ? (d.currentSpeed / d.freeFlowSpeed) * 100
        : 0
    }));
}

function makeBins(trafficHighways) {
  const sorted = trafficHighways.slice().sort((a, b) => a.latitude - b.latitude);
  const binSize = Math.ceil(sorted.length / 8);
  const bins = [];

  for (let i = 0; i < 8; i++) {
    const start = i * binSize;
    const end = Math.min(start + binSize, sorted.length);
    const binItems = sorted.slice(start, end);

    bins.push({
      congestionPercent: binItems.length ? mean(binItems, d => d.congestionPercent) : 0
    });
  }

  return bins;
}

function binsToPixels(bins) {
  const pixels = [];

  for (let row = 0; row < 8; row++) {
    const color = congestionColor(bins[row].congestionPercent);
    for (let col = 0; col < 8; col++) {
      pixels.push(color);
    }
  }

  return pixels;
}

async function refresh() {
  try {
    const trafficHighways = await loadTrafficSlice();
    const bins = makeBins(trafficHighways);
    const pixels = binsToPixels(bins);

    sense.setPixels(pixels);

    console.log(
      "Updated:",
      bins.map(b => b.congestionPercent.toFixed(1) + "%").join(" | ")
    );
  } catch (err) {
    console.error("Refresh failed:", err.message);
  }
}

refresh();
setInterval(refresh, refreshMs);

function shutdown() {
    console.log("\nShutting down...")

    sense.clear();
    process.exit(0)
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

