// app.js - frontend logic
const apiBase = '/api';
let currentUser = null;

const socket = io();

// login/register forms
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    name: fd.get('name'),
    email: fd.get('email'),
    password: fd.get('password'),
    role: fd.get('role')
  };
  const res = await fetch(apiBase + '/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (res.ok) {
    alert('Registered. Now login.');
    e.target.reset();
  } else {
    alert(data.error || 'Error registering');
  }
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = { email: fd.get('email'), password: fd.get('password') };
  const res = await fetch(apiBase + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (res.ok) {
    currentUser = data.user;
    onLogin();
    e.target.reset();
  } else {
    alert(data.error || 'Login failed');
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  currentUser = null;
  onLogout();
});

// create listing
document.getElementById('createListingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) return alert('login first');
  const fd = new FormData(e.target);
  const payload = {
    donorId: currentUser.id,
    title: fd.get('title'),
    description: fd.get('description'),
    quantity: fd.get('quantity'),
   address: fd.get('address')

  };
  const res = await fetch(apiBase + '/listings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (res.ok) {
    e.target.reset();
    addNotification('Listing posted: ' + data.listing.title);
    loadListings();
  } else {
    alert(data.error || 'Error posting');
  }
});

// load listings
async function loadListings() {
  const res = await fetch(apiBase + '/listings');
  const data = await res.json();
  const div = document.getElementById('listings');
  div.innerHTML = '';
  data.listings.forEach(l => {
    const el = document.createElement('div');
    el.className = 'listing';
    el.innerHTML = `
      <strong>${escapeHtml(l.title)}</strong>
      <div class="small">Status: ${l.status} • Posted: ${new Date(l.createdAt).toLocaleString()}</div>
      <div>${escapeHtml(l.description)}</div>
      <div class="small">Quantity: ${escapeHtml(l.quantity || '')}</div>
    `;
    if (l.status === 'available' && currentUser && currentUser.role !== 'donor') {
      const btn = document.createElement('button');
      btn.textContent = 'Accept Pickup';
      btn.style.marginTop = '8px';
      btn.onclick = async () => {
        const res2 = await fetch(apiBase + `/listings/${l.id}/accept`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUser.id })
        });
        const d2 = await res2.json();
        if (res2.ok) {
          addNotification('Accepted listing: ' + l.title);
          loadListings();
        } else alert(d2.error || 'Error');
      };
      el.appendChild(btn);
    }
    div.appendChild(el);
  });
}

// notifications
function addNotification(text) {
  const ul = document.getElementById('notifications');
  const li = document.createElement('li');
  li.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  ul.prepend(li);
}

// socket events
socket.on('connect', () => {
  console.log('connected socket');
  if (currentUser) socket.emit('identify', currentUser.id);
});

socket.on('new_listing', (listing) => {
  addNotification('New listing: ' + listing.title);
  loadListings();
});

socket.on('listing_accepted', (payload) => {
  addNotification('Listing accepted: ' + payload.listingId);
  loadListings();
});

function onLogin() {
  document.getElementById('loggedIn').style.display = 'block';
  document.getElementById('userName').textContent = currentUser.name;
  document.getElementById('userRole').textContent = currentUser.role;
  if (currentUser.role === 'donor') {
    document.getElementById('donorArea').style.display = 'block';
  } else {
    document.getElementById('donorArea').style.display = 'none';
  }
  if (socket && socket.connected) socket.emit('identify', currentUser.id);
  loadListings();
}

function onLogout() {
  document.getElementById('loggedIn').style.display = 'none';
  document.getElementById('donorArea').style.display = 'none';
  document.getElementById('userName').textContent = '';
  document.getElementById('userRole').textContent = '';
  loadListings();
}

// small helper
function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

// initial load
loadListings();
