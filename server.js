// server.js - BACKEND FINAL CORRECTED VERSION UNTUK RAILWAY + MONGODB

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
// --- WHATSAPP IMPORTS (BARU) ---
const { Client, LocalAuth } = require('whatsapp-web.js'); 
const qrcode = require('qrcode-terminal');             

// Muat variabel lingkungan dari file .env (penting untuk development lokal)
dotenv.config();

const app = express();
const server = http.createServer(app);

// ------------------------------------------
// 1. Deklarasi PORT dan MONGO_URI dari Environment Variables
// ------------------------------------------
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI; // Variabel dari Railway Environment

// ------------------------------------------
// 2. Konfigurasi Socket.IO dan CORS (Mengizinkan Vercel)
// ------------------------------------------
// Izinkan koneksi HANYA dari frontend Vercel Anda (URL yang BENAR)
const io = new Server(server, {
    cors: {
        origin: "https://pasarkilat-app.vercel.app", // FIX: Menggunakan URL Vercel Anda
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());

// ------------------------------------------
// 3. MONGODB CONNECTION
// ------------------------------------------
if (!MONGO_URI) {
    console.error('❌ FATAL: Variabel MONGO_URI tidak ditemukan. Cek .env atau Railway Variables.');
}
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- MONGODB SCHEMA (Contoh Sederhana) ---
const JobSchema = new mongoose.Schema({
    id: String,
    courierId: String,
    status: String, // new, on_delivery, completed, cancelled
    payment: Number,
    pickup: { name: String, address: String, lat: Number, lng: Number },
    delivery: { name: String, address: String, lat: Number, lng: Number },
    // Tambahkan field lain sesuai kebutuhan
    createdAt: { type: Date, default: Date.now },
    completedAt: Date,
    customerPhone: String // BARU: Nomor HP Customer
});

const Job = mongoose.model('Job', JobSchema);

// --- WHATSAPP LOGIC (KUNCI UTAMA) ---

let whatsappStatus = 'disconnected';
let qrCodeData = null; // Menyimpan data QR

// Inisialisasi Klien WhatsApp
const client = new Client({
    // LocalAuth menyimpan sesi di folder .wwebjs_auth
    authStrategy: new LocalAuth({ clientId: 'courier_app' }),
    puppeteer: {
        // Opsi ini PENTING untuk deployment di platform seperti Railway/Vercel
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

client.on('qr', (qr) => {
    // Tampilkan di konsol (opsional)
    qrcode.generate(qr, { small: true }); 
    
    // Simpan data QR dan update status
    qrCodeData = qr; 
    whatsappStatus = 'qr_received';
    console.log('⏳ QR Code Diterima. Update status ke frontend.');
    
    // Kirim QR ke semua klien Socket.IO (frontend kurir)
    io.emit('whatsapp_status', { status: whatsappStatus, qr: qrCodeData });
});

client.on('ready', () => {
    whatsappStatus = 'connected';
    qrCodeData = null; // Bersihkan QR setelah terhubung
    io.emit('whatsapp_status', { status: whatsappStatus, qr: null });
    console.log('✅ WhatsApp Berhasil Terhubung!');
});

client.on('disconnected', (reason) => {
    whatsappStatus = 'disconnected';
    qrCodeData = null;
    io.emit('whatsapp_status', { status: whatsappStatus, qr: null });
    console.log('❌ WhatsApp Terputus:', reason);
    // Coba inisialisasi ulang setelah jeda
    setTimeout(() => client.initialize(), 10000);
});

client.on('message', async (msg) => {
    // Logika untuk menangani pesan masuk dari Customer
    if (msg.fromMe) return; // Abaikan pesan dari diri sendiri
    
    // Asumsi: Customer mengirim pesan ke nomor kurir yang terhubung
    // Cari job yang sedang aktif/berlangsung dengan nomor customer tersebut
    // (Dalam kasus nyata, Anda perlu logika yang lebih kompleks untuk mengidentifikasi Job ID dari nomor WA)
    
    // Contoh sederhana: Notifikasi pesan masuk
    // Nomor WA yang masuk dalam format '628xxx@c.us'
    const customerNumber = msg.from.replace('@c.us', ''); 
    
    // Kirim notifikasi pesan ke semua kurir yang terhubung
    io.emit('new_message', {
        jobId: 'Unknown', // Perlu logika pencarian Job
        sender: customerNumber,
        message: msg.body
    });
    console.log(`💬 Pesan masuk dari ${customerNumber}: ${msg.body}`);
});

// Mulai Klien WhatsApp 
client.initialize().catch(err => console.error('Gagal inisialisasi WA:', err));


// --- SOCKET.IO LOGIC ---

// State Simulasi (sebelum pindah ke MongoDB)
const backendState = {
    jobs: [], // Daftar pesanan baru
    couriers: {} // Status online kurir
};

// Fungsi simulasi untuk membuat job baru (hanya untuk pengujian)
function createSimulatedJob() {
    // ... (Fungsi simulasi job, dihilangkan untuk fokus pada WA)
    // ...
}

io.on('connection', (socket) => {
    console.log('🔗 Kurir Baru Terhubung via Socket.IO:', socket.id);

    let courierId = socket.handshake.query.courierId || 'courier_001';
    
    // Kirim status WhatsApp saat kurir terhubung
    socket.emit('whatsapp_status', { status: whatsappStatus, qr: qrCodeData });

    // Handle permintaan pengiriman pesan dari kurir
    socket.on('send_message', async (data) => {
        // data: { jobId: '...', message: '...' }
        console.log(`Permintaan pesan untuk Job ${data.jobId}: ${data.message}`);

        // 1. Cari detail Job untuk mendapatkan nomor Customer
        const job = await Job.findOne({ id: data.jobId });
        
        if (!job || !job.customerPhone) {
            socket.emit('message_sent', { jobId: data.jobId, success: false, error: 'Nomor customer tidak ditemukan.' });
            return console.error(`Job/Customer Phone tidak ditemukan untuk Job ID: ${data.jobId}`);
        }
        
        // Format nomor WA yang benar (misal: '62812xxxx@c.us')
        const customerNumber = `${job.customerPhone}@c.us`; 
        
        if (whatsappStatus === 'connected') {
            try {
                // KIRIM PESAN WHATSAPP NYATA
                await client.sendMessage(customerNumber, data.message);
                console.log(`Pesan WA ke ${customerNumber} terkirim.`);
                // Kirim balik notifikasi sukses ke kurir
                socket.emit('message_sent', { jobId: data.jobId, success: true });
            } catch (error) {
                console.error('Gagal kirim pesan WA:', error.message);
                socket.emit('message_sent', { jobId: data.jobId, success: false, error: 'Gagal mengirim pesan WhatsApp. Cek log server.' });
            }
        } else {
            console.log('WhatsApp TIDAK TERHUBUNG. Pesan gagal dikirim.');
            socket.emit('message_sent', { jobId: data.jobId, success: false, error: 'WhatsApp belum terhubung/discan.' });
        }
    });

    // ... (Handler socket.io lainnya seperti job_accepted, job_completed, dll.)

    socket.on('disconnect', () => {
        // ...
    });
});


// --- EXPRESS ENDPOINTS ---
app.get('/', (req, res) => {
    res.send('Courier Backend is Running! (Socket.IO port: ' + PORT + ')');
});

// Start Server
server.listen(PORT, () => {
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
});