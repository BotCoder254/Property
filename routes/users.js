const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const User = require('../models/User');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

// Configure multer for profile image uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = 'public/uploads/profiles';
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        cb(null, `${Date.now()}-${file.originalname}`);
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

// Update profile
router.put('/profile', isAuthenticated, async (req, res) => {
    try {
        const { name, phone, location, bio, currentPassword, newPassword } = req.body;
        const user = await User.findById(req.session.user._id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Update basic info
        user.name = name;
        user.phone = phone;
        user.location = location;
        user.bio = bio;

        // Update password if provided
        if (currentPassword && newPassword) {
            const isMatch = await user.comparePassword(currentPassword);
            if (!isMatch) {
                return res.status(400).json({ error: 'Current password is incorrect' });
            }
            user.password = newPassword;
        }

        await user.save();
        req.session.user = user.getPublicProfile();
        res.json({ message: 'Profile updated successfully', user: user.getPublicProfile() });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Error updating profile' });
    }
});

// Upload profile image
router.post('/profile/image', isAuthenticated, upload.single('profileImage'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        const user = await User.findById(req.session.user._id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Delete old profile image if it exists and is not the default
        if (user.profileImage && user.profileImage !== '/images/default-avatar.png') {
            const oldImagePath = path.join(__dirname, '..', 'public', user.profileImage);
            if (fs.existsSync(oldImagePath)) {
                fs.unlinkSync(oldImagePath);
            }
        }

        // Update user's profile image
        const imageUrl = `/uploads/profiles/${req.file.filename}`;
        user.profileImage = imageUrl;
        await user.save();

        req.session.user = user.getPublicProfile();
        res.json({ message: 'Profile image updated successfully', imageUrl });
    } catch (error) {
        console.error('Profile image upload error:', error);
        res.status(500).json({ error: 'Error uploading profile image' });
    }
});

module.exports = router; 