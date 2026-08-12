require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testConnection() {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .limit(1);

  if (error) {
    console.error('SUPABASE ERROR:', error.message);
    process.exit(1);
  }

  console.log('SUCCESS: AWS is connected to Supabase.');
  console.log('Clients found:', data.length);
}

testConnection();
