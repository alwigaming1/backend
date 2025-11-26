// courier-app.js - VERSI DIPERBAIKI DENGAN FIX TELEPHONE FUNCTION

const FREE_BACKEND_URL = 'https://backend-production-e12e5.up.railway.app';

let socket = null;
let whatsappStatus = 'disconnected';
let courierState = {
    jobs: [],
    history: [],
    balance: 185000,
    activeDeliveries: [],
    onlineMode: true,
};
let jobIdCounter = 1000;
let simulatedJobInterval = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// === VARIABLES UNTUK CHAT ===
let currentChatJobId = null;
let chatMessages = {};

// --- UTILITY FUNCTIONS ---

function showNotification(message, type = 'info') {
    const notificationContainer = document.getElementById('notificationContainer');
    if (!notificationContainer) return;
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    notificationContainer.prepend(notification);
    
    setTimeout(() => {
        notification.classList.add('hide');
        notification.addEventListener('transitionend', () => notification.remove());
    }, 5000);
}

function updateWhatsAppStatusUI(status) {
    const statusElement = document.getElementById('whatsappStatusText');
    const dotElement = document.getElementById('whatsappStatusDot');
    const headerDotElement = document.querySelector('.header-left .status-dot');
    const headerTextElement = document.querySelector('.header-left .status-text');
    
    if (!statusElement) return;

    whatsappStatus = status;
    statusElement.textContent = `WhatsApp: ${status.toUpperCase().replace('_', ' ')}`;
    
    if (dotElement) {
        dotElement.className = 'status-dot';
        if (status === 'connected') {
            dotElement.classList.add('online');
        } else if (status === 'qr_received' || status === 'connecting') {
            dotElement.classList.add('warning');
        } else {
            dotElement.classList.add('offline');
        }
    }

    if (headerDotElement && headerTextElement) {
        headerDotElement.className = 'status-dot';
        if (courierState.onlineMode) {
            if (status === 'connected') {
                headerDotElement.classList.add('online');
                headerTextElement.textContent = 'Online';
            } else {
                headerDotElement.classList.add('warning');
                headerTextElement.textContent = 'Disconnected';
            }
        } else {
            headerDotElement.classList.add('offline');
            headerTextElement.textContent = 'Offline';
        }
    }
}

function showQRCodeModal(qrData) {
    const modal = document.getElementById('qrCodeModal');
    const qrImage = document.getElementById('qrCodeImage');
    const qrStatusText = document.getElementById('qrStatusText');
    if (modal && qrImage) {
        qrImage.src = qrData;
        qrStatusText.textContent = 'QR Code tersedia. Scan sekarang!';
        modal.style.display = 'flex';
    }
}

function closeQRCodeModal() {
    const modal = document.getElementById('qrCodeModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function updateBadges() {
    const jobCount = courierState.jobs.length;
    // Update badge di sidebar
    const badgeElementSidebar = document.querySelector('.sidebar-nav .nav-item[data-page="jobs"] .nav-badge');
    // Update badge di dashboard (lihat semua)
    const badgeElementDashboard = document.getElementById('jobsBadge');
    // Update jobs count di halaman jobs
    const jobsCountElement = document.getElementById('jobsCount');
    
    if (badgeElementSidebar) {
        badgeElementSidebar.textContent = jobCount;
        badgeElementSidebar.style.display = jobCount > 0 ? 'flex' : 'none';
    }
    if (badgeElementDashboard) {
        badgeElementDashboard.textContent = jobCount;
    }
    if (jobsCountElement) {
        jobsCountElement.textContent = jobCount;
    }
    
    // Update balance
    const balanceElement = document.querySelector('.balance-amount');
    if (balanceElement) {
         balanceElement.textContent = `Rp ${courierState.balance.toLocaleString('id-ID')}`;
    }
}

function loadJobs() {
    const jobsList = document.getElementById('jobsList');
    const jobsPreviewList = document.getElementById('jobsPreviewList');
    if (!jobsList || !jobsPreviewList) return;
    
    // Kosongkan list
    jobsList.innerHTML = '';
    jobsPreviewList.innerHTML = '';

    // Jika tidak ada jobs
    if (courierState.jobs.length === 0) {
        jobsList.innerHTML = '<div class="no-data">Tidak ada pesanan baru saat ini.</div>';
        jobsPreviewList.innerHTML = '<div class="no-data">Tidak ada pesanan baru.</div>';
        return;
    }

    // Urutkan jobs berdasarkan waktu (terbaru pertama)
    const sortedJobs = [...courierState.jobs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Isi jobsList (halaman jobs)
    sortedJobs.forEach(job => {
        const jobItem = document.createElement('div');
        jobItem.className = 'job-item';
        jobItem.innerHTML = `
            <div class="job-info">
                <span class="job-id">#${job.id}</span>
                <span class="job-time">${new Date(job.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div class="job-details">
                <p><strong>Pickup:</strong> ${job.pickup.name} - ${job.pickup.address.substring(0, 30)}...</p>
                <p><strong>Delivery:</strong> ${job.delivery.name} - ${job.delivery.address.substring(0, 30)}...</p>
                <p><strong>Jarak:</strong> ${job.distance} km | <strong>Est. Waktu:</strong> ${job.estimate} min</p>
            </div>
            <div class="job-actions">
                <button class="btn btn-accept" onclick="acceptJob('${job.id}')">TERIMA (Rp ${job.payment.toLocaleString('id-ID')})</button>
                <button class="btn btn-reject" onclick="rejectJob('${job.id}')">TOLAK</button>
            </div>
        `;
        jobsList.appendChild(jobItem);
    });

    // Isi jobsPreviewList (halaman dashboard) - maksimal 2
    sortedJobs.slice(0, 2).forEach(job => {
        const previewCard = document.createElement('div');
        previewCard.className = `job-preview-card ${job.priority === 'urgent' ? 'urgent' : ''}`;
        previewCard.innerHTML = `
            <div class="job-preview-header">
                <div class="job-meta">
                    <span class="job-preview-id">#${job.id}</span>
                    <span class="job-time">${new Date(job.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <span class="job-preview-badge ${job.priority === 'urgent' ? 'urgent' : ''}">${job.priority === 'urgent' ? 'URGENT' : 'STANDARD'}</span>
            </div>
            <div class="job-preview-route">
                <div class="route-from">
                    <span class="route-icon">🏪</span>
                    <span class="route-text">${job.pickup.name}</span>
                </div>
                <span class="route-arrow">→</span>
                <div class="route-to">
                    <span class="route-icon">🏠</span>
                    <span class="route-text">${job.delivery.name}</span>
                </div>
            </div>
            <div class="job-preview-details">
                <div class="detail">
                    <span class="detail-label">Jarak:</span>
                    <span class="detail-value">${job.distance} km</span>
                </div>
                <div class="detail">
                    <span class="detail-label">Estimasi:</span>
                    <span class="detail-value">${job.estimate} min</span>
                </div>
            </div>
            <div class="job-preview-footer">
                <span class="job-preview-price">Rp ${job.payment.toLocaleString('id-ID')}</span>
                <button class="view-job-btn" onclick="showPage('jobs')">Ambil</button>
            </div>
        `;
        jobsPreviewList.appendChild(previewCard);
    });
}

function loadHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;
    historyList.innerHTML = '';

    const filter = document.getElementById('historyFilter');
    const filterValue = filter ? filter.value : 'all';
    const filteredHistory = courierState.history.filter(job => filterValue === 'all' || job.status === filterValue);

    if (filteredHistory.length === 0) {
        historyList.innerHTML = '<div class="no-data">Tidak ada riwayat untuk filter ini.</div>';
        return;
    }

    filteredHistory.sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt)).forEach(job => {
        const item = document.createElement('div');
        item.className = `history-item ${job.status}`;
        item.innerHTML = `
            <div class="history-header">
                <span class="history-id">#${job.id}</span>
                <span class="history-status ${job.status}">${job.status.toUpperCase()}</span>
            </div>
            <div class="history-details">
                <p>Pickup: ${job.pickup.name}</p>
                <p>Delivery: ${job.delivery.name}</p>
                <p>Pembayaran: <strong>Rp ${job.payment.toLocaleString('id-ID')}</strong></p>
                <span class="history-date">${new Date(job.completedAt || job.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </div>
        `;
        historyList.appendChild(item);
    });
}

function loadEarnings() {
    const totalEarningsEl = document.getElementById('totalEarnings');
    const earningsListEl = document.getElementById('earningsList');
    if (!totalEarningsEl || !earningsListEl) return;
    
    const completedJobs = courierState.history.filter(j => j.status === 'completed');
    const totalEarnings = completedJobs.reduce((sum, job) => sum + job.payment, 0);

    totalEarningsEl.textContent = `Rp ${totalEarnings.toLocaleString('id-ID')}`;
    earningsListEl.innerHTML = '';
    
    if (completedJobs.length === 0) {
        earningsListEl.innerHTML = '<div class="no-data">Belum ada transaksi bulan ini.</div>';
        return;
    }
    
    completedJobs.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt)).forEach(job => {
        const item = document.createElement('div');
        item.className = 'earning-item';
        item.innerHTML = `
            <div class="earning-details">
                <div class="earning-description">Pengiriman #${job.id} Selesai</div>
                <div class="earning-date">${new Date(job.completedAt).toLocaleDateString('id-ID')}</div>
            </div>
            <div class="earning-amount">+ Rp ${job.payment.toLocaleString('id-ID')}</div>
        `;
        earningsListEl.appendChild(item);
    });
}

function updateActiveDeliveryUI() {
    const activeDeliveryCard = document.getElementById('activeDeliveryCard');
    const fullDeliveryCard = document.getElementById('fullDeliveryCard');
    const deliveryActions = document.getElementById('deliveryActions');
    const timerElement = document.getElementById('deliveryTimer');

    if (courierState.activeDeliveries.length > 0) {
        const activeDelivery = courierState.activeDeliveries[0];
        
        if (activeDeliveryCard) activeDeliveryCard.style.display = 'block';
        
        const deliveryIdElement = document.getElementById('deliveryId');
        const deliveryAddressElement = document.getElementById('deliveryAddress');
        
        if (deliveryIdElement) deliveryIdElement.textContent = `#${activeDelivery.id}`;
        if (deliveryAddressElement) deliveryAddressElement.textContent = activeDelivery.delivery.address.substring(0, 30) + '...';

        if (fullDeliveryCard) {
            fullDeliveryCard.innerHTML = `
                <div class="delivery-header">
                    <span class="delivery-id">#${activeDelivery.id}</span>
                    <span class="delivery-status-badge">ON DELIVERY</span>
                </div>
                <div class="delivery-locations">
                    <div class="location-row">
                        <span class="location-icon"><i class="fas fa-store"></i></span>
                        <div class="location-details">
                            <div class="location-type">PICKUP DARI</div>
                            <div class="location-address">${activeDelivery.pickup.name} (${activeDelivery.pickup.address})</div>
                        </div>
                    </div>
                    <div class="location-row">
                        <span class="location-icon end"><i class="fas fa-map-marker-alt"></i></span>
                        <div class="location-details">
                            <div class="location-type">TUJUAN KE</div>
                            <div class="location-address">${activeDelivery.delivery.name} (${activeDelivery.delivery.address})</div>
                        </div>
                    </div>
                </div>
                <div class="delivery-stats">
                    <div class="stat-item">
                        <span>Jarak:</span> <strong>${activeDelivery.distance} km</strong>
                    </div>
                    <div class="stat-item">
                        <span>Estimasi Selesai:</span> <strong>${activeDelivery.estimate} min</strong>
                    </div>
                    <div class="stat-item">
                        <span>Pembayaran:</span> <strong>Rp ${activeDelivery.payment.toLocaleString('id-ID')}</strong>
                    </div>
                </div>
            `;
            fullDeliveryCard.classList.remove('no-data');
        }
        
        if (deliveryActions) deliveryActions.style.display = 'flex';
        
        const startedAt = activeDelivery.startedAt ? new Date(activeDelivery.startedAt) : new Date();
        
        function updateActiveDeliveryTimer() {
            const now = new Date();
            const elapsed = Math.floor((now - startedAt) / 1000);
            const hours = String(Math.floor(elapsed / 3600)).padStart(2, '0');
            const minutes = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
            const seconds = String(elapsed % 60).padStart(2, '0');
            
            if (timerElement) {
                timerElement.textContent = `${hours}:${minutes}:${seconds}`;
            }

            const progressBar = document.getElementById('routeProgress');
            const courierMarker = document.querySelector('.current-position');
            if (progressBar && courierMarker) {
                const randomProgress = Math.min(90, Math.max(10, Math.floor(Math.random() * 80) + 10));
                progressBar.style.width = `${randomProgress}%`;
                courierMarker.style.left = `${randomProgress}%`;
            }
        }

        if (!window.deliveryTimerInterval) {
            updateActiveDeliveryTimer(); 
            window.deliveryTimerInterval = setInterval(updateActiveDeliveryTimer, 1000);
        }

    } else {
        if (activeDeliveryCard) activeDeliveryCard.style.display = 'none';
        if (fullDeliveryCard) {
            fullDeliveryCard.innerHTML = '<div class="no-data">Anda tidak sedang dalam pengiriman aktif.</div>';
            fullDeliveryCard.classList.add('no-data');
        }
        if (deliveryActions) deliveryActions.style.display = 'none';

        if (window.deliveryTimerInterval) {
            clearInterval(window.deliveryTimerInterval);
            window.deliveryTimerInterval = null;
        }
    }
}

function completeDelivery() {
    if (courierState.activeDeliveries.length === 0) return;

    const completedJob = courierState.activeDeliveries.shift();
    completedJob.status = 'completed';
    completedJob.completedAt = new Date();
    
    courierState.balance += completedJob.payment;
    courierState.history.push(completedJob);
    
    const balanceElement = document.querySelector('.balance-amount');
    if (balanceElement) {
         balanceElement.textContent = `Rp ${courierState.balance.toLocaleString('id-ID')}`;
    }

    if (socket) socket.emit('job_completed', { jobId: completedJob.id, courierId: 'courier_001' });

    showNotification(`Pengiriman #${completedJob.id} Selesai! Saldo bertambah.`, 'success');
    updateActiveDeliveryUI();
    showPage('dashboard');
    loadHistory();
    loadEarnings();
}

// --- MAIN LOGIC --- 

function acceptJob(jobId) {
    if (courierState.activeDeliveries.length > 0) {
        showNotification('Anda sudah memiliki pengiriman aktif! Selesaikan dulu.', 'warning');
        return;
    }
    const jobIndex = courierState.jobs.findIndex(job => job.id === jobId);
    if (jobIndex === -1) {
        showNotification('Pesanan tidak ditemukan.', 'error');
        return;
    }
    
    const job = courierState.jobs.splice(jobIndex, 1)[0];
    job.status = 'on_delivery';
    job.startedAt = new Date();
    courierState.activeDeliveries.push(job);
    
    if (socket) {
        socket.emit('job_accepted', { jobId: jobId, courierId: 'courier_001' });
    }
    showNotification(`Pesanan #${jobId} Diterima! Mulai pengiriman.`, 'success');
    updateBadges();
    loadJobs();
    updateActiveDeliveryUI();
    showPage('active-delivery');
}

function rejectJob(jobId) {
    const jobIndex = courierState.jobs.findIndex(job => job.id === jobId);
    if (jobIndex === -1) return;
    
    const job = courierState.jobs.splice(jobIndex, 1)[0];
    job.status = 'cancelled';
    job.completedAt = new Date();
    courierState.history.push(job);
    
    if (socket) {
        socket.emit('job_rejected', { jobId: jobId, courierId: 'courier_001' });
    }
    showNotification(`Pesanan #${jobId} Ditolak.`, 'warning');
    updateBadges();
    loadJobs();
    loadHistory();
}

function simulateNewJob(showNotif = true) {
    jobIdCounter++;
    const newJobId = 'SIM' + jobIdCounter; 
    const locations = [
        { name: 'Toko Baju A', address: 'Jl. Riau No. 50' },
        { name: 'Warung Cepat Saji', address: 'Jl. Pemuda No. 101' },
        { name: 'Gudang Logistik X', address: 'Jl. Raya Bekasi KM 20' },
        { name: 'Kantor Pusat', address: 'Jl. HR Rasuna Said' },
    ];
    
    const pickup = locations[Math.floor(Math.random() * locations.length)];
    let delivery;
    do {
        delivery = locations[Math.floor(Math.random() * locations.length)];
    } while (delivery === pickup);
    
    const payment = Math.floor(Math.random() * 80 + 30) * 1000;

    const newJob = {
        id: newJobId,
        pickup: pickup,
        delivery: delivery,
        distance: (Math.random() * 5 + 2).toFixed(1),
        estimate: Math.floor(Math.random() * 20 + 15),
        payment: payment,
        status: 'new',
        createdAt: new Date(),
        customer: { id: 'CUST'+jobIdCounter, name: 'Pelanggan ' + jobIdCounter },
        priority: Math.random() > 0.7 ? 'urgent' : 'standard'
    };
    
    courierState.jobs.push(newJob);
    updateBadges();
    loadJobs();
    if (showNotif) {
        showNotification(`Pesanan baru #${newJobId} tersedia! (Simulasi)`, 'info');
    }
}

function loadOrdersFromBackend() {
    if (courierState.jobs.length === 0) {
        if (!socket || socket.disconnected) {
            // Jika socket terputus, gunakan simulasi
            simulateNewJob(false);
            simulateNewJob(false);
            showNotification('Koneksi backend terputus, menggunakan data simulasi.', 'warning');
        } else {
            // Minta data dari server
            socket.emit('request_initial_data', { courierId: 'courier_001' });
        }
    }
    updateBadges();
    loadJobs();
    loadHistory();
    loadEarnings();
}

// === TELEPHONE FUNCTIONS - FIX FINAL ===

function callCustomer(jobId) {
    console.log('📞 [TELEPON] Memulai panggilan ke customer untuk job:', jobId);
    
    if (!jobId) {
        showNotification('Tidak ada job yang aktif untuk dipanggil', 'error');
        return;
    }

    if (!socket || socket.disconnected) {
        showNotification('Koneksi backend terputus. Tidak dapat melakukan panggilan.', 'error');
        return;
    }

    console.log('📞 [TELEPON] Mengirim request nomor customer untuk job:', jobId);
    
    // Show loading notification
    showNotification('Mencari nomor customer...', 'info');
    
   // Kirim request ke backend
    socket.emit('request_customer_phone', { 
        jobId: jobId
    });
}

// === CHAT FUNCTIONS ===

function showChatModal(jobId) {
    console.log('💬 Membuka chat modal untuk job:', jobId);
    
    const modal = document.getElementById('chatModal');
    const jobIdEl = document.getElementById('chatJobId');
    
    if (!modal || !jobIdEl) {
        console.error('Element chat modal tidak ditemukan');
        return;
    }
    
    currentChatJobId = jobId;
    jobIdEl.textContent = jobId;
    
    const chatInput = document.getElementById('chatInput');
    if (chatInput) chatInput.value = '';
    
    if (socket) {
        console.log('📥 Meminta history chat untuk:', jobId);
        socket.emit('get_chat_history', { jobId: jobId });
    }
    
    modal.classList.add('active');
    modal.style.display = 'flex';
    
    loadChatMessages(jobId);
}

function closeChatModal() {
    const modal = document.getElementById('chatModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }
}

function loadChatMessages(jobId) {
    const chatMessagesEl = document.getElementById('chatMessages');
    if (!chatMessagesEl) return;
    
    const messages = chatMessages[jobId] || [];
    console.log('📨 Memuat pesan untuk', jobId, ':', messages.length, 'pesan');
    
    chatMessagesEl.innerHTML = '';
    
    if (messages.length === 0) {
        chatMessagesEl.innerHTML = `
            <div class="no-chat-messages">
                Belum ada pesan. Mulai percakapan dengan customer.
            </div>
        `;
        return;
    }
    
    messages.forEach(msg => {
        const messageElement = createMessageElement(msg);
        chatMessagesEl.appendChild(messageElement);
    });
    
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function createMessageElement(messageData) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message-item ${messageData.sender === 'courier' ? 'sent' : 'received'}`;
    
    const time = new Date(messageData.timestamp).toLocaleTimeString('id-ID', { 
        hour: '2-digit', minute: '2-digit' 
    });
    
    messageDiv.innerHTML = `
        <div class="message-bubble">${messageData.message}</div>
        <div class="message-footer">
            <span class="message-time">${time}</span>
            ${messageData.sender === 'courier' ? '<span class="message-status read">✓✓</span>' : ''}
        </div>
    `;
    
    return messageDiv;
}

function sendChatMessage() {
    const input = document.getElementById('chatInput');
    if (!input) return;
    
    const message = input.value.trim();
    
    if (!message || !currentChatJobId) return;
    
    const tempMessage = {
        id: 'temp_' + Date.now(),
        sender: 'courier',
        message: message,
        timestamp: new Date(),
        type: 'sent'
    };
    
    addMessageToChat(currentChatJobId, tempMessage);
    input.value = '';
    
    if (socket) {
        socket.emit('send_message', {
            jobId: currentChatJobId,
            message: message
        });
    }
}

function addMessageToChat(jobId, messageData) {
    if (!chatMessages[jobId]) {
        chatMessages[jobId] = [];
    }
    
    chatMessages[jobId] = chatMessages[jobId].filter(msg => 
        !(msg.id && messageData.id && msg.id === messageData.id)
    );
    
    chatMessages[jobId].push(messageData);
    
    chatMessages[jobId].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    if (currentChatJobId === jobId) {
        loadChatMessages(jobId);
    }
}

// === SOCKET EVENT LISTENERS - FIX FINAL ===

function setupSocketListeners() {
    if (!socket) return;
    
    console.log('🔧 Setup semua socket listeners');
    
    // === TELEPHONE LISTENER - FIX: Gunakan once untuk menghindari duplikasi ===
    socket.off('customer_phone_received'); // Hapus listener lama
    socket.on('customer_phone_received', function handleCustomerPhone(data) {
        console.log('📞 [TELEPON] Response customer_phone_received:', data);
        
        if (data && data.success && data.phone) {
            // Format nomor untuk panggilan WhatsApp
            const formattedPhone = data.phone.replace(/\D/g, '');
            const whatsappCallUrl = `https://wa.me/${formattedPhone}`;
            
            console.log('🔗 WhatsApp call URL:', whatsappCallUrl);
            
            // Buka jendela baru untuk panggilan WhatsApp
            window.open(whatsappCallUrl, '_blank', 'noopener,noreferrer');
            
            showNotification(`Membuka panggilan WhatsApp ke customer...`, 'success');
            
        } else {
            const errorMsg = data?.error || 'Tidak dapat mendapatkan nomor customer';
            console.error('❌ Error telepon:', errorMsg);
            showNotification(`Gagal memanggil customer: ${errorMsg}`, 'error');
        }
    });
    
    // === CHAT LISTENERS ===
    socket.off('new_message');
    socket.off('message_sent');
    socket.off('chat_history');
    
    socket.on('new_message', (data) => {
        console.log('📨 Pesan baru dari server:', data);
        
        if (data && data.jobId && data.message) {
            const messageData = data.message;
            console.log(`💬 Memproses pesan untuk job ${data.jobId}:`, messageData);
            
            addMessageToChat(data.jobId, messageData);
            
            if (currentChatJobId !== data.jobId) {
                showNotification(`Pesan baru dari Customer #${data.jobId}`, 'info');
            }
        } else {
            console.error('❌ Struktur data new_message tidak valid:', data);
        }
    });
    
    socket.on('message_sent', (data) => {
        console.log('✅ Konfirmasi pengiriman pesan:', data);
        
        if (data.success && data.message) {
            addMessageToChat(data.jobId, data.message);
        } else if (!data.success) {
            showNotification(`Gagal mengirim pesan: ${data.error}`, 'error');
        }
    });
    
    socket.on('chat_history', (data) => {
        console.log('📂 Menerima history chat:', data);
        if (data.jobId && data.messages) {
            chatMessages[data.jobId] = data.messages;
            if (currentChatJobId === data.jobId) {
                loadChatMessages(data.jobId);
            }
        }
    });

    // === OTHER LISTENERS ===
    socket.off('initial_jobs');
    socket.on('initial_jobs', (jobs) => {
        console.log('Received initial jobs:', jobs);
        if (jobs && jobs.length > 0) {
            courierState.jobs = jobs;
        }
        updateBadges();
        loadJobs();
    });

    socket.off('new_job_available');
    socket.on('new_job_available', (job) => {
        courierState.jobs.push(job);
        updateBadges();
        loadJobs();
        showNotification(`📢 Pesanan baru #${job.id} tersedia! (Rp ${job.payment.toLocaleString('id-ID')})`, 'info');
    });

    socket.off('whatsapp_status');
    socket.on('whatsapp_status', (data) => {
        console.log('WhatsApp Status:', data);
        if (data && data.status) {
            updateWhatsAppStatusUI(data.status);
            if (data.status === 'qr_received' && data.qr) {
                showQRCodeModal(data.qr);
                showNotification('Harap scan QR Code WhatsApp Anda.', 'warning');
            } else if (data.status === 'connected') {
                closeQRCodeModal();
                showNotification('WhatsApp berhasil terhubung!', 'success');
            }
        }
    });

    // Debug: Log semua event socket untuk troubleshooting
    socket.offAny();
    socket.onAny((eventName, ...args) => {
        if (eventName !== 'customer_phone_received') { // Hindari spam log untuk event ini
            console.log(`🔍 Socket Event: ${eventName}`, args);
        }
    });
}

function initChatSystem() {
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
        chatInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                sendChatMessage();
            }
        });
    }
    
    // Event listener untuk tombol telepon - FIX: Gunakan event delegation
    document.addEventListener('click', function(e) {
        if (e.target.closest('#callCustomerBtn')) {
            console.log('🔘 Call button clicked, currentChatJobId:', currentChatJobId);
            
            if (currentChatJobId) {
                // Add ringing animation
                const callBtn = e.target.closest('#callCustomerBtn');
                callBtn.classList.add('ringing');
                setTimeout(() => {
                    callBtn.classList.remove('ringing');
                }, 500);
                
                callCustomer(currentChatJobId);
            } else {
                console.error('❌ No currentChatJobId available');
                showNotification('Tidak ada customer yang aktif untuk dipanggil', 'error');
            }
        }
    });
}

// --- SOCKET.IO CONNECTION ---

function connectWebSocket() {
    try {
        // Hentikan koneksi sebelumnya jika ada
        if (socket) {
            socket.disconnect();
            socket = null;
        }

        console.log('🔄 Menghubungkan ke backend...');
        socket = io(FREE_BACKEND_URL, {
            query: { role: 'courier', courierId: 'courier_001' },
            transports: ['websocket', 'polling'],
            timeout: 10000
        });

        socket.on('connect', () => {
            console.log('✅ Connected to FREE backend! Socket ID:', socket.id);
            showNotification('Koneksi backend berhasil!', 'success');
            reconnectAttempts = 0;
            
            if (simulatedJobInterval) {
                clearInterval(simulatedJobInterval);
                simulatedJobInterval = null;
            }
            
            // Setup semua listeners setelah terkoneksi
            setupSocketListeners();
            
            socket.emit('get_whatsapp_status');
            // Meminta data jobs saat terkoneksi
            socket.emit('request_initial_data', { courierId: 'courier_001' });
        });

        socket.on('disconnect', (reason) => {
            console.log('❌ Disconnected from FREE backend:', reason);
            updateWhatsAppStatusUI('disconnected');
            showNotification('Koneksi backend terputus', 'error');
            
            // Coba reconnect setelah delay
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
                console.log(`Mencoba reconnect dalam ${delay}ms (percobaan ${reconnectAttempts})`);
                
                setTimeout(() => {
                    if (!socket || socket.disconnected) {
                        connectWebSocket();
                    }
                }, delay);
            } else {
                console.log('Max reconnection attempts reached. Using simulation mode.');
                if (!simulatedJobInterval) {
                    simulatedJobInterval = setInterval(() => simulateNewJob(), 30000);
                }
            }
        });

        socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            showNotification('Gagal terhubung ke backend', 'error');
            updateWhatsAppStatusUI('disconnected');
        });

    } catch (error) {
        console.error('Error connecting to Socket.IO:', error);
        showNotification('Gagal terhubung ke Socket.IO. Menggunakan mode simulasi.', 'error');
        updateWhatsAppStatusUI('disconnected');
        
        if (!simulatedJobInterval) {
            simulatedJobInterval = setInterval(() => simulateNewJob(), 30000);
        }
    }
}

// --- NAVIGATION & UI HANDLERS ---
function showPage(pageId) {
    const pages = document.querySelectorAll('.page');
    pages.forEach(page => page.classList.remove('active'));
    const activePage = document.getElementById(pageId);
    if (activePage) {
        activePage.classList.add('active');

        document.querySelectorAll('.nav-item').forEach(item => {
            if (item.getAttribute('data-page') === pageId) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        if (pageId === 'jobs') loadJobs();
        if (pageId === 'history') loadHistory();
        if (pageId === 'earnings') loadEarnings();
        if (pageId === 'active-delivery') updateActiveDeliveryUI();
        
        // Update current date
        if (pageId === 'dashboard') {
            const currentDateEl = document.getElementById('currentDate');
            if (currentDateEl) {
                const now = new Date();
                currentDateEl.textContent = now.toLocaleDateString('id-ID', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                });
            }
        }
    }
}

function initCourierApp() {
    // Initialize menu button
    const menuBtn = document.getElementById('menuBtn');
    if (menuBtn) {
        menuBtn.addEventListener('click', () => {
            document.getElementById('sidebar').classList.add('active');
            document.getElementById('overlay').classList.add('active');
        });
    }
    
    // Initialize close sidebar
    const closeSidebar = document.getElementById('closeSidebar');
    if (closeSidebar) {
        closeSidebar.addEventListener('click', () => {
            document.getElementById('sidebar').classList.remove('active');
            document.getElementById('overlay').classList.remove('active');
        });
    }
    
    // Initialize overlay
    const overlay = document.getElementById('overlay');
    if (overlay) {
        overlay.addEventListener('click', () => {
            document.getElementById('sidebar').classList.remove('active');
            document.getElementById('overlay').classList.remove('active');
        });
    }

    // Initialize navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const pageId = this.getAttribute('data-page');
            showPage(pageId);
            document.getElementById('sidebar').classList.remove('active');
            document.getElementById('overlay').classList.remove('active');
        });
    });

    // Initialize status toggle
    const statusToggle = document.getElementById('statusToggle');
    if (statusToggle) {
        statusToggle.addEventListener('change', function() {
            courierState.onlineMode = this.checked;
            showNotification(`Mode ${this.checked ? 'Online' : 'Offline'}`, this.checked ? 'success' : 'warning');
            updateWhatsAppStatusUI(whatsappStatus);
            
            if (this.checked && (!socket || socket.disconnected)) {
                connectWebSocket();
            }
        });
    }
    
    // Initialize notification container if not exists
    if (!document.getElementById('notificationContainer')) {
        const container = document.createElement('div');
        container.id = 'notificationContainer';
        document.body.appendChild(container);
    }
    
    updateBadges();
    loadHistory(); 
    loadEarnings();
    updateActiveDeliveryUI();
    
    // Initialize chat system
    initChatSystem();
    
    // Set current date
    const currentDateEl = document.getElementById('currentDate');
    if (currentDateEl) {
        const now = new Date();
        currentDateEl.textContent = now.toLocaleDateString('id-ID', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    initCourierApp();
    connectWebSocket();
});