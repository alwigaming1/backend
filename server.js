// server.js - FIXED WITH AUTO-MAPPING FOR SIMULATED JOBS
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const FRONTEND_URL = "https://pasarkilat-app.vercel.app";

const io = new Server(server, {
    cors: {
        origin: FRONTEND_URL,
        methods: ["GET", "POST"]
    }
});

app.use(express.json());

let whatsappStatus = 'disconnected';
let qrCodeData = null;

// === SISTEM MAPPING YANG DIPERBAIKI ===
const customerMapping = new Map();
const phoneToJobMapping = new Map();
const chatSessions = new Map();

// WhatsApp Client
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
            '--single-process',
            '--disable-gpu'
        ]
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
    '6282195036971',  // Ganti dengan nomor WA lain (atau sama)
    '6282195036971'   // Ganti dengan nomor WA lain (atau sama)
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
    
    if (!customerPhone && jobId.startsWith('SIM')) {
        // Buat mapping otomatis untuk job simulasi
        customerPhone = createSimulatedJobMapping(jobId);
    }
    
    return customerPhone;
}

initializeMappings();

// === SOCKET.IO HANDLERS YANG DIPERBAIKI ===
io.on('connection', (socket) => {
    console.log('✅ Client connected:', socket.id);
    
    socket.emit('whatsapp_status', { 
        status: whatsappStatus, 
        qr: qrCodeData 
    });

    socket.emit('initial_jobs', sampleJobs);

    // === KIRIM PESAN KE CUSTOMER ===
    socket.on('send_message', async (data) => {
        console.log('💬 Kurir mengirim pesan:', {
            jobId: data.jobId,
            message: data.message
        });
        
        // DAPATKAN ATAU BUAT MAPPING UNTUK JOB INI
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
            // Kirim pesan ke customer via WhatsApp
            const customerNumber = `${customerPhone}@c.us`;
            console.log('📤 Mengirim ke:', customerNumber);
            
            await client.sendMessage(customerNumber, data.message);
            
            // Simpan pesan di history chat
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
            
            // Kirim konfirmasi ke SEMUA client
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

    // === MENDAPATKAN HISTORY CHAT ===
    socket.on('get_chat_history', (data) => {
        console.log('📂 Diminta history chat untuk job:', data.jobId);
        const history = chatSessions.get(data.jobId) || [];
        socket.emit('chat_history', {
            jobId: data.jobId,
            messages: history
        });
    });

    // === HANDLE JOB ACCEPTED (UNTUK SIMULASI) ===
    socket.on('job_accepted', async (data) => {
        console.log('✅ Job accepted:', data.jobId);
        
        // Buat mapping untuk job yang diterima (jika belum ada)
        getOrCreateCustomerPhone(data.jobId);
        
        socket.emit('job_accepted_success', data);
    });

    // === DEBUG: LOG SEMUA EVENT ===
    socket.onAny((eventName, ...args) => {
        console.log(`🔍 Socket Event: ${eventName}`, args);
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

// Initialize WhatsApp
client.initialize().catch(err => {
    console.error('❌ Gagal inisialisasi WhatsApp:', err);
    whatsappStatus = 'error';
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server berjalan di port ${PORT}`);
    console.log(`🔗 Frontend: ${FRONTEND_URL}`);
    console.log(`📞 WhatsApp Status: ${whatsappStatus}`);
    console.log(`🗺️ Active Mappings: ${customerMapping.size} jobs`);
    console.log(`📱 Test Phones: ${TEST_PHONES.join(', ')}`);
    console.log(`💡 AUTO-MAPPING: AKTIF untuk job simulasi`);
});