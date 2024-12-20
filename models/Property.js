const mongoose = require('mongoose');

const propertySchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        required: true
    },
    type: {
        type: String,
        required: true,
        enum: ['apartment', 'house', 'villa', 'condo', 'studio']
    },
    location: {
        street: {
            type: String,
            required: true
        },
        city: {
            type: String,
            required: true
        },
        zipCode: {
            type: String,
            required: true
        },
        coordinates: {
            lat: Number,
            lng: Number
        }
    },
    features: {
        beds: {
            type: Number,
            required: true,
            min: 0
        },
        baths: {
            type: Number,
            required: true,
            min: 0
        },
        sqft: {
            type: Number,
            required: true,
            min: 0
        }
    },
    amenities: [{
        type: String,
        enum: [
            'furnished',
            'parking',
            'airConditioning',
            'heating',
            'washer',
            'dryer',
            'wifi',
            'tv'
        ]
    }],
    price: {
        type: Number,
        required: true,
        min: 0
    },
    securityDeposit: {
        type: Number,
        min: 0,
        default: 0
    },
    images: [{
        type: String,
        required: true
    }],
    houseRules: {
        type: String,
        trim: true
    },
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    status: {
        type: String,
        enum: ['available', 'booked', 'maintenance', 'unavailable'],
        default: 'available'
    },
    ratings: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        rating: {
            type: Number,
            required: true,
            min: 1,
            max: 5
        },
        review: String,
        createdAt: {
            type: Date,
            default: Date.now
        }
    }],
    avgRating: {
        type: Number,
        default: 0
    },
    totalBookings: {
        type: Number,
        default: 0
    },
    availability: [{
        startDate: Date,
        endDate: Date,
        status: {
            type: String,
            enum: ['available', 'blocked', 'booked'],
            default: 'available'
        }
    }]
}, {
    timestamps: true
});

// Index for text search
propertySchema.index({
    title: 'text',
    description: 'text',
    'location.city': 'text'
});

// Calculate average rating when a new rating is added
propertySchema.methods.calculateAverageRating = function() {
    if (this.ratings.length === 0) {
        this.avgRating = 0;
        return;
    }
    
    const sum = this.ratings.reduce((acc, rating) => acc + rating.rating, 0);
    this.avgRating = Math.round((sum / this.ratings.length) * 10) / 10;
};

// Check if property is available for given dates
propertySchema.methods.isAvailable = async function(startDate, endDate) {
    const overlappingBookings = await mongoose.model('Booking').find({
        property: this._id,
        status: { $in: ['confirmed', 'pending'] },
        $or: [
            {
                startDate: { $lte: endDate },
                endDate: { $gte: startDate }
            }
        ]
    });

    return overlappingBookings.length === 0;
};

// Get upcoming bookings
propertySchema.methods.getUpcomingBookings = async function() {
    return await mongoose.model('Booking').find({
        property: this._id,
        status: 'confirmed',
        startDate: { $gte: new Date() }
    }).populate('renter', 'name email');
};

// Get property stats
propertySchema.methods.getStats = async function() {
    const bookings = await mongoose.model('Booking').find({ property: this._id });
    const confirmedBookings = bookings.filter(b => b.status === 'confirmed');
    const totalRevenue = confirmedBookings.reduce((acc, b) => acc + b.totalPrice, 0);
    
    return {
        totalBookings: this.totalBookings,
        avgRating: this.avgRating,
        totalRevenue,
        occupancyRate: this.totalBookings > 0 ? 
            (confirmedBookings.length / this.totalBookings) * 100 : 0
    };
};

module.exports = mongoose.model('Property', propertySchema); 