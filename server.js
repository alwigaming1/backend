// server.js - BACKEND FINAL (KONFIRMASI PERBAIKAN CORS DAN WA LOGIC)

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
// --- WHATSAPP IMPORTS (KUNCI) ---
const { Client, LocalAuth } = require('whatsapp-web.js'); 
const qrcode = require('qrcode-terminal');             

dotenv.config();

const app = express();
const server = http.createServer(app);

// ------------------------------------------
// 1. Deklarasi PORT dan MONGO_URI
// ------------------------------------------
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI; 
// KONFIRMASI: URL FRONTEND VERCEL ANDA
const FRONTEND_URL = "https://pasarkilat-app.vercel.app"; 

// ------------------------------------------
// 2. Konfigurasi Socket.IO dan CORS 
// ------------------------------------------
const io = new Server(server, {
    cors: {
        origin: FRONTEND_URL, // Mengizinkan HANYA dari Vercel Anda
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());

// ------------------------------------------
// 3. MONGODB (Opsional, untuk menyimpan customerPhone)
// ------------------------------------------
if (!MONGO_URI) {
    console.warn('⚠️ WARNING: Variabel MONGO_URI tidak ditemukan. Menggunakan data simulasi Job.');
} else {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('✅ MongoDB Connected!'))
        .catch(err => console.error('❌ MongoDB Connection Error:', err));
}

// --- MONGODB SCHEMA ---
const JobSchema = new mongoose.Schema({
    id: { type: String, unique: true },
    customerPhone: String, // KUNCI: Nomor HP Customer (misal: '62812xxxx')
    status: String, 
    pickup: { name: String, address: String },
    // ... field lainnya
});
const Job = mongoose.model('Job', JobSchema);

// --- WHATSAPP LOGIC (KUNCI UTAMA) ---

let whatsappStatus = 'disconnected';
let qrCodeData = null; 

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'courier_app' }),
    puppeteer: {
        // Opsi ini PENTING untuk deployment (Railway, Vercel, dll.)
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-extensions'],
    }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true }); 
    qrCodeData = qr; 
    whatsappStatus = 'qr_received';
    // Kirim QR ke frontend
    io.emit('whatsapp_status', { status: whatsappStatus, qr: qrCodeData });
});

client.on('ready', () => {
    whatsappStatus = 'connected';
    qrCodeData = null; 
    io.emit('whatsapp_status', { status: whatsappStatus, qr: null });
    console.log('✅ WhatsApp Berhasil Terhubung!');
});

client.on('disconnected', (reason) => {
    whatsappStatus = 'disconnected';
    qrCodeData = null;
    io.emit('whatsapp_status', { status: whatsappStatus, qr: null });
    // Coba inisialisasi ulang setelah terputus
    setTimeout(() => client.initialize().catch(err => console.error('Gagal re-init WA:', err)), 15000);
});

client.on('message', async (msg) => {
    if (msg.fromMe) return; 
    
    const customerNumber = msg.from.replace('@c.us', ''); 
    // Di sini Anda perlu mencocokkan customerNumber dengan jobId yang aktif.
    // Karena ini sulit dilakukan tanpa DB lengkap, kita gunakan ID dummy:
    io.emit('new_message', {
        jobId: 'WA_INCOMING', 
        sender: customerNumber,
        message: msg.body
    });
});

client.initialize().catch(err => console.error('Gagal inisialisasi WA:', err));


// --- SIMULASI DATA/LOGIC ---
const backendState = {
    jobs: [
        { id: '1001', customerPhone: '628123456789', status: 'on_delivery', pickup: { name: 'Gudang A', address: 'Jl. Contoh No. 1' } },
        { id: '1002', customerPhone: '6285000999888', status: 'on_delivery', pickup: { name: 'Toko B', address: 'Jl. Mawar No. 5' } }
    ],
};
async function findJobSimulated(jobId) {
    if (MONGO_URI) {
        return await Job.findOne({ id: jobId });
    }
    return backendState.jobs.find(j => j.id === jobId);
}


// --- SOCKET.IO LOGIC ---
io.on('connection', (socket) => {
    let courierId = socket.handshake.query.courierId || 'courier_001';
    
    // Kirim status WhatsApp saat kurir terhubung
    socket.emit('whatsapp_status', { status: whatsappStatus, qr: qrCodeData });

    // KUNCI: Menerima permintaan kirim pesan dari frontend
    socket.on('send_message', async (data) => {
        const job = await findJobSimulated(data.jobId);
        
        if (!job || !job.customerPhone) {
            socket.emit('message_sent', { jobId: data.jobId, success: false, error: 'Nomor customer tidak ditemukan.' });
            return;
        }
        
        // Format nomor WA yang benar (misal: '62812xxxx@c.us')
        const customerNumber = `${job.customerPhone.replace(/\D/g, '')}@c.us`; 
        
        if (whatsappStatus === 'connected') {
            try {
                await client.sendMessage(customerNumber, data.message); // KIRIM NYATA
                socket.emit('message_sent', { jobId: data.jobId, success: true });
            } catch (error) {
                console.error('Gagal kirim pesan WA:', error.message);
                socket.emit('message_sent', { jobId: data.jobId, success: false, error: 'Gagal mengirim pesan WhatsApp.' });
            }
        } else {
            socket.emit('message_sent', { jobId: data.jobId, success: false, error: 'WhatsApp belum terhubung/discan. Silakan scan QR.' });
        }
    });

    socket.on('disconnect', () => {
        // ... (Logika disconnect)
    });
});


// --- EXPRESS ENDPOINTS ---
app.get('/', (req, res) => {
    res.send('Courier Backend is Running! WA Status: ' + whatsappStatus);
});

server.listen(PORT, () => {
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
});