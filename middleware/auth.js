const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Property = require('../models/Property');

exports.isAuthenticated = (req, res, next) => {
  if (req.session && req.session.user) {
    req.user = req.session.user;
    return next();
  }
  res.redirect('/auth/login');
};

exports.isOwner = (req, res, next) => {
  if (req.session && req.session.user && req.session.user.role === 'owner') {
    req.user = req.session.user;
    return next();
  }
  res.status(403).render('error', {
    message: 'Access denied. Owner privileges required.',
    error: { status: 403 },
    title: 'Error',
    layout: 'layouts/main'
  });
};

exports.isRenter = (req, res, next) => {
  if (req.session && req.session.user && req.session.user.role === 'renter') {
    req.user = req.session.user;
    return next();
  }
  res.status(403).render('error', {
    message: 'Access denied. Renter privileges required.',
    error: { status: 403 },
    title: 'Error',
    layout: 'layouts/main'
  });
};

exports.checkRole = (...roles) => {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) {
      req.flash('error_msg', 'You do not have permission to perform this action');
      return res.redirect('/');
    }
    next();
  };
};

exports.isPropertyOwner = async (req, res, next) => {
  try {
    const property = await Property.findById(req.params.id);
    if (!property) {
      req.flash('error_msg', 'Property not found');
      return res.redirect('/properties');
    }

    if (property.owner.toString() !== req.session.user._id.toString()) {
      req.flash('error_msg', 'You are not authorized to perform this action');
      return res.redirect('/properties');
    }
    
    req.property = property;
    next();
  } catch (error) {
    console.error('Error in isPropertyOwner middleware:', error);
    req.flash('error_msg', 'Server Error');
    res.redirect('/properties');
  }
};

exports.generateToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET || 'your-jwt-secret',
    { expiresIn: '1d' }
  );
}; 