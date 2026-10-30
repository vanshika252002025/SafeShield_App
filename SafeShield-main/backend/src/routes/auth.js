const requireAuth = require("../middleware/auth");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");

const router = express.Router();

router.post("/register", async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email and password are required" });
    }

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email`,
      [name, email.toLowerCase(), phone || null, passwordHash]
    );

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });

    res.status(201).json({ token, user });
  } catch (err) {
    res.status(500).json({ error: "Registration failed", detail: err.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const result = await pool.query(
      "SELECT id, name, email, password_hash FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (err) {
    res.status(500).json({ error: "Login failed", detail: err.message });
  }
});

router.delete("/account", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM users WHERE id = $1", [req.userId]);
    res.json({ message: "Account deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Could not delete account", detail: err.message });
  }
});

router.post("/set-pin", requireAuth, async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || pin.length < 4) {
      return res.status(400).json({ error: "PIN must be at least 4 digits" });
    }
    const pinHash = await bcrypt.hash(pin, 12);
    await pool.query("UPDATE users SET sos_pin_hash = $1 WHERE id = $2", [pinHash, req.userId]);
    res.json({ message: "PIN set successfully" });
  } catch (err) {
    res.status(500).json({ error: "Could not set PIN", detail: err.message });
  }
});

router.post("/verify-pin", requireAuth, async (req, res) => {
  try {
    const { pin } = req.body;
    const result = await pool.query("SELECT sos_pin_hash FROM users WHERE id = $1", [req.userId]);
    const user = result.rows[0];

    if (!user.sos_pin_hash) {
      return res.status(400).json({ error: "No PIN has been set for this account" });
    }

    const valid = await bcrypt.compare(pin, user.sos_pin_hash);
    res.json({ valid });
  } catch (err) {
    res.status(500).json({ error: "Could not verify PIN", detail: err.message });
  }
});

module.exports = router;