const express = require('express');
const router = express.Router();
const { isAuthenticated, isOwner } = require('../middleware/auth');
const Booking = require('../models/Booking');
const Property = require('../models/Property');
const User = require('../models/User');
const Notification = require('../models/Notification');

// Update booking status
router.put('/bookings/:id/status', isAuthenticated, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const user = await User.findById(req.session.user._id);

        // Find the booking
        const booking = await Booking.findById(id)
            .populate('property')
            .populate('renter', 'name email');

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        // Check if user has permission to update the booking
        const property = await Property.findById(booking.property._id);
        if (user.role === 'owner' && property.owner.toString() !== user._id.toString()) {
            return res.status(403).json({ error: 'Not authorized to update this booking' });
        }

        if (user.role === 'renter' && booking.renter.toString() !== user._id.toString()) {
            return res.status(403).json({ error: 'Not authorized to update this booking' });
        }

        // Validate the status transition
        const validTransitions = {
            owner: {
                pending: ['confirmed', 'cancelled'],
                confirmed: ['completed', 'cancelled'],
                cancelled: [],
                completed: []
            },
            renter: {
                pending: ['cancelled'],
                confirmed: ['cancelled'],
                cancelled: [],
                completed: []
            }
        };

        const allowedTransitions = validTransitions[user.role][booking.status];
        if (!allowedTransitions.includes(status)) {
            return res.status(400).json({ error: 'Invalid status transition' });
        }

        // Update the booking status
        booking.status = status;
        await booking.save();

        // Create notification for the other party
        const notificationRecipient = user.role === 'owner' ? booking.renter : property.owner;
        const notificationMessage = {
            confirmed: `Your booking for ${property.title} has been confirmed!`,
            cancelled: `The booking for ${property.title} has been cancelled.`,
            completed: `Your stay at ${property.title} has been completed.`
        };

        await Notification.create({
            user: notificationRecipient,
            message: notificationMessage[status],
            type: `booking_${status}`,
            relatedBooking: booking._id
        });

        // If booking is cancelled, update property availability
        if (status === 'cancelled') {
            // Update property availability logic here
        }

        res.json({ message: 'Booking status updated successfully', booking });
    } catch (error) {
        console.error('Error updating booking status:', error);
        res.status(500).json({ error: 'Failed to update booking status' });
    }
});

module.exports = router; 