// server.js - FIXED NO PUPPETEER - USING EXTERNAL WHATSAPP API
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
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

// === SIMULASI WHATSAPP - TANPA PUPPETEER ===
function simulateWhatsAppConnection() {
    console.log('🔧 Simulating WhatsApp connection...');
    whatsappStatus = 'connecting';
    
    // Simulate QR code after 2 seconds
    setTimeout(() => {
        const fakeQR = '2@XaBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890AbCdEfGhIjKlMnOpQrStUvWxYz';
        qrCodeData = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(fakeQR)}`;
        whatsappStatus = 'qr_received';
        
        console.log('📱 Simulated QR Code Received');
        qrcode.generate(fakeQR, { small: true });
        
        io.emit('whatsapp_status', { 
            status: whatsappStatus, 
            qr: qrCodeData 
        });
        
        // Simulate connection after 5 seconds
        setTimeout(() => {
            whatsappStatus = 'connected';
            console.log('✅ WhatsApp Simulation Connected!');
            io.emit('whatsapp_status', { status: whatsappStatus });
        }, 5000);
        
    }, 2000);
}

// === SAMPLE DATA DENGAN NOMOR TESTING ===
const TEST_PHONES = [
    '6281234567890',  // Nomor testing 1
    '6289876543210'   // Nomor testing 2
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

// === FIXED TELEPHONE HANDLER ===
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

// === SIMULATED MESSAGE SENDING ===
function simulateSendMessage(jobId, message) {
    console.log(`💬 [SIMULASI] Mengirim pesan untuk job ${jobId}: ${message}`);
    
    // Simpan pesan di history chat
    if (!chatSessions.has(jobId)) {
        chatSessions.set(jobId, []);
    }
    
    const messageData = {
        id: Date.now().toString(),
        sender: 'courier',
        message: message,
        timestamp: new Date(),
        type: 'sent'
    };
    
    chatSessions.get(jobId).push(messageData);
    
    // Simulate customer response after 2-5 seconds
    setTimeout(() => {
        const responses = [
            "Terima kasih, saya tunggu",
            "Oke, sampai jumpa",
            "Baik, terima kasih informasinya",
            "Siap, saya tunggu di lokasi"
        ];
        const randomResponse = responses[Math.floor(Math.random() * responses.length)];
        
        const customerMessage = {
            id: Date.now().toString(),
            sender: 'customer',
            message: randomResponse,
            timestamp: new Date(),
            type: 'received'
        };
        
        chatSessions.get(jobId).push(customerMessage);
        
        io.emit('new_message', {
            jobId: jobId,
            message: customerMessage
        });
        
        console.log(`📨 [SIMULASI] Customer membalas: ${randomResponse}`);
    }, 2000 + Math.random() * 3000);
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

        // SIMULASI PENGIRIMAN PESAN (tanpa WhatsApp Web)
        try {
            console.log(`📤 [SIMULASI] Mengirim pesan ke ${customerPhone}: ${data.message}`);
            
            // Simulate message sending
            simulateSendMessage(data.jobId, data.message);
            
            const messageData = {
                id: Date.now().toString(),
                sender: 'courier',
                message: data.message,
                timestamp: new Date(),
                type: 'sent'
            };
            
            // Kirim konfirmasi ke SEMUA client
            io.emit('message_sent', { 
                success: true,
                jobId: data.jobId,
                message: messageData
            });
            
            console.log('✅ Pesan berhasil dikirim (simulasi)');
            
        } catch (error) {
            console.error('❌ Gagal kirim pesan:', error);
            socket.emit('message_sent', { 
                success: false, 
                error: 'Mode simulasi: ' + error.message 
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
        status: 'Server Running - SIMULATION MODE', 
        whatsapp_status: whatsappStatus,
        active_chats: chatSessions.size,
        mappings: {
            customerMapping: Array.from(customerMapping.entries()),
            phoneToJobMapping: Array.from(phoneToJobMapping.entries())
        },
        test_phones: TEST_PHONES,
        note: 'WhatsApp dalam mode simulasi - Fitur telepon aktif'
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

// Mulai simulasi WhatsApp
simulateWhatsAppConnection();

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server berjalan di port ${PORT}`);
    console.log(`🔗 Frontend: ${FRONTEND_URL}`);
    console.log(`📞 WhatsApp Status: ${whatsappStatus} (SIMULATION MODE)`);
    console.log(`🗺️ Active Mappings: ${customerMapping.size} jobs`);
    console.log(`📱 Test Phones: ${TEST_PHONES.join(', ')}`);
    console.log(`💡 FITUR TELEPON: AKTIF - Menggunakan nomor testing`);
    console.log(`💬 CHAT: SIMULASI - Tanpa WhatsApp Web`);
    console.log(`🔧 SOLUSI: Menghindari Puppeteer untuk deploy di Railway`);
});