// server.js - FIXED CORS AND ORDER MANAGEMENT
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

// === PERBAIKAN CORS UNTUK SEMUA ORIGIN ===
const io = new Server(server, {
    cors: {
        origin: "*", // Izinkan semua origin untuk development
        methods: ["GET", "POST"],
        credentials: true
    }
});

app.use(express.json());

// Middleware untuk handle CORS di HTTP routes
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

let whatsappStatus = 'disconnected';
let qrCodeData = null;

// === SISTEM MAPPING YANG DIPERBAIKI ===
const customerMapping = new Map();
const phoneToJobMapping = new Map();
const chatSessions = new Map();
const activeOrders = new Map(); // Menyimpan pesanan aktif

// WhatsApp Client dengan konfigurasi Puppeteer yang diperbaiki
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
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null
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
    
    // Coba reconnect setelah 5 detik
    setTimeout(() => {
        console.log('🔄 Attempting to reconnect WhatsApp...');
        client.initialize().catch(err => {
            console.error('❌ Gagal reconnect WhatsApp:', err);
        });
    }, 5000);
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
        pickup: { 
            name: 'Toko Serba Ada', 
            address: 'Jl. Merdeka No. 123',
            gps: null
        },
        delivery: { 
            name: 'Budi Santoso', 
            address: 'Jl. Sudirman No. 456',
            gps: null
        },
        payment: 45000,
        distance: '3.2 km',
        estimate: '25 menit'
    },
    {
        id: 'ORD1002',
        customerPhone: TEST_PHONES[1],
        customerName: 'Siti Rahayu',
        status: 'new',
        pickup: { 
            name: 'Restoran Cepat Saji', 
            address: 'Jl. Gatot Subroto No. 78',
            gps: null
        },
        delivery: { 
            name: 'Siti Rahayu', 
            address: 'Jl. Thamrin No. 45',
            gps: null
        },
        payment: 38000,
        distance: '2.5 km',
        estimate: '20 menit'
    }
];

// === AUTO-MAPPING SYSTEM UNTUK JOB SIMULASI ===
function initializeMappings() {
    customerMapping.clear();
    phoneToJobMapping.clear();
    activeOrders.clear();
    
    // Mapping untuk sample jobs
    sampleJobs.forEach(job => {
        const cleanPhone = job.customerPhone.replace(/\D/g, '');
        customerMapping.set(job.id, cleanPhone);
        phoneToJobMapping.set(cleanPhone, job.id);
        activeOrders.set(job.id, job);
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

    // === HANDLE PESANAN BARU DARI ADMIN ===
    socket.on('create_order', (orderData) => {
        console.log('📦 Menerima pesanan baru dari admin:', orderData);
        
        try {
            const jobId = orderData.id || 'ORD' + Date.now();
            
            const newJob = {
                id: jobId,
                customerPhone: orderData.customer.phone,
                customerName: orderData.customer.name,
                status: 'new',
                pickup: {
                    name: orderData.pickup.name,
                    address: orderData.pickup.address,
                    gps: orderData.pickup.gps || null  // TAMBAH GPS DATA
                },
                delivery: {
                    name: orderData.delivery.name,
                    address: orderData.delivery.address,
                    gps: orderData.delivery.gps || null  // TAMBAH GPS DATA
                },
                payment: orderData.payment,
                distance: orderData.distance + ' km',
                estimate: orderData.estimate + ' menit',
                priority: orderData.priority || 'standard',
                createdAt: new Date(),
                customer: orderData.customer
            };

            activeOrders.set(jobId, newJob);
            
            const cleanPhone = newJob.customerPhone.replace(/\D/g, '');
            customerMapping.set(jobId, cleanPhone);
            phoneToJobMapping.set(cleanPhone, jobId);
            
            console.log(`✅ Pesanan baru berhasil dibuat: ${jobId}`);
            
            socket.emit('order_created', { 
                success: true, 
                jobId: jobId,
                order: newJob
            });
            
            io.emit('new_job_available', newJob);
            io.emit('order_created_broadcast', newJob);
            
        } catch (error) {
            console.error('❌ Error membuat pesanan:', error);
            socket.emit('order_created', { 
                success: false, 
                error: error.message 
            });
        }
    });

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
        
        // Update status pesanan
        const job = activeOrders.get(data.jobId);
        if (job) {
            job.status = 'processing';
            job.acceptedAt = new Date();
            job.courierId = data.courierId;
            
            // Broadcast update status
            io.emit('job_accepted_broadcast', data);
            io.emit('order_updated', job);
        }
        
        // Buat mapping untuk job yang diterima (jika belum ada)
        getOrCreateCustomerPhone(data.jobId);
        
        socket.emit('job_accepted_success', data);
    });

    // === HANDLE REQUEST TELEPON KE CUSTOMER ===
    socket.on('request_call_customer', async (data) => {
        console.log('📞 Request telepon ke customer:', data);
        
        const jobId = data.jobId;
        
        // DAPATKAN ATAU BUAT MAPPING UNTUK JOB INI
        const customerPhone = getOrCreateCustomerPhone(jobId);
        
        if (!customerPhone) {
            console.error('❌ Tidak bisa menemukan customer untuk job:', jobId);
            socket.emit('call_status', { 
                success: false, 
                error: 'Tidak dapat menemukan nomor customer untuk job ini' 
            });
            return;
        }

        console.log(`📞 Mengirim nomor telepon customer: ${customerPhone} untuk job: ${jobId}`);
        
        // Kirim nomor customer ke frontend
        socket.emit('customer_phone_received', { 
            success: true,
            jobId: jobId,
            phone: customerPhone,
            message: 'Nomor customer berhasil didapatkan'
        });
    });

    // === HANDLE REQUEST NOMOR CUSTOMER ===
    socket.on('get_customer_phone', (data) => {
        console.log('📱 Request nomor customer untuk job:', data.jobId);
        
        const customerPhone = getOrCreateCustomerPhone(data.jobId);
        
        if (customerPhone) {
            console.log(`✅ Mengirim nomor customer: ${customerPhone}`);
            socket.emit('customer_phone_received', { 
                success: true,
                jobId: data.jobId,
                phone: customerPhone
            });
        } else {
            console.error('❌ Nomor customer tidak ditemukan untuk job:', data.jobId);
            socket.emit('customer_phone_received', { 
                success: false, 
                error: 'Nomor customer tidak ditemukan' 
            });
        }
    });

    // === HANDLE JOB COMPLETED ===
    socket.on('job_completed', (data) => {
        console.log('🎊 Job completed:', data.jobId);
        
        // Update status pesanan
        const job = activeOrders.get(data.jobId);
        if (job) {
            job.status = 'completed';
            job.completedAt = new Date();
            
            // Broadcast update status
            io.emit('job_completed_broadcast', data);
            io.emit('order_updated', job);
        }
    });

    // === DEBUG: LOG SEMUA EVENT ===
    socket.onAny((eventName, ...args) => {
        if (!eventName.includes('ping') && !eventName.includes('pong')) {
            console.log(`🔍 Socket Event: ${eventName}`, args);
        }
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
        active_orders: activeOrders.size,
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
        activeOrders: Array.from(activeOrders.entries()),
        chatSessions: Array.from(chatSessions.entries()).map(([jobId, messages]) => ({
            jobId,
            messageCount: messages.length
        }))
    });
});

// Initialize WhatsApp dengan error handling yang lebih baik
async function initializeWhatsApp() {
    try {
        console.log('🔄 Starting WhatsApp initialization...');
        await client.initialize();
        console.log('✅ WhatsApp initialization completed');
    } catch (err) {
        console.error('❌ Gagal inisialisasi WhatsApp:', err);
        whatsappStatus = 'error';
        
        // Coba lagi setelah 10 detik
        setTimeout(() => {
            console.log('🔄 Retrying WhatsApp initialization...');
            initializeWhatsApp();
        }, 10000);
    }
}

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server berjalan di port ${PORT}`);
    console.log(`📞 WhatsApp Status: ${whatsappStatus}`);
    console.log(`🗺️ Active Mappings: ${customerMapping.size} jobs`);
    console.log(`📦 Active Orders: ${activeOrders.size} pesanan`);
    console.log(`📱 Test Phones: ${TEST_PHONES.join(', ')}`);
    console.log(`💡 AUTO-MAPPING: AKTIF untuk job simulasi`);
    
    // Start WhatsApp initialization
    initializeWhatsApp();
});
