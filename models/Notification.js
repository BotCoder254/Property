const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        enum: ['booking_request', 'booking_confirmed', 'booking_cancelled', 'payment_received', 'review_received'],
        required: true
    },
    message: {
        type: String,
        required: true
    },
    relatedBooking: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking'
    },
    relatedProperty: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property'
    },
    read: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Create notification for booking request
notificationSchema.statics.createBookingRequestNotification = async function(booking) {
    return this.create({
        user: booking.property.owner,
        type: 'booking_request',
        message: `New booking request received for ${booking.property.title}`,
        relatedBooking: booking._id,
        relatedProperty: booking.property._id
    });
};

// Create notification for booking confirmation
notificationSchema.statics.createBookingConfirmationNotification = async function(booking) {
    return this.create({
        user: booking.renter,
        type: 'booking_confirmed',
        message: `Your booking for ${booking.property.title} has been confirmed`,
        relatedBooking: booking._id,
        relatedProperty: booking.property._id
    });
};

// Create notification for new review
notificationSchema.statics.createReviewNotification = async function(review) {
    return this.create({
        user: review.property.owner,
        type: 'review_received',
        message: `New review received for ${review.property.title}`,
        relatedProperty: review.property._id
    });
};

module.exports = mongoose.model('Notification', notificationSchema); 