const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid'); // You may need to install this: npm install uuid

class USBAudioPlayer extends EventEmitter {
    constructor() {
        super();

        // Track all active audio streams
        this.audioStreams = new Map(); // Map of streamId -> stream info
        this.urlToPath = new Map();    // Cache mapping of URLs to file paths
        this.volume = 1;
        this.balance = 0.5;
        this.tempDir = path.join(os.tmpdir(), 'audio-player');
        this.cacheDir = path.join(os.tmpdir(), 'audio-player-cache');
        this.defaultOutputDevice = 0; // 0 = soundcard, 1 = HDMI

        // Create temp and cache directories if they don't exist
        [this.tempDir, this.cacheDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });

        // Load existing cache
        this.loadCache();
    }

    /**
     * Get the current state of the audio player
     * @returns {Object} Current state of the player
     */
    getState() {
        // Get info about all currently playing tracks
        const activeTracks = Array.from(this.audioStreams.entries()).map(([id, info]) => ({
            id: id,
            url: info.url,
            playing: !info.isPaused,
            paused: info.isPaused,
            outputDevice: info.outputDevice,
            loop: info.loop || false,
            trackIndex: info.trackIndex
        }));

        return {
            playing: activeTracks.some(track => !track.paused),
            paused: activeTracks.length > 0 && activeTracks.every(track => track.paused),
            tracks: activeTracks,
            volume: this.volume,
            balance: this.balance,
            defaultOutputDevice: this.defaultOutputDevice
        };
    }

    loadCache() {
        try {
            const cacheMapPath = path.join(this.cacheDir, 'cache-map.json');
            if (fs.existsSync(cacheMapPath)) {
                const cacheData = JSON.parse(fs.readFileSync(cacheMapPath, 'utf8'));
                Object.entries(cacheData).forEach(([url, filePath]) => {
                    // Verify the cached file still exists
                    if (fs.existsSync(filePath)) {
                        this.urlToPath.set(url, filePath);
                    }
                });
            }
        } catch (error) {
            console.error('Failed to load cache:', error);
        }
    }

    saveCache() {
        try {
            const cacheMapPath = path.join(this.cacheDir, 'cache-map.json');
            const cacheData = Object.fromEntries(this.urlToPath);
            fs.writeFileSync(cacheMapPath, JSON.stringify(cacheData, null, 2));
        } catch (error) {
            console.error('Failed to save cache:', error);
        }
    }

    getCachedFile(url) {
        const cachedPath = this.urlToPath.get(url);
        if (cachedPath && fs.existsSync(cachedPath)) {
            console.log(`Cache hit for ${url}`);
            return cachedPath;
        }
        console.log(`Cache miss for ${url}`);
        return null;
    }

    async cacheFile(url, tempFilePath) {
        try {
            // Generate a hash of the URL for the filename
            const hash = require('crypto').createHash('md5').update(url).digest('hex');
            const ext = path.extname(url) || path.extname(tempFilePath) || '.mp3';
            const cachedPath = path.join(this.cacheDir, `${hash}${ext}`);

            // Copy the file to the cache directory
            await fs.promises.copyFile(tempFilePath, cachedPath);

            // Add to cache map
            this.urlToPath.set(url, cachedPath);
            this.saveCache();

            console.log(`Cached file at ${cachedPath}`);
            return cachedPath;
        } catch (error) {
            console.error('Failed to cache file:', error);
            return tempFilePath;
        }
    }

    validateUrl(url) {
        try {
            const parsedUrl = new URL(url);
            return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
        } catch (err) {
            return false;
        }
    }

    async downloadFile(url, retries = 3) {
        if (!this.validateUrl(url)) {
            throw new Error(`Invalid URL format: ${url}`);
        }

        console.log(`Attempting to download: ${url}`);
        let lastError;

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const result = await this._downloadFileAttempt(url);
                return result;
            } catch (error) {
                lastError = error;
                console.log(`Download attempt ${attempt} failed: ${error.message}`);

                // Don't retry on 404 errors
                if (error.message.includes('404')) {
                    throw error;
                }

                if (attempt < retries) {
                    const delay = attempt * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError;
    }

    _downloadFileAttempt(url) {
        return new Promise((resolve, reject) => {
            const tempFile = path.join(this.tempDir, `temp-${Date.now()}.mp3`);
            const fileStream = fs.createWriteStream(tempFile);

            const parsedUrl = new URL(url);
            const options = {
                hostname: parsedUrl.hostname,
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'GET',
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Accept': '*/*'
                }
            };

            const protocol = url.startsWith('https:') ? https : http;

            console.log('Starting download with options:', JSON.stringify(options));

            const request = protocol.get(options, (response) => {
                console.log(`Got response: ${response.statusCode}`);

                if (response.statusCode === 301 || response.statusCode === 302) {
                    console.log(`Following redirect to: ${response.headers.location}`);
                    fileStream.close();
                    fs.unlink(tempFile, () => {});
                    if (response.headers.location) {
                        resolve(this._downloadFileAttempt(response.headers.location));
                        return;
                    }
                    reject(new Error('Redirect with no location header'));
                    return;
                }

                if (response.statusCode !== 200) {
                    fileStream.close();
                    fs.unlink(tempFile, () => {});
                    reject(new Error(`HTTP Error: ${response.statusCode}`));
                    return;
                }

                response.pipe(fileStream);

                fileStream.on('error', (err) => {
                    console.error('File write error:', err);
                    fileStream.close();
                    fs.unlink(tempFile, () => {});
                    reject(err);
                });

                fileStream.on('finish', () => {
                    console.log('Download complete');
                    fileStream.close();

                    fs.stat(tempFile, (err, stats) => {
                        if (err) {
                            console.error('File stat error:', err);
                            fs.unlink(tempFile, () => {});
                            reject(new Error(`File verification failed: ${err.message}`));
                            return;
                        }

                        if (stats.size === 0) {
                            console.error('Downloaded file is empty');
                            fs.unlink(tempFile, () => {});
                            reject(new Error('Downloaded file is empty'));
                            return;
                        }

                        console.log(`Successfully downloaded file to ${tempFile} (${stats.size} bytes)`);
                        resolve(tempFile);
                    });
                });
            });

            request.on('error', (err) => {
                console.error('Request error:', err);
                fileStream.close();
                fs.unlink(tempFile, () => {});
                reject(err);
            });

            request.on('timeout', () => {
                console.error('Request timeout');
                request.destroy();
                fileStream.close();
                fs.unlink(tempFile, () => {});
                reject(new Error('Download timeout'));
            });
        });
    }


    async play(url, volume = 1, balance = 0.5, outputDevice = null, loop = false, trackIndex = null) {
        console.log(`Attempting to play audio from: ${url} on output device: ${outputDevice || this.defaultOutputDevice}, loop: ${loop}, trackIndex: ${trackIndex}`);
        try {
            // Check if this URL is already playing
            const existingStreamId = this.getExistingStreamId(url);

            if (existingStreamId) {
                const existingStream = this.audioStreams.get(existingStreamId);

                // Update trackIndex if it's changed
                if (trackIndex !== null && existingStream.trackIndex !== trackIndex) {
                    console.log(`Updating trackIndex for stream ${existingStreamId} from ${existingStream.trackIndex} to ${trackIndex}`);
                    existingStream.trackIndex = trackIndex;
                }

                // If it's paused, resume it instead of creating a new stream
                if (existingStream.isPaused) {
                    console.log(`Stream ${existingStreamId} is paused, resuming it instead of creating duplicate`);
                    await this.resumeStream(existingStreamId);

                    // Update loop setting if needed
                    if (existingStream.loop !== loop) {
                        existingStream.loop = loop;
                        console.log(`Updated loop setting for stream ${existingStreamId} to ${loop}`);
                    }

                    return existingStreamId;
                } else {
                    console.log(`Stream ${existingStreamId} is already playing and not paused`);

                    // Update loop setting if needed
                    if (existingStream.loop !== loop) {
                        existingStream.loop = loop;
                        console.log(`Updated loop setting for stream ${existingStreamId} to ${loop}`);
                    }

                    return existingStreamId;
                }
            }

            // Generate a unique ID for this stream
            const streamId = uuidv4();

            // Update state values
            this.volume = volume;
            this.balance = balance;

            // Input validation
            if (!url) {
                throw new Error('URL is required');
            }

            // If outputDevice is not specified, use the default
            if (outputDevice === null) {
                outputDevice = this.defaultOutputDevice;
            }

            // Get the file path (either from cache or download)
            let filePath;
            if (url.startsWith('http')) {
                // Check cache first
                filePath = this.getCachedFile(url);
                if (!filePath) {
                    // Download if not in cache
                    const tempFile = await this.downloadFile(url);
                    // Cache the downloaded file
                    filePath = await this.cacheFile(url, tempFile);
                    // Remove the temporary file
                    fs.unlink(tempFile, () => {});
                }
            } else {
                filePath = url;
            }

            // Verify the file exists and is readable before playing
            if (!fs.existsSync(filePath)) {
                throw new Error(`Audio file not found: ${filePath}`);
            }

            // Log file details
            const stats = fs.statSync(filePath);
            console.log(`Playing file: ${filePath} (${stats.size} bytes)`);

            // Set volume for the selected output device
            /*
            try {
                console.log(`Setting hardware volume to ${Math.round(volume * 100)}% on device ${outputDevice}`);
                if (outputDevice === 1) {
                    // HDMI output
                    await execAsync(`amixer -c ${outputDevice} sset 'HDMI' ${Math.round(volume * 100)}% unmute`).catch(() => {});
                } else {
                    // Default soundcard
                    await execAsync(`amixer -c ${outputDevice} sset 'Speaker' ${Math.round(volume * 100)}% unmute`).catch(() => {});
                    await execAsync(`amixer -c ${outputDevice} sset 'Headphone' ${Math.round(volume * 100)}% unmute`).catch(() => {});
                }
            } catch (err) {
                console.log(`Note: Volume control error on device ${outputDevice}, but continuing.`);
            }
            */

            let playerProcess;
            if (outputDevice === 1) {
                // HDMI output - using ffmpeg which handles format conversion well
                console.log(`Playing on HDMI using ffmpeg to hw:2,0: ${filePath}`);

                // Build the ffmpeg command with proper options
                const ffmpegArgs = [
                    '-nostdin',               // Don't expect input from stdin
                    '-loglevel', 'error',     // Only show errors
                    '-i', filePath,           // Input file
                    '-ac', '2',               // 2 channels (stereo)
                    '-ar', '48000',           // Sample rate that works with HDMI (48kHz)
                    '-acodec', 'pcm_s16le',   // Output codec (16-bit PCM)
                    '-f', 'alsa',             // Output format
                    'hw:2'                    // HDMI device
                ];

                // Add volume control if needed
                if (volume < 1.0) {
                    // Insert volume filter before the output format
                    ffmpegArgs.splice(ffmpegArgs.indexOf('-f'), 0,
                        '-filter:a', `volume=${volume}`);
                }

                console.log(`ffmpeg command: ffmpeg ${ffmpegArgs.join(' ')}`);
                playerProcess = spawn('ffmpeg', ffmpegArgs);

                // For looping with ffmpeg, we need to handle it manually
                if (loop) {
                    // TODO: streamInfo.loopEnabled = true;

                    // Define a function to restart playback when it ends
                    const handlePlaybackEnd = () => {
                        // Check if this stream still exists and looping is still enabled
                        if (this.audioStreams.has(streamId) &&
                            this.audioStreams.get(streamId).loopEnabled) {

                            console.log(`Restarting playback for looping stream ${streamId}`);
                            const currentStreamInfo = this.audioStreams.get(streamId);

                            // Set up a new ffmpeg process with the same arguments
                            const newFfmpegArgs = [...ffmpegArgs]; // Create a copy of the arguments

                            // Create a new player process
                            const newPlayerProcess = spawn('ffmpeg', newFfmpegArgs);

                            // Update the stream info with the new process
                            currentStreamInfo.playerProcess = newPlayerProcess;

                            // Re-attach event handlers
                            newPlayerProcess.stderr.on('data', (data) => {
                                //console.log(`ffmpeg stderr: ${data.toString().trim()}`);
                            });

                            newPlayerProcess.on('error', (error) => {
                                console.error(`ffmpeg process error for stream ${streamId}:`, error);
                            });

                            // Re-attach exit handler for continued looping
                            newPlayerProcess.on('exit', (code, signal) => {
                                if (!signal) {
                                    // Only restart if it wasn't manually killed
                                    handlePlaybackEnd();
                                } else {
                                    // If it was killed, perform normal cleanup
                                    if (this.audioStreams.has(streamId)) {
                                        this.audioStreams.delete(streamId);

                                        this.emit('stop', {
                                            id: streamId,
                                            track: currentStreamInfo.url,
                                            trackIndex: currentStreamInfo.trackIndex
                                        });
                                    }
                                }
                            });

                            console.log(`Restarted playback for looping stream ${streamId}`);
                        } else {
                            // Stream was removed or looping disabled, don't restart
                            console.log(`Not restarting stream ${streamId} - removed or loop disabled`);

                            // Do normal cleanup if the stream still exists
                            if (this.audioStreams.has(streamId)) {
                                const currentStreamInfo = this.audioStreams.get(streamId);
                                this.audioStreams.delete(streamId);

                                this.emit('trackComplete', {
                                    id: streamId,
                                    track: currentStreamInfo.url,
                                    trackIndex: currentStreamInfo.trackIndex,
                                    error: null
                                });
                            }
                        }
                    };

                    // Attach the loop handler to the exit event
                    playerProcess.on('exit', (code, signal) => {
                        if (!signal) {
                            // Track ended naturally, handle looping
                            handlePlaybackEnd();
                        } else {
                            // Track was manually stopped, do nothing special
                            console.log(`Stream ${streamId} was manually stopped`);
                        }
                    });
                }
            } else {
                // Standard speaker output - use SoX/play
                console.log(`Playing on speakers using play ${filePath}`);
                playerProcess = spawn('play', [filePath, 'vol', volume.toString()]);
            }

            // Store the stream info - IMPORTANT: store the original URL correctly
            const streamInfo = {
                id: streamId,
                url: url,  // This should be the original URL, not filePath
                filePath: filePath,
                playerProcess: playerProcess,
                isPaused: false,
                volume: volume,
                balance: balance,
                outputDevice: outputDevice,
                loop: loop,  // Add loop property
                trackIndex: trackIndex  // Store the track index
            };

            this.audioStreams.set(streamId, streamInfo);

            // Debug log to show all current streams
            console.log(`Current streams after adding ${streamId}:`,
                Array.from(this.audioStreams.entries()).map(([id, s]) => ({
                    id,
                    url: s.url,
                    loop: s.loop,
                    trackIndex: s.trackIndex
                })));

            playerProcess.stderr.on('data', (data) => {
                console.log(`play stderr: ${data.toString().trim()}`);
            });

            playerProcess.on('error', (error) => {
                console.error(`play process error for stream ${streamId}:`, error);
                // Fallback implementation...
            });

            playerProcess.on('exit', (code, signal) => {
                console.log(`play process for stream ${streamId} exited with code ${code}, signal: ${signal}`);

                // Clean up this stream only if it's still in the map
                if (this.audioStreams.has(streamId)) {
                    const streamInfo = this.audioStreams.get(streamId);

                    // Check if we need to loop this track
                    if (streamInfo.loop && !signal) {
                        console.log(`Looping track for stream ${streamId} (trackIndex: ${streamInfo.trackIndex})`);

                        // Start a new process to play the same file again
                        const playArgs = [streamInfo.filePath];

                        // Add device selection if needed
                        if (streamInfo.outputDevice === 1) {
                            playArgs.unshift('-d', 'hw:1,0');
                        }

                        const newPlayerProcess = spawn('play', playArgs);
                        streamInfo.playerProcess = newPlayerProcess;

                        // Set up the same event handlers for the new process
                        newPlayerProcess.stderr.on('data', (data) => {
                            console.log(`play stderr: ${data.toString().trim()}`);
                        });

                        newPlayerProcess.on('error', (error) => {
                            console.error(`play process error for looped stream ${streamId}:`, error);
                        });

                        newPlayerProcess.on('exit', function onExit(code, signal) {
                            // Call the same event handler for the new process
                            playerProcess.emit('exit', code, signal);
                        });

                        console.log(`Restarted playback for looping stream ${streamId} (trackIndex: ${streamInfo.trackIndex})`);
                    } else {
                        console.log(`Removing stream ${streamId} from audioStreams due to process exit`);
                        this.audioStreams.delete(streamId);

                        // Only emit track completion if it wasn't manually stopped
                        if (!signal) {
                            console.log(`Emitting trackComplete for ${streamId} (trackIndex: ${streamInfo.trackIndex})`);
                            this.emit('trackComplete', {
                                id: streamId,
                                track: url,
                                trackIndex: streamInfo.trackIndex,
                                error: code !== 0 ? `Exit code: ${code}` : null
                            });
                        }
                    }
                }

                // Log remaining streams for debugging
                const remainingStreams = Array.from(this.audioStreams.entries())
                    .map(([id, s]) => ({
                        id,
                        url: s.url,
                        loop: s.loop,
                        trackIndex: s.trackIndex
                    }));
                console.log(`Remaining streams after exit of ${streamId}: ${JSON.stringify(remainingStreams)}`);
            });

            // Emit playStart event with trackIndex
            this.emit('playStart', {
                id: streamId,
                track: url,
                volume: volume,
                balance: balance,
                outputDevice: outputDevice,
                loop: loop,
                trackIndex: trackIndex
            });

            return streamId;
        } catch (error) {
            this.emit('error', {
                track: url,
                error: error.message,
                trackIndex: trackIndex
            });

            console.error(`Playback failed: ${error.message}`);
            return null;
        }
    }

    setLoopStatus(streamId, loop) {
        const stream = this.audioStreams.get(streamId);
        if (stream) {
            stream.loop = loop;

            // Set the new loopEnabled flag used by our HDMI looping system
            stream.loopEnabled = loop;

            console.log(`Set loop status for stream ${streamId} to ${loop} (trackIndex: ${stream.trackIndex})`);

            // Emit an event for the loop status change
            this.emit('loopStatusChange', {
                id: streamId,
                track: stream.url,
                loop: loop,
                trackIndex: stream.trackIndex
            });

            return true;
        }
        return false;
    }

    // Update the setVolume method to handle the output device
    async setVolume(volume, outputDevice = null) {
        try {
            // Update state
            this.volume = volume;

            // If outputDevice is not specified, use the default
            if (outputDevice === null) {
                outputDevice = this.defaultOutputDevice;
            }

            // Set hardware volume for the specified device
            console.log(`Setting hardware volume to ${Math.round(volume * 100)}% on device ${outputDevice}`);

            if (outputDevice === 1) {
                // HDMI output
                await execAsync(`amixer -c ${outputDevice} sset 'HDMI' ${Math.round(volume * 100)}% unmute`).catch(() => {});
            } else {
                // Default soundcard
                await execAsync(`amixer -c ${outputDevice} sset 'Master Playback Volume' ${Math.round(volume * 100)}% unmute`).catch(() => {});
                await execAsync(`amixer -c ${outputDevice} sset 'Headphone' ${Math.round(volume * 100)}% unmute`).catch(() => {});
            }

            this.emit('volumeChange', {
                volume: this.volume,
                outputDevice: outputDevice
            });
        } catch (error) {
            console.error(`Failed to set volume on device ${outputDevice}: ${error.message}`);
        }
    }

    // Add a method to set the default output device
    setDefaultOutputDevice(device) {
        if (device === 0 || device === 1) {
            this.defaultOutputDevice = device;
            console.log(`Default output device set to: ${device}`);
            return true;
        }
        console.error(`Invalid output device: ${device}`);
        return false;
    }

    /**
     * Check if the URL exists in current streams, and clean up any stale references
     * @param {string} url The URL to check
     * @returns {string|null} The stream ID if found and active, null otherwise
     */
    getExistingStreamId(url) {
        if (!url) return null;

        // First check if any stream is actively playing this URL
        const existingStream = Array.from(this.audioStreams.entries())
            .find(([id, stream]) => stream.url === url);

        if (existingStream) {
            const [streamId, stream] = existingStream;
            console.log(`Found existing stream for URL ${url}: ${streamId}`);
            return streamId;
        }

        console.log(`No active stream found for URL ${url}`);
        return null;
    }

    async pauseStream(streamId) {
        const stream = this.audioStreams.get(streamId);
        if (stream && !stream.isPaused && stream.playerProcess) {
            try {
                // Send SIGSTOP signal to pause
                stream.playerProcess.kill('SIGSTOP');
                stream.isPaused = true;
                console.log(`Stream ${streamId} paused (trackIndex: ${stream.trackIndex})`);
                this.emit('pause', {
                    id: streamId,
                    track: stream.url,
                    trackIndex: stream.trackIndex
                });
                return true;
            } catch (error) {
                console.error(`Failed to pause stream ${streamId}:`, error);
                return false;
            }
        }
        return false;
    }

    async resumeStream(streamId) {
        const stream = this.audioStreams.get(streamId);
        if (stream && stream.isPaused && stream.playerProcess) {
            try {
                // Send SIGCONT signal to resume
                stream.playerProcess.kill('SIGCONT');
                stream.isPaused = false;
                console.log(`Stream ${streamId} resumed (trackIndex: ${stream.trackIndex})`);
                this.emit('resume', {
                    id: streamId,
                    track: stream.url,
                    trackIndex: stream.trackIndex
                });
                return true;
            } catch (error) {
                console.error(`Failed to resume stream ${streamId}:`, error);
                return false;
            }
        }
        return false;
    }

    async stopStream(streamId) {
        const stream = this.audioStreams.get(streamId);
        if (stream && stream.playerProcess) {
            try {
                // Disable looping for this stream to prevent restart
                stream.loopEnabled = false;

                if (stream.isPaused) {
                    // Resume first if paused
                    await this.resumeStream(streamId);
                }

                // Kill the process
                stream.playerProcess.kill();

                this.audioStreams.delete(streamId);
                console.log(`Stream ${streamId} stopped (trackIndex: ${stream.trackIndex})`);
                this.emit('stop', {
                    id: streamId,
                    track: stream.url,
                    trackIndex: stream.trackIndex
                });
                return true;
            } catch (error) {
                console.error(`Failed to stop stream ${streamId}:`, error);
                return false;
            }
        }
        return false;
    }

    // For backward compatibility
    async pause() {
        // Pause all streams
        const promises = [];
        for (const streamId of this.audioStreams.keys()) {
            promises.push(this.pauseStream(streamId));
        }
        await Promise.all(promises);
        return true;
    }

    // For backward compatibility
    async resume() {
        // Resume all streams
        const promises = [];
        for (const streamId of this.audioStreams.keys()) {
            promises.push(this.resumeStream(streamId));
        }
        await Promise.all(promises);
        return true;
    }

    // For backward compatibility
    async stop() {
        // Stop all streams
        const promises = [];
        for (const streamId of this.audioStreams.keys()) {
            promises.push(this.stopStream(streamId));
        }
        await Promise.all(promises);
        return true;
    }

    cleanup() {
        // Stop all playing audio
        this.stop();

        // Clean up temp directory
        if (fs.existsSync(this.tempDir)) {
            fs.readdirSync(this.tempDir).forEach(file => {
                fs.unlinkSync(path.join(this.tempDir, file));
            });
            fs.rmdirSync(this.tempDir);
        }
    }
}

module.exports = USBAudioPlayer;