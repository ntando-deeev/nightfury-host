const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Uptime ping endpoint (keeps Render free tier alive)
app.get('/ping', (req, res) => {
  res.json({ status: 'alive', bot: 'NightFury Bot', time: new Date().toISOString() });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🔥 NightFury Host running on port ${PORT}`);
});
