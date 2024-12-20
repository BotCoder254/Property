const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { isAuthenticated, isRenter, isOwner } = require('../middleware/auth');
const Review = require('../models/Review');
const Property = require('../models/Property');
const Booking = require('../models/Booking');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/reviews')
    },
    filename: function (req, file, cb) {
        cb(null, `${Date.now()}-${file.originalname}`)
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Only image files are allowed!'));
    }
});

// Get reviews for a property
router.get('/property/:propertyId', async (req, res) => {
    try {
        const reviews = await Review.find({ 
            property: req.params.propertyId,
            status: 'approved'
        })
        .populate('user', 'name profileImage')
        .sort('-createdAt');

        const stats = await Review.getPropertyStats(req.params.propertyId);

        res.json({ reviews, stats });
    } catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).json({ message: 'Error fetching reviews' });
    }
});

// Create a new review
router.post('/:bookingId', isAuthenticated, isRenter, upload.array('photos', 5), async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.bookingId)
            .populate('property');

        if (!booking) {
            return res.status(404).json({ message: 'Booking not found' });
        }

        // Check if booking belongs to user
        if (booking.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        // Check if booking is completed
        if (booking.status !== 'completed') {
            return res.status(400).json({ message: 'Can only review completed bookings' });
        }

        // Check if review already exists
        const existingReview = await Review.findOne({ booking: booking._id });
        if (existingReview) {
            return res.status(400).json({ message: 'Review already exists for this booking' });
        }

        const photos = req.files ? req.files.map(file => `/uploads/reviews/${file.filename}`) : [];

        const review = new Review({
            property: booking.property._id,
            user: req.user._id,
            booking: booking._id,
            rating: req.body.rating,
            comment: req.body.comment,
            photos,
            cleanliness: req.body.cleanliness,
            communication: req.body.communication,
            accuracy: req.body.accuracy,
            location: req.body.location,
            checkIn: req.body.checkIn,
            value: req.body.value
        });

        await review.save();

        // Update property average rating
        const stats = await Review.getPropertyStats(booking.property._id);
        await Property.findByIdAndUpdate(booking.property._id, {
            avgRating: stats.avgRating,
            numReviews: stats.numReviews
        });

        res.status(201).json(review);
    } catch (error) {
        console.error('Error creating review:', error);
        res.status(500).json({ message: 'Error creating review' });
    }
});

// Owner reply to review
router.post('/:reviewId/reply', isAuthenticated, isOwner, async (req, res) => {
    try {
        const review = await Review.findById(req.params.reviewId)
            .populate('property');

        if (!review) {
            return res.status(404).json({ message: 'Review not found' });
        }

        // Check if property belongs to owner
        if (review.property.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        review.ownerReply = {
            comment: req.body.comment,
            createdAt: Date.now()
        };

        await review.save();
        res.json(review);
    } catch (error) {
        console.error('Error replying to review:', error);
        res.status(500).json({ message: 'Error replying to review' });
    }
});

// Update review status (admin only)
router.patch('/:reviewId/status', isAuthenticated, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const review = await Review.findByIdAndUpdate(
            req.params.reviewId,
            { status: req.body.status },
            { new: true }
        );

        if (!review) {
            return res.status(404).json({ message: 'Review not found' });
        }

        // Update property average rating if status changes
        const stats = await Review.getPropertyStats(review.property);
        await Property.findByIdAndUpdate(review.property, {
            avgRating: stats.avgRating,
            numReviews: stats.numReviews
        });

        res.json(review);
    } catch (error) {
        console.error('Error updating review status:', error);
        res.status(500).json({ message: 'Error updating review status' });
    }
});

module.exports = router; 