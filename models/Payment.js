const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    booking: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking',
        required: true
    },
    property: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
        required: true
    },
    renter: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    priceDetails: {
        pricePerNight: {
            type: Number,
            required: true
        },
        nights: {
            type: Number,
            required: true
        },
        subtotal: {
            type: Number,
            required: true
        },
        serviceFee: {
            type: Number,
            required: true
        },
        securityDeposit: {
            type: Number,
            required: true,
            default: 0
        },
        totalPrice: {
            type: Number,
            required: true
        }
    },
    currency: {
        type: String,
        default: 'usd'
    },
    stripePaymentIntentId: {
        type: String,
        required: true
    },
    stripeClientSecret: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'succeeded', 'failed', 'refunded'],
        default: 'pending'
    },
    refundId: {
        type: String
    },
    refundAmount: {
        type: Number
    },
    refundReason: {
        type: String
    },
    paymentMethod: {
        type: String,
        required: true
    },
    receiptUrl: {
        type: String
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Update timestamps on save
paymentSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Payment', paymentSchema); 