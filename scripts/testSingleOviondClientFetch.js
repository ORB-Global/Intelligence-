#!/usr/bin/env node
require('dotenv').config();
const OVIOND_API_KEY = process.env.OVIOND_API_KEY;
async function main() {
  const id = process.argv[2] || 'asEHbZxESAKBDSSjj'; // Easley's real oviond_client_id
  const res = await fetch(`https://api.oviond.com/v1/clients/${id}`, {
    headers: { Authorization: `Bearer ${OVIOND_API_KEY}` },
  });
  console.log('HTTP status:', res.status);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2).slice(0, 1500));
}
main().catch(console.error);
