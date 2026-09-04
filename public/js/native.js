// www/js/native.js — ALSO copy this file to the server's public/js/native.js and add
//   <script type="module" src="/js/native.js"></script>
// to vantage-home.html and coach.html. It does nothing in a normal browser and
// wires up the native bits when running inside the iOS app.
import { Capacitor } from 'https://cdn.jsdelivr.net/npm/@capacitor/core@6/dist/index.js';

if (Capacitor.isNativePlatform()) {
  const { PushNotifications } = await import('https://cdn.jsdelivr.net/npm/@capacitor/push-notifications@6/dist/esm/index.js');
  const { StatusBar, Style } = await import('https://cdn.jsdelivr.net/npm/@capacitor/status-bar@6/dist/esm/index.js');
  const { Haptics, ImpactStyle } = await import('https://cdn.jsdelivr.net/npm/@capacitor/haptics@6/dist/esm/index.js');

  await StatusBar.setStyle({ style: Style.Dark });
  document.documentElement.classList.add('native');

  // Ask for push permission once the person is signed in (token present)
  const token = window.VANTAGE_TOKEN || localStorage.getItem('vantage_token');
  const locationId = window.VANTAGE_LOCATION_ID || localStorage.getItem('vantage_location_id');
  if (token) {
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive === 'granted') await PushNotifications.register();
  }
  PushNotifications.addListener('registration', async ({ value }) => {
    // Save the device token so the server can send the morning brief as a push
    await fetch('/api/push/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ device_token: value, platform: 'ios', location_id: locationId }) }).catch(() => {});
  });
  PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const url = notification?.data?.url; if (url) location.href = url;
  });

  // Light tap feedback on the check-in mood buttons
  document.addEventListener('click', e => { if (e.target.closest('.moods button')) Haptics.impact({ style: ImpactStyle.Light }); });
}
