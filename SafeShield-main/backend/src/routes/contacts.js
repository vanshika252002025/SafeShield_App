const express = require("express");
const pool = require("../config/db");
const requireAuth = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM contacts WHERE user_id = $1 ORDER BY call_order ASC",
      [req.userId]
    );
    res.json({ contacts: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Could not fetch contacts", detail: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, phone, relation, receives_sms, receives_live_location, is_primary_call, call_order } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: "name and phone are required" });
    }

    const result = await pool.query(
      `INSERT INTO contacts (user_id, name, phone, relation, receives_sms, receives_live_location, is_primary_call, call_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.userId,
        name,
        phone,
        relation || null,
        receives_sms ?? true,
        receives_live_location ?? true,
        is_primary_call ?? false,
        call_order ?? 0,
      ]
    );

    res.status(201).json({ contact: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Could not add contact", detail: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { name, phone, relation, receives_sms, receives_live_location, is_primary_call, call_order } = req.body;

    // If this contact is being set as primary, un-set any other primary contact first.
    if (is_primary_call === true) {
      await pool.query(
        "UPDATE contacts SET is_primary_call = false WHERE user_id = $1 AND id != $2",
        [req.userId, req.params.id]
      );
    }

    const result = await pool.query(
      `UPDATE contacts
       SET name = COALESCE($1, name),
           phone = COALESCE($2, phone),
           relation = COALESCE($3, relation),
           receives_sms = COALESCE($4, receives_sms),
           receives_live_location = COALESCE($5, receives_live_location),
           is_primary_call = COALESCE($6, is_primary_call),
           call_order = COALESCE($7, call_order)
       WHERE id = $8 AND user_id = $9
       RETURNING *`,
      [name, phone, relation, receives_sms, receives_live_location, is_primary_call, call_order, req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Contact not found" });
    }

    res.json({ contact: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Could not update contact", detail: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM contacts WHERE id = $1 AND user_id = $2 RETURNING id",
      [req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Contact not found" });
    }

    res.json({ message: "Contact deleted" });
  } catch (err) {
    res.status(500).json({ error: "Could not delete contact", detail: err.message });
  }
});

module.exports = router;