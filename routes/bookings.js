const express = require('express');
const router = express.Router();
const { isAuthenticated, isOwner, isRenter, isPropertyOwner } = require('../middleware/auth');
const Booking = require('../models/Booking');
const Property = require('../models/Property');
const User = require('../models/User');
const moment = require('moment');

// Get owner's booking dashboard
router.get('/dashboard', isAuthenticated, isOwner, async (req, res) => {
    try {
        const bookings = await Booking.find({ owner: req.session.user._id })
            .populate('property')
            .populate('renter', 'name email profileImage')
            .sort('-createdAt');

        // Calculate statistics
        const stats = {
            totalBookings: bookings.length,
            activeBookings: bookings.filter(b => b.status === 'confirmed' && moment(b.endDate).isAfter(moment())).length,
            pendingBookings: bookings.filter(b => b.status === 'pending').length,
            totalRevenue: bookings
                .filter(b => b.status === 'confirmed' || b.status === 'completed')
                .reduce((acc, b) => acc + b.totalPrice, 0)
        };

        res.render('dashboard/bookings', {
            title: 'Booking Management',
            bookings,
            stats,
            moment,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading booking dashboard:', error);
        req.flash('error_msg', 'Error loading booking dashboard');
        res.redirect('/dashboard');
    }
});

// Get booking requests for owner
router.get('/requests', isAuthenticated, isOwner, async (req, res) => {
    try {
        console.log('User session:', req.session.user);
        const bookings = await Booking.find({ 
            owner: req.session.user._id,
            status: 'pending'
        })
        .populate('property')
        .populate('renter', 'name email profileImage')
        .sort('-createdAt');

        console.log('Found bookings:', bookings.length);

        // Calculate statistics
        const stats = {
            totalRequests: bookings.length,
            totalValue: bookings.reduce((acc, b) => acc + b.totalPrice, 0),
            averageStay: bookings.reduce((acc, b) => 
                acc + moment(b.endDate).diff(moment(b.startDate), 'days'), 0) / (bookings.length || 1)
        };

        console.log('Calculated stats:', stats);

        res.render('dashboard/requests', {
            title: 'Booking Requests',
            bookings,
            stats,
            moment,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading booking requests:', error);
        req.flash('error_msg', 'Error loading booking requests');
        return res.redirect('/dashboard');
    }
});

// Filter bookings
router.get('/filter', isAuthenticated, isOwner, async (req, res) => {
    try {
        const { status, propertyId } = req.query;
        const filter = { owner: req.session.user._id };

        if (status && status !== 'all') {
            filter.status = status;
        }

        if (propertyId && propertyId !== 'all') {
            filter.property = propertyId;
        }

        const bookings = await Booking.find(filter)
            .populate('property')
            .populate('renter', 'name email profileImage')
            .sort('-createdAt');

        res.json(bookings);
    } catch (error) {
        console.error('Error filtering bookings:', error);
        res.status(500).json({ error: 'Error filtering bookings' });
    }
});

// Get booking details
router.get('/:id', isAuthenticated, async (req, res) => {
    try {
        // Validate ObjectId before querying
        if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({ error: 'Invalid booking ID format' });
        }

        const booking = await Booking.findById(req.params.id)
            .populate('property')
            .populate('renter', 'name email profileImage')
            .populate('owner', 'name email');

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        // Check if user is authorized to view this booking
        if (booking.owner._id.toString() !== req.session.user._id.toString() &&
            booking.renter._id.toString() !== req.session.user._id.toString()) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        res.json(booking);
    } catch (error) {
        console.error('Error fetching booking:', error);
        res.status(500).json({ error: 'Error fetching booking details' });
    }
});

// Create new booking
router.post('/', isAuthenticated, isRenter, async (req, res) => {
    try {
        const { propertyId, startDate, endDate, specialRequests } = req.body;

        // Validate property
        const property = await Property.findById(propertyId);
        if (!property) {
            return res.status(404).json({ error: 'Property not found' });
        }

        // Check availability
        const isAvailable = await property.isAvailable(startDate, endDate);
        if (!isAvailable) {
            return res.status(400).json({ error: 'Property not available for selected dates' });
        }

        // Calculate total price
        const nights = moment(endDate).diff(moment(startDate), 'days');
        const pricePerNight = property.price;
        const securityDeposit = property.securityDeposit || 0;
        const subtotal = nights * pricePerNight;
        const serviceFee = subtotal * 0.10; // 10% service fee
        const totalPrice = subtotal + serviceFee + securityDeposit;

        // Create booking
        const booking = new Booking({
            property: propertyId,
            renter: req.session.user._id,
            owner: property.owner,
            startDate,
            endDate,
            priceDetails: {
                pricePerNight,
                nights,
                subtotal,
                serviceFee,
                securityDeposit,
                totalPrice
            },
            totalPrice,
            specialRequests,
            status: 'pending',
            paymentStatus: 'pending'
        });

        await booking.save();

        // Update property booking count
        property.totalBookings += 1;
        await property.save();

        res.json({
            success: true,
            message: 'Booking request created. Please proceed with payment.',
            booking,
            priceDetails: booking.priceDetails
        });
    } catch (error) {
        console.error('Error creating booking:', error);
        res.status(500).json({ error: 'Error creating booking' });
    }
});

// Update booking status
router.put('/:id/status', isAuthenticated, isOwner, async (req, res) => {
    try {
        const { status } = req.body;
        const booking = await Booking.findOne({
            _id: req.params.id,
            owner: req.session.user._id
        }).populate('property renter');

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        // Validate status transition
        const validTransitions = {
            pending: ['confirmed', 'cancelled'],
            confirmed: ['completed', 'cancelled'],
            cancelled: [],
            completed: []
        };

        if (!validTransitions[booking.status].includes(status)) {
            return res.status(400).json({ error: 'Invalid status transition' });
        }

        // Update booking status
        booking.status = status;
        if (status === 'confirmed') {
            booking.confirmedAt = Date.now();
        } else if (status === 'cancelled') {
            // Handle cancellation logic (e.g., refund if applicable)
        } else if (status === 'completed') {
            booking.completedAt = Date.now();
        }

        await booking.save();

        // Send notification to renter (implement later)

        res.json({
            success: true,
            message: 'Booking status updated successfully',
            booking
        });
    } catch (error) {
        console.error('Error updating booking status:', error);
        res.status(500).json({ error: 'Error updating booking status' });
    }
});

// Cancel booking (renter)
router.put('/:id/cancel', isAuthenticated, isRenter, async (req, res) => {
    try {
        const booking = await Booking.findOne({
            _id: req.params.id,
            renter: req.session.user._id,
            status: { $in: ['pending', 'confirmed'] }
        }).populate('property');

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        // Check cancellation policy
        if (booking.status === 'confirmed') {
            const checkIn = moment(booking.startDate);
            const now = moment();
            const daysUntilCheckIn = checkIn.diff(now, 'days');

            if (daysUntilCheckIn < 2) {
                return res.status(400).json({ error: 'Cannot cancel booking less than 48 hours before check-in' });
            }
        }

        booking.status = 'cancelled';
        booking.cancellationReason = req.body.reason || 'Cancelled by guest';
        booking.cancelledAt = Date.now();

        await booking.save();

        // Handle refund if applicable (implement later)

        // Send notification to owner (implement later)

        res.json({
            success: true,
            message: 'Booking cancelled successfully',
            booking
        });
    } catch (error) {
        console.error('Error cancelling booking:', error);
        res.status(500).json({ error: 'Error cancelling booking' });
    }
});

// Get property availability
router.get('/availability/:propertyId', async (req, res) => {
    try {
        const bookings = await Booking.find({
            property: req.params.propertyId,
            status: { $in: ['confirmed', 'pending'] },
            endDate: { $gte: new Date() }
        });

        const events = bookings.map(booking => ({
            title: booking.status === 'confirmed' ? 'Booked' : 'Pending',
            start: booking.startDate,
            end: booking.endDate,
            color: booking.status === 'confirmed' ? '#EF4444' : '#F59E0B',
            extendedProps: {
                status: booking.status
            }
        }));

        res.json(events);
    } catch (error) {
        console.error('Error fetching availability:', error);
        res.status(500).json({ error: 'Error fetching availability' });
    }
});

// Check specific dates availability
router.post('/check-availability', async (req, res) => {
    try {
        const { propertyId, startDate, endDate } = req.body;
        
        const property = await Property.findById(propertyId);
        if (!property) {
            return res.status(404).json({ error: 'Property not found' });
        }

        const isAvailable = await property.isAvailable(startDate, endDate);
        
        res.json({
            available: isAvailable,
            message: isAvailable ? 'Dates are available' : 'Property is not available for selected dates'
        });
    } catch (error) {
        console.error('Error checking availability:', error);
        res.status(500).json({ error: 'Error checking availability' });
    }
});

module.exports = router; 