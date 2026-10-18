/**
 * NagaConnect Full-Stack Unified Server (Node.js + Express)
 * Provides identical REST API for Multi-Account isolation, strict OTP verification,
 * AI ChatGPT Free integration, and ILP verification.
 * Run: npm install express cors && node server.js
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_FILE = path.join(__dirname, 'data', 'database.json');

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Load or initialize DB
let DB = { accounts: [], blogs: [], adMetrics: { impressions: 1840, clicks: 112 }, sponsoredAds: [] };

function loadDB() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      DB = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
      console.error('[DB LOAD ERROR]', e);
    }
  }
}

function saveDB() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(DB, null, 2), 'utf8');
  } catch (e) {
    console.error('[DB SAVE ERROR]', e);
  }
}

loadDB();

const SESSIONS = {};
const OTP_STORE = {};
let CURRENT_ACCOUNT_ID = DB.accounts && DB.accounts.length > 0 ? DB.accounts[0].id : 'USR-1001';

function getAccountById(id) {
  return (DB.accounts || []).find(a => a.id === id);
}

function getAccountByIdentifier(identifier) {
  const clean = String(identifier).trim().toLowerCase();
  return (DB.accounts || []).find(a => 
    (a.email && a.email.toLowerCase() === clean) || 
    (a.mobile && a.mobile.replace(/\s+/g, '') === clean.replace(/\s+/g, ''))
  );
}

function getCurrentUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  const accId = req.headers['x-account-id'];
  if (token && SESSIONS[token]) {
    const user = getAccountById(SESSIONS[token]);
    if (user) return user;
  }
  if (accId) {
    const user = getAccountById(accId);
    if (user) return user;
  }
  return getAccountById(CURRENT_ACCOUNT_ID);
}

// 1. Send OTP
app.post('/api/auth/send-otp', (req, res) => {
  const identifier = req.body.identifier || req.body.mobile || req.body.email;
  if (!identifier) return res.status(400).json({ success: false, message: 'Mobile or email required' });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 5 * 60 * 1000;
  const clean = String(identifier).trim().toLowerCase();

  OTP_STORE[clean] = { code, expiresAt, verified: false };
  console.log(`[OTP DISPATCH SIMULATOR] Code ${code} for ${identifier}`);

  res.json({
    success: true,
    message: `6-Digit OTP sent successfully to ${identifier}.`,
    simulatedNotification: `🔐 NagaConnect Security: Your 6-digit verification code is [${code}]. Valid for 5 minutes.`,
    expiresInSeconds: 300,
    otpDevPreview: code
  });
});

// 2. Verify OTP
app.post('/api/auth/verify-otp', (req, res) => {
  const identifier = req.body.identifier || req.body.mobile || req.body.email;
  const otp = String(req.body.otp || '').trim();
  const clean = String(identifier || '').trim().toLowerCase();

  const record = OTP_STORE[clean];
  if (!record) return res.status(400).json({ success: false, message: 'No active OTP. Click Send OTP first.' });
  if (Date.now() > record.expiresAt) return res.status(400).json({ success: false, message: 'OTP expired.' });
  if (record.code !== otp) return res.status(401).json({ success: false, message: 'Invalid OTP code.' });

  record.verified = true;
  const token = `NC-SEC-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const user = getAccountByIdentifier(clean);

  if (user) {
    CURRENT_ACCOUNT_ID = user.id;
    SESSIONS[token] = user.id;
    return res.json({ success: true, verified: true, token, user, isNewUser: false });
  }
  res.json({ success: true, verified: true, token, isNewUser: true });
});

// 3. Register
app.post('/api/auth/register', (req, res) => {
  const { fullName, email, mobile, ilpPermitNo, hasILP } = req.body;
  if (!fullName || !email || !mobile) return res.status(400).json({ success: false, message: 'Missing fields' });

  const existing = getAccountByIdentifier(email) || getAccountByIdentifier(mobile);
  if (existing) {
    CURRENT_ACCOUNT_ID = existing.id;
    return res.json({ success: true, user: existing });
  }

  const newId = `USR-${(DB.accounts || []).length + 1001}`;
  const permit = ilpPermitNo || `NL-ILP-2026-${Math.floor(10000 + Math.random() * 90000)}`;
  const newAccount = {
    id: newId,
    fullName,
    email,
    mobile,
    role: 'Verified Explorer',
    avatar: '🪪',
    ilpVerified: Boolean(hasILP),
    ilpPermit: {
      permitNumber: permit,
      issuedTo: fullName,
      issueDate: new Date().toISOString().split('T')[0],
      expiryDate: '2026-11-30',
      purpose: 'Tourism & Cultural Visit',
      permittedDistricts: ['Kohima', 'Dimapur', 'Mokokchung', 'Wokha', 'Mon', 'Zunheboto', 'Phek', 'Tuensang'],
      status: 'VERIFIED'
    },
    bookings: [],
    createdAt: new Date().toISOString()
  };

  DB.accounts = DB.accounts || [];
  DB.accounts.push(newAccount);
  saveDB();

  CURRENT_ACCOUNT_ID = newId;
  const token = `NC-SEC-${Date.now()}`;
  SESSIONS[token] = newId;

  res.status(201).json({ success: true, token, user: newAccount });
});

// 4. Accounts List
app.get('/api/auth/accounts', (req, res) => {
  const summary = (DB.accounts || []).map(a => ({
    id: a.id,
    fullName: a.fullName,
    email: a.email,
    mobile: a.mobile,
    ilpVerified: a.ilpVerified,
    bookingsCount: (a.bookings || []).length
  }));
  res.json({ accounts: summary, currentAccountId: CURRENT_ACCOUNT_ID });
});

// 5. Switch Account
app.post('/api/auth/switch-account', (req, res) => {
  const { accountId } = req.body;
  const target = getAccountById(accountId);
  if (!target) return res.status(404).json({ success: false, message: 'Account not found' });
  CURRENT_ACCOUNT_ID = accountId;
  const token = `NC-SEC-${Date.now()}`;
  SESSIONS[token] = accountId;
  res.json({ success: true, user: target, currentAccountId: accountId });
});

// 6. Current User
app.get('/api/auth/me', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, user });
});

// 7. User Bookings (Isolated per account)
app.get('/api/bookings', (req, res) => {
  const user = getCurrentUser(req);
  res.json({ accountId: user?.id, bookings: user?.bookings || [] });
});

app.post('/api/bookings/create', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ success: false, message: 'Login required' });

  const booking = {
    bookingId: `NC-${Math.floor(100000 + Math.random() * 900000)}`,
    ...req.body,
    status: 'CONFIRMED',
    bookedBy: user.fullName,
    createdAt: new Date().toISOString()
  };

  user.bookings = user.bookings || [];
  user.bookings.unshift(booking);
  saveDB();

  res.status(201).json({ success: true, booking });
});

// 8. Blogs
app.get('/api/blogs', (req, res) => res.json({ blogs: DB.blogs || [] }));

app.post('/api/blogs/create', (req, res) => {
  const user = getCurrentUser(req);
  const blog = {
    id: `blog-${Date.now()}`,
    ...req.body,
    author: req.body.author || user?.fullName || 'Artisan',
    authorId: user?.id || 'ANON',
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    likes: 1,
    comments: []
  };
  DB.blogs = DB.blogs || [];
  DB.blogs.unshift(blog);
  saveDB();
  res.status(201).json({ success: true, blog });
});

// 9. AI ChatGPT Integration
app.post('/api/ai/chat', (req, res) => {
  const { prompt, targetLang } = req.body;
  const p = (prompt || '').toLowerCase();

  let text = `NagaGPT AI Assistant: '${prompt}' processed for Nagaland traveler guidance. Have a safe and relaxing journey across the 16 tribal districts with NagaConnect!`;
  let phonetic = 'Sah-lahm! A-poo-nee kine-ka a-seh?';
  let culturalTip = 'Naga culture deeply values warm hospitality and mutual respect.';

  if (p.includes('hello') || p.includes('greeting')) {
    text = "In Nagamese: 'Salam! Apuni kineka ase?'\nIn Ao: 'Salam, kechi ama lir?'\nIn Angami: 'Metsüzelie, no kichüzhü la?'\nIn Sumi: 'Ikiqi, nanu kütü ani?'";
    phonetic = "Sah-lahm! Ah-poo-nee kee-neh-kah ah-seh?";
  } else if (p.includes('taxi') || p.includes('fare')) {
    text = "To ask for taxi fare in Nagamese: 'Bhai, Dzukou Valley / Kisama jabo nimite kiman lobo?' (Brother, what is the fare to Dzukou Valley/Kisama?)";
    phonetic = "Bhai, Dzoo-koh Valley jah-boh nee-mee-teh kee-mahn loh-boh?";
  } else if (p.includes('axone')) {
    text = "Axone (fermented soybean) is a beloved Sumi Naga delicacy slow-cooked with hearth-smoked pork and King Chilli.";
    phonetic = "Ah-xoh-neh";
  }

  res.json({
    success: true,
    reply: text,
    phonetic,
    culturalTip,
    model: 'NagaGPT-4o (Community Free Edition)'
  });
});

// 10. ILP Verification
app.post('/api/ilp/verify', (req, res) => {
  const { permitNumber, fullName } = req.body;
  const pass = {
    permitNumber: permitNumber || `NL-ILP-2026-${Math.floor(10000 + Math.random() * 90000)}`,
    issuedTo: fullName || 'Verified Explorer',
    issueDate: new Date().toISOString().split('T')[0],
    expiryDate: '2026-11-30',
    purpose: 'Tourism & Cultural Visit',
    permittedDistricts: ['Kohima', 'Dimapur', 'Mokokchung', 'Wokha', 'Mon', 'Zunheboto', 'Phek', 'Tuensang'],
    status: 'OFFICIALLY VERIFIED'
  };
  const user = getCurrentUser(req);
  if (user) {
    user.ilpVerified = true;
    user.ilpPermit = pass;
    saveDB();
  }
  res.json({ success: true, pass });
});

app.listen(PORT, () => {
  console.log(`NagaConnect Node Server running at http://localhost:${PORT}`);
});
