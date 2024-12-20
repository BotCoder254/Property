const express = require('express');
const router = express.Router();
const { isAuthenticated, isOwner } = require('../middleware/auth');
const Property = require('../models/Property');
const Booking = require('../models/Booking');
const User = require('../models/User');
const moment = require('moment');

// Helper function to calculate property statistics
async function calculatePropertyStats(properties) {
    let totalBookings = 0;
    let activeBookings = 0;
    let totalRevenue = 0;
    let totalRatings = 0;
    let ratingSum = 0;

    for (const property of properties) {
        // Get bookings for this property
        const bookings = await Booking.find({ property: property._id });
        
        totalBookings += bookings.length;
        activeBookings += bookings.filter(b => 
            b.status === 'confirmed' && moment(b.endDate).isAfter(moment())
        ).length;
        
        totalRevenue += bookings
            .filter(b => b.status === 'confirmed' || b.status === 'completed')
            .reduce((sum, b) => sum + b.totalPrice, 0);

        if (property.ratings && property.ratings.length > 0) {
            totalRatings += property.ratings.length;
            ratingSum += property.ratings.reduce((sum, r) => sum + r.rating, 0);
        }
    }

    return {
        totalProperties: properties.length,
        totalBookings,
        activeBookings,
        totalRevenue,
        averageRating: totalRatings > 0 ? ratingSum / totalRatings : 0
    };
}

// Dashboard home
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user._id)
            .populate('properties')
            .populate({
                path: 'bookings',
                populate: {
                    path: 'property',
                    select: 'title images'
                }
            });

        let stats = {};
        
        if (user.role === 'owner') {
            const properties = await Property.find({ owner: user._id });
            stats = await calculatePropertyStats(properties);

            // Get recent bookings
            const recentBookings = await Booking.find({ owner: user._id })
                .populate('property')
                .populate('renter', 'name email profileImage')
                .sort('-createdAt')
                .limit(5);

            // Get pending bookings count
            const pendingBookings = await Booking.countDocuments({
                owner: user._id,
                status: 'pending'
            });

            stats.recentBookings = recentBookings;
            user.pendingBookings = pendingBookings;
        } else {
            const bookings = await Booking.find({ renter: user._id })
                .populate('property');

            stats = {
                totalBookings: bookings.length,
                activeBookings: bookings.filter(b => 
                    b.status === 'confirmed' && moment(b.endDate).isAfter(moment())
                ).length,
                totalSpent: bookings
                    .filter(b => b.status === 'confirmed' || b.status === 'completed')
                    .reduce((sum, b) => sum + b.totalPrice, 0),
                upcomingBookings: bookings
                    .filter(b => moment(b.startDate).isAfter(moment()))
                    .slice(0, 5)
            };
        }

        res.render('dashboard/index', {
            title: 'Dashboard',
            user,
            stats,
            moment
        });
    } catch (error) {
        console.error('Dashboard Error:', error);
        req.flash('error_msg', 'Error loading dashboard');
        res.redirect('/');
    }
});

// My Properties page
router.get('/properties', isAuthenticated, isOwner, async (req, res) => {
    try {
        const properties = await Property.find({ owner: req.session.user._id })
            .populate({
                path: 'ratings',
                populate: {
                    path: 'user',
                    select: 'name profileImage'
                }
            });

        // Calculate statistics for each property
        const enrichedProperties = await Promise.all(properties.map(async property => {
            const bookings = await Booking.find({ property: property._id });
            const activeBookings = bookings.filter(b => 
                b.status === 'confirmed' && moment(b.endDate).isAfter(moment())
            ).length;
            const revenue = bookings
                .filter(b => b.status === 'confirmed' || b.status === 'completed')
                .reduce((sum, b) => sum + b.totalPrice, 0);

            return {
                ...property.toObject(),
                activeBookings,
                revenue
            };
        }));

        const stats = await calculatePropertyStats(properties);

        res.render('dashboard/properties', {
            title: 'My Properties',
            properties: enrichedProperties,
            stats,
            moment,
            messages: {
                success: req.flash('success_msg'),
                error: req.flash('error_msg')
            }
        });
    } catch (error) {
        console.error('Error loading properties:', error);
        req.flash('error_msg', 'Error loading properties');
        res.redirect('/dashboard');
    }
});

// Get property statistics for charts
router.get('/stats/properties', isAuthenticated, isOwner, async (req, res) => {
    try {
        const bookings = await Booking.find({ owner: req.session.user._id })
            .populate('property')
            .sort('createdAt');

        // Calculate monthly revenue
        const monthlyRevenue = {};
        bookings.forEach(booking => {
            if (booking.status === 'confirmed' || booking.status === 'completed') {
                const month = moment(booking.createdAt).format('MMM YYYY');
                monthlyRevenue[month] = (monthlyRevenue[month] || 0) + booking.totalPrice;
            }
        });

        // Calculate booking status distribution
        const statusCount = {
            confirmed: bookings.filter(b => b.status === 'confirmed').length,
            completed: bookings.filter(b => b.status === 'completed').length,
            cancelled: bookings.filter(b => b.status === 'cancelled').length,
            pending: bookings.filter(b => b.status === 'pending').length
        };

        res.json({
            monthlyRevenue,
            statusCount
        });
    } catch (error) {
        console.error('Error fetching statistics:', error);
        res.status(500).json({ error: 'Error fetching statistics' });
    }
});

// Cancel booking
router.post('/bookings/:id/cancel', isAuthenticated, async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id);
        
        if (!booking) {
            req.flash('error_msg', 'Booking not found');
            return res.redirect('/dashboard');
        }

        if (booking.renter.toString() !== req.session.user._id.toString()) {
            req.flash('error_msg', 'Not authorized');
            return res.redirect('/dashboard');
        }

        if (!booking.canBeCancelled()) {
            req.flash('error_msg', 'Booking cannot be cancelled');
            return res.redirect('/dashboard');
        }

        booking.status = 'cancelled';
        booking.cancellationReason = req.body.reason || 'Cancelled by user';
        await booking.save();

        req.flash('success_msg', 'Booking cancelled successfully');
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Cancel Booking Error:', error);
        req.flash('error_msg', 'Error cancelling booking');
        res.redirect('/dashboard');
    }
});

// Profile route
router.get('/profile', isAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user._id)
            .populate('properties')
            .populate({
                path: 'bookings',
                populate: {
                    path: 'property',
                    select: 'title images'
                }
            });

        res.render('dashboard/profile', {
            title: 'My Profile',
            user: user,
            moment: require('moment')
        });
    } catch (error) {
        console.error('Profile Error:', error);
        req.flash('error_msg', 'Error loading profile');
        res.redirect('/dashboard');
    }
});

module.exports = router; 