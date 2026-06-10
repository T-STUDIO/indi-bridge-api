const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { spawn, exec } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

const app = express();
const HTTP_PORT = 5000; // API操作用ポート（T-Astro Web Studioから叩くポート）
let currentBridgePort = 8625; // 初期WebSocketブリッジポート

app.use(cors()); // CORSを全許可（GitHub Pages等からでもアクセス可能に）
app.use(express.json());

let activeIndiProcess = null;
let bridgeWsServer = null;

// XMLからドライバを走査する関数（フォールバック付き）
function getAvailableDrivers() {
    const driversList = [];
    const seenBins = new Set();
    const indiXmlDir = '/usr/share/indi';

    try {
        if (fs.existsSync(indiXmlDir)) {
            const files = fs.readdirSync(indiXmlDir);
            for (const file of files) {
                if (file.endsWith('.xml')) {
                    const content = fs.readFileSync(path.join(indiXmlDir, file), 'utf-8');
                    const driverRegex = /<driver\s+[^>]*name=["']([^"']+)["']\s+[^>]*bin=["']([^"']+)["'][^>]*>/g;
                    let match;
                    while ((match = driverRegex.exec(content)) !== null) {
                        const name = match[1];
                        const bin = match[2];
                        let group = 'CCDs';
                        if (content.includes('group="Telescopes"') || content.includes('group="Mounts"')) group = 'Telescopes';
                        else if (content.includes('group="Focusers"')) group = 'Focusers';
                        else if (content.includes('group="Domes"')) group = 'Domes';
                        else if (content.includes('group="Filter Wheels"')) group = 'Filter Wheels';

                        if (!seenBins.has(bin)) {
                            seenBins.add(bin);
                            driversList.push({ name, bin, group });
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error('Error scanning /usr/share/indi:', e);
    }

    // フォールバック追加
    const fallbacks = [
        { name: 'CCD Simulator', bin: 'indi_simulator_ccd', group: 'CCDs' },
        { name: 'Telescope Simulator', bin: 'indi_simulator_telescope', group: 'Telescopes' },
        { name: 'ZWO CCD', bin: 'indi_zwo_ccd', group: 'CCDs' },
        { name: 'QHY CCD', bin: 'indi_qhy_ccd', group: 'CCDs' }
    ];
    for (const f of fallbacks) {
        if (!seenBins.has(f.bin)) {
            seenBins.add(f.bin);
            driversList.push(f);
        }
    }
    return driversList;
}

// WS-TCPブリッジバインド
function configureBridgePort(port) {
    if (currentBridgePort === port && bridgeWsServer) return;
    
    if (bridgeWsServer) {
        try { bridgeWsServer.close(); } catch(e){}
    }
    currentBridgePort = port;
    try {
        bridgeWsServer = new WebSocketServer({ port: currentBridgePort, host: '0.0.0.0' });
        console.log(`WebSocket Bridge listening on ws://0.0.0.0:${currentBridgePort}`);

        bridgeWsServer.on('connection', (wsClient) => {
            const tcpSocket = net.createConnection({ host: '127.0.0.1', port: 7624 }, () => {});
            wsClient.on('message', (msg) => { if (tcpSocket.writable) tcpSocket.write(msg); });
            tcpSocket.on('data', (data) => { if (wsClient.readyState === 1) wsClient.send(data, { binary: true }); });
            wsClient.on('close', () => { tcpSocket.destroy(); });
            tcpSocket.on('close', () => { wsClient.close(); });
            wsClient.on('error', () => { tcpSocket.destroy(); });
            tcpSocket.on('error', () => { wsClient.close(); });
        });
    } catch(err) {
        console.error(`Failed binding WS port ${currentBridgePort}:`, err);
    }
}

// エンドポイント実装
app.get('/api/indi/drivers', (req, res) => {
    res.json({ status: 'ok', drivers: getAvailableDrivers() });
});

app.post('/api/indi/start', (req, res) => {
    const { drivers } = req.body;
    if (activeIndiProcess) {
        try { process.kill(-activeIndiProcess.pid); } catch (e) {
            try { activeIndiProcess.kill(); } catch(err){}
        }
        activeIndiProcess = null;
    }

    exec('pkill -9 -f indiserver || true', () => {
        setTimeout(() => {
            if (!drivers || drivers.length === 0) {
                return res.json({ status: 'ok', message: 'Cleared.' });
            }
            const args = ['-p', '7624', '-v', ...drivers];
            activeIndiProcess = spawn('indiserver', args, { detached: true, stdio: 'ignore' });
            activeIndiProcess.unref();
            res.json({ status: 'ok', message: `Started with: ${drivers.join(', ')}` });
        }, 500);
    });
});

app.post('/api/indi/configure-port', (req, res) => {
    const { port } = req.body;
    if (port && typeof port === 'number') {
        configureBridgePort(port);
        res.json({ status: 'ok', message: `Bridge set to ${port}` });
    } else {
        res.status(400).json({ status: 'error' });
    }
});

// 初期バインド
configureBridgePort(8625);

app.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`INDI Driver Standalone Manager listening on http://0.0.0.0:${HTTP_PORT}`);
});