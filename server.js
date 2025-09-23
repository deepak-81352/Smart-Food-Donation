// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const bcrypt = require('bcrypt');
const { nanoid } = require('nanoid');
const { Server } = require('socket.io');
const { db, init } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// init db
init();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Simple in-memory map of socketId -> userId for notification routing
const socketUser = new Map();

// --- Socket.IO events ---
io.on('connection', (socket) => {
  // client can send 'identify' after login to associate socket with userId
  socket.on('identify', (userId) => {
    socketUser.set(socket.id, userId);
    // console.log('socket identify', socket.id, userId);
  });

  socket.on('disconnect', () => {
    socketUser.delete(socket.id);
  });
});

// Utility: broadcast to all connected clients (or you can target)
function broadcastEvent(event, payload) {
  io.emit(event, payload);
}

// --- Auth endpoints (very simple) ---
app.post('/api/register', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'missing fields' });
  await db.read();
  const exists = db.data.users.find(u => u.email === email);
  if (exists) return res.status(400).json({ error: 'email already registered' });
  const hash = await bcrypt.hash(password, 10);
  const user = { id: nanoid(), name, email, passwordHash: hash, role, createdAt: new Date().toISOString() };
  db.data.users.push(user);
  await db.write();
  // don't return hash
  const { passwordHash, ...safe } = user;
  res.json({ user: safe });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  await db.read();
  const user = db.data.users.find(u => u.email === email);
  if (!user) return res.status(400).json({ error: 'invalid credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'invalid credentials' });
  const { passwordHash, ...safe } = user;
  // Note: For simplicity we return user object as 'session'. In production use JWT/httpOnly cookie.
  res.json({ user: safe });
});

// --- Listings endpoints ---
app.post('/api/listings', async (req, res) => {
  // expected body: { donorId, title, description, quantity, lng, lat, pickupWindowStart, pickupWindowEnd }
  const { donorId, title, description, quantity, lng, lat, pickupWindowStart, pickupWindowEnd } = req.body;
  if (!donorId || !title) return res.status(400).json({ error: 'missing donorId or title' });
  await db.read();
  const listing = {
    id: nanoid(),
    donorId,
    title,
    description: description || '',
    quantity: quantity || '',
    location: { lng: parseFloat(lng) || 0, lat: parseFloat(lat) || 0 },
    pickupWindow: { start: pickupWindowStart || null, end: pickupWindowEnd || null },
    status: 'available',
    acceptedBy: null,
    createdAt: new Date().toISOString()
  };
  db.data.listings.unshift(listing);
  await db.write();

  // notify all connected clients (NGOs/volunteers)
  broadcastEvent('new_listing', listing);

  res.status(201).json({ listing });
});

app.get('/api/listings', async (req, res) => {
  await db.read();
  // support ?status=
  const { status } = req.query;
  let items = db.data.listings;
  if (status) items = items.filter(l => l.status === status);
  res.json({ listings: items });
});

app.get('/api/listings/:id', async (req, res) => {
  await db.read();
  const l = db.data.listings.find(x => x.id === req.params.id);
  if (!l) return res.status(404).json({ error: 'not found' });
  res.json({ listing: l });
});

app.post('/api/listings/:id/accept', async (req, res) => {
  // body: { userId }
  const listingId = req.params.id;
  const { userId } = req.body;
  await db.read();
  const listing = db.data.listings.find(l => l.id === listingId);
  if (!listing) return res.status(404).json({ error: 'not found' });
  if (listing.status !== 'available') return res.status(400).json({ error: 'not available' });
  listing.status = 'accepted';
  listing.acceptedBy = userId;
  listing.acceptedAt = new Date().toISOString();
  await db.write();

  // notify donor and others
  broadcastEvent('listing_accepted', { listingId, by: userId });

  res.json({ listing });
});

// mark picked
app.post('/api/listings/:id/mark-picked', async (req, res) => {
  const listingId = req.params.id;
  const { userId } = req.body;
  await db.read();
  const listing = db.data.listings.find(l => l.id === listingId);
  if (!listing) return res.status(404).json({ error: 'not found' });
  listing.status = 'picked';
  listing.pickedAt = new Date().toISOString();
  await db.write();
  broadcastEvent('listing_picked', { listingId, by: userId });
  res.json({ listing });
});

// mark delivered
app.post('/api/listings/:id/mark-delivered', async (req, res) => {
  const listingId = req.params.id;
  const { userId } = req.body;
  await db.read();
  const listing = db.data.listings.find(l => l.id === listingId);
  if (!listing) return res.status(404).json({ error: 'not found' });
  listing.status = 'delivered';
  listing.deliveredAt = new Date().toISOString();
  await db.write();
  broadcastEvent('listing_delivered', { listingId, by: userId });
  res.json({ listing });
});

// serve frontend index
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
