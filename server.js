// server.js - OPTIMIZED FOR RAILWAY DEPLOYMENT
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

// === SISTEM MAPPING YANG DIPERBAIKI ===
const customerMapping = new Map();
const phoneToJobMapping = new Map();
const chatSessions = new Map();

// WhatsApp Client - OPTIMIZED FOR RAILWAY
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
            '--disable-features=site-per-process',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
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
            '--enable-features=NetworkService,NetworkServiceInProcess',
            '--max-old-space-size=512'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        ignoreDefaultArgs: ['--disable-extensions'],
        timeout: 60000
    }
});

// === WHATSAPP EVENT HANDLERS ===
client.on('qr', (qr) => {
    console.log('📱 QR Code Received');
    qrcode.generate(qr, { small: true });
    
    qrCodeData = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qr)}`;
    whatsappStatus = 'qr_received';
    
    io.emit('whatsapp_status', { 
        status: whatsappStatus, 
        qr: qrCodeData 
    });
});

client.on('ready', () => {
    console.log('✅ WhatsApp Client is Ready!');
    whatsappStatus = 'connected';
    io.emit('whatsapp_status', { status: whatsappStatus });
});

client.on('disconnected', (reason) => {
    console.log('❌ WhatsApp Disconnected:', reason);
    whatsappStatus = 'disconnected';
    io.emit('whatsapp_status', { status: whatsappStatus });
});

// === HANDLE PESAN MASUK DARI CUSTOMER ===
client.on('message', async (msg) => {
    if (msg.fromMe) return;
    
    const customerPhone = msg.from.replace('@c.us', '');
    console.log('📨 Pesan masuk dari:', customerPhone, 'Isi:', msg.body);
    
    // Cari jobId berdasarkan nomor customer
    const jobId = phoneToJobMapping.get(customerPhone);
    
    if (jobId) {
        console.log(`✅ Pesan dialihkan ke job: ${jobId}`);
        
        // Simpan pesan ke history chat
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
        
        // PERBAIKAN: Kirim ke SEMUA client yang terhubung dengan struktur yang benar
        io.emit('new_message', {
            jobId: jobId,
            message: messageData
        });
        
        console.log(`📤 Event new_message dikirim untuk job: ${jobId}`);
        
    } else {
        console.log('❌ Pesan dari nomor tidak terdaftar:', customerPhone);
        
        // Coba cari jobId dari pesan (jika customer menyebutkan ID job)
        const jobIdMatch = msg.body.match(/#(\w+)/);
        if (jobIdMatch) {
            const extractedJobId = jobIdMatch[1];
            console.log(`🔍 Mencoba mapping otomatis: ${customerPhone} -> ${extractedJobId}`);
            phoneToJobMapping.set(customerPhone, extractedJobId);
            customerMapping.set(extractedJobId, customerPhone);
            
            // Kirim notifikasi mapping berhasil
            io.emit('mapping_created', {
                phone: customerPhone,
                jobId: extractedJobId
            });
        }
    }
});

// === SAMPLE DATA DENGAN NOMOR TESTING ===
// ⚠️ GANTI NOMOR-NOMOR INI DENGAN NOMOR WA ANDA UNTUK TESTING!
const TEST_PHONES = [
    '6282195036971',  // Ganti dengan nomor WA Anda
    '6282195036971'   // Ganti dengan nomor WA lain
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

// === AUTO-MAPPING SYSTEM UNTUK JOB SIMULASI ===
function initializeMappings() {
    customerMapping.clear();
    phoneToJobMapping.clear();
    
    // Mapping untuk sample jobs
    sampleJobs.forEach(job => {
        const cleanPhone = job.customerPhone.replace(/\D/g, '');
        customerMapping.set(job.id, cleanPhone);
        phoneToJobMapping.set(cleanPhone, job.id);
    });
    
    console.log('🔄 Mapping initialized:', {
        jobs: sampleJobs.length,
        customerMapping: Array.from(customerMapping.entries())
    });
}

// Fungsi untuk membuat mapping otomatis untuk job simulasi
function createSimulatedJobMapping(jobId) {
    // Pilih nomor acak dari TEST_PHONES untuk job simulasi
    const randomPhone = TEST_PHONES[Math.floor(Math.random() * TEST_PHONES.length)];
    const cleanPhone = randomPhone.replace(/\D/g, '');
    
    customerMapping.set(jobId, cleanPhone);
    phoneToJobMapping.set(cleanPhone, jobId);
    
    console.log(`🔗 Auto-mapping created: ${jobId} -> ${cleanPhone}`);
    
    return cleanPhone;
}

// Fungsi untuk mendapatkan atau membuat mapping untuk job
function getOrCreateCustomerPhone(jobId) {
    let customerPhone = customerMapping.get(jobId);
    
    if (!customerPhone) {
        // Buat mapping otomatis untuk SEMUA job yang tidak ada mappingnya
        customerPhone = createSimulatedJobMapping(jobId);
    }
    
    return customerPhone;
}

initializeMappings();

// === FIXED TELEPHONE HANDLER - NEW APPROACH ===
function setupTelephoneHandler(socket) {
    console.log('🔧 Setting up telephone handler for socket:', socket.id);
    
    // Hapus event listener lama jika ada
    socket.removeAllListeners('request_customer_phone');
    
    // Setup event listener baru
    socket.on('request_customer_phone', (data) => {
        console.log('📞 [BACKEND] request_customer_phone EVENT TRIGGERED!', data);
        
        if (!data || !data.jobId) {
            console.log('❌ [BACKEND] Invalid data received:', data);
            socket.emit('customer_phone_received', {
                success: false,
                error: 'Data tidak valid'
            });
            return;
        }

        const jobId = data.jobId;
        console.log('🔍 [BACKEND] Processing phone request for job:', jobId);
        
        try {
            // DAPATKAN ATAU BUAT MAPPING UNTUK JOB INI
            const customerPhone = getOrCreateCustomerPhone(jobId);
            
            if (customerPhone) {
                console.log('✅ [BACKEND] Phone found/created:', customerPhone);
                
                // Pastikan format nomor benar
                const cleanPhone = customerPhone.replace(/\D/g, '');
                console.log('🔧 [BACKEND] Clean phone number:', cleanPhone);
                
                // KIRIM RESPONSE KE CLIENT YANG MEMINTA
                const responseData = {
                    success: true,
                    jobId: jobId,
                    phone: cleanPhone
                };
                
                console.log('📤 [BACKEND] Emitting customer_phone_received:', responseData);
                socket.emit('customer_phone_received', responseData);
                console.log('✅ [BACKEND] customer_phone_received event sent to client:', socket.id);
                
            } else {
                console.log('❌ [BACKEND] No phone number available for job:', jobId);
                
                socket.emit('customer_phone_received', {
                    success: false,
                    jobId: jobId,
                    error: 'Nomor customer tidak tersedia'
                });
            }
        } catch (error) {
            console.error('❌ [BACKEND] Error in request_customer_phone:', error);
            socket.emit('customer_phone_received', {
                success: false,
                jobId: jobId,
                error: 'Terjadi kesalahan sistem: ' + error.message
            });
        }
    });
}

// === SOCKET.IO CONNECTION HANDLER ===
io.on('connection', (socket) => {
    console.log('✅ Client connected:', socket.id);
    
    // Kirim status awal
    socket.emit('whatsapp_status', { 
        status: whatsappStatus, 
        qr: qrCodeData 
    });

    socket.emit('initial_jobs', sampleJobs);

    // Setup telephone handler
    setupTelephoneHandler(socket);

    // === OTHER EVENT HANDLERS ===
    socket.on('call_log', (data) => {
        console.log('📞 Log panggilan:', data);
    });

    socket.on('send_message', async (data) => {
        console.log('💬 Kurir mengirim pesan:', data);
        
        const customerPhone = getOrCreateCustomerPhone(data.jobId);
        
        if (!customerPhone) {
            console.error('❌ Tidak bisa membuat mapping untuk job:', data.jobId);
            socket.emit('message_sent', { 
                success: false, 
                error: 'Tidak dapat menemukan customer untuk job ini' 
            });
            return;
        }

        if (whatsappStatus !== 'connected') {
            console.error('❌ WhatsApp belum terhubung');
            socket.emit('message_sent', { 
                success: false, 
                error: 'WhatsApp belum terhubung' 
            });
            return;
        }

        try {
            const customerNumber = `${customerPhone}@c.us`;
            console.log('📤 Mengirim ke:', customerNumber);
            
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
            
            console.log('✅ Pesan berhasil dikirim ke customer');
            
        } catch (error) {
            console.error('❌ Gagal kirim pesan:', error);
            socket.emit('message_sent', { 
                success: false, 
                error: error.message 
            });
        }
    });

    socket.on('get_chat_history', (data) => {
        console.log('📂 Diminta history chat untuk job:', data.jobId);
        const history = chatSessions.get(data.jobId) || [];
        socket.emit('chat_history', {
            jobId: data.jobId,
            messages: history
        });
    });

    socket.on('job_accepted', async (data) => {
        console.log('✅ Job accepted:', data.jobId);
        getOrCreateCustomerPhone(data.jobId);
        socket.emit('job_accepted_success', data);
    });

    // === DEBUG: LOG SEMUA EVENT ===
    socket.onAny((eventName, ...args) => {
        console.log(`🔍 [BACKEND] Socket Event: ${eventName} from ${socket.id}`, args);
    });

    socket.on('disconnect', () => {
        console.log('❌ Client disconnected:', socket.id);
    });
});

// Routes untuk debugging
app.get('/', (req, res) => {
    res.json({ 
        status: 'Server Running', 
        whatsapp_status: whatsappStatus,
        active_chats: chatSessions.size,
        mappings: {
            customerMapping: Array.from(customerMapping.entries()),
            phoneToJobMapping: Array.from(phoneToJobMapping.entries())
        },
        test_phones: TEST_PHONES
    });
});

app.get('/debug', (req, res) => {
    res.json({
        whatsappStatus,
        customerMapping: Array.from(customerMapping.entries()),
        phoneToJobMapping: Array.from(phoneToJobMapping.entries()),
        chatSessions: Array.from(chatSessions.entries()).map(([jobId, messages]) => ({
            jobId,
            messageCount: messages.length
        }))
    });
});

// Route untuk debug telepon
app.get('/call-debug', (req, res) => {
    res.json({
        customerMapping: Array.from(customerMapping.entries()),
        phoneToJobMapping: Array.from(phoneToJobMapping.entries()),
        test_phones: TEST_PHONES
    });
});

// Health check route
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        whatsapp: whatsappStatus,
        uptime: process.uptime()
    });
});

// Initialize WhatsApp
function initializeWhatsApp() {
    console.log('🚀 Initializing WhatsApp client...');
    client.initialize().catch(err => {
        console.error('❌ Gagal inisialisasi WhatsApp:', err.message);
        whatsappStatus = 'error';
        
        setTimeout(() => {
            console.log('🔄 Mencoba restart WhatsApp client...');
            initializeWhatsApp();
        }, 10000);
    });
}

// Mulai inisialisasi WhatsApp
initializeWhatsApp();

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server berjalan di port ${PORT}`);
    console.log(`🔗 Frontend: ${FRONTEND_URL}`);
    console.log(`📞 WhatsApp Status: ${whatsappStatus}`);
    console.log(`🗺️ Active Mappings: ${customerMapping.size} jobs`);
    console.log(`📱 Test Phones: ${TEST_PHONES.join(', ')}`);
    console.log(`💡 RAILWAY OPTIMIZED: Konfigurasi Puppeteer diperbarui`);
    console.log(`🔧 DEBUG: Logging ditingkatkan untuk troubleshooting`);
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