// server.js - SISTEM CHAT AMAN DENGAN MAPPING
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

// === SISTEM MAPPING UNTUK PRIVACY ===
const customerMapping = new Map(); // Map: jobId -> customerPhone
const phoneToJobMapping = new Map(); // Map: customerPhone -> jobId
const chatSessions = new Map(); // Map: jobId -> chat history

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
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable'
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
    
    setTimeout(() => {
        client.initialize().catch(console.error);
    }, 10000);
});

// === HANDLE PESAN MASUK DARI CUSTOMER ===
client.on('message', async (msg) => {
    if (msg.fromMe) return;
    
    const customerPhone = msg.from.replace('@c.us', '');
    console.log('📨 Pesan masuk dari:', customerPhone, 'Isi:', msg.body);
    
    // Cari jobId berdasarkan nomor customer
    const jobId = phoneToJobMapping.get(customerPhone);
    
    if (jobId) {
        // Simpan pesan ke history chat
        if (!chatSessions.has(jobId)) {
            chatSessions.set(jobId, []);
        }
        
        const messageData = {
            id: Date.now(),
            sender: 'customer',
            message: msg.body,
            timestamp: new Date(),
            type: 'received'
        };
        
        chatSessions.get(jobId).push(messageData);
        
        // Kirim ke frontend (TANPA menampilkan nomor asli)
        io.emit('new_message', {
            jobId: jobId,
            message: messageData,
            customerName: `Customer #${jobId}` // Hanya tampilkan ID, bukan nomor
        });
        
        console.log(`✅ Pesan customer dialihkan ke job: ${jobId}`);
    } else {
        console.log('❌ Pesan dari nomor tidak terdaftar:', customerPhone);
        
        // Optional: Auto-reply untuk nomor tidak dikenal
        if (msg.body.toLowerCase().includes('order') || msg.body.toLowerCase().includes('pesanan')) {
            const reply = `Halo! Untuk informasi pesanan, silakan hubungi kurir melalui aplikasi PasarKilat. Terima kasih!`;
            await client.sendMessage(msg.from, reply);
        }
    }
});

client.initialize().catch(console.error);

// === SAMPLE DATA DENGAN MAPPING ===
const sampleJobs = [
    {
        id: 'ORD1001',
        customerPhone: '6285696814717', // GANTI dengan nomor WA customer nyata
        customerName: 'Budi Santoso',
        status: 'new',
        pickup: { name: 'Toko Serba Ada', address: 'Jl. Merdeka No. 123' },
        delivery: { name: 'Budi Santoso', address: 'Jl. Sudirman No. 456' },
        payment: 45000,
        distance: '3.2 km',
        estimate: '25 menit'
    }
];

// Inisialisasi mapping dari sample jobs
sampleJobs.forEach(job => {
    customerMapping.set(job.id, job.customerPhone);
    phoneToJobMapping.set(job.customerPhone, job.id);
});

// === SOCKET.IO HANDLERS ===
io.on('connection', (socket) => {
    console.log('✅ Client connected:', socket.id);
    
    socket.emit('whatsapp_status', { status: whatsappStatus, qr: qrCodeData });
    socket.emit('initial_jobs', sampleJobs);

    // === KIRIM PESAN KE CUSTOMER ===
    socket.on('send_message', async (data) => {
        console.log('💬 Kurir mengirim pesan untuk job:', data.jobId);
        
        const customerPhone = customerMapping.get(data.jobId);
        
        if (!customerPhone) {
            socket.emit('message_sent', { 
                success: false, 
                error: 'Customer tidak ditemukan untuk job ini' 
            });
            return;
        }

        if (whatsappStatus !== 'connected') {
            socket.emit('message_sent', { 
                success: false, 
                error: 'WhatsApp belum terhubung' 
            });
            return;
        }

        try {
            // Kirim pesan ke customer via WhatsApp
            const customerNumber = `${customerPhone}@c.us`;
            await client.sendMessage(customerNumber, data.message);
            
            // Simpan pesan di history chat
            if (!chatSessions.has(data.jobId)) {
                chatSessions.set(data.jobId, []);
            }
            
            const messageData = {
                id: Date.now(),
                sender: 'courier',
                message: data.message,
                timestamp: new Date(),
                type: 'sent'
            };
            
            chatSessions.get(data.jobId).push(messageData);
            
            // Kirim konfirmasi ke frontend
            socket.emit('message_sent', { 
                success: true,
                jobId: data.jobId,
                message: messageData
            });
            
            console.log('✅ Pesan terkirim ke customer:', customerPhone);
            
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
        const history = chatSessions.get(data.jobId) || [];
        socket.emit('chat_history', {
            jobId: data.jobId,
            messages: history
        });
    });

    // === JOB DITERIMA - KIRIM NOTIFIKASI OTOMATIS ===
    socket.on('job_accepted', async (data) => {
        console.log('✅ Job accepted:', data.jobId);
        
        const job = sampleJobs.find(j => j.id === data.jobId);
        const customerPhone = customerMapping.get(data.jobId);
        
        if (job && customerPhone && whatsappStatus === 'connected') {
            const message = `Halo ${job.customerName}! 🎉\n\nKurir PasarKilat telah menerima pesanan Anda (#${job.id}).\nKurir sedang menuju ke lokasi penjemputan.\n\nEstimasi sampai: ${job.estimate}\n\nTerima kasih! 🛵`;
            
            try {
                const customerNumber = `${customerPhone}@c.us`;
                await client.sendMessage(customerNumber, message);
                console.log('📢 Notifikasi diterima terkirim ke customer');
            } catch (error) {
                console.error('❌ Gagal kirim notifikasi:', error);
            }
        }
        
        socket.emit('job_accepted_success', data);
    });

    // === JOB SELESAI - KIRIM NOTIFIKASI ===
    socket.on('job_completed', async (data) => {
        console.log('🏁 Job completed:', data.jobId);
        
        const job = sampleJobs.find(j => j.id === data.jobId);
        const customerPhone = customerMapping.get(data.jobId);
        
        if (job && customerPhone && whatsappStatus === 'connected') {
            const message = `Halo ${job.customerName}! 🎊\n\nPesanan Anda (#${job.id}) telah SELESAI diantar!\n\nTerima kasih telah menggunakan PasarKilat! 🙏`;
            
            try {
                const customerNumber = `${customerPhone}@c.us`;
                await client.sendMessage(customerNumber, message);
                console.log('✅ Notifikasi selesai terkirim');
            } catch (error) {
                console.error('❌ Gagal kirim notifikasi selesai:', error);
            }
        }
        
        socket.emit('job_completed_success', data);
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
        active_chats: chatSessions.size,
        message: 'Sistem Chat Aman PasarKilat - Privacy Terjaga'
    });
});

app.get('/mapping-status', (req, res) => {
    res.json({
        customerMapping: Object.fromEntries(customerMapping),
        phoneToJobMapping: Object.fromEntries(phoneToJobMapping),
        activeChats: Array.from(chatSessions.keys())
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server berjalan di port ${PORT}`);
    console.log(`🔒 Sistem Chat Privacy: AKTIF`);
    console.log(`📱 Mapping jobs: ${customerMapping.size} jobs terdaftar`);
});