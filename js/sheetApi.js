import { getSharedSecret } from './auth.js';

const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbz0datq8xpeCNwAON5_hPrauDC6XP7CgA8zgoXiILJyIynOKOWlaFIunu2pA1DiNJd5/exec';

// POST as text/plain to avoid a CORS preflight (Apps Script doesn't handle OPTIONS).
export async function logAttempt(data) {
  await fetch(WEBAPP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...data, secret: getSharedSecret() }),
  });
}

export async function getHistory(student) {
  const params = new URLSearchParams({ student, secret: getSharedSecret() });
  const res = await fetch(`${WEBAPP_URL}?${params}`);
  if (!res.ok) throw new Error(`Sheet request failed: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}
