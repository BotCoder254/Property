const express = require('express');
const router = express.Router();
const Property = require('../models/Property');
const User = require('../models/User');
const { isAuthenticated } = require('../middleware/auth');
const Booking = require('../models/Booking');
const Review = require('../models/Review');
const Notification = require('../models/Notification');

// Landing page
router.get('/', async (req, res) => {
    try {
        // Fetch featured properties with owner details
        const properties = await Property.find()
            .populate('owner', 'name')
            .sort({ createdAt: -1 })
            .limit(3);

        // Get total property count
        const totalProperties = await Property.countDocuments();
        const totalUsers = await User.countDocuments();

        res.render('index', {
            title: 'Welcome to PropertyPro',
            properties,
            stats: {
                totalProperties,
                totalUsers,
                locations: await Property.distinct('location.city')
            }
        });
    } catch (error) {
        console.error('Error loading landing page:', error);
        res.status(500).render('error', {
            title: 'Error',
            message: 'Error loading the landing page'
        });
    }
});

// Dashboard route (protected)
router.get('/dashboard', isAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user._id);
        if (!user) {
            return res.redirect('/auth/login');
        }

        let stats = {
            totalBookings: 0,
            pendingBookings: 0,
            completedBookings: 0,
            averageRating: 0,
            totalRevenue: 0,
            totalProperties: 0,
            activeBookings: 0,
            upcomingBookings: [],
            totalSpent: 0,
            recentBookings: []
        };

        if (user.role === 'owner') {
            // Get owner's properties
            const properties = await Property.find({ owner: user._id });
            stats.totalProperties = properties.length;

            // Get bookings for all properties with full details
            const propertyIds = properties.map(p => p._id);
            const bookings = await Booking.find({ property: { $in: propertyIds } })
                .populate('renter', 'name email profileImage')
                .populate({
                    path: 'property',
                    select: 'title images price location'
                })
                .sort({ createdAt: -1 })
                .limit(5);
            
            // Calculate stats
            stats.totalBookings = bookings.length;
            stats.pendingBookings = bookings.filter(b => b.status === 'pending').length;
            stats.completedBookings = bookings.filter(b => b.status === 'completed').length;
            stats.activeBookings = bookings.filter(b => b.status === 'confirmed').length;
            stats.recentBookings = bookings.map(booking => ({
                ...booking.toObject(),
                renter: booking.renter,
                property: booking.property,
                duration: Math.ceil((new Date(booking.endDate) - new Date(booking.startDate)) / (1000 * 60 * 60 * 24))
            }));
            
            // Calculate revenue
            const allBookings = await Booking.find({ property: { $in: propertyIds } });
            const completedBookings = allBookings.filter(b => b.status === 'completed');
            stats.totalRevenue = completedBookings.reduce((sum, booking) => sum + (booking.totalAmount || 0), 0);

            // Calculate average rating
            const reviews = await Review.find({ property: { $in: propertyIds } });
            if (reviews.length > 0) {
                stats.averageRating = reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
            }

            // Get recent reviews
            const recentReviews = await Review.find({ property: { $in: propertyIds } })
                .populate('user', 'name profileImage')
                .sort({ createdAt: -1 })
                .limit(3);
            stats.recentReviews = recentReviews;

        } else {
            // Get renter's bookings with full details
            const bookings = await Booking.find({ renter: user._id })
                .populate({
                    path: 'property',
                    select: 'title images price location owner',
                    populate: {
                        path: 'owner',
                        select: 'name email'
                    }
                })
                .sort({ startDate: 1 });
            
            // Calculate stats
            stats.totalBookings = bookings.length;
            stats.pendingBookings = bookings.filter(b => b.status === 'pending').length;
            stats.completedBookings = bookings.filter(b => b.status === 'completed').length;
            stats.activeBookings = bookings.filter(b => b.status === 'confirmed').length;
            
            // Get upcoming bookings
            const today = new Date();
            stats.upcomingBookings = bookings
                .filter(b => new Date(b.startDate) >= today)
                .map(booking => ({
                    ...booking.toObject(),
                    duration: Math.ceil((new Date(booking.endDate) - new Date(booking.startDate)) / (1000 * 60 * 60 * 24))
                }));
            
            // Calculate total spent
            const completedBookings = bookings.filter(b => b.status === 'completed');
            stats.totalSpent = completedBookings.reduce((sum, booking) => sum + (booking.totalAmount || 0), 0);

            // Get user's reviews
            const reviews = await Review.find({ user: user._id })
                .populate('property', 'title images')
                .sort({ createdAt: -1 })
                .limit(3);
            stats.userReviews = reviews;
        }

        // Get notifications
        const notifications = await Notification.find({ user: user._id })
            .sort({ createdAt: -1 })
            .limit(5);

        res.render('dashboard/index', {
            user,
            stats,
            notifications,
            title: 'Dashboard',
            layout: 'layouts/main',
            moment: require('moment')
        });
    } catch (error) {
        console.error('Dashboard Error:', error);
        res.status(500).render('error', { 
            message: 'Error loading dashboard', 
            error: error,
            title: 'Error',
            layout: 'layouts/main'
        });
    }
});

// Booking Requests route (protected)
router.get('/dashboard/bookings', isAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user._id);
        let bookings;
        let stats = {
            totalBookings: 0,
            activeBookings: 0,
            pendingBookings: 0,
            completedBookings: 0,
            totalRevenue: 0,
            averageStay: 0
        };
        
        if (user.role === 'owner') {
            // Get properties owned by the user
            const properties = await Property.find({ owner: user._id });
            const propertyIds = properties.map(p => p._id);
            
            // Get all bookings for these properties
            bookings = await Booking.find({ property: { $in: propertyIds } })
                .populate('renter', 'name email profileImage')
                .populate('property', 'title images price location')
                .sort({ createdAt: -1 });

            // Calculate stats
            stats.totalBookings = bookings.length;
            stats.activeBookings = bookings.filter(b => b.status === 'confirmed').length;
            stats.pendingBookings = bookings.filter(b => b.status === 'pending').length;
            stats.completedBookings = bookings.filter(b => b.status === 'completed').length;
            
            // Calculate total revenue from completed bookings
            const completedBookings = bookings.filter(b => b.status === 'completed');
            stats.totalRevenue = completedBookings.reduce((sum, b) => sum + (b.totalAmount || 0), 0);

            // Calculate average stay duration
            const totalDays = bookings.reduce((sum, booking) => {
                return sum + Math.ceil((new Date(booking.endDate) - new Date(booking.startDate)) / (1000 * 60 * 60 * 24));
            }, 0);
            stats.averageStay = bookings.length > 0 ? (totalDays / bookings.length).toFixed(1) : 0;

        } else {
            // Get all bookings made by the user
            bookings = await Booking.find({ renter: user._id })
                .populate({
                    path: 'property',
                    select: 'title images price location owner',
                    populate: {
                        path: 'owner',
                        select: 'name email'
                    }
                })
                .sort({ startDate: -1 });

            // Calculate stats for renter
            stats.totalBookings = bookings.length;
            stats.activeBookings = bookings.filter(b => b.status === 'confirmed').length;
            stats.pendingBookings = bookings.filter(b => b.status === 'pending').length;
            stats.completedBookings = bookings.filter(b => b.status === 'completed').length;
            
            // Calculate total spent
            const completedBookings = bookings.filter(b => b.status === 'completed');
            stats.totalRevenue = completedBookings.reduce((sum, b) => sum + (b.totalAmount || 0), 0);

            // Calculate average stay duration
            const totalDays = bookings.reduce((sum, booking) => {
                return sum + Math.ceil((new Date(booking.endDate) - new Date(booking.startDate)) / (1000 * 60 * 60 * 24));
            }, 0);
            stats.averageStay = bookings.length > 0 ? (totalDays / bookings.length).toFixed(1) : 0;
        }

        // Process bookings to add additional information
        const processedBookings = bookings.map(booking => ({
            ...booking.toObject(),
            duration: Math.ceil((new Date(booking.endDate) - new Date(booking.startDate)) / (1000 * 60 * 60 * 24)),
            isUpcoming: new Date(booking.startDate) > new Date(),
            canCancel: booking.status === 'pending' || 
                      (booking.status === 'confirmed' && 
                       new Date(booking.startDate) > new Date(Date.now() + 2 * 24 * 60 * 60 * 1000))
        }));

        // Get recent notifications
        const notifications = await Notification.find({ 
            user: user._id,
            type: { $in: ['booking_request', 'booking_confirmed', 'booking_cancelled'] }
        })
        .sort({ createdAt: -1 })
        .limit(5);

        res.render('dashboard/bookings', {
            title: 'Booking Requests',
            user,
            bookings: processedBookings,
            stats,
            notifications,
            moment: require('moment'),
            layout: 'layouts/main'
        });
    } catch (error) {
        console.error('Booking Requests Error:', error);
        req.flash('error_msg', 'Error loading booking requests');
        res.redirect('/dashboard');
    }
});

// My Properties route (protected)
router.get('/dashboard/properties', isAuthenticated, async (req, res) => {
    try {
        const properties = await Property.find({ owner: req.session.user._id })
            .populate({
                path: 'bookings',
                select: 'startDate endDate status totalAmount',
                match: { status: { $ne: 'cancelled' } }
            });

        // Calculate additional stats for each property
        const propertiesWithStats = properties.map(property => {
            const propertyObj = property.toObject();
            const activeBookings = propertyObj.bookings.filter(b => b.status === 'confirmed').length;
            const totalRevenue = propertyObj.bookings
                .filter(b => b.status === 'completed')
                .reduce((sum, b) => sum + (b.totalAmount || 0), 0);

            return {
                ...propertyObj,
                activeBookings,
                totalRevenue,
                occupancyRate: propertyObj.bookings.length > 0 
                    ? ((propertyObj.bookings.filter(b => b.status === 'completed').length / propertyObj.bookings.length) * 100).toFixed(1)
                    : 0
            };
        });

        res.render('dashboard/properties', {
            title: 'My Properties',
            properties: propertiesWithStats,
            moment: require('moment'),
            layout: 'layouts/main'
        });
    } catch (error) {
        console.error('Properties Error:', error);
        res.status(500).render('error', {
            message: 'Error loading properties',
            error,
            title: 'Error',
            layout: 'layouts/main'
        });
    }
});

// Profile route (protected)
router.get('/dashboard/profile', isAuthenticated, async (req, res) => {
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