const express = require('express');
const router = express.Router();
const { isAuthenticated, isOwner, isPropertyOwner } = require('../middleware/auth');
const Property = require('../models/Property');
const Booking = require('../models/Booking');
const User = require('../models/User');
const multer = require('multer');
const path = require('path');
const moment = require('moment');

// Multer configuration for image uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/properties');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5000000 }, // 5MB limit
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png|webp/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Only image files are allowed!'));
    }
}).array('images', 5); // Allow up to 5 images

// List all properties with search and filters
router.get('/', async (req, res) => {
    try {
        const { 
            search, 
            type, 
            minPrice, 
            maxPrice, 
            beds, 
            baths,
            amenities,
            city,
            sort = 'createdAt',
            page = 1
        } = req.query;

        // Build filter object
        const filter = {};
        
        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
                { 'location.city': { $regex: search, $options: 'i' } }
            ];
        }

        if (type) filter.type = type;
        if (city) filter['location.city'] = city;
        if (minPrice || maxPrice) {
            filter.price = {};
            if (minPrice) filter.price.$gte = Number(minPrice);
            if (maxPrice) filter.price.$lte = Number(maxPrice);
        }
        if (beds) filter['features.beds'] = Number(beds);
        if (baths) filter['features.baths'] = Number(baths);
        if (amenities) {
            const amenitiesList = Array.isArray(amenities) ? amenities : [amenities];
            filter.amenities = { $all: amenitiesList };
        }

        // Only show available properties for non-owners
        if (!req.session.user || req.session.user.role !== 'owner') {
            filter.status = 'available';
        }

        // Build sort object
        const sortObj = {};
        switch (sort) {
            case 'price_asc':
                sortObj.price = 1;
                break;
            case 'price_desc':
                sortObj.price = -1;
                break;
            case 'rating':
                sortObj.avgRating = -1;
                break;
            default:
                sortObj.createdAt = -1;
        }

        // Pagination - show one property at a time
        const limit = 1;
        const skip = (page - 1) * limit;
        const totalProperties = await Property.countDocuments(filter);
        const totalPages = Math.ceil(totalProperties / limit);

        // Get properties with pagination
        const properties = await Property.find(filter)
            .populate('owner', 'name')
            .sort(sortObj)
            .skip(skip)
            .limit(limit);

        // Get unique cities for the filter
        const cities = await Property.distinct('location.city');

        res.render('properties/index', {
            title: 'Property Listings',
            properties,
            filters: req.query,
            cities,
            user: req.session.user || null,
            pagination: {
                page: parseInt(page),
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1,
                currentProperty: skip + 1,
                totalProperties
            },
            messages: {
                success: req.flash('success_msg'),
                error: req.flash('error_msg')
            }
        });
    } catch (error) {
        console.error('Error listing properties:', error);
        req.flash('error_msg', 'Error loading properties');
        res.redirect('/');
    }
});

// Show property creation form
router.get('/new', isAuthenticated, isOwner, (req, res) => {
    res.render('properties/new', {
        title: 'Add New Property'
    });
});

// Create new property
router.post('/', isAuthenticated, isOwner, async (req, res) => {
    try {
        upload(req, res, async function(err) {
            if (err) {
                req.flash('error_msg', err.message);
                return res.redirect('/properties/new');
            }

            if (!req.files || req.files.length === 0) {
                req.flash('error_msg', 'At least one image is required');
                return res.redirect('/properties/new');
            }

            const images = req.files.map(file => '/uploads/properties/' + file.filename);
            
            // Parse location data correctly
            const location = {
                street: req.body.street || req.body['location[street]'],
                city: req.body.city || req.body['location[city]'],
                zipCode: req.body.zipCode || req.body['location[zipCode]'],
                coordinates: {
                    lat: null,
                    lng: null
                }
            };

            const propertyData = {
                title: req.body.title,
                description: req.body.description,
                type: req.body.type,
                location: location,
                features: {
                    beds: Number(req.body.beds || req.body['features[beds]']) || 0,
                    baths: Number(req.body.baths || req.body['features[baths]']) || 0,
                    sqft: Number(req.body.sqft || req.body['features[sqft]']) || 0
                },
                amenities: Array.isArray(req.body['amenities[]']) ? req.body['amenities[]'] : 
                    req.body['amenities[]'] ? [req.body['amenities[]']] : [],
                price: Number(req.body.price) || 0,
                securityDeposit: Number(req.body.securityDeposit) || 0,
                images: images,
                houseRules: req.body.houseRules || '',
                owner: req.session.user._id,
                status: 'available'
            };

            // Validate required fields
            if (!location.street || !location.city || !location.zipCode) {
                req.flash('error_msg', 'All location fields are required');
                return res.redirect('/properties/new');
            }

            if (!propertyData.features.beds || !propertyData.features.baths || !propertyData.features.sqft) {
                req.flash('error_msg', 'All feature fields are required');
                return res.redirect('/properties/new');
            }

            const property = new Property(propertyData);
            await property.save();

            // Update user's properties
            await User.findByIdAndUpdate(
                req.session.user._id,
                { $push: { properties: property._id } }
            );

            req.flash('success_msg', 'Property created successfully! You can view it in your properties list.');
            res.redirect('/dashboard/properties');
        });
    } catch (error) {
        console.error('Error creating property:', error);
        req.flash('error_msg', error.message || 'Error creating property listing');
        res.redirect('/properties/new');
    }
});

// Show property edit form
router.get('/:id/edit', isAuthenticated, isPropertyOwner, async (req, res) => {
    try {
        const property = await Property.findById(req.params.id);
        if (!property) {
            req.flash('error_msg', 'Property not found');
            return res.redirect('/dashboard/properties');
        }

        res.render('properties/edit', {
            title: 'Edit Property',
            property
        });
    } catch (error) {
        console.error('Error loading property:', error);
        req.flash('error_msg', 'Error loading property');
        res.redirect('/dashboard/properties');
    }
});

// Update property
router.put('/:id', isAuthenticated, isPropertyOwner, async (req, res) => {
    try {
        upload(req, res, async function(err) {
            if (err) {
                req.flash('error_msg', err.message);
                return res.redirect('/dashboard/properties');
            }

            const property = await Property.findById(req.params.id);
            if (!property) {
                req.flash('error_msg', 'Property not found');
                return res.redirect('/dashboard/properties');
            }

            // Update basic information
            property.title = req.body.title;
            property.description = req.body.description;
            property.type = req.body.type;
            property.location = {
                street: req.body.location.street,
                city: req.body.location.city,
                zipCode: req.body.location.zipCode
            };
            property.features = {
                beds: req.body.features.beds,
                baths: req.body.features.baths,
                sqft: req.body.features.sqft
            };
            property.amenities = req.body.amenities;
            property.price = req.body.price;
            property.securityDeposit = req.body.securityDeposit;
            property.houseRules = req.body.houseRules;

            // Add new images if uploaded
            if (req.files && req.files.length > 0) {
                const newImages = req.files.map(file => '/uploads/properties/' + file.filename);
                property.images = [...property.images, ...newImages];
            }

            await property.save();
            req.flash('success_msg', 'Property updated successfully');
            res.redirect('/dashboard/properties');
        });
    } catch (error) {
        console.error('Error updating property:', error);
        req.flash('error_msg', 'Error updating property');
        res.redirect('/dashboard/properties');
    }
});

// Delete property image
router.delete('/:id/images/:index', isAuthenticated, isPropertyOwner, async (req, res) => {
    try {
        const property = await Property.findById(req.params.id);
        if (!property) {
            return res.status(404).json({ error: 'Property not found' });
        }

        const index = parseInt(req.params.index);
        if (index < 0 || index >= property.images.length) {
            return res.status(400).json({ error: 'Invalid image index' });
        }

        // Remove image from array
        property.images.splice(index, 1);
        await property.save();

        res.json({ success: true, message: 'Image deleted successfully' });
    } catch (error) {
        console.error('Error deleting image:', error);
        res.status(500).json({ error: 'Error deleting image' });
    }
});

// Toggle property status
router.put('/:id/toggle-status', isAuthenticated, isPropertyOwner, async (req, res) => {
    try {
        const property = await Property.findById(req.params.id);
        if (!property) {
            return res.status(404).json({ error: 'Property not found' });
        }

        // Check for active bookings before making unavailable
        if (property.status === 'available') {
            const activeBookings = await Booking.find({
                property: property._id,
                status: { $in: ['confirmed', 'pending'] },
                endDate: { $gte: new Date() }
            });

            if (activeBookings.length > 0) {
                return res.status(400).json({ 
                    error: 'Cannot make property unavailable while there are active bookings' 
                });
            }
        }

        property.status = property.status === 'available' ? 'unavailable' : 'available';
        await property.save();

        req.flash('success_msg', 'Property status updated successfully');
        return res.json({ 
            success: true, 
            message: 'Property status updated successfully',
            status: property.status
        });
    } catch (error) {
        console.error('Error toggling property status:', error);
        return res.status(500).json({ error: 'Error updating property status' });
    }
});

// Show property details
router.get('/:id', async (req, res) => {
    try {
        const property = await Property.findById(req.params.id)
            .populate('owner', 'name email profileImage')
            .populate({
                path: 'ratings',
                populate: {
                    path: 'user',
                    select: 'name profileImage'
                }
            });

        if (!property) {
            req.flash('error_msg', 'Property not found');
            return res.redirect('/properties');
        }

        // Initialize ratings if not present
        if (!property.ratings) {
            property.ratings = [];
        }

        // Calculate average rating
        property.averageRating = property.ratings.length > 0 
            ? property.ratings.reduce((acc, curr) => acc + curr.rating, 0) / property.ratings.length 
            : 0;

        // Get property availability
        const bookings = await Booking.find({
            property: property._id,
            status: { $in: ['confirmed', 'pending'] },
            endDate: { $gte: new Date() }
        });

        const availability = bookings.map(booking => ({
            start: booking.startDate,
            end: booking.endDate,
            status: booking.status
        }));

        res.render('properties/show', {
            title: property.title,
            property,
            availability,
            user: req.session.user || null,
            moment,
            messages: {
                success: req.flash('success_msg'),
                error: req.flash('error_msg')
            }
        });
    } catch (error) {
        console.error('Error loading property:', error);
        req.flash('error_msg', 'Error loading property');
        res.redirect('/properties');
    }
});

// Delete property
router.delete('/:id', isAuthenticated, isPropertyOwner, async (req, res) => {
    try {
        const property = await Property.findById(req.params.id);
        if (!property) {
            return res.status(404).json({ error: 'Property not found' });
        }

        // Check for active bookings
        const activeBookings = await Booking.find({
            property: property._id,
            status: { $in: ['confirmed', 'pending'] },
            endDate: { $gte: new Date() }
        });

        if (activeBookings.length > 0) {
            return res.status(400).json({
                error: 'Cannot delete property with active bookings'
            });
        }

        // Remove property from user's properties array
        await User.findByIdAndUpdate(
            property.owner,
            { $pull: { properties: property._id } }
        );

        // Delete the property
        await property.deleteOne();

        req.flash('success_msg', 'Property deleted successfully');
        return res.json({ 
            success: true, 
            message: 'Property deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting property:', error);
        return res.status(500).json({ error: 'Error deleting property' });
    }
});

module.exports = router; 