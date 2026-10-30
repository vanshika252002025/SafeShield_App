require("dotenv").config();
const express = require("express");
const pool = require("./config/db");
const authRoutes = require("./routes/auth");
const contactRoutes = require("./routes/contacts");
const alertRoutes = require("./routes/alerts");
const trackRoutes = require("./routes/track");

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/contacts", contactRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/", trackRoutes); // public live-tracking page for the link in the SOS SMS

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Temporary test route to prove the DB connection works
app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ connected: true, time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ connected: false, error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`SheShield backend running on port ${PORT}`));