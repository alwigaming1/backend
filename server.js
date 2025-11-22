// server.js - BACKEND DENGAN WHATSAPP REAL
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');

// WhatsApp Web.js dengan konfigurasi khusus Railway
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

dotenv.config();

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const FRONTEND_URL = "https://pasarkilat-app.vercel.app";

// Konfigurasi Socket.IO
const io = new Server(server, {
    cors: {
        origin: FRONTEND_URL,
        methods: ["GET", "POST"],
        credentials: true
    }
});

// Middleware
app.use(cors({
    origin: FRONTEND_URL,
    credentials: true
}));
app.use(express.json());

// --- WHATSAPP CLIENT SETUP ---
let whatsappStatus = 'disconnected';
let qrCodeData = null;
let client = null;

function initializeWhatsApp() {
    console.log('🔄 Menginisialisasi WhatsApp Client...');
    
    client = new Client({
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
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
        },
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
        }
    });

    client.on('qr', (qr) => {
        console.log('📱 QR Code Received');
        qrcode.generate(qr, { small: true });
        
        // Convert QR to data URL untuk frontend
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
        qrCodeData = null;
        
        io.emit('whatsapp_status', { 
            status: whatsappStatus, 
            qr: null 
        });
    });

    client.on('authenticated', () => {
        console.log('🔐 WhatsApp Authenticated');
        whatsappStatus = 'authenticated';
    });

    client.on('auth_failure', (msg) => {
        console.error('❌ WhatsApp Auth Failure:', msg);
        whatsappStatus = 'auth_failure';
        io.emit('whatsapp_status', { 
            status: whatsappStatus, 
            error: msg 
        });
        
        // Coba ulang setelah 30 detik
        setTimeout(() => {
            if (whatsappStatus !== 'connected') {
                initializeWhatsApp();
            }
        }, 30000);
    });

    client.on('disconnected', (reason) => {
        console.log('❌ WhatsApp Disconnected:', reason);
        whatsappStatus = 'disconnected';
        io.emit('whatsapp_status', { 
            status: whatsappStatus, 
            reason: reason 
        });
        
        // Coba ulang setelah 10 detik
        setTimeout(() => {
            initializeWhatsApp();
        }, 10000);
    });

    // Handle incoming messages
    client.on('message', async (msg) => {
        if (msg.fromMe) return;
        
        console.log('📨 Pesan masuk dari:', msg.from, 'Isi:', msg.body);
        
        // Cari job berdasarkan nomor pengirim
        const job = await findJobByCustomerPhone(msg.from.replace('@c.us', ''));
        if (job) {
            io.emit('new_message', {
                jobId: job.id,
                sender: msg.from,
                message: msg.body,
                timestamp: new Date()
            });
        }
    });

    client.initialize().catch(err => {
        console.error('❌ Gagal menginisialisasi WhatsApp:', err);
        whatsappStatus = 'error';
        io.emit('whatsapp_status', { 
            status: whatsappStatus, 
            error: err.message 
        });
    });
}

// --- DATABASE & JOB MANAGEMENT ---
const JobSchema = new mongoose.Schema({
    id: String,
    customerPhone: String,
    customerName: String,
    status: String,
    pickup: {
        name: String,
        address: String,
        phone: String
    },
    delivery: {
        name: String,
        address: String,
        phone: String
    },
    payment: Number,
    distance: String,
    estimate: String,
    createdAt: { type: Date, default: Date.now }
});

const Job = mongoose.models.Job || mongoose.model('Job', JobSchema);

// Simulasi data jobs jika tidak ada MongoDB
const sampleJobs = [
    {
        id: 'ORD1001',
        customerPhone: '6281234567890', // Ganti dengan nomor WhatsApp nyata untuk testing
        customerName: 'Budi Santoso',
        status: 'new',
        pickup: {
            name: 'Toko Serba Ada',
            address: 'Jl. Merdeka No. 123, Jakarta',
            phone: '628111111111'
        },
        delivery: {
            name: 'Budi Santoso',
            address: 'Jl. Sudirman No. 456, Jakarta Selatan',
            phone: '6281234567890'
        },
        payment: 45000,
        distance: '3.2 km',
        estimate: '25 menit'
    }
];

async function findJobByCustomerPhone(phone) {
    if (MONGO_URI) {
        return await Job.findOne({ customerPhone: phone });
    }
    return sampleJobs.find(job => job.customerPhone === phone);
}

async function findJobById(jobId) {
    if (MONGO_URI) {
        return await Job.findOne({ id: jobId });
    }
    return sampleJobs.find(job => job.id === jobId);
}

// --- SOCKET.IO HANDLERS ---
io.on('connection', (socket) => {
    console.log('✅ Client connected:', socket.id);
    
    // Kirim status WhatsApp saat ini
    socket.emit('whatsapp_status', { 
        status: whatsappStatus, 
        qr: qrCodeData 
    });

    // Kirim sample jobs
    socket.emit('initial_jobs', sampleJobs);

    // Handle permintaan data awal
    socket.on('request_initial_data', (data) => {
        socket.emit('initial_jobs', sampleJobs);
    });

    // Handle terima job
    socket.on('job_accepted', async (data) => {
        console.log('✅ Job accepted:', data);
        
        const job = await findJobById(data.jobId);
        if (job && whatsappStatus === 'connected') {
            // Kirim notifikasi ke customer via WhatsApp
            const customerNumber = `${job.customerPhone}@c.us`;
            const message = `Halo ${job.customerName}! 🎉\n\nKurir PasarKilat telah menerima pesanan Anda (#${job.id}).\nKurir sedang menuju ke lokasi penjemputan.\n\nEstimasi sampai: ${job.estimate}\n\nTerima kasih! 🛵`;
            
            try {
                await client.sendMessage(customerNumber, message);
                console.log('📢 Notifikasi terkirim ke customer');
            } catch (error) {
                console.error('❌ Gagal kirim notifikasi:', error);
            }
        }
        
        socket.emit('job_accepted_success', data);
    });

    // Handle kirim pesan ke customer
    socket.on('send_message', async (data) => {
        console.log('💬 Mengirim pesan:', data);
        
        const job = await findJobById(data.jobId);
        if (!job) {
            socket.emit('message_sent', { 
                success: false, 
                error: 'Job tidak ditemukan' 
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
            const customerNumber = `${job.customerPhone}@c.us`;
            await client.sendMessage(customerNumber, data.message);
            
            socket.emit('message_sent', { 
                success: true,
                jobId: data.jobId 
            });
            
            // Simpan pesan yang dikirim di history
            io.emit('new_message', {
                jobId: data.jobId,
                sender: 'courier',
                message: data.message,
                timestamp: new Date()
            });
            
        } catch (error) {
            console.error('❌ Gagal kirim pesan:', error);
            socket.emit('message_sent', { 
                success: false, 
                error: error.message 
            });
        }
    });

    // Handle job selesai
    socket.on('job_completed', async (data) => {
        console.log('🏁 Job completed:', data);
        
        const job = await findJobById(data.jobId);
        if (job && whatsappStatus === 'connected') {
            // Kirim notifikasi penyelesaian ke customer
            const customerNumber = `${job.customerPhone}@c.us`;
            const message = `Halo ${job.customerName}! 🎊\n\nPesanan Anda (#${job.id}) telah SELESAI diantar!\n\nTerima kasih telah menggunakan PasarKilat! 🙏\n\nRating dan ulasan Anda sangat berarti bagi kami.`;
            
            try {
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

// --- EXPRESS ROUTES ---
app.get('/', (req, res) => {
    res.json({ 
        status: 'Server Running', 
        whatsapp_status: whatsappStatus,
        message: 'PasarKilat Courier Backend dengan WhatsApp',
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        whatsapp: whatsappStatus,
        time: new Date().toISOString() 
    });
});

// Endpoint untuk manual WhatsApp status
app.get('/whatsapp-status', (req, res) => {
    res.json({
        status: whatsappStatus,
        hasQR: !!qrCodeData,
        timestamp: new Date().toISOString()
    });
});

// --- START SERVER ---
async function startServer() {
    try {
        if (MONGO_URI) {
            await mongoose.connect(MONGO_URI);
            console.log('✅ MongoDB Connected');
        }
        
        // Mulai WhatsApp client
        initializeWhatsApp();
        
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server berjalan di port ${PORT}`);
            console.log(`📱 Frontend: ${FRONTEND_URL}`);
            console.log(`📞 WhatsApp Status: ${whatsappStatus}`);
        });
    } catch (error) {
        console.error('❌ Gagal start server:', error);
        process.exit(1);
    }
}

startServer();