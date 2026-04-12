const https = require("https");
const sense = require("sense-hat-led").sync;
const Joystick = require("sense-hat-joystick-x64");

const joystick = new Joystick();


// --------------------
// CONFIG
// --------------------
const apiKey = "0oJFlaXSdxaXPTsIU6D6GrP1KEu4Iwse";

// I-76 endpoints
const WAYPOINTS = [
  { lat: 39.9210, lon: -75.1592 }, // Walt Whitman
  { lat: 39.9450, lon: -75.1800 }, // South Philly
  { lat: 39.9600, lon: -75.2100 }, // University City
  { lat: 39.9800, lon: -75.2500 }, // Bala Cynwyd
  { lat: 40.0300, lon: -75.3100 }, // Main Line
  { lat: 40.0918, lon: -75.3963 }  // KOP
];

const TOTAL_POINTS = 320;
const TOTAL_BINS = 32;
const WINDOW_SIZE = 8;

let currentWindow = 0;
let allBins = [];

// --------------------
// HELPERS
// --------------------
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

function buildPoints() {
  const points = [];
  const pointsPerSegment = Math.floor(TOTAL_POINTS / (WAYPOINTS.length - 1));

  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    const a = WAYPOINTS[i];
    const b = WAYPOINTS[i + 1];

    for (let j = 0; j < pointsPerSegment; j++) {
      const t = j / pointsPerSegment;

      points.push({
        lat: a.lat + t * (b.lat - a.lat),
        lon: a.lon + t * (b.lon - a.lon)
      });
    }
  }

  return points;
}

async function getTraffic(lat, lon) {
  const url =
    `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json` +
    `?point=${lat},${lon}&key=${apiKey}`;

  const data = await getJson(url);

  console.log("RAW API:", JSON.stringify(data).slice(0, 300));

  if (!data.flowSegmentData) return null;

  const s = data.flowSegmentData;

  return {
    latitude: lat,
    longitude: lon,
    currentSpeed: s.currentSpeed,
    freeFlowSpeed: s.freeFlowSpeed,
    frc: s.frc
  };
}

async function fetchTrafficBatched(points, batchSize = 50) {
  const results = [];

  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(async p => {
        try {
          return await getTraffic(p.lat, p.lon);
        } catch {
          return null;
        }
      })
    );

    results.push(...batchResults);

    await new Promise(r => setTimeout(r, 200));
  }

  return results;
}

function buildBins(trafficData) {
  const highways = trafficData
    .filter(d => d && (d.frc === "FRC0" || d.frc === "FRC1"))
    .map(d => ({
      ...d,
      congestionPercent: d.freeFlowSpeed
        ? (d.currentSpeed / d.freeFlowSpeed) * 100
        : 0
    }));

  const sorted = highways.sort((a, b) => a.latitude - b.latitude);

  const bins = [];
  const binSize = Math.ceil(sorted.length / TOTAL_BINS);

  for (let i = 0; i < TOTAL_BINS; i++) {
    const start = i * binSize;
    const end = Math.min(start + binSize, sorted.length);
    const section = sorted.slice(start, end);

    bins.push({
      congestionPercent: section.length
        ? mean(section, d => d.congestionPercent)
        : 0
    });
  }

  bins.forEach((b, i) => {
    console.log("Bin", i + 1, "=", b.congestionPercent);
  });

  return bins;
}

function displayWindow() {
  const start = currentWindow * WINDOW_SIZE;
  const visible = allBins.slice(start, start + WINDOW_SIZE);

  const pixels = [];

  for (let row = 0; row < 8; row++) {
    const percent = visible[row]?.congestionPercent ?? 0;
    const color = congestionColor(percent);

    for (let col = 0; col < 8; col++) {
      pixels.push(color);
    }
  }



  const sectionStart = start + 1;
  const sectionEnd = Math.min(start + WINDOW_SIZE, TOTAL_BINS);

  sense.showMessage(
    `${sectionStart}-${sectionEnd}`,
    0.05
  );

  sense.setPixels(pixels);

  console.log(`Displaying sections ${sectionStart}-${sectionEnd}`);
}

function goRight() {
  const maxWindow = TOTAL_BINS / WINDOW_SIZE - 1;

  if (currentWindow >= maxWindow) {
    sense.showMessage("END", 0.05);
    return;
  }

  currentWindow++;
  displayWindow();
}

function goLeft() {
  if (currentWindow <= 0) {
    sense.showMessage("START", 0.05);
    return;
  }

  currentWindow--;
  displayWindow();
}

// --------------------
// JOYSTICK
// --------------------
joystick.on("right", () => {
  sense.showMessage("RIGHT", 0.05);
  goRight();
});

joystick.on("left", () => {
  sense.showMessage("LEFT", 0.05);
  goLeft();
});

joystick.on("enter", () => {
  displayWindow();
});

// --------------------
// INIT
// --------------------
async function init() {
  sense.showMessage("LOADING I76", 0.05);

  const points = buildPoints();
  const traffic = await fetchTrafficBatched(points);

  allBins = buildBins(traffic);

  sense.showMessage("READY", 0.05);

  displayWindow();
}

function shutdown() {
  console.log("Shutting down...");
  joystick.end();
  sense.clear();
  process.kill(process.pid, "SIGKILL");
}

process.on("SIGINT", shutdown);   // Ctrl + C
process.on("SIGTERM", shutdown);  // kill / system stop

init();