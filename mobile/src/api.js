// Point this at your live Render URL once deployed
const BASE_URL = 'https://ai-caddie.onrender.com';

let _token = null;

export function setToken(token) {
  _token = token;
}

export function clearToken() {
  _token = null;
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.detail || `Request failed (${res.status})`);
  }
  return data;
}

export async function register(email, password) {
  return request('/api/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function login(email, password) {
  return request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function getProfile() {
  return request('/api/me');
}

export async function setupClubs(clubs) {
  return request('/api/setup-clubs', {
    method: 'POST',
    body: JSON.stringify({ clubs }),
  });
}

export async function getClubRecommendation(distance, lie, wind) {
  return request('/api/club-recommendation', {
    method: 'POST',
    body: JSON.stringify({ distance: parseFloat(distance), lie, wind }),
  });
}

export async function getCourseStrategy(hole_par, hole_length, hazards, hole_shape) {
  return request('/api/course-strategy', {
    method: 'POST',
    body: JSON.stringify({ hole_par, hole_length, hazards, hole_shape }),
  });
}

export async function startRound(courseName) {
  return request('/api/start-round', {
    method: 'POST',
    body: JSON.stringify({ course_name: courseName }),
  });
}

export async function addHole(roundId, holeData) {
  return request('/api/add-hole', {
    method: 'POST',
    body: JSON.stringify({ round_id: roundId, ...holeData }),
  });
}

export async function getRounds() {
  return request('/api/rounds');
}

export async function deleteRound(roundId) {
  const res = await fetch(`${BASE_URL}/api/rounds/${roundId}`, {
    method: 'DELETE',
    headers: _token ? { Authorization: `Bearer ${_token}` } : {},
  });
  if (res.status === 204) return;
  const data = await res.json();
  throw new Error(data.detail || `Request failed (${res.status})`);
}
