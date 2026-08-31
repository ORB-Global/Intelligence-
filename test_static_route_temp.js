const express = require('express');
const path = require('path');
const app = express();

['/vantage-v44.html', '/mission-control.html'].forEach((route) => {
  app.get(route, (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.sendFile(path.join(__dirname, 'public', route));
  });
});
app.use(express.static(path.join(__dirname, 'public')));

app.listen(8901, () => console.log('real test server up'));
