// server.js - FIXED PUPPETEER VERSION
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || "https://pasarkilat-app.vercel.app";

const io = new Server(server, {
    cors: {
        origin: FRONTEND_URL,
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

let whatsappStatus = 'disconnected';
let qrCodeData = null;
let initializationAttempts = 0;
const MAX_INIT_ATTEMPTS = 5;

// === SISTEM MAPPING YANG DIPERBAIKI ===
const customerMapping = new Map();
const phoneToJobMapping = new Map();
const chatSessions = new Map();

// WhatsApp Client - EXTREMELY ROBUST CONFIG FOR RAILWAY
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "courier-app",
        dataPath: "./whatsapp-auth"
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
            '--disable-accelerated-2d-canvas',
            '--disable-web-security',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=AudioServiceOutOfProcess',
            '--disable-back-forward-cache',
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-plugins',
            '--disable-translate',
            '--disable-sync',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-default-browser-check',
            '--autoplay-policy=user-gesture-required',
            '--disable-background-networking',
            '--disable-client-side-phishing-detection',
            '--disable-crash-reporter',
            '--disable-hang-monitor',
            '--disable-ipc-flooding-protection',
            '--disable-prompt-on-repost',
            '--disable-domain-reliability',
            '--disable-partial-raster',
            '--disable-skia-runtime-opts',
            '--disable-breakpad',
            '--disable-component-update',
            '--disable-field-trial-config',
            '--disable-software-rasterizer',
            '--disable-webrtc-hw-decoding',
            '--disable-webrtc-hw-encoding',
            '--force-color-profile=srgb',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list',
            '--enable-features=NetworkService,NetworkServiceInProcess',
            '--max-old-space-size=256',
            '--memory-pressure-off'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
        ignoreDefaultArgs: ['--disable-extensions', '--enable-automation'],
        timeout: 0, // Non-timeout
        ignoreHTTPSErrors: true
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    }
});

// === WHATSAPP EVENT HANDLERS ===
client.on('qr', (qr) => {
    console.log('📱 QR Code Received');
    qrcode.generate(qr, { small: true });
    
    qrCodeData = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qr)}`;
    whatsappStatus = 'qr_received';
    initializationAttempts = 0; // Reset attempts on QR received
    
    io.emit('whatsapp_status', { 
        status: whatsappStatus, 
        qr: qrCodeData 
    });
});

client.on('ready', () => {
    console.log('✅ WhatsApp Client is Ready!');
    whatsappStatus = 'connected';
    initializationAttempts = 0; // Reset attempts on ready
    io.emit('whatsapp_status', { status: whatsappStatus });
});

client.on('disconnected', (reason) => {
    console.log('❌ WhatsApp Disconnected:', reason);
    whatsappStatus = 'disconnected';
    io.emit('whatsapp_status', { status: whatsappStatus });
    
    // Auto-restart dengan delay yang semakin lama
    const delay = Math.min(initializationAttempts * 5000, 30000);
    console.log(`🔄 Restarting WhatsApp client in ${delay}ms...`);
    setTimeout(() => {
        initializeWhatsApp();
    }, delay);
});

client.on('auth_failure', (msg) => {
    console.log('❌ Auth Failure:', msg);
    whatsappStatus = 'auth_failure';
    io.emit('whatsapp_status', { status: whatsappStatus });
});

client.on('loading_screen', (percent, message) => {
    console.log(`🔄 Loading Screen: ${percent}% - ${message}`);
    whatsappStatus = 'loading';
    io.emit('whatsapp_status', { status: whatsappStatus, percent, message });
});

// === HANDLE PESAN MASUK DARI CUSTOMER ===
client.on('message', async (msg) => {
    if (msg.fromMe) return;
    
    const customerPhone = msg.from.replace('@c.us', '');
    console.log('📨 Pesan masuk dari:', customerPhone, 'Isi:', msg.body);
    
    const jobId = phoneToJobMapping.get(customerPhone);
    
    if (jobId) {
        console.log(`✅ Pesan dialihkan ke job: ${jobId}`);
        
        if (!chatSessions.has(jobId)) {
            chatSessions.set(jobId, []);
        }
        
        const messageData = {
            id: Date.now().toString(),
            sender: 'customer',
            message: msg.body,
            timestamp: new Date(),
            type: 'received'
        };
        
        chatSessions.get(jobId).push(messageData);
        
        io.emit('new_message', {
            jobId: jobId,
            message: messageData
        });
        
        console.log(`📤 Event new_message dikirim untuk job: ${jobId}`);
        
    } else {
        console.log('❌ Pesan dari nomor tidak terdaftar:', customerPhone);
        
        const jobIdMatch = msg.body.match(/#(\w+)/);
        if (jobIdMatch) {
            const extractedJobId = jobIdMatch[1];
            console.log(`🔍 Mencoba mapping otomatis: ${customerPhone} -> ${extractedJobId}`);
            phoneToJobMapping.set(customerPhone, extractedJobId);
            customerMapping.set(extractedJobId, customerPhone);
            
            io.emit('mapping_created', {
                phone: customerPhone,
                jobId: extractedJobId
            });
        }
    }
});

// === SAMPLE DATA ===
const TEST_PHONES = [
    '6282195036971',
    '6282195036971'
];

const sampleJobs = [
    {
        id: 'ORD1001',
        customerPhone: TEST_PHONES[0],
        customerName: 'Budi Santoso',
        status: 'new',
        pickup: { name: 'Toko Serba Ada', address: 'Jl. Merdeka No. 123' },
        delivery: { name: 'Budi Santoso', address: 'Jl. Sudirman No. 456' },
        payment: 45000,
        distance: '3.2 km',
        estimate: '25 menit'
    },
    {
        id: 'ORD1002',
        customerPhone: TEST_PHONES[1],
        customerName: 'Siti Rahayu',
        status: 'new',
        pickup: { name: 'Restoran Cepat Saji', address: 'Jl. Gatot Subroto No. 78' },
        delivery: { name: 'Siti Rahayu', address: 'Jl. Thamrin No. 45' },
        payment: 38000,
        distance: '2.5 km',
        estimate: '20 menit'
    }
];

// === AUTO-MAPPING SYSTEM ===
function initializeMappings() {
    customerMapping.clear();
    phoneToJobMapping.clear();
    
    sampleJobs.forEach(job => {
        const cleanPhone = job.customerPhone.replace(/\D/g, '');
        customerMapping.set(job.id, cleanPhone);
        phoneToJobMapping.set(cleanPhone, job.id);
    });
    
    console.log('🔄 Mapping initialized');
}

function createSimulatedJobMapping(jobId) {
    const randomPhone = TEST_PHONES[Math.floor(Math.random() * TEST_PHONES.length)];
    const cleanPhone = randomPhone.replace(/\D/g, '');
    
    customerMapping.set(jobId, cleanPhone);
    phoneToJobMapping.set(cleanPhone, jobId);
    
    console.log(`🔗 Auto-mapping created: ${jobId} -> ${cleanPhone}`);
    
    return cleanPhone;
}

function getOrCreateCustomerPhone(jobId) {
    let customerPhone = customerMapping.get(jobId);
    
    if (!customerPhone) {
        customerPhone = createSimulatedJobMapping(jobId);
    }
    
    return customerPhone;
}

initializeMappings();

// === TELEPHONE HANDLER ===
function setupTelephoneHandler(socket) {
    socket.removeAllListeners('request_customer_phone');
    
    socket.on('request_customer_phone', (data) => {
        console.log('📞 Request customer phone for job:', data?.jobId);
        
        if (!data || !data.jobId) {
            socket.emit('customer_phone_received', {
                success: false,
                error: 'Data tidak valid'
            });
            return;
        }

        const jobId = data.jobId;
        
        try {
            const customerPhone = getOrCreateCustomerPhone(jobId);
            
            if (customerPhone) {
                const cleanPhone = customerPhone.replace(/\D/g, '');
                
                const responseData = {
                    success: true,
                    jobId: jobId,
                    phone: cleanPhone
                };
                
                socket.emit('customer_phone_received', responseData);
                
            } else {
                socket.emit('customer_phone_received', {
                    success: false,
                    jobId: jobId,
                    error: 'Nomor customer tidak tersedia'
                });
            }
        } catch (error) {
            console.error('❌ Error in request_customer_phone:', error);
            socket.emit('customer_phone_received', {
                success: false,
                jobId: jobId,
                error: 'Terjadi kesalahan sistem'
            });
        }
    });
}

// === SOCKET.IO CONNECTION HANDLER ===
io.on('connection', (socket) => {
    console.log('✅ Client connected:', socket.id);
    
    socket.emit('whatsapp_status', { 
        status: whatsappStatus, 
        qr: qrCodeData 
    });

    socket.emit('initial_jobs', sampleJobs);
    setupTelephoneHandler(socket);

    socket.on('send_message', async (data) => {
        console.log('💬 Kurir mengirim pesan:', data);
        
        if (whatsappStatus !== 'connected') {
            socket.emit('message_sent', { 
                success: false, 
                error: 'WhatsApp belum terhubung' 
            });
            return;
        }

        try {
            const customerPhone = getOrCreateCustomerPhone(data.jobId);
            const customerNumber = `${customerPhone}@c.us`;
            
            await client.sendMessage(customerNumber, data.message);
            
            if (!chatSessions.has(data.jobId)) {
                chatSessions.set(data.jobId, []);
            }
            
            const messageData = {
                id: Date.now().toString(),
                sender: 'courier',
                message: data.message,
                timestamp: new Date(),
                type: 'sent'
            };
            
            chatSessions.get(data.jobId).push(messageData);
            
            io.emit('message_sent', { 
                success: true,
                jobId: data.jobId,
                message: messageData
            });
            
        } catch (error) {
            console.error('❌ Gagal kirim pesan:', error);
            socket.emit('message_sent', { 
                success: false, 
                error: error.message 
            });
        }
    });

    socket.on('get_chat_history', (data) => {
        const history = chatSessions.get(data.jobId) || [];
        socket.emit('chat_history', {
            jobId: data.jobId,
            messages: history
        });
    });

    socket.on('disconnect', () => {
        console.log('❌ Client disconnected:', socket.id);
    });
});

// Routes
app.get('/', (req, res) => {
    res.json({ 
        status: 'Server Running', 
        whatsapp_status: whatsappStatus,
        initialization_attempts: initializationAttempts
    });
});

app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        whatsapp: whatsappStatus,
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

// Initialize WhatsApp dengan retry logic
function initializeWhatsApp() {
    initializationAttempts++;
    console.log(`🚀 Initializing WhatsApp client (Attempt ${initializationAttempts}/${MAX_INIT_ATTEMPTS})...`);
    
    if (initializationAttempts > MAX_INIT_ATTEMPTS) {
        console.error('❌ Max initialization attempts reached. Please check your configuration.');
        whatsappStatus = 'failed';
        io.emit('whatsapp_status', { status: whatsappStatus });
        return;
    }
    
    client.initialize().catch(err => {
        console.error('❌ Gagal inisialisasi WhatsApp:', err.message);
        whatsappStatus = 'error';
        
        const delay = Math.min(initializationAttempts * 5000, 30000);
        console.log(`🔄 Retrying in ${delay}ms...`);
        
        setTimeout(() => {
            initializeWhatsApp();
        }, delay);
    });
}

// Mulai inisialisasi WhatsApp dengan delay untuk memastikan server ready
setTimeout(() => {
    initializeWhatsApp();
}, 3000);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server berjalan di port ${PORT}`);
    console.log(`🔗 Frontend: ${FRONTEND_URL}`);
    console.log(`📞 WhatsApp Status: ${whatsappStatus}`);
    console.log(`🐳 DOCKER OPTIMIZED: Fixed Puppeteer initialization`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('🛑 Shutting down gracefully...');
    client.destroy();
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});