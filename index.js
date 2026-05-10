const https = require("https");
const fs = require("fs");
const sense = require("sense-hat-led").sync;
const Joystick = require("sense-hat-joystick-x64");

const joystick = new Joystick();

const apiKey = "YZx6zQMM2oUy0dpzKvb11J19bPefrxoY";
const HISTORY_FILE = "./data/history.csv";

const WAYPOINTS = [
  { lat: 39.9210, lon: -75.1592 },
  { lat: 39.9450, lon: -75.1800 },
  { lat: 39.9600, lon: -75.2100 },
  { lat: 39.9800, lon: -75.2500 },
  { lat: 40.0300, lon: -75.3100 },
  { lat: 40.0918, lon: -75.3963 }
];

const TOTAL_POINTS = 320;
const TOTAL_BINS = 32;
const SEGMENTS = 4;
const BINS_PER_SEGMENT = 8;

let selectedSegment = 0;
let blinkState = true;

let mode = "live"; // "live" or "history"
let liveBins = [];
let historicalSnapshots = [];
let selectedHistoryIndex = 0;

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
  if (percent < 60) return [255, 140, 0];
  if (percent < 99) return [213, 182, 10];
  return [0, 100, 0];
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

  return bins;
}

function loadHistoryCsv() {
  if (!fs.existsSync(HISTORY_FILE)) {
    console.log("No history.csv found.");
    return [];
  }

  const text = fs.readFileSync(HISTORY_FILE, "utf8").trim();
  if (!text) return [];

  const lines = text.split(/\r?\n/);
  const headers = lines[0].split("\t");

  const hourIndex = headers.indexOf("hour");
  const timestampIndex = headers.indexOf("timestamp");
  const latIndex = headers.indexOf("lat");
  const percentIndex = headers.indexOf("congestionPercent");

  if (latIndex === -1 || percentIndex === -1) {
    console.log("CSV is missing lat or congestionPercent column.");
    return [];
  }

  const timeIndex = hourIndex !== -1 ? hourIndex : timestampIndex;

  const grouped = {};

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;

    const cols = line.split("\t");

    const time = cols[timeIndex];
    const lat = Number(cols[latIndex]);
    const congestionPercent = Number(cols[percentIndex]);

    if (!time || Number.isNaN(lat) || Number.isNaN(congestionPercent)) {
      continue;
    }

    if (!grouped[time]) grouped[time] = [];

    grouped[time].push({
      latitude: lat,
      congestionPercent
    });
  }

  const snapshots = [];

  for (const [timestamp, rows] of Object.entries(grouped)) {
    rows.sort((a, b) => a.latitude - b.latitude);

    const binSize = Math.ceil(rows.length / TOTAL_BINS);
    const bins = [];

    for (let i = 0; i < TOTAL_BINS; i++) {
      const start = i * binSize;
      const end = Math.min(start + binSize, rows.length);
      const section = rows.slice(start, end);

      bins.push({
        congestionPercent: section.length
          ? mean(section, d => d.congestionPercent)
          : 0
      });
    }

    snapshots.push({
      timestamp,
      bins
    });
  }

  snapshots.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  return snapshots;
}


function getCurrentBins() {
  if (mode === "live") return liveBins;

  if (!historicalSnapshots.length) return liveBins;

  if (selectedHistoryIndex >= historicalSnapshots.length) {
    selectedHistoryIndex = 0;
  }

  return historicalSnapshots[selectedHistoryIndex]?.bins || liveBins;
}

function displayWindow() {
  const allBins = getCurrentBins();

  if (!allBins || !allBins.length) {
    console.log("No bins available to display.");
    sense.clear();
    return;
  }

  const start = selectedSegment * BINS_PER_SEGMENT;
  const visible = allBins.slice(start, start + BINS_PER_SEGMENT);

  const pixels = [];

  for (let row = 0; row < 8; row++) {
    const percent = visible[row]?.congestionPercent ?? 0;
    const color = congestionColor(percent);
    const segmentBlock = Math.floor(row / 2);

    for (let col = 0; col < 8; col++) {
      if (col < 5) {
        pixels.push(color);
      } else {
        if (segmentBlock === selectedSegment) {
          pixels.push([0, 0, 80]);
        } else {
          pixels.push([0, 0, 0]);
        }
      }
    }
  }

  sense.setPixels(pixels);

  if (mode === "live") {
    console.log(`LIVE | Segment ${selectedSegment + 1}`);
  } else {
    if (!historicalSnapshots.length) {
      console.log("HIST mode selected, but no historical snapshots loaded.");
      return;
    }

    if (selectedHistoryIndex >= historicalSnapshots.length) {
      selectedHistoryIndex = 0;
    }

    const snap = historicalSnapshots[selectedHistoryIndex];

    if (!snap) {
      console.log("Historical snapshot is undefined.");
      return;
    }

    console.log(
      `HIST ${selectedHistoryIndex + 1}/${historicalSnapshots.length} | ${snap.timestamp} | Segment ${selectedSegment + 1}`
    );
  }
}
function nextSegment() {
  selectedSegment = (selectedSegment + 1) % SEGMENTS;
  displayWindow();
}

function prevSegment() {
  selectedSegment = (selectedSegment - 1 + SEGMENTS) % SEGMENTS;
  displayWindow();
}

function nextHistory() {
  if (mode !== "history") {
    mode = "history";
    sense.showMessage("HIST", 0.05);
  }

  if (!historicalSnapshots.length) {
    sense.showMessage("NO HIST", 0.05);
    return;
  }

  selectedHistoryIndex =
    (selectedHistoryIndex + 1) % historicalSnapshots.length;

  sense.showMessage(`T ${selectedHistoryIndex + 1}`, 0.05);
  displayWindow();
}

function prevHistory() {
  if (mode !== "history") {
    mode = "history";
    sense.showMessage("HIST", 0.05);
  }

  if (!historicalSnapshots.length) {
    sense.showMessage("NO HIST", 0.05);
    return;
  }

  selectedHistoryIndex =
    (selectedHistoryIndex - 1 + historicalSnapshots.length) %
    historicalSnapshots.length;

  sense.showMessage(`T ${selectedHistoryIndex + 1}`, 0.05);
  displayWindow();
}

function toggleMode() {
  if (mode === "live") {
    mode = "history";

    if (!historicalSnapshots.length) {
      sense.showMessage("NO HIST", 0.05);
      mode = "live";
      return;
    }

    sense.showMessage("HIST", 0.05);
  } else {
    mode = "live";
    sense.showMessage("LIVE", 0.05);
  }

  displayWindow();
}

setInterval(() => {
  blinkState = !blinkState;
  displayWindow();
}, 500);

joystick.on("down", () => {
  nextSegment();
});

joystick.on("up", () => {
  prevSegment();
});

joystick.on("right", () => {
  nextHistory();
});

joystick.on("left", () => {
  prevHistory();
});

joystick.on("enter", () => {
  toggleMode();
});

async function init() {
  sense.showMessage("LOAD I76", 0.05);

  historicalSnapshots = loadHistoryCsv();
  console.log(`Loaded ${historicalSnapshots.length} historical snapshots.`);

  const points = buildPoints();
  const traffic = await fetchTrafficBatched(points);

  liveBins = buildBins(traffic);

  sense.showMessage("READY", 0.05);
  sense.showMessage("LIVE", 0.05);

  displayWindow();
}

function shutdown() {
  console.log("Shutting down...");
  joystick.end();
  sense.clear();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

init();