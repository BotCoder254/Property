const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    property: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
        required: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    booking: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking',
        required: true
    },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    comment: {
        type: String,
        required: true,
        trim: true,
        maxlength: 1000
    },
    ownerReply: {
        comment: {
            type: String,
            trim: true,
            maxlength: 1000
        },
        createdAt: {
            type: Date
        }
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'approved'
    },
    photos: [{
        type: String,
        validate: {
            validator: function(v) {
                return v.match(/\.(jpg|jpeg|png|gif)$/i);
            },
            message: 'Please upload valid image files'
        }
    }],
    cleanliness: {
        type: Number,
        min: 1,
        max: 5
    },
    communication: {
        type: Number,
        min: 1,
        max: 5
    },
    accuracy: {
        type: Number,
        min: 1,
        max: 5
    },
    location: {
        type: Number,
        min: 1,
        max: 5
    },
    checkIn: {
        type: Number,
        min: 1,
        max: 5
    },
    value: {
        type: Number,
        min: 1,
        max: 5
    }
}, {
    timestamps: true
});

// Ensure one review per booking
reviewSchema.index({ booking: 1 }, { unique: true });

// Calculate average rating before saving
reviewSchema.pre('save', function(next) {
    const ratings = [
        this.cleanliness || this.rating,
        this.communication || this.rating,
        this.accuracy || this.rating,
        this.location || this.rating,
        this.checkIn || this.rating,
        this.value || this.rating
    ];
    
    this.rating = ratings.reduce((a, b) => a + b) / ratings.length;
    next();
});

// Static method to get property average rating
reviewSchema.statics.getPropertyStats = async function(propertyId) {
    const stats = await this.aggregate([
        {
            $match: { 
                property: mongoose.Types.ObjectId(propertyId),
                status: 'approved'
            }
        },
        {
            $group: {
                _id: '$property',
                avgRating: { $avg: '$rating' },
                avgCleanliness: { $avg: '$cleanliness' },
                avgCommunication: { $avg: '$communication' },
                avgAccuracy: { $avg: '$accuracy' },
                avgLocation: { $avg: '$location' },
                avgCheckIn: { $avg: '$checkIn' },
                avgValue: { $avg: '$value' },
                numReviews: { $sum: 1 }
            }
        }
    ]);

    return stats[0] || {
        avgRating: 0,
        avgCleanliness: 0,
        avgCommunication: 0,
        avgAccuracy: 0,
        avgLocation: 0,
        avgCheckIn: 0,
        avgValue: 0,
        numReviews: 0
    };
};

const Review = mongoose.model('Review', reviewSchema);

module.exports = Review; 