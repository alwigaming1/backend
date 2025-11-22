// server.js - BACKEND FINAL CORRECTED VERSION UNTUK RAILWAY + MONGODB

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');

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
    console.error('❌ FATAL ERROR: MONGO_URI tidak ditemukan! Pastikan Anda menyetelnya di Environment Variables Railway.');
    // throw new Error('MONGO_URI is not defined'); // Opsional: Hentikan proses jika gagal
} else {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('✅ MongoDB Connected!'))
        .catch(err => console.error('❌ MongoDB Connection Error:', err));
}

// --- MONGODB SCHEMA (Contoh Sederhana) ---
const JobSchema = new mongoose.Schema({
    id: String,
    courierId: String,
    status: String, // new, on_delivery, completed, cancelled
    payment: Number,
    pickup: { name: String, address: String },
    delivery: { name: String, address: String },
    distance: Number,
    createdAt: { type: Date, default: Date.now },
    startedAt: Date,
    completedAt: Date
});
const Job = mongoose.model('Job', JobSchema);

// --- WHATSAPP SIMULATION STATE ---
let whatsappStatus = 'disconnected';
let qrCodeData = null; // Simpan data QR code di sini

// --- BACKEND STATE FOR COURIERS AND JOBS ---
let backendState = {
    couriers: {}, // { 'courier_001': { online: true } }
    jobs: [] // Daftar jobs yang belum diambil
};

// --- SOCKET.IO LOGIC ---
io.on('connection', (socket) => {
    const courierId = socket.handshake.query.courierId;
    
    if (courierId) {
        backendState.couriers[courierId] = { online: true };
        console.log(`Kurir ${courierId} terhubung.`);
    }

    // [EVENT] Kurir meminta data jobs yang belum diambil
    socket.on('request_jobs', async () => {
        try {
            const jobs = await Job.find({ status: 'new' });
            socket.emit('available_jobs', jobs);
        } catch (error) {
            console.error('Error fetching jobs:', error);
        }
    });

    // [EVENT] Kurir menerima pekerjaan
    socket.on('accept_job', async (data) => {
        const job = await Job.findOneAndUpdate(
            { id: data.jobId, status: 'new' },
            { $set: { status: 'on_delivery', courierId: courierId, startedAt: new Date() } },
            { new: true }
        );
        if (job) {
            socket.emit('job_accepted', job);
            console.log(`Pekerjaan ${data.jobId} diterima oleh ${courierId}`);
            // Kirim notifikasi ke semua kurir (jika ada) bahwa job ini hilang
            io.emit('job_removed', { jobId: data.jobId });
        }
    });

    // [EVENT] Kurir menyelesaikan pekerjaan
    socket.on('job_completed', async (data) => {
        await Job.findOneAndUpdate(
            { id: data.jobId },
            { $set: { status: 'completed', completedAt: new Date() } }
        );
        console.log(`Pekerjaan ${data.jobId} diselesaikan oleh ${courierId}`);
    });
    
    // [EVENT] Cek status WhatsApp (dari frontend)
    socket.on('get_whatsapp_status', () => {
        // Kirim status simulasi
        socket.emit('whatsapp_status', { status: whatsappStatus, qr: qrCodeData });
    });

    // [EVENT] Kurir mengirim pesan
    socket.on('send_message', (data) => {
        console.log(`Pesan dari Kurir ${data.sender} untuk Job ${data.jobId}: ${data.message}`);
        // Logika di sini untuk meneruskan pesan ke Customer via WhatsApp
    });

    socket.on('disconnect', () => {
        if (courierId && backendState.couriers[courierId]) {
            backendState.couriers[courierId].online = false;
            console.log(`Kurir ${courierId} terputus.`);
        }
    });
});


// --- EXPRESS ENDPOINTS ---
app.get('/', (req, res) => {
    res.send('Courier Backend is Running! (Socket.IO port: ' + PORT + ')');
});

// Endpoint untuk Health Check (diakses dari Vercel/luar)
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        whatsapp: whatsappStatus,
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});


// Start server
server.listen(PORT, () => {
    console.log(`✅ Backend server is running on port ${PORT}`);
}); // <--- FIX: Memastikan penutupan fungsi yang benar