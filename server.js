// === GPS TRACKING SYSTEM ===

const courierLocations = new Map();

// Handle location updates dari kurir
io.on('connection', (socket) => {
    // ... kode existing ...

    // Handle location updates
    socket.on('location_update', (data) => {
        console.log('📍 Location update dari kurir:', data.courierId);
        
        courierLocations.set(data.courierId, {
            location: data.location,
            timestamp: data.timestamp,
            socketId: socket.id
        });

        // Broadcast ke admin dan client lain yang membutuhkan
        io.emit('courier_location_updated', {
            courierId: data.courierId,
            location: data.location,
            timestamp: data.timestamp
        });
    });

    // Handle request lokasi kurir
    socket.on('get_courier_location', (data) => {
        const location = courierLocations.get(data.courierId);
        socket.emit('courier_location', {
            courierId: data.courierId,
            location: location,
            success: !!location
        });
    });

    // Cleanup ketika kurir disconnect
    socket.on('disconnect', () => {
        // Hapus lokasi kurir yang disconnect
        for (let [courierId, locationData] of courierLocations.entries()) {
            if (locationData.socketId === socket.id) {
                courierLocations.delete(courierId);
                console.log(`📍 Menghapus lokasi kurir ${courierId} karena disconnect`);
                break;
            }
        }
    });
});

// Route untuk mendapatkan lokasi kurir
app.get('/api/courier/:courierId/location', (req, res) => {
    const courierId = req.params.courierId;
    const location = courierLocations.get(courierId);
    
    if (location) {
        res.json({
            success: true,
            courierId: courierId,
            location: location.location,
            timestamp: location.timestamp
        });
    } else {
        res.json({
            success: false,
            error: 'Lokasi kurir tidak ditemukan'
        });
    }
});
