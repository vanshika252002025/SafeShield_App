const crypto = require("crypto");
const express = require("express");
const pool = require("../config/db");
const requireAuth = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.post("/", async (req, res) => {
  try {
    const { trigger_type, latitude, longitude } = req.body;

    // Secret token for the live-tracking link that goes out in the SMS
    const trackingToken = crypto.randomBytes(16).toString("hex");

    const result = await pool.query(
      `INSERT INTO alerts (user_id, trigger_type, status, latitude, longitude, tracking_token, location_updated_at)
       VALUES ($1, $2, 'verifying', $3, $4, $5, NOW())
       RETURNING *`,
      [req.userId, trigger_type || "manual", latitude || null, longitude || null, trackingToken]
    );

    res.status(201).json({ alert: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Could not create alert", detail: err.message });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const { status, latitude, longitude } = req.body;
    const resolvedAt = ["cancelled", "completed"].includes(status) ? new Date() : null;

    const result = await pool.query(
      `UPDATE alerts
       SET status = COALESCE($1, status),
           resolved_at = COALESCE($2, resolved_at),
           latitude = COALESCE($3, latitude),
           longitude = COALESCE($4, longitude),
           location_updated_at = CASE WHEN $3::double precision IS NOT NULL THEN NOW() ELSE location_updated_at END
       WHERE id = $5 AND user_id = $6
       RETURNING *`,
      [status, resolvedAt, latitude, longitude, req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Alert not found" });
    }

    res.json({ alert: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Could not update alert", detail: err.message });
  }
});

router.post("/:id/actions", async (req, res) => {
  try {
    const { contact_id, action_type, status } = req.body;

    const result = await pool.query(
      `INSERT INTO alert_actions (alert_id, contact_id, action_type, status)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.params.id, contact_id || null, action_type, status]
    );

    res.status(201).json({ action: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Could not record action", detail: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const alertResult = await pool.query(
      "SELECT * FROM alerts WHERE id = $1 AND user_id = $2",
      [req.params.id, req.userId]
    );
    if (alertResult.rows.length === 0) {
      return res.status(404).json({ error: "Alert not found" });
    }

    const actionsResult = await pool.query(
      "SELECT * FROM alert_actions WHERE alert_id = $1",
      [req.params.id]
    );

    res.json({ alert: alertResult.rows[0], actions: actionsResult.rows });
  } catch (err) {
    res.status(500).json({ error: "Could not fetch alert", detail: err.message });
  }
});

module.exports = router;