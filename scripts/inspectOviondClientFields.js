#!/usr/bin/env node
// One-off diagnostic: dump raw Oviond client record to check for
// address fields we may not be capturing. Read-only, no writes.
require('dotenv').config();
const OVIOND_API_KEY = process.env.OVIOND_API_KEY;
async function main() {
  const res = await fetch('https://api.oviond.com/v1/clients', {
    headers: { Authorization: `Bearer ${OVIOND_API_KEY}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  const clients = data.data || data.clients || data;
  console.log(JSON.stringify(Array.isArray(clients) ? clients[0] : clients, null, 2));
}
main().catch((e) => console.error(e));
