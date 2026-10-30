CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  sos_pin_hash TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE contacts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  relation TEXT,
  receives_sms BOOLEAN DEFAULT TRUE,
  receives_live_location BOOLEAN DEFAULT TRUE,
  is_primary_call BOOLEAN DEFAULT FALSE,
  call_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE alerts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'verifying',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE alert_actions (
  id SERIAL PRIMARY KEY,
  alert_id INTEGER REFERENCES alerts(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);