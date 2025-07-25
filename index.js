// index.js
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000; // Use environment port or default to 3000

// Serve static files (like CSS, JS, images) from the current directory
// This assumes index.html, along with its CSS/JS, are in the same directory as index.js
app.use(express.static(__dirname));

// Serve index.html for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the server
app.listen(PORT, () => {
    console.log(`IP Tracker App listening at http://localhost:${PORT}`);
});
