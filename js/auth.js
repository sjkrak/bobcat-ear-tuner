// Simple shared-password gate. This deters casual visitors and bots from
// using the page or writing to the Sheet — it is NOT real security, since
// the password lives in plain sight in this file's source. Don't reuse a
// password that matters elsewhere.
const SHARED_PASSWORD = '1953';
const STORAGE_KEY = 'bobcatEarTunerAuthed';

export function getSharedSecret() {
  return SHARED_PASSWORD;
}

export function initAuthGate(onUnlock) {
  const gate = document.getElementById('authGate');
  const main = document.getElementById('appMain');
  const form = document.getElementById('authForm');
  const input = document.getElementById('authPassword');
  const error = document.getElementById('authError');

  function unlock() {
    gate.hidden = true;
    main.hidden = false;
    onUnlock();
  }

  if (localStorage.getItem(STORAGE_KEY) === 'yes') {
    unlock();
    return;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.value === SHARED_PASSWORD) {
      localStorage.setItem(STORAGE_KEY, 'yes');
      unlock();
    } else {
      error.hidden = false;
      input.value = '';
      input.focus();
    }
  });

  input.focus();
}
