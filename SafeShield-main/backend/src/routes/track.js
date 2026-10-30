const express = require("express");
const pool = require("../config/db");

const router = express.Router();

// A tracking link stops working this long after the alert started
const MAX_AGE_HOURS = 24;

async function findAlert(token) {
  // Tokens are 32 random hex characters. Anything else is rejected without touching the database.
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const result = await pool.query(
    `SELECT a.status, a.latitude, a.longitude, a.location_updated_at, u.name
     FROM alerts a
     JOIN users u ON u.id = a.user_id
     WHERE a.tracking_token = $1
       AND a.created_at > NOW() - INTERVAL '${MAX_AGE_HOURS} hours'`,
    [token]
  );
  return result.rows[0] || null;
}

// Data for the page. Public, but only reachable with the secret token from the SMS.
router.get("/api/track/:token", async (req, res) => {
  try {
    const alert = await findAlert(req.params.token);
    res.set("Cache-Control", "no-store");
    if (!alert) {
      return res.status(404).json({ error: "This link has expired or is not valid." });
    }
    res.json({
      name: alert.name,
      status: alert.status,
      latitude: alert.latitude,
      longitude: alert.longitude,
      updatedAt: alert.location_updated_at,
    });
  } catch (err) {
    res.status(500).json({ error: "Could not load the live location." });
  }
});

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>SheShield live location</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
  html, body { height: 100%; margin: 0; font-family: system-ui, sans-serif; }
  body { display: flex; flex-direction: column; }
  #bar { padding: 12px 14px; background: #B0295E; color: #fff; }
  #bar h1 { font-size: 18px; margin: 0 0 4px; }
  #bar p { margin: 2px 0 0; font-size: 14px; }
  #map { flex: 1; }
  #open { position: fixed; z-index: 1000; left: 12px; right: 12px; bottom: 14px; text-align: center;
          background: #fff; color: #B0295E; font-weight: 700; padding: 12px; border-radius: 10px;
          box-shadow: 0 2px 8px rgba(0,0,0,.3); text-decoration: none; display: none; }
</style>
</head>
<body>
<div id="bar"><h1 id="title">SheShield</h1><p id="status">Loading...</p><p id="age"></p></div>
<div id="map"></div>
<a id="open" href="#" target="_blank" rel="noopener">Open in Google Maps</a>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var token = location.pathname.split("/").pop();
  var map = L.map("map").setView([20.5937, 78.9629], 5);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  var marker = null;
  var zoomed = false;
  var timer = null;

  function ago(ts) {
    var s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
    if (s < 60) return s + " seconds ago";
    var m = Math.round(s / 60);
    return m + (m === 1 ? " minute ago" : " minutes ago");
  }

  function describe(status) {
    if (status === "cancelled") return "The alert was cancelled. She is safe.";
    if (status === "completed") return "She has marked herself safe.";
    if (status === "verifying") return "An alert is starting...";
    return "LIVE: an SOS alert is in progress";
  }

  function refresh() {
    fetch("/api/track/" + token, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("gone");
        return r.json();
      })
      .then(function (d) {
        var live = d.status !== "cancelled" && d.status !== "completed";
        document.getElementById("title").textContent = live ? d.name + " may need help" : "SheShield";
        document.getElementById("status").textContent = describe(d.status);

        if (d.latitude !== null && d.longitude !== null) {
          var pos = [Number(d.latitude), Number(d.longitude)];
          if (!marker) marker = L.marker(pos).addTo(map); else marker.setLatLng(pos);
          if (!zoomed) { map.setView(pos, 16); zoomed = true; } else { map.panTo(pos); }
          document.getElementById("age").textContent = d.updatedAt ? "Location updated " + ago(d.updatedAt) : "";
          var link = document.getElementById("open");
          link.href = "https://maps.google.com/?q=" + pos[0] + "," + pos[1];
          link.style.display = "block";
        } else {
          document.getElementById("age").textContent = "Waiting for her location...";
        }

        if (!live) clearInterval(timer);
      })
      .catch(function () {
        document.getElementById("title").textContent = "Link not available";
        document.getElementById("status").textContent = "This link has expired or is not valid.";
        document.getElementById("age").textContent = "";
        clearInterval(timer);
      });
  }

  refresh();
  timer = setInterval(refresh, 8000);
</script>
</body>
</html>`;

router.get("/track/:token", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.type("html").send(PAGE);
});

module.exports = router;