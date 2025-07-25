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
app.use(cors()); // Enable CORS for requests from frontend
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from 'public' folder

// --- Helper Functions ---

// Function to get geolocation data from ip-api.com
// ip-api.com is free and does not require an API key for basic usage.
// Check their docs for rate limits: https://ip-api.com/docs
async function getGeolocation(ip) {
    try {
        // Request specific fields to potentially get slightly faster responses
        // Note: Adding 'status' and 'message' fields is good practice for error handling
        const url = `http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query, reverse, mobile, proxy, hosting`;
        const response = await axios.get(url, {
            timeout: 10000 // 10 second timeout
        });
        
        if (response.data.status === 'success') {
            return { success: true, data: response.data };
        } else {
            // Handle cases where the API returns status 'fail' (e.g., reserved IP range)
            return { success: false, error: response.data.message || 'Geolocation failed (API returned failure status)' };
        }
    } catch (error) {
        console.error(`Geolocation API error for ${ip}:`, error.message);
        // Differentiate between network errors and API errors if possible
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            return { success: false, error: `Geolocation API error (${error.response.status}): ${error.response.statusText}` };
        } else if (error.request) {
            // The request was made but no response was received
            return { success: false, error: 'Geolocation API error: No response received from server' };
        } else {
            // Something happened in setting up the request that triggered an Error
            return { success: false, error: `Geolocation setup error: ${error.message}` };
        }
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
        // Use -W (timeout in seconds) for Unix, -w (timeout in milliseconds for 4 packets) for Windows
        const timeoutArg = isWindows ? '-w 4000' : '-W 4'; // 4 seconds timeout
        const command = isWindows 
            ? `chcp 65001 >NUL && ping -n 4 ${timeoutArg} ${ip}` 
            : `ping -c 4 ${timeoutArg} ${ip}`;

        console.log(`Executing ping command: ${command}`);
        const { stdout, stderr } = await execPromise(command, { timeout: 15000 }); // 15 second timeout for process

        // On Windows, chcp might produce output we don't need
        let output = stdout;
        if (isWindows) {
            // Remove the chcp output line if present (e.g., "Active code page: 65001")
            const lines = stdout.split('\n');
            output = lines.filter(line => !line.includes('Active code page')).join('\n');
        }

        return {
            success: true,
            data: output.trim() || "Ping completed, but no standard output captured.",
            platform: process.platform
        };
    } catch (error) {
        console.error(`Ping error for ${ip}:`, error.message);
        // Differentiate between timeout, unreachable, and execution errors
        let errorMsg = `Ping failed: ${error.message}`;
        if (error.killed && error.signal === 'SIGTERM') {
            errorMsg = "Ping timed out (15s limit reached).";
        } else if (error.signal) {
            errorMsg = `Ping terminated by signal: ${error.signal}`;
        } else if (error.code !== 0) {
            // Non-zero exit code usually means host is unreachable or packet loss
            // On Windows, code 1 often means general failure, code 2 means host not found
            // On Unix, code 1 or 2 typically means host not reachable
            errorMsg = `Ping command failed (exit code ${error.code}). Host might be unreachable or blocking ICMP.`;
        }
        return { success: false, error: errorMsg };
    }
}

// --- API Endpoint ---

// Endpoint to track an IP
app.get('/api/track/:ip', async (req, res) => {
    const ip = req.params.ip;

    // Basic IP validation (very simple)
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip)) {
        return res.status(400).json({ error: 'Invalid IP address format.' });
    }

    console.log(`Tracking IP: ${ip}`);

    try {
        // Run geolocation and ping concurrently for better performance
        const [geoResult, pingResult] = await Promise.all([
            getGeolocation(ip),
            performPing(ip)
        ]);

        // Check if we got any successful data
        // Note: We don't fail the whole request if ping fails, as geolocation is the primary goal
        if (!geoResult.success && !pingResult.success) {
            return res.status(503).json({
                error: 'Failed to retrieve data from all services.',
                geolocation_error: geoResult.error,
                ping_error: pingResult.error
            });
        }

        // Combine results
        const combinedData = {
            ip: ip,
            geolocation: geoResult.success ? geoResult.data : null,
            geolocation_error: geoResult.success ? null : geoResult.error,
            ping: pingResult.success ? pingResult.data : null,
            ping_error: pingResult.success ? null : pingResult.error,
            ping_platform: pingResult.success ? pingResult.platform : null,
            accuracyRadiusKm: 5 // As requested
        };

        res.json(combinedData);
    } catch (error) {
        console.error('Unexpected error during tracking:', error);
        res.status(500).json({ error: 'An unexpected error occurred during tracking.' });
    }
});

// Fallback route to serve the frontend for any unmatched GET request
// This is important for client-side routing if you add it later
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Advanced IP Tracker Server listening at http://localhost:${PORT}`);
});
