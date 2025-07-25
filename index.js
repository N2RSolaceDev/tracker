// index.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

// Promisify exec for easier async/await usage
const execPromise = promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// --- Helper Functions ---

// Function to get geolocation data from ip-api.com
async function getGeolocation(ip) {
    try {
        const response = await axios.get(`http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query`, {
            timeout: 10000
        });
        if (response.data.status === 'success') {
            return { success: true, data: response.data };
        } else {
            return { success: false, error: response.data.message || 'Geolocation failed' };
        }
    } catch (error) {
        console.error(`Geolocation API error for ${ip}:`, error.message);
        return { success: false, error: `Geolocation API error: ${error.message}` };
    }
}

// Function to perform ping
// Note: This requires the system `ping` command to be available
async function performPing(ip) {
    try {
        // Determine the command based on the OS
        // -c 4 means 4 packets on Unix/Linux/macOS
        // -n 4 means 4 packets on Windows
        const isWindows = process.platform === "win32";
        const command = isWindows ? `chcp 65001 && ping -n 4 ${ip}` : `ping -c 4 ${ip}`;

        console.log(`Executing ping command: ${command}`);
        const { stdout, stderr } = await execPromise(command, { timeout: 15000 }); // 15 second timeout

        // On Windows, chcp might produce output we don't need
        let output = stdout;
        if (isWindows) {
            // Remove the chcp output line if present (e.g., "Active code page: 65001")
            output = stdout.split('\n').filter(line => !line.includes('Active code page')).join('\n');
        }

        return {
            success: true,
            data: output.trim() || "Ping completed, but no output captured.",
            platform: process.platform
        };
    } catch (error) {
        console.error(`Ping error for ${ip}:`, error.message);
        // Differentiate between timeout, unreachable, and execution errors
        let errorMsg = `Ping failed: ${error.message}`;
        if (error.killed) {
            errorMsg = "Ping timed out or was killed.";
        } else if (error.signal) {
            errorMsg = `Ping terminated by signal: ${error.signal}`;
        } else if (error.code !== 0) {
            // Non-zero exit code usually means host is unreachable or packet loss
            errorMsg = `Ping command failed (code ${error.code}). Host might be unreachable.`;
        }
        return { success: false, error: errorMsg };
    }
}

// --- API Endpoint ---

app.get('/api/track/:ip', async (req, res) => {
    const ip = req.params.ip;

    // Basic IP validation (very simple)
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip)) {
        return res.status(400).json({ error: 'Invalid IP address format.' });
    }

    console.log(`Tracking IP: ${ip}`);

    try {
        // Run geolocation and ping concurrently
        const [geoResult, pingResult] = await Promise.all([
            getGeolocation(ip),
            performPing(ip)
        ]);

        // Check if we got any successful data
        // Note: We don't fail the whole request if ping fails, as geolocation is primary
        if (!geoResult.success) {
            return res.status(500).json({
                error: 'Failed to retrieve geolocation data.',
                geolocation_error: geoResult.error,
                ping_success: pingResult.success,
                ping_error: pingResult.success ? null : pingResult.error
            });
        }

        // Combine successful results
        const combinedData = {
            ip: ip,
            geolocation: geoResult.success ? geoResult.data : null,
            geolocation_error: geoResult.success ? null : geoResult.error,
            ping: pingResult.success ? pingResult.data : null,
            ping_error: pingResult.success ? null : pingResult.error,
            ping_platform: pingResult.success ? pingResult.platform : null,
            accuracyRadiusKm: 5
        };

        res.json(combinedData);
    } catch (error) {
        console.error('Unexpected error during tracking:', error);
        res.status(500).json({ error: 'An unexpected error occurred during tracking.' });
    }
});

// Fallback route for serving the frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Advanced IP Tracker Server listening at http://localhost:${PORT}`);
});
